// screens/EditTimelineRecordScreen.js
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import SmartLink from "../components/links/SmartLink";
import LinkifiedText from "../components/links/LinkifiedText";
import { normalizeUrl, openExternalUrl, tokenizeWithUrls } from "../components/links/linkUtils";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";
import { formatDateForInput } from "../lib/dateFormat";
import { useOperationFeedback } from "../context/OperationFeedbackContext";

import { getSignedUrl, listAttachmentsForTarget, removePlacementById } from "../lib/attachmentsApi";
import { createLinkAttachment, uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import KeeprDateField from "../components/KeeprDateField";
import AttachmentViewerModal from "../components/AttachmentViewerModal";
import {
  isKeeprProPickerMatch,
  loadMyKeeprProsForPicker,
  resolveOrCreateKpcForPicker,
} from "../lib/kpcApi";
import { formatMoneyInput, parseMoneyInput } from "../lib/money";

/* ---------------- helpers ---------------- */


function safeMoney(raw) {
  return parseMoneyInput(raw);
}

const COST_CATEGORIES = [
  "Electricity",
  "Gas",
  "Water",
  "Insurance",
  "Taxes",
  "Mortgage Interest",
  "HOA",
  "Maintenance",
  "Repairs",
  "Cleaning",
  "Supplies",
  "Other",
];

function getYearFromIsoDate(value) {
  if (!value) return new Date().getFullYear();
  const m = String(value).match(/^(\d{4})-/);
  if (m?.[1]) return Number(m[1]);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
}

function buildKeeprProLabel(row) {
  const name = row?.name || "";
  const location = row?.location || "";
  if (name && location) return `${name} · ${location}`;
  return name || location || "Keepr Pro";
}

async function safeGetUser() {
  try {
    const result = await supabase.auth.getUser();
    if (result?.error && result.error.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    return result; // { data: { user }, error }
  } catch (e) {
    if (e?.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    throw e;
  }
}


function systemLabel(row) {
  return row?.name || row?.title || row?.label || "System";
}

async function safeSelect(table, queryFn) {
  try {
    const q = queryFn(supabase.from(table).select("*"));
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}


async function loadSystemsForAsset(assetId) {
  if (!assetId) return [];

  // Try likely tables. First match wins.
  const tables = ["systems", "home_systems", "vehicle_systems", "boat_systems"];
  for (const t of tables) {
    const rows = await safeSelect(t, (q) =>
      q.eq("asset_id", assetId).order("name", { ascending: true })
    );
    if (rows?.length) {
      // normalize shape a bit
      return rows.map((r) => ({
        ...r,
        __table: t,
        __label: systemLabel(r),
      }));
    }
  }
  return [];
}

async function loadProof(recordId) {
  const rows = await listAttachmentsForTarget("service_record", recordId);
  return {
    photoRows: (rows || []).filter((r) => r.kind === "photo"),
    docRows: (rows || []).filter((r) => r.kind === "file"),
    linkRows: (rows || []).filter((r) => r.kind === "link"),
  };
}

/* ---------------- screen ---------------- */

export default function EditTimelineRecordScreen({ route, navigation }) {
  const recordId =
    route?.params?.recordId ||
    route?.params?.timelineRecordId ||
    route?.params?.serviceRecordId ||
    route?.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { runMutation, showError } = useOperationFeedback();
  // record fields
  const [assetId, setAssetId] = useState(null);
  const [serviceType, setServiceType] = useState("moment"); // moment | diy | pro | cost
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const [costCategory, setCostCategory] = useState(null);
  const [costMode, setCostMode] = useState("single");
  const [costYear, setCostYear] = useState(() => getYearFromIsoDate(date));
  const [costBreakdown, setCostBreakdown] = useState("");

  useEffect(() => {
  if (serviceType === "cost" && costMode === "annual") {
    setCostYear(getYearFromIsoDate(date));
  }
}, [date, serviceType, costMode]);

  // system + pro
  const [systems, setSystems] = useState([]);
  const [pros, setPros] = useState([]);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [selectedKeeprProId, setSelectedKeeprProId] = useState(null);
  const [selectedKeeprProLabel, setSelectedKeeprProLabel] = useState("");

  const [showSystemModal, setShowSystemModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

  const [showQuickSystemModal, setShowQuickSystemModal] = useState(false);
  const [quickSystemName, setQuickSystemName] = useState("");
  const [creatingQuickSystem, setCreatingQuickSystem] = useState(false);
  const [quickSystemError, setQuickSystemError] = useState(null);

  const [showQuickProModal, setShowQuickProModal] = useState(false);
  const [quickProName, setQuickProName] = useState("");
  const [creatingQuickPro, setCreatingQuickPro] = useState(false);

  // proof
  const [photoRows, setPhotoRows] = useState([]);
  const [docRows, setDocRows] = useState([]);
  const [linkRows, setLinkRows] = useState([]);
  const [recordAttachments, setRecordAttachments] = useState([]);

const attachmentCollection = useMemo(() => {
  return (recordAttachments || []).map((r) => {
    let resolvedUrl = r.url || null;

    // 🔥 KEY FIX: build URL if missing
    if (!resolvedUrl && r.storage_path && r.bucket) {
      try {
        const { data } = supabase.storage
          .from(r.bucket)
          .getPublicUrl(r.storage_path);

        resolvedUrl = data?.publicUrl || null;
      } catch (e) {
        console.log("EditTimelineRecord URL resolve error", e);
      }
    }

    return {
      id: r.id,
      title: r.title || r.file_name || "Attachment",
      url: resolvedUrl,
      contentType: r.mime_type || "",
      kind: r.kind,
      placement_id: r.placement_id,
      storage_path: r.storage_path,
      bucket: r.bucket,
    };
  });
}, [recordAttachments]);

const openViewer = (index) => {
  setViewer({ index });
};

const closeViewer = () => setViewer(null);

  const [loadingAttachments, setLoadingAttachments] = useState(false);

  const [addLinkModal, setAddLinkModal] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [viewer, setViewer] = useState(null);


  const selectedSystem = useMemo(
    () => (selectedSystemId ? systems.find((s) => s.id === selectedSystemId) : null),
    [selectedSystemId, systems]
  );

  const selectedPro = useMemo(
    () =>
      selectedKeeprProId
        ? pros.find((p) => isKeeprProPickerMatch(p, selectedKeeprProId))
        : null,
    [selectedKeeprProId, pros]
  );


const notesHasUrls = useMemo(() => {
  try {
    const tokens = tokenizeWithUrls(notes || "");
    return (tokens || []).some((t) => t.type === "url");
  } catch {
    return false;
  }
}, [notes]);

  const back = () => {
    try {
      if (navigation?.canGoBack?.()) return navigation.goBack();
    } catch {}
    try {
      navigation.navigate("Dashboard");
    } catch {
      Alert.alert("Navigation", "No back route available.");
    }
  };

  const refreshProof = useCallback(async () => {
    if (!recordId) return;
    const proof = await loadProof(recordId);
    setPhotoRows(proof.photoRows);
    setDocRows(proof.docRows);
    setLinkRows(proof.linkRows);
  }, [recordId]);

const loadRecordAttachments = useCallback(async () => {
  if (!recordId) return;

  setLoadingAttachments(true);
  try {
    const rows = await listAttachmentsForTarget("service_record", recordId);
    setRecordAttachments(rows || []);
  } catch (e) {
    console.error("Load attachments failed", e);
    setRecordAttachments([]);
  } finally {
    setLoadingAttachments(false);
  }
}, [recordId]);


  const openAttachmentsHub = () => {
    if (!assetId) {
      Alert.alert("Missing asset", "This record isn’t linked to an asset.");
      return;
    }
    if (!recordId) {
      Alert.alert("Missing record", "Save this record before attaching proof.");
      return;
    }

    navigation.navigate("AssetAttachments", {
      assetId,
      // optional; AssetAttachmentsScreen will default "Asset" if not provided
      assetName: route?.params?.assetName || "Asset",
      targetType: "service_record",
      targetId: recordId,
      targetRole: "proof",
    });
  };

  const openAttachment = useCallback(async (row) => {
    if (!row) return;
    if (row.kind === "link") {
      return openExternalUrl(row.url);
    }
    const path = row.storage_path;
    if (!path) {
      Alert.alert("Missing file", "This attachment does not have a storage path yet.");
      return;
    }
    try {
      const signed = await getSignedUrl({ bucket: row.bucket || "asset-files", path });
      if (!signed) throw new Error("Could not create signed URL");
      openExternalUrl(signed);
    } catch (e) {
      console.error(e);
      Alert.alert("Open failed", e?.message || "Could not open this attachment.");
    }
  }, []);

  useEffect(() => {
    if (!recordId) {
      setLoading(false);
      return;
    }

    let isActive = true;

    (async () => {
      setLoading(true);

      // load record (service_records is the backbone for now)
      let rec = null;
      try {
        const { data, error } = await supabase
          .from("service_records")
          .select("*")
          .eq("id", recordId)
          .maybeSingle();
        if (!error) rec = data;
      } catch {}

      if (!isActive) return;

      if (!rec) {
        setLoading(false);
        return;
      }

      setAssetId(rec.asset_id || null);

      const st = rec.service_type || "moment";
      setServiceType(
        st === "diy" ? "diy" :
        st === "pro" ? "pro" :
        st === "cost" ? "cost" :
        "moment"
      );
      setDate(rec.performed_at || "");
      setTitle(rec.title || "");
      setProvider(rec.provider || rec.vendor || rec.keepr_pro_name || ""); // FIX: don’t set provider from location
      setLocation(rec.location || "");
      setCost(rec.cost != null ? String(rec.cost) : "");
      setNotes(rec.notes || "");
      setSelectedSystemId(rec.system_id || null);
      setSelectedKeeprProId(rec.keepr_pro_id || null);

      const meta = rec.extra_metadata || {};

        if (st === "cost") {
          setServiceType("cost");
          setCostCategory(meta.category || null);
          setCostMode(meta.mode || "single");
          setCostYear(meta.year || getYearFromIsoDate(rec.performed_at));
          setCostBreakdown(meta.breakdown || "");
        }


      // systems for asset (best-effort)
      const sys = await loadSystemsForAsset(rec.asset_id);
      if (isActive) setSystems(sys);

      // pros
      let pr = [];
      try {
        pr = await loadMyKeeprProsForPicker();
      } catch {
        pr = await safeSelect("service_providers", (q) =>
          q.select("id, name, location").order("name", { ascending: true })
        );
      }
      if (isActive) {
        setPros(pr);
        if (rec.keepr_pro_id) {
          const match = pr.find((p) => isKeeprProPickerMatch(p, rec.keepr_pro_id));
          if (match) setSelectedKeeprProLabel(match.label || buildKeeprProLabel(match));
        }
      }


      // proof
      const proof = await loadProof(recordId);
      if (isActive) {
        setPhotoRows(proof.photoRows);
        setDocRows(proof.docRows);
        setLinkRows(proof.linkRows);
      }

      await loadRecordAttachments();

      if (isActive) {
        setLoading(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [recordId, loadRecordAttachments]);

  const handleSelectSystem = (id) => {
    setSelectedSystemId(id === selectedSystemId ? null : id);
  };

  const openQuickAddSystem = () => {
    setQuickSystemName("");
    setQuickSystemError(null);
    setShowQuickSystemModal(true);
  };

const removeAttachment = useCallback(async (placementId) => {
  if (!placementId) {
    Alert.alert("Error", "Missing placement id.");
    return;
  }

  try {
    await removePlacementById(placementId);
    await loadRecordAttachments();
    await refreshProof();
  } catch (e) {
    Alert.alert("Error", "Could not remove attachment.");
  }
}, [loadRecordAttachments, refreshProof]);

  const handleCreateQuickSystem = async () => {
    const name = (quickSystemName || "").trim();
    if (!name) {
      if (Platform.OS === "web") setQuickSystemError("Enter a system name.");
      else Alert.alert("Name required", "Enter a system name.");
      return;
    }

    try {
      if (creatingQuickSystem) return;
      setCreatingQuickSystem(true);

      function normalizeAttachments(rows) {
      return (rows || []).map((r) => ({
        id: r.id,
        title: r.title || r.file_name || "Attachment",
        url: r.url || null,
        contentType: r.mime_type || "",
        kind: r.kind,
        placement_id: r.placement_id,
        storage_path: r.storage_path,
        bucket: r.bucket,
      }));
    }

    const openViewer = (index) => {
      setViewer({ index });
    };

    const closeViewer = () => setViewer(null);

      // Prefer the canonical systems table; use a safe placeholder KSC code

const payload = {
        asset_id: assetId,
        name,
        ksc_code: "custom",
        source_type: "manual",
        status: "ok",
        lifecycle_status: "active",
      };

      const { data, error } = await supabase
        .from("systems")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      

      // Refresh system list and select the new one
      const sys = await loadSystemsForAsset(assetId);
      setSystems(sys);
      if (data?.id) setSelectedSystemId(data.id);

      setShowQuickSystemModal(false);
      setShowSystemModal(false);
    } catch (e) {
      console.error("Quick add system error:", e);
      const msg = String(e?.message || "");
      if (msg.includes("plan_limit_systems_per_asset")) {
        const friendly =
          "Starter allows up to 5 systems per asset. Upgrade to add more systems.";
        if (Platform.OS === "web") setQuickSystemError(friendly);
        else showError(friendly);
      } else {
        const friendly = msg || "Couldn’t add system";
        if (Platform.OS === "web") setQuickSystemError(friendly);
        else showError(friendly);
      }
    } finally {
      setCreatingQuickSystem(false);
    }
  };


  const handleSelectPro = (pro) => {
    if (!pro) {
      setSelectedKeeprProId(null);
      setSelectedKeeprProLabel("");
      return;
    }
    setSelectedKeeprProId(pro.id);
    setSelectedKeeprProLabel(buildKeeprProLabel(pro));
  };

  const openQuickAddPro = () => {
    setQuickProName("");
    setShowQuickProModal(true);
  };

  const handleCreateQuickPro = async () => {
    const name = (quickProName || "").trim();
    if (!name) {
      Alert.alert("Name required", "Enter a name for this Keepr Pro.");
      return;
    }

    try {
      if (creatingQuickPro) return;
      setCreatingQuickPro(true);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;

      if (!user) {
        Alert.alert("Sign in required", "Please sign in to add a Keepr Pro.");
        setCreatingQuickPro(false);
        return;
      }

      const newPro = await resolveOrCreateKpcForPicker({
        user_id: user.id,
        name,
        display_name: name,
        category: "other",
        is_favorite: false,
        source: "manual_quick",
      });
      setPros((prev) => {
        const next = [...(prev || [])];
        // If DB returned, use it; else keep minimal.
        if (newPro?.id && next.some((p) => p.id === newPro.id)) return next;
        next.push(newPro);
        next.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
        return next;
      });

      if (newPro?.id) {
        handleSelectPro(newPro);
      } else {
        // fall back: do not select if id missing
        setSelectedKeeprProLabel(name);
      }

      setShowQuickProModal(false);
      // Keep the pro picker open so user sees it selected; or close both for speed.
      setShowProModal(false);
    } catch (e) {
      console.error("Quick add Keepr Pro error:", e);
      showError(e?.message || "Couldn’t add Keepr Pro");
    } finally {
      setCreatingQuickPro(false);
    }
  };


   const pickPhoto = () => {
    openAttachmentsHub();
  };

  const pickFile = () => {
    openAttachmentsHub();
  };

  const saveLink = async () => {
    const url = String(newLinkUrl || "").trim();
    const title = String(newLinkTitle || "").trim() || "Link";
    if (!url) {
      Alert.alert("Add link", "Please enter a URL.");
      return;
    }

    let userId = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id || null;
    } catch {}
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in again and try.");
      return;
    }

    const placements = [
      { target_type: "service_record", target_id: recordId, role: "proof" },
      { target_type: "asset", target_id: assetId, role: "proof" },
      ...(selectedSystemId
        ? [{ target_type: "system", target_id: selectedSystemId, role: "proof" }]
        : []),
    ];

    const sourceContext = {
      screen: "EditTimelineRecordScreen",
      source_type: "service_record",
      source_id: recordId,
      asset_id: assetId,
      system_id: selectedSystemId || null,
    };

    const res = await runMutation({
      busyMessage: "Saving…",
      success: "Link added",
      error: "Couldn’t add link",
      action: async () => {
        await createLinkAttachment({
          userId,
          assetId,
          url,
          title,
          sourceContext,
          placements,
        });
        return true;
      },
    });

    if (!res?.ok) return;

    setNewLinkTitle("");
    setNewLinkUrl("");
    setAddLinkModal(false);
    await refreshProof();
  };

    const removeAttachmentRow = async (row) => {
    Alert.alert(
      "Remove from this record?",
      "This removes it from this record’s proof. It should not delete the original file if it’s shared elsewhere.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!row?.placement_id) {
              showError("Couldn’t remove proof (missing placement).");
              return;
            }

            const res = await runMutation({
              busyMessage: "Removing…",
              success: "Removed",
              error: "Couldn’t remove proof",
              action: async () => {
                // remove the placement only (do NOT delete the attachment)
                await removePlacementById(row.placement_id);
                return true;
              },
            });

            if (res?.ok) {
              await refreshProof();
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    Keyboard.dismiss();
    if (saving || !recordId) return;

    const dateIso = date;
    if (!dateIso) {
      showError("Please select a date.");
      return;
    }

let finalDate = dateIso;
let finalTitle = title?.trim();

if (serviceType === "cost") {
  finalDate =
    costMode === "annual"
      ? `${costYear}-12-31`
      : dateIso;

  finalTitle =
    finalTitle ||
    (costMode === "annual"
      ? `${costCategory} — Annual Rollup`
      : `${costCategory}`);
}

    const payload = {
      title: finalTitle || null,
      notes: notes?.trim() || null,
      service_type: serviceType === "moment" ? "moment" : serviceType,
      performed_at: finalDate,
      location: location?.trim() || null,
      provider: provider?.trim?.() || null,
      cost: safeMoney(cost),
      system_id: selectedSystemId || null,
      keepr_pro_id: selectedKeeprProId || null,

      // 🔥 THIS is what you were missing
      extra_metadata:
        serviceType === "cost"
          ? {
              category: costCategory,
              mode: costMode,
              year: costYear,
              breakdown: costBreakdown || null,
            }
          : {},
    };

    setSaving(true);
    try {
      const res = await runMutation({
        busyMessage: "Saving…",
        success: "Saved",
        error: "Couldn’t save changes",
        action: async () => {
          // provider column may not exist in some schemas. Try with provider first, then fallback.
          let { error } = await supabase.from("service_records").update(payload).eq("id", recordId);

          if (error && String(error.message || "").toLowerCase().includes("provider")) {
            const fallback = { ...payload };
            delete fallback.provider;
            const res2 = await supabase.from("service_records").update(fallback).eq("id", recordId);
            error = res2.error;
          }

          if (error) throw error;
          return true;
        },
      });

      if (res?.ok) {
        // After save, go back to the record view (keeps your existing flow consistent)
        try {
          navigation.navigate("TimelineRecord", {
            recordId,
            timelineRecordId: recordId,
            serviceRecordId: recordId,
          });
        } catch {
          back();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!recordId) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.missingTitle}>Missing record</Text>
          <TouchableOpacity style={styles.backBtn} onPress={back}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={64}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.iconButton} onPress={back}>
              <Ionicons name="chevron-back-outline" size={20} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Edit Timeline Record</Text>
              <Text style={styles.headerSubtitle}>Make it official, then upload proof.</Text>
            </View>

            <TouchableOpacity
              style={[styles.headerSaveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-outline" size={18} color="#fff" />
                  <Text style={styles.headerSaveText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
          >
            {/* Basics */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Basics</Text>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "moment" && styles.toggleActivePrimary]}
                  onPress={() => setServiceType("moment")}
                >
                  <Ionicons
                    name={serviceType === "moment" ? "sparkles" : "sparkles-outline"}
                    size={14}
                    color={serviceType === "moment" ? colors.brandWhite : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "moment" && styles.toggleTextActive]}>
                    Moment
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "diy" && styles.toggleActiveSoft]}
                  onPress={() => setServiceType("diy")}
                >
                  <Ionicons
                    name={serviceType === "diy" ? "construct" : "construct-outline"}
                    size={14}
                    color={serviceType === "diy" ? colors.accentBlue : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "diy" && styles.toggleTextSoftActive]}>
                    DIY
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "pro" && styles.toggleActivePrimary]}
                  onPress={() => setServiceType("pro")}
                >
                  <Ionicons
                    name={serviceType === "pro" ? "briefcase" : "briefcase-outline"}
                    size={14}
                    color={serviceType === "pro" ? colors.brandWhite : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "pro" && styles.toggleTextActive]}>
                    Pro
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                style={[styles.togglePill, serviceType === "cost" && styles.toggleActivePrimary]}
                onPress={() => setServiceType("cost")}
              >
                <Ionicons
                  name={serviceType === "cost" ? "cash" : "cash-outline"}
                  size={14}
                  color={serviceType === "cost" ? colors.brandWhite : colors.textMuted}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.toggleText, serviceType === "cost" && styles.toggleTextActive]}>
                  Expense
                </Text>
              </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1.5 }}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Painted the exterior"
                    value={title}
                    onChangeText={setTitle}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                  {!(serviceType === "cost" && costMode === "annual") ? (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Date</Text>
                      <KeeprDateField
                        value={date}
                        onChange={setDate}
                      />
                    </View>
                  ) : (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Recorded Date</Text>
                      <View style={styles.input}>
                        <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: "700" }}>
                          {`${costYear}-12-31`}
                        </Text>
                      </View>
                    </View>
                  )}
              </View>
             {serviceType === "cost" && (
              <>
                <Text style={styles.label}>Category</Text>

                <View style={styles.chipWrap}>
                  {COST_CATEGORIES.map((c) => {
                    const selected = costCategory === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setCostCategory(c)}
                        style={[styles.chip, selected && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                          {c}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Mode toggle */}
                <View style={styles.row}>
                  <TouchableOpacity
                    style={[styles.togglePill, costMode === "single" && styles.toggleActiveSoft]}
                    onPress={() => setCostMode("single")}
                  >
                    <Text style={[styles.toggleText, costMode === "single" && styles.toggleTextSoftActive]}>
                      Single
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.togglePill, costMode === "annual" && styles.toggleActivePrimary]}
                    onPress={() => {
                      setCostMode("annual");
                      setCostYear(getYearFromIsoDate(date));
                    }}
                  >
                    <Text style={[styles.toggleText, costMode === "annual" && styles.toggleTextActive]}>
                      Annual
                    </Text>
                  </TouchableOpacity>
                </View>

                {costMode === "annual" && (
                  <>
                    <Text style={styles.label}>Year</Text>
                    <TextInput
                      style={styles.input}
                      value={String(costYear)}
                      onChangeText={(t) => setCostYear(Number(t))}
                    />

                    <Text style={styles.label}>Breakdown</Text>
                    <TextInput
                      style={[styles.input, { minHeight: 100 }]}
                      value={costBreakdown}
                      onChangeText={setCostBreakdown}
                      multiline
                    />
                  </>
                )}
              </>
            )}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Cost</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="$0"
                    value={cost}
                    onChangeText={setCost}
                    onBlur={() => setCost(formatMoneyInput(cost))}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="default"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Location</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Optional"
                    value={location}
                    onChangeText={setLocation}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>
            </View>
            {/* Context */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Context</Text>
              <Text style={styles.helper}>
                Write it like you’re explaining it to a future buyer (or future you).
              </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Tell the story… paint colors, products, prep notes, leftover buckets, where they’re stored…"
                value={notes}
                onChangeText={setNotes}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
            
            {notesHasUrls ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.linkPreviewLabel}>Links detected in notes</Text>
                <LinkifiedText
                  text={notes}
                  style={styles.linkPreviewText}
                  linkStyle={styles.linkPreviewLink}
                  selectable
                />
              </View>
            ) : null}
              </View>
            {/* Associations */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Associations</Text>

              <Text style={styles.label}>System (optional)</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setShowSystemModal(true)}>
                <Text style={selectedSystem ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                  {selectedSystem ? (selectedSystem.__label || systemLabel(selectedSystem)) : "Choose a system"}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickAddRow}
                onPress={openQuickAddSystem}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                <Text style={styles.quickAddText}>Quick add System</Text>
              </TouchableOpacity>


              <View style={{ height: spacing.md }} />

              <Text style={styles.label}>Keepr Pro (optional)</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setShowProModal(true)}>
                <Text style={selectedPro ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                  {selectedPro ? (selectedKeeprProLabel || buildKeeprProLabel(selectedPro)) : "Link a provider"}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>

              <View style={{ height: spacing.md }} />
            </View>

            {/* Current Proof Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current Proof</Text>

              {loadingAttachments ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineLoadingText}>Loading proof…</Text>
                </View>
              ) : recordAttachments.length === 0 ? (
                <Text style={styles.helper}>No proof attached yet.</Text>
              ) : (
                recordAttachments.map((row) => (
                  <View key={row.id || row.placement_id} style={styles.pendingAttachmentRow}>
                    
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
                      onPress={() => {
                      const index = attachmentCollection.findIndex(
                        (a) =>
                          (a.placement_id && row.placement_id && a.placement_id === row.placement_id) ||
                          (a.id && row.attachment_id && a.id === row.attachment_id) ||
                          (a.id && row.id && a.id === row.id)
                      );
                      if (index >= 0) openViewer(index);
                    }}
                    >
                      <Ionicons name="document-outline" size={18} color={colors.textSecondary} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.pendingAttachmentTitle} numberOfLines={1}>
                          {row.title || row.file_name || "Document"}
                        </Text>
                        <Text style={styles.pendingAttachmentMeta} numberOfLines={1}>
                          {row.mime_type || row.kind || "Attachment"}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => removeAttachment(row.placement_id || row.id)}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))
              )}

              <TouchableOpacity
                style={[styles.quickAddRow, { marginTop: spacing.sm, marginBottom: 0 }]}
                onPress={openAttachmentsHub}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                <Text style={styles.quickAddText}>Add proof</Text>
              </TouchableOpacity>
            </View>
          
            {/* Proof */}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* System modal */}
      <Modal visible={showSystemModal} animationType="slide" transparent onRequestClose={() => setShowSystemModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a system</Text>
              <TouchableOpacity onPress={() => setShowSystemModal(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[styles.modalOption, !selectedSystemId && styles.modalOptionSelected]}
                onPress={() => setSelectedSystemId(null)}
              >
                <Text style={styles.modalOptionText}>Whole asset</Text>
                {!selectedSystemId ? <Ionicons name="checkmark-circle" size={20} color={colors.brandBlue} /> : null}
              </TouchableOpacity>

              
              <TouchableOpacity
                style={styles.quickAddRow}
                onPress={openQuickAddSystem}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                <Text style={styles.quickAddText}>Quick add System</Text>
              </TouchableOpacity>

{systems.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.modalOption, selectedSystemId === s.id && styles.modalOptionSelected]}
                  onPress={() => handleSelectSystem(s.id)}
                >
                  <Text style={styles.modalOptionText}>{s.__label || systemLabel(s)}</Text>
                  {selectedSystemId === s.id ? <Ionicons name="checkmark-circle" size={20} color={colors.brandBlue} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSecondary]} onPress={() => setShowSystemModal(false)}>
                <Text style={styles.modalSecondaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pro modal */}
      <Modal visible={showProModal} animationType="slide" transparent onRequestClose={() => setShowProModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link a provider</Text>
              <TouchableOpacity onPress={() => setShowProModal(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[styles.modalOption, !selectedKeeprProId && styles.modalOptionSelected]}
                onPress={() => handleSelectPro(null)}
              >
                <Text style={styles.modalOptionText}>Not linked</Text>
                {!selectedKeeprProId ? <Ionicons name="checkmark-circle" size={20} color={colors.brandBlue} /> : null}
              </TouchableOpacity>

              
                  <TouchableOpacity
                    style={styles.quickAddRow}
                    onPress={openQuickAddPro}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                    <Text style={styles.quickAddText}>Quick add Keepr Pro</Text>
                  </TouchableOpacity>

{pros.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.modalOption,
                    isKeeprProPickerMatch(p, selectedKeeprProId) && styles.modalOptionSelected,
                  ]}
                  onPress={() => handleSelectPro(p)}
                >
                  <Text style={styles.modalOptionText}>{buildKeeprProLabel(p)}</Text>
                  {isKeeprProPickerMatch(p, selectedKeeprProId) ? <Ionicons name="checkmark-circle" size={20} color={colors.brandBlue} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSecondary]} onPress={() => setShowProModal(false)}>
                <Text style={styles.modalSecondaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
          <Modal
            visible={showQuickProModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowQuickProModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.quickAddCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Quick add Keepr Pro</Text>
                  <TouchableOpacity
                    onPress={() => setShowQuickProModal(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.quickAddHint}>
                  Name only for now — you can enrich the full profile later.
                </Text>

                <TextInput
                  style={styles.quickAddInput}
                  value={quickProName}
                  onChangeText={setQuickProName}
                  placeholder="Name or company"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />

                <View style={styles.quickAddButtonsRow}>
                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnSecondary]}
                    onPress={() => setShowQuickProModal(false)}
                    disabled={creatingQuickPro}
                  >
                    <Text style={styles.quickAddBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnPrimary]}
                    onPress={handleCreateQuickPro}
                    disabled={creatingQuickPro}
                  >
                    <Text style={styles.quickAddBtnPrimaryText}>
                      {creatingQuickPro ? "Adding..." : "Add"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={showQuickSystemModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowQuickSystemModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.quickAddCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Quick add System</Text>
                  <TouchableOpacity
                    onPress={() => setShowQuickSystemModal(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.quickAddHint}>
                  Name only for now — you can enrich details later.
                </Text>

                <TextInput
                  style={styles.quickAddInput}
                  value={quickSystemName}
                  onChangeText={(t) => {
                    setQuickSystemName(t);
                    if (quickSystemError) setQuickSystemError(null);
                  }}
                  placeholder="System name"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />

                {!!quickSystemError && (
                  <View style={styles.inlineErrorBox}>
                    <Text style={styles.inlineErrorText}>{quickSystemError}</Text>
                  </View>
                )}

                <View style={styles.quickAddButtonsRow}>
                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnSecondary]}
                    onPress={() => setShowQuickSystemModal(false)}
                    disabled={creatingQuickSystem}
                  >
                    <Text style={styles.quickAddBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnPrimary]}
                    onPress={handleCreateQuickSystem}
                    disabled={creatingQuickSystem}
                  >
                    <Text style={styles.quickAddBtnPrimaryText}>
                      {creatingQuickSystem ? "Adding..." : "Add"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

      {/* Add link modal */}
      <Modal visible={addLinkModal} animationType="slide" transparent onRequestClose={() => setAddLinkModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add a link</Text>
              <TouchableOpacity onPress={() => setAddLinkModal(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ gap: spacing.sm }}>
              <TextInput
                style={styles.input}
                placeholder="Title (optional)"
                value={newLinkTitle}
                onChangeText={setNewLinkTitle}
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={styles.input}
                placeholder="https://..."
                value={newLinkUrl}
                onChangeText={setNewLinkUrl}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />
              <Text style={styles.helper}>
                Links are proof too: manuals, OEM pages, YouTube how-to’s, portal receipts, etc.
              </Text>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSecondary]} onPress={() => setAddLinkModal(false)}>
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalPrimary]} onPress={saveLink}>
                <Text style={styles.modalPrimaryText}>Add link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <AttachmentViewerModal
        visible={!!viewer}
        attachment={attachmentCollection[viewer?.index || 0]}
        collection={attachmentCollection}
        index={viewer?.index || 0}
        onIndexChange={(next) =>
          setViewer((v) => (v ? { ...v, index: next } : v))
        }
        onClose={closeViewer}
        onDelete={async () => {
          const current = attachmentCollection[viewer?.index || 0];
          if (!current?.placement_id) return;

          await removePlacementById(current.placement_id);
          await loadRecordAttachments();
          await refreshProof();
          closeViewer();
        }}
        assetId={assetId}
        systemId={selectedSystemId}
        recordId={recordId}
      />

    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, fontWeight: "700" },
  missingTitle: { marginTop: spacing.sm, fontSize: 16, fontWeight: "900", color: colors.textPrimary },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary, fontWeight: "700" },

  headerSaveBtn: {
    marginLeft: spacing.sm,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.accentBlue,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  headerSaveText: { color: "#fff", fontWeight: "900", fontSize: 13 },

  backBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accentBlue,
  },
  backBtnText: { color: "#fff", fontWeight: "900" },

  chipWrap: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
  marginTop: spacing.sm,
},

