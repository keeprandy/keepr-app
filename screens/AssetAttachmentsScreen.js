import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing } from "../styles/theme";

// ✅ use the existing attachments hook
import { useAssetAttachments } from "../hooks/useAttachments";
// ✅ enhance context
import EnhanceAttachmentModal from "../enhance/EnhanceAttachmentModal";
import ProofBuilder from "../screens/ProofBuilderScreen";
import KeeprIntelligence from "../screens/KeeprIntelligenceScreen";
import { assuranceConnector } from "../enhance/connectors/assuranceConnector";


// ✅ low-level upload helpers (NOT hooks)
import {
  createLinkAttachment,
  uploadAttachmentFromUri,
} from "../lib/attachmentsUploader";

import { getSignedUrl } from "../lib/attachmentsApi";


import AttachmentViewerModal from "../components/AttachmentViewerModal";

const SP = spacing || { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 };
const IS_WEB = Platform.OS === "web";

const BUCKET = "asset-files";

const SHADOW = Platform.select({
  web: { boxShadow: "0 2px 8px rgba(0,0,0,0.15)" },
  default: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
});

// ✅ V1 QC: direct DB writes for save + associations (avoids any mismatch inside attachmentsApi)
async function apiUpdateAttachment(attachmentId, patch) {
  // ✅ V1 QC: avoid relying on response bodies (mobile can surface as "Empty or invalid json")
  const { error } = await supabase
    .from("attachments")
    .update(patch)
    .eq("id", attachmentId);
  if (error) throw error;
}

async function apiUpsertPlacement({ attachment_id, target_type, target_id, role, label, sort_order, is_showcase }) {
  const payload = {
    attachment_id,
    target_type,
    target_id,
    role: role ?? null,
    label: label ?? null,
    sort_order: sort_order ?? null,
    is_showcase: !!is_showcase,
  };

  // We intentionally use INSERT + "ignore duplicate" handling instead of Postgres ON CONFLICT,
  // because the unique index columns can vary by environment/schema.
  const { error } = await supabase.from("attachment_placements").insert(payload);

  if (!error) return { existed: false };

  const msg = String(error.message || "");
  if (error.code === "23505" || msg.toLowerCase().includes("duplicate key")) {
    // Already associated — treat as success (idempotent attach).
    return { existed: true };
  }

  throw error;
}

async function apiDeletePlacementById(placementId) {
  const { error } = await supabase
    .from("attachment_placements")
    .delete()
    .eq("id", placementId);
  if (error) throw error;
}

async function apiUpdatePlacementById(placementId, patch) {
  const { error } = await supabase
    .from("attachment_placements")
    .update(patch)
    .eq("id", placementId);
  if (error) throw error;
}

async function apiSetPlacementShowcase({ attachment_id, target_type, target_id, is_showcase }) {
  const { error } = await supabase
    .from("attachment_placements")
    .update({ is_showcase })
    .eq("attachment_id", attachment_id)
    .eq("target_type", target_type)
    .eq("target_id", target_id);
  if (error) throw error;
}

// Shared upload engine for this screen
function useAttachmentUploadForAsset(assetId, onComplete) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const ensureMediaPermission = useCallback(async () => {
    if (Platform.OS === "web") return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === "granted";
  }, [ensureSignedUrlForRow]);

  const doAfter = useCallback(
    async () => {
      try {
        if (onComplete) {
          await onComplete();
        }
      } catch (e) {
        console.log("post-upload callback failed", e?.message || e);
      }
    },
    [onComplete]
  );

  const uploadFromCamera = useCallback(async () => {
    try {
      setUploadError(null);
      const ok = await ensureMediaPermission();
      if (!ok) {
        Alert.alert(
          "Permission required",
          "Please allow photo library access."
        );
        return;
      }

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a?.uri) return;

      setUploading(true);
      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "photo.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements: [
          { target_type: "asset", target_id: assetId, role: "other" },
        ],
      });
      await doAfter();
    } catch (e) {
      console.log("uploadFromCamera failed", e);
      setUploadError(e);
      Alert.alert(
        "Upload failed",
        e?.message || "Could not upload photo from camera."
      );
    } finally {
      setUploading(false);
    }
  }, [assetId, ensureMediaPermission, doAfter]);

  const uploadFromDevice = useCallback(async () => {
    try {
      setUploadError(null);

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (res.canceled) return;
      const f = res.assets?.[0];
      if (!f?.uri) return;

      setUploading(true);
      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "file",
        fileUri: f.uri,
        fileName: f.name || f.uri.split("/").pop() || "file",
        mimeType: f.mimeType || "application/octet-stream",
        sizeBytes: f.size || null,
        placements: [
          { target_type: "asset", target_id: assetId, role: "other" },
        ],
      });
     
      await refresh();
      console.log("Attachment uploaded:", file.name);

      await doAfter();
    } catch (e) {
      console.log("uploadFromDevice failed", e);
      setUploadError(e);
      Alert.alert(
        "Upload failed",
        e?.message || "Could not upload file from device."
      );
    } finally {
      setUploading(false);
    }
  }, [assetId, doAfter]);

  const addLink = useCallback(
    async ({ url, title, notes }) => {
      try {
        setUploadError(null);

        const { data } = await supabase.auth.getUser();
        const userId = data?.user?.id;
        if (!userId) throw new Error("Not signed in.");

        // let your existing normalizeUrl helper clean this up if you call it
        const cleanedUrl = url?.trim();

        setUploading(true);
        await createLinkAttachment({
          userId,
          assetId,
          url: cleanedUrl,
          title: title?.trim() || null,
          notes: notes?.trim() || null,
          placements: [
            { target_type: "asset", target_id: assetId, role: "other" },
          ],
        });

        await doAfter();
      } catch (e) {
        console.log("addLink failed", e);
        setUploadError(e);
        Alert.alert(
          "Save failed",
          e?.message || "Could not save link attachment."
        );
      } finally {
        setUploading(false);
      }
    },
    [assetId, doAfter]
  );

  return {
    uploadFromDevice,
    uploadFromCamera,
    addLink,
    uploading,
    uploadError,
  };
}

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function normalizeUrl(input) {
  const raw = safeStr(input).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host || url;
  } catch {
    return url;
  }
}

function shortId(id) {
  const s = safeStr(id);
  if (!s) return "";
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function getExt(name = "") {
  const base = (name || "").split("?")[0].split("#")[0];
  const parts = base.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() || "").toLowerCase();
}

function isImageMime(m = "") {
  return /^image\//i.test(m || "");
}

function isPdfMime(m = "") {
  return (m || "").toLowerCase() === "application/pdf";
}

function formatDate(raw) {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function Badge({ text }) {
  const t = safeStr(text).toUpperCase() || "FILE";
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{t.length > 5 ? t.slice(0, 5) : t}</Text>
    </View>
  );
}

