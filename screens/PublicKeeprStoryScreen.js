// screens/PublicKeeprStoryScreen.js

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Share,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as MediaLibrary from "expo-media-library";
import { captureRef } from "react-native-view-shot";
import QRCode from "react-native-qrcode-svg";
import PublicShell from "../components/public/PublicShell";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";
import ShowcaseAttachmentsSection from "../components/showcase/ShowcaseAttachmentsSection";
import { getSignedUrl, listAttachmentsForTarget } from "../lib/attachmentsApi";

import { supabase } from "../lib/supabaseClient";
import { formatKeeprDate } from "../lib/dateFormat";
const keeprEnabledMark = require("../assets/public/keepr-enabled-mark-180.png");
const keeprEnabledWatermark = require("../assets/public/keepr-enabled-mark-120.png");
const keeprLogo = require("../assets/app_logo_icon.png");

const HERO_ASPECT = 4 / 3;
const IS_WEB = Platform.OS === "web";
const PROJECT_REF = "jjzjuqxysucqutgjnrkk";
const FUNCTIONS_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const DEBUG_PUBLIC_STORY_LOAD = false;

function logPublicStoryLoad(...args) {
  if (DEBUG_PUBLIC_STORY_LOAD) {
    console.log(...args);
  }
}

function getPublicStoryBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  return (
    process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
    process.env.PUBLIC_KEEPR_BASE_URL ||
    "https://app.keeprhome.com"
  );
}

class ShareQrBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.value !== this.props.value && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error) {
    console.log("Public Keepr Story QR render failed:", error?.message || error);
  }

  render() {
    if (this.state.hasError || !this.props.value) {
      return (
        <View style={styles.shareQrFallback}>
          <Ionicons name="qr-code-outline" size={34} color={colors.textMuted} />
          <Text style={styles.shareQrFallbackTitle}>QR unavailable</Text>
          <Text style={styles.shareQrFallbackText}>
            Share Story and Copy Link still work.
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

function extractHashtags(text) {
  return Array.from(
    new Set(
      String(text || "")
        .match(/#[A-Za-z0-9_]+/g)
        ?.map((tag) => tag.replace("#", "").toLowerCase()) || []
    )
  );
}

function getStoryTags(asset) {
  const md = asset?.extra_metadata || {};
  const rawNarrative =
  asset?.extra_metadata?.publicStoryNarrative ||
  asset?.public_story_narrative ||
  "";

  const narrative = String(rawNarrative)
    .replace(/#[A-Za-z0-9_]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

    return [
      ...(Array.isArray(md.publicStoryTags) ? md.publicStoryTags : []),
      ...extractHashtags(narrative),
    ].filter(Boolean);
  }

function SafeShareQrCode({ value, size }) {
  return (
    <ShareQrBoundary value={value}>
      <QRCode value={value || "https://app.keeprhome.com"} size={size} />
    </ShareQrBoundary>
  );
}

/* -------------------------------------------------------------------------- */
/*                              TIMELINE COMPONENT                            */
/* -------------------------------------------------------------------------- */

function TimelineRow({
  item,
  expanded,
  onPress,
  showProofBadges,
}) {
  const isService = item.kind === "service";

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
    <View style={styles.timelineRow}>
      <View style={styles.timelineIcon}>
        <Ionicons
          name={isService ? "construct-outline" : "sparkles-outline"}
          size={16}
          color={colors.textPrimary}
        />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.timelineTopRow}>
          <Text style={styles.timelineTitle}>
            {item.title || "Timeline Event"}
             <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textMuted}
            />
          </Text>

          <Text style={styles.timelineDate}>
            {item.date ? formatKeeprDate(item.date) : ""}
          </Text>
         
        </View>

        {!!item.description && expanded && (
        <Text style={styles.timelineSubtitle}>
            {item.description}
        </Text>
        )}

        <View style={styles.timelineMetaRow}>
          {showProofBadges && !!item.documentCount && (
            <View style={styles.metaPill}>
              <Ionicons
                name="document-text-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.metaPillText}>
                {item.documentCount} documents
              </Text>
            </View>
          )}

          {showProofBadges && !!item.photoCount && (
            <View style={styles.metaPill}>
              <Ionicons
                name="images-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.metaPillText}>
                {item.photoCount} photos
              </Text>
            </View>
          )}

          {showProofBadges && !!item.verified && (
            <View style={styles.metaPill}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.metaPillText}>Verified</Text>
            </View>
          )}
        </View>
        {!!item.description && (
  <Text style={styles.expandLabel}>
    {expanded ? "Hide details" : "View details"}
  </Text>
)}
      </View>
      
    </View>
    </TouchableOpacity>
  );
}

async function fetchPublicStoryMedia(kac) {
  if (!kac || !ANON_KEY) return [];

  const res = await fetch(`${FUNCTIONS_BASE}/public-story-media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ kac }),
  });

  const json = await res.json();

  if (!res.ok) {
    logPublicStoryLoad("PUBLIC STORY MEDIA ERROR:", json);
    return [];
  }

  return Array.isArray(json?.media) ? json.media : [];
}

/* -------------------------------------------------------------------------- */
/*                           PUBLIC KEEPR STORY SCREEN                        */
/* -------------------------------------------------------------------------- */

export default function PublicKeeprStoryScreen({ navigation, route }) {
  const { width, height } = useWindowDimensions();
  const isWide = IS_WEB && width >= 980;

const kac = route?.params?.kac || null;

const webParams =
  Platform.OS === "web" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;

const assetId =
  route?.params?.assetId ||
  webParams?.get("assetId") ||
  null;

const originHubId =
  route?.params?.hubId ||
  webParams?.get("hubId") ||
  null;

const isInternalMode =
  route?.params?.mode === "internal" ||
  webParams?.get("mode") === "internal";


const originHubSlug =
  route?.params?.hubSlug ||
  webParams?.get("hub") ||
  null;

const originHubName =
  route?.params?.hubName ||
  webParams?.get("hubName") ||
  null;


  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState(null);
  const [heroUri, setHeroUri] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [showcaseFiles, setShowcaseFiles] = useState([]);
  const [showcaseLinks, setShowcaseLinks] = useState([]);
  const [systems, setSystems] = useState([]);
  const [activeTab, setActiveTab] = useState("story");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [swipeStartX, setSwipeStartX] = useState(null);
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [ownerProfile, setOwnerProfile] = useState(null);

  const publicConfig =
  asset?.public_config ||
  asset?.extra_metadata?.publicConfig ||
  {};

  const storyConfig = publicConfig.story || {};
  const narrative =
  asset?.extra_metadata?.publicStoryNarrative ||
  asset?.public_story_narrative ||
  "";

const showNarrative =
  storyConfig.showNarrative !== false &&
  String(narrative).trim().length > 0;

  const storyTags = getStoryTags(asset);

  const actionConfig = publicConfig.actions || {};
  const sharingConfig = publicConfig.sharing || {};

 const publicEnabled = storyConfig.enabled === true;

  const showHero = storyConfig.showHero !== false;
  const showGallery = storyConfig.showGallery !== false;
  const showSystems = storyConfig.showSystems !== false;
  const showProof = storyConfig.showProof !== false;
  const showProofBadges = storyConfig.showProofBadges !== false;
  const showQrShare = storyConfig.showQrShare !== false;
  const showFooterCta = storyConfig.showFooterCta !== false;
  const showLocation = storyConfig.showLocation === true;
  const showFinancials = storyConfig.showFinancials === true;

  const timelineMode = storyConfig.showTimeline || "all";

  const scrollRef = useRef(null);
  const shareCardCaptureRef = useRef(null);
  const assetTitle =
    asset?.name || `${asset?.year || ""} ${asset?.make || ""} ${asset?.model || ""}`.trim() || "Keepr Story";
  const publicStoryUrl = useMemo(() => {
    const publicKac = asset?.kac_id || kac;
    if (!publicKac) return "";
    return `${getPublicStoryBaseUrl()}/k/${publicKac}`;
  }, [asset?.kac_id, kac]);
  const shareQrSize = Math.min(260, Math.max(210, width - 112));
  const shareModalMaxHeight = Math.max(320, height - 48);

  const handleShareStory = useCallback(async () => {
    if (!publicStoryUrl) return;

    try {
      await Share.share({
        title: assetTitle,
        message: `${assetTitle} - view the public KeeprStory\n${publicStoryUrl}`,
        url: publicStoryUrl,
      });
    } catch (e) {
      Alert.alert("Share failed", e?.message || "Unable to open the share sheet.");
    }
  }, [assetTitle, publicStoryUrl]);

const ownerDisplayName = asset?.owner_name || null;

  const handleCopyPublicLink = useCallback(async () => {
    if (!publicStoryUrl) return;

    try {
      await Clipboard.setStringAsync(publicStoryUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch (e) {
      Alert.alert("Copy failed", e?.message || "Unable to copy this link.");
    }
  }, [publicStoryUrl]);

  const openUrl = useCallback(async (url) => {
  if (!url) return;

  try {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = url;
      return;
    }

    await Linking.openURL(url);
  } catch (e) {
    Alert.alert("Couldn’t open link", e?.message || "Please try again.");
  }
}, []);

  const handleSaveQrImage = useCallback(async () => {
    if (!shareCardCaptureRef.current) {
      Alert.alert("Save QR", "The QR card is not ready yet. Try again in a moment.");
      return;
    }

    try {
      if (Platform.OS === "web") {
        if (typeof document === "undefined") {
          Alert.alert("Save QR", "Download is not available here. Use Copy Link or Share Story.");
          return;
        }

        const dataUri = await captureRef(shareCardCaptureRef.current, {
          format: "png",
          quality: 1,
          result: "data-uri",
        });

        const link = document.createElement("a");
        const safeKac = String(asset?.kac_id || kac || "keepr-story").replace(/[^a-z0-9_-]/gi, "-");
        link.href = dataUri;
        link.download = `${safeKac}-keepr-qr.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert("Permission needed", "Allow photo library access to save this QR card.");
        return;
      }

      const uri = await captureRef(shareCardCaptureRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });

      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Saved", "Keepr QR card saved to your photo library.");
    } catch (e) {
      console.log("Save public story QR failed:", e?.message || e);
      Alert.alert("Save failed", e?.message || "Unable to save this QR card. Use Copy Link or Share Story.");
    }
  }, [asset?.kac_id, kac]);

  /* ------------------------------------------------------------------------ */
  /*                              LOAD PUBLIC STORY                           */
  /* ------------------------------------------------------------------------ */

  const looksLikeImageAttachment = (row = {}) => {
  const kind = row.kind || "";
  const mime = String(row.mime_type || "").toLowerCase();
  const fileName = row.file_name || row.storage_path || "";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  return (
    kind === "photo" ||
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)
  );
};
  
  const loadPublicStory = useCallback(async () => {
  if (!kac && !assetId) return;

  setLoading(true);

  try {
    let assetRow = null;

// PUBLIC URL MODE
if (kac) {
  const cleanKac = String(kac || "").trim();

  const { data: summaryRow, error: summaryError } = await supabase
    .from("public_asset_story_summary")
    .select("*")
    .eq("kac_id", cleanKac)
    .maybeSingle();

  logPublicStoryLoad("Public story summary load failed", summaryError);

if (summaryRow) {
  assetRow = {
    ...summaryRow,
    id: summaryRow.asset_id,
  };

  const { data: fullAssetRow, error: fullAssetError } = await supabase
    .from("assets")
    .select("extra_metadata")
    .eq("id", summaryRow.asset_id)
    .maybeSingle();

  if (fullAssetError) {
    console.log("PUBLIC STORY FULL ASSET LOAD FAILED", fullAssetError);
  }

  assetRow.extra_metadata = fullAssetRow?.extra_metadata || {};
}
}

    // INTERNAL PREVIEW MODE
    if (!assetRow && assetId) {
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .maybeSingle();

      logPublicStoryLoad("Public preview asset load failed", error);

      assetRow = data || null;
    }

    if (!assetRow) {
      return;
    }

    setAsset(assetRow);

    const publicAssetId = assetRow.asset_id || assetRow.id;

    const attachmentRows = await listAttachmentsForTarget("asset", publicAssetId);
    const showcasedAttachments = (attachmentRows || []).filter((row) => row.is_showcase);

    setShowcaseFiles(
      showcasedAttachments.filter(
        (row) => row.kind !== "link" && !looksLikeImageAttachment(row)
      )
    );

    setShowcaseLinks(
      showcasedAttachments.filter((row) => row.kind === "link")
    );

    const publicKac = assetRow.kac_id || kac;

      logPublicStoryLoad("PUBLIC STORY ASSET ROW:", assetRow);
      logPublicStoryLoad("PUBLIC STORY HERO IMAGE URL:", assetRow?.hero_image_url);
      logPublicStoryLoad("PUBLIC STORY HERO PLACEMENT ID:", assetRow?.hero_placement_id);
      logPublicStoryLoad("PUBLIC STORY PUBLIC ASSET ID:", publicAssetId);

  
      /* ----------------------- TIMELINE / SYSTEMS / MEDIA -------------------- */

      const [
        { data: serviceRows, error: timelineError },
        { data: systemRows },
        mediaRows,
      ] = await Promise.all([
        supabase
          .from("public_asset_story_timeline")
          .select("*")
          .eq("kac_id", publicKac)
          .order("performed_at", { ascending: false }),
        supabase
          .from("systems")
          .select("id, name")
          .eq("asset_id", publicAssetId)
          .order("name", { ascending: true }),
        fetchPublicStoryMedia(publicKac),
      ]);

      logPublicStoryLoad("PUBLIC TIMELINE:", serviceRows);
      logPublicStoryLoad("PUBLIC TIMELINE ERROR:", timelineError);
      logPublicStoryLoad("PUBLIC STORY MEDIA:", mediaRows);

      const publicTimeline = (serviceRows || []).map((row) => ({
        id: row.id,
        kind: row.kind || "service",
        title: row.title,
        description: row.description,
        date: row.performed_at,
        verified: row.verified,
        documentCount: row.document_count,
        photoCount: row.photo_count,
      }));

      setTimeline(publicTimeline);

      setSystems(systemRows || []);

      /* ------------------------------ HERO IMAGE ----------------------------- */

      const heroPlacement =
        mediaRows.find(
          (x) => String(x.placement_id) === String(assetRow.hero_placement_id)
        ) ||
        mediaRows.find((x) => x.role === "hero") ||
        null;

      logPublicStoryLoad("PUBLIC HERO PLACEMENT:", heroPlacement);

      setHeroUri(heroPlacement?.image_url || null);

      /* ----------------------------- GALLERY MAP ----------------------------- */

      const sortedMediaRows = [...mediaRows].sort((a, b) => {
        if (a.role === "hero" && b.role !== "hero") return -1;
        if (b.role === "hero" && a.role !== "hero") return 1;

        const aSort = a.sort_order ?? 9999;
        const bSort = b.sort_order ?? 9999;

        if (aSort !== bSort) return aSort - bSort;

        return 0;
      });

      const dedupedGalleryRows = Array.from(
        new Map(
          sortedMediaRows
          .filter((row) => {
            const url = String(row.image_url || "").trim();
            const kind = String(row.kind || row.attachment_kind || "").toLowerCase();
            const mime = String(row.mime_type || "").toLowerCase();
            const name = String(row.file_name || row.storage_path || "").toLowerCase();

            const isImage =
              kind === "photo" ||
              kind === "image" ||
              mime.startsWith("image/") ||
              /\.(jpg|jpeg|png|webp|heic|heif)$/.test(name) ||
              /\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/.test(url);

            return (
              isImage &&
              !!url &&
              url !== "null" &&
              url !== "undefined" &&
              !url.includes("placeholder") &&
              !url.includes("image-outline")
            );
          })
            .map((row) => [row.image_url, row])
        ).values()
      );

      setGallery(
        dedupedGalleryRows.map((row, index) => ({
          id: row.attachment_id || row.placement_id || `${row.image_url}-${index}`,
          uri: row.image_url,
          role: row.role,
        }))
      );

    } catch (e) {
      logPublicStoryLoad("Public story load error", e);
    } finally {
      setLoading(false);
    }
  }, [kac, assetId]);

  useEffect(() => {
    loadPublicStory();
  }, [loadPublicStory]);

  const goBackToOriginHub = useCallback(() => {
    if (isInternalMode && originHubId) {
      navigation.navigate("KeeprHubInternal", {
        hubId: originHubId,
        mode: "internal",
      });
      return;
    }

    if (!originHubSlug) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = `/h/${originHubSlug}`;
      return;
    }

    navigation.navigate("KeeprHub", { slug: originHubSlug });
  }, [navigation, originHubSlug, isInternalMode, originHubId]);

  const renderShell = (children) => {
      if (isInternalMode) {
        return (
          <SafeAreaView
            style={styles.internalStorySafe}
            edges={["top", "left", "right", "bottom"]}
          >
            <ScrollView
              ref={scrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.internalStoryScrollContent}
            >
              <View style={styles.internalStoryShell}>
                {children}
              </View>
            </ScrollView>
          </SafeAreaView>
        );
      }

      return (
        <PublicShell
          kac={kac || asset?.kac_id}
          contextTitle={asset?.name}
          contextSubtitle="Keepr Story"
          viewerLabel={
            ownerDisplayName
              ? `Owned by ${ownerDisplayName}`
              : "Public Story"
          }
          primaryActionLabel="Open in Keepr"
          onPrimaryAction={() => {
            if (Platform.OS === "web") {
              window.location.href = "/dashboard";
            } else {
              navigation.navigate("Dashboard");
            }
          }}
        >
          {children}
        </PublicShell>
      );
};

  /* ------------------------------------------------------------------------ */
  /*                                   LOADING                                */
  /* ------------------------------------------------------------------------ */

