// screens/PublicKeeprStoryScreen.js

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Modal,
} from "react-native";
import PublicShell from "../components/public/PublicShell";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

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
    console.log("PUBLIC STORY MEDIA ERROR:", json);
    return [];
  }

  return Array.isArray(json?.media) ? json.media : [];
}

/* -------------------------------------------------------------------------- */
/*                           PUBLIC KEEPR STORY SCREEN                        */
/* -------------------------------------------------------------------------- */

export default function PublicKeeprStoryScreen({ navigation, route }) {
  const { width } = useWindowDimensions();
  const isWide = IS_WEB && width >= 980;

  const kac = route?.params?.kac || null;
const assetId = route?.params?.assetId || null;

  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState(null);
  const [heroUri, setHeroUri] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [systems, setSystems] = useState([]);
  const [activeTab, setActiveTab] = useState("story");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [swipeStartX, setSwipeStartX] = useState(null);
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);

  const publicConfig =
  asset?.public_config ||
  asset?.extra_metadata?.publicConfig ||
  {};

  const storyConfig = publicConfig.story || {};
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

  const timelineMode = storyConfig.showTimeline || "highlights_only";

  const scrollRef = useRef(null);

  /* ------------------------------------------------------------------------ */
  /*                              LOAD PUBLIC STORY                           */
  /* ------------------------------------------------------------------------ */

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

  if (summaryError) {
    console.log("Public story summary load failed", summaryError);
  }

  if (summaryRow) {
  assetRow = {
    ...summaryRow,
    id: summaryRow.asset_id,
  };
}
}

    // INTERNAL PREVIEW MODE
    if (!assetRow && assetId) {
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .maybeSingle();

      if (error) {
        console.log("Public preview asset load failed", error);
      }

      assetRow = data || null;
    }

    if (!assetRow) {
      return;
    }

    setAsset(assetRow);
    const publicAssetId = assetRow.asset_id || assetRow.id;
    const publicKac = assetRow.kac_id || kac;

      console.log("PUBLIC STORY ASSET ROW:", assetRow);
      console.log("PUBLIC STORY HERO IMAGE URL:", assetRow?.hero_image_url);
      console.log("PUBLIC STORY HERO PLACEMENT ID:", assetRow?.hero_placement_id);
      console.log("PUBLIC STORY PUBLIC ASSET ID:", publicAssetId);

  
      /* ------------------------------- TIMELINE ------------------------------ */

      const { data: serviceRows, error: timelineError } = await supabase
        .from("public_asset_story_timeline")
        .select("*")
        .eq("kac_id", publicKac)
        .order("performed_at", { ascending: false });

      console.log("PUBLIC TIMELINE:", serviceRows);
      console.log("PUBLIC TIMELINE ERROR:", timelineError);

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

      /* -------------------------------- SYSTEMS ----------------------------- */

      const { data: systemRows } = await supabase
        .from("systems")
        .select("id, name")
        .eq("asset_id", publicAssetId)
        .order("name", { ascending: true });

      setSystems(systemRows || []);

      /* -------------------------------- GALLERY ----------------------------- */

      const mediaRows = await fetchPublicStoryMedia(publicKac);

      console.log("PUBLIC STORY MEDIA:", mediaRows);

      /* ------------------------------ HERO IMAGE ----------------------------- */

      const heroPlacement =
        mediaRows.find(
          (x) => String(x.placement_id) === String(assetRow.hero_placement_id)
        ) ||
        mediaRows.find((x) => x.role === "hero") ||
        null;

      console.log("PUBLIC HERO PLACEMENT:", heroPlacement);

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

      setGallery(
        sortedMediaRows
        .filter((row) => !!row.image_url)
          .map((row) => ({
            id: row.attachment_id || row.placement_id,
            uri: row.image_url,
            role: row.role,
          }))
      );

    } catch (e) {
      console.log("Public story load error", e);
    } finally {
      setLoading(false);
    }
  }, [kac, assetId]);

  useEffect(() => {
    loadPublicStory();
  }, [loadPublicStory]);

  /* ------------------------------------------------------------------------ */
  /*                                   LOADING                                */
  /* ------------------------------------------------------------------------ */

  if (loading) {
  return (
    <PublicShell kac={kac}>
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={{ marginTop: spacing.sm }}>Loading Keepr Story...</Text>
      </View>
    </PublicShell>
  );
}

if (!asset || !publicEnabled) {
  return (
    <PublicShell kac={kac}>
      <View style={styles.centered}>
        <Text style={styles.notFoundTitle}>Story not found</Text>
        <Text style={styles.notFoundText}>
          This Keepr Story may be private or unavailable.
        </Text>
      </View>
    </PublicShell>
  );
}


  /* ------------------------------------------------------------------------ */
  /*                                  RENDER                                  */
  /* ------------------------------------------------------------------------ */

return (
  <PublicShell kac={kac || asset?.kac_id}>

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
            <Image
            source={keeprEnabledMark}
            style={styles.keeprEnabledMark}
            resizeMode="contain"
            />
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
                if (Platform.OS === "web" && typeof window !== "undefined") {
                  window.alert(
                    `Public Keepr Story:\n${window.location.origin}/k/${asset.kac_id || kac}`
                  );
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
              Gallery
            </Text>
          </TouchableOpacity>
          )}

          {actionConfig.actionsEnabled?.length > 0 && (
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === "actions" && styles.tabButtonActive,
            ]}
            onPress={() => navigation.navigate("PublicAction", { kac })}
          >
              <Text
              style={[
                styles.tabLabel,
                activeTab === "actions" && styles.tabLabelActive,
              ]}
            >
              Actions
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

              {(timelineMode === "highlights_only"
                  ? timeline.slice(0, 5)
                  : timeline
                ).map((item) => (
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
  </PublicShell>
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

  heroMeta: {
    padding: spacing.lg,
  },

  heroMetaWide: {
    flex: 1,
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
  marginBottom: spacing.xl,
},

publicGalleryTile: {
  width: IS_WEB ? 260 : "48%",
  height: 190,
  borderRadius: radius.xl,
  overflow: "hidden",
  backgroundColor: colors.surfaceSubtle,
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

galleryScrim: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 70,
  backgroundColor: "rgba(15,23,42,0.22)",
},

lightbox: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.94)",
  alignItems: "center",
  justifyContent: "center",
},

lightboxTopBar: {
  position: "absolute",
  top: 24,
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
    padding: spacing.lg,
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