async function confirmDestructive(message) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-undef
    return typeof window !== "undefined" ? window.confirm(message) : true;
  }
  return new Promise((resolve) => {
    Alert.alert("Confirm", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Yes", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function AddLinkModal({ visible, onClose, onCreate }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setUrl("");
    setTitle("");
    setNotes("");
    setSaving(false);
  }, [visible]);

  const handleSave = async () => {
    const norm = normalizeUrl(url);
    if (!norm) {
      Alert.alert("URL required", "Paste a link.");
      return;
    }
    const finalTitle = safeStr(title).trim() || titleFromUrl(norm);
    try {
      setSaving(true);
      await onCreate({
        url: norm,
        title: finalTitle,
        notes: safeStr(notes).trim() || null,
      });
      onClose?.();
    } catch (e) {
      Alert.alert("Add link failed", e?.message || "Could not add link.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add link</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Optional"
            style={styles.input}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            style={[styles.input, styles.textarea]}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSave} style={styles.modalSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.modalSaveText}>Add</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * System picker: lists systems for this asset (from `systems` table).
 * If the table doesn't exist yet, you'll just see an error message in the modal.
 */
function SystemPickerModal({ visible, assetId, onCancel, onSelect }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !assetId) return;

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase
          .from("systems")
          .select("*")
          .eq("asset_id", assetId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        if (!cancelled) setItems(data || []);
      } catch (e) {
        console.log("SystemPicker load failed", e);
        if (!cancelled) {
          setItems([]);
          setError(e.message || "Could not load systems");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [assetId, visible]);

  const labelFor = (s) =>
    s.name ||
    s.title ||
    s.system_type ||
    `System ${shortId(s.id)}`;

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select system</Text>
            <TouchableOpacity onPress={onCancel} style={styles.modalClose}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={{ marginTop: 8, color: colors.textSecondary }}>
                Loading systems…
              </Text>
            </View>
          ) : error ? (
            <Text style={{ color: colors.textSecondary }}>{error}</Text>
          ) : items.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>
              No systems found for this asset.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {items.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.selectorRow}
                  onPress={() => {
                    onSelect?.({
                      id: s.id,
                      label: labelFor(s),
                    });
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectorLabel}>System</Text>
                    <Text style={styles.selectorValue} numberOfLines={1}>
                      {labelFor(s)}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Record picker: lists service_records for this asset.
 */
function RecordPickerModal({ visible, assetId, onCancel, onSelect }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !assetId) return;

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase
          .from("service_records")
          .select("*")
          .eq("asset_id", assetId)
          .order("performed_at", { ascending: false });

        if (error) throw error;
        if (!cancelled) setItems(data || []);
      } catch (e) {
        console.log("RecordPicker load failed", e);
        if (!cancelled) {
          setItems([]);
          setError(e.message || "Could not load records");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [assetId, visible]);

  const labelFor = (r) => {
    const when =
      r.performed_at || r.created_at
        ? new Date(r.performed_at || r.created_at).toLocaleDateString()
        : "";
    const main = r.title || r.category || `Record ${shortId(r.id)}`;
    return when ? `${when} — ${main}` : main;
  };

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select record</Text>
            <TouchableOpacity onPress={onCancel} style={styles.modalClose}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={{ marginTop: 8, color: colors.textSecondary }}>
                Loading records…
              </Text>
            </View>
          ) : error ? (
            <Text style={{ color: colors.textSecondary }}>{error}</Text>
          ) : items.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>
              No records found for this asset.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {items.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.selectorRow}
                  onPress={() => {
                    onSelect?.({
                      id: r.id,
                      label: labelFor(r),
                    });
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectorLabel}>Record</Text>
                    <Text style={styles.selectorValue} numberOfLines={1}>
                      {labelFor(r)}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function AssetAttachmentsScreen({ route, navigation }) {
  // Be defensive: different navigators/screens have passed different param names over time.
  // This screen MUST have an assetId to load anything.
  const assetId =
    route?.params?.assetId ||
    route?.params?.asset_id ||
    route?.params?.id ||
    route?.params?.asset?.id ||
    null;
  const assetName =
    route?.params?.assetName ||
    route?.params?.asset_name ||
    route?.params?.asset?.name ||
    "Asset";

  // Optional context when we arrive from a specific record/system/etc.
  const fromTargetType = route?.params?.targetType || null;
  // Optional scoped view (e.g., opened from a System story)
  // NOTE: in some navigations we only get targetType/targetId. In that case, we treat it as a scope.
  const scopeTargetType = route?.params?.scopeTargetType || null;
  const scopeTargetId = route?.params?.scopeTargetId || null;
  const fromTargetId = route?.params?.targetId || null;
  const fromTargetRole = route?.params?.targetRole || null;

  // Scope override: null = use route scope, "none" = show all
  const [scopeOverride, setScopeOverride] = useState(null);

  const assocDisplayName = (p) => {
    // Prefer explicit denormalized field if you have it
    const direct = p.target_name || p.target_title || p.display_name;
    if (direct) return direct;

    // Lookup tables (systems + records)
    if (p?.target_type === "system" && p?.target_id && systemsIndex?.[p.target_id]?.name) {
      return systemsIndex[p.target_id].name;
    }
    if (p?.target_type === "service_record" && p?.target_id && recordsIndex?.[p.target_id]?.title) {
      return recordsIndex[p.target_id].title;
    }

    // Next: JSON/meta fields (if you store name there)
    const metaName =
      p.context?.name ||
      p.context?.title ||
      p.extra_metadata?.name ||
      p.extra_metadata?.title;

    if (metaName) return metaName;

    return null;
  };


const { width, height } = useWindowDimensions();
const windowHeight = typeof height === "number" ? height : 0;

const mobilePaneHeight = useMemo(() => {
  // header + filters; tweak if needed
  const reserved = 320;
  const available = Math.max(0, windowHeight - reserved);
  return Math.max(260, Math.floor(available / 2));
}, [windowHeight]);

const isWide = IS_WEB && width >= 980;

  // ✅ Enhance Engine (global)

  // Tabs are now *filters* over canonical attachments
  // "all" | "photo" | "file" | "link"
  const [tab, setTab] = useState("all");

  const [busy, setBusy] = useState(false); // reserved if we need global busy
  const [selected, setSelected] = useState(null);

  // Hero preview state (web-only PDF/doc viewer)
  const [heroUrl, setHeroUrl] = useState(null);
  const [heroIsPdf, setHeroIsPdf] = useState(false);
  const [heroLoading, setHeroLoading] = useState(false);
  // Web: default to preview OFF to prioritize list + editor; user can toggle on.
  const [showPreview, setShowPreview] = useState(!IS_WEB);

  // Attachment viewer modal (web + mobile)
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const signedUrlCacheRef = useRef(new Map());


  // “no-code” controls
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest"); // newest | oldest | title
  const [roleFilter, setRoleFilter] = useState("all"); // all | <role ids>

  // V1 placement roles (stored on attachment_placements.role)
  const ROLE_OPTIONS = useMemo(
    () => [
      { id: "warranty", label: "Warranty" },
      { id: "proof", label: "Proof" },
      { id: "proof_of_purchase", label: "Proof of Purchase" },
      { id: "receipt", label: "Receipt" },
      { id: "invoice", label: "Invoice" },
      { id: "estimate_quote", label: "Estimate / Quote" },
      { id: "service_report", label: "Service Report" },
      { id: "owners_manual", label: "Owner's Manual" },
      { id: "inspection", label: "Inspection" },
      { id: "contract_agreement", label: "Contract / Agreement" },
      { id: "registration", label: "Registration" },
      { id: "insurance", label: "Insurance" },
      { id: "photo", label: "Photo" },
      { id: "support_page", label: "Support Page" },
      { id: "other", label: "Other" },
    ],
    []
  );

  const roleLabel = useCallback(
    (roleId) => {
      const id = safeStr(roleId).trim() || "other";
      const found = ROLE_OPTIONS.find((r) => r.id === id);
      return found ? found.label : id;
    },
    [ROLE_OPTIONS]
  );
  const normalizeRoleKey = useCallback((v) => {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "other";
    return s.replace(/[\s-]+/g, "_");
  }, []);




  const [systemFilterId, setSystemFilterId] = useState("all"); // "all" or a systems.id
  const [roleFilterOpen, setRoleFilterOpen] = useState(false);
  const [systemFilterOpen, setSystemFilterOpen] = useState(false);
  const [roleEditOpen, setRoleEditOpen] = useState(false);

  // Name lookup for nicer labels (systems + service_records)
  const [systemsIndex, setSystemsIndex] = useState({}); // { [id]: { id, name } }
  const [recordsIndex, setRecordsIndex] = useState({}); // { [id]: { id, title } }

  // Effective scope: supports explicit scope params, legacy targetType/targetId navigation,
  // and common "systemId"/"recordId" params used by various story screens.
  // Also allows the user to temporarily clear scope (Show all) without losing the originating context.
  const routeSystemId =
    route?.params?.systemId ||
    route?.params?.homeSystemId ||
    route?.params?.vehicleSystemId ||
    null;

  const routeRecordId =
    route?.params?.serviceRecordId ||
    route?.params?.recordId ||
    null;

  const derivedRouteScopeType =
    scopeTargetType ||
    ((fromTargetType === "system" || fromTargetType === "service_record")
      ? fromTargetType
      : null) ||
    (routeSystemId ? "system" : routeRecordId ? "service_record" : null);

  const derivedRouteScopeId =
    scopeTargetId ||
    ((fromTargetType === "system" || fromTargetType === "service_record")
      ? fromTargetId
      : null) ||
    routeSystemId ||
    routeRecordId ||
    null;

  const effectiveScopeType =
    scopeOverride === "none" ? null : (scopeOverride?.type || derivedRouteScopeType);
  const effectiveScopeId =
    scopeOverride === "none" ? null : (scopeOverride?.id || derivedRouteScopeId);

  const effectiveScopeLabel = useMemo(() => {
    if (!effectiveScopeType || !effectiveScopeId) return null;
    if (effectiveScopeType === "system") {
      const byIndex = systemsIndex?.[effectiveScopeId]?.name;
      return byIndex || route?.params?.scopeTargetName || route?.params?.targetName || null;
    }
    if (effectiveScopeType === "service_record") {
      const byIndex = recordsIndex?.[effectiveScopeId]?.title;
      return byIndex || route?.params?.scopeTargetName || route?.params?.targetName || null;
    }
    return route?.params?.scopeTargetName || route?.params?.targetName || null;
  }, [effectiveScopeId, effectiveScopeType, recordsIndex, route?.params, systemsIndex]);

  const isScoped = !!(effectiveScopeType && effectiveScopeId);

  const scopeExistsOnRoute =
    !!(scopeTargetType && scopeTargetId) ||
    (!!fromTargetType &&
      !!fromTargetId &&
      (fromTargetType === "system" || fromTargetType === "service_record"));

  // When we land here from a System story, the system list filter is effectively locked.
  const systemFilterLocked =
    isScoped && effectiveScopeType === "system" && scopeOverride !== "none";

  const systemFilterDisplayId = systemFilterLocked ? effectiveScopeId : systemFilterId;
  const systemFilterDisplayLabel = systemFilterDisplayId === "all"
    ? "All"
    : systemsIndex?.[systemFilterDisplayId]?.name || "Selected";

  // Association editor (placements)
  // NOTE: DB allows service_record, not timeline_record
  const [targetType, setTargetType] = useState(fromTargetType || "asset"); // asset | system | service_record | event
  const [targetId, setTargetId] = useState(fromTargetId || "");
  const [targetRole, setTargetRole] = useState(fromTargetRole || "other"); // proof | manual | invoice | other

  const [addLinkOpen, setAddLinkOpen] = useState(false);
  
  // Enhance state – just track which attachment we’re enhancing
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceRow, setEnhanceRow] = useState(null);

  // Web-only add menu (because Alert is unreliable on web)
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");

  // Attachments hook (must be defined before any callbacks that reference `refresh`)
  const { items: hookItems, loading, error, refresh } = useAssetAttachments(assetId);

  // Safari/iPad web: use native <input type="file"> instead of Expo pickers (they often fail to open)
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  const triggerWebPicker = useCallback((kind) => {
    const el = kind === "photo" ? photoInputRef.current : fileInputRef.current;
    if (el && typeof el.click === "function") el.click();
  }, []);

  const handleWebPickedFile = useCallback(
    async (file, kind) => {
      if (!file) return;

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const placements = [
        { target_type: "asset", target_id: assetId, role: "other" },
      ];

      if (
        fromTargetType &&
        fromTargetId &&
        (fromTargetType === "system" || fromTargetType === "service_record")
      ) {
        placements.push({
          target_type: fromTargetType,
          target_id: fromTargetId,
          role: fromTargetRole || "other",
        });
      }

      // Use an object URL so our existing upload-from-URI pipeline stays intact.
      const objectUrl = URL.createObjectURL(file);

      try {
        await uploadAttachmentFromUri({
          userId,
          assetId,
          kind: kind === "photo" ? "photo" : "file",
          fileUri: objectUrl,
          fileName:
            file.name ||
            (kind === "photo" ? "photo.jpg" : "file"),
          mimeType: file.type || "application/octet-stream",
          sizeBytes: Number.isFinite(file.size) ? file.size : null,
          placements,
        });

        await refresh();
      } finally {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      }
    },
    [assetId, fromTargetId, fromTargetRole, fromTargetType, refresh]
  );

  const onWebFileChange = useCallback(
    async (e, kind) => {
      try {
        const f = e?.target?.files?.[0] || null;
        // Allow picking the same file again
        if (e?.target) e.target.value = "";
        if (!f) return;

        setAddMenuOpen(false);

        setUploading(true);
        await handleWebPickedFile(f, kind);
        } catch (err) {
          console.log("Web upload failed:", err);
          const msg = err?.message || "Could not upload.";
          if (IS_WEB && typeof window !== "undefined" && typeof window.alert === "function") {
            window.alert(`Upload failed: ${msg}`);
          } else {
            Alert.alert("Upload failed", msg);
          }
        } finally {
  setUploading(false);
}
    },
    [handleWebPickedFile]
  );

  const [draftNotes, setDraftNotes] = useState("");

  const [assocBusy, setAssocBusy] = useState(false);
  const assocBusyRef = useRef(false);
  const [showcaseBusy, setShowcaseBusy] = useState(false);

  // NEW: picker state
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const [recordPickerOpen, setRecordPickerOpen] = useState(false);
  const [systemSelection, setSystemSelection] = useState(null); // {id,label}
  const [recordSelection, setRecordSelection] = useState(null); // {id,label}
  const [advancedAssocOpen, setAdvancedAssocOpen] = useState(false);

  const systemSelectionLabel = useMemo(() => {
    if (systemSelection) return systemSelection.label;
    return "Choose a system (optional)";
  }, [systemSelection]);

  const recordSelectionLabel = useMemo(() => {
    if (recordSelection) return recordSelection.label;
    return "Choose a record (optional)";
  }, [recordSelection]);

  const assocSummaryText = useMemo(() => {
    if (!targetType || !targetId) {
      return "Choose a system or record below";
    }
    const label =
      targetType === "system"
        ? systemSelection?.label
        : targetType === "service_record"
        ? recordSelection?.label
        : null;

    const idPart = label ? label : `${targetType} (${shortId(targetId)})`;
    return `Will attach as ${targetRole} to ${idPart}`;
  }, [recordSelection, systemSelection, targetId, targetRole, targetType]);

  // Ensure attachments load reliably on native (and after navigation) by refreshing on focus.
  useFocusEffect(
    useCallback(() => {
      if (!assetId) return;
      refresh?.();
    }, [assetId, refresh])
  );

  // ✅ Load system + record name indexes for filters / labels (no schema changes required)
  useEffect(() => {
    let cancelled = false;
    if (!assetId) {
      setSystemsIndex({});
      setRecordsIndex({});
      return;
    }

    (async () => {
      try {
        const { data: sys, error: sysErr } = await supabase
          .from("systems")
          .select("id,name,metadata")
          .eq("asset_id", assetId)
          .order("name", { ascending: true });

        if (!cancelled) {
          if (sysErr) {
            console.log("AssetAttachmentsScreen: load systems index failed", sysErr);
            setSystemsIndex({});
          } else {
            const map = {};
            (sys || []).forEach((s) => {
              const dn = typeof s?.metadata?.display_name === "string" ? s.metadata.display_name.trim() : "";
              map[s.id] = { id: s.id, name: dn || s.name || "System" };
            });
            setSystemsIndex(map);
          }
        }
      } catch (e) {
        if (!cancelled) setSystemsIndex({});
      }

      try {
        const { data: recs, error: recErr } = await supabase
          .from("service_records")
          .select("id,title,performed_at,created_at")
          .eq("asset_id", assetId)
          .order("performed_at", { ascending: false })
          .order("created_at", { ascending: false });

        if (!cancelled) {
          if (recErr) {
            console.log("AssetAttachmentsScreen: load records index failed", recErr);
            setRecordsIndex({});
          } else {
            const map = {};
            (recs || []).forEach((r) => {
              const t = (r.title || "").trim();
              map[r.id] = { id: r.id, title: t || "Record" };
            });
            setRecordsIndex(map);
          }
        }
      } catch (e) {
        if (!cancelled) setRecordsIndex({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId]);



  // normalize rows for UI
  const normalized = useMemo(() => {
    const src = hookItems || [];

    const rows = src.map((x) => {
      const fileName = x.file_name || "Attachment";
      const ext = getExt(fileName);
      const isPhoto =
        x.kind === "photo" ||
        isImageMime(x.mime_type) ||
        ["jpg","jpeg","png","gif","webp","heic","heif","bmp","tiff"].includes(ext);
      const badge =
        x.kind === "link"
          ? "LINK"
          : isPdfMime(x.mime_type) || ext === "pdf"
          ? "PDF"
          : isPhoto
          ? "IMG"
          : (ext || "FILE").toUpperCase();

      // Prefer the placement that represents this attachment on the current asset
      const placements = Array.isArray(x?.placements) ? x.placements : [];
      const assetPl =
        placements.find((p) => p?.target_type === "asset" && p?.target_id === assetId) ||
        null;

      const effectiveRole = safeStr(x.role) || safeStr(assetPl?.role) || "other";
      const assetPlacementId =
        x.asset_placement_id || x.placement_id || assetPl?.id || null;

      const effectiveIsShowcase =
        typeof x.is_showcase === "boolean"
          ? x.is_showcase
          : typeof assetPl?.is_showcase === "boolean"
          ? assetPl.is_showcase
          : false;

      return {
        ...x,
        role: effectiveRole,
        asset_placement_id: assetPlacementId,
        target_type: x.target_type || assetPl?.target_type || "asset",
        target_id: x.target_id || assetPl?.target_id || assetId,
        is_showcase: effectiveIsShowcase,
        file_name: fileName,
        _isPhoto: isPhoto,
        badge,
      };
    });

    return rows;
  }, [hookItems, assetId]);

  // ✅ Keep selected attachment in sync when we refresh (so new associations show immediately)
  // IMPORTANT: always sync from `normalized` (it contains the derived asset placement role/showcase)
  useEffect(() => {
    if (!selected?.attachment_id) return;
    const updated = (normalized || []).find(
      (x) => (x?.attachment_id || x?.id) === selected.attachment_id
    );
    if (updated && updated !== selected) {
      setSelected(updated);
    }
  }, [normalized, selected?.attachment_id]);

  useEffect(() => {
    if (!selected) {
      setDraftTitle("");
      setDraftUrl("");
      setDraftNotes("");
      return;
    }
    setDraftTitle(selected.title || "");
    setDraftUrl(selected.url || "");
    setDraftNotes(selected.notes || "");
  }, [selected]);

  // 🔄 Listen for global "attachment updated" events from the Enhance modal
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      "keepr:attachment:updated",
      (payload) => {
        try {
          const updatedAssetId = payload?.assetId;
          if (updatedAssetId && assetId && updatedAssetId !== assetId) return;

          refresh();
          // Optionally: setSelected(null);
        } catch (e) {
          console.log("attachment update refresh failed", e?.message || e);
        }
      }
    );

    return () => sub?.remove?.();
  }, [assetId, refresh]);

  useEffect(() => {
    if (error) {
      Alert.alert("Load failed", error?.message || "Could not load attachments.");
    }
  }, [error]);

  const filtered = useMemo(() => {
    const query = safeStr(q).trim().toLowerCase();

    const tabOk = (x) => {
      if (tab === "all") return true;
      if (tab === "link") return x.kind === "link";
      if (tab === "photo") return x.kind === "photo" || x._isPhoto;
      if (tab === "file") return x.kind !== "link" && !(x.kind === "photo" || x._isPhoto);
      return true;
    };

    const roleOk = (x) => {
      if (roleFilter === "all") return true;
      return normalizeRoleKey(x.role) === roleFilter;
    };

    const systemOk = (x) => {
      if (systemFilterId === "all") return true;

      // Prefer placements (most accurate)
      const pls = Array.isArray(x?.placements) ? x.placements : [];
      if (pls.some((p) => p?.target_type === "system" && p?.target_id === systemFilterId)) return true;

      // Fallbacks (in case rows are denormalized)
      if (x?.system_id && x.system_id === systemFilterId) return true;
      if (x?.target_type === "system" && x?.target_id === systemFilterId) return true;

      return false;
    };

    let out = (normalized || []).filter((x) => tabOk(x) && roleOk(x) && systemOk(x));

    // If we were opened in a scoped context (e.g., a specific System), only show attachments that are already associated to it.
    // NOTE: supports both explicit scope params AND legacy "targetType/targetId" navigation.
    if (effectiveScopeType && effectiveScopeId) {
      out = out.filter((x) => {
        const pls = Array.isArray(x?.placements) ? x.placements : [];
        return pls.some(
          (p) => p?.target_type === effectiveScopeType && p?.target_id === effectiveScopeId
        );
      });
    }


    if (query) {
      out = out.filter((x) => {
        const hay = `${x.title} ${x.notes} ${x.file_name} ${x.url}`.toLowerCase();
        return hay.includes(query);
      });
    }

    out.sort((a, b) => {
      if (sort === "title") return safeStr(a.title).localeCompare(safeStr(b.title));
      const da = a.created_at || "";
      const db = b.created_at || "";
      if (sort === "oldest") return da.localeCompare(db);
      return db.localeCompare(da);
    });

    return out;
  }, [normalized, q, roleFilter, systemFilterId, sort, tab, effectiveScopeType, effectiveScopeId]);

  const active = selected || filtered?.[0] || null;

  // Compute hero preview URL for web preview (PDF + images) using signed URL
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!active || active.kind === "link") {
        setHeroUrl(null);
        setHeroIsPdf(false);
        setHeroLoading(false);
        return;
      }

      const ext = getExt(active.file_name || "");
      const isPdf = ext === "pdf" || isPdfMime(active.mime_type);
      setHeroIsPdf(isPdf);

      // Only render the big preview on web. Mobile uses the modal viewer.
      if (!IS_WEB || !active.storage_path) {
        setHeroUrl(null);
        setHeroLoading(false);
        return;
      }

      setHeroLoading(true);
      try {
        const url = await getSignedUrl({
          bucket: active.bucket || BUCKET,
          path: active.storage_path,
          expiresIn: 60 * 30,
        });
        if (!cancelled) setHeroUrl(url || null);
      } catch (e) {
        if (!cancelled) setHeroUrl(null);
      } finally {
        if (!cancelled) setHeroLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Associations for the currently selected attachment (all placements that share attachment_id)
  const associationsForSelected = useMemo(() => {
    if (!selected) return [];
    const pls = Array.isArray(selected.placements) ? selected.placements : [];
    return pls;
  }, [selected]);

  // Route-level context (e.g., opened from a timeline record or system)
  const hasContextRoute = !!(fromTargetType && fromTargetId);
  const contextPlacementExists = useMemo(() => {
    if (!hasContextRoute || !selected?.attachment_id || !normalized?.length) return false;
    return normalized.some(
      (row) =>
        row.attachment_id === selected.attachment_id &&
        row.target_type === fromTargetType &&
        row.target_id === fromTargetId
    );
  }, [fromTargetId, fromTargetType, hasContextRoute, normalized, selected]);

  const handleBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation.navigate("Boats");
  };


  const ensureSignedUrlForRow = useCallback(async (row) => {
    if (!row) return null;
    const key = row.attachment_id || row.id || row.storage_path || row.url || "";
    if (!key) return null;

    if (signedUrlCacheRef.current.has(key)) {
      return signedUrlCacheRef.current.get(key);
    }

    // Links don't need signing
    if (row.kind === "link") {
      const u = safeStr(row.url) || null;
      signedUrlCacheRef.current.set(key, u);
      return u;
    }

    // Stored media
    if (row.storage_path) {
      try {
        const u = await getSignedUrl({
          bucket: row.bucket || BUCKET,
          path: row.storage_path,
          expiresIn: 60 * 30,
        });
        signedUrlCacheRef.current.set(key, u || null);
        return u || null;
      } catch (e) {
        signedUrlCacheRef.current.set(key, null);
        return null;
      }
    }

    // No safe fallback for files/photos. If we don't have storage_path,
    // treat it as unavailable rather than trusting a persisted URL.
    signedUrlCacheRef.current.set(key, null);
    return null;
  }, [getSignedUrl]);

  const toViewerAttachment = useCallback((row, signedUrl) => {
    if (!row) return null;
    return {
      kind: row.kind,
      title: row.title,
      notes: row.notes,
      mime_type: row.mime_type,
      contentType: row.mime_type,
      fileName: row.file_name,
      url: row.url,
      urls: { signed: signedUrl || null },
      bucket: row.bucket,
      storage_path: row.storage_path,
      created_at: row.created_at,
      placement_id: row.asset_placement_id || row.placement_id,
      attachment_id: row.attachment_id,
    };
  }, []);

  const openViewerForRow = useCallback(async (row) => {
    if (!row) return;
    const idx = Math.max(0, (filtered || []).findIndex((x) => x.attachment_id === row.attachment_id));
    const signed = await ensureSignedUrlForRow(row);
    setViewerIndex(idx >= 0 ? idx : 0);
    setViewerAttachment(toViewerAttachment(row, signed));
    setViewerVisible(true);
  }, [ensureSignedUrlForRow, filtered, toViewerAttachment]);

  // Keep modal attachment in sync with index changes
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!viewerVisible) return;
      const row = (filtered || [])[viewerIndex] || null;
      if (!row) return;
      const signed = await ensureSignedUrlForRow(row);
      if (!cancelled) setViewerAttachment(toViewerAttachment(row, signed));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [viewerVisible, viewerIndex, filtered, ensureSignedUrlForRow, toViewerAttachment]);

  const openAttachment = useCallback(async (row) => {
    if (!row) return;

    if (row.kind === "link") {
      const u = normalizeUrl(row.url || "");
      if (!u) return;
      try {
        const ok = await Linking.canOpenURL(u);
        if (!ok) throw new Error("Cannot open this URL on this device.");
        await Linking.openURL(u);
      } catch (e) {
        Alert.alert("Open failed", e?.message || "Could not open link.");
      }
      return;
    }

    const signed = await ensureSignedUrlForRow(row);

    if (!signed) {
      Alert.alert("Open failed", "Could not create a signed URL.");
      return;
    }

    try {
      const ok = await Linking.canOpenURL(signed);
      if (!ok) throw new Error("Cannot open this file on this device.");
      await Linking.openURL(signed);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open attachment.");
    }
  }, [ensureSignedUrlForRow]);

  const ensureMediaPermission = useCallback(async () => {
    if (IS_WEB) return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === "granted";
  }, []);

  const addPhoto = useCallback(async () => {
if (IS_WEB) {
  triggerWebPicker("photo");
  return;
}

    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const ok = await ensureMediaPermission();
      if (!ok) {
        Alert.alert("Permission required", "Please allow photo library access.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a?.uri) return;

      // Build placements so that uploads from a System Story (or record) are
      // *immediately* associated to that context as well as the asset.
      const placements = [
        { target_type: "asset", target_id: assetId, role: "other" },
      ];

      if (
        fromTargetType &&
        fromTargetId &&
        (fromTargetType === "system" || fromTargetType === "service_record")
      ) {
        placements.push({
          target_type: fromTargetType,
          target_id: fromTargetId,
          role: fromTargetRole || "other",
        });
      }

      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "photo.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements,
      });
      await refresh();
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload photo.");
    }
  }, [assetId, ensureMediaPermission, fromTargetId, fromTargetRole, fromTargetType, refresh]);

  const addFile = useCallback(async () => {
    if (IS_WEB) {
      triggerWebPicker("file");
      return;
    }

    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (res.canceled) return;
      const f = res.assets?.[0];
      if (!f?.uri) return;

      const placements = [
        { target_type: "asset", target_id: assetId, role: "other" },
      ];

      if (
        fromTargetType &&
        fromTargetId &&
        (fromTargetType === "system" || fromTargetType === "service_record")
      ) {
        placements.push({
          target_type: fromTargetType,
          target_id: fromTargetId,
          role: fromTargetRole || "other",
        });
      }

      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "file",
        fileUri: f.uri,
        fileName: f.name || f.uri.split("/").pop() || "file",
        mimeType: f.mimeType || "application/octet-stream",
        sizeBytes: f.size || null,
        placements,
      });

      await refresh();
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload file.");
    }
  }, [assetId, fromTargetId, fromTargetRole, fromTargetType, refresh]);

  const addLink = useCallback(async ({ url, title, notes }) => {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Not signed in.");

    const placements = [
      { target_type: "asset", target_id: assetId, role: "other" },
    ];

    if (
      fromTargetType &&
      fromTargetId &&
      (fromTargetType === "system" || fromTargetType === "service_record")
    ) {
      placements.push({
        target_type: fromTargetType,
        target_id: fromTargetId,
        role: fromTargetRole || "other",
      });
    }

    await createLinkAttachment({
      userId,
      assetId,
      url,
      title,
      notes,
      placements,
    });

    await refresh();
  }, [assetId, fromTargetId, fromTargetRole, fromTargetType, refresh]);