if (loading) {
  return renderShell(
    <View style={styles.centered}>
      <ActivityIndicator />
      <Text style={{ marginTop: spacing.sm }}>Loading Keepr Story...</Text>
    </View>
  );
}

if (!asset || !publicEnabled) {
  return renderShell(
  <View style={styles.centered}>
    <Text style={styles.notFoundTitle}>Story not found</Text>
    <Text style={styles.notFoundText}>
      This Keepr Story may be private or unavailable.
    </Text>
  </View>
);
}


  /* ------------------------------------------------------------------------ */
  /*                                  RENDER                                  */
  /* ------------------------------------------------------------------------ */

return (
  <>
    {renderShell(
      <>

            {(originHubSlug || isInternalMode) && (
          <TouchableOpacity
            style={styles.originHubBack}
            onPress={goBackToOriginHub}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.originHubBackText}>
              Back to {originHubName || "Hub"}
            </Text>
          </TouchableOpacity>
        )}

        {/* HERO */}
        {showHero && (
        <View style={[styles.heroCard, isWide && styles.heroCardWide]}>
          <View style={[styles.heroImageWrap, isWide && styles.heroImageWrapWide]}>
            {!!heroUri ? (
              <TouchableOpacity
                activeOpacity={0.96}
                style={{ flex: 1 }}
                onPress={() => {
                  const heroIndex = gallery.findIndex(
                    (x) => x.uri === heroUri
                  );

                  setLightboxIndex(heroIndex >= 0 ? heroIndex : 0);
                }}
              >
                <Image
                  source={{ uri: heroUri }}
                  style={styles.heroImage}
                  resizeMode="cover"
                />

                <View style={styles.heroZoomHint}>
                  <Ionicons
                    name="expand-outline"
                    size={18}
                    color="white"
                  />
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.heroPlaceholder}>
                <Ionicons
                  name="image-outline"
                  size={28}
                  color={colors.textMuted}
                />
              </View>
            )}
          </View>

          <View style={[styles.heroMeta, isWide && styles.heroMetaWide]}>
            

            <Text style={styles.heroTitle}>
              {asset.name || `${asset.year || ""} ${asset.make || ""} ${asset.model || ""}`.trim()}
            </Text>

            <Text style={styles.heroSubtitle}>
              Documented ownership story and stewardship.
            </Text>

            {ownerDisplayName ? (
              <View style={styles.ownerByline}>
                <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.ownerBylineText}>Owned by {ownerDisplayName}</Text>
              </View>
            ) : null}

            <Image
            source={keeprEnabledMark}
            style={styles.keeprEnabledMark}
            resizeMode="contain"
            />
               {showNarrative ? (
              <View style={styles.narrativeBox}>
            <Text style={styles.narrativeText}>
              {narrative}
            </Text>
              </View>
            ) : null}

              {storyTags.length > 0 ? (
              <View style={styles.hashtagRow}>
                {storyTags.slice(0, 8).map((tag) => (
                  <View key={tag} style={styles.hashtagPill}>
                    <Text style={styles.hashtagText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.metaGrid}>
            {/* VEHICLE */}

            {asset.type === "vehicle" && (
              <>
                {!!asset.year && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Year</Text>
                    <Text style={styles.metaValue}>{asset.year}</Text>
                  </View>
                )}

                {!!asset.make && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Make</Text>
                    <Text style={styles.metaValue}>{asset.make}</Text>
                  </View>
                )}

                {!!asset.model && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Model</Text>
                    <Text style={styles.metaValue}>{asset.model}</Text>
                  </View>
                )}

                {!!asset.current_odometer && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Mileage</Text>
                    <Text style={styles.metaValue}>
                      {Number(asset.current_odometer).toLocaleString()} mi
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* BOAT */}

            {asset.type === "boat" && (
              <>
                {!!asset.year && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Year</Text>
                    <Text style={styles.metaValue}>{asset.year}</Text>
                  </View>
                )}

                {!!asset.make && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Builder</Text>
                    <Text style={styles.metaValue}>{asset.make}</Text>
                  </View>
                )}

                {!!asset.model && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Model</Text>
                    <Text style={styles.metaValue}>{asset.model}</Text>
                  </View>
                )}

                {!!asset.length_feet && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Length</Text>
                    <Text style={styles.metaValue}>{asset.length_feet} ft</Text>
                  </View>
                )}
              </>
            )}

            {/* HOME */}

            {asset.type === "home" && (
              <>
                {!!asset.year_built && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Year Built</Text>
                    <Text style={styles.metaValue}>{asset.year_built}</Text>
                  </View>
                )}

                {!!asset.square_feet && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Sq Ft</Text>
                    <Text style={styles.metaValue}>
                      {Number(asset.square_feet).toLocaleString()}
                    </Text>
                  </View>
                )}

                {!!asset.beds && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Beds</Text>
                    <Text style={styles.metaValue}>{asset.beds}</Text>
                  </View>
                )}

                {!!asset.baths && (
                  <View style={styles.metaTile}>
                    <Text style={styles.metaLabel}>Baths</Text>
                    <Text style={styles.metaValue}>{asset.baths}</Text>
                  </View>
                )}
              </>
            )}
            {showQrShare && (
            <TouchableOpacity
              style={styles.shareStoryButton}
              onPress={() => {
                if (Platform.OS === "web") {
                  setShareModalVisible(true);
                } else {
                  handleShareStory();
                }
              }}
              activeOpacity={0.9}
            >
              <Ionicons name="qr-code-outline" size={16} color="white" />
              <Text style={styles.shareStoryButtonText}>Share / QR Code</Text>
            </TouchableOpacity>
            )}
          </View>
          </View>
        </View>
        )}
        
        {/* PUBLIC TABS */}
        <View style={styles.tabsRow}>
          {timelineMode !== "hidden" && (
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === "story" && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab("story")}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === "story" && styles.tabLabelActive,
              ]}
            >
              Timeline
            </Text>
          </TouchableOpacity>
          )}
          
          {showGallery && (
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === "gallery" && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab("gallery")}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === "gallery" && styles.tabLabelActive,
              ]}
            >
              Showcase
            </Text>
          </TouchableOpacity>
          )}

          {actionConfig.actionsEnabled?.length > 0 && (
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === "actions" && styles.tabButtonActive,
            ]}
            onPress={() => {
              if (isInternalMode) {

                console.log("OPEN KEEPR ACTION FROM STORY", {
                assetId: asset?.asset_id || asset?.id,
                assetName: asset?.name,
                owner_id: asset?.owner_id,
                ownerId: asset?.ownerId,
                originHubId,
              });
              navigation.navigate("KeeprAction", {
                assetId: asset?.asset_id || asset?.id,
                kac: asset?.kac_id || kac,
                assetName: asset?.name,
                assetOwnerId: asset?.owner_id || asset?.ownerId || null,
                hubId: originHubId,
                hubName: originHubName,
                mode: "internal",
              });
                return;
              }

              navigation.navigate("PublicAction", {
                kac,
                assetId: asset?.asset_id || asset?.id,
              });
            }}
          >
          <Text
            style={[
              styles.tabLabel,
              activeTab === "actions" && styles.tabLabelActive,
            ]}
          >
            {isInternalMode ? "Messages" : "Actions"}
          </Text>
          </TouchableOpacity>
          )}

        </View>

        {/* STORY TAB */}

        {/* TIMELINE */}

        {timelineMode !== "hidden" && activeTab === "story" && (
          <>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Ownership Timeline</Text>
              </View>

                {timeline.map((item) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  expanded={expandedTimelineId === item.id}
                  showProofBadges={showProofBadges}
                  onPress={() =>
                    setExpandedTimelineId(
                      expandedTimelineId === item.id ? null : item.id
                    )
                  }
                />
              ))}
            </View>

            {/* SYSTEMS */}

            {showSystems && !!systems.length && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Systems</Text>
                </View>

                <View style={styles.systemsGrid}>
                  {systems.map((system) => (
                    <View key={system.id} style={styles.systemCard}>
                      <Ionicons
                        name="hardware-chip-outline"
                        size={18}
                        color={colors.textPrimary}
                      />

                      <Text style={styles.systemName}>{system.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* GALLERY TAB */}

{showGallery && activeTab === "gallery" && (
  <>
<View style={styles.sectionCard}>
  <ShowcaseAttachmentsSection
    variant="public"
    files={showcaseFiles}
    links={showcaseLinks}
    getFileUrl={async (file) => {
      if (file.url) return file.url;

      if (file.bucket && file.storage_path) {
        return await getSignedUrl({
          bucket: file.bucket,
          path: file.storage_path,
        });
      }

      return null;
    }}
  />

  {!!gallery.length && (
    <>
      <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
        <Text style={styles.sectionTitle}>Gallery</Text>
      </View>

      <View style={styles.publicGalleryWrap}>
        {gallery.map((image, index) => (
          <TouchableOpacity
            key={image.id}
            style={styles.publicGalleryTile}
            activeOpacity={0.92}
            onPress={() => setLightboxIndex(index)}
          >
            <Image
              source={{ uri: image.uri }}
              style={styles.publicGalleryImage}
              resizeMode="cover"
            />
            <View style={styles.galleryScrim} />
            <Image
              source={keeprEnabledWatermark}
              style={styles.galleryWatermark}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ))}
      </View>
    </>
  )}
</View>
  </>
)}
      <Modal
        visible={lightboxIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxIndex(null)}
      >
        <View
        style={styles.lightbox}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          setSwipeStartX(e.nativeEvent.pageX);
        }}
        onResponderRelease={(e) => {
          if (swipeStartX == null) return;

          const dx = e.nativeEvent.pageX - swipeStartX;

          if (Math.abs(dx) > 50) {
            setLightboxIndex((prev) => {
              if (prev == null) return prev;
              if (dx < 0) return prev === gallery.length - 1 ? 0 : prev + 1;
              return prev === 0 ? gallery.length - 1 : prev - 1;
            });
          }

          setSwipeStartX(null);
        }}
      >
    <View style={styles.lightboxTopBar}>
      <Text style={styles.lightboxCount}>
        {lightboxIndex !== null ? `${lightboxIndex + 1} of ${gallery.length}` : ""}
      </Text>

      <TouchableOpacity onPress={() => setLightboxIndex(null)}>
        <Ionicons name="close" size={30} color="white" />
      </TouchableOpacity>
    </View>

    {!!gallery[lightboxIndex]?.uri && (
      <Image
        source={{ uri: gallery[lightboxIndex].uri }}
        style={styles.lightboxImage}
        resizeMode="contain"
      />
    )}

    <TouchableOpacity
      style={[styles.lightboxArrow, styles.lightboxArrowLeft]}
      onPress={() =>
        setLightboxIndex((prev) =>
          prev === 0 ? gallery.length - 1 : prev - 1
        )
      }
    >
      <Ionicons name="chevron-back" size={42} color="white" />
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.lightboxArrow, styles.lightboxArrowRight]}
      onPress={() =>
        setLightboxIndex((prev) =>
          prev === gallery.length - 1 ? 0 : prev + 1
        )
      }
    >
      <Ionicons name="chevron-forward" size={42} color="white" />
    </TouchableOpacity>
  </View>
</Modal>
      </>
    )}
  <Modal
    visible={shareModalVisible}
    transparent
    animationType="fade"
    presentationStyle="overFullScreen"
    statusBarTranslucent
    hardwareAccelerated
    onRequestClose={() => setShareModalVisible(false)}
  >
    <View style={styles.shareModalScrim}>
      <Pressable
        style={styles.shareModalBackdrop}
        onPress={() => setShareModalVisible(false)}
      />

      <SafeAreaView style={styles.shareModalSafeArea} pointerEvents="box-none">
      <View style={[styles.shareModalCard, { maxHeight: shareModalMaxHeight }]}>
        <ScrollView
          contentContainerStyle={styles.shareModalScroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.shareModalTopRow}>
            <View style={styles.shareModalBrand}>
              <Image source={keeprLogo} style={styles.shareModalLogo} />
              <Text style={styles.shareModalKicker}>Keepr Enabled</Text>
            </View>

            <TouchableOpacity
              style={styles.shareModalClose}
              onPress={() => setShareModalVisible(false)}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View
            ref={shareCardCaptureRef}
            collapsable={false}
            style={styles.shareCaptureCard}
          >
            <View style={styles.shareBrandedQrWrap}>
              <View style={styles.shareQrPanel}>
                <SafeShareQrCode value={publicStoryUrl} size={shareQrSize} />
              </View>

              <Image
                source={keeprEnabledMark}
                style={styles.shareCaptureKeeprMark}
                resizeMode="contain"
              />
            </View>

            <Text style={styles.sharePublicUrl} numberOfLines={2}>
              {publicStoryUrl}
            </Text>

            <View style={styles.shareCaptureHeroRow}>
              <View style={styles.shareHeroThumbWrap}>
                {!!heroUri ? (
                  <Image
                    source={{ uri: heroUri }}
                    style={styles.shareHeroThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.shareHeroPlaceholder}>
                    <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                  </View>
                )}
              </View>

              <View style={styles.shareHeroText}>
                <Text style={styles.shareAssetTitle} numberOfLines={2}>
                  {assetTitle}
                </Text>
                <Text style={styles.shareAssetSubtitle}>Keepr Enabled public story</Text>
                <Text style={styles.shareCaptureKac} numberOfLines={1}>
                  KAC: {asset?.kac_id || kac || "public"}
                </Text>
              </View>
            </View>

            <View style={styles.shareCaptureFooter}>
              <Text style={styles.shareCaptureFooterText}>
                Build a KeeprStory for the things you care about.
              </Text>
            </View>
          </View>

          <View style={styles.shareActionGrid}>
            <TouchableOpacity
              style={[styles.shareModalButton, styles.shareModalPrimaryButton]}
              onPress={handleShareStory}
              activeOpacity={0.88}
            >
              <Ionicons name="share-social-outline" size={18} color="white" />
              <Text style={styles.shareModalPrimaryText}>Share Story</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareModalButton}
              onPress={handleCopyPublicLink}
              activeOpacity={0.88}
            >
              <Ionicons
                name={linkCopied ? "checkmark-circle-outline" : "link-outline"}
                size={18}
                color={colors.textPrimary}
              />
              <Text style={styles.shareModalButtonText}>
                {linkCopied ? "Copied" : "Copy Link"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareModalButton}
              onPress={handleSaveQrImage}
              activeOpacity={0.88}
            >
              <Ionicons name="download-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.shareModalButtonText}>Save QR</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.shareModalFooter}>
            <Text style={styles.shareModalFooterText}>
              Build a KeeprStory for the things you care about.
            </Text>
            <TouchableOpacity
              style={styles.createYoursButton}
              onPress={() => openUrl(`${getPublicStoryBaseUrl()}/invite/keepr`)}
              activeOpacity={0.88}
            >
              <Text style={styles.createYoursButtonText}>Create yours</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
      </SafeAreaView>
    </View>
  </Modal>
  </>
);
}

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },

  internalStoryScrollContent: {
  paddingBottom: spacing.xl,
},

  notFoundTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  notFoundText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    textAlign: "center",
  },

  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },

  heroCardWide: {
  flexDirection: "row",
  minHeight: 430,
},

  heroImageWrap: {
    width: "100%",
    aspectRatio: HERO_ASPECT,
    backgroundColor: colors.surfaceSubtle,
  },

  heroImageWrapWide: {
    width: 0,
    flex: 1.35,
    minHeight: 280,
  },

  heroImage: {
    width: "100%",
    height: "100%",
  },

  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  originHubBack: {
  alignSelf: "flex-start",
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingHorizontal: 12,
  paddingVertical: 9,
  borderRadius: radius.pill,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  marginTop: spacing.md,
  marginBottom: -spacing.sm,
},

