// screens/KeeprHubScreen.js
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  Linking,
  Modal,
  Share,
  Pressable,
  ScrollView,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRoute } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, shadows } from "../styles/theme";

import { pickAssetHeroUri } from "../lib/assetImageResolver";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabaseClient";

import {
  fetchPublicHubBySlug,
  fetchHubStoryLinks,
  fetchHub,
  acceptHubInviteByToken,
} from "../lib/hubsApi";
import PublicShell from "../components/public/PublicShell";
import PublicHubShell from "../components/hubs/PublicHubShell";
import InternalHubShell from "../components/hubs/InternalHubShell";
import { getHubUserCapabilities } from "../lib/hubCapabilities";
import { buildHubShareUrl } from "../lib/inviteLinks";
import { getKaiTriggerContext } from "../lib/kaiEngine";
import HubAuthModal from "../components/hubs/HubAuthModal";
import {
  buildHubQuickAddIntent,
  storeAuthActivationIntent,
} from "../lib/authActivationIntent";

import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

function getPublicMediaBaseUrl() {
  const configuredBase = (
    process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
    process.env.PUBLIC_KEEPR_BASE_URL ||
    ""
  ).replace(/\/+$/, "");

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const origin = window.location.origin;
    const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);
    return isLocalOrigin && configuredBase ? configuredBase : origin;
  }

  return configuredBase || "https://app.keeprhome.com";
}

function toPublicMediaUrl(publicMediaIdOrUrl) {
  const value = String(publicMediaIdOrUrl || "").trim();
  if (!value) return null;

  if (value.startsWith("/api/public-media/")) {
    return `${getPublicMediaBaseUrl()}${value}`;
  }

  if (/^https?:\/\//i.test(value)) {
    return value.includes("/api/public-media/") ? value : null;
  }

  return `${getPublicMediaBaseUrl()}/api/public-media/${encodeURIComponent(value)}`;
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

const SORT_OPTIONS = [
  { key: "created_desc", label: "Newest" },
  { key: "name_asc", label: "Name" },
];

const HUB_REQUEST_TIMEOUT_MS = 10000;
const HUB_STORIES_TIMEOUT_MS = 12000;

function withTimeout(promise, label, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]);
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
  const narrative =
    md.publicStoryNarrative ||
    asset?.public_story_narrative ||
    "";

  return [
    ...(Array.isArray(md.publicStoryTags) ? md.publicStoryTags : []),
    ...extractHashtags(narrative),
  ].filter(Boolean);
}

function getMd(asset) {
  return asset?.extra_metadata && typeof asset.extra_metadata === "object"
    ? asset.extra_metadata
    : {};
}

