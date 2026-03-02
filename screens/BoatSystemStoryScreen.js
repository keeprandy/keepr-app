// screens/BoatSystemStoryScreen.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";

import { useBoats } from "../context/BoatsContext";
import { supabase } from "../lib/supabaseClient";

import { useAttachments } from "../hooks/useAttachments";
import { ATTACHMENT_BUCKET, getSignedUrl } from "../lib/attachmentsApi";
import AttachmentViewerModal from "../components/AttachmentViewerModal";

const HERO_ASPECT = 4 / 3;
const IS_WEB = Platform.OS === "web";

// ---- helpers ----

function statusStyle(status) {
  if (status === "healthy") return styles.status_healthy;
  if (status === "warning") return styles.status_warning;
  if (status === "offline") return styles.status_offline;
  return styles.status_warning;
}

const getExt = (name = "") => {
  const n = String(name || "").toLowerCase().trim();
  if (!n.includes(".")) return "";
  return n.split(".").pop() || "";
};

const isImageMime = (mime = "") => {
  const m = String(mime || "").toLowerCase();
  if (!m) return false;
  return m.startsWith("image/");
};

const isPdfMime = (mime = "") => {
  const m = String(mime || "").toLowerCase();
  if (!m) return false;
  if (m === "application/pdf") return true;
  if (m.endsWith("+pdf")) return true;
  return false;
};

const fmtDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Metadata helpers (supports both legacy flat metadata and the newer metadata.standard shape)
function getStandardMeta(systemRow) {
  const meta = systemRow?.metadata || systemRow?.extra_metadata || {};
  const standard =
    meta?.standard && typeof meta.standard === "object" ? meta.standard : null;

  if (standard) {
    return {
      identity: standard.identity || {},
      warranty: standard.warranty || {},
      value: standard.value || {},
      risk: standard.risk || {},
      story: standard.story || {},
      relationships: standard.relationships || {},
    };
  }

  // legacy fallback
  return {
    identity: meta.identity || {},
    warranty: meta.warranty || {},
    value: meta.value || {},
    risk: meta.risk || {},
    story: meta.story || {},
    relationships: meta.relationships || {},
  };
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function warrantyStatus(expiresOn) {
  const d = parseDate(expiresOn);
  if (!d) return { label: "Unknown", tone: "warning" };

  const now = new Date();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = end.getTime() - today.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));

  if (days < 0) return { label: "Expired", tone: "offline", days };
  if (days <= 45) return { label: "Expiring soon", tone: "warning", days };
  return { label: "Covered", tone: "healthy", days };
}

// ---- screen ----