originHubBackText: {
  fontSize: 13,
  fontWeight: "900",
  color: colors.textPrimary,
},

internalStoryShell: {
  flex: 1,
  width: "100%",
  maxWidth: 1180,
  alignSelf: "center",
  paddingHorizontal: 14,
  paddingBottom: spacing.xl,
},
internalStorySafe: {
  flex: 1,
  backgroundColor: colors.background,
},

  heroMeta: {
    padding: spacing.lg,
  },

  heroMetaWide: {
    flex: 1,
  },

  ownerByline: {
  marginTop: 8,
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
},

ownerBylineText: {
  fontSize: 13,
  fontWeight: "800",
  color: colors.textSecondary,
},

narrativeBox: {
  marginTop: 14,
  paddingTop: 14,
  borderTopWidth: 1,
  borderTopColor: colors.borderSubtle,
},

narrativeText: {
  fontSize: 14,
  lineHeight: 20,
  color: colors.textSecondary,
  fontWeight: "600",
},

hashtagRow: {
  marginTop: 12,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

hashtagPill: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: "#EEF2FF",
  borderWidth: 1,
  borderColor: "#C7D2FE",
},

hashtagText: {
  fontSize: 12,
  fontWeight: "900",
  color: "#3730A3",
},

  heroZoomHint: {
  position: "absolute",
  right: 14,
  bottom: 14,
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: "rgba(0,0,0,0.45)",
  alignItems: "center",
  justifyContent: "center",
},

