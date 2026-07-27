// screens/AddTimelineRecordScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
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
import * as Clipboard from "expo-clipboard";

import LinkifiedText from "../components/links/LinkifiedText";
import { tokenizeWithUrls } from "../components/links/linkUtils";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";
import { Linking } from "react-native";
import RenderHTML from "react-native-render-html";
import { useWindowDimensions } from "react-native";
import AttachmentViewerModal from "../components/AttachmentViewerModal";
import { formatMoneyInput, parseMoneyInput } from "../lib/money";

/* ---------------- helpers ---------------- */
async function openContactUrl(url, fallbackMessage) {
  if (!url) return;
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Can’t open", fallbackMessage || "Your device can’t open this action.");
      return;
    }
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert("Can’t open", e?.message || fallbackMessage || "Please try again.");
  }
}

async function copyContact(source) {
  const value = [source?.name, source?.email, source?.phone]
    .filter(Boolean)
    .join(" • ");
  if (!value) return;
  await Clipboard.setStringAsync(value);
}

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

function getTodayISO() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

  const tables = ["systems", "home_systems", "vehicle_systems", "boat_systems"];
  for (const t of tables) {
    const rows = await safeSelect(t, (q) =>
      q.eq("asset_id", assetId).order("name", { ascending: true })
    );
    if (rows?.length) {
      return rows.map((r) => ({
        ...r,
        __table: t,
        __label: systemLabel(r),
      }));
    }
  }
  return [];
}

async function loadRecordAttachments(recordId) {
  if (!recordId) return;

  setLoadingAttachments(true);

  try {
    const { data, error } = await supabase
      .from("attachment_placements")
      .select(`
        id,
        attachment:attachments (
          id,
          file_name,
          mime_type,
          file_url
        )
      `)
      .eq("target_type", "service_record")
      .eq("target_id", recordId);

    if (error) throw error;

    setRecordAttachments(data || []);
  } catch (e) {
    console.error("Load attachments failed", e);
  } finally {
    setLoadingAttachments(false);
  }
}

/* ---------------- screen ---------------- */