const openAdd = () => {
  if (uploading) return;  
  if (IS_WEB) {
    setAddMenuOpen(true);
    return;
  }
    Alert.alert("Add attachment", "What would you like to add?", [
      { text: "Cancel", style: "cancel" },
      { text: "Photo", onPress: addPhoto },
      { text: "File", onPress: addFile },
      { text: "Link", onPress: () => setAddLinkOpen(true) },
    ]);
  };

  const saveMeta = useCallback(async () => {
    if (!selected?.attachment_id) return;

    const title = safeStr(draftTitle).trim();
    if (!title) {
      Alert.alert("Title required", "Add a short title so you can find this later.");
      return;
    }

    const patch = {
      title,
      notes: safeStr(draftNotes).trim() || null,
    };

    if (selected.kind === "link") {
      const u = normalizeUrl(draftUrl);
      if (!u) {
        Alert.alert("URL required", "Add a valid link URL.");
        return;
      }
      patch.url = u;
    }

    try {
      await apiUpdateAttachment(selected.attachment_id, patch);

      // Let anyone listening know we changed this attachment
      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId,
          attachmentId: selected.attachment_id,
        });
      } catch {}

      await refresh();
      Alert.alert("Saved", "Attachment updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    }
  }, [assetId, draftNotes, draftTitle, draftUrl, refresh, selected]);

  const openEnhance = useCallback((row) => {
    if (!row) return;
    setSelected(row);
    setDraftTitle(safeStr(row.title));
    setDraftNotes(safeStr(row.notes));
    setDraftUrl(safeStr(row.url));
    setEnhanceRow(row);
    setEnhanceOpen(true);
  }, []);

  // Update the attachment's role for this asset (placement-level)
  const updateAssetRole = useCallback(
    async (newRole) => {
      if (!selected?.asset_placement_id && !(selected?.asset_placement_ids?.length > 0)) return;
      const nextRole = safeStr(newRole).trim() || "other";

      try {
        const ids = selected?.asset_placement_ids?.length
          ? selected.asset_placement_ids
          : [selected.asset_placement_id];

        for (const id of ids) {
          if (!id) continue;
          await apiUpdatePlacementById(id, { role: nextRole });
        }

        try {
          DeviceEventEmitter.emit("keepr:attachment:updated", {
            assetId,
            attachmentId: selected.attachment_id,
          });
        } catch {}

        setSelected((prev) => (prev ? { ...prev, role: nextRole } : prev));
        await refresh();
      } catch (e) {
        Alert.alert(
          "Role update failed",
          e?.message || "Could not update this attachment's role."
        );
      }
    },
    [assetId, refresh, selected]
  );

  const removeFromThisAsset = useCallback(async () => {
    if (!selected?.asset_placement_id && !(selected?.asset_placement_ids?.length > 0)) return;
    const ok = await confirmDestructive("Remove from this asset? (Keeps it if used elsewhere.)");
    if (!ok) return;

    try {
      const ids = selected?.asset_placement_ids?.length
        ? selected.asset_placement_ids
        : [selected.asset_placement_id];

      for (const id of ids) {
        if (!id) continue;
        await apiDeletePlacementById(id);
      }
      setSelected(null);
      await refresh();
    } catch (e) {
      Alert.alert("Remove failed", e?.message || "Could not remove from asset.");
    }
  }, [refresh, selected]);

  const addAssociation = useCallback(async () => {
    if (!selected?.attachment_id) return;

    const tType = safeStr(targetType).trim();
    const tId = safeStr(targetId).trim();
    const r = safeStr(targetRole).trim() || null;

    if (!tType || !tId) {
      Alert.alert(
        "Missing info",
        "Choose a system or record (or use advanced ID) before attaching."
      );
      return;
    }

    try {
      if (assocBusyRef.current) return;
      assocBusyRef.current = true;
      setAssocBusy(true);
      await apiUpsertPlacement({
        attachment_id: selected.attachment_id,
        target_type: tType,
        target_id: tId,
        role: r,
      });
      setTargetId("");
      setSystemSelection(null);
      setRecordSelection(null);

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId,
          attachmentId: selected.attachment_id,
        });
      } catch {}

      await refresh();
    } catch (e) {
      Alert.alert("Associate failed", e?.message || "Could not add association.");
    } finally {
      assocBusyRef.current = false;
      setAssocBusy(false);
    }
  }, [
    assetId,
    refresh,
    selected,
    targetId,
    targetRole,
    targetType,
    setAssocBusy,
  ]);

  const attachToContext = useCallback(async () => {
    if (!selected?.attachment_id || !fromTargetType || !fromTargetId) return;
    if (contextPlacementExists) return;

    try {
      if (assocBusyRef.current) return;
      assocBusyRef.current = true;
      setAssocBusy(true);
      await apiUpsertPlacement({
        attachment_id: selected.attachment_id,
        target_type: fromTargetType,
        target_id: fromTargetId,
        role: fromTargetRole || null,
      });

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId,
          attachmentId: selected.attachment_id,
        });
      } catch {}

      await refresh();
    } catch (e) {
      Alert.alert("Associate failed", e?.message || "Could not attach to this context.");
    } finally {
      assocBusyRef.current = false;
      setAssocBusy(false);
    }
  }, [
    assetId,
    contextPlacementExists,
    fromTargetId,
    fromTargetRole,
    fromTargetType,
    refresh,
    selected,
  ]);

  const canOpenAssociation = useCallback((p) => {
    const t = p?.target_type;
    return t === "system";
  }, []);

  const openAssociation = useCallback(
    (p) => {
      if (!p?.target_type || !p?.target_id) return;
      if (p.target_type === "system") {
        // Boat systems: deep-link into the system story
        navigation.navigate("BoatSystemStory", {
          systemId: p.target_id,
          boatId: assetId,
          boatName: assetName,
        });
        return;
      }

      Alert.alert(
        "Not available yet",
        "Only system links are wired right now."
      );
    },
    [assetId, assetName, navigation]
  );

  const removeAssociation = useCallback(async (placementId) => {
    const ok = await confirmDestructive("Remove this association?");
    if (!ok) return;
    try {
      setAssocBusy(true);
      await apiDeletePlacementById(placementId);

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId,
          attachmentId: selected?.attachment_id || null,
        });
      } catch {}

      await refresh();
    } catch (e) {
      Alert.alert("Remove failed", e?.message || "Could not remove association.");
    } finally {
      setAssocBusy(false);
    }
  }, [assetId, refresh, selected?.attachment_id]);

  const canToggleShowcase =
    !!selected &&
    selected._isPhoto &&
    (selected.target_type === "asset" || selected.target_type === "system");

  const handleToggleShowcase = useCallback(async () => {
    if (!selected || !canToggleShowcase) return;
    if (!selected.attachment_id || !selected.target_type || !selected.target_id) return;

    const nextValue = !selected.is_showcase;

    try {
      setShowcaseBusy(true);

      await apiSetPlacementShowcase({
        attachment_id: selected.attachment_id,
        target_type: "asset",
        target_id: assetId,
        is_showcase: nextValue,
      });


      // Update local selected so UI responds immediately
      setSelected((prev) =>
        prev && (prev.attachment_id === selected.attachment_id)
          ? { ...prev, is_showcase: nextValue }
          : prev
      );

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId,
          attachmentId: selected.attachment_id,
        });
      } catch {}

      await refresh();
    } catch (e) {
      Alert.alert("Showcase update failed", e?.message || "Could not update showcase flag.");
    } finally {
      setShowcaseBusy(false);
    }
  }, [assetId, canToggleShowcase, refresh, selected]);