publicGalleryWrap: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 14,
},

publicGalleryTile: {
  width: IS_WEB ? 260 : "48%",
  height: IS_WEB ? 190 : 170,
  borderRadius: radius.lg,
  overflow: "hidden",
  backgroundColor: colors.surfaceSubtle,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  position: "relative",
  ...shadows.subtle,
},

publicGalleryFeature: {
  width: IS_WEB ? 540 : "100%",
  height: IS_WEB ? 360 : 260,
},

publicGalleryImage: {
  width: "100%",
  height: "100%",
},

createYoursButton: {
  marginTop: 12,
  alignSelf: "center",
  paddingHorizontal: 18,
  paddingVertical: 10,
  borderRadius: radius.pill,
  backgroundColor: colors.brandBlue,
},

createYoursButtonText: {
  color: "white",
  fontSize: 13,
  fontWeight: "900",
},

galleryScrim: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 70,
  backgroundColor: "rgba(15,23,42,0.22)",
},

shareModalScrim: {
  flex: 1,
  backgroundColor: "rgba(6,10,18,0.76)",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
},

shareModalBackdrop: {
  ...StyleSheet.absoluteFillObject,
},

shareModalSafeArea: {
  flex: 1,
  width: "100%",
  alignItems: "center",
  justifyContent: "center",
},

