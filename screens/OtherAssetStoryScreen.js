// screens/OtherAssetStoryScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import { formatKeeprDate } from "../lib/dateFormat";
import * as ImagePicker from "expo-image-picker";
import KeeprProgressCard, {
  buildKeeprProgressModel,
} from "../components/KeeprProgressCard";
import PublicStoryCard from "../components/PublicStoryCard";

// ✅ low-level upload helper (NOT a hook)
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

// ✅ attachments helpers (for hero placement resolution)
import { getSignedUrl, listAttachmentsForTarget } from "../lib/attachmentsApi";

// Context-aware Add Event pill
import EventPill from "../components/EventPill";
import ReportsModal from "../components/ReportsModal";
import { getAssetDefinition, formatAssetMetaValue } from "../lib/assetDefinitions";

const HERO_ASPECT = 4 / 3;
const IS_WEB = Platform.OS === "web";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* --------------------------- CHIP COMPONENTS --------------------------- */

function QuickActionChip({ label, icon, onPress, isPrimary }) {
  return (
    <TouchableOpacity
      style={[styles.chip, isPrimary && styles.chipPrimary]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={isPrimary ? "white" : colors.textSecondary}
          style={{ marginRight: 6 }}
        />
      )}
      <Text
        numberOfLines={1}
        style={[styles.chipLabel, isPrimary && styles.chipLabelPrimary]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TimelineFilterChip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text
        style={[styles.filterChipLabel, active && styles.filterChipLabelActive]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
/* --------------------------- TIMELINE ROW --------------------------- */

function TimelineRow({ item, onPress, hasAttachment }) {
  const isService = item.kind === "service";

  const iconName = isService
    ? item.serviceType === "pro"
      ? "briefcase-outline"
      : item.serviceType === "diy"
      ? "construct-outline"
      : "construct-outline"
    : "sparkles-outline";

  const subtitleBits = [];
  if (isService && item.systemName) subtitleBits.push(item.systemName);
  if (isService && item.provider) subtitleBits.push(item.provider);
  if (!isService && item.description) subtitleBits.push(item.description);

  const subtitle = subtitleBits.filter(Boolean).join(" · ");

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onPress?.(item)}
      style={styles.timelineRow}
    >
      <View style={styles.timelineIcon}>
        <Ionicons name={iconName} size={16} color={colors.textPrimary} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.timelineTopRow}>
          <Text style={styles.timelineTitle} numberOfLines={1}>
            {item.title || (isService ? "Service visit" : "Story update")}
          </Text>
          <Text style={styles.timelineDate}>
            {item.date ? formatKeeprDate(item.date) : ""}
          </Text>
        </View>

        {!!subtitle && (
          <Text style={styles.timelineSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}

        <View style={styles.timelineMetaRow}>
          {isService ? (
            <>
              {!!item.cost && (
                <View style={styles.metaPill}>
                  <Ionicons
                    name="cash-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.metaPillText}>
                    {typeof item.cost === "number"
                      ? `$${item.cost.toLocaleString()}`
                      : String(item.cost)}
                  </Text>
                </View>
              )}
              {!!hasAttachment && (
                <View style={styles.metaPill}>
                  <Ionicons
                    name="images-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.metaPillText}>Photos</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.metaPill}>
              <Ionicons
                name="book-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.metaPillText}>Story</Text>
            </View>
          )}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function buildOtherAssetStory({
  asset,
  heroUri = null,
  records = [],
  systems = [],
  attachments = [],
  heroPlacementId = null,
}) {
  const title =
    asset?.name ||
    [asset?.year, asset?.make, asset?.model].filter(Boolean).join(" ").trim() ||
    "Asset";

  const totalSpend = records.reduce(
    (sum, r) => sum + (Number(r.cost || r.amount || 0) || 0),
    0
  );

  const normalizedPhotos = (attachments || [])
    .filter((a) => !!a?.uri)
    .sort((a, b) => {
      const aHero = heroPlacementId && a?.placementId === heroPlacementId ? 1 : 0;
      const bHero = heroPlacementId && b?.placementId === heroPlacementId ? 1 : 0;
      if (aHero !== bHero) return bHero - aHero;

      const aShow = a?.isShowcase ? 1 : 0;
      const bShow = b?.isShowcase ? 1 : 0;
      if (aShow !== bShow) return bShow - aShow;

      const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bT - aT;
    });

  const proofPhotos = normalizedPhotos
    .filter((a) => a?.isShowcase || (heroPlacementId && a?.placementId === heroPlacementId))
    .map((a) => ({ uri: a.uri }));

  const timeline = (records || [])
    .map((r) => ({
      id: r.id,
      date: r.date || r.occurred_at || r.performed_at || r.created_at,
      title: r.title || r.name || "Record",
      description: r.description || r.notes || "",
      kind: r.kind || "service",
      serviceType: r.serviceType || r.service_type || "service",
      cost: r.cost ?? r.amount ?? null,
      systemName: r.systemName || r.system_name || null,
      system_id: r.system_id || r.systemId || null,
      provider: r.provider || r.vendor || null,
      hasAttachment: !!(r.hasAttachment || r.proofCount || r.photoCount),
    }))
    .filter((r) => !!r.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    title,
    subtitle: "A documented story of care, upgrades, and ownership over time.",
    heroUri: heroUri || proofPhotos[0]?.uri || null,
    purchaseDate: asset?.purchase_date || null,
    purchasePrice: asset?.purchase_price || null,
    estimatedValue: asset?.estimated_value || null,
    documentedSpend: totalSpend,
    location: asset?.location || null,
    systems: systems || [],
    proofPhotos,
    timeline,
    highlights: [],
    context: {
      assetType: "other",
      subtype: asset?.asset_subtype || null,
      serialNumber: asset?.serial_number || null,
    },
  };
}

/* --------------------------- SCREEN --------------------------- */

export default function OtherAssetStoryScreen({ navigation, route }) {
  // Responsive layout (web-first): use a two-column "listing" header on wide screens.
  const { width } = useWindowDimensions();
  const isWide = IS_WEB && width >= 980;
  const assetDefinition = getAssetDefinition("other");
  const initialAssetId = route?.params?.assetId ?? null;
  
const loadAssetProgress = useCallback(async (assetId) => {
  if (!assetId) {
    setAssetProgress(null);
    return;
  }

  try {
    const { data, error } = await supabase.rpc("get_asset_keepr_progress", {
      p_asset_id: assetId,
    });

    if (error) {
      console.log("Asset progress load failed", error);
      setAssetProgress(null);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      setAssetProgress(null);
      return;
    }

    const normalized = buildKeeprProgressModel({
      mode: "asset",
      assetCount: 1,
      systemCount: row.system ? 1 : 0,
      recordCount: row.record ? 1 : 0,
      proofCount: row.proof ? 1 : 0,
    });

    setAssetProgress(normalized);
  } catch (err) {
    console.warn("Asset progress load failed", err);
    setAssetProgress(null);
  }
}, []);

  const { assets = [], loading, error } = useAssets("other");

  const goToKeeprStory = () => {
    if (!currentAsset?.id) return;

    const story = buildOtherAssetStory({
      asset: currentAsset,
      heroUri,
      records: timelineItems || [],
      systems: systems || [],
      attachments: storyAttachments || [],
      heroPlacementId: currentAsset?.hero_placement_id || null,
    });

    navigation.navigate("KeeprStory", { story });
  };

  const currentAsset = useMemo(() => {
    if (!assets || assets.length === 0) return null;
    if (!initialAssetId) return assets[0];
    return assets.find((h) => h.id === initialAssetId) || assets[0] || null;
  }, [assets, initialAssetId]);

  // Local snapshot so big updates (hero photo, delete, edits) reflect immediately
  const [assetSnapshot, setAssetSnapshot] = useState(null);
  const asset = assetSnapshot || currentAsset;

  // Keep snapshot in sync when user switches assets
    useEffect(() => {
      setAssetSnapshot(currentAsset || null);
    }, [currentAsset?.id]);


  const refreshAsset = useCallback(async () => {
    if (!asset?.id) return;
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("id", asset.id)
      .maybeSingle();

    if (!error && data) setAssetSnapshot(data);
  }, [asset?.id]);

const [reportsOpen, setReportsOpen] = useState(false);
 const [assetProgress, setAssetProgress] = useState(null);
 const [storyAttachments, setStoryAttachments] = useState([]);

useEffect(() => {
  if (asset?.id) {
    loadAssetProgress(asset.id);
  } else {
    setAssetProgress(null);
  }
}, [asset?.id, loadAssetProgress]);


  // ✅ Persistent hero resolved from hero_placement_id
  const [heroUri, setHeroUri] = useState(null);
  const [heroResolving, setHeroResolving] = useState(false);

  // Service records + attachments
  const [serviceRecords, setServiceRecords] = useState([]);
  const [serviceAttachments, setServiceAttachments] = useState({});
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState(null);

  // Story events
  const [storyEvents, setStoryEvents] = useState([]);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState(null);

  // Systems for this asset
  const [systems, setSystems] = useState([]);

  // Asset picker & timeline scroll
  const [assetPickerVisible, setAssetPickerVisible] = useState(false);
  const scrollRef = useRef(null);
  const [timelineY, setTimelineY] = useState(null);

  // Timeline filter
  const [timelineFilter, setTimelineFilter] = useState("all"); // all | service | moment| pro | diy

  // Delete state
  const [removeModalVisible, setRemoveModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  /* --------------------------- HERO RESOLUTION --------------------------- */

  const resolveHeroFromPlacement = useCallback(async () => {
    if (!asset?.id) {
      setHeroUri(null);
      return;
    }

    const placementId = asset?.hero_placement_id || null;

    // No placement hero yet → fallback to legacy URL field
    if (!placementId) {
      setHeroUri(asset?.hero_image_url || null);
      return;
    }

    setHeroResolving(true);
    try {
      const { data, error: pErr } = await supabase
        .from("attachment_placements")
        .select(
          `
          id,
          attachment:attachments (
            bucket,
            storage_path,
            url,
            mime_type,
            kind,
            deleted_at
          )
        `
        )
        .eq("id", placementId)
        .maybeSingle();

      if (pErr) {
        console.log("AssetStory hero placement lookup error", pErr);
        // fallback so we never show blank due to lookup problems
        setHeroUri(asset?.hero_image_url || null);
        return;
      }

      const a = data?.attachment || null;
      if (!a || a.deleted_at) {
        // placement points to missing/deleted attachment
        setHeroUri(asset?.hero_image_url || null);
        return;
      }

      // Prefer direct url (for external links or already public)
      if (a.url) {
        setHeroUri(a.url);
        return;
      }

      // Otherwise signed URL for storage file
      if (a.bucket && a.storage_path) {
        const signed = await getSignedUrl({
          bucket: a.bucket,
          path: a.storage_path,
        });
        setHeroUri(signed || asset?.hero_image_url || null);
        return;
      }

      setHeroUri(asset?.hero_image_url || null);
    } catch (e) {
      console.log("AssetStory resolveHeroFromPlacement error", e);
      setHeroUri(asset?.hero_image_url || null);
    } finally {
      setHeroResolving(false);
    }
  }, [asset?.id, asset?.hero_placement_id, asset?.hero_image_url]);

  useFocusEffect(
    useCallback(() => {
      refreshAsset();
      resolveHeroFromPlacement();
    }, [refreshAsset, resolveHeroFromPlacement])
  );


  // Also re-resolve if asset changes in-place
  useEffect(() => {
    refreshAsset();
    resolveHeroFromPlacement();
  }, [refreshAsset, resolveHeroFromPlacement]);

  /* --------------------------- LOAD DATA ON FOCUS --------------------------- */

  const loadAssetData = useCallback(async () => {
    if (!asset?.id) return;

    setSvcLoading(true);
    setStoryLoading(true);
    setSvcError(null);
    setStoryError(null);

    const assetId = asset.id;

    try {
      // 1) Service records
      const { data: svcRows, error: svcErr } = await supabase
        .from("service_records")
        .select("*")
        .eq("asset_id", assetId)
        .order("performed_at", { ascending: false });

      if (svcErr) {
        console.error("Error loading asset service history", svcErr);
        setSvcError("Could not load service history.");
        setServiceRecords([]);
        setServiceAttachments({});
      } else {
        const records = svcRows || [];
        setServiceRecords(records);

        if (records.length > 0) {
          const ids = records.map((r) => r.id);
          const { data: photoRows, error: photosErr } = await supabase
            .from("service_record_photos")
            .select("service_record_id")
            .in("service_record_id", ids);

          if (photosErr) {
            console.error(
              "Error loading attachments for service records",
              photosErr
            );
            setServiceAttachments({});
          } else {
            const attachmentMap = {};
            (photoRows || []).forEach((p) => {
              if (p.service_record_id) attachmentMap[p.service_record_id] = true;
            });
            setServiceAttachments(attachmentMap);
          }
        } else {
          setServiceAttachments({});
        }
      }

      // 2) Story events
      const { data: storyRows, error: storyErr } = await supabase
        .from("story_events")
        .select("*")
        .eq("asset_id", assetId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false });

      if (storyErr) {
        console.error("Error loading asset story events", storyErr);
        setStoryError("Could not load timeline.");
        setStoryEvents([]);
      } else {
        setStoryEvents(storyRows || []);
      }

      // 3) Systems
      const { data: systemRows, error: sysErr } = await supabase
        .from("systems")
        .select("id, name")
        .eq("asset_id", assetId)
        .order("name", { ascending: true });

      if (sysErr) {
        console.error("Error loading systems for asset", sysErr);
        setSystems([]);
      } else {
        setSystems(systemRows || []);
      }
    } finally {
      setSvcLoading(false);
      setStoryLoading(false);
    }
          // 4) Showcase / proof attachments for story
      try {
        const rows = await listAttachmentsForTarget("asset", assetId);
        const photos = [];

        for (const row of rows || []) {
          const kind = row.kind || "";
          const mime = String(row.mime_type || "").toLowerCase();
          const fileName = row.file_name || row.storage_path || "";
          const ext = fileName.split(".").pop()?.toLowerCase() || "";

          const looksLikeImage =
            kind === "photo" ||
            mime.startsWith("image/") ||
            ["jpg", "jpeg", "png", "webp"].includes(ext);

          if (!looksLikeImage) continue;

          let url = row.url || null;

          if (!url && row.bucket && row.storage_path) {
            try {
              url = await getSignedUrl({
                bucket: row.bucket,
                path: row.storage_path,
              });
            } catch (e) {
              console.log("AssetStory attachment signed URL error", e);
            }
          }

          if (!url) continue;

          photos.push({
            id: row.attachment_id || row.id,
            uri: url,
            isShowcase: !!row.is_showcase,
            placementId: row.placement_id || null,
            createdAt: row.created_at || null,
          });
        }

        setStoryAttachments(photos);
      } catch (e) {
        console.log("AssetStory attachment load error", e);
        setStoryAttachments([]);
      }
  }, [asset?.id]);

  useFocusEffect(
    useCallback(() => {
      if (asset?.id) loadAssetData();
    }, [asset?.id, loadAssetData])
  );

  /* --------------------------- NAV + ACTIONS --------------------------- */

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Dashboard");
  };

  const routeExists = useCallback(
    (routeName) => {
      let nav = navigation;
      while (nav) {
        const state = nav.getState?.();
        if (state?.routeNames?.includes(routeName)) return true;
        nav = nav.getParent?.();
      }
      return false;
    },
    [navigation]
  );

  const goToShowcase = () => {
    if (!asset) return;
    if (routeExists("OtherAssetShowcase")) {
      navigation.navigate("OtherAssetShowcase", { assetId: asset.id });
      return;
    }
    Alert.alert("Showcase coming soon", "Other asset showcases are not available yet.");
  };

  const goToAttachments = () => {
    if (!asset?.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: asset.id,
      assetName: asset.name || "Asset",
      sourceType: "other",
      initialTab: "file",
    });
  };
  const goToAttachmentsMobile = () => {
  navigation.navigate("AssetAttachmentsMobile", {
    assetId: currentAsset?.id,
    assetName: currentAsset?.name || "Asset",
    sourceType: "other",
  });
};

  const ensureMediaPermission = useCallback(async () => {
    if (Platform.OS === "web") return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to upload a hero image.");
      return false;
    }
    return true;
  }, []);

  const uploadHeroPhoto = useCallback(async () => {
    try {
      if (!asset?.id) return;

      const ok = await ensureMediaPermission();
      if (!ok) return;

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a?.uri) return;

      // Optimistic preview
      setHeroUri(a.uri);

      setHeroResolving(true);

      await uploadAttachmentFromUri({
        userId,
        assetId: asset.id,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "hero.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements: [
        {
          target_type: "asset",
          target_id: asset.id,
          role: "hero",
          label: "Hero",
          sort_order: 0,
          is_showcase: true,
        },
      ],
      });

      // Find newest image placement for this asset and set as hero
      const { data: placements, error: pErr } = await supabase
        .from("attachment_placements")
        .select("id, created_at, attachments!inner(kind, mime_type)")
        .eq("target_type", "asset")
        .eq("target_id", asset.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (pErr) throw pErr;

      const newestImagePlacement =
        (placements || []).find(
          (p) =>
            p?.attachments?.kind === "photo" ||
            (p?.attachments?.mime_type || "").startsWith("image/")
        ) || null;

      if (newestImagePlacement?.id) {
        const { error: uErr } = await supabase
          .from("assets")
          .update({ hero_placement_id: newestImagePlacement.id })
          .eq("id", asset.id);

        if (uErr) throw uErr;
      }

      await refreshAsset();
      await resolveHeroFromPlacement();
    } catch (e) {
      console.log("uploadHeroPhoto failed", e);
      Alert.alert("Upload failed", e?.message || "Could not set hero photo.");
      // fall back to whatever DB resolves
      try {
        await resolveHeroFromPlacement();
      } catch {}
    } finally {
      setHeroResolving(false);
    }
  }, [asset?.id, ensureMediaPermission, refreshAsset, resolveHeroFromPlacement]);


  const goToEditAsset = () => {
    if (!asset) return;
    navigation.navigate("EditAsset", { assetId: asset.id });
  };

  const goToLogPro = () => {
    if (!asset) return;
    navigation.navigate("AddServiceRecord", {
      source: "other",
      assetId: asset.id,
      assetName: asset.name,
      serviceType: "pro",
    });
  };

  const goToLogDIY = () => {
    if (!asset) return;
    navigation.navigate("AddServiceRecord", {
      source: "other",
      assetId: asset.id,
      assetName: asset.name,
      serviceType: "diy",
    });
  };

  const goToAddTimelineRecord = () => {
    if (!asset) return;
    navigation.navigate("AddTimelineRecord", {
      scope: "asset",
      assetId: asset.id,
      assetName: asset.name || "Asset",
      assetType: "other",
    });
  };

  const goToAssetSystems = () => {
    if (!asset) return;
    Alert.alert("Systems coming soon", "Systems for other assets are coming soon.");
  };

      const handleKeeprProgressPress = useCallback(
  (step) => {
    if (!asset?.id) return;

    if (step === "asset") {
      return;
    }

    if (step === "system") {
      goToAssetSystems();
      return;
    }

    if (step === "record") {
      goToAddTimelineRecord();
      return;
    }

    if (step === "proof") {
      goToAttachments();
      return;
    }
  },
  [asset?.id, goToAssetSystems, goToAddTimelineRecord, goToAttachments]
);

const handleAddAsset = () => {
  setAssetPickerVisible(false);
  navigation.navigate("AddAssetChat", {
    assetType: "other",
    flow: "asset-intake",
    source: "other-asset-empty",
  });
};

const handleAddAssetChat = () => {
  setAssetPickerVisible(false);
  navigation.navigate("AddAssetChat", {
    assetType: "other",
    flow: "asset-intake",
    source: "other-asset-picker-chat",
  });
};

const getAssetKac = () => {
  return (
    asset?.kac ||
    asset?.kac_code ||
    asset?.kac_id ||
    asset?.kacId ||
    route?.params?.kac ||
    route?.params?.kacId ||
    route?.params?.kac_id ||
    null
  );
};

const goToKeeprIntelligenceUpdate = () => {
  const kac = String(getAssetKac() || "").trim();
  if (!kac) {
    Alert.alert(
      "Intelligence unavailable",
      "This asset does not yet have a Keepr Asset Code."
    );
    return;
  }
  navigation.navigate("KeeprIntelligenceUpdate", {
    kac,
    assetName: asset?.name || assetDisplayName || "Asset",
    assetType: "other",
  });
};

const goToPublicStory = () => {
  if (!asset?.id) return;

  const kac = String(getAssetKac() || "").trim();

  if (!kac) {
    Alert.alert(
      "Public story unavailable",
      "This asset does not yet have a Keepr Asset Code."
    );
    return;
  }

  const publicBase =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.origin
    : "https://app.keeprhome.com";

const publicUrl = `${publicBase}/k/${kac}`;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(publicUrl, "_blank", "noopener,noreferrer");
    return;
  }

  Linking.openURL(publicUrl);
};

const goToPublicStorySettings = () => {
  if (!asset?.id) return;

  navigation.navigate("PublicConfig", {
    assetId: asset.id,
    assetName: asset.name || assetDisplayName,
  });
};


  const handleSelectAsset = (asset) => {
    setAssetPickerVisible(false);
    if (!asset?.id) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    navigation.navigate(route?.name || "OtherAssetStory", { assetId: asset.id });
  };

  const scrollToTimeline = () => {
    if (!scrollRef.current || timelineY == null) return;
    scrollRef.current.scrollTo({ y: timelineY - 24, animated: true });
  };

// Delete flow
const startRemove = () => {
  if (!asset?.id) return;
  setRemoveModalVisible(true);
};

const handleConfirmRemove = async () => {
  if (!asset?.id) return;

  setActionLoading(true);
  try {
    const { error: updErr } = await supabase
      .from("assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset.id);

    if (updErr) {
      console.error("soft delete asset error", updErr);
      Alert.alert(
        "Couldn’t delete",
        updErr?.message || "Nothing was deleted."
      );
      return;
    }

    setRemoveModalVisible(false);
    Alert.alert("Deleted", "This asset was removed from your account.");

    navigation.reset({
      index: 0,
      routes: [
        {
          name: "RootTabs",
          state: {
            index: 0,
            routes: [{ name: "Dashboard" }],
          },
        },
      ],
    });
  } catch (e) {
    console.log("handleConfirmRemove asset error:", e);
    Alert.alert("Couldn’t delete", e?.message || "Nothing was deleted.");
  } finally {
    setActionLoading(false);
  }
};

  /* --------------------------- TIMELINE MODEL --------------------------- */

  const timelineItems = useMemo(() => {
    const items = [];

    const systemMap = {};
    (systems || []).forEach((s) => {
      if (s.id) systemMap[s.id] = s.name;
    });

    (storyEvents || []).forEach((ev) => {
      const type = ev.event_type || "";

      if (
        type === "service_event" ||
        type === "service_record_created" ||
        type === "service_record_updated" ||
        type === "service_record_deleted" ||
        type.startsWith("service_record_")
      ) {
        return;
      }

      items.push({
        id: ev.id,
        kind: "story",
        eventType: type,
        title: ev.title || "",
        description: ev.description || "",
        date:
          ev.occurred_at ||
          ev.created_at ||
          ev.inserted_at ||
          new Date().toISOString(),
      });
    });

    (serviceRecords || []).forEach((rec) => {
      const date =
        rec.performed_at ||
        rec.created_at ||
        rec.inserted_at ||
        new Date().toISOString();

      const systemName =
        rec.system_id && systemMap[rec.system_id]
          ? systemMap[rec.system_id]
          : null;

        items.push({
        id: rec.id,
        kind: "service",
        serviceRecordId: rec.id,
        title: rec.title || "Service visit",
        description: rec.notes || "",
        provider: rec.location || null,
        serviceType: rec.service_type || null,
        system_id: rec.system_id || null,
        systemName,
        cost: rec.cost,
        date,
        hasAttachment: !!serviceAttachments?.[rec.id],
      });
    });

    items.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return items;
  }, [storyEvents, serviceRecords, systems]);

const filteredTimelineItems = useMemo(() => {
  if (!timelineItems || timelineItems.length === 0) return [];

  if (timelineFilter === "all") return timelineItems;

  return timelineItems.filter((item) => {
    switch (timelineFilter) {
      case "service":
        // All service visits
        return item.kind === "service";

      case "moment":
        // Only story events whose DB event_type = "moment"
        return item.kind === "story" && item.eventType === "moment";

      case "pro":
        return (
          item.kind === "service" &&
          String(item.serviceType || "").toLowerCase() === "pro"
        );

      case "diy":
        return (
          item.kind === "service" &&
          String(item.serviceType || "").toLowerCase() === "diy"
        );

      default:
        // Fallback – behave like "all"
        return true;
    }
  });
}, [timelineItems, timelineFilter]);

  const goToTimelineRecord = (serviceRecordId) => {
    navigation.navigate("TimelineRecord", {
      sourceType: "service_record",
      serviceRecordId,
    });
  };

  const onTimelineItemPress = (item) => {
    if (item.kind === "service" && item.serviceRecordId) {
      goToTimelineRecord(item.serviceRecordId);
      return;
    }

    if (item.kind === "story") {
      navigation.navigate("TimelineRecord", {
        sourceType: "story_event",
        storyEventId: item.id,
      });
      return;
    }
  };

  /* --------------------------- PRINT STORY SHEET --------------------------- */

  const heroImage = heroUri ? { uri: heroUri } : null;

  const metaTiles = assetDefinition.metadata
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatAssetMetaValue(asset?.[field.key], field),
    }))
    .filter((field) => !!field.value);

  const hasMeta = metaTiles.length > 0;

  const assetLocation = asset?.location || null;
  const assetName = asset?.name || "My asset";

  const assetDisplayName =
  asset?.name ||
  asset?.title ||
  asset?.nickname ||
  asset?.asset_subtype ||
  "Asset";


  const goToStoryPrint = () => {
  if (!currentAsset?.id) return;

  const story = {
    assetId: currentAsset.id,
    assetType: "other",
    title: assetDisplayName,
    subtitle: "Asset overview",
    heroUri,
    purchaseDate: currentAsset.purchase_date || null,
    purchasePrice: currentAsset.purchase_price || null,
    estimatedValue: currentAsset.estimated_value || null,
    location: currentAsset.location || null,
    context: currentAsset.notes || "",
    timeline: (timelineItems || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.description,
      date: item.date,
      provider: item.provider || null,
      serviceType: item.serviceType || null,
      systemName: item.systemName || null,
      cost: item.cost ?? null,
    })),
  };

  navigation.navigate("StoryPrint", { story });
};

  /* --------------------------- GUARDS --------------------------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm }}>Loading asset…</Text>
        </View>

        <ReportsModal
        visible={reportsOpen}
        onClose={() => setReportsOpen(false)}
        asset={asset}
        navigation={navigation}
        onOpenStorySheet={goToStoryPrint}
        onOpenKeeprStory={goToKeeprStory}
      />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red" }}>{error}</Text>
        </View>
      
</SafeAreaView>
    );
  }

  if (!asset) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.appTitle}>
            Add your first asset
          </Text>
          <Text style={styles.appSubtitle}>
           This is where the living record of your asset will grow over time.
          </Text>
          <Text style={styles.appSubtitle}>
           Equipment, collectibles, tools, and everything else worth keeping.
          </Text>
          <View style={{ height: 10 }} />
          <Text style={{ color: colors.textSecondary }}>
            Add your first asset.
          </Text>

          <View style={{ height: 14 }} />

          <TouchableOpacity
            style={styles.emptyPrimaryBtn}
            onPress={handleAddAsset}
            activeOpacity={0.9}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.emptyPrimaryBtnText}>Add your first asset</Text>
          </TouchableOpacity>

          <View style={{ height: 8 }} />

          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={handleAddAssetChat}
            activeOpacity={0.9}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={colors.textPrimary}
            />
            <Text style={styles.emptySecondaryBtnText}>Add Asset with Kai</Text>
          </TouchableOpacity>
        </View>
  <ReportsModal
  visible={reportsOpen}
  onClose={() => setReportsOpen(false)}
  asset={asset}
  navigation={navigation}
  onOpenStorySheet={goToStoryPrint}
  onOpenKeeprStory={goToKeeprStory}
/>
</SafeAreaView>
    );
  }

  /* --------------------------- RENDER --------------------------- */

  return (
    <SafeAreaView style={layoutStyles.screen}>
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
        {/* Header row */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>{assetName} Story</Text>
            <Text style={styles.headerSubtitle}>
              A home for everything you own.
            </Text>
          </View>
        </View>

        {/* Asset row */}
        <View style={styles.assetPickerRow}>
          <View style={{ flex: 1 }}>
          </View>

          <TouchableOpacity
            style={styles.reportsButton}
            activeOpacity={0.9}
            onPress={() => setReportsOpen(true)}
          >
            <Ionicons name="documents-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.reportsButtonText}>Reports</Text>
          </TouchableOpacity>


          <TouchableOpacity
            style={styles.addAssetCircle}
            activeOpacity={0.9}
            onPress={handleAddAsset}
          >
            <Ionicons name="add-circle" size={35} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.assetPickerButton}
            activeOpacity={0.9}
            onPress={() => setAssetPickerVisible(true)}
          >
            <Ionicons name={assetDefinition.icon} size={14} color={colors.textPrimary} />
            <Text style={styles.assetPickerButtonText} numberOfLines={1}>
              {assetName}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Quick actions strip */}
        <View style={styles.quickActionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsScroll}
          >
            <QuickActionChip
              label="Timeline"
              icon="time-outline"
              onPress={scrollToTimeline}
            />
            <QuickActionChip
              label="Systems (soon)"
              icon="grid-outline"
              onPress={goToAssetSystems}
            />
            <QuickActionChip
              label="Intelligence"
              icon="sparkles-outline"
              onPress={goToKeeprIntelligenceUpdate}
            />
            <QuickActionChip
              label="Attachments"
              icon="attach-outline"
              onPress={goToAttachments}
            />
            <QuickActionChip
              label="Add to Timeline"
              icon="add-circle-outline"
              onPress={goToAddTimelineRecord}
            />
            <QuickActionChip
              label="Edit asset"
              icon="create-outline"
              onPress={goToEditAsset}
            />

            {/* Additional Buttons Not needed 
            <QuickActionChip
              label="Log pro"
              icon="briefcase-outline"
              onPress={goToLogPro}
            />
            <QuickActionChip
              label="Log DIY"
              icon="construct-outline"
              onPress={goToLogDIY}
            />
            <QuickActionChip
              label="Add via chat"
              icon="chatbubble-ellipses-outline"
              onPress={handleAddAssetChat}
            />
            */}
            <QuickActionChip
              label="Delete asset"
              icon="trash-outline"
              onPress={startRemove}
            />
          </ScrollView>
        </View>

        {/* Hero */}
        <View style={[styles.heroCard, isWide && styles.heroCardWide]}>
          <View style={[styles.heroImageWrap, isWide && styles.heroImageWrapWide]}>
          {heroImage ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={goToShowcase}
              style={styles.heroTouchable}
            >
              <Image
                source={heroImage}
                style={[styles.heroImage, isWide && styles.heroImageWide]}
                resizeMode="cover"
              />

              <View style={styles.heroOverlayIcon}>
                <Ionicons name="images-outline" size={18} color="white" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.heroPlaceholder}
              activeOpacity={0.85}
              onPress={uploadHeroPhoto}
            >
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              <Text style={styles.heroPlaceholderText}>Add Hero Photo</Text>
            </TouchableOpacity>
          )}

            {/* Tiny spinner while resolving placement */}
            {heroResolving && (
              <View style={styles.heroSpinner}>
                <ActivityIndicator size="small" color="white" />
              </View>
            )}
          </View>

          {/* Hero Meta Including Asset Completion Status */}
          <View style={[styles.heroMeta, isWide && styles.heroMetaWide]}>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {assetName}
            </Text>
            {!!assetLocation && (
              <Text style={styles.heroSubtitle} numberOfLines={1}>
                {assetLocation}
              </Text>
            )}

            {!!hasMeta && (
              <View style={styles.metaGrid}>
                {metaTiles.map((field) => (
                  <View key={field.key} style={styles.metaTile}>
                    <Text style={styles.metaLabel}>{field.label}</Text>
                    <Text style={styles.metaValue}>{field.value}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!assetProgress && (
            <View style={{ marginTop: spacing.md }}>
              <KeeprProgressCard
                mode="asset"
                progress={assetProgress}
                loading={false}
                onPress={handleKeeprProgressPress}
                onStepPress={(step) => {
                  if (step === "system") goToAssetSystems();
                  if (step === "record") goToAddTimelineRecord();
                  if (step === "proof") goToAttachments();
                }}
              />
            </View>
            )}
            <TouchableOpacity
            style={styles.primaryAddBtn}
            onPress={goToAttachments}
          >
            <Ionicons name="attach-outline" size={18} color="#fff" />
            <Text style={styles.primaryAddBtnText}>
              Add receipts, warranties, docs
            </Text>
          </TouchableOpacity>
          <PublicStoryCard
                asset={asset}
                assetName={assetName}
                onOpenSettings={goToPublicStorySettings}
              />
          </View>

        </View>

        {/* Timeline */}
        <View
          onLayout={(e) => setTimelineY(e.nativeEvent.layout.y)}
          style={styles.sectionCard}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={{ flex: 1 }} />
            {(svcLoading || storyLoading) && <ActivityIndicator size="small" />}
             <QuickActionChip
              label="Add To Timeline"
              icon="add-circle-outline"
              onPress={goToAddTimelineRecord}
            />
          </View>

          {(!!svcError || !!storyError) && (
            <Text style={styles.sectionError}>
              {svcError || storyError || "Could not load timeline."}
            </Text>
          )}

          <View style={styles.filterRow}>
            <TimelineFilterChip
              label="All"
              active={timelineFilter === "all"}
              onPress={() => setTimelineFilter("all")}
            />
            <TimelineFilterChip
              label="Service"
              active={timelineFilter === "service"}
              onPress={() => setTimelineFilter("service")}
            />
            <TimelineFilterChip
              label="Moments"
              active={timelineFilter === "moment"}
              onPress={() => setTimelineFilter("moment")}
            />
            <TimelineFilterChip
              label="Pro"
              active={timelineFilter === "pro"}
              onPress={() => setTimelineFilter("pro")}
            />
            <TimelineFilterChip
              label="DIY"
              active={timelineFilter === "diy"}
              onPress={() => setTimelineFilter("diy")}
            />
          </View>

          {filteredTimelineItems.length === 0 ? (
            <View style={{ paddingVertical: spacing.md }}>
              <Text style={styles.emptyTimelineText}>
                No timeline items yet. Log your first service record or add a story
                event.
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {filteredTimelineItems.map((item) => (
                <TimelineRow
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  onPress={onTimelineItemPress}
                  hasAttachment={
                    item.kind === "service" &&
                    !!serviceAttachments?.[item.serviceRecordId]
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add event pill (context: asset) */}
      {!!asset?.id && (
        <EventPill
          label="Add a quick event"
          onPress={() =>
            navigation.navigate("CreateEvent", {
              assetId: asset.id,
              assetType: "other",
              assetName: asset.name || "Asset",
            })
          }
        />
      )}

      {/* Asset picker modal */}
      <Modal
        visible={assetPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAssetPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Select asset</Text>
              </View>

              <TouchableOpacity
                onPress={handleAddAssetChat}
                style={styles.modalMiniBtn}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="sparkles-outline"
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.modalMiniBtnText}>Add Asset with Kai</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setAssetPickerVisible(false)}
                style={{ marginLeft: 6 }}
              >
                <Ionicons
                  name="close-outline"
                  size={22}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: spacing.sm }}
            >
              {assets.map((h) => {
                const isActive = h.id === asset?.id;

                return (
                  <TouchableOpacity
                    key={h.id}
                    style={[
                      styles.modalAssetRow,
                      isActive && styles.modalAssetRowActive,
                    ]}
                    onPress={() => handleSelectAsset(h)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={assetDefinition.icon}
                      size={18}
                      color={isActive ? colors.textPrimary : colors.textMuted}
                    />
                    <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                      <Text style={styles.modalAssetName} numberOfLines={1}>
                        {h.name || "Untitled asset"}
                      </Text>
                      {!!h.location && (
                        <Text style={styles.modalAssetMeta} numberOfLines={1}>
                          {h.location}
                        </Text>
                      )}
                    </View>
                    {isActive && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.accentGreen}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete modal */}
      <Modal
        visible={removeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Delete asset?</Text>
              <TouchableOpacity
                onPress={() => setRemoveModalVisible(false)}
                style={{ marginLeft: 6 }}
              >
                <Ionicons
                  name="close-outline"
                  size={22}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalBodyText}>
            This will remove this asset from your account.
            </Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonGhost]}
                onPress={() => setRemoveModalVisible(false)}
                activeOpacity={0.85}
                disabled={actionLoading}
              >
                <Text style={styles.modalButtonGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalButton,
                  { backgroundColor: colors.danger || "#DC2626" },
                ]}
                onPress={handleConfirmRemove}
                activeOpacity={0.9}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalButtonPrimaryText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

 <ReportsModal
  visible={reportsOpen}
  onClose={() => setReportsOpen(false)}
  asset={asset}
  navigation={navigation}
  onOpenStorySheet={goToStoryPrint}
  onOpenKeeprStory={goToKeeprStory}
/>
</SafeAreaView>
  );
}

/* --------------------------- STYLES --------------------------- */

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },

  // Web-only: keep content comfortably readable on large monitors.

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },

  appTitle: { ...typography.title },
  appSubtitle: { ...typography.subtitle, marginTop: 2 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  backButton: {
    marginRight: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: 4,
  },
  headerTitleCol: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  assetPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  assetPickerLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  assetPickerSubtitle: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 2,
  },
  addAssetCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.subtle,
  },
  assetPickerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    maxWidth: 200,
  },
  assetPickerButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
    maxWidth: 140,
  },

  quickActionsRow: { marginBottom: spacing.md },
  quickActionsScroll: { paddingRight: spacing.lg },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  chipPrimary: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  chipLabelPrimary: { color: "white" },

  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
    marginBottom: spacing.lg,
  },
  heroImageWrap: {
    width: "100%",
    aspectRatio: HERO_ASPECT,
    backgroundColor: colors.surfaceSubtle,
     borderRadius: radius.lg,
  },
  heroImage: { width: "100%", height: "100%" },

  heroTouchable: {
  width: "100%",
  height: "100%",
},