export default function AddTimelineRecordScreen({ route, navigation }) {
const {
  assetId,
  assetName,
  systemId: initialSystemId,
  systemName,
  backTo,
  origin,

  // EVENT + PB handoff
  eventId,
  source,
  prefillTitle,
  prefillNotes,
  prefillDate,
  prefillAmount,
  prefillAssetId,
  prefillSystemId,
  existingAttachments = [],
  pendingAttachmentId,
  pendingAttachmentTitle,
  originalEmailHtml,
  originalEmailText,
  originalEmailSubject,
  originalEmailFrom,
  publicActionContext,
} = route?.params || {};

const { width } = useWindowDimensions();

  // Origin-aware navigation: callers can pass { backTo: {name, params} } or { origin: {name, params} }
  const resolvedBackTo = useMemo(() => {
    if (backTo?.name) return backTo;
    if (origin?.name) return origin;
    return null;
  }, [backTo, origin]);

const [serviceType, setServiceType] = useState("moment");

const [selectedAssetId, setSelectedAssetId] = useState(
  () => prefillAssetId || assetId || null
);

const effectiveAssetId = selectedAssetId || prefillAssetId || assetId || null;

const [date, setDate] = useState(() => prefillDate || getTodayISO());
const [cost, setCost] = useState(() => prefillAmount || "");
    const [selectedSystemId, setSelectedSystemId] = useState(
      () => prefillSystemId || initialSystemId || null
    );

  const [title, setTitle] = useState(() => prefillTitle || "");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");

  const [notes, setNotes] = useState(() => prefillNotes || "");

  const [systems, setSystems] = useState([]);
  const [pros, setPros] = useState([]);
  
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

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [loadingLookups, setLoadingLookups] = useState(true);

  const [recordAttachments, setRecordAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [costCategory, setCostCategory] = useState("Electricity");
  const [costMode, setCostMode] = useState("annual"); // annual | single
  const [costYear, setCostYear] = useState(new Date().getFullYear());
  const [costBreakdown, setCostBreakdown] = useState("");
  const [backfillRows, setBackfillRows] = useState([]);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assets, setAssets] = useState([]);
  const [viewerVisible, setViewerVisible] = useState(false);
const [viewerAttachment, setViewerAttachment] = useState(null);

  const addBackfillRow = () => {
  setBackfillRows((prev) => [
    ...prev,
    {
      year: String(Number(costYear || new Date().getFullYear()) - (prev.length + 1)),
      amount: "",
      breakdown: "",
    },
  ]);
};


const updateBackfillBreakdown = (idx, value) => {
  setBackfillRows((prev) =>
    prev.map((row, i) => (i === idx ? { ...row, breakdown: value } : row))
  );
};

const updateBackfillYear = (idx, value) => {
  setBackfillRows((prev) =>
    prev.map((row, i) => (i === idx ? { ...row, year: value } : row))
  );
};

const updateBackfillAmount = (idx, value) => {
  setBackfillRows((prev) =>
    prev.map((row, i) => (i === idx ? { ...row, amount: value } : row))
  );
};

const removeBackfillRow = (idx) => {
  setBackfillRows((prev) => prev.filter((_, i) => i !== idx));
};

  // Web-only: persist in-progress draft so tab switches / refresh don't lose work
  const draftKey = useMemo(() => {
    if (Platform.OS !== "web") return null;
    if (!effectiveAssetId) return null;
    return `keepr.draft.timeline.add.${effectiveAssetId}`;
  }, [effectiveAssetId]);

  const clearDraft = useMemo(() => {
    if (!draftKey) return () => {};
    return () => {
      try {
        window?.sessionStorage?.removeItem(draftKey);
      } catch {}
    };
  }, [draftKey]);

  // Restore any saved draft once
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = window?.sessionStorage?.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);

      if (d.serviceType != null) setServiceType(d.serviceType);
      if (d.date != null) setDate(d.date);
      if (!prefillTitle && d.title != null) setTitle(d.title);
      if (d.provider != null) setProvider(d.provider);
      if (d.location != null) setLocation(d.location);
      if (d.cost != null) setCost(d.cost);
      if (!prefillNotes && d.notes != null) setNotes(d.notes);

      if (d.selectedSystemId !== undefined) setSelectedSystemId(d.selectedSystemId || null);
      if (d.selectedKeeprProId !== undefined) setSelectedKeeprProId(d.selectedKeeprProId || null);
      if (d.selectedKeeprProLabel !== undefined) setSelectedKeeprProLabel(d.selectedKeeprProLabel || "");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Persist draft as the user types (web only)
  useEffect(() => {
    if (!draftKey) return;
    try {
      const draft = {
        serviceType,
        date,
        title,
        provider,
        location,
        cost,
        notes,
        selectedSystemId,
        selectedKeeprProId,
        selectedKeeprProLabel,
      };
      window?.sessionStorage?.setItem(draftKey, JSON.stringify(draft));
    } catch {}
  }, [
    draftKey,
    serviceType,
    date,
    title,
    provider,
    location,
    cost,
    notes,
    selectedSystemId,
    selectedKeeprProId,
    selectedKeeprProLabel,
  ]);

  useEffect(() => {
    if (!draftKey) return;
    if (!pendingAttachmentId) return;

    try {
      window?.sessionStorage?.removeItem(draftKey);
    } catch {}
  }, [draftKey, pendingAttachmentId]);

  const contextLabel = useMemo(() => {
    if (assetName && systemName) return `${assetName} · ${systemName}`;
    if (assetName) return assetName;
    if (systemName) return systemName;
    return "Asset";
  }, [assetName, systemName]);

  const publicActionSource = useMemo(() => {
    if (!publicActionContext?.isPublic) return null;
    return {
      name: publicActionContext.name || null,
      email: publicActionContext.email || null,
      phone: publicActionContext.phone || null,
      actionType: publicActionContext.actionType || publicActionContext.type || null,
      message: publicActionContext.message || null,
      assetName: publicActionContext.assetName || assetName || null,
      sourceUrl: publicActionContext.sourceUrl || null,
      kac: publicActionContext.kac || null,
    };
  }, [assetName, publicActionContext]);

  const selectedSystem = useMemo(
    () => (selectedSystemId ? systems.find((s) => s.id === selectedSystemId) : null),
    [selectedSystemId, systems]
  );
  const allAttachments = useMemo(() => {
    return [
      ...(existingAttachments || []),
      ...(pendingAttachmentId
        ? [
            {
              id: pendingAttachmentId,
              file_name: pendingAttachmentTitle || "Document",
              mime_type: "file",
              isPending: true,
            },
          ]
        : []),
    ];
  }, [existingAttachments, pendingAttachmentId, pendingAttachmentTitle]);
  
const visibleAttachments = useMemo(() => {
  return allAttachments.filter((a) => a.mime_type !== "text/html");
}, [allAttachments]);