shareModalCard: {
  width: "100%",
  maxWidth: 430,
  borderRadius: 28,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.22)",
  overflow: "hidden",
  zIndex: 2,
  elevation: 12,
  ...shadows.subtle,
},

shareModalScroll: {
  padding: 20,
  alignItems: "center",
},

shareModalTopRow: {
  width: "100%",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 18,
},

shareModalBrand: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

shareModalLogo: {
  width: 28,
  height: 28,
  borderRadius: 8,
},

shareModalKicker: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textSecondary,
  textTransform: "uppercase",
},

shareModalClose: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.surfaceSubtle,
},

shareHeroRow: {
  width: "100%",
  flexDirection: "row",
  alignItems: "center",
  gap: 14,
  marginBottom: 20,
},

shareCaptureCard: {
  width: "100%",
  borderRadius: 24,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surface,
  padding: 16,
  alignItems: "center",
  marginBottom: 18,
},

shareCaptureHeroRow: {
  width: "100%",
  flexDirection: "row",
  alignItems: "center",
  gap: 14,
  marginBottom: 16,
},

shareHeroThumbWrap: {
  width: 86,
  height: 86,
  borderRadius: 20,
  overflow: "hidden",
  backgroundColor: colors.surfaceSubtle,
},

shareHeroThumb: {
  width: "100%",
  height: "100%",
},