function daysSince(dateStrOrIso) {
  if (!dateStrOrIso) return null;
  const d = new Date(dateStrOrIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function safeTitle(asset) {
  return asset?.name || "Untitled Story";
}

function safeSubtitle(asset) {
  const md = getMd(asset);

  const year = md.year || md.model_year || asset?.year;
  const make = md.make || asset?.make;
  const model = md.model || asset?.model;
  const generation = md.generation || md.trim || md.series;


  const vehicleLine = [year, make, model, generation].filter(Boolean).join(" ");
  if (vehicleLine) return vehicleLine;

  const line1 = md.address_line1 || md.address || md.street || "";
  const city = md.city || "";
  const state = md.state || "";
  const zip = md.zip || "";
  const addressLine = [line1, [city, state, zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" • ");

  return addressLine || asset?.location || asset?.type || "";
}

function storyModeLabel(asset) {
  const md = getMd(asset);

  const raw =
    asset?.story_mode ||
    asset?.public_mode ||
    asset?.mode ||
    asset?.lifecycle_state ||
    asset?.public_story_mode ||
    asset?.public_config?.mode ||
    asset?.public_config?.story_mode ||
    asset?.public_config?.public_mode ||
    md.story_mode ||
    md.public_mode ||
    md.mode ||
    md.lifecycle_state ||
    md.public_story_mode ||
    "current_story";

  const normalized = String(raw)
    .toLowerCase()
    .trim()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");

  const labels = {
    for_sale: "For Sale",
    sale: "For Sale",
    for_rent: "For Rent",
    rent: "For Rent",
    current_story: "Current Story",
    current: "Current Story",
    system_story: "System Story",
    system: "System Story",
    informational_inquiry: "Informational Inquiry",
    inquiry: "Informational Inquiry",
  };

  return labels[normalized] || raw;
}

function normalizeLinks(rows) {
  return (rows || [])
    .map((row) => {
      const asset = row.asset || row.assets || row;
      if (!asset?.id) return null;

      const ownerProfile = row.ownerProfile || row.owner_profile || null;
      const ownerName =
        ownerProfile?.display_name ||
        ownerProfile?.full_name ||
        ownerProfile?.inbox_name ||
        ownerProfile?.username ||
        ownerProfile?.email ||
        null;

      return {
        ...asset,
        hero_image_url: asset.hero_image_url || row.hero_image_url || null,
        hero_thumb_url: asset.hero_thumb_url || row.hero_thumb_url || null,
        public_hero_url: asset.public_hero_url || row.public_hero_url || null,
        primary_attachment_url:
          asset.primary_attachment_url || row.primary_attachment_url || null,
        ownerProfile,
        owner_name: ownerName,
        _hubLinkId: row.id,
        _featured: Boolean(row.featured),
        _linkedAt: row.created_at || asset.created_at,
      };
    })
    .filter(Boolean);
}

function safeOwner(asset) {
  const md = getMd(asset);
  const p = asset?.ownerProfile || asset?.owner_profile;

  return (
    asset?.owner_name ||
    md.owner_name ||
    md.owner ||
    p?.display_name ||
    p?.full_name ||
    p?.inbox_name ||
    p?.username ||
    p?.email ||
    asset?.owner ||
    null
  );
}
async function fetchPublicStoryMedia(kac) {
  if (!kac) return [];

  const { data, error } = await supabase.functions.invoke("public-story-media", {
    body: { kac },
  });

  if (error) {
    console.log("HUB PUBLIC STORY MEDIA ERROR:", kac, error?.message || error);
    return [];
  }

  return normalizePublicStoryMediaRows(data?.media);
}

export default function KeeprHubScreen({ navigation }) {
  const route = useRoute();
  const { width: windowWidth } = useWindowDimensions();

const webSearchParams =
  Platform.OS === "web" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;

const hubId =
  route?.params?.hubId ||
  route?.params?.hub?.id ||
  webSearchParams?.get("hubId") ||
  null;

const [galleryVisible, setGalleryVisible] = useState(false);
const [galleryIndex, setGalleryIndex] = useState(0);
const [hubAuthModalVisible, setHubAuthModalVisible] = useState(false);

const webHubSlug =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.pathname.split("/").filter(Boolean)[0] === "h"
      ? window.location.pathname.split("/").filter(Boolean)[1] || null
      : null
    : null;

const hubSlug =
  route?.params?.slug ||
  route?.params?.hubSlug ||
  route?.params?.hub?.slug ||
  webHubSlug ||
  null;


const webPath =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.pathname || ""
    : "";

const isInternal =
  route?.name === "KeeprHubInternal" ||
  route?.params?.mode === "internal" ||
  webSearchParams?.get("mode") === "internal" ||
  webPath.startsWith("/KeeprHubInternal");

  const inviteToken =
  route?.params?.invite ||
  route?.params?.inviteToken ||
  webSearchParams?.get("invite");

  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState([]);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("created_desc");
  const [containerWidth, setContainerWidth] = useState(null);
  const [activeChip, setActiveChip] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [gallerySwipeStartX, setGallerySwipeStartX] = useState(null);
  const [shareHubVisible, setShareHubVisible] = useState(false);
  const [hubLinkCopied, setHubLinkCopied] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [hubLoadError, setHubLoadError] = useState(null);
  const [storyLoadError, setStoryLoadError] = useState(null);
  
  const [inviteRecord, setInviteRecord] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const loadRunRef = useRef(0);

  const effectiveWidth = containerWidth || windowWidth;
  const isCompactHub = windowWidth < 640;
  const cardGap = 14;
  const listSidePadding = 24;

  const numColumns = useMemo(() => {
    if (effectiveWidth >= 1024) return 3;
    if (effectiveWidth >= 720) return 2;
    return 1;
  }, [effectiveWidth]);

  const cardWidth = useMemo(() => {
    const inner = Math.max(0, Math.floor(effectiveWidth - listSidePadding * 2));
    const totalGaps = cardGap * (numColumns - 1);
    const w = Math.floor((inner - totalGaps) / numColumns);
    return Math.max(260, w);
  }, [effectiveWidth, numColumns]);

  const heroHeight = useMemo(
    () => Math.round((cardWidth * 9) / 16),
    [cardWidth]
  );

const enrichHeroImages = useCallback(async (assetList) => {
  const heroByAssetId = {};
  const modeByAssetId = {};
  const metadataByAssetId = {};

  for (const asset of assetList || []) {
    try {
      const kac = asset?.kac_id;
      if (!kac) continue;

      const mediaRows = await fetchPublicStoryMedia(kac);

      const { data: assetRow } = await supabase
        .from("assets")
        .select("extra_metadata")
        .eq("id", asset.id)
        .maybeSingle();

      const mode =
        assetRow?.extra_metadata?.publicConfig?.actions?.mode;
        metadataByAssetId[asset.id] = assetRow?.extra_metadata || {};

      if (mode) {
        modeByAssetId[asset.id] = mode;
      }

      const heroPlacement =
        mediaRows.find(
          (x) => String(x.public_media_id) === String(asset.hero_placement_id)
        ) ||
        mediaRows.find((x) => x.role === "hero") ||
        mediaRows.find((x) => !!x.image_url) ||
        null;

      const heroUrl = heroPlacement?.image_url || null;

      if (heroUrl) {
        heroByAssetId[asset.id] = heroUrl;
      }
    } catch (e) {
      console.log("Hub public media hero failed:", asset?.name, e?.message || e);
    }
  }

setStories((prev) =>
  prev.map((p) => ({
    ...p,
    ...(heroByAssetId[p.id]
      ? {
          public_hero_url: heroByAssetId[p.id],
          primary_attachment_url: heroByAssetId[p.id],
        }
      : {}),
    ...(modeByAssetId[p.id]
      ? {
          public_story_mode: modeByAssetId[p.id],
        }
      : {}),
      ...(metadataByAssetId[p.id]
  ? {
      extra_metadata: {
        ...(p.extra_metadata || {}),
        ...metadataByAssetId[p.id],
      },
    }
  : {}),
  }))
);
}, 
[]);

  function metadataValue(asset, key) {
  const md = getMd(asset);

  if (key === "year") return md.year || md.model_year || asset?.year;
  if (key === "make") return md.make || asset?.make;
  if (key === "model") return md.model || asset?.model;
  if (key === "owner") return safeOwner(asset);

  return null;
}

const loadHub = useCallback(async () => {
  const runId = loadRunRef.current + 1;
  loadRunRef.current = runId;
  const isActiveRun = () => loadRunRef.current === runId;

  setLoading(true);
  setHubLoadError(null);
  setStoryLoadError(null);

  let userId = null;
  try {
    const { data: authData } = await withTimeout(
      supabase.auth.getUser(),
      "Hub auth",
      HUB_REQUEST_TIMEOUT_MS
    );
    userId = authData?.user?.id || null;
  } catch (e) {
    console.log("Hub auth hydration failed:", e?.message || e);
  }

  if (!isActiveRun()) return;
  setCurrentUserId(userId);

  let hubRecord = null;
  try {
    hubRecord = await withTimeout(
      hubId
        ? fetchHub(hubId)
        : fetchPublicHubBySlug(hubSlug || "rally-sport-region"),
      "Hub lookup",
      HUB_REQUEST_TIMEOUT_MS
    );
  } catch (e) {
    console.error(e);
    if (!isActiveRun()) return;
    setHub(null);
    setHubLoadError(e?.message || "Failed to load hub.");
    setStories([]);
    setLoading(false);
    return;
  }

  if (!isActiveRun()) return;
  setHub({
    ...hubRecord,
    currentMember: null,
  });

  const [memberResult, storyResult] = await Promise.allSettled([
    userId
      ? withTimeout(
          supabase
            .from("hub_members")
            .select("id, role, user_id")
            .eq("hub_id", hubRecord.id)
            .eq("user_id", userId)
            .maybeSingle(),
          "Hub membership",
          HUB_REQUEST_TIMEOUT_MS
        )
      : Promise.resolve({ data: null, error: null }),
    withTimeout(fetchHubStoryLinks(hubRecord.id), "Hub stories", HUB_STORIES_TIMEOUT_MS),
  ]);

  if (!isActiveRun()) return;

  let memberRow = null;
  if (memberResult.status === "fulfilled") {
    if (memberResult.value?.error) {
      console.log("Hub member lookup failed:", memberResult.value.error);
    } else {
      memberRow = memberResult.value?.data || null;
    }
  } else {
    console.log("Hub member lookup failed:", memberResult.reason?.message || memberResult.reason);
  }

  setHub({
    ...hubRecord,
    currentMember: memberRow,
  });

  if (storyResult.status === "fulfilled") {
    const assetStories = normalizeLinks(storyResult.value || []);

    setStories(assetStories);
    setStoryLoadError(null);
    enrichHeroImages(assetStories).catch((e) => {
      console.log("Hub hero enrichment failed:", e?.message || e);
    });
  } else {
    console.log("Hub stories load failed:", storyResult.reason?.message || storyResult.reason);
    setStories([]);
    setStoryLoadError(storyResult.reason?.message || "Stories could not be loaded.");
  }

  setLoading(false);
}, [hubId, hubSlug, enrichHeroImages]);

  useFocusEffect(
    useCallback(() => {
      loadHub();
    }, [loadHub])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = (stories || []).filter((asset) => {
      if (!q) return true;

      const title = safeTitle(asset).toLowerCase();
      const subtitle = safeSubtitle(asset).toLowerCase();
      const owner = String(safeOwner(asset) || "").toLowerCase();

      const mode = storyModeLabel(asset).toLowerCase();
      const md = JSON.stringify(getMd(asset)).toLowerCase();
      const tags = getStoryTags(asset).join(" ").toLowerCase();

      return (
        title.includes(q) ||
        subtitle.includes(q) ||
        owner.includes(q) ||
        mode.includes(q) ||
        tags.includes(q) ||
        md.includes(q)
      );
    });

    switch (sortKey) {
      case "name_asc":
        list.sort((a, b) => safeTitle(a).localeCompare(safeTitle(b)));
        break;
      case "created_desc":
      default:
        list.sort(
          (a, b) =>
            new Date(b._linkedAt || b.created_at || 0) -
            new Date(a._linkedAt || a.created_at || 0)
        );
        break;
    }

    return list;
  }, [stories, query, sortKey]);

    const galleryItems = useMemo(
  () =>
    filtered
      .filter((s) => s.public_hero_url || s.primary_attachment_url)
      .map((s) => ({
        id: s.id,
        title: safeTitle(s),
        owner: safeOwner(s),
        image:
          s.public_hero_url ||
          s.primary_attachment_url,
        kac: s.kac_id,
      })),
  [filtered]
);

const activeGalleryItem = galleryItems[galleryIndex] || null;

    const assetChips = useMemo(() => {
    const values = [];

    (stories || []).forEach((asset) => {
      ["make", "model", "year"].forEach((key) => {
        const value = metadataValue(asset, key);
        if (value) values.push(String(value));
      });
    });

    return Array.from(new Set(values)).slice(0, 14);
  }, [stories]);

  const hashtagChips = useMemo(() => {
  const tags = [];

  (stories || []).forEach((asset) => {
    tags.push(...getStoryTags(asset));
  });

  return Array.from(new Set(tags))
    .sort()
    .slice(0, 25);
}, [stories]);

  const metadataChips = useMemo(() => {
  const values = [];

  (stories || []).forEach((asset) => {
    ["make", "model", "year", "owner"].forEach((key) => {
      const value = metadataValue(asset, key);
      if (value) values.push(String(value));
    });
  });

  return Array.from(new Set(values)).slice(0, 14);
}, [stories]);

  const base =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.origin
      : process.env.EXPO_PUBLIC_KEEPR_BASE_URL || "https://app.keeprhome.com";


const hubShareUrl = useMemo(() => {
  const slug = hub?.slug || hubSlug;
  if (!slug) return "";

  return buildHubShareUrl({ hubSlug: slug });
}, [hub?.slug, hubSlug]);

useEffect(() => {
  if (!isInternal && inviteToken && !loading) {
    setInviteModalVisible(true);
  }
}, [inviteToken, isInternal, loading, currentUserId]);

useEffect(() => {
  async function loadInvite() {
    if (!inviteToken) return;

    try {
      setInviteLoading(true);

      const { data, error } = await supabase
        .from("hub_members")
        .select("*")
        .eq("invite_token", inviteToken)
        .maybeSingle();

      if (error) throw error;

      setInviteRecord(data || null);
    } catch (e) {
      console.log("Invite lookup failed:", e);
    } finally {
      setInviteLoading(false);
    }
  }

  loadInvite();
}, [inviteToken]);

useEffect(() => {
  if (!galleryVisible || Platform.OS !== "web") return;

  const onKeyDown = (e) => {
    if (e.key === "Escape") setGalleryVisible(false);

    if (e.key === "ArrowLeft") {
      setGalleryIndex((i) => Math.max(0, i - 1));
    }

    if (e.key === "ArrowRight") {
      setGalleryIndex((i) => Math.min(galleryItems.length - 1, i + 1));
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [galleryVisible, galleryItems.length]);

  const ownerChips = useMemo(() => {
    const values = [];

    (stories || []).forEach((asset) => {
      const owner = safeOwner(asset);
      if (owner) values.push(String(owner));
    });

    return Array.from(new Set(values)).slice(0, 10);
  }, [stories]);

  const makeCount = useMemo(() => {
  return new Set(
    (stories || [])
      .map((s) => metadataValue(s, "make"))
      .filter(Boolean)
  ).size;
}, [stories]);

  const openPublicStory = useCallback(
    (asset) => {
      const kac = asset?.kac_id;
      if (!kac) {
        Alert.alert("Story unavailable", "This asset does not have a public Keepr Story URL yet.");
        return;
      }

      if (Platform.OS === "web" && typeof window !== "undefined") {
        const originQuery = hub?.slug
        ? `?hub=${encodeURIComponent(hub.slug)}&hubName=${encodeURIComponent(hub.name || "Hub")}`
        : "";

      window.location.href = `/k/${kac}${originQuery}`;
        return;
      }

      // Native fallback. If your navigator uses a different public-story route,
      // update this route name in one place.
      try {
      navigation.navigate("KeeprStoryInternal", {
        assetId: asset.id,
        kac: asset.kac_id,
        assetName: asset.name,
        assetOwnerId: asset.owner_id || asset.user_id || null,
        hubId: hub?.id,
        hubSlug: hub?.slug,
        hubName: hub?.name,
        mode: "internal",
      });
      } catch (e) {
        Linking.openURL(`https://app.keeprhome.com/k/${kac}`);
      }
      },
      [navigation, hub]
      );

  const renderCard = ({ item }) => {

    const heroUri =
      item.public_hero_url ||
      item.primary_attachment_url ||
      item.hero_thumb_url ||
      item.hero_image_url ||
      pickAssetHeroUri(item);

    const mode = storyModeLabel(item);
    const owner = safeOwner(item);
    const storyTags = getStoryTags(item);
    const isOwnedByCurrentUser =
  String(item.owner_id || item.user_id || "") === String(currentUserId || "");

  console.log("HUB KAI INVITE", {
  inviteToken,
  currentUserId,
  gate: kaiInvite?.gate,
  mode: kaiInvite?.mode,
});

    return (
      <TouchableOpacity
        onPress={() => {
          if (isInternal) {
          navigation.navigate("KeeprStoryInternal", {
            assetId: item.id,
            kac: item.kac_id,
            hubId: hub?.id,
            hubSlug: hub?.slug,
            hubName: hub?.name,
            mode: "internal",
          });
          } else {
            openPublicStory(item);
          }
        }}
        activeOpacity={0.9}
        style={[
          styles.card,
          {
            width: cardWidth,
            marginBottom: cardGap,
          },
        ]}
      >
      
        <View style={[styles.heroWrap, { height: heroHeight }]}>
          {heroUri ? (
            <Image
              source={{ uri: heroUri }}
              style={[
                styles.hero,
              ]}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              <Text style={styles.heroPlaceholderText}>No photo</Text>
            </View>
          )}

          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{mode}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {safeTitle(item)}
          </Text>

          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {safeSubtitle(item)}
          </Text>

          {storyTags.length > 0 ? (
            <View style={styles.cardHashtagRow}>
              {storyTags.slice(0, 4).map((tag) => (
                <View key={tag} style={styles.cardHashtagPill}>
                  <Text style={styles.cardHashtagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {owner ? (
          <Text style={styles.cardOwner} numberOfLines={1}>
            Owned by {owner}
          </Text>
        ) : null}
          <View style={styles.cardTagRow}>
          {isInternal ? (
            <View style={styles.cardTag}>
              <Text style={styles.cardTagText}>Keepr Story</Text>
            </View>
          ) : null}
            {!isInternal ? (
            <TouchableOpacity
              style={styles.openInKeeprButton}
              onPress={() =>
              navigation.navigate("KeeprStoryInternal", {
                assetId: item.id,
                kac: item.kac_id,
                assetName: item.name,
                assetOwnerId: item.owner_id || item.user_id || null,
                hubId: hub?.id,
                hubSlug: hub?.slug,
                hubName: hub?.name,
                mode: "internal",
              })
              }
            >
              <Text style={styles.openInKeeprText}>Open in Keepr</Text>
            </TouchableOpacity>
          ) : null}

            {item._featured ? (
              <View style={styles.cardTagMuted}>
                <Text style={styles.cardTagMutedText}>Featured</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {item._linkedAt ? `Added ${daysSince(item._linkedAt)}d ago` : ""}
            </Text>

            {item.kac_id ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {item.kac_id}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={styles.top}>

      <View style={[styles.searchRow, isCompactHub && styles.searchRowCompact]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search stories…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.sortBtn, isCompactHub && styles.sortBtnCompact]}
          onPress={() => {
            const idx = SORT_OPTIONS.findIndex((s) => s.key === sortKey);
            const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key;
            setSortKey(next);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="swap-vertical" size={18} color={colors.textPrimary} />
          <Text style={styles.sortText}>
            {SORT_OPTIONS.find((s) => s.key === sortKey)?.label}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.filterLabel}>Explore the Collection</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={[styles.chip, !activeChip && styles.chipActive]}
          onPress={() => {
            setActiveChip(null);
            setQuery("");
          }}
        >
          <Text style={[styles.chipText, !activeChip && styles.chipTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        {assetChips.map((chip) => {
          const active = activeChip === chip;
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setActiveChip(chip);
                setQuery(chip);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.filterLabel}>Tags</Text>
      <View style={styles.chipRow}>
        {hashtagChips.map((chip) => {
          const active = activeChip === chip;

          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setActiveChip(chip);
                setQuery(chip);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  active && styles.chipTextActive,
                ]}
              >
                #{chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.filterLabel}>Owners</Text>
      <View style={styles.chipRow}>
        {ownerChips.map((chip) => {
          const active = activeChip === chip;
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setActiveChip(chip);
                setQuery(chip);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          Ownership stories shared with this Hub
        </Text>

        <TouchableOpacity onPress={loadHub} style={styles.refreshBtn} activeOpacity={0.85}>
          <Ionicons name="refresh" size={18} color={colors.textPrimary} />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const currentMember =
    hub?.members?.find((m) => String(m.user_id) === String(currentUserId)) ||
    hub?.currentMember ||
    null;

  const capabilities = getHubUserCapabilities({
  hub,
  user: currentUserId ? { id: currentUserId } : null,
  currentMember,
  isInternal,
});

const hasAssets = false; // wire later
const hasHubStories = stories.some(
  (s) => String(s.owner_id || s.user_id || "") === String(currentUserId || "")
);

const kaiInvite = getKaiTriggerContext({
  routeName: route?.name,
  params: route?.params || {},
  query:
    Platform.OS === "web" && typeof window !== "undefined"
      ? Object.fromEntries(new URLSearchParams(window.location.search))
      : {},
  userId: currentUserId,
  hub,
  inviteRecord,
  currentMember,
  hasAssets,
  hasHubStories,
});

const canManageHub = capabilities.canManageHub;
const canManageStories = capabilities.canManageHub;
const canInviteMembers =
capabilities.canManageHub || hub?.settings?.members_can_invite === true;
const showPrivateHubGate =
  !loading &&
  !isInternal &&
  (
    (hub?.id && capabilities.isPrivateHub && !capabilities.canViewHub) ||
    (!hub?.id && !!hubSlug && !!hubLoadError)
  );

const participationModel = capabilities.participation;
const hubType = capabilities.hubType;
const isAuthenticated = !!currentUserId;

const canPublicAddToHub = capabilities.canShowAddAssetCTA && !showPrivateHubGate;

const hubActions = isInternal ? (
  <View style={[styles.hubActions, isCompactHub && styles.hubActionsCompact]}>
    {canManageHub ? (
      <TouchableOpacity
        style={[styles.primaryHubAction, isCompactHub && styles.hubActionCompact]}
        onPress={() =>
          navigation.navigate("HubDetail", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="settings-outline" size={16} color="#fff" />
        <Text style={styles.primaryHubActionText}>Manage Hub</Text>
      </TouchableOpacity>
    ) : null}


    <TouchableOpacity
      style={[styles.secondaryHubAction, isCompactHub && styles.hubActionCompact]}
      onPress={() => {
        if (!hub?.slug) return;

        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.open(`/h/${hub.slug}`, "_blank", "noopener,noreferrer");
          return;
        }

        navigation.navigate("KeeprHub", { slug: hub.slug });
      }}
    >
      <Ionicons name="globe-outline" size={16} color={colors.textPrimary} />
      <Text style={styles.secondaryHubActionText}>Launch the Public Hub</Text>
    </TouchableOpacity>

    {canManageStories ? (
      <TouchableOpacity
        style={[styles.secondaryHubAction, isCompactHub && styles.hubActionCompact]}
        onPress={() =>
          navigation.navigate("ManageHubStories", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="albums-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryHubActionText}>Manage Stories</Text>
      </TouchableOpacity>
    ) : null}

    {canInviteMembers ? (
      <TouchableOpacity
        style={[styles.secondaryHubAction, isCompactHub && styles.hubActionCompact]}
        onPress={() =>
          navigation.navigate("InviteHubMembers", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="person-add-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryHubActionText}>Invite Members</Text>
      </TouchableOpacity>
    ) : null}
  </View>
) : null;

const addAssetLabel = capabilities.addAssetLabel || "Add your asset";

const handleAddToHubPress = async () => {
  const targetHubSlug = hub?.slug || hubSlug;
  const activationIntent = buildHubQuickAddIntent({
    hubId: hub?.id,
    hubSlug: targetHubSlug,
    hubName: hub?.name,
    returnRoute: capabilities.canOpenQuickActivation ? "HubQuickAddCar" : "AddHubStory",
  });

  if (!capabilities.canShowAddAssetCTA || capabilities.addAssetAction === "hidden") {
    Alert.alert(
      "Not available",
      "This Hub is not accepting public vehicle submissions."
    );
    return;
  }

  if (!currentUserId) {
    await storeAuthActivationIntent(activationIntent);
    navigation.navigate("Auth", {
      mode: "signup",
      source: "hub_activation",
      hubId: hub?.id,
      hubSlug: targetHubSlug,
      hubName: hub?.name,
      returnTo: activationIntent.returnRoute,
      preferredAssetType: activationIntent.preferredAssetType,
    });
    return;
  }

  if (capabilities.canOpenQuickActivation) {
    navigation.navigate("HubQuickAddCar", {
      slug: targetHubSlug,
      hubId: hub?.id,
      hubSlug: targetHubSlug,
      hubName: hub?.name,
    });
    return;
  }

  navigation.navigate("AddHubStory", {
    hubId: hub?.id,
    hubSlug: targetHubSlug,
    hubName: hub?.name,
    hub,
    activationMode: true,
  });
};

    const activationActions = (
  <View style={[styles.hubActions, isCompactHub && styles.hubActionsCompact]}>
    <TouchableOpacity
      style={[styles.secondaryHubAction, isCompactHub && styles.hubActionCompact]}
      onPress={() => {
        setGalleryIndex(0);
        setGalleryVisible(true);
      }}
    >
      <Ionicons name="images-outline" size={16} color={colors.textPrimary} />
      <Text style={styles.secondaryHubActionText}>Browse Gallery</Text>
    </TouchableOpacity>
    <TouchableOpacity
  style={[styles.secondaryHubAction, isCompactHub && styles.hubActionCompact]}
  onPress={() => setShareHubVisible(true)}
>
  <Ionicons name="share-social-outline" size={16} color={colors.textPrimary} />
  <Text style={styles.secondaryHubActionText}>Share Hub</Text>
</TouchableOpacity>
{canPublicAddToHub ? (
  <TouchableOpacity
    style={
      capabilities.addAssetAction === "hidden"
        ? [styles.disabledHubAction, isCompactHub && styles.hubActionCompact]
        : [styles.primaryHubAction, isCompactHub && styles.hubActionCompact]
    }
    onPress={handleAddToHubPress}
    activeOpacity={0.9}
  >
    <Ionicons
      name={
        capabilities.addAssetAction === "hidden"
          ? "lock-closed-outline"
          : "add-circle-outline"
      }
      size={16}
      color={capabilities.addAssetAction === "hidden" ? colors.textMuted : "#fff"}
    />
    <Text
      style={
        capabilities.addAssetAction === "hidden"
          ? styles.disabledHubActionText
          : styles.primaryHubActionText
      }
    >
      {addAssetLabel}
    </Text>
  </TouchableOpacity>
) : null}
  </View>
);

const hubContent = (
  <View
    style={[layoutStyles?.container, { flex: 1, width: "100%" }]}
    onLayout={(e) => {
      const w = e?.nativeEvent?.layout?.width;
      if (w && Math.abs(w - (containerWidth || 0)) > 1) {
        setContainerWidth(w);
      }
    }}
  >
    {isInternal ? (
      <View style={styles.mobileHubNav}>
        <TouchableOpacity onPress={() => navigation.navigate("MyHubs")}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.mobileHubNavTitle}>Back to KeeprHubs</Text>
      </View>
    ) : null}

    {!showPrivateHubGate ? activationActions : null}
    {!showPrivateHubGate ? hubActions : null}
    {!showPrivateHubGate ? header : null}

    {loading ? (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>Loading hub…</Text>
      </View>
    ) : showPrivateHubGate ? (
      <View style={styles.privateGate}>
        <View style={styles.privateGateIcon}>
          <Ionicons name="lock-closed-outline" size={26} color={colors.textPrimary} />
        </View>
        <Text style={styles.privateGateTitle}>
          {hub?.id ? "This Hub is private" : "This Hub is private or unavailable"}
        </Text>
        <Text style={styles.privateGateText}>
          {hub?.id
            ? "Sign in with an invited member account or ask the Hub owner for access."
            : "Sign in with an invited member account, or check that you have the correct Hub link."}
        </Text>
        <TouchableOpacity
          style={styles.privateGateButton}
          onPress={() =>
            navigation.navigate("Auth", {
              mode: "signin",
              source: "hub_private",
              hubId: hub?.id,
              hubSlug: hub?.slug || hubSlug,
              hubName: hub?.name,
              returnTo: "KeeprHub",
            })
          }
        >
          <Text style={styles.privateGateButtonText}>Sign in</Text>
        </TouchableOpacity>
      </View>
    ) : storyLoadError ? (
      <View style={styles.empty}>
        <Ionicons name="warning-outline" size={34} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Stories did not load</Text>
        <Text style={styles.emptyText}>
          You can still add your Porsche to this Hub. Refresh to try the gallery again.
        </Text>
        <TouchableOpacity onPress={loadHub} style={styles.emptyRetryButton} activeOpacity={0.85}>
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.emptyRetryButtonText}>Retry Gallery</Text>
        </TouchableOpacity>
      </View>
    ) : filtered.length === 0 ? (
      <View style={styles.empty}>
        <Ionicons name="albums-outline" size={34} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No stories yet</Text>
        <Text style={styles.emptyText}>
          Add public Keepr Story links to make this Hub come alive.
        </Text>
      </View>
    ) : (
      <View style={styles.grid}>
        {filtered.map((item) => (
          <View key={item._hubLinkId || item.id} style={styles.cardShell}>
            {renderCard({ item })}
          </View>
        ))}
      </View>
    )}
  </View>
);


const shellProps = {
  hub,
  stats: {
    stories: filtered.length,
    owners: ownerChips.length,
    makes: makeCount,
  },
  logoUrl: hub?.logo_url || hub?.photo_url || hub?.hero_image_url,
};

const handleOpenHubInKeepr = () => {
  if (!hub?.id) return;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = `/hub/${hub.id}`;
    return;
  }

  navigation.navigate("KeeprHubInternal", {
    hubId: hub.id,
    mode: "internal",
  });
};

const handleShareHub = useCallback(async () => {
  if (!hubShareUrl) return;

  await Share.share({
    title: hub?.name || "Keepr Hub",
    message: `${hub?.name || "Keepr Hub"}\n${hubShareUrl}`,
    url: hubShareUrl,
  });
}, [hub?.name, hubShareUrl]);

const handleCopyHubLink = useCallback(async () => {
  if (!hubShareUrl) return;

  await Clipboard.setStringAsync(hubShareUrl);
  setHubLinkCopied(true);
  setTimeout(() => setHubLinkCopied(false), 1600);
}, [hubShareUrl]);

const galleryModal = (
  <Modal
    visible={galleryVisible}
    animationType="fade"
    transparent
    onRequestClose={() => setGalleryVisible(false)}
  >
<View
  style={{
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  }}
>
  {activeGalleryItem && (
    <>
      <Image
        source={{ uri: activeGalleryItem.image }}
      style={{
        width: "92%",
        maxWidth: 980,
        height: Platform.OS === "web" ? "62vh" : 430,
        borderRadius: 12,
        resizeMode: "contain",
      }}
      />

      <View
        style={{
          marginTop: 16,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 28,
            fontWeight: "700",
          }}
        >
          {activeGalleryItem.title}
        </Text>

        <Text
          style={{
            color: "#ccc",
            marginTop: 4,
          }}
        >
          Owned by {activeGalleryItem.owner}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          marginTop: 24,
          flexWrap: "nowrap",
        }}

        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          setGallerySwipeStartX(e.nativeEvent.pageX);
        }}
        onResponderRelease={(e) => {
          if (gallerySwipeStartX == null) return;

          const dx = e.nativeEvent.pageX - gallerySwipeStartX;

          if (Math.abs(dx) > 50) {
            if (dx < 0) {
              setGalleryIndex((i) => Math.min(galleryItems.length - 1, i + 1));
            } else {
              setGalleryIndex((i) => Math.max(0, i - 1));
            }
          }

          setGallerySwipeStartX(null);
        }}
      >
        <TouchableOpacity
          disabled={galleryIndex === 0}
          onPress={() => setGalleryIndex((i) => i - 1)}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: "#fff",
            borderRadius: 8,
            opacity: galleryIndex === 0 ? 0.5 : 1,
          }}
        >
          <Text>Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            setGalleryVisible(false);

            navigation.navigate("PublicKeeprStory", {
              kac: activeGalleryItem.kac,
              originHubId: hub?.id,
              originHubSlug: hub?.slug,
              originHubName: hub?.name,
            });
          }}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: "#fff",
            borderRadius: 8,
          }}
        >
          <Text>View Story</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={galleryIndex >= galleryItems.length - 1}
          onPress={() => setGalleryIndex((i) => i + 1)}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: "#fff",
            borderRadius: 8,
            opacity:
              galleryIndex >= galleryItems.length - 1 ? 0.5 : 1,
          }}
        >
          <Text>Next</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => setGalleryVisible(false)}
        style={{
          marginTop: 24,
        }}
      >
        <Text style={{ color: "#fff" }}>Close</Text>
      </TouchableOpacity>
    </>
  )}
</View>
  </Modal>
);

const shareHubModal = (
  <Modal
    visible={shareHubVisible}
    transparent
    animationType="fade"
    onRequestClose={() => setShareHubVisible(false)}
  >
    <View style={styles.shareModalScrim}>
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={() => setShareHubVisible(false)}
      />

      <View style={styles.shareHubCard}>
        <ScrollView contentContainerStyle={{ alignItems: "center", padding: 20 }}>
          <View style={styles.shareHubTopRow}>
            <View>
              <Text style={styles.shareHubKicker}>Keepr Hub</Text>
              <Text style={styles.shareHubTitle}>{hub?.name || "Hub"}</Text>
            </View>

            <TouchableOpacity onPress={() => setShareHubVisible(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.shareQrPanel}>
            <QRCode value={hubShareUrl || "https://app.keeprhome.com"} size={220} />
          </View>

          <Text style={styles.sharePublicUrl} numberOfLines={2}>
            {hubShareUrl}
          </Text>

          <TouchableOpacity
            style={[styles.shareModalButton, styles.shareModalPrimaryButton]}
            onPress={handleShareHub}
          >
            <Ionicons name="share-social-outline" size={18} color="white" />
            <Text style={styles.shareModalPrimaryText}>Share Hub</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shareModalButton}
            onPress={handleCopyHubLink}
          >
            <Ionicons
              name={hubLinkCopied ? "checkmark-circle-outline" : "link-outline"}
              size={18}
              color={colors.textPrimary}
            />
            <Text style={styles.shareModalButtonText}>
              {hubLinkCopied ? "Copied" : "Copy Link"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  </Modal>
);

if (isInternal) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <InternalHubShell {...shellProps}>
        {hubContent}
        {galleryModal}
        {shareHubModal}
      </InternalHubShell>
    </SafeAreaView>
  );
}


const inviteLandingModal = (
  <Modal
    visible={inviteModalVisible}
    transparent
    animationType="fade"
    onRequestClose={() => setInviteModalVisible(false)}
  >
    <View style={styles.shareModalScrim}>
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={() => setInviteModalVisible(false)}
      />

      <View style={styles.inviteModalCard}>
        <View style={styles.shareHubTopRow}>
          <View>
            <Text style={styles.shareHubKicker}>KAI Advisor</Text>
            <Text style={styles.shareHubTitle}>
              {kaiInvite?.title || hub?.name || "Keepr Hub"}
            </Text>
          </View>

          <TouchableOpacity onPress={() => setInviteModalVisible(false)}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.inviteModalText}>
          {inviteLoading
            ? "Checking invitation..."
            : kaiInvite?.body ||
              "I'll help you continue your Hub activation."}
        </Text>

        <TouchableOpacity
          style={[styles.shareModalButton, styles.shareModalPrimaryButton]}
          onPress={async () => {
            try {
              if (kaiInvite?.gate === "auth") {
                setInviteModalVisible(false);
                setHubAuthModalVisible(true);
                return;
              }

            if (kaiInvite?.gate === "membership") {
              const accepted = await acceptHubInviteByToken({
                inviteToken,
                userId: currentUserId,
              });

              setInviteRecord((prev) => ({
                ...(prev || {}),
                ...(accepted || {}),
                status: "active",
                user_id: currentUserId,
                accepted_at: new Date().toISOString(),
              }));

              await loadHub();

              setInviteModalVisible(false);
              return;
            }

            if (kaiInvite?.gate === "story_optional") {
              setInviteModalVisible(false);
              return;
            }

              if (kaiInvite?.gate === "story") {
                setInviteModalVisible(false);
                handleAddToHubPress();
                return;
              }

              if (kaiInvite?.gate === "complete") {
                setInviteModalVisible(false);
                return;
              }

              setInviteModalVisible(false);
            } catch (e) {
              Alert.alert("Could not continue", e?.message || "Try again.");
            }
          }}
        >
          <Ionicons name="sparkles-outline" size={18} color="white" />
          <Text style={styles.shareModalPrimaryText}>
            {kaiInvite?.primaryLabel || "Continue"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.shareModalButton}
          onPress={() => {
            setInviteModalVisible(false);
            setGalleryIndex(0);
            if (galleryItems.length > 0) {
              setGalleryVisible(true);
            }
            if (kaiInvite?.gate === "story_optional") {
            setInviteModalVisible(false);
            handleAddToHubPress();
            return;
          }
          }}
        >
          <Ionicons name="images-outline" size={18} color={colors.textPrimary} />
          <Text style={styles.shareModalButtonText}>
            {kaiInvite?.secondaryLabel || "Explore Member Stories"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

return (
  <PublicShell
   showFooter={false}
    contextTitle={hub?.name || "Keepr Hub"}
    contextSubtitle="Keepr Community Hub"
    viewerLabel={
      capabilities?.canManageHub
        ? "Hub Admin"
        : currentMember
        ? "Hub Member"
        : currentUserId
        ? "Keepr Member"
        : "Visitor"
    }
    primaryActionLabel={
      capabilities?.canManageHub || currentMember
        ? "Open in Keepr"
        : currentUserId
        ? "Open Keepr"
        : "Join Keepr"
    }
    onPrimaryAction={handleOpenHubInKeepr}
  >
    <PublicHubShell {...shellProps}>
      {hubContent}
      {galleryModal}
      {shareHubModal}
      <HubAuthModal
        visible={hubAuthModalVisible}
        hubName={hub?.name || "this Hub"}
        onClose={() => setHubAuthModalVisible(false)}
        onSuccess={async () => {
          await loadHub();
          setHubAuthModalVisible(false);
          setInviteModalVisible(true);
        }}
      />
      {inviteLandingModal}
    </PublicHubShell>
  </PublicShell>
);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  top: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  h2: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  description: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  cardOwner: {
  marginTop: 4,
  color: colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
},
openInKeeprButton: {
  alignSelf: "flex-start",
  marginTop: 10,
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: "#111827",
},
openInKeeprText: {
  color: "#fff",
  fontSize: 11,
  fontWeight: "900",
},

  hubType: {
  marginTop: 4,
  fontSize: 11,
  fontWeight: "800",
  letterSpacing: 1,
  color: colors.textMuted,
},

hubActions: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 18,
},
hubActionsCompact: {
  gap: 8,
},
hubActionCompact: {
  width: "100%",
  minHeight: 46,
  justifyContent: "center",
},

disabledHubAction: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  backgroundColor: colors.surface,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#11182722",
  paddingHorizontal: 16,
  paddingVertical: 10,
  opacity: 0.7,
},

disabledHubActionText: {
  color: colors.textMuted,
  fontSize: 13,
  fontWeight: "800",
},

primaryHubAction: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  backgroundColor: "#111827",
  borderRadius: 999,
  paddingHorizontal: 16,
  paddingVertical: 10,
},

primaryHubActionText: {
  color: "#fff",
  fontSize: 13,
  fontWeight: "800",
},

mobileHubNav: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingHorizontal: 4,
  paddingTop: 6,
  paddingBottom: 14,
},

mobileHubNavTitle: {
  fontSize: 14,
  fontWeight: "800",
  color: colors.textPrimary,
},

secondaryHubAction: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  backgroundColor: colors.surface,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#11182722",
  paddingHorizontal: 16,
  paddingVertical: 10,
},

secondaryHubActionText: {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: "800",
},

grid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 16,
},

cardShell: {
  width: 420,
  maxWidth: "100%",
},

cardHashtagRow: {
  marginTop: 10,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
},

cardHashtagPill: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: "#EEF2FF",
  borderWidth: 1,
  borderColor: "#C7D2FE",
},

cardHashtagText: {
  fontSize: 11,
  fontWeight: "900",
  color: "#3730A3",
},

  searchRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchRowCompact: {
    alignItems: "stretch",
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },

chipRow: {
  marginTop: 10,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

chip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "#11182722",
},

chipActive: {
  backgroundColor: "#111827",
  borderColor: "#111827",
},

chipText: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textMuted,
},

chipTextActive: {
  color: "#fff",
},

filterLabel: {
  marginTop: 12,
  fontSize: 11,
  fontWeight: "900",
  letterSpacing: 0.8,
  color: colors.textMuted,
  textTransform: "uppercase",
},

  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  sortBtnCompact: {
    alignSelf: "center",
    paddingHorizontal: 12,
  },
  sortText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  summaryRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryText: { color: colors.textMuted, fontSize: 12, fontWeight: "600", flex: 1 },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  refreshText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: colors.textMuted },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyTitle: { color: colors.textPrimary, fontWeight: "800", fontSize: 17 },
  emptyText: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  emptyRetryButton: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
  },
  emptyRetryButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  privateGate: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 34,
    paddingHorizontal: 22,
    paddingVertical: 28,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
    ...(shadows?.subtle || {}),
  },
  privateGateIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    marginBottom: 14,
  },
  privateGateTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 20,
    textAlign: "center",
  },
  privateGateText: {
    marginTop: 8,
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  privateGateButton: {
    marginTop: 18,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  privateGateButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#11182722",
    ...(shadows?.subtle || {}),
  },
shareModalScrim: {
  flex: 1,
  backgroundColor: "rgba(6,10,18,0.76)",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
},

inviteModalCard: {
  width: "100%",
  maxWidth: 430,
  borderRadius: 28,
  backgroundColor: colors.surface,
  padding: 22,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.22)",
  zIndex: 2,
  elevation: 12,
  ...(shadows?.subtle || {}),
},

inviteModalText: {
  marginTop: 6,
  marginBottom: 10,
  fontSize: 15,
  lineHeight: 22,
  fontWeight: "700",
  color: colors.textMuted,
},

shareHubCard: {
  width: "100%",
  maxWidth: 430,
  borderRadius: 28,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.22)",
  overflow: "hidden",
  zIndex: 2,
  elevation: 12,
  ...(shadows?.subtle || {}),
},

