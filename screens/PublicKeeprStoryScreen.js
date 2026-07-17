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

import { supabase } from "../lib/supabaseClient";
import { formatKeeprDate } from "../lib/dateFormat";
import {
  normalizeProjectionConfig,
  splitConfiguredHighlights,
} from "../lib/projectionRegistry";
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

const SUPPORTED_PUBLIC_ACTIONS = new Set([
  "request_info",
  "request_service",
  "submit_quote",
  "submit_proposal",
  "pay_rent",
]);

const PUBLIC_ACTION_ALIASES = {
  answer_question: "request_info",
  capture_event_inbox: "request_service",
};

function getActionsForMode(mode) {
  switch (String(mode || "").toLowerCase()) {
    case "for_sale":
      return ["request_info", "submit_quote"];
    case "for_rent":
      return ["request_info", "request_service", "pay_rent"];
    case "builder":
      return ["request_service", "submit_proposal"];
    case "system_story":
      return ["request_service", "submit_quote"];
    case "current_story":
      return ["request_info", "request_service", "submit_quote"];
    case "inquiry":
    default:
      return ["request_info", "request_service", "submit_quote"];
  }
}

function normalizePublicActionKey(action) {
  const key = String(action || "").trim();
  return PUBLIC_ACTION_ALIASES[key] || key;
}

function uniqueSupportedActions(actions) {
  const seen = new Set();
  const out = [];

  for (const action of Array.isArray(actions) ? actions : []) {
    const key = normalizePublicActionKey(action);
    if (!SUPPORTED_PUBLIC_ACTIONS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function getEffectivePublicActions({ actionConfig, allowedActions, mode }) {
  const configured = uniqueSupportedActions(actionConfig?.actionsEnabled);
  if (configured.length) return configured;

  const backend = uniqueSupportedActions(allowedActions);
  if (backend.length) return backend;

  return uniqueSupportedActions(getActionsForMode(mode));
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

function toPublicMediaUrl(publicMediaIdOrUrl) {
  const value = String(publicMediaIdOrUrl || "").trim();
  if (!value) return null;

  if (value.startsWith("/api/public-media/")) {
    return `${getPublicStoryBaseUrl()}${value}`;
  }

  if (/^https?:\/\//i.test(value)) {
    return value.includes("/api/public-media/") ? value : null;
  }

  return `${getPublicStoryBaseUrl()}/api/public-media/${encodeURIComponent(value)}`;
}

function normalizePublicStoryMediaRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const publicMediaId = row?.public_media_id || row?.placement_id || null;
      const imageUrl = toPublicMediaUrl(publicMediaId || row?.image_url);

      if (!publicMediaId || !imageUrl) return null;

      return {
        public_media_id: String(publicMediaId),
        role: row?.role || null,
        is_showcase: Boolean(row?.is_showcase),
        sort_order: row?.sort_order ?? null,
        image_url: imageUrl,
      };
    })
    .filter(Boolean);
}

function normalizePublicStoryFileRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const publicMediaId = row?.public_media_id || row?.id || null;
      const url = toPublicMediaUrl(publicMediaId || row?.url);

      if (!publicMediaId || !url) return null;

      const safeName =
        row?.name ||
        row?.file_name ||
        row?.title ||
        "Showcase document";

      return {
        id: String(publicMediaId),
        public_media_id: String(publicMediaId),
        name: safeName,
        file_name: safeName,
        title: row?.title || safeName,
        mime_type: row?.mime_type || row?.content_type || null,
        role: row?.role || null,
        notes: row?.notes || null,
        url,
      };
    })
    .filter(Boolean);
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

function getAssetKindLabel(type) {
  switch (String(type || "").toLowerCase()) {
    case "vehicle":
      return "vehicle";
    case "boat":
      return "boat";
    case "home":
      return "home";
    default:
      return "asset";
  }
}