return (
  <SafeAreaView style={[layoutStyles.screen, styles.screen]}>

    {IS_WEB ? (
      <View style={{ width: 0, height: 0, overflow: "hidden" }}>
        {/* iPad/Safari: native file inputs are the most reliable picker */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => onWebFileChange(e, "photo")}
          
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          onChange={(e) => onWebFileChange(e, "file")}
        />
      </View>
    ) : null}

    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.assetTitle}>{assetName}</Text>
          <Text style={styles.assetSubtitle} numberOfLines={1}>
            {isScoped ? `Attachments • ${effectiveScopeLabel}` : "Attachments"}
          </Text>
        </View>
        
        {/* Refresh Button */}
        <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={refresh}
          style={styles.smallIconBtn}
          disabled={loading || uploading}
          accessibilityLabel="Refresh attachments"
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons name="refresh" size={28} color={colors.textSecondary} />
          )}
        </TouchableOpacity>

          {!isWide ? (
            <View style={{ position: "relative" }}>
              <TouchableOpacity
                onPress={(e) => {
                  e?.stopPropagation?.();
                  openAdd();
                }}
                style={[styles.circleBtn, styles.circleBtnPrimary, uploading && { opacity: 0.7 }]}
                accessibilityLabel="Add"
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="attach-outline" size={30} color="#fff" />
                )}
              </TouchableOpacity>

            </View>
          ) : null}
                  </View>
                </View>

        {/* Scope / breadcrumb cue */}
        {(isScoped || scopeOverride === "none") && scopeExistsOnRoute ? (
          <View style={styles.scopeBar}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <Ionicons
                name={isScoped ? "funnel-outline" : "information-circle-outline"}
                size={16}
                color={colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              {isScoped ? (
                <Text style={styles.scopeText} numberOfLines={2}>
                  Viewing only: {effectiveScopeType === "system" ? "System" : "Record"} — {effectiveScopeLabel}
                </Text>
              ) : (
                <Text style={styles.scopeText} numberOfLines={2}>
                  Showing all attachments (scope cleared)
                </Text>
              )}
            </View>

            {isScoped ? (
              <TouchableOpacity
                onPress={() => setScopeOverride("none")}
                style={styles.scopeAction}
              >
                <Text style={styles.scopeActionText}>Show all</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setScopeOverride(null)}
                style={styles.scopeAction}
              >
                <Text style={styles.scopeActionText}>Back to scope</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Tabs */}


        {/* Filters */}
        <View style={styles.filtersRow}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search title, notes, filename, URL…"
              style={styles.search}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.pillGroup}>
            <TouchableOpacity
              onPress={() => setSort("newest")}
              style={[styles.pill, sort === "newest" && styles.pillActive]}
            >
              <Text
                style={[
                  styles.pillText,
                  sort === "newest" && styles.pillTextActive,
                ]}
              >
                Newest
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSort("oldest")}
              style={[styles.pill, sort === "oldest" && styles.pillActive]}
            >
              <Text
                style={[
                  styles.pillText,
                  sort === "oldest" && styles.pillTextActive,
                ]}
              >
                Oldest
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSort("title")}
              style={[styles.pill, sort === "title" && styles.pillActive]}
            >
              <Text
                style={[
                  styles.pillText,
                  sort === "title" && styles.pillTextActive,
                ]}
              >
                Title
              </Text>
            </TouchableOpacity>
          </View>

          {/* Preview toggle (web-only) */}
          {IS_WEB && (
            <TouchableOpacity
              onPress={() => setShowPreview((v) => !v)}
              style={[
                styles.pill,
                showPreview && styles.pillActive,
                { marginLeft: 8 },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  showPreview && styles.pillTextActive,
                ]}
              >
                {showPreview ? "Hide Preview" : "Show Preview"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>Filters:</Text>

          <TouchableOpacity
            style={[styles.filterButton, { marginRight: 8 }]}
            onPress={() => setRoleFilterOpen(true)}
          >
            <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.filterButtonText}>
              Role: {roleFilter === "all" ? "All" : roleLabel(roleFilter)}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterButton, systemFilterLocked && { opacity: 0.6 }]}
            onPress={() => {
              if (systemFilterLocked) {
                // Locked by navigation scope (System story). Keep the cue consistent.
                return;
              }
              setSystemFilterOpen(true);
            }}
            disabled={systemFilterLocked}
          >
            <Ionicons name="git-branch-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.filterButtonText} numberOfLines={1}>
              System: {systemFilterDisplayId === "all" ? "All" : (systemFilterDisplayLabel || "Selected")}
            </Text>
            <Ionicons name={systemFilterLocked ? "lock-closed-outline" : "chevron-down"} size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
        >
          {/* Preview – web only, toggleable */}
          {IS_WEB && showPreview && (
            <View style={styles.previewCard}>
              {loading && filtered.length === 0 ? (
                <View style={styles.previewLoading}>
                  <ActivityIndicator />
                  <Text
                    style={{
                      marginTop: 8,
                      color: colors.textSecondary,
                    }}
                  >
                    Loading…
                  </Text>
                </View>
              ) : !active ? (
                <View style={styles.previewEmpty}>
                  <Ionicons
                    name="attach-outline"
                    size={28}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.previewEmptyTitle}>Nothing here yet</Text>
                  <Text style={styles.previewEmptySub}>
                    Tap “+” to add your first attachment.
                  </Text>
                </View>
              ) : active.kind === "link" ? (
                <View style={styles.previewLinkCard}>
                  <View style={styles.previewLinkTop}>
                    <View style={styles.previewLinkIcon}>
                      <Ionicons
                        name="link-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={styles.previewLinkTitle}
                        numberOfLines={1}
                      >
                        {safeStr(active.title) ||
                          titleFromUrl(active.url || "")}
                      </Text>
                      <Text
                        style={styles.previewLinkSub}
                        numberOfLines={1}
                      >
                        {safeStr(active.url)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.previewLinkActions}>
                    <TouchableOpacity
                      onPress={() => openAttachment(active)}
                      style={styles.saveBtn}
                    >
                      <Ionicons
                        name="open-outline"
                        size={18}
                        color="#fff"
                      />
                      <Text style={styles.saveBtnText}>Open</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : active._isPhoto ? (
                <TouchableOpacity
                  activeOpacity={0.95}
                  onPress={() => openViewerForRow(active)}
                  style={styles.previewTouch}
                >
                  {heroUrl ? (
                    <Image
                      source={{ uri: heroUrl }}
                      style={styles.previewImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.previewEmpty}>
                      <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
                      <Text style={styles.previewEmptyTitle}>Preview not available</Text>
                      <Text style={styles.previewEmptySub}>Tap to open.</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.95}
                  onPress={() => openViewerForRow(active)}
                  style={styles.previewDoc}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={28}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={styles.previewDocTitle}
                    numberOfLines={1}
                  >
                    {active.file_name}
                  </Text>
                  <Text style={styles.previewDocSub}>
                    {heroIsPdf && IS_WEB
                      ? "Select an attachment to load in the preview panel."
                      : "Select an attachment to open."}
                  </Text>

                  {heroIsPdf && IS_WEB && (
                    <View style={styles.previewPdfWrapper}>
                      {heroLoading ? (
                        <View style={styles.previewLoading}>
                          <ActivityIndicator />
                        </View>
                      ) : heroUrl ? (
                        <iframe
                          title="PDF preview"
                          src={heroUrl}
                          style={styles.previewPdfFrame}
                        />
                      ) : (
                        <Text style={styles.previewDocSub}>
                          Preview not available. Tap to open.
                        </Text>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
      <View style={styles.tabRow}>
          {[
            ["all", "All"],
            ["photo", "Photos"],
            ["file", "Files"],
            ["link", "Links"],
          ].map(([k, label]) => (
            <TouchableOpacity
              key={k}
              onPress={() => {
                setTab(k);
                setSelected(null);
              }}
              style={[styles.tab, tab === k && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === k && styles.tabTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
            
          ))}
              <TouchableOpacity
              onPress={() => setShowPreview((v) => !v)}
              style={[
                styles.pill,
                showPreview && styles.pillActive,
                { marginLeft: 8 },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  showPreview && styles.pillTextActive,
                ]}
              >
                {showPreview ? "Hide Preview" : "Show Preview"}
              </Text>
            </TouchableOpacity>
        </View>
          {/* 2-column */}
          {isWide ? (
            <View
            style={[styles.grid]}
          >
            {/* Global web add menu (single source of truth) */}
            {IS_WEB && addMenuOpen ? (
              <Modal
                transparent
                animationType="fade"
                onRequestClose={() => setAddMenuOpen(false)}
              >
                <Pressable
                  style={styles.addMenuOverlay}
                  onPress={() => setAddMenuOpen(false)}
                >
                  <Pressable
                    style={styles.addMenuModal}
                    onPress={(e) => e?.stopPropagation?.()}
                  >
                    <Text style={styles.addMenuItem}>Upload an Attachment Type</Text>
                    <TouchableOpacity
                      style={styles.addMenuItem}
                      onPress={() => triggerWebPicker("photo")}
                    >
                      <Ionicons name="image-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.addMenuText}>Photo</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.addMenuItem}
                      onPress={() => triggerWebPicker("file")}
                    >
                      <Ionicons name="document-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.addMenuText}>File</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.addMenuItem}
                      onPress={() => {
                        setAddMenuOpen(false);
                        setAddLinkOpen(true);
                      }}
                    >
                      <Ionicons name="link-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.addMenuText}>Link</Text>
                    </TouchableOpacity>
                  </Pressable>
                </Pressable>
              </Modal>
            ) : null}
            {/* Left list */}
            <View style={styles.leftCol}>
              <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Attachments</Text>

                {/* Right-side header actions (wide screens only) */}
                {isWide ? (
                  <View style={styles.cardHeaderActions}>
                    <TouchableOpacity
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        openAdd();
                      }}
                      style={styles.smallIconBtn}
                      disabled={loading || uploading}
                      accessibilityLabel="Upload attachment"
                    >
                      {uploading ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : (
                        <Ionicons name="attach-outline" size={28} color={colors.textSecondary} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={refresh}
                      style={styles.smallIconBtn}
                      disabled={loading || uploading}
                      accessibilityLabel="Refresh attachments"
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : (
                        <Ionicons name="refresh" size={28} color={colors.textSecondary} />
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={refresh}
                    style={styles.smallIconBtn}
                    disabled={loading || uploading}
                    accessibilityLabel="Refresh attachments"
                  >
                    <Ionicons name="refresh" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

                {!assetId ? (
                  <Text style={styles.emptyText}>Missing assetId. Please go back and re-open this screen.</Text>
                ) : error ? (
                  <Text style={styles.emptyText}>
                    {`Error loading attachments: ${error.message || error}`}
                  </Text>
                ) : loading && filtered.length === 0 ? (
                  <View style={{ paddingVertical: 18, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={[styles.emptyText, { marginTop: 10 }]}>Loading…</Text>
                  </View>
                ) : filtered.length === 0 ? (
                  <Text style={styles.emptyText}>Nothing here yet.</Text>
                ) : (
                  <ScrollView
                    style={styles.leftListScroll}
                    contentContainerStyle={styles.leftListContent}
                    showsVerticalScrollIndicator
                  >
                    {filtered.map((row) => {
                      const isSel = selected?.attachment_id === row.attachment_id;
                      // OR: selected?.asset_placement_id === row.asset_placement_id

                      return (
                        <TouchableOpacity
                          key={row.asset_placement_id || row.placement_id || row.attachment_id}
                          style={[styles.row, isSel && styles.rowSelected]}
                          onPress={() => setSelected(row)}
                        >
                          <View style={styles.rowLeft}>
                            <View style={styles.rowIcon}>
                              <Ionicons
                                name={
                                  row.kind === "link"
                                    ? "link-outline"
                                    : row._isPhoto
                                    ? "image-outline"
                                    : "document-outline"
                                }
                                size={18}
                                color={colors.textPrimary}
                              />
                            </View>

                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowTitle} numberOfLines={1}>
                                {row.title}
                              </Text>

                              <Text style={styles.rowSub} numberOfLines={1}>
                                {row.kind === "link" ? safeStr(row.url) : row.file_name}
                              </Text>

                              <Text style={styles.rowSubSmall} numberOfLines={1}>
                                Added: {formatDate(row.created_at)}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.rowRight}>
                            {row.is_showcase && (
                              <View style={styles.showcaseChip}>
                                <Ionicons
                                  name="star"
                                  size={11}
                                  color="#FACC15"
                                  style={{ marginRight: 4 }}
                                />
                                <Text style={styles.showcaseChipText}>Showcase</Text>
                              </View>
                            )}

                            <Badge text={row.badge} />

                            {/* ✅ Proof Builder and Keepr Intelligence entry point */}
                            <View style={styles.rowRight}>
                              {/* Keepr Intelligence */}
                            <TouchableOpacity
                              style={styles.eyeBtn}
                              onPress={() => {
                                const systemId =
                                  effectiveScopeType === "system" ? effectiveScopeId : null;

                                const attachmentId = row.attachment_id || row.id;

                                navigation.navigate("KeeprIntelligence", { assetId, systemId, attachmentId });
                              }}
                              accessibilityLabel="Intelligence"
                            >
                              <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                              {/* Proof Builder */}
                              <TouchableOpacity
                                style={styles.eyeBtn}
                                onPress={() => navigation.navigate("ProofBuilder", { assetId, attachmentId: row.attachment_id || row.id, role: row.role })}
                                accessibilityLabel="Proof Builder"
                              >
                                <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                              </TouchableOpacity>

                            </View>
                            <TouchableOpacity
                              style={styles.eyeBtn}
                              onPress={() => openAttachment(row)}
                            >
                              <Ionicons
                                name="open-outline"
                                size={18}
                                color={colors.textSecondary}
                              />
                            </TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </View>

            {/* Right editor */}  
            <View style={styles.rightCol}>
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Attachments Role and Association</Text>
                </View>

                <View
                  style={{
                    marginTop: 10,
                    marginBottom: 10,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <TouchableOpacity
                    onPress={removeFromThisAsset}
                    disabled={loading || !selected}
                    style={[
                      styles.deleteBtnTop,
                      (loading || !selected) && { opacity: 0.5 },
                    ]}
                  >
                    <Ionicons
                      name="remove-circle-outline"
                      size={16}
                      color="#fff"
                    />
                    <Text style={styles.deleteBtnTopText}>Remove from Asset</Text>
                  </TouchableOpacity>
                </View>

                {!selected ? (
                  <View style={styles.noSelection}>
                    <Ionicons
                      name="information-circle-outline"
                      size={22}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.noSelectionTitle}>
                      Select an attachment
                    </Text>
                    <Text style={styles.noSelectionSub}>
                      Pick an item to add Keepr context.
                    </Text>
                  </View>
                ) : (
                  <>
                    {/* Block A – Role + Showcase */}
                    <View style={styles.sectionBlock}>
                    <Text style={styles.label}>“What role does this play in your ownership story?”</Text>
                                            <Text style={styles.textSecondary}>
                          The more context, the more you'll know. 
                        </Text>
                    <TouchableOpacity
                      onPress={() => setRoleEditOpen(true)}
                      disabled={!selected?.asset_placement_id}
                      style={[
                        styles.roleEditBtn,
                        !selected?.asset_placement_id && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={styles.label} numberOfLines={1}>
                       Role: {selected?.role ? roleLabel(selected.role) : "Pick One Here"}
                      </Text>
                      <Ionicons
                        name="git-compare-outline"
                        size={30}
                        color={colors.textSecondary}
                        style={{ marginLeft: 8 }}
                      />
                    </TouchableOpacity>
                    </View>
                    {/* Showcase toggle */}
                    {canToggleShowcase && (
                      <View style={styles.showcaseRow}>
                        <Text style={styles.label}>Showcase</Text>
                        <TouchableOpacity
                          onPress={handleToggleShowcase}
                          disabled={showcaseBusy}
                          style={[
                            styles.showcaseToggle,
                            selected.is_showcase && styles.showcaseToggleActive,
                            showcaseBusy && { opacity: 0.6 },
                          ]}
                        >
                          <Ionicons
                            name={
                              selected.is_showcase ? "star" : "star-outline"
                            }
                            size={16}
                            color={
                              selected.is_showcase
                                ? "#FACC15"
                                : colors.textSecondary
                            }
                          />
                          <Text
                            style={[
                              styles.showcaseToggleText,
                              selected.is_showcase &&
                                styles.showcaseToggleTextActive,
                            ]}
                          >
                            {selected.target_type === "system"
                              ? "Showcase Photo for this system"
                              : "Showcase Photo for this asset"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {/* Block B – Attachment Metadata */}
                    <View style={styles.sectionBlock}>
                    <Text style={styles.label}>Title</Text>
                                            <Text style={styles.textSecondary}>
                          Change the file name to something meaningful.
                        </Text>
                    <TextInput
                      value={draftTitle}
                      onChangeText={setDraftTitle}
                      placeholder="Title"
                      style={styles.input}
                    />

                    {selected.kind === "link" ? (
                      <>
                        <Text style={styles.label}>URL</Text>
                        <TextInput
                          value={draftUrl}
                          onChangeText={setDraftUrl}
                          placeholder="https://…"
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.input}
                        />
                      </>
                    ) : null}

                    <Text style={styles.label}>Notes</Text>
                    <TextInput
                      value={draftNotes}
                      onChangeText={setDraftNotes}
                      placeholder="Notes (optional, but searchable)"
                      style={[styles.input, styles.textarea]}
                      multiline
                      textAlignVertical="top"
                    />
                    </View>
                                          <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={saveMeta}
                        disabled={loading}
                        style={[
                          styles.saveBtn,
                          loading && { opacity: 0.6 },
                        ]}
                      >
                        {loading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name="save-outline"
                              size={18}
                              color="#fff"
                            />
                            <Text style={styles.saveBtnText}>Save</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                    <View style={{ height:1, backgroundColor:"#E5E7EB", marginVertical:16 }} />
                    {/* Block C - Existing associations list */}
                    {associationsForSelected.length > 0 && (
                      <View style={{ marginTop: spacing.lg }}>
                        <Text style={styles.sectionTitle}>
                          Where should this be attached?
                        </Text>
                        <Text style={styles.textSecondary}>
                         Every attachment belongs to an Asset.
                          You can also link it to multiple Systems or Records.
                        </Text>
                        {associationsForSelected.map((p) => (
                          <View key={p.id} style={styles.assocRow}>
                            <TouchableOpacity
                              style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => openAssociation(p)}
                              disabled={!canOpenAssociation(p)}
                            >
                              <View style={styles.assocChipGroup}>
                                <View style={styles.assocChip}>
                                  <Text style={styles.assocChipText}>
                                    {p.target_type === "service_record"
                                      ? "record"
                                      : p.target_type}
                                  </Text>
                                </View>
                                {p.role && (
                                  <View
                                    style={[styles.assocChip, styles.assocChipMuted]}
                                  >
                                    <Text style={styles.assocChipText}>
                                      {p.role}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.assocIdText} numberOfLines={1}>
                                {assocDisplayName(p) || p.target_id}
                              </Text>
                            </TouchableOpacity>
                            {p.target_type !== "asset" && (
                              <TouchableOpacity
                                style={styles.assocRemoveBtn}
                                onPress={() => removeAssociation(p.id)}
                              >
                                <Ionicons
                                  name="close-circle-outline"
                                  size={16}
                                  color={colors.textSecondary}
                                />
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Context-aware quick attach */}
                    {hasContextRoute && (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={styles.assocHint}>
                          Current context:{" "}
                          {fromTargetType === "service_record"
                            ? "record"
                            : fromTargetType}{" "}
                          ({safeStr(fromTargetId).slice(0, 8)}…)
                        </Text>
                        <TouchableOpacity
                          onPress={attachToContext}
                          disabled={assocBusy || contextPlacementExists}
                          style={[
                            styles.saveBtn,
                            { marginTop: spacing.xs },
                            (assocBusy || contextPlacementExists) && {
                              opacity: 0.6,
                            },
                          ]}
                        >
                          {assocBusy ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <>
                              <Ionicons
                                name="link-outline"
                                size={18}
                                color="#fff"
                              />
                              <Text style={styles.saveBtnText}>
                                {contextPlacementExists
                                  ? "Already attached"
                                  : "Attach to this context"}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Block D - Add/Edit Association */}
                    <View style={{ marginTop: spacing.lg }}>


                      {/* Role pills 

                      <View style={styles.assocPills}>
                        {["proof", "manual", "receipt", "invoice", "quote", "warranty", "photo album", "support page", "other"].map((r) => (
                          <TouchableOpacity
                            key={r}
                            onPress={() => setTargetRole(r)}
                            style={[
                              styles.pill,
                              targetRole === r && styles.pillActive,
                              {
                                marginRight: 8,
                                marginBottom: 8,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.pillText,
                                targetRole === r && styles.pillTextActive,
                              ]}
                            >
                              {r}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>*/}
                {/* Summary */}
                      <View style={styles.assocSummary}>
                        <Text style={styles.assocSummaryText}>
                          {assocSummaryText}
                        </Text>
                      </View>
                      {/* Picker rows */}
                      <TouchableOpacity
                        style={styles.selectorRow}
                        onPress={() => setSystemPickerOpen(true)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectorLabel}>System</Text>
                          <Text style={styles.selectorValue} numberOfLines={1}>
                            {systemSelectionLabel}
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.selectorRow}
                        onPress={() => setRecordPickerOpen(true)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectorLabel}>
                            What record is this associated?
                          </Text>
                          <Text style={styles.selectorValue} numberOfLines={1}>
                            {recordSelectionLabel}
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

      

                      {/* Attach button */}
                      <TouchableOpacity
                        onPress={addAssociation}
                        disabled={
                          assocBusy || !targetType || !safeStr(targetId).trim()
                        }
                        style={[
                          styles.saveBtn,
                          (assocBusy ||
                            !targetType ||
                            !safeStr(targetId).trim()) && {
                            opacity: 0.6,
                          },
                          { marginTop: spacing.sm },
                        ]}
                      >
                        {assocBusy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name="link-outline"
                              size={18}
                              color="#fff"
                            />
                            <Text style={styles.saveBtnText}>
                              {targetType && safeStr(targetId).trim()
                                ? "Attach"
                                : "Choose a system or record"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
          ) : 
          
          (
            <View style={styles.mobileSplit}>
            <View style={{height: mobilePaneHeight}}>
              <View style={[styles.card, { flex: 1 }]}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Attachments</Text>
                  <TouchableOpacity
                    onPress={refresh}
                    style={styles.smallIconBtn}
                    disabled={loading}
                  >
                    <Ionicons
                      name="refresh"
                      size={16}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                {!assetId ? (
                  <Text style={styles.emptyText}>Missing assetId. Please go back and re-open this screen.</Text>
                ) : error ? (
                  <Text style={styles.emptyText}>
                    {`Error loading attachments: ${error.message || error}`}
                  </Text>
                ) : loading && filtered.length === 0 ? (
                  <View style={{ paddingVertical: 18, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={[styles.emptyText, { marginTop: 10 }]}>Loading…</Text>
                  </View>
                ) : filtered.length === 0 ? (
                  <Text style={styles.emptyText}>Nothing here yet.</Text>
                ) : (
                  <ScrollView
                    style={[styles.leftListScroll, styles.leftListScrollMobile]}
                    contentContainerStyle={styles.leftListContent}
                    showsVerticalScrollIndicator
                  >
                    {filtered.map((row) => {
                      const isSel = selected?.attachment_id === row.attachment_id;
                      // OR: selected?.asset_placement_id === row.asset_placement_id
                      return (
                        <TouchableOpacity
                          key={row.asset_placement_id || row.placement_id || row.attachment_id}
                          style={[styles.row, isSel && styles.rowSelected]}
                          onPress={() => setSelected(row)}
                        >
                          <View style={styles.rowLeft}>
                            <View style={styles.rowIcon}>
                              <Ionicons
                                name={
                                  row.kind === "link"
                                    ? "link-outline"
                                    : row._isPhoto
                                    ? "image-outline"
                                    : "document-outline"
                                }
                                size={18}
                                color={colors.textPrimary}
                              />
                            </View>

                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowTitle} numberOfLines={1}>
                                {row.title}
                              </Text>

                              <Text style={styles.rowSub} numberOfLines={1}>
                                {row.kind === "link" ? safeStr(row.url) : row.file_name}
                              </Text>

                              <Text style={styles.rowSubSmall} numberOfLines={1}>
                                Added: {formatDate(row.created_at)}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.rowRight}>
                            {row.is_showcase && (
                              <View style={styles.showcaseChip}>
                                <Ionicons
                                  name="star"
                                  size={11}
                                  color="#FACC15"
                                  style={{ marginRight: 4 }}
                                />
                                <Text style={styles.showcaseChipText}>Showcase</Text>
                              </View>
                            )}

                            <Badge text={row.badge} />

                            {/* ✅ Proof Builder and Keepr Intelligence entry point */}
                            <View style={styles.rowRight}>
                              {/* Keepr Intelligence */}
                            <TouchableOpacity
                              style={styles.eyeBtn}
                              onPress={() => {
                                const systemId =
                                  effectiveScopeType === "system" ? effectiveScopeId : null;

                                const attachmentId = row.attachment_id || row.id;

                                navigation.navigate("KeeprIntelligence", { assetId, systemId, attachmentId });
                              }}
                              accessibilityLabel="Intelligence"
                            >
                              <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} />
                              
                            </TouchableOpacity>
                              {/* Proof Builder */}
                              <TouchableOpacity
                                style={styles.eyeBtn}
                                
                                onPress={() => navigation.navigate("ProofBuilder", { assetId, attachmentId: row.attachment_id || row.id, role: row.role })}
                                accessibilityLabel="Proof Builder"
                              >
                                <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                              </TouchableOpacity>

                            </View>
                            <TouchableOpacity
                              style={styles.eyeBtn}
                              onPress={() => openAttachment(row)}
                            >
                              <Ionicons
                                name="open-outline"
                                size={18}
                                color={colors.textSecondary}
                              />
                            </TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </View>

              <View style={{ height: mobilePaneHeight, marginTop: spacing.md }}>
              <View style={styles.sectionBlock}></View>
              <View style={[styles.card, { flex: 1 }]}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Attachments Role and Association</Text>
                </View>

                {/* Remove given its own line on mobile and web */}
                <TouchableOpacity
                  onPress={removeFromThisAsset}
                  disabled={loading || !selected}
                  style={[
                    styles.deleteBtnTop,
                    (loading || !selected) && { opacity: 0.5 },
                    { marginTop: 10, marginBottom: 10, marginHorizontal: 12 },
                  ]}
                >
                  <Ionicons
                    name="remove-circle-outline"
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.deleteBtnTopText}>Remove from Asset</Text>
                </TouchableOpacity>

                <ScrollView
                  style={styles.contextScroll}
                  contentContainerStyle={styles.contextScrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {!selected ? (
                    <View style={styles.noSelection}>
                      <Ionicons
                        name="information-circle-outline"
                        size={22}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.noSelectionTitle}>
                        Select an attachment
                      </Text>
                      <Text style={styles.noSelectionSub}>
                        Pick an item to add Keepr context.
                      </Text>
                    </View>
                  ) : (
                    <>

                    {/* Role editor for this asset placement */}
                    <Text style={styles.label}>"What story role does this play in ownership?"</Text>
                    <Text style={styles.textSecondary}>
                          More context, the more you'll know, and easier to find.
                        </Text>
                    <TouchableOpacity
                      onPress={() => setRoleEditOpen(true)}
                      disabled={!selected?.asset_placement_id}
                      style={[
                        styles.roleEditBtn,
                        !selected?.asset_placement_id && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={styles.label} numberOfLines={1}>
                        Role: {selected?.role ? roleLabel(selected.role) : "Pick One Here"}
                      </Text>
                      <Ionicons
                        name="git-compare-outline"
                        size={30}
                        color={colors.textSecondary}
                        style={{ marginLeft: 8 }}
                      />
                    </TouchableOpacity>
                    {/* Showcase toggle */}
                    {canToggleShowcase && (
                      <View style={styles.showcaseRow}>
                        <Text style={styles.label}>Showcase</Text>
                        <TouchableOpacity
                          onPress={handleToggleShowcase}
                          disabled={showcaseBusy}
                          style={[
                            styles.showcaseToggle,
                            selected.is_showcase && styles.showcaseToggleActive,
                            showcaseBusy && { opacity: 0.6 },
                          ]}
                        >
                          <Ionicons
                            name={
                              selected.is_showcase ? "star" : "star-outline"
                            }
                            size={16}
                            color={
                              selected.is_showcase
                                ? "#FACC15"
                                : colors.textSecondary
                            }
                          />
                          <Text
                            style={[
                              styles.showcaseToggleText,
                              selected.is_showcase &&
                                styles.showcaseToggleTextActive,
                            ]}
                          >
                            {selected.target_type === "system"
                              ? "Showcase Photo for this system"
                              : "Showcase Photo for this asset"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.sectionBlock}>
                    <Text style={styles.label}>Title</Text>
                    <Text style={styles.textSecondary}>
                          Change the file name to something meaningful.
                        </Text>
                    <TextInput
                      value={draftTitle}
                      onChangeText={setDraftTitle}
                      placeholder="Title"
                      style={styles.input}
                    />

                    {selected.kind === "link" ? (
                      <>
                        <Text style={styles.label}>URL</Text>
                        <TextInput
                          value={draftUrl}
                          onChangeText={setDraftUrl}
                          placeholder="https://…"
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.input}
                        />
                      </>
                    ) : null}

                    <Text style={styles.label}>Notes</Text>
                    <TextInput
                      value={draftNotes}
                      onChangeText={setDraftNotes}
                      placeholder="Notes (optional)"
                      style={[styles.input, styles.textarea]}
                      multiline
                      textAlignVertical="top"
                    />
                    </View>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={saveMeta}
                        disabled={loading}
                        style={[
                          styles.saveBtn,
                          loading && { opacity: 0.6 },
                        ]}
                      >
                        {loading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name="save-outline"
                              size={18}
                              color="#fff"
                            />
                            <Text style={styles.saveBtnText}>Save</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                    <View style={{ height:1, backgroundColor:"#E5E7EB", marginVertical:16 }} />
                   
                    {/* Existing associations list */}
                    {associationsForSelected.length > 0 && (
                      <View style={{ marginTop: spacing.lg }}>
                        <Text style={styles.sectionTitle}>
                          Where should this be attached?
                        </Text>
                          <Text style={styles.textSecondary}>
                          Every attachment belongs to an Asset. You can also link it to multiple Systems or Records.
                        </Text>
                        {associationsForSelected.map((p) => (
                          <View key={p.id} style={styles.assocRow}>
                            <TouchableOpacity
                              style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => openAssociation(p)}
                              disabled={!canOpenAssociation(p)}
                            >
                              <View style={styles.assocChipGroup}>
                                <View style={styles.assocChip}>
                                  <Text style={styles.assocChipText}>
                                    {p.target_type === "service_record"
                                      ? "record"
                                      : p.target_type}
                                  </Text>
                                </View>
                                {p.role && (
                                  <View
                                    style={[styles.assocChip, styles.assocChipMuted]}
                                  >
                                    <Text style={styles.assocChipText}>
                                      {p.role}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.assocIdText} numberOfLines={1}>
                                {assocDisplayName(p) || p.target_id}
                              </Text>
                            </TouchableOpacity>
                            {p.target_type !== "asset" && (
                              <TouchableOpacity
                                style={styles.assocRemoveBtn}
                                onPress={() => removeAssociation(p.id)}
                              >
                                <Ionicons
                                  name="close-circle-outline"
                                  size={16}
                                  color={colors.textSecondary}
                                />
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Context-aware quick attach */}
                    {hasContextRoute && (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={styles.assocHint}>
                          Current context:{" "}
                          {fromTargetType === "service_record"
                            ? "record"
                            : fromTargetType}{" "}
                          ({safeStr(fromTargetId).slice(0, 8)}…)
                        </Text>
                        <TouchableOpacity
                          onPress={attachToContext}
                          disabled={assocBusy || contextPlacementExists}
                          style={[
                            styles.saveBtn,
                            { marginTop: spacing.xs },
                            (assocBusy || contextPlacementExists) && {
                              opacity: 0.6,
                            },
                          ]}
                        >
                          {assocBusy ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <>
                              <Ionicons
                                name="link-outline"
                                size={18}
                                color="#fff"
                              />
                              <Text style={styles.saveBtnText}>
                                {contextPlacementExists
                                  ? "Already attached"
                                  : "Attach to this context"}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Associations editor – now picker-first, UUID as advanced */}
                    <View style={{ marginTop: spacing.lg }}>
                      <Text style={styles.sectionTitle}>Add or Edit how this is attached.</Text>
                      <Text style={styles.textSecondary}>
                          Asset, Systems, or Records - Always an Asset, then optional.
                        </Text>

                      {/* Role pills 

                      <View style={styles.assocPills}>
                        {["proof", "manual", "receipt", "invoice", "quote", "warranty", "photo album", "support page", "other"].map((r) => (
                          <TouchableOpacity
                            key={r}
                            onPress={() => setTargetRole(r)}
                            style={[
                              styles.pill,
                              targetRole === r && styles.pillActive,
                              {
                                marginRight: 8,
                                marginBottom: 8,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.pillText,
                                targetRole === r && styles.pillTextActive,
                              ]}
                            >
                              {r}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>*/}

                      {/* Picker rows */}
                      <TouchableOpacity
                        style={styles.selectorRow}
                        onPress={() => setSystemPickerOpen(true)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectorLabel}>System</Text>
                          <Text style={styles.selectorValue} numberOfLines={1}>
                            {systemSelectionLabel}
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.selectorRow}
                        onPress={() => setRecordPickerOpen(true)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectorLabel}>
                            What record is this associated?
                          </Text>
                          <Text style={styles.selectorValue} numberOfLines={1}>
                            {recordSelectionLabel}
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

                      {/* Summary */}
                      <View style={styles.assocSummary}>
                        <Text style={styles.assocSummaryText}>
                          {assocSummaryText}
                        </Text>
                      </View>

                      {/* Attach button */}
                      <TouchableOpacity
                        onPress={addAssociation}
                        disabled={
                          assocBusy || !targetType || !safeStr(targetId).trim()
                        }
                        style={[
                          styles.saveBtn,
                          (assocBusy ||
                            !targetType ||
                            !safeStr(targetId).trim()) && {
                            opacity: 0.6,
                          },
                          { marginTop: spacing.sm },
                        ]}
                      >
                        {assocBusy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name="link-outline"
                              size={18}
                              color="#fff"
                            />
                            <Text style={styles.saveBtnText}>
                              {targetType && safeStr(targetId).trim()
                                ? "Attach"
                                : "Choose a system or record"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                      
                    </View>
                  </>
                )}
                              </ScrollView>
              </View>
            </View>
          </View>
          )}


        </ScrollView>

        <AddLinkModal
          visible={addLinkOpen}
          onClose={() => setAddLinkOpen(false)}
          onCreate={addLink}
        />

        {/* Picker modals */}
        <SystemPickerModal
          visible={systemPickerOpen}
          assetId={assetId}
          onCancel={() => setSystemPickerOpen(false)}
          onSelect={({ id, label }) => {
            setSystemPickerOpen(false);
            setSystemSelection({ id, label });
            setRecordSelection(null);
            setTargetType("system");
            setTargetId(id);
          }}
        />

        <RecordPickerModal
          visible={recordPickerOpen}
          assetId={assetId}
          onCancel={() => setRecordPickerOpen(false)}
          onSelect={({ id, label }) => {
            setRecordPickerOpen(false);
            setRecordSelection({ id, label });
            setSystemSelection(null);
            setTargetType("service_record");
            setTargetId(id);
          }}
        />
              </KeyboardAvoidingView>
           {/* --------------------------- Filter & Role Modals --------------------------- */}
        <Modal
          visible={roleFilterOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setRoleFilterOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Filter by Role</Text>
                <TouchableOpacity onPress={() => setRoleFilterOpen(false)}>
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator>
                <TouchableOpacity
                  style={[
                    styles.modalOptionRow,
                    roleFilter === "all" && styles.modalOptionRowActive,
                  ]}
                  onPress={() => {
                    setRoleFilter("all");
                    setRoleFilterOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      roleFilter === "all" && styles.modalOptionTextActive,
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>

                {ROLE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.modalOptionRow,
                      roleFilter === opt.id && styles.modalOptionRowActive,
                    ]}
                    onPress={() => {
                      setRoleFilter(opt.id);
                      setRoleFilterOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        roleFilter === opt.id && styles.modalOptionTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={systemFilterOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setSystemFilterOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Filter by System</Text>
                <TouchableOpacity onPress={() => setSystemFilterOpen(false)}>
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator>
                <TouchableOpacity
                  style={[
                    styles.modalOptionRow,
                    systemFilterId === "all" && styles.modalOptionRowActive,
                  ]}
                  onPress={() => {
                    setSystemFilterId("all");
                    setSystemFilterOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      systemFilterId === "all" && styles.modalOptionTextActive,
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>

                {Object.values(systemsIndex).map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.modalOptionRow,
                      systemFilterId === s.id && styles.modalOptionRowActive,
                    ]}
                    onPress={() => {
                      setSystemFilterId(s.id);
                      setSystemFilterOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        systemFilterId === s.id && styles.modalOptionTextActive,
                      ]}
                    >
                      {s.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={roleEditOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setRoleEditOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Set Role</Text>
                <TouchableOpacity onPress={() => setRoleEditOpen(false)}>
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator>
                {ROLE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.modalOptionRow,
                      (selected?.role || "other") === opt.id && styles.modalOptionRowActive,
                    ]}
                    onPress={() => {
                      updateAssetRole(opt.id);
                      setRoleEditOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        (selected?.role || "other") === opt.id && styles.modalOptionTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

           </SafeAreaView>
  )     
;
};
const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
  },

  headerRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
cardHeaderActions: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  backLabel: { marginLeft: 6, fontWeight: "600", color: colors.textPrimary },

  headerCenter: { flex: 1, alignItems: "center" },
  assetTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  assetSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  headerRight: { flexDirection: "row", alignItems: "center" },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    ...SHADOW,
  },
  circleBtnPrimary: { backgroundColor: colors.primary },
  sectionBlock: {
  marginTop: spacing.lg,
  paddingTop: spacing.md,
  borderTopWidth: 1,
  borderTopColor: colors.borderSubtle,
},

sectionBlockTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: colors.textPrimary,
  marginBottom: spacing.sm,
},
  scopeBar: {
    paddingHorizontal: spacing.lg,
    marginTop: 2,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  scopeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  scopeAction: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  scopeActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  addMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addMenuText: { marginLeft: 10, fontWeight: "800", color: colors.textPrimary },

addMenuOverlay: {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: "rgba(0,0,0,0.20)", // optional but helps “modal” feel
},
addMenuModal: {
  width: 300,
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  ...SHADOW,
  overflow: "hidden",
},

  tabRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    justifyContent: "left",
    marginBottom: spacing.sm,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginHorizontal: 6,
    ...SHADOW,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontWeight: "700", color: colors.textPrimary },
  tabTextActive: { color: "#fff" },

  filtersRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    flexWrap: "wrap",
  },
  filterLabel: {
    marginRight: 10,
    color: colors.textSecondary,
    fontWeight: "800",
  },

  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    marginBottom: 8,
    maxWidth: 320,
  },
  filterButtonText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "600",
    maxWidth: 240,
  },

  modalOptionRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalOptionRowActive: {
    borderColor: colors.primary,
  },
  modalOptionText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "600",
    paddingRight: 12,
    flex: 1,
  },
  modalOptionTextActive: {
    color: colors.primary,
  },

  // Backdrop + header row used by the role/system filter modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.textPrimary,
    marginRight: spacing.md,
  },

  pillGroup: { flexDirection: "row", alignItems: "center" },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...SHADOW,
  },
  pillActive: { backgroundColor: colors.primary },
  pillText: { fontWeight: "800", color: colors.textPrimary },
  pillTextActive: { color: "#fff" },

  page: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...SHADOW,
    marginBottom: spacing.lg,
  },

  previewTouch: {
    width: "100%",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
    minHeight: 220,
  },

  previewImage: {
    width: "100%",
    aspectRatio: 16 / 9,
  },

  previewDoc: {
    width: "100%",
    height: 220,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
  },
  previewDocTitle: {
    marginTop: 8,
    fontWeight: "800",
    color: colors.textPrimary,
    maxWidth: "90%",
  },
  previewDocSub: { marginTop: 4, color: colors.textSecondary },

  previewPdfWrapper: {
    marginTop: spacing.sm,
    width: "100%",
    alignSelf: "stretch",
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
    minHeight: 160,
  },
  previewPdfFrame: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
  },

  previewLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  previewEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 26,
  },
  previewEmptyTitle: {
    marginTop: 10,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  previewEmptySub: {
    marginTop: 6,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 360,
  },

  previewLinkCard: { padding: spacing.lg },
  previewLinkTop: { flexDirection: "row", alignItems: "center" },
  previewLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  previewLinkTitle: {
    fontWeight: "900",
    color: colors.textPrimary,
    fontSize: 16,
  },
  previewLinkSub: { marginTop: 2, color: colors.textSecondary },
  previewLinkActions: { flexDirection: "row", marginTop: spacing.md },

  grid: { flexDirection: "row" },
  leftCol: { flex: 1, marginRight: spacing.lg },
  rightCol: { width: IS_WEB ? 420 : "100%" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...SHADOW,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  smallIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyText: { marginTop: spacing.sm, color: colors.textSecondary },

  row: {
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 8,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rowTitle: {
    fontWeight: "900",
    color: colors.textPrimary,
    maxWidth: "92%",
  },
  rowSub: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  rowSubSmall: { marginTop: 2, fontSize: 11, color: colors.textSecondary },
  rowRight: { flexDirection: "row", alignItems: "center" },

  eyeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textSecondary,
  },

deleteBtnTop: {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: "#6B7280",
  paddingVertical: 8,
  paddingHorizontal: 8,
  marginTop: 8,
  borderRadius: radius.pill,
},
deleteBtnTopText: {
  color: "#fff",
  fontWeight: "600",
  marginLeft: 6,
},

  label: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.textPrimary,
  },
  textarea: { minHeight: 110 },

  showcaseRow: {
    marginTop: spacing.sm,
  },
  showcaseToggle: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  showcaseToggleActive: {
    borderColor: colors.primary,
    backgroundColor: "rgb(45, 125, 227);",
  },
  showcaseToggleText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  showcaseToggleTextActive: {
    color: "#fff",
  },
  showcaseChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgb(45, 125, 227);",
    marginRight: 6,
  },
  showcaseChipText: {
    color: "#e5e7eb",
    fontSize: 11,
    fontWeight: "700",
  },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
  },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "900",
    marginLeft: 8,
  },

  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    marginLeft: 10,
  },
  previewBtnText: {
    marginLeft: 8,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  sectionTitle: { fontWeight: "900", color: colors.textPrimary },
   sectionNote: { fontWeight: "200", color: colors.textPrimary },

  assocPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.sm,
  },
  assocHint: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 12,
  },

  // Existing associations list
  assocRow: {
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
  },
  assocChipGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  assocChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: 6,
  },
  assocChipMuted: {
    backgroundColor: colors.surfaceSubtle,
  },
  assocChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  assocIdText: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  assocRemoveBtn: {
    marginLeft: 4,
    padding: 2,
  },

  // NEW: picker styles for system/record selectors
  selectorRow: {
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  selectorValue: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textPrimary,
  },
  assocSummary: {
    marginTop: spacing.sm,
  },
  assocSummaryText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  assocAdvancedToggle: {
    fontSize: 11,
    color: colors.primary,
    textDecorationLine: "underline",
  },

  noSelection: { paddingVertical: 26, alignItems: "center" },
  noSelectionTitle: {
    marginTop: 10,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  noSelectionSub: {
    marginTop: 6,
    color: colors.textSecondary,
    textAlign: "center",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...SHADOW,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  modalActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    marginRight: 10,
  },
  modalCancelText: {
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalSave: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  modalSaveText: {
    marginLeft: 8,
    fontWeight: "900",
    color: "#fff",
  },
  leftListScroll: {
    marginTop: spacing.sm,
    // The whole point: scroll inside the left card instead of growing the page
    maxHeight: IS_WEB ? 560 : 520,
  },

  leftListContent: {
    paddingBottom: spacing.md,
  },

  mobileSplit: {
    width: "100%",
  },
  leftListScrollMobile: {
    flex: 1,
  },
  contextScroll: {
    flex: 1,
  },
  contextScrollContent: {
    paddingBottom: 16,
  },

});