shareHubTopRow: {
  width: "100%",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 18,
},

shareHubKicker: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.8,
},

shareHubTitle: {
  marginTop: 4,
  fontSize: 22,
  lineHeight: 26,
  fontWeight: "900",
  color: colors.textPrimary,
},

shareQrPanel: {
  padding: 16,
  borderRadius: 24,
  backgroundColor: "white",
  borderWidth: 1,
  borderColor: "#11182722",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 14,
},

sharePublicUrl: {
  width: "100%",
  textAlign: "center",
  fontSize: 12,
  lineHeight: 17,
  color: colors.textMuted,
  fontWeight: "700",
  marginBottom: 18,
},

shareModalButton: {
  width: "100%",
  minHeight: 48,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: "#11182722",
  backgroundColor: colors.background,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  paddingHorizontal: 14,
  marginTop: 10,
},

shareModalPrimaryButton: {
  backgroundColor: colors.brandBlue || "#2563eb",
  borderColor: colors.brandBlue || "#2563eb",
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

  heroWrap: { position: "relative", width: "100%", backgroundColor: "#f2f3f5" },
  hero: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f2f3f5",
  },
  heroPlaceholderText: { color: colors.textMuted, fontWeight: "600" },

  statePill: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statePillText: { color: "white", fontWeight: "800", fontSize: 11 },

  cardBody: { padding: 12 },
  cardTitle: { color: colors.textPrimary, fontWeight: "800", fontSize: 15 },
  cardSubtitle: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  cardTagRow: {
    marginTop: 11,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  cardTag: {
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  cardTagText: {
    color: "white",
    fontSize: 11,
    fontWeight: "800",
  },
  cardTagMuted: {
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#f2f3f5",
    borderWidth: 1,
    borderColor: "#11182722",
  },
  cardTagMutedText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "800",
  },

  metaRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metaText: { color: colors.textMuted, fontSize: 11, fontWeight: "700", flexShrink: 1 },
});