const notesHasUrls = useMemo(() => {
  try {
    const tokens = tokenizeWithUrls(notes || "");
    return (tokens || []).some((t) => t.type === "url");
  } catch {
    return false;
  }
}, [notes]);

  const selectedPro = useMemo(
    () => (selectedKeeprProId ? pros.find((p) => p.id === selectedKeeprProId) : null),
    [selectedKeeprProId, pros]
  );

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

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {

        const assetRows = await safeSelect("assets", (q) =>
          q
            .is("deleted_at", null)   // 🔑 only non-deleted
            .order("name", { ascending: true })
        );

        if (isActive) setAssets(assetRows ?? []);

        if (!effectiveAssetId) {
          setSystems([]);
        } else {
          const sys = await loadSystemsForAsset(effectiveAssetId);
          if (isActive) setSystems(sys);
        }

        const cleanAssets = (assetRows || []).filter(
          (a) => a?.status === "active" && !a?.name?.toLowerCase().includes("test")
        );

        setAssets(cleanAssets);

        // Keepr Pros (same model as EditTimelineRecordScreen)
        let rows = await safeSelect("keepr_pros", (q) =>
          q.select("id, name, location").order("name", { ascending: true })
        );

        // Fallback for older naming
        if (!rows || rows.length === 0) {
          rows = await safeSelect("service_providers", (q) =>
            q.select("id, name, location").order("name", { ascending: true })
          );
        }

        if (isActive) setPros(rows || []);
      } finally {
        if (isActive) setLoadingLookups(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [selectedAssetId]);

  const handleSelectSystem = (id) => {
    setSelectedSystemId(id === selectedSystemId ? null : id);
  };

  const openQuickAddSystem = () => {
    setQuickSystemName("");
    setQuickSystemError(null);
    setShowQuickSystemModal(true);
  };

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

      // Prefer the canonical systems table; use a safe placeholder KSC code

      const payload = {
        asset_id: effectiveAssetId,
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
      const sys = await loadSystemsForAsset(effectiveAssetId);
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
        else Alert.alert("Plan limit reached", friendly);
      } else {
        const friendly = msg || "Please try again.";
        if (Platform.OS === "web") setQuickSystemError(friendly);
        else Alert.alert("Could not add system", friendly);
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

      const payload = {
        user_id: user.id,
        name,
        category: "other",
        is_favorite: false,
        source: "manual_quick",
      };

      const { data, error } = await supabase
        .from("keepr_pros")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      const newPro = data || { id: null, name };
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
      Alert.alert("Could not add Keepr Pro", e?.message || "Please try again.");
    } finally {
      setCreatingQuickPro(false);
    }
  };
    const removeAttachment = async (placementId) => {
  try {
    await supabase
      .from("attachment_placements")
      .delete()
      .eq("id", placementId);

    setRecordAttachments((prev) =>
      prev.filter((p) => p.id !== placementId)
    );
  } catch (e) {
    Alert.alert("Error", "Could not remove attachment.");
  }
};


const promoteEventAttachmentsToRecord = async (recordId) => {
  if (
    !recordId ||
    !effectiveAssetId ||
    !Array.isArray(existingAttachments) ||
    existingAttachments.length === 0
  ) {
    return;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("Could not get current user", userError);
    return;
  }

  const userId = user?.id;

  if (!userId) {
    console.error("No signed-in user found for attachment promotion");
    return;
  }

  for (const a of existingAttachments) {
    try {
      const { data: insertedAttachment, error: insertAttachmentError } =
        await supabase
          .from("attachments")
          .insert({
            owner_user_id: userId,
            asset_id: effectiveAssetId,
            kind: String(a?.mime_type || "").startsWith("image/")
              ? "photo"
              : "file",
            bucket: a?.storage_bucket || "asset-files",
            storage_path: a?.storage_path,
            url: a?.public_url || null,
            file_name: a?.file_name || "Attachment",
            mime_type: a?.mime_type || null,
            title: a?.file_name || "Attachment",
          })
          .select("id")
          .single();

      if (insertAttachmentError) throw insertAttachmentError;
      if (!insertedAttachment?.id) continue;

      const { error: placementError } = await supabase
        .from("attachment_placements")
        .insert({
          attachment_id: insertedAttachment.id,
          target_type: "service_record",
          target_id: recordId,
          role: "proof",
        });

      if (placementError) throw placementError;
    } catch (e) {
      console.error("PROMOTE ERROR:", e, a);
    }
  }
};

const cleanupSourceEvent = async () => {
  if (!eventId) return;

  try {
    await supabase
      .from("event_inbox_attachments")
      .delete()
      .eq("event_id", eventId);

    await supabase
      .from("event_inbox")
      .delete()
      .eq("id", eventId);
  } catch (e) {
    console.error("Cleanup source event failed:", e);
  }
};

