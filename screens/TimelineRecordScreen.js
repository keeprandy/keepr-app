// screens/TimelineRecordScreen.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
  Platform,
  Modal,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import DetectedLinkChips from "../components/links/DetectedLinkChips";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "@react-navigation/native";
import { StackActions } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import AttachmentViewerModal from "../components/AttachmentViewerModal";
import { confirmDestructive } from "../lib/confirm";
import { formatKeeprDateWithWeekday } from "../lib/dateFormat";

import {
  listAttachmentsForTarget,
  getSignedUrl,
} from "../lib/attachmentsApi";

import {
  uploadAttachmentFromUri,
  createLinkAttachment,
} from "../lib/attachmentsUploader";

const { width: SCREEN_W } = Dimensions.get("window");
const IS_WEB = Platform.OS === "web";

const UI = {
  pageBg: colors.background || "#f3f4f6",
  cardBg: colors.cardBackground || "#ffffff",
  heroBg: "#020617",
  text: colors.textPrimary || "#020617",
  text2: colors.textSecondary || "#6b7280",
  chipDark: "#0f172a",
  chipSoft: "rgba(15, 23, 42, 0.06)",
  border: "rgba(148, 163, 184, 0.4)",
  surface: "rgba(15, 23, 42, 0.02)",
  primary: colors.primary || "#2563eb",
  borderSubtle: "rgba(148,163,184,0.45)",
};

function domainFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatDate(d) {
  if (!d || typeof d !== "string") return "";
  return formatKeeprDateWithWeekday(d);
}

function money(v) {
  if (v === null || v === undefined || v === "") return "";
  const num = Number(v);
  if (Number.isNaN(num)) return String(v);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `$${num.toFixed(0)}`;
  }
}

function VerificationChip({ label, icon, tone = "default" }) {
  const toneStyles =
    tone === "success"
      ? { bg: "rgba(34,197,94,0.14)", text: "#16a34a" }
      : tone === "warning"
      ? { bg: "rgba(249,115,22,0.14)", text: "#ea580c" }
      : { bg: UI.chipSoft, text: UI.text2 };

  return (
    <View style={[styles.badgeChip, { backgroundColor: toneStyles.bg }]}>
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={toneStyles.text}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Text style={[styles.badgeChipText, { color: toneStyles.text }]}>
        {label}
      </Text>
    </View>
  );
}

function buildSummary(photos, files, links) {
  const parts = [];
  if (photos.length)
    parts.push(`${photos.length} photo${photos.length > 1 ? "s" : ""}`);
  if (files.length)
    parts.push(`${files.length} file${files.length > 1 ? "s" : ""}`);
  if (links.length)
    parts.push(`${links.length} link${links.length > 1 ? "s" : ""}`);
  if (!parts.length) return "No proof attached yet";
  return parts.join(" • ");
}