shareHeroPlaceholder: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
},

shareHeroText: {
  flex: 1,
},

shareAssetTitle: {
  fontSize: 20,
  lineHeight: 24,
  fontWeight: "900",
  color: colors.textPrimary,
},

shareAssetSubtitle: {
  marginTop: 6,
  fontSize: 13,
  fontWeight: "800",
  color: colors.textSecondary,
},

shareCaptureKac: {
  marginTop: 6,
  fontSize: 11,
  fontWeight: "900",
  color: colors.textMuted,
  textTransform: "uppercase",
},

shareBrandedQrWrap: {
  alignItems: "center",
  justifyContent: "center",
},

shareQrPanel: {
  padding: 16,
  borderRadius: 24,
  backgroundColor: "white",
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 14,
},

shareCaptureKeeprMark: {
  width: 180,
  height: 44,
  marginBottom: 12,
},

shareQrFallback: {
  width: 230,
  minHeight: 230,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  borderRadius: 18,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surfaceSubtle,
},

shareQrFallbackTitle: {
  marginTop: 10,
  fontSize: 16,
  fontWeight: "900",
  color: colors.textPrimary,
},

shareQrFallbackText: {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
  textAlign: "center",
  color: colors.textSecondary,
},

sharePublicUrl: {
  width: "100%",
  textAlign: "center",
  fontSize: 12,
  lineHeight: 17,
  color: colors.textSecondary,
  fontWeight: "700",
  marginBottom: 18,
},