function getAssetIdentityLine(asset) {
  return [asset?.year, asset?.make, asset?.model]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function hasEventProjectionValue(value) {
  return String(value || "").trim().length > 0;
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

  return {
  media: normalizePublicStoryMediaRows(json?.media),
  showcaseFiles: normalizePublicStoryFileRows(json?.showcaseFiles),
  showcaseLinks: Array.isArray(json?.showcaseLinks) ? json.showcaseLinks : [],
};
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
  const [secondaryLoading, setSecondaryLoading] = useState(false);

  const publicConfig =
  asset?.public_config ||
  asset?.extra_metadata?.publicConfig ||
  {};

  const storyConfig = publicConfig.story || {};
  const projectionConfig = useMemo(
    () => normalizeProjectionConfig(publicConfig),
    [publicConfig]
  );
  const isEventProjection = projectionConfig.purpose === "event";
  const eventProjection = projectionConfig.event || {};
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
  const actionMode = actionConfig.mode || publicConfig.mode || "inquiry";
  const effectivePublicActions = useMemo(
    () =>
      getEffectivePublicActions({
        actionConfig,
        allowedActions: asset?.allowed_actions,
        mode: actionMode,
      }),
    [actionConfig, asset?.allowed_actions, actionMode]
  );
  const showActionsTab =
    actionConfig.enabled !== false && effectivePublicActions.length > 0;

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
  const showEventOwnerName = eventProjection.showOwnerName === true;

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
  const assetKindLabel = getAssetKindLabel(asset?.type);
  const assetIdentityLine = getAssetIdentityLine(asset) || assetTitle;
  const eventStoryHighlights = splitConfiguredHighlights(eventProjection.selectedStoryHighlights);
  const eventVehicleHighlights = splitConfiguredHighlights(eventProjection.selectedVehicleHighlights);
  const eventSystemHighlights = splitConfiguredHighlights(eventProjection.selectedSystemHighlights);
  const eventProofHighlights = splitConfiguredHighlights(eventProjection.selectedProofOfCare);
  const eventFeaturedUri = toPublicMediaUrl(eventProjection.featuredImage);
  const eventHubName = eventProjection.hubName || originHubName || null;
  const eventHubId = eventProjection.hubId || originHubId || null;
  const eventAskOwnerTitle = showEventOwnerName && ownerDisplayName
    ? `Ask ${ownerDisplayName} about this ${assetKindLabel}`
    : `Ask the owner about this ${assetKindLabel}`;
  const eventActionRouteParams = {
    kac: asset?.kac_id || kac,
    assetId: asset?.asset_id || asset?.id,
    projectionType: "event",
    hubId: eventHubId,
    hubName: eventHubName,
    eventName: eventProjection.eventName || null,
    eventDate: eventProjection.eventDate || null,
  };

  const openEventMessageOwner = useCallback(() => {
    if (isInternalMode) {
      navigation.navigate("KeeprAction", {
        ...eventActionRouteParams,
        assetName: asset?.name,
        assetOwnerId: asset?.owner_id || asset?.ownerId || null,
        mode: "internal",
      });
      return;
    }

    navigation.navigate("PublicAction", eventActionRouteParams);
  }, [
    navigation,
    isInternalMode,
    eventActionRouteParams.kac,
    eventActionRouteParams.assetId,
    eventActionRouteParams.hubId,
    eventActionRouteParams.hubName,
    eventActionRouteParams.eventName,
    eventActionRouteParams.eventDate,
    asset?.name,
    asset?.owner_id,
    asset?.ownerId,
  ]);

  const eventCardOrder = Array.isArray(projectionConfig.cardOrder)
    ? projectionConfig.cardOrder
    : [];
  const eventCardsToRender = isEventProjection
    ? eventCardOrder.filter((card) =>
        ["event_showcase", "vehicle_highlights", "message_owner"].includes(card)
      )
    : [];

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

  const loadPublicStory = useCallback(async () => {
  if (!kac && !assetId) return;

  setLoading(true);
  setSecondaryLoading(false);
  setHeroUri(null);

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

assetRow.extra_metadata = summaryRow.extra_metadata || {};
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
    if (assetRow.hero_placement_id) {
      setHeroUri(toPublicMediaUrl(assetRow.hero_placement_id));
    }
    setLoading(false);
    setSecondaryLoading(true);

const publicAssetId = assetRow.asset_id || assetRow.id;

    const publicKac = assetRow.kac_id || kac;

      logPublicStoryLoad("PUBLIC STORY ASSET ROW:", assetRow);
      logPublicStoryLoad("PUBLIC STORY HERO IMAGE URL:", assetRow?.hero_image_url);
      logPublicStoryLoad("PUBLIC STORY HERO PLACEMENT ID:", assetRow?.hero_placement_id);
      logPublicStoryLoad("PUBLIC STORY PUBLIC ASSET ID:", publicAssetId);

  
      /* ----------------------- TIMELINE / SYSTEMS / MEDIA -------------------- */

      const timelinePromise = supabase
        .from("public_asset_story_timeline")
        .select("*")
        .eq("kac_id", publicKac)
        .order("performed_at", { ascending: false });

      const systemsPromise =
        assetId && !kac
          ? supabase
              .from("systems")
              .select("id, name")
              .eq("asset_id", publicAssetId)
              .order("name", { ascending: true })
          : Promise.resolve({ data: [], error: null });

      const [timelineResult, systemsResult, mediaResult] =
        await Promise.allSettled([
          timelinePromise,
          systemsPromise,
          fetchPublicStoryMedia(publicKac),
        ]);

      const { data: serviceRows, error: timelineError } =
        timelineResult.status === "fulfilled"
          ? timelineResult.value || {}
          : { data: [], error: timelineResult.reason };

      const { data: systemRows } =
        systemsResult.status === "fulfilled"
          ? systemsResult.value || {}
          : { data: [] };

      const storyMedia =
        mediaResult.status === "fulfilled"
          ? mediaResult.value || {}
          : { media: [], showcaseFiles: [], showcaseLinks: [] };
      
      logPublicStoryLoad("PUBLIC TIMELINE:", serviceRows);
      logPublicStoryLoad("PUBLIC TIMELINE ERROR:", timelineError);

      const mediaRows = storyMedia.media || [];

      setShowcaseFiles(storyMedia.showcaseFiles || []);
      setShowcaseLinks(storyMedia.showcaseLinks || []);

      logPublicStoryLoad("PUBLIC STORY MEDIA:", storyMedia);

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
          (x) => String(x.public_media_id) === String(assetRow.hero_placement_id)
        ) ||
        mediaRows.find((x) => x.role === "hero") ||
        mediaRows.find((x) => !!x.image_url) ||
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
            return (
              !!url &&
              url !== "null" &&
              url !== "undefined" &&
              url.includes("/api/public-media/") &&
              !url.includes("placeholder") &&
              !url.includes("image-outline")
            );
          })
            .map((row) => [row.image_url, row])
        ).values()
      );

      setGallery(
        dedupedGalleryRows.map((row, index) => ({
          id: row.public_media_id || `${row.image_url}-${index}`,
          uri: row.image_url,
          role: row.role,
        }))
      );

    } catch (e) {
      logPublicStoryLoad("Public story load error", e);
    } finally {
      setLoading(false);
      setSecondaryLoading(false);
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

  const renderEventShowcaseCard = () => {
    if (!isEventProjection || eventProjection.includeEventShowcase === false) return null;

    const hasContent =
      hasEventProjectionValue(eventProjection.eventName) ||
      hasEventProjectionValue(eventProjection.displayHeadline) ||
      hasEventProjectionValue(eventProjection.description) ||
      hasEventProjectionValue(eventProjection.eventDate) ||
      hasEventProjectionValue(eventProjection.eventLocation) ||
      hasEventProjectionValue(eventHubName) ||
      hasEventProjectionValue(eventProjection.classOrCategory) ||
      !!eventFeaturedUri;

    if (!hasContent) return null;

    return (
      <View key="event_showcase" style={styles.projectionCard}>
        <View style={styles.projectionCardHeader}>
          <Text style={styles.projectionKicker}>Event Projection</Text>
          {!!eventProjection.classOrCategory && (
            <View style={styles.projectionPill}>
              <Text style={styles.projectionPillText}>{eventProjection.classOrCategory}</Text>
            </View>
          )}
        </View>

        {!!eventFeaturedUri && (
          <Image
            source={{ uri: eventFeaturedUri }}
            style={styles.projectionImage}
            resizeMode="cover"
          />
        )}

        <Text style={styles.projectionCardTitle}>
          {eventProjection.displayHeadline ||
            eventProjection.eventName ||
            `${assetTitle} at the event`}
        </Text>

        {!!eventProjection.description && (
          <Text style={styles.projectionBodyText}>{eventProjection.description}</Text>
        )}

        <View style={styles.projectionMetaWrap}>
          {!!eventProjection.eventName && (
            <View style={styles.projectionMetaItem}>
              <Ionicons name="flag-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.projectionMetaText}>{eventProjection.eventName}</Text>
            </View>
          )}
          {!!eventHubName && (
            <View style={styles.projectionMetaItem}>
              <Ionicons name="people-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.projectionMetaText}>{eventHubName}</Text>
            </View>
          )}
          {!!eventProjection.eventDate && (
            <View style={styles.projectionMetaItem}>
              <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.projectionMetaText}>{eventProjection.eventDate}</Text>
            </View>
          )}
          {!!eventProjection.eventLocation && (
            <View style={styles.projectionMetaItem}>
              <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.projectionMetaText}>{eventProjection.eventLocation}</Text>
            </View>
          )}
        </View>

        {eventProjection.allowAskOwner !== false && showActionsTab ? (
          <TouchableOpacity
            style={styles.projectionPrimaryCta}
            activeOpacity={0.88}
            onPress={openEventMessageOwner}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={17} color="white" />
            <Text style={styles.projectionPrimaryCtaText}>{eventAskOwnerTitle}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const renderVehicleHighlightsCard = () => {
    if (!isEventProjection || eventProjection.includeVehicleHighlights === false) return null;

    const highlights = [
      ...(eventVehicleHighlights || []),
      ...(eventSystemHighlights || []),
      ...(eventProjection.includeStoryHighlights === false ? [] : eventStoryHighlights),
      ...(eventProjection.includeProofOfCare === false ? [] : eventProofHighlights),
    ];

    const hasIdentity = hasEventProjectionValue(assetIdentityLine);
    if (!hasIdentity && !highlights.length) return null;

    return (
      <View key="vehicle_highlights" style={styles.projectionCard}>
        <Text style={styles.projectionKicker}>Vehicle Highlights</Text>
        <Text style={styles.projectionCardTitle}>{assetIdentityLine || assetTitle}</Text>

        <View style={styles.projectionIdentityGrid}>
          {!!asset?.year && (
            <View style={styles.projectionIdentityTile}>
              <Text style={styles.projectionIdentityLabel}>Year</Text>
              <Text style={styles.projectionIdentityValue}>{asset.year}</Text>
            </View>
          )}
          {!!asset?.make && (
            <View style={styles.projectionIdentityTile}>
              <Text style={styles.projectionIdentityLabel}>
                {asset?.type === "boat" ? "Builder" : "Make"}
              </Text>
              <Text style={styles.projectionIdentityValue}>{asset.make}</Text>
            </View>
          )}
          {!!asset?.model && (
            <View style={styles.projectionIdentityTile}>
              <Text style={styles.projectionIdentityLabel}>Model</Text>
              <Text style={styles.projectionIdentityValue}>{asset.model}</Text>
            </View>
          )}
        </View>

        {!!highlights.length && (
          <View style={styles.projectionBulletList}>
            {highlights.slice(0, 8).map((highlight) => (
              <View key={highlight} style={styles.projectionBulletRow}>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.brandBlue} />
                <Text style={styles.projectionBulletText}>{highlight}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderMessageOwnerCard = () => {
    if (!isEventProjection || eventProjection.allowAskOwner === false || !showActionsTab) return null;

    return (
      <View key="message_owner" style={styles.projectionCard}>
        <Text style={styles.projectionKicker}>Message Owner</Text>
        <Text style={styles.projectionCardTitle}>{eventAskOwnerTitle}</Text>
        <Text style={styles.projectionBodyText}>
          Start a secure conversation about this {assetKindLabel}. The message stays connected to this public story and event context.
        </Text>
        <TouchableOpacity
          style={styles.projectionSecondaryCta}
          activeOpacity={0.88}
          onPress={openEventMessageOwner}
        >
          <Ionicons name="chatbubble-outline" size={17} color={colors.textPrimary} />
          <Text style={styles.projectionSecondaryCtaText}>Ask Owner</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderEventProjectionCard = (card) => {
    switch (card) {
      case "event_showcase":
        return renderEventShowcaseCard();
      case "vehicle_highlights":
        return renderVehicleHighlightsCard();
      case "message_owner":
        return renderMessageOwnerCard();
      default:
        return null;
    }
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

        {isEventProjection && eventCardsToRender.length > 0 ? (
          <View style={styles.projectionCardArea}>
            {eventCardsToRender.map((card) => renderEventProjectionCard(card)).filter(Boolean)}
          </View>
        ) : null}
        
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

          {showActionsTab && (
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
                projectionType: isEventProjection ? "event" : projectionConfig.purpose,
                eventName: isEventProjection ? eventProjection.eventName || null : null,
                eventDate: isEventProjection ? eventProjection.eventDate || null : null,
                mode: "internal",
              });
                return;
              }

              navigation.navigate("PublicAction", {
                kac,
                assetId: asset?.asset_id || asset?.id,
                projectionType: isEventProjection ? "event" : projectionConfig.purpose,
                hubId: eventHubId,
                hubName: eventHubName,
                eventName: isEventProjection ? eventProjection.eventName || null : null,
                eventDate: isEventProjection ? eventProjection.eventDate || null : null,
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

              {secondaryLoading && !timeline.length ? (
                <Text style={styles.cardHint}>Loading timeline...</Text>
              ) : null}

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
  {secondaryLoading && !gallery.length && !showcaseFiles.length && !showcaseLinks.length ? (
    <Text style={styles.cardHint}>Loading Showcase...</Text>
  ) : null}

  <ShowcaseAttachmentsSection
    variant="public"
    files={showcaseFiles}
    links={showcaseLinks}
    getFileUrl={async (file) => {
      if (file.url) return file.url;
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

  projectionCardArea: {
    gap: 14,
    marginBottom: spacing.lg,
  },

  projectionCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...shadows.subtle,
  },

  projectionCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  projectionKicker: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0,
  },

  projectionPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },

  projectionPillText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
  },

  projectionImage: {
    width: "100%",
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    marginTop: 14,
    marginBottom: 14,
  },

  projectionCardTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    color: colors.textPrimary,
    marginTop: 8,
  },

  projectionBodyText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    color: colors.textSecondary,
    marginTop: 10,
  },

  projectionMetaWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },

  projectionMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },

  projectionMetaText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textSecondary,
  },

  projectionPrimaryCta: {
    marginTop: 18,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
  },

  projectionPrimaryCtaText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },

  projectionSecondaryCta: {
    marginTop: 16,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },

  projectionSecondaryCtaText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },

  projectionIdentityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },

  projectionIdentityTile: {
    minWidth: 110,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },

  projectionIdentityLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
  },

  projectionIdentityValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  projectionBulletList: {
    gap: 9,
    marginTop: 14,
  },

  projectionBulletRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },

  projectionBulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: colors.textSecondary,
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
