// screens/ProofBuilderScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSignedUrl } from "../lib/attachmentsApi";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, spacing } from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";
import { isoToMDY, mdyToISO } from "../lib/dateFormat";

const IS_WEB = Platform.OS === "web";
const PREVIEW_BUCKET_FALLBACK = "asset-files";

const ROLE_GROUPS = [
  {
    group: "Ownership",
    items: ["Proof of Purchase", "Bill of Sale", "Title / Registration", "Warranty", "Appraisal", "Proof of Insurance"],
  },
  {
    group: "Maintenance",
    items: ["Service Receipt", "Invoice", "Inspection", "Work Order"],
  },
  {
    group: "Reference",
    items: ["Manual", "Spec Sheet", "Install Guide"],
  },
  {
    group: "Evidence",
    items: ["Photo", "Condition Report", "Before / After"],
  },
  { group: "Other", items: ["Other"] },
];

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function getExt(name = "") {
  const base = (name || "").split("?")[0].split("#")[0];
  const parts = base.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() || "").toLowerCase();
}

function isImageLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  if (mime.startsWith("image/")) return true;
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
  return IMAGE_EXTS.includes(ext);
}

function isPdfLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  return mime === "application/pdf" || ext === "pdf";
}

function inferName(att) {
  return (
    safeStr(att?.title) ||
    safeStr(att?.file_name) ||
    safeStr(att?.name) ||
    safeStr(att?.url) ||
    "Attachment"
  );
}