const isFromInbox = route?.params?.eventId;

const handleDiscardToInbox = () => {
  navigation.replace("Notifications");
};

const handleSave = async () => {
  Keyboard.dismiss();
  if (saving) return;

  setSaving(true);
  setSubmitError(null);

if (!effectiveAssetId) {
  setSubmitError("Select an asset to continue.");
  setShowAssetPicker(true);
  setSaving(false);
  return;
}

  let finalDate = date;
  let finalTitle = title?.trim();

  if (serviceType === "cost") {
    finalDate = costMode === "annual" ? `${costYear}-12-31` : date;

    finalTitle =
      finalTitle ||
      (costMode === "annual"
        ? `${costCategory} — Annual Rollup`
        : `${costCategory}`);
  }

  if (!finalDate) {
    setSubmitError("Please select a date.");
    setSaving(false);
    return;
  }

  const payload = {
    asset_id: effectiveAssetId,
    title: finalTitle || "Record",
    notes: notes?.trim() || null,
    service_type: serviceType,
    performed_at: finalDate,
    location: location?.trim?.() || null,
    provider: provider?.trim?.() || null,
    cost: safeMoney(cost),
    system_id: selectedSystemId || null,
    keepr_pro_id: selectedKeeprProId || null,
    source_type: "manual",
    verification_status: "verified",
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

const deleteInboxAttachment = async (attachmentId) => {
  try {
    await supabase
      .from("event_inbox_attachments")
      .delete()
      .eq("id", attachmentId);

    setViewerVisible(false);

    Alert.alert("Removed", "Attachment removed.");

  } catch (e) {
    console.error(e);
    Alert.alert("Error", "Could not remove.");
  }
};

  const payloads = [payload];

  if (serviceType === "cost" && costMode === "annual") {
    backfillRows.forEach((row) => {
      const year = Number(row.year);
      const amount = safeMoney(row.amount);

      if (!year || amount == null) return;
      if (year === Number(costYear)) return;

      payloads.push({
        ...payload,
        title: `${costCategory} — Annual Rollup`,
        performed_at: `${year}-12-31`,
        cost: amount,
        extra_metadata: {
          ...payload.extra_metadata,
          year,
          breakdown: row.breakdown || null,
          is_backfill: true,
        },
      });
    });
  }

  let recordId = null;

  try {
    let { data, error } = await supabase
      .from("service_records")
      .insert(payloads)
      .select("*");

    if (
      error &&
      String(error.message || "").toLowerCase().includes("provider")
    ) {
      const fallbackPayloads = payloads.map((p) => {
        const next = { ...p };
        delete next.provider;
        return next;
      });

      const res2 = await supabase
        .from("service_records")
        .insert(fallbackPayloads)
        .select("*");

      error = res2.error;
      data = res2.data;
    }

    if (error) throw error;

    recordId = data?.[0]?.id;


    if (recordId && pendingAttachmentId) {
      const { error: placementError } = await supabase
        .from("attachment_placements")
        .insert({
          attachment_id: pendingAttachmentId,
          target_type: "service_record",
          target_id: recordId,
          role: "proof",
        });

      if (
        placementError &&
        placementError.code !== "23505" &&
        !String(placementError.message || "")
          .toLowerCase()
          .includes("duplicate key")
      ) {
        throw placementError;
      }
    }
  } catch (e) {
    console.error("Create timeline record error:", e);
    setSubmitError(e?.message || "Could not save this record.");
    setSaving(false);
    return;
  }

  if (existingAttachments.length > 0) {
    try {
      await promoteEventAttachmentsToRecord(recordId);
    } catch (e) {
      console.error("Attachment promotion failed:", e);
    }
  }

  if (eventId) {
    try {
      await cleanupSourceEvent();
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  }

  clearDraft();
  setSaving(false);

  navigation.replace("TimelineRecord", {
    recordId,
    timelineRecordId: recordId,
    serviceRecordId: recordId,
    mode: "add_proof",
  });
};

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
          <Text style={styles.headerTitle}>Add Timeline Record</Text>
          <Text style={styles.headerSubtitle}>{contextLabel}</Text>

          {isFromInbox ? (
            <TouchableOpacity
              onPress={handleDiscardToInbox}
              style={styles.headerSecondaryBtn}
            >
              <Text style={styles.headerSecondaryText}>Back to Inbox</Text>
            </TouchableOpacity>
          ) : null}
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
              <Text style={styles.headerSaveText}>Create</Text>
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
        {publicActionSource ? (
          <View style={styles.sourceContextCard}>
            <View style={styles.sourceContextIcon}>
              <Ionicons name="globe-outline" size={18} color={colors.textPrimary} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.sourceContextKicker}>Public request</Text>
              <Text style={styles.sourceContextTitle} numberOfLines={1}>
                {publicActionSource.assetName || contextLabel}
              </Text>
              <Text style={styles.sourceContextText}>
                From {publicActionSource.name || "Unknown"}
                {publicActionSource.email ? ` <${publicActionSource.email}>` : ""}
              </Text>
              {publicActionSource.phone ? (
                <Text style={styles.sourceContextText}>
                  Phone: {publicActionSource.phone}
                </Text>
              ) : null}

              <View style={styles.sourceActionRow}>
                {publicActionSource.email ? (
                  <TouchableOpacity
                    style={styles.sourceActionChip}
                    activeOpacity={0.85}
                    onPress={() =>
                      openContactUrl(
                        `mailto:${publicActionSource.email}`,
                        publicActionSource.email
                      )
                    }
                  >
                    <Ionicons name="mail-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.sourceActionText}>Email</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.sourceActionChip}
                  activeOpacity={0.85}
                  onPress={async () => {
                    try {
                      await copyContact(publicActionSource);
                      Alert.alert("Copied", "Requester contact copied.");
                    } catch {
                      Alert.alert("Copy failed", "Could not copy contact.");
                    }
                  }}
                >
                  <Ionicons name="copy-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.sourceActionText}>Copy contact</Text>
                </TouchableOpacity>
              </View>

              {publicActionSource.phone ? (
                <View style={styles.sourceActionRow}>
                  <TouchableOpacity
                    style={styles.sourceActionChip}
                    activeOpacity={0.85}
                    onPress={() =>
                      openContactUrl(
                        `sms:${publicActionSource.phone}`,
                        publicActionSource.phone
                      )
                    }
                  >
                    <Ionicons name="chatbubble-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.sourceActionText}>Text</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.sourceActionChip}
                    activeOpacity={0.85}
                    onPress={() =>
                      openContactUrl(
                        `tel:${publicActionSource.phone}`,
                        publicActionSource.phone
                      )
                    }
                  >
                    <Ionicons name="call-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.sourceActionText}>Call</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {publicActionSource.sourceUrl ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL(publicActionSource.sourceUrl)}
                >
                  <Text style={styles.sourceContextLink} numberOfLines={1}>
                    Open public source
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

{originalEmailHtml ? (
  <View style={styles.emailProofCard}>
    <View style={styles.emailProofHeaderRow}>
      <View>
        <Text style={styles.emailProofTitle}>Original Email</Text>
      </View>
    </View>

    {Platform.OS === "web" ? (
      <iframe
        title="Original Email"
        srcDoc={originalEmailHtml}
        style={{
          width: "100%",
          height: 720,
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          background: "#fff",
        }}
      />
    ) : (
      <Text selectable style={styles.emailProofText}>
          {originalEmailText || "Original email captured."}
            </Text>
          )}

          {/* 🔥 ATTACHMENTS LIVE HERE NOW */}
          {allAttachments.length > 0 && (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.emailAttachmentLabel}>
                Attachments
              </Text>
            </View>
          )}
        </View>
      ) : null}
        {visibleAttachments.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Email Proof Package</Text>
            <Text style={styles.helper}>
              Original email and attachments that will be saved with this record.
            </Text>

            {visibleAttachments.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={styles.pendingAttachmentRow}
                activeOpacity={0.85}
                onPress={async () => {
                try {
                  let url = a?.public_url;

                  if (!url && a?.storage_path) {
                    const { data } = await supabase.storage
                      .from(a.storage_bucket || "asset-files")
                      .createSignedUrl(a.storage_path, 60 * 5);

                    url = data?.signedUrl;
                  }

                  if (!url) return;

                  setViewerAttachment({
                  id: a.id,
                  url,
                  fileName: a.file_name || "Attachment.pdf",
                  file_name: a.file_name || "Attachment.pdf",
                  title: a.file_name || "Attachment",
                  contentType: a.mime_type || "application/pdf",
                  mimeType: a.mime_type || "application/pdf",
                  mime_type: a.mime_type || "application/pdf",
                  storage: {
                    bucket: a.storage_bucket || "asset-files",
                    path: a.storage_path,
                  },
                });
                  setViewerVisible(true);
                } catch (e) {
                  console.error("Viewer open failed", e);
                }
              }}
              >
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={colors.textSecondary}
                />

                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.pendingAttachmentTitle} numberOfLines={1}>
                    {a.file_name || "Attachment"}
                  </Text>
                  <Text style={styles.pendingAttachmentMeta} numberOfLines={1}>
                    {a.mime_type === "text/html"
                      ? "Original email proof"
                      : a.isPending
                        ? "Ready to attach"
                        : `${a.mime_type || "file"} · attached proof`}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
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
                style={[styles.togglePill, serviceType === "cost" && styles.toggleActiveSoft]}
                onPress={() => setServiceType("cost")}
              >
                <Ionicons
                  name={serviceType === "cost" ? "cash" : "cash-outline"}
                  size={14}
                  color={serviceType === "cost" ? colors.accentBlue : colors.textMuted}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.toggleText, serviceType === "cost" && styles.toggleTextSoftActive]}>
                  Expense
                </Text>
              </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1.5 }}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Winterized, upgrade, perfect day on the water…"
                    value={title}
                    onChangeText={setTitle}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                {!(serviceType === "cost" && costMode === "annual") && (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Date</Text>
                    <KeeprDateField
                      value={date}
                      onChange={setDate}
                    />
                  </View>
                )}
              </View>

              {serviceType === "cost" && (
                <>
                  <Text style={styles.label}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {COST_CATEGORIES.map((c) => {
                        const selected = costCategory === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            onPress={() => setCostCategory(c)}
                            style={[
                              styles.togglePill,
                              selected && styles.toggleActiveSoft,
                            ]}
                          >
                            <Text
                              style={[
                                styles.toggleText,
                                selected && styles.toggleTextSoftActive,
                              ]}
                            >
                              {c}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>

                  <Text style={styles.label}>Amount</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="$0"
                    value={cost}
                    onChangeText={setCost}
                    onBlur={() => setCost(formatMoneyInput(cost))}
                    keyboardType="default"
                  />

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    <TouchableOpacity
                      style={[styles.togglePill, costMode === "single" && styles.toggleActiveSoft]}
                      onPress={() => setCostMode("single")}
                    >
                      <Text style={styles.toggleText}>Single</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.togglePill, costMode === "annual" && styles.toggleActiveSoft]}
                      onPress={() => setCostMode("annual")}
                    >
                      <Text style={styles.toggleText}>Annual</Text>
                    </TouchableOpacity>
                  </View>

                  {costMode === "annual" && (
                    <>
                      <Text style={styles.label}>Annual rollup</Text>

                      <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <TextInput
                            style={styles.input}
                            value={String(costYear)}
                            onChangeText={(t) => setCostYear(Number(t))}
                            placeholder="Year"
                            keyboardType="number-pad"
                          />
                        </View>

                        <View style={{ flex: 1 }}>
                          <TextInput
                            style={styles.input}
                            value={cost}
                            onChangeText={setCost}
                            onBlur={() => setCost(formatMoneyInput(cost))}
                            placeholder="$0"
                            keyboardType="default"
                          />
                          <TextInput
                            style={[styles.input, { minHeight: 90, marginTop: 8 }]}
                            value={costBreakdown}
                            onChangeText={setCostBreakdown}
                            placeholder={`Paste breakdown for ${costYear} (optional)`}
                            multiline
                            textAlignVertical="top"
                          />
                        </View>
                      </View>

                      <Text style={styles.label}>Backfill previous years</Text>
                      {backfillRows.map((row, idx) => (
                        <View key={`${row.year}-${idx}`} style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <TextInput
                              style={styles.input}
                              value={String(row.year)}
                              onChangeText={(t) => updateBackfillYear(idx, t)}
                              placeholder="Year"
                              keyboardType="number-pad"
                            />
                          </View>

                          <View style={{ flex: 1 }}>
                            <TextInput
                              style={styles.input}
                              value={row.amount}
                              onChangeText={(t) => updateBackfillAmount(idx, t)}
                              onBlur={() => updateBackfillAmount(idx, formatMoneyInput(row.amount))}
                              placeholder="$0"
                              keyboardType="default"
                            />
                            <TextInput
                              style={[styles.input, { minHeight: 90, marginTop: 8 }]}
                              value={row.breakdown}
                              onChangeText={(t) => updateBackfillBreakdown(idx, t)}
                              placeholder="Paste breakdown for this year (optional)"
                              multiline
                              textAlignVertical="top"
                            />
                          </View>

                          <TouchableOpacity onPress={() => removeBackfillRow(idx)}>
                            <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity onPress={addBackfillRow} style={styles.quickAddRow}>
                        <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                        <Text style={styles.quickAddText}>Add previous year</Text>
                      </TouchableOpacity>
                    
                    </>
                  )}
                </>
              )}
              
                {serviceType !== "cost" && (
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
                )}     
            </View>
            <View style={styles.card}>
                  <Text style={styles.cardTitle}>Context</Text>
                  <Text style={styles.helper}>
                    Write it like you’re explaining it to a future buyer (or future you).
                  </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Tell the story… products used, prep notes, part numbers, where things are stored…"
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
              {loadingLookups ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineLoadingText}>Loading systems…</Text>
                </View>
              ) : (
                <View>
                  <TouchableOpacity
                    style={styles.selector}
                    onPress={() => setShowAssetPicker(true)}
                  >
                    <Text style={selectedAssetId ? styles.selectorText : styles.selectorPlaceholder}>
                      {selectedAssetId
                        ? assets.find(a => a.id === selectedAssetId)?.name
                        : "Select asset (required)"}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.selector} onPress={() => setShowSystemModal(true)}>
                  <Text style={selectedSystem ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                    {selectedSystem ? (selectedSystem.__label || systemLabel(selectedSystem)) : "Whole asset"}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>

                  <View style={{ height: 8 }} />

                  <TouchableOpacity
                    style={styles.quickAddRow}
                    onPress={openQuickAddSystem}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                    <Text style={styles.quickAddText}>Quick add System</Text>
                  </TouchableOpacity>
                </View>
              )
              }

              <View style={{ height: spacing.md }} />

              <Text style={styles.label}>Keepr Pro (optional)</Text>
              {loadingLookups ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineLoadingText}>Loading Keepr Pros…</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.selector} onPress={() => setShowProModal(true)}>
                  <Text style={selectedPro ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                    {selectedPro ? (selectedKeeprProLabel || buildKeeprProLabel(selectedPro)) : "Not linked"}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}

              <View style={{ height: spacing.md }} />
            </View>

          </ScrollView>

          {/* Asset picker */}
          <Modal
            visible={showAssetPicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowAssetPicker(false)}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setShowAssetPicker(false)}
            >
              <TouchableOpacity
                activeOpacity={1}
                style={styles.modalCardCentered}
                onPress={() => {}}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Select Asset</Text>

                  <TouchableOpacity
                    onPress={() => setShowAssetPicker(false)}
                    style={styles.modalCloseBtn}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator>
                  {assets.map((a) => {
                    const isSelected = selectedAssetId === a.id;

                    return (
                      <TouchableOpacity
                        key={a.id}
                        style={[
                          styles.modalOptionRow,
                          isSelected && styles.modalOptionRowActive,
                        ]}
                        onPress={() => {
                          setSelectedAssetId(a.id);
                          setSelectedSystemId(null); // critical: reset system
                          setShowAssetPicker(false);
                        }}
                      >
                        <Text
                          style={
                            isSelected
                              ? styles.modalOptionTextActive
                              : styles.modalOptionText
                          }
                        >
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

                    {/* System picker */}
          <Modal
            visible={showSystemModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowSystemModal(false)}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setShowSystemModal(false)}
            >
              <TouchableOpacity
                activeOpacity={1}
                style={styles.modalCardCentered}
                onPress={() => {}}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Link to a system</Text>
                  <TouchableOpacity
                    onPress={() => setShowSystemModal(false)}
                    style={styles.modalCloseBtn}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator>
                  <TouchableOpacity
                    style={[
                      styles.modalOptionRow,
                      selectedSystemId == null && styles.modalOptionRowActive,
                    ]}
                    onPress={() => {
                      handleSelectSystem(null);
                      setShowSystemModal(false);
                    }}
                  >
                    <Text
                      style={
                        selectedSystemId == null
                          ? styles.modalOptionTextActive
                          : styles.modalOptionText
                      }
                    >
                      Whole asset
                    </Text>
                  </TouchableOpacity>

                  {systems.map((sys) => {
                    const isSelected = selectedSystemId === sys.id;

                    return (
                      <TouchableOpacity
                        key={sys.id}
                        style={[
                          styles.modalOptionRow,
                          isSelected && styles.modalOptionRowActive,
                        ]}
                        onPress={() => {
                          handleSelectSystem(sys.id);
                          setShowSystemModal(false);
                        }}
                      >
                        <Text
                          style={
                            isSelected
                              ? styles.modalOptionTextActive
                              : styles.modalOptionText
                          }
                          numberOfLines={1}
                        >
                          {sys.__label || systemLabel(sys)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          {/* Keepr Pro picker */}
          <Modal
            visible={showProModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowProModal(false)}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setShowProModal(false)}
            >
              <TouchableOpacity
                activeOpacity={1}
                style={styles.modalCardCentered}
                onPress={() => {}}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Link a Keepr Pro</Text>
                  <TouchableOpacity
                    onPress={() => setShowProModal(false)}
                    style={styles.modalCloseBtn}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator>
                  <TouchableOpacity
                    style={[
                      styles.modalOptionRow,
                      !selectedKeeprProId && styles.modalOptionRowActive,
                    ]}
                    onPress={() => {
                      handleSelectPro(null);
                      setShowProModal(false);
                    }}
                  >
                    <Text
                      style={
                        !selectedKeeprProId
                          ? styles.modalOptionTextActive
                          : styles.modalOptionText
                      }
                    >
                      Not linked
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.quickAddRow}
                    onPress={openQuickAddPro}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={16}
                      color={colors.brandBlue}
                    />
                    <Text style={styles.quickAddText}>Quick add Keepr Pro</Text>
                  </TouchableOpacity>

                  {pros.map((pro) => {
                    const isSelected = selectedKeeprProId === pro.id;

                    return (
                      <TouchableOpacity
                        key={pro.id}
                        style={[
                          styles.modalOptionRow,
                          isSelected && styles.modalOptionRowActive,
                        ]}
                        onPress={() => {
                          handleSelectPro(pro);
                          setShowProModal(false);
                        }}
                      >
                        <Text
                          style={
                            isSelected
                              ? styles.modalOptionTextActive
                              : styles.modalOptionText
                          }
                          numberOfLines={1}
                        >
                          {buildKeeprProLabel(pro)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
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
          <AttachmentViewerModal
            visible={viewerVisible}
            attachment={viewerAttachment}
            onClose={() => setViewerVisible(false)}
            onDelete={() => deleteInboxAttachment(viewerAttachment?.id)}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

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

  emailProofHeaderRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: spacing.md,
},

emailProofSubtext: {
  marginTop: 3,
  fontSize: 12,
  color: colors.textSecondary,
  fontWeight: "700",
},

emailProofToggle: {
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surfaceSubtle,
},

emailProofToggleActive: {
  backgroundColor: colors.accentBlue,
  borderColor: colors.accentBlue,
},

emailProofToggleText: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textSecondary,
},

emailProofToggleTextActive: {
  color: "#fff",
},

  emailProofCard: {
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  borderRadius: radius.xl,
  padding: spacing.lg,
  marginBottom: spacing.lg,
},

emailProofText: {
  fontSize: 12,
  lineHeight: 18,
  color: colors.textPrimary,
},

emailProofTitle: {
  fontSize: 15,
  fontWeight: "900",
  color: colors.textPrimary,
  marginBottom: spacing.md,
},

emailPaper: {
  width: 760,
  alignSelf: "center",
  backgroundColor: "#fff",
  padding: spacing.lg,
},

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
  multiline: { minHeight: 240 },

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

  inlineLoading: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  inlineLoadingText: { marginLeft: spacing.sm, fontSize: 12, color: colors.textSecondary },

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

  errorText: { marginTop: spacing.sm, color: colors.accentRed, fontSize: 13 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxHeight: "70%",
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...(shadows?.lg || {}),
  },

modalOverlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.4)",
  justifyContent: "center",
  alignItems: "center",
},

modalCardCentered: {
  width: "90%",
  maxWidth: 420,
  maxHeight: "70%",
  borderRadius: radius.xl,
  backgroundColor: colors.surface,
  padding: spacing.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  ...(shadows?.lg || {}),
},

  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  modalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  modalOptionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  modalOptionRowActive: {
  backgroundColor: colors.surfaceSecondary,
  borderRadius: 8,
},

modalOptionTextActive: {
  color: colors.textPrimary,
  fontWeight: "600",
},
  modalOptionText: { fontSize: 13, color: colors.textSecondary, fontWeight: "700" },
  modalOptionTextActive: { fontSize: 13, color: colors.accentBlue, fontWeight: "900" },
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
  sourceContextCard: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: spacing.md,
  },
  sourceContextIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sourceContextKicker: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  sourceContextTitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  sourceContextText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  sourceContextLink: {
    marginTop: 6,
    fontSize: 12,
    color: colors.brandBlue,
    fontWeight: "900",
  },
  sourceActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  sourceActionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  sourceActionText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
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
  pendingAttachmentRow: {
  marginTop: spacing.sm,
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 12,
  paddingVertical: 12,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
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
},

});