export default function BoatSystemStoryScreen(props) {
  // HARDEN: avoid “navigation doesn't exist” crash if this is ever rendered as a component
  const navigation = props?.navigation || props?.route?.navigation || null;
  const route = props?.route || null;

  const { width: windowWidth } = useWindowDimensions();
  const { currentBoat } = useBoats();

  const systemId = route?.params?.systemId ?? route?.params?.system_id ?? null;

  const assetIdFromRoute =
    route?.params?.assetId ?? route?.params?.boatId ?? currentBoat?.id ?? null;

  const assetNameFromRoute =
    route?.params?.assetName ??
    route?.params?.boatName ??
    currentBoat?.name ??
    "My boat";

  const assetId = assetIdFromRoute;
  const assetName = assetNameFromRoute;

  const [system, setSystem] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [heroImageError, setHeroImageError] = useState(false);

  const heroWidth = Math.min(windowWidth - spacing.lg * 2, 720);
  const isWide = IS_WEB && windowWidth >= 980;

  // system attachments via attachments engine
  const { items: systemPlacementRows, loading: attachmentsLoading } = useAttachments(
    "system",
    systemId
  );

  const [attachmentPreview, setAttachmentPreview] = useState([]);

  // viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // thumbnail error tracking (prevents grey/blank tiles)
  const [thumbErrorByKey, setThumbErrorByKey] = useState({});
  const [recordThumbErrorByUrl, setRecordThumbErrorByUrl] = useState({});

  const markThumbFailed = useCallback((key) => {
    if (!key) return;
    setThumbErrorByKey((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const markRecordThumbFailed = useCallback((url) => {
    if (!url) return;
    setRecordThumbErrorByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);

  // ---- Keepr Pro associations ----
  const [assignedPros, setAssignedPros] = useState([]);
  const [prosLoading, setProsLoading] = useState(false);
  const [prosError, setProsError] = useState(null);

  // ---- data load: system + service records ----

  const loadAll = useCallback(async () => {
    if (!systemId) {
      setError("No system specified.");
      setSystem(null);
      setRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: sys, error: sysErr } = await supabase
        .from("systems")
        .select("*")
        .eq("id", systemId)
        .maybeSingle();

      if (sysErr) throw sysErr;
      if (!sys) throw new Error("System not found.");
      setSystem(sys);

      const { data: recRows, error: recErr } = await supabase
        .from("service_records")
        .select(
          `
            *,
            service_record_photos (
              id,
              url,
              storage_path,
              created_at
            )
          `
        )
        .eq("system_id", sys.id)
        .order("performed_at", { ascending: false });

      if (recErr) throw recErr;

      const normalizedRecords = (recRows || []).map((rec) => {
        const rawPhotos = rec.service_record_photos || [];
        const photos = rawPhotos
          .map((p) => {
            const url = p.url || null;
            return url ? { ...p, url } : null;
          })
          .filter(Boolean);

        return { ...rec, photos };
      });

      setRecords(normalizedRecords);
      setLoading(false);
    } catch (e) {
      console.error("VehicleSystemStoryScreen loadAll error:", e);
      setError(e?.message || "Failed to load system.");
      setLoading(false);
    }
  }, [systemId]);

  // Initial load
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Focus refresh (single path) — avoids “maximum update depth” loops
  useFocusEffect(
    useCallback(() => {
      loadAll();
      setHeroImageError(false);
      return () => {};
    }, [loadAll])
  );

  // ---- normalize system attachments for hero + strip ----
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!systemPlacementRows || !systemPlacementRows.length) {
        setAttachmentPreview([]);
        return;
      }

      const rows = [];

      for (const row of systemPlacementRows) {
        const fileName = row.file_name || row.fileName || row.name || "Attachment";
        const ext = getExt(fileName);
        const mime = row.mime_type || row.mimeType || "";

        const isPhoto =
          row.kind === "photo" || isImageMime(mime) || isImageMime(`image/${ext}`);

        const isPdf = isPdfMime(mime) || ext === "pdf";

        let previewUrl = row.url || null;

        if (!previewUrl && row.storage_path) {
          try {
            const signed = await getSignedUrl({
              bucket: row.bucket || ATTACHMENT_BUCKET,
              path: row.storage_path,
              expiresIn: 60 * 60,
            });
            previewUrl = signed || null;
          } catch (e) {
            console.log("VehicleSystemStory: getSignedUrl error", e?.message || e);
          }
        }

        rows.push({
          ...row,
          _id: row.attachment_id || row.id || row.storage_path || row.url,
          fileName,
          isPhoto,
          isPdf,
          previewUrl,
        });
      }

      if (!cancelled) {
        setAttachmentPreview(rows);

        setThumbErrorByKey((prev) => {
          const next = {};
          for (const r of rows) {
            const k = r._id || r.attachment_id || r.storage_path || r.url;
            if (k && prev[k]) next[k] = true;
          }
          return next;
        });
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [systemPlacementRows]);

  const attachmentCounts = useMemo(() => {
    let photos = 0;
    let files = 0;
    let links = 0;

    for (const a of attachmentPreview) {
      if (a.kind === "link") links += 1;
      else if (a.isPhoto) photos += 1;
      else files += 1;
    }
    return { photos, files, links };
  }, [attachmentPreview]);

  const { photos, files, links } = attachmentCounts;
  const hasAnyAttachments = photos + files + links > 0;

  const heroAttachment = useMemo(() => {
    if (!attachmentPreview.length) return null;

    // 1) Explicit hero chosen on system record
    const explicitId = system?.hero_attachment_id || null;
    if (explicitId) {
      const explicit = attachmentPreview.find(
        (a) =>
          (a.attachment_id && a.attachment_id === explicitId) ||
          (a.id && a.id === explicitId)
      );
      if (explicit) return explicit;
    }

    // 2) Placement showcase flag (legacy)
    const showcase = attachmentPreview.find((a) => a.isPhoto && a.is_showcase);
    if (showcase) return showcase;

    // 3) Default hero: stable oldest photo
    const photoCandidates = attachmentPreview.filter((a) => a.isPhoto);
    if (photoCandidates.length) {
      const sorted = [...photoCandidates].sort((a, b) => {
        const da = a.created_at || a.inserted_at || a.updated_at || null;
        const db = b.created_at || b.inserted_at || b.updated_at || null;
        const ta = da ? new Date(da).getTime() : 0;
        const tb = db ? new Date(db).getTime() : 0;
        return ta - tb;
      });
      return sorted[0];
    }

    // 4) Fallback
    return attachmentPreview[0];
  }, [attachmentPreview, system?.hero_attachment_id]);

  useEffect(() => {
    setHeroImageError(false);
  }, [heroAttachment?.previewUrl]);

  const heroIndex = useMemo(() => {
    if (!heroAttachment) return -1;
    return attachmentPreview.findIndex((a) => a._id === heroAttachment._id);
  }, [heroAttachment, attachmentPreview]);

  const viewerCollection = useMemo(
    () =>
      attachmentPreview.map((a) => ({
        ...a,
        urls: { signed: a.previewUrl || a.url || null },
        url: a.previewUrl || a.url || null,
        contentType: a.mime_type || a.mimeType || null,
      })),
    [attachmentPreview]
  );

  // ---- standard meta ----
  const { identity: identityMeta, warranty: warrantyMeta, value: valueMeta, risk: riskMeta, relationships: relationshipsMeta } =
    useMemo(() => getStandardMeta(system), [system]);

  const keeprProIds = useMemo(() => {
    const rel = relationshipsMeta || {};
    const idsRaw = rel.keepr_pro_ids || rel.keeprProIds || rel.keepr_pros || [];
    return Array.isArray(idsRaw) ? idsRaw.filter(Boolean) : [];
  }, [relationshipsMeta]);

  // Load assigned pros (ordered)
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const ids = keeprProIds;
        if (!ids.length) {
          if (!cancelled) {
            setAssignedPros([]);
            setProsLoading(false);
            setProsError(null);
          }
          return;
        }

        if (!cancelled) {
          setProsLoading(true);
          setProsError(null);
        }

        const { data, error } = await supabase
          .from("keepr_pros")
          .select("id, name, category, phone, email, website, is_favorite")
          .in("id", ids);

        if (error) throw error;

        const byId = new Map((data || []).map((p) => [p.id, p]));
        const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
        const extras = (data || []).filter((p) => !ids.includes(p.id));
        extras.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

        if (!cancelled) {
          setAssignedPros([...ordered, ...extras]);
          setProsLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setAssignedPros([]);
          setProsLoading(false);
          setProsError(e?.message || "Failed to load Keepr Pros.");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [keeprProIds]);

  // ---- navigation + actions ----

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack();
  }, [navigation]);

  const goToSystems = useCallback(() => {
    handleBack();
  }, [handleBack]);

  const goToEditSystemStory = useCallback(() => {
    if (!navigation?.navigate || !systemId) return;
    navigation.navigate("EditSystemEnrichment", {
      systemId,
      assetId,
      assetName,
      assetType: "boat",
    });
  }, [navigation, systemId, assetId, assetName]);

  const goToAddService = useCallback(() => {
    if (!navigation?.navigate || !system || !assetId) return;
    navigation.navigate("AddTimelineRecord", {
      source: "system",
      assetId,
      assetName,
      systemId: system.id,
      systemName: system.name,
      defaultCategory: "service",
      defaultTitle: system.name ? `${system.name} service` : "Service",
    });
  }, [navigation, system, assetId, assetName]);

  const goToEditService = useCallback(
    (record) => {
      if (!navigation?.navigate || !record?.id) return;
      navigation.navigate("EditTimelineRecord", {
        serviceRecordId: record.id,
        source: "asset",
        assetId,
        assetName,
        systemId: system?.id,
        systemName: system?.name,
      });
    },
    [navigation, assetId, assetName, system?.id, system?.name]
  );

  const goToAttachmentsScreen = useCallback(() => {
    if (!navigation?.navigate || !assetId) return;
    navigation.navigate("AssetAttachments", {
      assetId,
      assetName,
      targetType: "system",
      targetId: systemId,
      targetRole: "other",
    });
  }, [navigation, assetId, assetName, systemId]);

  const openKeeprPro = useCallback(
    (keeprPro) => {
      if (!navigation?.navigate || !keeprPro?.id) return;
      navigation.navigate("KeeprProDetail", { pro: keeprPro });
    },
    [navigation]
  );

  // ---- hero selection ----
  const setHeroAttachment = useCallback(
    async (att) => {
      if (!att || !systemId) return;
      const heroId = att.attachment_id || att.id || null;
      if (!heroId) return;

      try {
        const { error: upErr } = await supabase
          .from("systems")
          .update({ hero_attachment_id: heroId })
          .eq("id", systemId);

        if (upErr) throw upErr;

        setSystem((prev) => (prev ? { ...prev, hero_attachment_id: heroId } : prev));
      } catch (e) {
        Alert.alert("Could not set hero", e?.message || "Please try again.");
      }
    },
    [systemId]
  );

  const openViewerAt = useCallback(
    (idx) => {
      if (!viewerCollection.length) return;
      if (idx < 0 || idx >= viewerCollection.length) return;

      const att = viewerCollection[idx] || null;

      if (IS_WEB && att) {
        const url = att.url || att?.urls?.signed || null;
        const fileName = att.fileName || att.file_name || att.name || att.title || "";
        const isPdf =
          att.isPdf ||
          String(att.contentType || "").toLowerCase().includes("pdf") ||
          String(fileName).toLowerCase().endsWith(".pdf");

        if (isPdf && url && typeof window !== "undefined") {
          try {
            window.open(url, "_blank", "noopener,noreferrer");
          } catch (e) {}
          return;
        }
      }

      setViewerIndex(idx);
      setViewerVisible(true);
    },
    [viewerCollection]
  );

  const handleViewerIndexChange = useCallback(
    (idx) => {
      if (!viewerCollection.length) return;
      if (idx < 0 || idx >= viewerCollection.length) return;
      setViewerIndex(idx);
    },
    [viewerCollection]
  );

  // ---- derived labels ----
  const status = system?.status || "healthy";

  const warrantyExpires =
    warrantyMeta?.expires_on ||
    warrantyMeta?.expiresOn ||
    warrantyMeta?.end_on ||
    warrantyMeta?.end_date ||
    warrantyMeta?.expires ||
    null;

  const wStatus = warrantyStatus(warrantyExpires);

  const warrantyProvider = warrantyMeta?.provider || null;
  const warrantyPolicy = warrantyMeta?.policy_number || warrantyMeta?.policy || null;
  const warrantyStarts =
    warrantyMeta?.starts_on || warrantyMeta?.start_on || warrantyMeta?.start_date || null;

  const lastRecord = records[0] || null;
  const lastDate = lastRecord?.performed_at || lastRecord?.service_date || null;

  const lastServiceLabel = lastRecord
    ? `${lastDate || "Recent"} · ${lastRecord.title || "Service event"}`
    : "No service history yet.";

  // ---- loading / error ----
  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.fallbackContainer}>
          <ActivityIndicator />
          <Text style={styles.fallbackText}>Loading system…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !system) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackText}>{error || "System not found."}</Text>
          <TouchableOpacity style={[styles.chip, { marginTop: spacing.md }]} onPress={handleBack}>
            <Ionicons
              name="chevron-back-outline"
              size={14}
              color={colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.chipLabel}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentAttachment =
    viewerCollection.length && viewerIndex >= 0 && viewerIndex < viewerCollection.length
      ? viewerCollection[viewerIndex]
      : null;

  // ---- render ----
  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.container}>
        {/* HEADER */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.iconButton} onPress={handleBack} activeOpacity={0.8}>
            <Ionicons name="chevron-back-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>{system.name}</Text>
            <Text style={styles.subtitle}>System · {assetName}</Text>
          </View>
        </View>

        {/* HEADER CHIPS */}
        <View style={styles.headerChipsRow}>
          <TouchableOpacity style={[styles.chip, styles.chipPrimary]}>
            <Ionicons name="book-outline" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={[styles.chipLabel, styles.chipLabelPrimary]}>Story & timeline</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.chip} onPress={goToSystems}>
            <Ionicons
              name="construct-outline"
              size={14}
              color={colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.chipLabel}>Systems</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.chip} onPress={goToAddService}>
            <Ionicons
              name="add-circle-outline"
              size={14}
              color={colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.chipLabel}>Add service</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.chip} onPress={goToEditSystemStory}>
            <Ionicons name="create-outline" size={18} color={colors.textPrimary} style={{ marginRight: 6 }} />
            <Text style={styles.chipLabel}>Edit System Info</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* HERO */}
          <View style={[styles.heroCard, isWide && styles.heroCardWide]}>
            {/* Left: media */}
            <TouchableOpacity
              style={[styles.heroMedia, isWide && styles.heroMediaWide]}
              activeOpacity={heroAttachment ? 0.9 : 1}
              onPress={() => {
                if (!heroAttachment || heroIndex < 0) return;
                const url = heroAttachment.previewUrl || heroAttachment.url || null;
                if (IS_WEB && heroAttachment.isPdf && url) {
                  try {
                    window.open(url, "_blank");
                  } catch (e) {
                    openViewerAt(heroIndex);
                  }
                  return;
                }
                openViewerAt(heroIndex);
              }}
            >
              <View style={[styles.heroImageWrap, !isWide && { maxWidth: heroWidth }]}>
                {attachmentsLoading ? (
                  <View style={styles.heroPlaceholder}>
                    <ActivityIndicator color={colors.brandWhite} />
                  </View>
                ) : heroAttachment && heroAttachment.isPhoto && heroAttachment.previewUrl && !heroImageError ? (
                  <Image
                    source={{ uri: heroAttachment.previewUrl }}
                    style={styles.heroImage}
                    resizeMode="cover"
                    onError={() => setHeroImageError(true)}
                  />
                ) : (
                  <View style={styles.heroPlaceholder}>
                    <Ionicons
                      name={hasAnyAttachments ? "document-text-outline" : "construct-outline"}
                      size={32}
                      color={colors.brandWhite}
                    />
                    <Text style={styles.heroPlaceholderText}>
                      {hasAnyAttachments
                        ? `Latest proof is a file or link${
                            heroAttachment?.fileName ? ` (${heroAttachment.fileName})` : ""
                          }. Open attachments below to view it.`
                        : "Add attachments (photos, files, links) for this system to see them here."}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.heroBottomRow}>
                <View style={[styles.statusPill, statusStyle(status)]}>
                  <Text style={styles.statusText}>
                    {status === "healthy"
                      ? "Healthy"
                      : status === "warning"
                      ? "Attention"
                      : status === "offline"
                      ? "Offline"
                      : status}
                  </Text>
                </View>

                <TouchableOpacity style={styles.addPhotoButton} onPress={goToAttachmentsScreen} activeOpacity={0.85}>
                  <Ionicons
                    name="attach-outline"
                    size={16}
                    color={colors.brandWhite}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.addPhotoButtonText}>Manage attachments</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.heroMetaRow}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.heroMetaText}>{lastServiceLabel}</Text>
              </View>
            </TouchableOpacity>

            {/* Right: details (wide/web only) */}
            {isWide ? (
              <View style={styles.heroDetails}>
                <View style={styles.detailCard}>
                  <View style={styles.detailHeaderRow}>
                    <Text style={styles.detailTitle}>System details</Text>

                    <View style={[styles.statusPill, statusStyle(wStatus.tone)]}>
                      <Text style={styles.statusText}>{wStatus.label}</Text>
                    </View>
                  </View>

                  <View style={styles.kvGrid}>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Manufacturer</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {identityMeta?.manufacturer || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Model</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {identityMeta?.model || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Serial</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {identityMeta?.serial_number || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Installed</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {fmtDate(identityMeta?.installed_on) || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Location</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {identityMeta?.location || "—"}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.detailCard}>
                  <Text style={styles.detailTitle}>Warranty</Text>

                  <View style={styles.kvGrid}>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Provider</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {warrantyProvider || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Policy</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {warrantyPolicy || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Starts</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {fmtDate(warrantyStarts) || "—"}
                      </Text>
                    </View>
                    <View style={styles.kvRow}>
                      <Text style={styles.kvLabel}>Expires</Text>
                      <Text style={styles.kvValue} numberOfLines={1}>
                        {fmtDate(warrantyExpires) || "—"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailActionsRow}>
                    <TouchableOpacity style={styles.detailAction} onPress={goToEditSystemStory} activeOpacity={0.85}>
                      <Ionicons
                        name="create-outline"
                        size={16}
                        color={colors.textPrimary}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.detailActionText}>Edit system info</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.detailAction} onPress={goToAttachmentsScreen} activeOpacity={0.85}>
                      <Ionicons
                        name="attach-outline"
                        size={16}
                        color={colors.textPrimary}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.detailActionText}>Warranty proof</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.detailCard}>
                  <Text style={styles.detailTitle}>Keepr Pro</Text>

                  {prosLoading ? (
                    <View style={{ marginTop: spacing.sm }}>
                      <ActivityIndicator size="small" />
                    </View>
                  ) : assignedPros.length ? (
                    <View style={{ marginTop: spacing.sm }}>
                      {assignedPros.map((pro) => (
                        <TouchableOpacity
                          key={pro.id}
                          style={styles.proRow}
                          onPress={() => openKeeprPro(pro)}
                          activeOpacity={0.85}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.proName} numberOfLines={1}>
                              {pro.name}
                            </Text>
                            <Text style={styles.proMeta} numberOfLines={1}>
                              {[pro.category, pro.phone || pro.email].filter(Boolean).join(" · ")}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.emptyInline}>
                      <Text style={styles.emptyInlineText}>
                        No Keepr Pro assigned yet. Assign your go-to contact for faster action.
                      </Text>

                      <TouchableOpacity style={styles.detailAction} onPress={goToEditSystemStory} activeOpacity={0.85}>
                        <Ionicons
                          name="person-add-outline"
                          size={16}
                          color={colors.textPrimary}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.detailActionText}>Assign Keepr Pro</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {!!prosError && <Text style={styles.warnText}>{prosError}</Text>}
                </View>
              </View>
            ) : null}
          </View>

          {/* Mobile details (below hero) */}
          {!isWide ? (
            <View style={styles.mobileDetails}>
              <View style={styles.detailCard}>
                <View style={styles.detailHeaderRow}>
                  <Text style={styles.detailTitle}>System details</Text>
                  <View style={[styles.statusPill, statusStyle(wStatus.tone)]}>
                    <Text style={styles.statusText}>{wStatus.label}</Text>
                  </View>
                </View>

                <View style={styles.kvGrid}>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Manufacturer</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {identityMeta?.manufacturer || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Model</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {identityMeta?.model || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Serial</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {identityMeta?.serial_number || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Installed</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {fmtDate(identityMeta?.installed_on) || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Location</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {identityMeta?.location || "—"}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Warranty</Text>

                <View style={styles.kvGrid}>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Provider</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {warrantyProvider || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Policy</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {warrantyPolicy || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Starts</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {fmtDate(warrantyStarts) || "—"}
                    </Text>
                  </View>
                  <View style={styles.kvRow}>
                    <Text style={styles.kvLabel}>Expires</Text>
                    <Text style={styles.kvValue} numberOfLines={1}>
                      {fmtDate(warrantyExpires) || "—"}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailActionsRow}>
                  <TouchableOpacity style={styles.detailAction} onPress={goToEditSystemStory} activeOpacity={0.85}>
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={colors.textPrimary}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.detailActionText}>Edit system info</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.detailAction} onPress={goToAttachmentsScreen} activeOpacity={0.85}>
                    <Ionicons
                      name="attach-outline"
                      size={16}
                      color={colors.textPrimary}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.detailActionText}>Warranty proof</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Keepr Pro</Text>

                {prosLoading ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <ActivityIndicator size="small" />
                  </View>
                ) : assignedPros.length ? (
                  <View style={{ marginTop: spacing.sm }}>
                    {assignedPros.map((pro) => (
                      <TouchableOpacity
                        key={pro.id}
                        style={styles.proRow}
                        onPress={() => openKeeprPro(pro)}
                        activeOpacity={0.85}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.proName} numberOfLines={1}>
                            {pro.name}
                          </Text>
                          <Text style={styles.proMeta} numberOfLines={1}>
                            {[pro.category, pro.phone || pro.email].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward-outline" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={styles.emptyInline}>
                    <Text style={styles.emptyInlineText}>No Keepr Pro assigned yet.</Text>
                    <TouchableOpacity style={styles.detailAction} onPress={goToEditSystemStory} activeOpacity={0.85}>
                      <Ionicons
                        name="person-add-outline"
                        size={16}
                        color={colors.textPrimary}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.detailActionText}>Assign Keepr Pro</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {!!prosError && <Text style={styles.warnText}>{prosError}</Text>}
              </View>
            </View>
          ) : null}

          {/* Attachments */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Attachments</Text>
            <Text style={styles.sectionSubtitle}>
              {photos} photo{photos === 1 ? "" : "s"} · {files} file{files === 1 ? "" : "s"} ·{" "}
              {links} link{links === 1 ? "" : "s"}
            </Text>

            {!hasAnyAttachments ? (
              <View style={styles.emptyState}>
                <Ionicons name="images-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.emptyStateText}>
                  No attachments linked to this system yet. Use “Manage attachments” to add proof,
                  manuals, and context.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: spacing.sm, paddingRight: spacing.md }}
              >
                {attachmentPreview.slice(0, 12).map((att, idx) => {
                  const label = att.title || att.fileName || att.name || "Attachment";
                  const key = att._id || att.attachment_id || `${idx}`;

                  const heroId = system?.hero_attachment_id || null;
                  const isHero =
                    !!heroId &&
                    (att.attachment_id === heroId || att.id === heroId || att._id === heroId);

                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.attachmentChip}
                      onPress={() => {
                        const url = att.previewUrl || att.url || null;
                        if (IS_WEB && att.isPdf && url) {
                          try {
                            window.open(url, "_blank");
                          } catch (e) {
                            openViewerAt(idx);
                          }
                          return;
                        }
                        openViewerAt(idx);
                      }}
                      onLongPress={() => {
                        if (!att?.isPhoto) return;
                        Alert.alert(
                          "Set as hero image?",
                          "This will make the selected photo the hero image for this system.",
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Set hero", onPress: () => setHeroAttachment(att) },
                          ]
                        );
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={styles.attachmentThumb}>
                        <Pressable
                          style={[styles.heroSetButton, isHero && styles.heroSetButtonActive]}
                          onPress={(e) => {
                            if (IS_WEB && e && typeof e.stopPropagation === "function") e.stopPropagation();
                            setHeroAttachment(att);
                          }}
                          onPressIn={(e) => {
                            if (IS_WEB && e && typeof e.stopPropagation === "function") e.stopPropagation();
                          }}
                        >
                          <Ionicons
                            name={isHero ? "star" : "star-outline"}
                            size={14}
                            color={isHero ? colors.brandWhite : colors.textSecondary}
                          />
                          {!isHero && <Text style={styles.heroSetButtonLabel}>Hero</Text>}
                        </Pressable>

                        {att.isPhoto && att.previewUrl && !thumbErrorByKey[key] ? (
                          <Image
                            source={{ uri: att.previewUrl }}
                            style={styles.attachmentThumbImage}
                            resizeMode="cover"
                            onError={() => markThumbFailed(key)}
                          />
                        ) : (
                          <Ionicons
                            name={
                              att.kind === "link"
                                ? "link-outline"
                                : att.isPdf
                                ? "document-text-outline"
                                : "document-outline"
                            }
                            size={22}
                            color={colors.textSecondary}
                          />
                        )}
                      </View>

                      <Text style={styles.attachmentLabel} numberOfLines={1}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* TIMELINE */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Timeline</Text>

            {records.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.emptyStateText}>
                  No service records yet. Add your first service event to start the story.
                </Text>
                <TouchableOpacity style={styles.primaryAction} onPress={goToAddService} activeOpacity={0.85}>
                  <Ionicons
                    name="add-circle-outline"
                    size={16}
                    color={colors.brandWhite}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.primaryActionText}>Add service</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ marginTop: spacing.sm }}>
                {records.map((rec) => {
                  const date = rec.performed_at || rec.service_date || "";
                  const title = rec.title || "Service event";
                  const notes = rec.notes || "";
                  const thumbs = (rec.photos || []).slice(0, 6);

                  return (
                    <TouchableOpacity
                      key={rec.id}
                      style={styles.recordCard}
                      onPress={() => goToEditService(rec)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.recordTopRow}>
                        <Text style={styles.recordTitle} numberOfLines={1}>
                          {title}
                        </Text>
                        <Text style={styles.recordDate}>{date || ""}</Text>
                      </View>

                      {!!notes && (
                        <Text style={styles.recordNotes} numberOfLines={3}>
                          {notes}
                        </Text>
                      )}

                      {thumbs.length > 0 && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingTop: spacing.xs }}
                        >
                          {thumbs.map((p) => {
                            const url = p?.url || "";
                            const failed = url ? !!recordThumbErrorByUrl[url] : true;

                            return (
                              <View key={p.id} style={styles.thumb}>
                                {!failed ? (
                                  <Image
                                    source={{ uri: url }}
                                    style={styles.thumbImage}
                                    resizeMode="cover"
                                    onError={() => markRecordThumbFailed(url)}
                                  />
                                ) : (
                                  <View style={styles.thumbFallback}>
                                    <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </ScrollView>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </View>

      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={currentAttachment}
        collection={viewerCollection}
        index={viewerIndex}
        onIndexChange={handleViewerIndexChange}
        onClose={() => setViewerVisible(false)}
        onDelete={null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  headerTextWrap: { flex: 1 },
  title: { ...typography.title },
  subtitle: { ...typography.subtitle, marginTop: 2 },

  headerChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.md,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
  },
  chipPrimary: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  chipLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  chipLabelPrimary: { color: "#FFFFFF" },

  scrollContent: { paddingBottom: spacing.lg },

  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  heroCardWide: { flexDirection: "row", alignItems: "stretch" },
  heroMedia: { flex: 1 },
  heroMediaWide: { flex: 1 },
  heroDetails: {
    width: 420,
    padding: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  mobileDetails: { marginTop: spacing.md },

  detailCard: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  detailTitle: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },

  kvGrid: { marginTop: 2 },
  kvRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 8,
  },
  kvLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
  kvValue: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "600",
    textAlign: "right",
  },

  detailActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.sm,
  },
  detailAction: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
  },
  detailActionText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },

  proRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginTop: spacing.xs,
  },
  proName: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  proMeta: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  emptyInline: { marginTop: spacing.sm },
  emptyInlineText: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  warnText: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary },

  heroImageWrap: {
    alignSelf: "center",
    width: "100%",
    aspectRatio: HERO_ASPECT,
    backgroundColor: colors.surfaceSubtle,
  },
  heroImage: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.brandBlue,
  },
  heroPlaceholderText: {
    fontSize: 12,
    color: colors.brandWhite,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  heroBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    marginTop: -4,
  },
  heroMetaText: { fontSize: 12, color: colors.textSecondary, flex: 1 },

  statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "600", color: colors.textPrimary },
  status_healthy: { backgroundColor: "#DCFCE7" },
  status_warning: { backgroundColor: "#FEF3C7" },
  status_offline: { backgroundColor: "#FEE2E2" },

  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.brandBlue,
  },
  addPhotoButtonText: { fontSize: 12, fontWeight: "600", color: colors.brandWhite },

  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  sectionSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  emptyState: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
  },
  emptyStateText: { marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary, textAlign: "center" },
  primaryAction: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  primaryActionText: { color: colors.brandWhite, fontSize: 12, fontWeight: "700" },

  attachmentChip: { width: 96, marginRight: spacing.sm },
  attachmentThumb: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  heroSetButton: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    zIndex: 2,
  },
  heroSetButtonActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  heroSetButtonLabel: { marginLeft: 6, fontSize: 11, fontWeight: "700", color: colors.textSecondary },
  attachmentThumbImage: { width: "100%", height: "100%" },
  attachmentLabel: { marginTop: 4, fontSize: 11, color: colors.textSecondary },

  recordCard: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  recordTopRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  recordTitle: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginRight: spacing.sm },
  recordDate: { fontSize: 12, color: colors.textSecondary },
  recordNotes: { marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },

  thumb: { width: 64, height: 48, borderRadius: radius.md, marginRight: spacing.xs, backgroundColor: colors.surfaceSubtle },
  thumbImage: { width: "100%", height: "100%" },
  thumbFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSubtle },

  fallbackContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  fallbackText: { marginTop: spacing.sm, color: colors.textSecondary, textAlign: "center" },
});