function shortId(id) {
  const s = safeStr(id);
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}
function extractWarrantyDates(text = "") {
  if (!text) return {};

  const patterns = {
    start: [
      /effective\s*date[:\s]*([0-9\/\-]+)/i,
      /start\s*date[:\s]*([0-9\/\-]+)/i,
      /coverage\s*begins[:\s]*([0-9\/\-]+)/i,
    ],
    end: [
      /expiration\s*date[:\s]*([0-9\/\-]+)/i,
      /expires[:\s]*([0-9\/\-]+)/i,
      /coverage\s*ends[:\s]*([0-9\/\-]+)/i,
    ],
    provider: [
      /provider[:\s]*([A-Za-z0-9 &]+)/i,
      /administrator[:\s]*([A-Za-z0-9 &]+)/i,
    ],
    policy: [
      /policy\s*(number|#)[:\s]*([A-Za-z0-9\-]+)/i,
      /contract\s*(number|#)[:\s]*([A-Za-z0-9\-]+)/i,
    ],
  };

  const result = {};

  for (const r of patterns.start) {
    const m = text.match(r);
    if (m) result.start = m[1];
  }

  for (const r of patterns.end) {
    const m = text.match(r);
    if (m) result.end = m[1];
  }

  for (const r of patterns.provider) {
    const m = text.match(r);
    if (m) result.provider = m[1];
  }

  for (const r of patterns.policy) {
    const m = text.match(r);
    if (m) result.policy = m[2] || m[1];
  }

  return result;
}

export default function ProofBuilderScreen({ route, navigation }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;

  const assetId = route?.params?.assetId || null;
  const attachmentId = route?.params?.attachmentId || null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [attachment, setAttachment] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const [placements, setPlacements] = useState([]);
  const [systems, setSystems] = useState([]);
  const [systemsLoading, setSystemsLoading] = useState(false);

  // Attachment meta
  const [roleValue, setRoleValue] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [privacy, setPrivacy] = useState("moves_with_asset"); // moves_with_asset | owner_only

  // Warranty object meta (objects.data)
  const [wProvider, setWProvider] = useState("");
  const [wPolicy, setWPolicy] = useState("");
  const [wStarts, setWStarts] = useState("");
  const [wExpires, setWExpires] = useState("");
  const [wCoverageNotes, setWCoverageNotes] = useState("");

  const [warrantyObjectId, setWarrantyObjectId] = useState(null);
  const [warrantySavedAt, setWarrantySavedAt] = useState("");

  // Systems selection (also drives object_links + placements for warranty)
  const [selectedSystemIds, setSelectedSystemIds] = useState([]);
  const [saving, setSaving] = useState(false);

  // Save feedback
  const [saveToast, setSaveToast] = useState({ visible: false, title: "", message: "" });

  // Quick add system
  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const [newSystemName, setNewSystemName] = useState("");

  const [roleModalOpen, setRoleModalOpen] = useState(false);

  const isWarranty = useMemo(() => String(roleValue || "").toLowerCase() === "warranty", [roleValue]);

  const inferRoleFromPlacements = useCallback((pls) => {
    if (!Array.isArray(pls) || pls.length === 0) return "";
    // take most frequent non-empty role
    const counts = new Map();
    for (const p of pls) {
      const r = safeStr(p?.role).trim();
      if (!r) continue;
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [k, n] of counts.entries()) {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    return best;
  }, []);

  const fetchPlacements = useCallback(async () => {
    if (!attachmentId) return [];
    const { data, error } = await supabase
      .from("attachment_placements")
      .select("*")
      .eq("attachment_id", attachmentId);

    if (error) return [];
    return data || [];
  }, [attachmentId]);

  const fetchSystems = useCallback(async () => {
    if (!assetId) return [];
    setSystemsLoading(true);
    try {
      const { data, error } = await supabase
        .from("systems")
        .select("id,name,system_type,ksc_code,mode,ai_metadata,playbook")
        .eq("asset_id", assetId)
        .order("name", { ascending: true })
        .limit(250);

      if (error) return [];
      return data || [];
    } finally {
      setSystemsLoading(false);
    }
  }, [assetId]);


  const loadWarrantyObject = useCallback(
    async () => {
      if (!attachmentId) return null;

      // Identify warranty object by (type=warranty AND data.attachment_id matches)
      const { data, error } = await supabase
        .from("objects")
        .select("id,title,status,data,created_at,updated_at")
        .eq("object_type_key", "warranty")
        .filter("data->>attachment_id", "eq", String(attachmentId))
        .limit(1)
        .maybeSingle();

      if (error) return null;
      return data || null;
    },
    [attachmentId]
  );

  
  const fetchWarrantyLinkedSystemIds = useCallback(
    async (objectId) => {
      if (!objectId) return [];
      try {
        const { data, error } = await supabase
          .from("object_links")
          .select("system_id")
          .eq("object_id", objectId)
          .eq("asset_id", assetId)
          .limit(500);

        if (error) return [];
        return (data || []).map((r) => r.system_id).filter(Boolean);
      } catch {
        return [];
      }
    },
    [assetId]
  );

// Resolve the user's personal org (Org-of-1). Used for object creation/linking.
const resolveOrgId = useCallback(async () => {
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw new Error(uErr.message || "Could not resolve user");

  const userId = u?.user?.id;
  if (!userId) throw new Error("Missing user");

  // Prefer personal org
  const { data: personalOrg, error: personalErr } = await supabase
    .from("orgs")
    .select("id, org_type")
    .eq("owner_user_id", userId)
    .eq("org_type", "personal")
    .maybeSingle();

  if (personalErr) throw new Error(personalErr.message || "Could not resolve personal org");

  if (personalOrg?.id) {
    console.log("[ProofBuilder] resolveOrgId", {
      userId,
      orgId: personalOrg.id,
      orgType: personalOrg.org_type,
    });
    return personalOrg.id;
  }

  // Fallback to any owned org (team, etc.)
  const { data: fallbackOrg, error: fallbackErr } = await supabase
    .from("orgs")
    .select("id, org_type")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackErr) throw new Error(fallbackErr.message || "Could not resolve fallback org");

  console.log("[ProofBuilder] resolveOrgId", {
    userId,
    orgId: fallbackOrg?.id || null,
    orgType: fallbackOrg?.org_type || null,
  });

  return fallbackOrg?.id || null;
}, []);

  const hydrateFromDb = useCallback(async () => {
    if (!attachmentId) {
      setLoadError("Missing attachmentId");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");

    try {
      const { data: att, error: attErr } = await supabase
        .from("attachments")
        .select("*")
        .eq("id", attachmentId)
        .maybeSingle();

      if (attErr || !att) {
        setLoadError(attErr?.message || "Could not load attachment");
        setLoading(false);
        return;
      }

      setAttachment(att);

      // Try to extract warranty info from attachment metadata / OCR text
        const rawText =
          att?.ai_metadata?.ocr_text ||
          att?.ai_metadata?.extracted_text ||
          "";

        if (rawText && !warrantyObjectId) {
          const inferred = extractWarrantyDates(rawText);

          if (inferred.provider && !wProvider) setWProvider(inferred.provider);
          if (inferred.policy && !wPolicy) setWPolicy(inferred.policy);

          if (inferred.start && !wStarts) setWStarts(inferred.start);
          if (inferred.end && !wExpires) setWExpires(inferred.end);
        }

      // preview url
      setPreviewLoading(true);
      try {
        if (safeStr(att?.storage_path)) {
          const bucket = safeStr(att?.bucket) || PREVIEW_BUCKET_FALLBACK;
          const signed = await getSignedUrl({
          bucket,
          path: att.storage_path,
          expiresIn: 60 * 30,
        });
          setPdfUrl(signed || "");
        } else if (safeStr(att?.public_url)) {
          setPdfUrl(att.public_url);
        } else if (safeStr(att?.url)) {
          setPdfUrl(att.url);
        } else {
          setPdfUrl("");
        }
      } catch {
        setPdfUrl("");
      } finally {
        setPreviewLoading(false);
      }

      const pls = await fetchPlacements();
      setPlacements(pls);

      // Role hydration priority:
      // 1) attachment.ai_metadata.role
      // 2) placements.role (most frequent)
      // 3) default "proof"
      const savedRoleRaw =
        safeStr(att?.ai_metadata?.role) ||
        inferRoleFromPlacements(pls) ||
        "proof";

      const normalizedRole = savedRoleRaw.trim().toLowerCase() === "warranty" ? "Warranty" : savedRoleRaw;
      setRoleValue(normalizedRole);

      setTitle(safeStr(att?.title) || inferName(att));
      setNotes(safeStr(att?.notes));
      const savedPrivacy = safeStr(att?.ai_metadata?.privacy) || safeStr(att?.privacy) || "";
      setPrivacy(savedPrivacy === "owner_only" ? "owner_only" : "moves_with_asset");

      const sys = await fetchSystems();
      setSystems(sys);

      // Selected systems based on placements (system)
      const sysIdsFromPlacements = (pls || [])
        .filter((p) => p.target_type === "system" && p.target_id)
        .map((p) => p.target_id);

      // Org-of-1 (used later for warranty save/linking)
      const derivedOrgId = await resolveOrgId();
      setOrgId(derivedOrgId);

      // Warranty object hydration (only if warranty OR exists)
      const wObj = await loadWarrantyObject();

      // If a Warranty object exists, prefer its covered systems (object_links), and merge with placements.
      let finalSystemIds = Array.from(new Set(sysIdsFromPlacements));
      if (wObj?.id) {
        const linked = await fetchWarrantyLinkedSystemIds(wObj.id);
        finalSystemIds = Array.from(new Set([...(finalSystemIds || []), ...(linked || [])]));
      }
      setSelectedSystemIds(finalSystemIds);
      if (wObj) {
        setWarrantyObjectId(wObj.id);
        const d = wObj.data || {};
        setWProvider(safeStr(d.provider_name));
        setWPolicy(safeStr(d.policy_number || d.contract_number));
        // Store dates in US format for editing, save as ISO
setWStarts(isoToMDY(safeStr(d.start_date || d.effective_date)));
setWExpires(isoToMDY(safeStr(d.end_date || d.expiration_date)));
        setWCoverageNotes(safeStr(d.coverage_notes || d.notes));
        setWarrantySavedAt(wObj.updated_at ? String(wObj.updated_at) : "");
      } else {
        setWarrantyObjectId(null);
        setWProvider("");
        setWPolicy("");
        setWStarts("");
        setWExpires("");
        setWCoverageNotes("");
        setWarrantySavedAt("");
      }
    } catch (e) {
      setLoadError(e?.message || "Could not load proof builder");
    } finally {
      setLoading(false);
    }
  }, [attachmentId, fetchPlacements, fetchSystems, inferRoleFromPlacements, loadWarrantyObject, resolveOrgId]);

  useEffect(() => {
    hydrateFromDb();
  }, [hydrateFromDb]);

  // Re-hydrate when coming back to this screen so saves are reflected
  useEffect(() => {
    const unsub = navigation?.addListener?.("focus", () => {
      hydrateFromDb();
    });
    return unsub;
  }, [navigation, hydrateFromDb]);

  const toggleSystem = useCallback((systemId) => {
    setSelectedSystemIds((prev) => {
      const set = new Set(prev);
      if (set.has(systemId)) set.delete(systemId);
      else set.add(systemId);
      return Array.from(set);
    });
  }, []);

  const openEvidence = useCallback(async () => {
    const url = pdfUrl || safeStr(attachment?.url) || safeStr(attachment?.public_url);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Open", "Could not open this attachment.");
    }
  }, [pdfUrl, attachment]);

  const upsertAttachmentMeta = useCallback(
    async () => {
      const idToUse = attachmentId || attachment?.id;
      if (!idToUse) throw new Error("Missing attachment id");

      const aiMeta = {
        ...(attachment?.ai_metadata || {}),
        role: roleValue,
        privacy,
      };

      const { data, error } = await supabase
        .from("attachments")
        .update({
          title: title || inferName(attachment),
          notes: notes || "",
          ai_metadata: aiMeta,
        })
        .eq("id", idToUse)
        .select("id")
        .maybeSingle();

      if (error) throw new Error(error.message || "Failed to save attachment");
      if (!data?.id) throw new Error(`Attachment not found (id mismatch): ${idToUse}`);
    },
    [attachmentId, attachment, title, notes, roleValue, privacy]
  );

  const syncPlacements = useCallback(
    async () => {
      if (!attachmentId || !assetId) return;

      // Asset placement always exists
      const base = {
        attachment_id: attachmentId,
        target_type: "asset",
        target_id: assetId,
        role: roleValue || "proof",
      };

      const { error: upsertErr } = await supabase.from("attachment_placements").upsert(base, {
        onConflict: "attachment_id,target_type,target_id",
      });
      if (upsertErr) throw new Error(upsertErr.message || "Failed to save placement");

      // Sync system placements to match selectedSystemIds
      // Remove all existing system placements for this attachment, then insert selected.
      const { error: delErr } = await supabase
        .from("attachment_placements")
        .delete()
        .eq("attachment_id", attachmentId)
        .eq("target_type", "system");
      if (delErr) throw new Error(delErr.message || "Failed to update system links");

      if (selectedSystemIds.length > 0) {
        const rows = selectedSystemIds.map((sid) => ({
          attachment_id: attachmentId,
          target_type: "system",
          target_id: sid,
          role: roleValue || "proof",
        }));

        const { error: insErr } = await supabase.from("attachment_placements").insert(rows);
        if (insErr) throw new Error(insErr.message || "Failed to save system links");
      }
    },
    [attachmentId, assetId, roleValue, privacy, selectedSystemIds]
  );

  const upsertWarrantyObject = useCallback(
    async (orgId) => {
      if (!orgId) throw new Error("Missing org");
      if (!attachmentId) throw new Error("Missing attachment");

      const data = {
        attachment_id: attachmentId,
        provider_name: wProvider || "",
        policy_number: wPolicy || "",
        start_date: mdyToISO(wStarts) || "",
        end_date: mdyToISO(wExpires) || "",
        coverage_notes: wCoverageNotes || "",
      };

      if (warrantyObjectId) {
        const { data: updated, error } = await supabase
          .from("objects")
          .update({
            title: title || inferName(attachment),
            data,
            status: "active",
            source: "proof_builder",
          })
          .eq("id", warrantyObjectId)
          .select("id,updated_at")
          .single();

        if (error) throw new Error(error.message || "Failed to save warranty");
        setWarrantySavedAt(updated?.updated_at ? String(updated.updated_at) : "");
        return updated?.id;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("objects")
        .insert({
          org_id: orgId,
          object_type_key: "warranty",
          title: title || inferName(attachment),
          status: "active",
          source: "proof_builder",
          data,
        })
        .select("id,updated_at")
        .single();

      if (insErr) throw new Error(insErr.message || "Failed to create warranty");
      setWarrantyObjectId(inserted?.id);
      setWarrantySavedAt(inserted?.updated_at ? String(inserted.updated_at) : "");
      return inserted?.id;
    },
    [attachmentId, attachment, title, warrantyObjectId, wProvider, wPolicy, wStarts, wExpires, wCoverageNotes]
  );

  const showToast = useCallback((titleText, messageText) => {
    setSaveToast({ visible: true, title: titleText, message: messageText });
    setTimeout(() => setSaveToast({ visible: false, title: "", message: "" }), 1400);
  }, []);

  const quickAddSystem = useCallback(async () => {
    const name = safeStr(newSystemName).trim();
    if (!assetId) {
      Alert.alert("Add system", "Missing asset.");
      return;
    }
    if (!name) {
      Alert.alert("Add system", "Enter a system name.");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("systems")
        .insert({ asset_id: assetId, name })
        .select("id,name")
        .single();

      if (error) throw new Error(error.message || "Could not create system");
      setAddSystemOpen(false);
      setNewSystemName("");

      // Refresh systems list and auto-select the newly created system
      const sys = await fetchSystems();
      setSystems(sys);
      if (data?.id) {
        setSelectedSystemIds((prev) => Array.from(new Set([...(prev || []), data.id])));
      }
      showToast("System added", "Added and selected.");
    } catch (e) {
      Alert.alert("Add system failed", e?.message || "Could not add system.");
    }
  }, [assetId, fetchSystems, newSystemName, showToast]);

  const syncObjectLinks = useCallback(
    async (orgId, objectId) => {
      if (!orgId || !objectId) return;
      if (!assetId) return;

      // object_links requires system_id NOT NULL in your schema, so we only link selected systems.
      await supabase.from("object_links").delete().eq("object_id", objectId);

      if (selectedSystemIds.length === 0) return;

      const rows = selectedSystemIds.map((sid) => ({
        org_id: orgId,
        object_id: objectId,
        asset_id: assetId,
        system_id: sid,
      }));

      const { error } = await supabase.from("object_links").insert(rows);
      if (error) throw new Error(error.message || "Failed to link systems");
    },
    [assetId, selectedSystemIds]
  );

  const saveAll = useCallback(async () => {
    if (!attachment) return;
    const effectiveOrgId = orgId;
    console.log("[ProofBuilder] saveAll org check", {
  orgId,
  assetId,
  attachmentId,
  roleValue,
  isWarranty,
});
    if (!effectiveOrgId && isWarranty) {
      Alert.alert("Save", "Your account does not have a personal org record yet. Warranty objects require one.");
      return;
    }

    // If warranty, require at least one system (because object_links requires system_id)
    if (isWarranty && selectedSystemIds.length === 0) {
      Alert.alert("Warranty", "Select at least one system this warranty covers.");
      return;
    }

    setSaving(true);
    try {
      await upsertAttachmentMeta();
      await syncPlacements();

      if (isWarranty) {
        const objId = await upsertWarrantyObject(effectiveOrgId);
        await syncObjectLinks(effectiveOrgId, objId);
      }

      // Refresh everything so the next entry reflects saved state
      await hydrateFromDb();

      showToast("Saved", isWarranty ? "Warranty enabled." : "Attachment saved.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }, [
    attachment,
    orgId,
    hydrateFromDb,
    isWarranty,
    selectedSystemIds.length,
    showToast,
    syncObjectLinks,
    syncPlacements,
    upsertAttachmentMeta,
    upsertWarrantyObject,
  ]);

  const evidenceTitle = title || inferName(attachment);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.mutedText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 12 }]} onPress={hydrateFromDb}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Proof Builder</Text>
        </View>

        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>ASSET</Text>
            <Text style={styles.badgeValue}>{shortId(assetId)}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>ATTACHMENT</Text>
            <Text style={styles.badgeValue}>{shortId(attachmentId)}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Evidence */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Evidence</Text>
            <TouchableOpacity style={styles.iconBtn} onPress={openEvidence}>
              <Ionicons name="open-outline" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.evidenceName} numberOfLines={1}>
            {evidenceTitle}
          </Text>
          <Text style={styles.evidenceMeta} numberOfLines={1}>
            {isPdfLike(attachment) ? "PDF document" : isImageLike(attachment) ? "Image" : "Document"}
          </Text>

          <View style={styles.previewWrap}>
            {previewLoading ? (
              <View style={styles.previewCenter}>
                <ActivityIndicator />
              </View>
            ) : isImageLike(attachment) && pdfUrl ? (
              <Image source={{ uri: pdfUrl }} style={styles.previewImage} resizeMode="cover" />
            ) : isPdfLike(attachment) && pdfUrl && IS_WEB ? (
              // eslint-disable-next-line react/no-unknown-property
              <iframe title="pdf" src={pdfUrl} style={styles.webIframe} />
            ) : (
              <TouchableOpacity style={styles.previewFallback} onPress={openEvidence}>
                <Ionicons name="document-text-outline" size={22} color={colors.textMuted} />
                <Text style={styles.previewFallbackText}>Open attachment</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Meta */}
        <View style={styles.card}>
          <Text style={styles.metaTopLabel}>Attached to</Text>
          <Text style={styles.metaTopValue}>
            Asset • Systems ({selectedSystemIds.length}) • Records ({(placements || []).filter((p) => p.target_type === "record").length})
          </Text>

          <Text style={styles.fieldLabel}>Role</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setRoleModalOpen(true)}>
            <Ionicons name="pencil-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.selectBtnText}>{roleValue || "Choose role"}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Short summary…"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            style={[styles.input, { height: 92 }]}
          />

          <Text style={styles.fieldLabel}>Privacy</Text>
          <View style={styles.privacyRow}>
            <TouchableOpacity
              style={[styles.privacyBtn, privacy === "moves_with_asset" ? styles.privacyBtnActive : null]}
              onPress={() => setPrivacy("moves_with_asset")}
            >
              <Text style={[styles.privacyBtnText, privacy === "moves_with_asset" ? styles.privacyBtnTextActive : null]}>
                Moves with asset
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.privacyBtn, privacy === "owner_only" ? styles.privacyBtnActive : null]}
              onPress={() => setPrivacy("owner_only")}
            >
              <Text style={[styles.privacyBtnText, privacy === "owner_only" ? styles.privacyBtnTextActive : null]}>
                Owner only
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Warranty meta */}
        {isWarranty ? (
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Warranty</Text>
              {!!warrantySavedAt ? (
                <View style={styles.savedPill}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                  <Text style={styles.savedPillText}>Saved</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.helperText}>
              Turn this document into a first-class Warranty object, then apply it to the systems it covers.
            </Text>

            <Text style={styles.fieldLabel}>Provider</Text>
            <TextInput
              value={wProvider}
              onChangeText={setWProvider}
              placeholder="Provider (e.g., Assurant)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Policy #</Text>
            <TextInput
              value={wPolicy}
              onChangeText={setWPolicy}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <View style={{ flexDirection: isWide ? "row" : "column", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Start Date</Text>
                <KeeprDateField
                  value={mdyToISO(wStarts)}
                  onChange={(iso) => setWStarts(isoToMDY(iso))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Expiration Date</Text>
              <KeeprDateField
                value={mdyToISO(wExpires)}
                onChange={(iso) => setWExpires(isoToMDY(iso))}
              />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Coverage notes</Text>
            <TextInput
              value={wCoverageNotes}
              onChangeText={setWCoverageNotes}
              placeholder="Short summary…"
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              style={[styles.input, { height: 92 }]}
            />
          </View>
        ) : null}

        {/* Systems association */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Systems</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TouchableOpacity style={styles.smallBtn} onPress={() => setAddSystemOpen(true)}>
                <Ionicons name="add" size={16} color={colors.textPrimary} />
                <Text style={styles.smallBtnText}>Quick add</Text>
              </TouchableOpacity>
              <Text style={styles.sectionCounter}>{systems.length}</Text>
            </View>
          </View>

          <Text style={styles.helperText}>
            Select the systems this attachment should be associated with.
            {isWarranty ? " In Warranty mode, these also become the Warranty’s covered systems." : ""}
          </Text>

          {systemsLoading ? (
            <Text style={styles.mutedText}>Loading systems…</Text>
          ) : systems.length === 0 ? (
            <Text style={styles.mutedText}>No systems found for this asset.</Text>
          ) : (
            <View style={styles.systemList}>
              {systems.map((s) => {
                const selected = selectedSystemIds.includes(s.id);
                return (
                  <TouchableOpacity key={s.id} style={styles.systemRow} onPress={() => toggleSystem(s.id)}>
                    <Ionicons
                      name={selected ? "checkbox" : "square-outline"}
                      size={20}
                      color={selected ? colors.primary : colors.textMuted}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.systemName} numberOfLines={1}>
                        {safeStr(s.name) || "System"}
                      </Text>
                      <Text style={styles.systemMeta} numberOfLines={1}>
                        {selected ? "Selected" : "Not selected"}
                        {s.mode ? ` • Mode: ${s.mode}` : ""}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Sticky Save Bar */}
      <View style={styles.stickyBar}>
        <TouchableOpacity style={[styles.primaryBtn, saving ? { opacity: 0.75 } : null]} onPress={saveAll} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Save changes</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Save Toast */}
      <Modal visible={saveToast.visible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.toastBackdrop} pointerEvents="none">
          <View style={styles.toastCard}>
            <Text style={styles.toastTitle}>{saveToast.title}</Text>
            {!!saveToast.message ? <Text style={styles.toastMsg}>{saveToast.message}</Text> : null}
          </View>
        </View>
      </Modal>

      {/* Quick Add System */}
      <Modal visible={addSystemOpen} transparent animationType="fade" onRequestClose={() => setAddSystemOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddSystemOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add system</Text>
              <TouchableOpacity onPress={() => setAddSystemOpen(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>System name</Text>
            <TextInput
              value={newSystemName}
              onChangeText={setNewSystemName}
              placeholder="e.g., Engine, HVAC, Water heater"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoFocus
            />

            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 12 }]} onPress={quickAddSystem}>
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Add system</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Role Picker */}
      <Modal visible={roleModalOpen} transparent animationType="fade" onRequestClose={() => setRoleModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRoleModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose role</Text>
              <TouchableOpacity onPress={() => setRoleModalOpen(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 10 }}>
              {ROLE_GROUPS.map((g) => (
                <View key={g.group} style={{ marginBottom: 12 }}>
                  <Text style={styles.groupLabel}>{g.group}</Text>
                  {g.items.map((item) => (
                    <TouchableOpacity
                      key={`${g.group}-${item}`}
                      style={styles.roleRow}
                      onPress={() => {
                        setRoleValue(item);
                        setRoleModalOpen(false);
                      }}
                    >
                      <Text style={styles.roleRowText}>{item}</Text>
                      {String(roleValue || "") === item ? (
                        <Ionicons name="checkmark" size={18} color={colors.primary} />
                      ) : (
                        <View style={{ width: 18 }} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card || "#fff",
    opacity: 1,
  },
  title: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  badgeRow: { flexDirection: "row", gap: 8 },
  badge: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "flex-end",
  },
  badgeLabel: { fontSize: 10, fontWeight: "900", color: colors.textMuted, lineHeight: 12 },
  badgeValue: { fontSize: 12, fontWeight: "800", color: colors.textPrimary, lineHeight: 14 },

  scrollContent: { padding: spacing.md, paddingBottom: 140, gap: spacing.md },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  sectionCounter: { fontSize: 12, fontWeight: "900", color: colors.textMuted },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },

  evidenceName: { marginTop: spacing.sm, fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  evidenceMeta: { marginTop: 2, fontSize: 12, color: colors.textMuted },

  previewWrap: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    height: 260,
    backgroundColor: colors.bg,
  },
  previewCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  previewImage: { width: "100%", height: "100%" },
  webIframe: { width: "100%", height: "100%", borderWidth: 0 },
  previewFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  previewFallbackText: { fontSize: 12, fontWeight: "800", color: colors.textMuted },

  metaTopLabel: { fontSize: 11, fontWeight: "900", color: colors.textMuted },
  metaTopValue: { marginTop: 2, fontSize: 13, fontWeight: "800", color: colors.textPrimary },

  fieldLabel: { marginTop: spacing.sm, fontSize: 12, fontWeight: "900", color: colors.textMuted },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  selectBtn: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectBtnText: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.textPrimary },

  helperText: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted, lineHeight: 16 },

  privacyRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  privacyBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyBtnActive: { borderColor: colors.primary, backgroundColor: colors.card },
  privacyBtnText: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  privacyBtnTextActive: { color: colors.primary },

  systemList: { marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: "hidden" },
  systemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  systemName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  systemMeta: { marginTop: 2, fontSize: 12, color: colors.textMuted },

  stickyBar: {
    position: "absolute",
    zIndex: 50,
    elevation: 10,
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.md, gap: 10 },
  mutedText: { fontSize: 13, color: colors.textMuted },
  errorText: { fontSize: 13, color: colors.danger, fontWeight: "800" },

  savedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  savedPillText: { fontSize: 12, fontWeight: "900", color: colors.textPrimary },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: spacing.md,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: colors.card || "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  groupLabel: { fontSize: 12, fontWeight: "900", color: colors.textMuted, marginBottom: 6, marginLeft: 4 },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card || "#fff",
    borderRadius: radius.md,
    marginBottom: 8,
  },
  roleRowText: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },

  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  smallBtnText: { fontSize: 12, fontWeight: "900", color: colors.textPrimary },

  toastBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 96,
    backgroundColor: "transparent",
  },
  toastCard: {
    width: "92%",
    maxWidth: 520,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  toastTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  toastMsg: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.textMuted },
});