export default function TimelineRecordScreen({ route, navigation }) {
  const recordId =
    route?.params?.timelineRecordId ||
    route?.params?.recordId ||
    route?.params?.serviceRecordId ||
    route?.params?.id ||
    null;

  // Core data
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [record, setRecord] = useState(null);
  const [recordSource, setRecordSource] = useState(null); // "service_records" | "timeline_records" | null

  // Proof
  const [attachments, setAttachments] = useState([]); // [{id, kind:"photo"|"file", url, title, contentType, created_at}]
  const [links, setLinks] = useState([]); // [{id, url, title, created_at, _source}]

  // UI state
  const [tab, setTab] = useState("all"); // photo | file | link
  const [reloadKey, setReloadKey] = useState(0);

  // Add proof
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addLinkModal, setAddLinkModal] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  // Viewer state: { collectionKey: "photo"|"file"|"link", index: number }
  const [viewer, setViewer] = useState(null);

  // Context/Breadcrumb
  const [assetLabel, setAssetLabel] = useState(route?.params?.assetName || "");
  const [systemLabel, setSystemLabel] = useState(
    route?.params?.systemName || ""
  );
  const [contextLoading, setContextLoading] = useState(false);

  const assetId = record?.asset_id || route?.params?.assetId || null;
  const systemId = record?.system_id || route?.params?.systemId || null;

  const photos = useMemo(
    () => attachments.filter((a) => a.kind === "photo"),
    [attachments]
  );
  const files = useMemo(
    () => attachments.filter((a) => a.kind === "file"),
    [attachments]
  );

  const linkAttachments = useMemo(() => {
    return (links || []).map((l) => ({
      id: l.id,
      placement_id: l.placement_id || null,
      role: l.role || null,
      kind: "link",
      url: l.url,
      title: l.title || domainFromUrl(l.url) || "Link",
      contentType: "text/uri-list",
      created_at: l.created_at,
      raw: l,
    }));
  }, [links]);

  const totalProofCount =
    (photos?.length || 0) +
    (files?.length || 0) +
    (linkAttachments?.length || 0);

  const summaryLine = useMemo(
    () => buildSummary(photos, files, links),
    [photos, files, links]
  );

  const heroUrl = useMemo(() => {
    if (photos.length) return photos[0].url;
    return record?.hero_url || record?.cover_url || null;
  }, [photos, record]);

  // Prefer the first photo proof as the hero. If none, fall back to record hero fields.
  // (This keeps the hero from rendering as a blank/black box.)
  const effectiveHeroUrl = heroUrl || null;

  const heroTitle = record?.title || "Timeline record";
  const heroSubtitle = formatDate(
    record?.performed_at || record?.occurred_at || record?.created_at
  );
  const confidenceLabel = record?.verification_status || "verified";

  const openViewer = (collectionKey, index) =>
    setViewer({ collectionKey, index: index || 0 });
  const closeViewer = () => setViewer(null);

  const currentViewerCollection = useMemo(() => {
    if (!viewer) return [];
    if (viewer.collectionKey === "photo") return photos;
    if (viewer.collectionKey === "file") return files;
    if (viewer.collectionKey === "link") return linkAttachments;
    return [];
  }, [viewer, photos, files, linkAttachments]);

  const currentViewerAttachment = useMemo(() => {
    if (!viewer) return null;
    const col = currentViewerCollection || [];
    const idx = Math.max(0, Math.min(viewer.index || 0, col.length - 1));
    return col[idx] || null;
  }, [viewer, currentViewerCollection]);

  const loadRecordAndProof = useCallback(
    async () => {
      if (!recordId) {
        setRecord(null);
        setRecordSource(null);
        setAttachments([]);
        setLinks([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 1) Load the primary record: prefer service_records, then fall back to timeline_records
        let rec = null;
        let source = null;

        const { data: sr, error: srErr } = await supabase
          .from("service_records")
          .select("*")
          .eq("id", recordId)
          .maybeSingle();

        if (!srErr && sr) {
          rec = sr;
          source = "service_records";
        } else {
          const { data: tr, error: trErr } = await supabase
            .from("timeline_records")
            .select("*")
            .eq("id", recordId)
            .maybeSingle();

          if (!trErr && tr) {
            rec = tr;
            source = "timeline_records";
          }
        }

        setRecord(rec);
        setRecordSource(source);

        if (!rec) {
          setAttachments([]);
          setLinks([]);
          return;
        }

        // 2) Load proof from the NEW attachments model only
const newRows = await listAttachmentsForTarget(
  "service_record",
  recordId
);

        const normalized = [];
        const linkRows = [];

        for (const a of newRows || []) {
          const kind = a.kind || "";
          const mime = String(a.mime_type || "").toLowerCase();
          const isImage = kind === "photo" || mime.startsWith("image/");
          const isLink = kind === "link";

          // Links
          if (isLink) {
            if (!a.url) continue;
            linkRows.push({
              id: a.attachment_id,
              placement_id: a.placement_id || a.id || null,
              role: a.role || null,
              url: a.url,
              title: a.title || null,
              created_at: a.created_at,
              _source: "attachments_new",
            });
            continue;
          }

          // Photos / files
          let url = a.url || null;

          if (!url && a.bucket && a.storage_path) {
            try {
              url = await getSignedUrl({
                bucket: a.bucket,
                path: a.storage_path,
              });
            } catch (err) {
              console.log("TimelineRecordScreen signed URL error", err);
            }
          }

          if (!url) continue;

          if (isImage) {
            normalized.push({
              id: a.attachment_id,
              placement_id: a.placement_id || a.id || null,
              role: a.role || null,
              kind: "photo",
              url,
              title: a.title || a.file_name || "Photo",
              contentType: a.mime_type || "image/jpeg",
              created_at: a.created_at,
            });
          } else {
            normalized.push({
              id: a.attachment_id,
              placement_id: a.placement_id || a.id || null,
              role: a.role || null,
              kind: "file",
              url,
              title: a.title || a.file_name || "File",
              contentType: a.mime_type || "",
              created_at: a.created_at,
            });
          }
        }

        // Sort links oldest → newest (optional)
        linkRows.sort((a, b) => {
          const da = new Date(a.created_at || 0).getTime();
          const db = new Date(b.created_at || 0).getTime();
          return da - db;
        });

        setAttachments(normalized);
        setLinks(linkRows);
      } catch (e) {
        console.error("TimelineRecordScreen load error", e);
        Alert.alert(
          "Problem loading record",
          "Something went wrong while loading this record."
        );
      } finally {
        setLoading(false);
      }
    },
    [recordId]
  );

  // Initial load + refresh
  useEffect(() => {
    loadRecordAndProof();
  }, [loadRecordAndProof, reloadKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRecordAndProof();
    } finally {
      setRefreshing(false);
    }
  }, [loadRecordAndProof]);