shareCaptureFooter: {
  width: "100%",
  paddingTop: 14,
  borderTopWidth: 1,
  borderTopColor: colors.borderSubtle,
},

shareCaptureFooterText: {
  textAlign: "center",
  fontSize: 13,
  lineHeight: 19,
  fontWeight: "800",
  color: colors.textSecondary,
},

shareActionGrid: {
  width: "100%",
  gap: 10,
},

shareModalButton: {
  minHeight: 48,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surfaceSubtle,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  paddingHorizontal: 14,
},

shareModalPrimaryButton: {
  backgroundColor: colors.brandBlue,
  borderColor: colors.brandBlue,
},

shareModalPrimaryText: {
  color: "white",
  fontSize: 14,
  fontWeight: "900",
},

shareModalButtonText: {
  color: colors.textPrimary,
  fontSize: 14,
  fontWeight: "900",
},

shareModalFooter: {
  width: "100%",
  marginTop: 18,
  paddingTop: 16,
  borderTopWidth: 1,
  borderTopColor: colors.borderSubtle,
},

shareModalFooterText: {
  textAlign: "center",
  fontSize: 13,
  lineHeight: 19,
  fontWeight: "800",
  color: colors.textSecondary,
},

lightbox: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.94)",
  alignItems: "center",
  justifyContent: "center",
},

lightboxTopBar: {
  position: "absolute",
  top: 48,
  left: 24,
  right: 24,
  zIndex: 5,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
},

lightboxCount: {
  color: "white",
  fontSize: 15,
  fontWeight: "800",
},

lightboxImage: {
  width: "92%",
  height: "82%",
},

lightboxArrow: {
  position: "absolute",
  top: "48%",
  padding: 12,
},

lightboxArrowLeft: {
  left: 18,
},

lightboxArrowRight: {
  right: 18,
},

  enabledBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    marginBottom: spacing.md,
  },

  enabledBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "lowercase",
  },

  galleryImageWrap: {
  position: "relative",
},

  heroTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  heroSubtitle: {
    marginTop: spacing.xs,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },

  metaGrid: {
    marginTop: spacing.lg,
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

  metaLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
  },

  metaValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "800",
    marginTop: 3,
  },

  tabsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: spacing.lg,
  },

  tabButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },

  tabButtonActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },

  tabLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  tabLabelActive: {
    color: "white",
  },

  sectionCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
    marginBottom: spacing.xl,
  },

  sectionHeader: {
    marginBottom: spacing.md,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  timelineRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },

  timelineIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },

  timelineTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },

  timelineTitle: {
    fontSize: 14,
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
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  timelineMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.sm,
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


shareStoryButton: {
  marginTop: spacing.lg,
  alignSelf: "flex-start",
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: radius.pill,
  backgroundColor: colors.brandBlue,
},

shareStoryButtonText: {
  color: "white",
  fontSize: 13,
  fontWeight: "900",
},

keeprEnabledMark: {
  width: 180,
  height: 44,
  
},


galleryWatermark: {
  position: "absolute",
  right: 10,
  bottom: 10,
  width: 120,
  height: 30,
  opacity: 0.82,
},

  systemsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  systemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },

  systemName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: spacing.xl,
  },

  galleryImage: {
    width: 240,
    height: 180,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
})