chip: {
  borderRadius: radius.pill,
  borderWidth: 1,
  borderColor: colors.chipBorder,
  backgroundColor: colors.surfaceSubtle,
  paddingHorizontal: spacing.md,
  paddingVertical: 7,
},

chipActive: {
  backgroundColor: colors.accentBlue,
  borderColor: colors.accentBlue,
},

chipText: {
  fontSize: 12,
  color: colors.textSecondary,
  fontWeight: "800",
},

chipTextActive: {
  color: colors.brandWhite,
},

  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.lg,
    ...(shadows?.sm || {}),
  },
  cardTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },

  label: { fontSize: 12, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.md, fontWeight: "700" },
  helper: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted, fontWeight: "700" },

  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    fontSize: 13,
    color: colors.textPrimary,
  },
  multiline: { minHeight: 140 },

  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },

  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  toggleActivePrimary: { backgroundColor: colors.accentBlue, borderColor: colors.accentBlue },
  toggleActiveSoft: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  toggleText: { fontSize: 12, color: colors.textSecondary, fontWeight: "800" },
  toggleTextActive: { color: colors.brandWhite },
  toggleTextSoftActive: { color: colors.accentBlue },

  selector: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  selectorText: { fontSize: 13, color: colors.textPrimary, fontWeight: "800" },
  selectorPlaceholder: { fontSize: 13, color: colors.textMuted, fontWeight: "800" },

  proofHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  proofActions: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", justifyContent: "flex-end" },
  proofBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  proofBtnText: { marginLeft: 8, fontSize: 12, fontWeight: "800", color: colors.textPrimary },

  subhead: { marginTop: spacing.md, fontSize: 12, fontWeight: "900", color: colors.textSecondary, letterSpacing: 0.4 },
  emptyText: { marginTop: spacing.xs, fontSize: 12, color: colors.textMuted, fontWeight: "700" },

  attachRow: {
    marginTop: spacing.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  attachLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  attachText: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, flex: 1 },
  attachRight: { flexDirection: "row", alignItems: "center", gap: 12 },

  errorText: { marginTop: spacing.sm, color: colors.accentRed, fontSize: 13 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: "80%",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { flex: 1, fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },

  modalOption: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalOptionSelected: { backgroundColor: colors.surfaceSubtle },
  modalOptionText: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },

  modalFooter: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  modalPrimary: { backgroundColor: colors.accentBlue },
  modalSecondary: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle },
  modalPrimaryText: { color: colors.brandWhite, fontWeight: "900" },
  modalSecondaryText: { color: colors.textPrimary, fontWeight: "900" },
  quickAddRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 10,
  },
  quickAddText: {
    marginLeft: 8,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  quickAddCard: {
    width: "92%",
    maxWidth: 460,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...(shadows?.sm || {}),
  },
  quickAddHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 18,
  },
  quickAddInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  inlineErrorBox: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  inlineErrorText: {
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 16,
    fontWeight: "700",
  },
  inlineLoading: {
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: 8,
},

inlineLoadingText: {
  marginLeft: 8,
  fontSize: 12,
  color: colors.textMuted,
  fontWeight: "700",
},

pendingAttachmentRow: {
  marginTop: spacing.sm,
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 12,
  paddingVertical: 12,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surfaceSubtle,
},

pendingAttachmentTitle: {
  fontSize: 14,
  fontWeight: "800",
  color: colors.textPrimary,
},

pendingAttachmentMeta: {
  marginTop: 2,
  fontSize: 12,
  color: colors.textMuted,
  fontWeight: "700",
},
  quickAddButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  quickAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  quickAddBtnSecondary: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  quickAddBtnSecondaryText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  quickAddBtnPrimary: {
    marginLeft: 8,
    backgroundColor: colors.brandBlue,
  },
  quickAddBtnPrimaryText: {
    color: colors.brandWhite,
    fontSize: 12,
    fontWeight: "900",
  },

});