heroOverlayIcon: {
  position: "absolute",
  right: 10,
  top: 10,
  backgroundColor: "rgba(15,23,42,0.6)",
  borderRadius: 999,
  padding: 6,
},

primaryAddBtn: {
  marginTop: 12,
  backgroundColor: colors.primary, // Keepr blue
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderRadius: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
},

primaryAddBtnText: {
  color: "#fff",
  fontWeight: "600",
},

  // Web-only: Redfin-style two-column header (hero left, details right).
  heroCardWide: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  heroImageWrapWide: {
    // width: 0 enables flex sizing in a row layout
    width: 0,
    flex: 1.35,
    minHeight: 280,
  },
  heroMetaWide: {
    flex: 1,
  },
  heroPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroPlaceholderText: { color: colors.textMuted, fontWeight: "700" },

  heroSpinner: {
    position: "absolute",
    right: 10,
    bottom: 10,
    backgroundColor: "rgba(15,23,42,0.65)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  heroMeta: { padding: spacing.lg },
  heroTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  heroSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },

  metaGrid: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaTile: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minWidth: 110,
  },
  metaLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "800" },
  metaValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "800",
    marginTop: 3,
  },

  sectionCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...shadows.subtle,
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  sectionError: { color: "#ef4444", marginBottom: spacing.sm },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    borderColor: colors.brandBlue,
    backgroundColor: colors.surfaceSubtle,
  },
  filterChipLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  filterChipLabelActive: { color: colors.textPrimary },

  emptyTimelineText: { color: colors.textSecondary, lineHeight: 18 },

  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  timelineIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  timelineTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    flex: 1,
  },
  timelineDate: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "700",
  },
  timelineSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },

  timelineMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },

  emptyPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    ...shadows.subtle,
  },
  emptyPrimaryBtnText: { color: "white", fontWeight: "800" },

  emptySecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    ...shadows.subtle,
  },
  emptySecondaryBtnText: { color: colors.textPrimary, fontWeight: "800" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  modalBodyText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },

  modalMiniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  modalMiniBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  modalAssetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalAssetRowActive: { backgroundColor: colors.surfaceSubtle },
  modalAssetName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  modalAssetMeta: { fontSize: 12, color: colors.textMuted },

  modalButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  modalButtonGhost: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
},
  reportsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  reportsButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
});