useFocusEffect(
  useCallback(() => {
    // when coming back to this screen, ensure proof is fresh
    setReloadKey((k) => k + 1);
  }, [])
);

  // Context loader for breadcrumb (best-effort)
  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      if (!record?.asset_id) return;

      setContextLoading(true);
      try {
        // Asset label
        const { data: assetRow } = await supabase
          .from("assets")
          .select("id,name")
          .eq("id", record.asset_id)
          .maybeSingle();

        if (!cancelled && assetRow?.name) setAssetLabel(assetRow.name);

        // System label (optional; try likely tables)
        const sysId = record?.system_id;
        if (sysId) {
          const candidates = [
            "home_systems",
            "vehicle_systems",
            "boat_systems",
            "systems",
          ];
          for (const table of candidates) {
            const { data } = await supabase
              .from(table)
              .select("id,name,title")
              .eq("id", sysId)
              .maybeSingle();

            const name = data?.name || data?.title;
            if (!cancelled && name) {
              setSystemLabel(name);
              break;
            }
          }
        }
      } catch (e) {
        console.log("context load error", e?.message || e);
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };

    loadContext();
    return () => {
      cancelled = true;
    };
  }, [record?.asset_id, record?.system_id]);

  // Delete attachment from viewer (new model: remove the association to THIS record only)
  const handleDeleteCurrentAttachment = async () => {
    const att = currentViewerAttachment;
    if (!att?.id) return;

    try {
      // Prefer deleting the specific placement row when we have it
      if (att.placement_id) {
        const { error } = await supabase
          .from("attachment_placements")
          .delete()
          .eq("id", att.placement_id);
        if (error) throw error;
      } else {
        let q = supabase
          .from("attachment_placements")
          .delete()
          .eq("attachment_id", att.id)
          .eq("target_type", "service_record")
          .eq("target_id", recordId);

        // If the row is role-unique, this helps avoid removing the wrong one
        if (att.role) q = q.eq("role", att.role);

        const { error } = await q;
        if (error) throw error;
      }

      closeViewer();
      setReloadKey((k) => k + 1);
    } catch (e) {
      console.error("remove association failed", e);
      Alert.alert(
        "Unable to remove",
        e?.message || "We couldn't remove that association."
      );
    }
  };

  // Add proof actions (new attachments pipeline)
  const pickPhoto = async () => {
    if (!recordId || !assetId) {
      Alert.alert(
        "Cannot add photo",
        "This record needs to be linked to an asset before you can attach proof."
      );
      return;
    }

    try {
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm?.granted && perm?.status !== "granted") {
          Alert.alert("Permission needed", "We need access to your photos.");
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType?.Images
          ? [ImagePicker.MediaType.Images]
          : ImagePicker.MediaTypeOptions?.Images || "Images",
        quality: 0.9,
        allowsMultipleSelection: true,
      });

      if (result.canceled) return;

      const picked = result.assets || [];
      if (!picked.length) return;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        Alert.alert("Not signed in", "You need to be signed in to upload.");
        return;
      }

      const baseSourceContext = {
        screen: "TimelineRecordScreen",
        source_type: "timeline_record",
        source_id: recordId,
        asset_id: assetId,
        system_id: systemId || null,
      };

      const basePlacements = [
        {
          target_type: "service_record",
          target_id: recordId,
          role: "proof",
        },
        { target_type: "asset", target_id: assetId, role: "proof" },
        ...(systemId
          ? [{ target_type: "system", target_id: systemId, role: "proof" }]
          : []),
      ];

      for (const a of picked) {
        const fileName =
          a.fileName || (a.uri ? a.uri.split("/").pop() : "photo.jpg");

        await uploadAttachmentFromUri({
          userId,
          assetId,
          kind: "photo",
          fileUri: a.uri,
          fileName,
          mimeType: a.mimeType || "image/jpeg",
          sizeBytes: a.fileSize || null,
          title: null,
          notes: null,
          sourceContext: baseSourceContext,
          placements: basePlacements,
        });
      }

      setAddSheetOpen(false);
      setTab("all");
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("pickPhoto failed", err);
      Alert.alert(
        "Upload failed",
        err?.message || "We couldn't upload that photo just yet."
      );
    } finally {
      setAddSheetOpen(false);
      setTab("all");
    }
  };

  const pickFile = async () => {
    if (!recordId || !assetId) {
      Alert.alert(
        "Cannot add file",
        "This record needs to be linked to an asset before you can attach proof."
      );
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const picked = result.assets || [];
      if (!picked.length) return;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        Alert.alert("Not signed in", "You need to be signed in to upload.");
        return;
      }

      const baseSourceContext = {
        screen: "TimelineRecordScreen",
        source_type: "timeline_record",
        source_id: recordId,
        asset_id: assetId,
        system_id: systemId || null,
      };

      const basePlacements = [
        {
          target_type: "service_record",
          target_id: recordId,
          role: "proof",
        },
        { target_type: "asset", target_id: assetId, role: "proof" },
        ...(systemId
          ? [{ target_type: "system", target_id: systemId, role: "proof" }]
          : []),
      ];

      for (const f of picked) {
        const fileName = f.name || f.fileName || "document";
        const mimeType = f.mimeType || "application/octet-stream";

        await uploadAttachmentFromUri({
          userId,
          assetId,
          kind: "file",
          fileUri: f.uri,
          fileName,
          mimeType,
          sizeBytes: f.size || null,
          title: null,
          notes: null,
          sourceContext: baseSourceContext,
          placements: basePlacements,
        });
      }

      setAddSheetOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("pickFile failed", err);
      Alert.alert(
        "Upload failed",
        err?.message || "We couldn't upload that file just yet."
      );
    } finally {
      setAddSheetOpen(false);
    }
  };

  const saveLink = async () => {
    const url = String(newLinkUrl || "").trim();
    const title = String(newLinkTitle || "").trim();
    if (!url) {
      Alert.alert("Add link", "Please enter a URL.");
      return;
    }
    if (!recordId || !assetId) {
      Alert.alert("Cannot add link", "Record/asset info missing.");
      return;
    }

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        Alert.alert(
          "Not signed in",
          "You need to be signed in to save a link."
        );
        return;
      }

      const baseSourceContext = {
        screen: "TimelineRecordScreen",
        source_type: "timeline_record",
        source_id: recordId,
        asset_id: assetId,
        system_id: systemId || null,
      };

      const basePlacements = [
        {
          target_type: "service_record",
          target_id: recordId,
          role: "proof",
        },
        { target_type: "asset", target_id: assetId, role: "proof" },
        ...(systemId
          ? [{ target_type: "system", target_id: systemId, role: "proof" }]
          : []),
      ];

      await createLinkAttachment({
        userId,
        assetId,
        url,
        title: title || null,
        notes: null,
        sourceContext: baseSourceContext,
        placements: basePlacements,
      });

      setNewLinkTitle("");
      setNewLinkUrl("");
      setAddLinkModal(false);
      setTab("all");
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("saveLink failed", err);
      Alert.alert(
        "Unable to save link",
        err?.message || "We couldn't save that link yet."
      );
    }
  };

  // Record actions
  const goBack = () => {
    const backTo = route?.params?.backTo || route?.params?.origin;
    if (backTo?.name) {
      navigation.navigate(backTo.name, backTo.params || {});
      return;
    }

    // Optional: callers can pass storyScreen + storyIdParam to ensure back returns to the right story.
    const storyScreen = route?.params?.storyScreen;
    const storyIdParam = route?.params?.storyIdParam;
    if (storyScreen && storyIdParam && assetId) {
      navigation.navigate(storyScreen, {
        [storyIdParam]: assetId,
        initialTab: "Timeline",
      });
      return;
    }

    // If the previous screen is EditTimelineRecord, skip it.
    // This happens when the create flow routes through Edit and then into the record view.
    try {
      const state = navigation?.getState?.();
      const idx = state?.index ?? -1;
      const prev = idx > 0 ? state?.routes?.[idx - 1] : null;
      if (prev?.name === "EditTimelineRecord") {
        if (idx >= 2) {
          navigation.dispatch(StackActions.pop(2));
          return;
        }
        // No earlier route to pop to — fall back to the asset timeline if we can.
        if (assetId && storyScreen && storyIdParam) {
          navigation.navigate(storyScreen, {
            [storyIdParam]: assetId,
            initialTab: "Timeline",
          });
          return;
        }
      }
    } catch {}

    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation.navigate("Dashboard");
  };

  const onEdit = () => {
    navigation.navigate("EditTimelineRecord", { recordId });
  };

  const onDeleteRecord = () => {
    if (!recordId) return;

    confirmDestructive(
      "Delete this record?",
      "This removes the record and its proof from the timeline. This can’t be undone.",
      async () => {
        try {
          const id = recordId;

          // Best-effort: remove proof associations for this record (do NOT delete the underlying files)
          try {
            await supabase
              .from("attachment_placements")
              .delete()
              .eq("target_type", "service_record")
              .eq("target_id", id);
          } catch (cleanupErr) {
            console.log(
              "TimelineRecordScreen delete placements cleanup error",
              cleanupErr
            );
          }

          // Delete from BOTH possible record tables, regardless of source
          try {
            await supabase.from("timeline_records").delete().eq("id", id);
          } catch (trErr) {
            console.log(
              "TimelineRecordScreen delete timeline_records error",
              trErr
            );
          }

          try {
            await supabase.from("service_records").delete().eq("id", id);
          } catch (srErr) {
            console.log(
              "TimelineRecordScreen delete service_records error",
              srErr
            );
          }

          setRecord(null);
          setAttachments([]);
          setLinks([]);
          goBack();
        } catch (e) {
          console.error("delete record failed", e);
          Alert.alert(
            "Delete failed",
            e?.message || "We couldn't delete that record."
          );
        }
      }
    );
  };

  if (loading && !record) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading record…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!record) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>Record not found</Text>
          <Text style={styles.emptyBody}>
            We couldn&apos;t find that timeline record. It may have been deleted
            or moved.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* HEADER */}
        <View style={styles.kHeader}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.kHeaderLeft}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back-outline" size={22} color={UI.text} />
            <Text style={styles.kHeaderTitle} numberOfLines={1}>
              Timeline Record
            </Text>
          </TouchableOpacity>

          <View style={styles.kHeaderRight}>
            <TouchableOpacity
              style={styles.kHeaderIconBtn}
              onPress={onEdit}
              accessibilityLabel="Edit record"
            >
              <Ionicons name="create-outline" size={18} color={UI.text2} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.kHeaderIconBtn}
              onPress={onDeleteRecord}
              accessibilityLabel="Delete record"
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={colors.danger || "#ef4444"}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* BREADCRUMB */}
        <View style={styles.breadcrumbRow}>
          <Ionicons name="cube-outline" size={14} color={UI.text2} />
          <Text style={styles.breadcrumbText} numberOfLines={1}>
            {assetLabel || "Asset"}
          </Text>

          <Ionicons name="chevron-forward-outline" size={14} color={UI.text2} />

          <Ionicons name="settings-outline" size={14} color={UI.text2} />
          <Text style={styles.breadcrumbText} numberOfLines={1}>
            {systemId ? systemLabel || "System" : "Asset record"}
          </Text>

          <Ionicons name="chevron-forward-outline" size={14} color={UI.text2} />

          <Ionicons name="time-outline" size={14} color={UI.text2} />
          <Text
            style={[styles.breadcrumbText, { maxWidth: SCREEN_W * 0.35 }]}
            numberOfLines={1}
          >
            {record?.title || "Record"}
          </Text>

          {contextLoading ? (
            <ActivityIndicator style={{ marginLeft: 8 }} size="small" />
          ) : null}
        </View>

        {/* HERO */}
        <View style={styles.heroCard}>
          {effectiveHeroUrl ? (
            <Image
              source={{ uri: effectiveHeroUrl }}
              style={styles.heroImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.heroFallback}>
              <Ionicons
                name="albums-outline"
                size={30}
                color="rgba(148,163,184,0.9)"
              />
              <Text style={styles.heroFallbackText}>
                {heroTitle || "Keepr record"}
              </Text>
              <Text style={styles.heroFallbackSub}>{summaryLine}</Text>
            </View>
          )}

          <View style={styles.heroOverlay}>
            <VerificationChip
              label={systemId ? "System record" : "Asset record"}
              icon="layers-outline"
            />
            <VerificationChip
              label={
                String(confidenceLabel).toLowerCase() === "verified"
                  ? "Verified"
                  : confidenceLabel
              }
              icon="shield-checkmark-outline"
              tone={
                String(confidenceLabel).toLowerCase() === "verified"
                  ? "success"
                  : "warning"
              }
            />
            <VerificationChip label="Owner" icon="person-circle-outline" />
          </View>
        </View>

        {/* TITLE & SUMMARY */}
        <View style={styles.headerBlock}>
          <Text style={styles.recordTitle} numberOfLines={2}>
            {heroTitle}
          </Text>
          <View style={styles.headerMetaRow}>
            {heroSubtitle ? (
              <>
                <Text style={styles.recordMetaText}>{heroSubtitle}</Text>
                <Text style={styles.recordMetaDot}>•</Text>
              </>
            ) : null}
            <Text style={styles.recordMetaText}>{summaryLine}</Text>
          </View>
        </View>

        {/* PROOF */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Proof</Text>
              <Text style={styles.sectionMeta}>{summaryLine}</Text>
            </View>
            <View style={styles.sectionHeaderRight}>
            <TouchableOpacity
              style={styles.kHeaderIconBtn}
              onPress={onEdit}
              accessibilityLabel="Edit record"
            >
              <Ionicons name="create-outline" size={18} color={UI.text2} />
            </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setReloadKey((k) => k + 1)}
              >
                <Ionicons name="refresh-outline" size={18} color={UI.text2} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setAddSheetOpen(true)}
              >
                <Ionicons name="add-outline" size={20} color={UI.text2} />
              </TouchableOpacity>

              {assetId ? (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() =>
                    navigation.navigate("AssetAttachments", { assetId, targetType: "service_record", targetId: recordId, targetRole: "proof", assetName: assetLabel || undefined })
                  }
                >
                  <Ionicons name="open-outline" size={18} color={UI.text2} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Filter chips */}
          <View style={styles.proofTabsRow}>

            <TouchableOpacity
              style={[
                styles.proofTab,
                tab === "all" && styles.proofTabActive,
              ]}
              onPress={() => setTab("all")}
            >
              <Text
                style={[
                  styles.proofTabText,
                  tab === "all" && styles.proofTabTextActive,
                ]}
              >
                All{totalProofCount ? ` (${totalProofCount})` : ""}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.proofTab,
                tab === "photo" && styles.proofTabActive,
              ]}
              onPress={() => setTab("photo")}
            >
              <Text
                style={[
                  styles.proofTabText,
                  tab === "photo" && styles.proofTabTextActive,
                ]}
              >
                Photos{photos.length ? ` (${photos.length})` : ""}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.proofTab, tab === "file" && styles.proofTabActive]}
              onPress={() => setTab("file")}
            >
              <Text
                style={[
                  styles.proofTabText,
                  tab === "file" && styles.proofTabTextActive,
                ]}
              >
                Files{files.length ? ` (${files.length})` : ""}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.proofTab,
                tab === "link" && styles.proofTabActive,
              ]}
              onPress={() => setTab("link")}
            >
              <Text
                style={[
                  styles.proofTabText,
                  tab === "link" && styles.proofTabTextActive,
                ]}
              >
                Links{links.length ? ` (${links.length})` : ""}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Empty state */}
          {attachments.length === 0 && links.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name="images-outline"
                size={26}
                color={colors.textSecondary}
              />
              <Text style={styles.emptyTitle}>No proof attached yet</Text>
              <Text style={styles.emptyBody}>
                Add photos, receipts, PDFs, and links so this record is trusted
                and transferable.
              </Text>
              <TouchableOpacity
                style={styles.primaryCta}
                onPress={() => setAddSheetOpen(true)}
              >
                <Ionicons name="add-outline" size={18} color="#fff" />
                <Text style={styles.primaryCtaText}>Add proof</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Photos */}
              {tab === "all" && photos.length > 0 ? (
                <Text style={styles.subSectionLabel}>Photos</Text>
              ) : null}
              {(tab === "photo" || tab === "all") && photos.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.proofStrip}
                  contentContainerStyle={styles.proofStripContent}
                >
                  {photos.map((p, idx) => (
                    <TouchableOpacity
                      key={`${p.placement_id || p.id}-${p.role || "na"}-${idx}`}
                      style={styles.proofThumb}
                      onPress={() => openViewer("photo", idx)}
                    >
                      {p.url ? (
                        <Image
                          source={{ uri: p.url }}
                          style={styles.proofThumbImage}
                        />
                      ) : (
                        <View style={styles.proofThumbFallback}>
                          <Ionicons
                            name="image-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Files */}
              {tab === "all" && files.length > 0 ? (
                <Text style={styles.subSectionLabel}>Files</Text>
              ) : null}
              {(tab === "file" || tab === "all") && files.length > 0 && (
                <View style={styles.proofList}>
                  {files.map((f, idx) => (
                    <TouchableOpacity
                      key={`${f.placement_id || f.id}-${f.role || "na"}`}
                      style={styles.proofRow}
                      onPress={() => openViewer("file", idx)}
                    >
                      <Ionicons
                        name="document-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={styles.proofRowTitle}
                        >
                          {f.title || "File"}
                        </Text>
                        {f.contentType ? (
                          <Text
                            numberOfLines={1}
                            style={styles.proofRowSub}
                          >
                            {f.contentType}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name="open-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Links */}
              {tab === "all" && linkAttachments.length > 0 ? (
                <Text style={styles.subSectionLabel}>Links</Text>
              ) : null}
              {(tab === "link" || tab === "all") && linkAttachments.length > 0 && (
                <View style={styles.proofList}>
                  {linkAttachments.map((l, idx) => (
                    <TouchableOpacity
                      key={`${l.placement_id || l.id}-${l.role || "na"}`}
                      style={styles.proofRow}
                      onPress={() => openViewer("link", idx)}
                    >
                      <Ionicons
                        name="link-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={styles.proofRowTitle}
                        >
                          {l.title || domainFromUrl(l.url) || "Link"}
                        </Text>
                        {l.url ? (
                          <Text
                            numberOfLines={1}
                            style={styles.proofRowSub}
                          >
                            {l.url}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name="open-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* CONTEXT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Context</Text>
                    <View style={styles.kHeaderRight}>

          </View>
          <View style={styles.textCard}>
            <Text style={styles.textBody}>
              {record?.notes ||
                "No notes yet. Add a short story about what happened and why it matters."}
            </Text>
          </View>

<View style={{ marginTop: 10 }}>
  <DetectedLinkChips text={record?.notes || ""} />
</View>

        </View>

        {/* DETAILS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.textCard}>
            {record?.cost !== null && record?.cost !== undefined ? (
              <Text style={styles.detailLine}>
                <Text style={styles.detailLabel}>Cost: </Text>
                <Text style={styles.detailValue}>{money(record?.cost)}</Text>
              </Text>
            ) : null}

            {(record?.odometer !== null && record?.odometer !== undefined) ||
            (record?.hours !== null && record?.hours !== undefined) ? (
              <Text style={styles.detailLine}>
                <Text style={styles.detailLabel}>Odometer / Hours: </Text>
                <Text style={styles.detailValue}>
                  {record?.odometer ?? record?.hours ?? ""}
                </Text>
              </Text>
            ) : null}

            {record?.location ? (
              <Text style={styles.detailLine}>
                <Text style={styles.detailLabel}>Location: </Text>
                <Text style={styles.detailValue}>{record.location}</Text>
              </Text>
            ) : null}

            {record?.keepr_pro_name ||
            record?.provider ||
            record?.vendor ? (
              <Text style={styles.detailLine}>
                <Text style={styles.detailLabel}>Provider: </Text>
                <Text style={styles.detailValue}>
                  {record.keepr_pro_name ||
                    record.provider ||
                    record.vendor}
                </Text>
              </Text>
            ) : null}
          </View>
        </View>

        {/* CONFIDENCE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Confidence</Text>
          <View style={styles.confidenceCard}>
            <View style={styles.confidenceRowTop}>
              <Text style={styles.confidenceSource}>
                {record?.source_type
                  ? `Source: ${record.source_type}`
                  : "Source: manual"}
              </Text>
              <VerificationChip
                label={
                  String(confidenceLabel).toLowerCase() === "verified"
                    ? "Verified"
                    : confidenceLabel
                }
                icon="shield-checkmark-outline"
                tone={
                  String(confidenceLabel).toLowerCase() === "verified"
                    ? "success"
                    : "warning"
                }
              />
            </View>

            <View style={styles.confidenceRowBottom}>
              <View style={styles.confidenceLineItem}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color={UI.text2}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.confidenceBody}>
                  Proof is attached to the story moment.
                </Text>
              </View>
              <View style={styles.confidenceLineItem}>
                <Ionicons
                  name="sparkles-outline"
                  size={16}
                  color={UI.text2}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.confidenceBody}>
                  Keepr can extract details from documents and photos as this
                  record grows.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Viewer */}
      <AttachmentViewerModal
        visible={!!viewer}
        attachment={currentViewerAttachment}
        collection={currentViewerCollection}
        index={viewer?.index || 0}
        onIndexChange={(next) =>
          setViewer((v) => (v ? { ...v, index: next } : v))
        }
        onClose={closeViewer}
        onDelete={handleDeleteCurrentAttachment}
        assetId={assetId}
        systemId={systemId}
        recordId={recordId}
        onSendToKI={({ attachmentId }) => {
          // Close the viewer first so navigation feels clean
          closeViewer();
          if (!attachmentId) return;
          navigation.navigate("KeeprIntelligence", {
            assetId,
            systemId,
            recordId,
            attachmentId,
          });
        }}
      />

      {/* Add proof sheet */}
      <Modal
        visible={addSheetOpen}
        transparent
        animationType={IS_WEB ? "fade" : "slide"}
        onRequestClose={() => setAddSheetOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setAddSheetOpen(false)}
          style={[styles.sheetBackdrop, IS_WEB && styles.sheetBackdropWeb]}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheetCard, IS_WEB && styles.sheetCardWeb]}
            onPress={() => {}}
          >
            <Text style={styles.sheetTitle}>Add proof</Text>

            <TouchableOpacity style={styles.sheetRow} onPress={pickPhoto}>
              <Ionicons
                name="image-outline"
                size={20}
                color={colors.textPrimary}
                style={{ marginRight: 10 }}
              />
              <Text style={styles.sheetRowText}>Add photos</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetRow} onPress={pickFile}>
              <Ionicons
                name="document-outline"
                size={20}
                color={colors.textPrimary}
                style={{ marginRight: 10 }}
              />
              <Text style={styles.sheetRowText}>Add files</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetRow}
              onPress={() => {
                setAddSheetOpen(false);
                setAddLinkModal(true);
              }}
            >
              <Ionicons
                name="link-outline"
                size={20}
                color={colors.textPrimary}
                style={{ marginRight: 10 }}
              />
              <Text style={styles.sheetRowText}>Add link</Text>
            </TouchableOpacity>

            
            <TouchableOpacity
              style={styles.sheetRow}
              onPress={() => {
                setAddSheetOpen(false);
                navigation.navigate("AssetAttachments", {
                  assetId,
                  targetType: "service_record",
                  targetId: recordId,
                  targetRole: "proof",
                  assetName: assetLabel || undefined,
                });
              }}
            >
              <Ionicons
                name="albums-outline"
                size={20}
                color={colors.textPrimary}
                style={{ marginRight: 10 }}
              />
              <Text style={styles.sheetRowText}>Use existing from attachments</Text>
            </TouchableOpacity>

<TouchableOpacity
              style={[styles.sheetRow, { justifyContent: "center" }]}
              onPress={() => setAddSheetOpen(false)}
            >
              <Text
                style={[styles.sheetRowText, { color: UI.text2 }]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Add link modal */}
      <Modal
        visible={addLinkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setAddLinkModal(false)}
      >
        <View style={styles.linkModalBackdrop}>
          <View style={styles.linkModalCard}>
            <Text style={styles.linkModalTitle}>Add link</Text>

            <Text style={styles.fieldLabel}>Title (optional)</Text>
            <TextInput
              value={newLinkTitle}
              onChangeText={setNewLinkTitle}
              placeholder="Sherwin Williams color details"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />

            <View style={{ height: spacing.md }} />

            <Text style={styles.fieldLabel}>URL</Text>
            <TextInput
              value={newLinkUrl}
              onChangeText={setNewLinkUrl}
              placeholder="https://…"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.linkModalActions}>
              <TouchableOpacity
                onPress={() => setAddLinkModal(false)}
              >
                <Text style={styles.linkModalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveLink}>
                <Text style={styles.linkModalSave}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: UI.pageBg,
  },
  pageContent: {
    paddingBottom: spacing.xl * 2,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyTitle: {
    ...typography.subhead,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
  },

  // header + breadcrumb
  kHeader: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  kHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  kHeaderTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: UI.text,
  },
  kHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  kHeaderIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.borderSubtle,
  },
  breadcrumbRow: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  breadcrumbText: {
    fontSize: 12,
    fontWeight: "800",
    color: UI.text2,
    maxWidth: SCREEN_W * 0.26,
  },

  heroCard: {
    margin: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: UI.cardBg,
    ...shadows.lg,
  },
  heroImage: {
    width: "100%",
    height: SCREEN_W > 900 ? 360 : 260,
  },
  heroFallback: {
    width: "100%",
    height: SCREEN_W > 900 ? 360 : 260,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: UI.surface,
    paddingHorizontal: spacing.lg,
  },
  heroFallbackText: {
    marginTop: spacing.sm,
    ...typography.subhead,
    color: UI.text,
    textAlign: "center",
  },
  heroFallbackSub: {
    marginTop: 6,
    ...typography.caption,
    color: UI.text2,
    textAlign: "center",
  },
  heroOverlay: {
    position: "absolute",
    left: spacing.lg,
    bottom: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },

  headerBlock: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  recordTitle: {
    ...typography.h3,
    color: UI.text,
    marginBottom: spacing.xs,
  },
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  recordMetaText: {
    ...typography.caption,
    color: UI.text2,
  },
  recordMetaDot: {
    marginHorizontal: 6,
    ...typography.caption,
    color: UI.text2,
  },

  badgeChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeChipText: {
    ...typography.caption,
    fontWeight: "600",
  },

  section: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.subhead,
    color: UI.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: UI.text2,
    marginTop: 2,
  },
  sectionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: UI.surface,
  },

  proofTabsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    columnGap: spacing.xs,
  },
  proofTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
    backgroundColor: UI.surface,
  },
  proofTabActive: {
    backgroundColor: UI.chipDark,
    borderColor: "transparent",
  },
  proofTabText: {
    ...typography.caption,
    color: UI.text2,
  },
  proofTabTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },

  proofStrip: {
    marginTop: spacing.sm,
  },
  proofStripContent: {
    paddingBottom: spacing.sm,
  },
  proofThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    overflow: "hidden",
    marginRight: spacing.xs,
    backgroundColor: UI.heroBg,
    justifyContent: "center",
    alignItems: "center",
  },
  proofThumbImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  proofThumbFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  proofList: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: UI.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI.border,
  },
  proofRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.border,
  },
  proofRowTitle: {
    ...typography.body,
    color: colors.textPrimary,
  },
  proofRowSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },

  emptyCard: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI.border,
    backgroundColor: UI.cardBg,
    alignItems: "center",
  },
  primaryCta: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: UI.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryCtaText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },

  textCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI.border,
    backgroundColor: UI.cardBg,
  },
  textBody: {
    ...typography.body,
    color: UI.text,
    lineHeight: 20,
  },

  detailLine: {
    ...typography.body,
    color: UI.text,
    marginBottom: 4,
  },
  detailLabel: {
    fontWeight: "600",
  },
  detailValue: {
    fontWeight: "500",
  },

  confidenceCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI.border,
    backgroundColor: UI.cardBg,
  },
  confidenceRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  confidenceSource: {
    ...typography.caption,
    color: UI.text2,
  },
  confidenceRowBottom: {
    marginTop: 2,
  },
  confidenceLineItem: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  confidenceBody: {
    ...typography.caption,
    color: UI.text2,
    flex: 1,
    flexWrap: "wrap",
  },

  // add proof sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
  },
  sheetBackdropWeb: {
    justifyContent: "center",
    alignItems: "center",
  },

  sheetCard: {
    backgroundColor: "#fff",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetCardWeb: {
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.xl,
    marginHorizontal: spacing.lg,
  },

  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.md,
    color: colors.textPrimary,
  },
  sheetRow: {
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  sheetRowText: {
    fontSize: 15,
    color: colors.textPrimary,
  },

  // link modal
  linkModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  linkModalCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  linkModalTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.md,
    color: colors.textPrimary,
  },
  fieldLabel: {
    fontSize: 13,
    marginBottom: spacing.xs,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: UI.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? spacing.sm : spacing.xs,
    color: colors.textPrimary,
  },
  linkModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  linkModalCancel: {
    fontSize: 15,
    color: UI.text2,
  },
  linkModalSave: {
    fontSize: 15,
    fontWeight: "600",
    color: UI.primary,
  },
});
