// screens/CreateEventScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

// Shared attachments engine
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import KeeprDateField from "../components/KeeprDateField";

const EVENT_ATTACHMENTS_BUCKET = "asset-files";

/* ------------------------------------------------------------------ */
/* Date helpers                                                       */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, "0");

const todayISO = () => {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
};


/* ------------------------------------------------------------------ */
/* Money helpers                                                      */
/* ------------------------------------------------------------------ */

const dollarsToCents = (s) => {
  if (!s) return null;
  const cleaned = String(s).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

const centsToDollars = (cents) => {
  if (cents == null) return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
};

/* ------------------------------------------------------------------ */
/* File helpers                                                       */
/* ------------------------------------------------------------------ */

const sanitizeFilename = (name) =>
  (name || `file-${Date.now()}`).replace(/[^\w.\-]/g, "_");

const isProbablyImage = (mime) =>
  String(mime || "").toLowerCase().startsWith("image/");

async function uriToBytes(uri) {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read file (${res.status})`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

async function uploadAttachmentToSupabase({
  ownerId,
  assetId,
  eventId,
  uri,
  mimeType,
  filename,
}) {
  if (!ownerId) throw new Error("Missing ownerId");
  if (!eventId) throw new Error("Missing eventId");
  if (!uri) throw new Error("Missing uri");

  const safeName = sanitizeFilename(filename);

  // 🔧 Use the same "users/<uid>/..." prefix as the standard pipeline
  const base = assetId
    ? `users/${ownerId}/assets/${assetId}/events/${eventId}`
    : `users/${ownerId}/event_inbox/${eventId}`;

  const storage_path = `${base}/${Date.now()}-${safeName}`;

  const fileBody = await uriToBytes(uri);

  const { error: uploadError } = await supabase.storage
    .from(EVENT_ATTACHMENTS_BUCKET) // "asset-files"
    .upload(storage_path, fileBody, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.log("CreateEvent storage upload error", uploadError);
    throw uploadError;
  }

  const { data: publicData } = supabase.storage
    .from(EVENT_ATTACHMENTS_BUCKET)
    .getPublicUrl(storage_path);

  const public_url = publicData?.publicUrl || null;
  return { storage_path, public_url };
}

function getImagePickerMediaTypesCompat() {
  if (ImagePicker?.MediaType?.Images) return [ImagePicker.MediaType.Images];
  return ImagePicker.MediaTypeOptions.Images;
}

/* ------------------------------------------------------------------ */
/* Screen                                                             */
/* ------------------------------------------------------------------ */

export default function CreateEventScreen({ navigation, route }) {
  const { user } = useAuth();
  const ownerId = user?.id || null;

  // Prefill contract (HomeSystems, future entry points)
  const prefill = route?.params?.prefill ?? null;
  const modeKeyFromRoute = route?.params?.modeKey ?? null;
  const modeLabelFromRoute = route?.params?.modeLabel ?? null;
  const sourceFromRoute = route?.params?.source ?? null;

  const prefillModeKey = prefill?.modeKey ?? modeKeyFromRoute ?? null;
  const prefillModeLabel = prefill?.modeLabel ?? modeLabelFromRoute ?? null;
  const prefillSource = prefill?.source ?? sourceFromRoute ?? null;

  const contextAssetId = prefill?.assetId ?? route?.params?.assetId ?? null;
  const contextSystemId = prefill?.systemId ?? route?.params?.systemId ?? null;
  const contextHomeSystemId =
    prefill?.homeSystemId ?? route?.params?.homeSystemId ?? null;

  const contextTitle = prefill?.title ?? route?.params?.title ?? "";
  const contextNotes = prefill?.notes ?? route?.params?.notes ?? "";

  const eventIdFromRoute = route?.params?.eventId ?? null;
  const isEdit = !!eventIdFromRoute;

  const [eventId, setEventId] = useState(eventIdFromRoute);
  const [assetId, setAssetId] = useState(contextAssetId);
  const [systemId, setSystemId] = useState(contextSystemId);
  const [homeSystemId, setHomeSystemId] = useState(contextHomeSystemId);

  const [title, setTitle] = useState(contextTitle);
  const [notes, setNotes] = useState(contextNotes);

  const [occurredAtISO, setOccurredAtISO] = useState(todayISO());
  const [amountDollars, setAmountDollars] = useState("");

  const [assetName, setAssetName] = useState("");
  const [systemName, setSystemName] = useState("");

  const [status, setStatus] = useState("draft");

  const [existingAttachments, setExistingAttachments] = useState([]);
  const [newAttachments, setNewAttachments] = useState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [enrichOpen, setEditOpen] = useState(false);
  const [enrichLoading, setEditLoading] = useState(false);
  const [assets, setAssets] = useState([]);
  const [systems, setSystems] = useState([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [systemSearch, setSystemSearch] = useState("");

  const [storyExpanded, setStoryExpanded] = useState(false);

  // Keep a local copy of context so we can preserve/extend it
  const [contextJson, setContextJson] = useState(null);

  const subtitle = useMemo(() => {
    if (isEdit) return "Edit draft details, context, and attachments.";
    if (assetId && systemId) return "Captured with asset + system context.";
    if (assetId) return "Captured with asset context.";
    return "Captured as a draft. Edit later in Event Inbox.";
  }, [isEdit, assetId, systemId]);

  /* ---------------------- load event + attachments ---------------------- */

  const loadEvent = useCallback(async () => {
    if (!ownerId || !eventId) return;

    setLoading(true);
    try {
      const { data: ev, error: evErr } = await supabase
        .from("event_inbox")
        .select("*")
        .eq("id", eventId)
        .single();

      if (evErr) throw evErr;

      setTitle(ev?.title || "");
      setNotes(ev?.notes || "");

      const iso = ev?.occurred_at || todayISO();
      setOccurredAtISO((iso || "").slice(0, 10));

      setAmountDollars(centsToDollars(ev?.amount_cents));

      setAssetId(ev?.asset_id || null);
      setSystemId(ev?.system_id || null);
      setHomeSystemId(ev?.home_system_id || null);

      setStatus(ev?.status || "draft");
      setContextJson(ev?.context || null);

      const { data: atts, error: attErr } = await supabase
        .from("event_inbox_attachments")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (attErr) throw attErr;
      setExistingAttachments(atts || []);
      setNewAttachments([]);
    } catch (e) {
      console.log("CreateEventScreen load error:", e);
    } finally {
      setLoading(false);
    }
  }, [ownerId, eventId]);

  useFocusEffect(
    useCallback(() => {
      if (eventId) loadEvent();
    }, [eventId, loadEvent])
  );

  /* ---------------------- asset + system name lookups ------------------- */

  React.useEffect(() => {
    let mounted = true;

    async function fetchAssetName() {
      if (!ownerId || !assetId) {
        if (mounted) setAssetName("");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("assets")
          .select("id,name,type")
          .eq("id", assetId)
          .limit(1);

        if (!mounted) return;
        if (!error && data && data.length > 0) {
          setAssetName(data[0].name || "");
        }
      } catch (e) {
        if (mounted) console.log("fetchAssetName error:", e);
      }
    }

    fetchAssetName();
    return () => {
      mounted = false;
    };
  }, [ownerId, assetId]);

  React.useEffect(() => {
    let mounted = true;

    async function fetchSystemName() {
      if (!assetId || !systemId) {
        if (mounted) setSystemName("");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("systems")
          .select("id,name")
          .eq("id", systemId)
          .limit(1);

        if (!mounted) return;
        if (!error && data && data.length > 0) {
          setSystemName(data[0].name || "");
        }
      } catch (e) {
        if (mounted) console.log("fetchSystemName error:", e);
      }
    }

    fetchSystemName();
    return () => {
      mounted = false;
    };
  }, [assetId, systemId]);

  /* ---------------------- enrich modal data ----------------------------- */

  const loadSystemsForAsset = useCallback(async (targetAssetId) => {
    if (!targetAssetId) {
      setSystems([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("systems")
        .select("id,name,asset_id")
        .eq("asset_id", targetAssetId)
        .order("name", { ascending: true });

      if (error) {
        console.log("CreateEvent loadSystemsForAsset error:", error);
        setSystems([]);
      } else {
        setSystems(data || []);
      }
    } catch (e) {
      console.log("CreateEvent loadSystemsForAsset error:", e);
      setSystems([]);
    }
  }, []);

  const loadAssetsAndSystems = useCallback(async () => {
    if (!ownerId) return;

    setEditLoading(true);
    try {
      const { data: aRows, error: aErr } = await supabase
        .from("assets")
        .select("id,name,type,status,deleted_at")
        .eq("owner_id", ownerId)
        .is("deleted_at", null)
        .not("status", "eq", "archived")
        .order("name", { ascending: true });

      if (aErr) throw aErr;
      setAssets(aRows || []);

      if (assetId) {
        await loadSystemsForAsset(assetId);
      } else {
        setSystems([]);
      }
    } catch (e) {
      console.log("CreateEventScreen enrich load error:", e);
      Alert.alert(
        "Couldn’t load enrich data",
        e?.message || "Please try again."
      );
    } finally {
      setEditLoading(false);
    }
  }, [ownerId, assetId, loadSystemsForAsset]);

  /* ---------------------- pickers -------------------------------------- */

  const addImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert("Permission needed", "Please allow photo library access.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: getImagePickerMediaTypesCompat(),
        allowsMultipleSelection: false,
        quality: 0.9,
      });

      if (result.canceled) return;

      const picked = result.assets?.[0];
      if (!picked?.uri) return;

      setNewAttachments((prev) => [
        ...prev,
        {
          uri: picked.uri,
          mimeType: picked.mimeType || "image/jpeg",
          filename: picked.fileName || `photo-${Date.now()}.jpg`,
        },
      ]);
    } catch (e) {
      console.log("Image pick error:", e);
      Alert.alert("Couldn’t pick image", e?.message || "Please try again.");
    }
  }, []);

  const addDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const doc = result.assets?.[0];
      if (!doc?.uri) return;

      setNewAttachments((prev) => [
        ...prev,
        {
          uri: doc.uri,
          mimeType: doc.mimeType || "application/octet-stream",
          filename: doc.name || `file-${Date.now()}`,
        },
      ]);
    } catch (e) {
      console.log("Doc pick error:", e);
      Alert.alert("Couldn’t pick file", e?.message || "Please try again.");
    }
  }, []);

  /* ---------------------- attachment actions --------------------------- */

  const openUrl = useCallback(async (url) => {
    if (!url) {
      Alert.alert("No link", "This file doesn’t have a public URL yet.");
      return;
    }

    if (Platform.OS === "web") {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        Alert.alert("Couldn’t open", e?.message || "Please try again.");
      }
      return;
    }

    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        Alert.alert("Can’t open link", "Your device can’t open this link.");
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Couldn’t open", e?.message || "Please try again.");
    }
  }, []);

  const deleteExistingAttachment = useCallback(async (att) => {
    if (!att?.id) return;

    const ok = await confirmDelete(
      "Delete attachment?",
      "This will remove it from the event."
    );
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("event_inbox_attachments")
        .delete()
        .eq("id", att.id);

      if (error) throw error;

      setExistingAttachments((prev) =>
        (prev || []).filter((x) => x.id !== att.id)
      );
    } catch (e) {
      console.log("Delete attachment error:", e);
      Alert.alert("Couldn’t delete", e?.message || "Please try again.");
    }
  }, []);

  const removePendingAttachment = useCallback((idx) => {
    setNewAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /* ---------------------- save / submit -------------------------------- */

  const validate = useCallback(() => {
    if (!ownerId) return "Not signed in.";
    if (!occurredAtISO) return "Please select a date.";
    return null;
 }, [ownerId, occurredAtISO]);

  const upsertEventRow = useCallback(
    async ({ nextStatus }) => {
      const iso = occurredAtISO || todayISO();
      const amount_cents = dollarsToCents(amountDollars);

      // Preserve existing context and extend with mode if provided
      const baseContext =
        contextJson && typeof contextJson === "object"
          ? { ...contextJson }
          : {};

      let nextContext = baseContext;

      if (prefillModeKey) {
        nextContext = {
          ...baseContext,
          mode: prefillModeKey,
          ...(prefillModeLabel ? { mode_label: prefillModeLabel } : {}),
          ...(prefillSource ? { source: prefillSource } : {}),
        };
      }

      const context =
        nextContext && Object.keys(nextContext).length > 0
          ? nextContext
          : null;

      const payload = {
        owner_id: ownerId,
        title: title?.trim() || null,
        notes: notes?.trim() || null,
        occurred_at: iso,
        amount_cents,
        asset_id: assetId || null,
        system_id: systemId || null,
        home_system_id: homeSystemId || null,
        status: nextStatus || "draft",
        ...(context !== null ? { context } : {}),
      };

      if (eventId) {
        const { data, error } = await supabase
          .from("event_inbox")
          .update(payload)
          .eq("id", eventId)
          .select("*")
          .single();

        if (error) throw error;
        return data;
      }

      const { data, error } = await supabase
        .from("event_inbox")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    [
      ownerId,
      eventId,
      title,
      notes,
      occurredAtISO,
      amountDollars,
      assetId,
      systemId,
      homeSystemId,
      contextJson,
      prefillModeKey,
      prefillModeLabel,
      prefillSource,
    ]
  );

  const uploadPendingAttachments = useCallback(
    async (evId) => {
      if (!ownerId || !evId || newAttachments.length === 0) return;

      try {
        for (const a of newAttachments) {
          // 1) Upload to storage + get path/url
          const { storage_path, public_url } = await uploadAttachmentToSupabase(
            {
              ownerId,
              assetId: assetId || null,
              eventId: evId,
              uri: a.uri,
              mimeType: a.mimeType,
              filename: a.filename,
            }
          );

          // 2) Write to event_inbox_attachments (no owner_id column here)
          const { error } = await supabase
            .from("event_inbox_attachments")
            .insert({
              event_id: evId,
              storage_path,
              public_url,
              file_name: a.filename,
              mime_type: a.mimeType,
            });

          if (error) throw error;

          // 3) Promote into core attachments pipeline when we have asset context
          if (assetId) {
            try {
              await uploadAttachmentFromUri({
                userId: ownerId,
                assetId,
                kind: isProbablyImage(a.mimeType) ? "photo" : "file",
                fileUri: a.uri,
                fileName: a.filename,
                mimeType: a.mimeType,
                sizeBytes: null,
                placements: [
                  {
                    target_type: "asset",
                    target_id: assetId,
                    role: "other",
                  },
                ],
              });
            } catch (e) {
              console.log("Event → attachments promotion failed", e);
              // keep going; event-level attachment is still valid
            }
          }
        }

        // 4) Refresh event_inbox_attachments so UI shows them as "Uploaded"
        const { data: fresh, error: refreshErr } = await supabase
          .from("event_inbox_attachments")
          .select("*")
          .eq("event_id", evId)
          .order("created_at", { ascending: false });

        if (refreshErr) throw refreshErr;

        setExistingAttachments(fresh || []);
        setNewAttachments([]);
      } catch (e) {
        console.log("uploadPendingAttachments error:", e);
        Alert.alert(
          "Attachment upload failed",
          e?.message || "Please try again."
        );
      }
    },
    [ownerId, assetId, newAttachments]
  );

  const returnToInbox = useCallback(
    (openEventId) => {
      navigation?.reset?.({
        index: 0,
        routes: [{ name: "Notifications", params: { openEventId } }],
      });
    },
    [navigation]
  );

  const onSave = useCallback(
    async (nextStatus = "draft") => {
      const msg = validate();
      if (msg) {
        Alert.alert("Check form", msg);
        return;
      }

      setSaving(true);
      try {
        const row = await upsertEventRow({ nextStatus });
        const evId = row?.id;
        if (!evId) throw new Error("No event id returned from save.");

        if (!eventId) setEventId(evId);

        if (newAttachments.length > 0) {
          await uploadPendingAttachments(evId);
        }

        setStatus(nextStatus);
        returnToInbox(evId);
      } catch (e) {
        console.log("CreateEventScreen save error:", e);
        Alert.alert("Save failed", e?.message || "Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [
      validate,
      upsertEventRow,
      uploadPendingAttachments,
      newAttachments.length,
      eventId,
      returnToInbox,
    ]
  );

  /* ---------------------- delete event --------------------------------- */

  const deleteEvent = useCallback(async () => {
    if (!eventId) return;

    const ok = await confirmDelete(
      "Delete draft?",
      "This will delete the event and its attachment rows."
    );
    if (!ok) return;

    setSaving(true);
    try {
      const { error: aErr } = await supabase
        .from("event_inbox_attachments")
        .delete()
        .eq("event_id", eventId);
      if (aErr) throw aErr;

      const { error: eErr } = await supabase
        .from("event_inbox")
        .delete()
        .eq("id", eventId);
      if (eErr) throw eErr;

      Alert.alert("Deleted", "Draft removed.");
      navigation.navigate("Notifications");
    } catch (e) {
      console.log("Delete event error:", e);
      Alert.alert("Delete failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [eventId, navigation]);

  /* ---------------------- enrich modal actions ------------------------- */

  const openEdit = useCallback(() => {
    setEditOpen(true);
    loadAssetsAndSystems();
  }, [loadAssetsAndSystems]);

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    if (!q) return assets;
    return (assets || []).filter((a) =>
      String(a?.name || "").toLowerCase().includes(q)
    );
  }, [assets, assetSearch]);

  const filteredSystems = useMemo(() => {
    const q = systemSearch.trim().toLowerCase();
    if (!q) return systems;
    return (systems || []).filter((s) =>
      String(s?.name || "").toLowerCase().includes(q)
    );
  }, [systems, systemSearch]);

  const selectAsset = useCallback(
    (a) => {
      const newId = a?.id || null;
      setAssetId(newId);
      setAssetName(a?.name || "");
      setSystemId(null);
      setSystemName("");
      setHomeSystemId(null);
      loadSystemsForAsset(newId);
    },
    [loadSystemsForAsset]
  );

  const selectSystem = useCallback((s) => {
    setSystemId(s?.id || null);
    setSystemName(s?.name || "");
    // homeSystemId can stay as-is if this event was created from a home-system context.
  }, []);

  /* ---------------------- UI ------------------------------------------- */

  const canGoBack = !!navigation?.canGoBack?.() && navigation.canGoBack();

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text
            style={{ marginTop: spacing.sm, color: colors.textSecondary }}
          >
            Loading…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={layoutStyles.screen}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.topBar}>
          {canGoBack ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.topBtn}
              activeOpacity={0.85}
            >
              <Ionicons
                name="chevron-back-outline"
                size={22}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}

          <Text style={styles.topTitle}>
            {isEdit ? "Edit event" : "New event"}
          </Text>

          <TouchableOpacity
            onPress={openEdit}
            style={styles.topBtn}
            activeOpacity={0.85}
          >
            <Ionicons
              name="sparkles-outline"
              size={18}
              color={colors.textPrimary}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.wrap}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                if (eventId) loadEvent();
              }}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Oil change, Dock repair, Furnace inspection"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>

<View style={styles.card}>
  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
    <Text style={styles.label}>Story Content</Text>

    <TouchableOpacity onPress={() => setStoryExpanded(v => !v)}>
      <Text style={{ fontSize: 12, fontWeight: "900", color: colors.brandBlue }}>
        {storyExpanded ? "Collapse" : "Expand"}
      </Text>
    </TouchableOpacity>
  </View>

  <TextInput
    value={notes}
    onChangeText={setNotes}
    placeholder="Email body or event details..."
    placeholderTextColor={colors.textMuted}
    style={[
      styles.input,
      {
        minHeight: storyExpanded ? 440 : 110,
        textAlignVertical: "top",
      },
    ]}
    multiline
  />
</View>

          <View style={styles.row}>
            <View style={[styles.card, { flex: 1 }]}>
              <Text style={styles.label}>Date</Text>
              <KeeprDateField
                value={occurredAtISO}
                onChange={setOccurredAtISO}
              />
              <Text style={styles.help}>
                Stored as {occurredAtISO || "—"}
              </Text>
            </View>

            <View style={[styles.card, { flex: 1 }]}>
              <Text style={styles.label}>Amount</Text>
              <TextInput
                value={amountDollars}
                onChangeText={setAmountDollars}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={
                  Platform.OS === "ios" ? "decimal-pad" : "numeric"
                }
              />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Context</Text>
            <Text style={styles.contextLine}>
              Asset: {assetName || (assetId ? assetId : "—")}
            </Text>
            <Text style={styles.contextLine}>
              System: {systemName || "—"}
            </Text>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={openEdit}
              activeOpacity={0.9}
            >
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={colors.textPrimary}
              />
              <Text style={styles.secondaryText}>Edit context</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.attachHeader}>
              <Text style={styles.label}>Attachments</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={addImage}
                  style={styles.attachBtn}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="image-outline"
                    size={16}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.attachBtnText}>Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={addDocument}
                  style={styles.attachBtn}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="document-outline"
                    size={16}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.attachBtnText}>File</Text>
                </TouchableOpacity>
              </View>
            </View>

            {newAttachments.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.sectionMini}>Pending upload</Text>
                {newAttachments.map((a, idx) => (
                  <View key={`${a.uri}-${idx}`} style={styles.attachmentRow}>
                    <View style={styles.attachmentIcon}>
                      <Ionicons
                        name={
                          isProbablyImage(a.mimeType)
                            ? "image-outline"
                            : "document-outline"
                        }
                        size={16}
                        color={colors.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {a.filename}
                      </Text>
                      <Text style={styles.attachmentMeta} numberOfLines={1}>
                        {a.mimeType || "unknown"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => removePendingAttachment(idx)}
                      hitSlop={10}
                    >
                      <Ionicons
                        name="close-circle-outline"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {existingAttachments.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.sectionMini}>Uploaded</Text>
                {existingAttachments.map((a) => (
                  <View key={a.id} style={styles.attachmentRow}>
                    <View style={styles.attachmentIcon}>
                      <Ionicons
                        name={
                          isProbablyImage(a.mime_type)
                            ? "image-outline"
                            : "document-outline"
                        }
                        size={16}
                        color={colors.textSecondary}
                      />
                    </View>

                    <TouchableOpacity
                      style={{ flex: 1 }}
                      activeOpacity={0.85}
                      onPress={() => openUrl(a.public_url)}
                    >
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {a.file_name || "Attachment"}
                      </Text>
                      <Text style={styles.attachmentMeta} numberOfLines={1}>
                        {a.mime_type || "unknown"} · tap to open
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => deleteExistingAttachment(a)}
                      hitSlop={10}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.footerRow}>
            {eventId ? (
              <TouchableOpacity
                style={[styles.dangerBtn, saving && { opacity: 0.6 }]}
                onPress={deleteEvent}
                disabled={saving}
                activeOpacity={0.9}
              >
                <Ionicons name="trash-outline" size={16} color="white" />
                <Text style={styles.dangerText}>Delete</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <TouchableOpacity
              style={[styles.secondaryBtnWide, saving && { opacity: 0.7 }]}
              onPress={() => onSave("draft")}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.secondaryText}>Save draft</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.statusHint}>
            Status: {String(status || "draft").toUpperCase()}
          </Text>
        </ScrollView>

        {/* Edit / context modal */}
        <Modal
          visible={enrichOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setEditOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit</Text>
                <TouchableOpacity
                  onPress={() => setEditOpen(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              {enrichLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator />
                  <Text
                    style={{
                      marginTop: 10,
                      color: colors.textSecondary,
                    }}
                  >
                    Loading…
                  </Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={{ padding: spacing.lg }}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.sectionMini}>Asset</Text>
                  <TextInput
                    value={assetSearch}
                    onChangeText={setAssetSearch}
                    placeholder="Search assets…"
                    placeholderTextColor={colors.textMuted}
                    style={styles.modalInput}
                  />

                  {filteredAssets.length === 0 ? (
                    <Text style={styles.muted}>
                      No assets yet. Create an asset first, then link this
                      event.
                    </Text>
                  ) : (
                    filteredAssets.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[
                          styles.pickRow,
                          assetId === a.id && styles.pickRowActive,
                        ]}
                        onPress={() => selectAsset(a)}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.pickTitle}>{a.name}</Text>
                        <Text style={styles.pickMeta}>{a.type || ""}</Text>
                      </TouchableOpacity>
                    ))
                  )}

                  {!!assetId && (
                    <>
                      <View style={{ height: 16 }} />
                      <Text style={styles.sectionMini}>Systems</Text>
                      <TextInput
                        value={systemSearch}
                        onChangeText={setSystemSearch}
                        placeholder="Search systems…"
                        placeholderTextColor={colors.textMuted}
                        style={styles.modalInput}
                      />

                      {filteredSystems.length === 0 ? (
                        <Text style={styles.muted}>
                          No systems found for this asset.
                        </Text>
                      ) : (
                        filteredSystems.map((s) => (
                          <TouchableOpacity
                            key={s.id}
                            style={[
                              styles.pickRow,
                              systemId === s.id && styles.pickRowActive,
                            ]}
                            onPress={() => selectSystem(s)}
                            activeOpacity={0.9}
                          >
                            <Text style={styles.pickTitle}>{s.name}</Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </>
                  )}

                  <View style={{ height: 18 }} />
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setEditOpen(false)}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.primaryText}>Done</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm helper                                                     */
/* ------------------------------------------------------------------ */

async function confirmDelete(title, message) {
  if (Platform.OS === "web") {
    try {
      // eslint-disable-next-line no-alert
      return window.confirm(`${title}\n\n${message}`);
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => resolve(true),
      },
    ]);
  });
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  subtitle: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  row: { flexDirection: "row", gap: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.subtle,
  },

  label: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },

  help: { marginTop: 6, fontSize: 11, color: colors.textMuted },

  contextLine: {
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },

  attachHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  attachBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  sectionMini: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  muted: { marginTop: 6, fontSize: 12, color: colors.textMuted },

  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    marginTop: 8,
  },
  attachmentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentName: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  attachmentMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },

  footerRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  secondaryBtn: {
    marginTop: spacing.sm,
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnWide: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    padding:12,
  },
  primaryText: {
    fontSize: 13,
    fontWeight: "900",
    color: "white",
  },

  dangerBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.danger || "#DC2626",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { fontSize: 13, fontWeight: "900", color: "white" },

  statusHint: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  modalHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  pickRow: {
    marginTop: 8,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  pickRowActive: { borderColor: colors.brandBlue },
  pickTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  pickMeta: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
});
