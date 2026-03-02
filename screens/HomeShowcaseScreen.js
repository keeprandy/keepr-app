// screens/HomeShowcaseScreen.js
import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import {
  listAttachmentsForTarget,
  getSignedUrl,
  removePlacementById,
} from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { confirmRemove } from "../lib/confirmRemove";

const TILE_ASPECT = 4 / 3;

// Simple chip used for nav actions at the top
function QuickActionChip({ icon, label, onPress, isPrimary }) {
  return (
    <TouchableOpacity
      style={[styles.chip, isPrimary && styles.chipPrimary]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={isPrimary ? "#fff" : colors.textSecondary}
          style={{ marginRight: 4 }}
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

// Fallback gallery if we have no showcase attachments yet
// NOTE: This is legacy fallback only. Hero persistence is now placement-based.
// We keep it so the screen doesn't go blank for users with older data.
function buildFallbackGallery(asset) {
  if (!asset) return [];

  const gallery = [];

  if (asset.hero_image_url) {
    gallery.push({
      id: "legacy-hero",
      url: asset.hero_image_url,
      isHero: true,
      fromTable: false,
      placement_id: null,
    });
  }

  if (Array.isArray(asset.photo_urls)) {
    asset.photo_urls.forEach((url, idx) => {
      if (!url) return;
      if (url === asset.hero_image_url) return;
      gallery.push({
        id: `legacy-${idx}`,
        url,
        isHero: false,
        fromTable: false,
        placement_id: null,
      });
    });
  }

  return gallery;
}

async function ensurePermission() {
  if (Platform.OS === "web") return true;
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    Alert.alert(
      "Permission needed",
      "We need access to your photo library so you can add showcase photos."
    );
    return false;
  }
  return true;
}

export default function HomeShowcaseScreen({ navigation, route }) {
  const homeId = route?.params?.homeId ?? null;

  const { assets: homes = [], loading, error } = useAssets("home");

  const currentHome = useMemo(() => {
    if (!homes?.length) return null;
    if (!homeId) return homes[0];
    return homes.find((h) => h.id === homeId) || homes[0] || null;
  }, [homes, homeId]);

  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);

  // ✅ Persistent hero: assets.hero_placement_id (NOT a URL)
  const [heroPlacementId, setHeroPlacementId] = useState(
    currentHome?.hero_placement_id || null
  );

  useEffect(() => {
    setHeroPlacementId(currentHome?.hero_placement_id || null);
  }, [currentHome?.hero_placement_id]);

  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxStartIndex, setLightboxStartIndex] = useState(0);

  const { width, height } = useWindowDimensions();
  const numColumns = width >= 1200 ? 3 : width >= 768 ? 2 : 1;

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("RootTabs", { screen: "MyHome" });
    }
  };

  // nav shortcuts
  const goToHomeStory = () => {
    if (!currentHome?.id) return;
    navigation.navigate("HomeStory", { homeId: currentHome.id });
  };

  const goToHomeSystems = () => {
    if (!currentHome?.id) return;
    navigation.navigate("MyHomeSystems", {
      homeId: currentHome.id,
      homeName: currentHome.name || "Home",
    });
  };

  const goToAddServiceRecord = () => {
    if (!currentHome?.id) return;
    navigation.navigate("AddServiceRecord", {
      source: "home",
      assetId: currentHome.id,
      homeId: currentHome.id,
      assetName: currentHome.name,
    });
  };

  const goToEditHome = () => {
    if (!currentHome?.id) return;
    navigation.navigate("EditHome", { homeId: currentHome.id });
  };

  // Fetch the latest hero_placement_id from assets (prevents stale state)
  const refreshHeroPlacementId = useCallback(async () => {
    if (!currentHome?.id) return null;

    const { data, error: err } = await supabase
      .from("assets")
      .select("hero_placement_id")
      .eq("id", currentHome.id)
      .maybeSingle();

    if (err) {
      // Don't block UI; just log
      console.log("HomeShowcase refresh hero_placement_id error", err);
      return null;
    }

    const next = data?.hero_placement_id ?? null;
    setHeroPlacementId(next);
    return next;
  }, [currentHome?.id]);

  // --- Load showcase photos from attachments (is_showcase = true) ---

  const loadPhotos = useCallback(
    async (opts = { useFallback: true }) => {
      if (!currentHome?.id) {
        setPhotos([]);
        return;
      }

      setPhotosLoading(true);
      setPhotosError(null);

      try {
        // Ensure we have the latest hero_placement_id before marking isHero
        const latestHero = await refreshHeroPlacementId();
        const effectiveHero = latestHero ?? heroPlacementId ?? null;

        const rows = await listAttachmentsForTarget("asset", currentHome.id);

        const gallery = [];

        for (const row of rows || []) {
          // Only curated showcase placements
          if (!row.is_showcase) continue;

          const kind = row.kind || "";
          const mime = String(row.mime_type || "").toLowerCase();
          const fileName = row.file_name || row.storage_path || "";
          const ext = fileName.split(".").pop()?.toLowerCase() || "";

          const looksLikeImage =
            kind === "photo" ||
            mime.startsWith("image/") ||
            ["jpg", "jpeg", "png", "heic", "webp"].includes(ext);

          if (!looksLikeImage) continue;

          let url = row.url || null;

          if (!url && row.bucket && row.storage_path) {
            try {
              url = await getSignedUrl({
                bucket: row.bucket,
                path: row.storage_path,
              });
            } catch (e) {
              console.log("HomeShowcase getSignedUrl error", e);
            }
          }

          if (!url) continue;

          gallery.push({
            id: row.placement_id || row.attachment_id || row.id,
            url,
            // ✅ HERO IS BY PLACEMENT ID (persistent)
            isHero: effectiveHero ? effectiveHero === row.placement_id : false,
            fromTable: true,
            placement_id: row.placement_id,
            storage_path: row.storage_path,
            bucket: row.bucket,
            created_at: row.created_at,
          });
        }

        gallery.sort((a, b) => {
          const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bT - aT;
        });

        if (!gallery.length && opts.useFallback) {
          setPhotos(buildFallbackGallery(currentHome));
        } else {
          setPhotos(gallery);
        }
      } catch (e) {
        console.error("Error loading home showcase attachments", e);
        setPhotosError("Could not load photos.");
        if (opts.useFallback) {
          setPhotos(buildFallbackGallery(currentHome));
        }
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentHome, heroPlacementId, refreshHeroPlacementId]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        if (!currentHome?.id) return;
        await loadPhotos({ useFallback: true });
      };
      run();
      return () => {
        active = false;
      };
    }, [currentHome?.id, loadPhotos])
  );

  // --- Add photo (creates is_showcase = true placement) ---

  const handleAddPhoto = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok || !currentHome?.id) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      selectionLimit: 1,
    });

    if (picked.canceled) return;

    const asset = currentHome;
    const selected = picked.assets?.[0];
    if (!selected?.uri) return;

    try {
      setPhotosLoading(true);
      setPhotosError(null);

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      if (!userId) {
        Alert.alert("Not signed in", "You need to be signed in to add photos.");
        return;
      }

      const fileName =
        selected.fileName || `home-${asset.id}-${Date.now()}.jpg`;

      await uploadAttachmentFromUri({
        userId,
        assetId: asset.id,
        kind: "photo",
        fileUri: selected.uri,
        fileName,
        mimeType: selected.mimeType || "image/jpeg",
        sizeBytes: selected.fileSize || null,
        placements: [
          {
            target_type: "asset",
            target_id: asset.id,
            role: "showcase",
            is_showcase: true,
          },
        ],
        source_context: {
          origin: "home_showcase",
          asset_id: asset.id,
        },
      });

      await loadPhotos({ useFallback: false });
    } catch (e) {
      console.error("Home showcase add photo error", e);
      Alert.alert(
        "Add photo failed",
        e?.message || "Could not save photo. Please try again."
      );
      setPhotosError("Could not save photo.");
    } finally {
      setPhotosLoading(false);
    }
  }, [currentHome, loadPhotos]);

  // --- Set hero (persistent by placement id) ---

  const handleSetHero = useCallback(
    async (photo) => {
      if (!currentHome?.id || !photo?.placement_id) {
        Alert.alert("Could not set hero", "This photo is missing a placement id.");
        return;
      }

      try {
        setPhotosLoading(true);

        const { error: updateError } = await supabase
          .from("assets")
          .update({ hero_placement_id: photo.placement_id })
          .eq("id", currentHome.id);

        if (updateError) {
          console.error("Error updating hero_placement_id", updateError);
          Alert.alert(
            "Could not set hero",
            updateError.message || "Please try again."
          );
          return;
        }

        setHeroPlacementId(photo.placement_id);

        // Update UI instantly (no flash)
        setPhotos((prev) =>
          (prev || []).map((p) => ({
            ...p,
            isHero: p.placement_id === photo.placement_id,
          }))
        );
      } catch (e) {
        console.error("Error setting hero image", e);
        Alert.alert("Could not set hero", e?.message || "Please try again.");
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentHome]
  );

  // --- Remove from showcase (removes asset placement) ---

  const handleDeletePhoto = useCallback(
    async (photo) => {
      if (!photo) return;

      // Fallback-only: just drop from local state
      if (!photo.fromTable || !photo.placement_id) {
        setPhotos((prev) =>
          (prev || []).filter((p) => p.id !== photo.id && p.url !== photo.url)
        );
        return;
      }

      Alert.alert(
        "Remove photo",
        "Remove this photo from this home’s showcase? (It may still exist on other records.)",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                setPhotosLoading(true);

                await removePlacementById(photo.placement_id);
                // Immediately remove from local state
                setPhotos((prev) =>
                  (prev || []).filter(
                    (p) => p.placement_id !== photo.placement_id
                  )
                );

                // If we removed the hero photo from showcase, clear hero_placement_id
                if (photo.isHero && currentHome?.id) {
                  const { error: clearErr } = await supabase
                    .from("assets")
                    .update({ hero_placement_id: null })
                    .eq("id", currentHome.id);

                  if (clearErr) {
                    console.log("Clear hero_placement_id error", clearErr);
                  }
                  setHeroPlacementId(null);
                }

                await loadPhotos({ useFallback: true });
              } catch (e) {
                console.error("Error removing home showcase photo", e);
                Alert.alert("Could not remove", e?.message || "Please try again.");
              } finally {
                setPhotosLoading(false);
              }
            },
          },
        ]
      );
    },
    [currentHome?.id, loadPhotos]
  );

  // --- Lightbox ---

  const openLightbox = (photo) => {
    if (!photo?.url) return;
    const idx = photos.findIndex((p) => (p.id && photo.id ? p.id === photo.id : p.url === photo.url));
    setLightboxStartIndex(idx >= 0 ? idx : 0);
    setLightboxVisible(true);
  };

  const closeLightbox = () => {
    setLightboxVisible(false);
    setLightboxStartIndex(0);
  };

  // --- Masonry columns ---

  const hasGallery = photos && photos.length > 0;

  const columns = useMemo(() => {
    if (!hasGallery) return [];

    const cols = Array.from({ length: numColumns }, () => []);
    const heights = Array.from({ length: numColumns }, () => 0);

    photos.forEach((photo) => {
      const aspect = TILE_ASPECT;
      const h = 1 / aspect;
      let targetIndex = 0;
      let minHeight = heights[0];

      for (let i = 1; i < numColumns; i++) {
        if (heights[i] < minHeight) {
          minHeight = heights[i];
          targetIndex = i;
        }
      }

      cols[targetIndex].push(photo);
      heights[targetIndex] += h;
    });

    return cols;
  }, [photos, numColumns, hasGallery]);

  // --- Guard rails ---

  if (loading && !currentHome && !error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8 }}>Loading your home…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentHome) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No home found</Text>
          <Text style={styles.emptyText}>
            Add a home first, then come back to create a showcase.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      {/* Header */}
      <View style={styles.kHeader}>
        <View style={styles.kHeaderLeft}>
          <TouchableOpacity style={styles.kHeaderIconBtn} onPress={handleBack}>
            <Ionicons
              name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
              size={18}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View>
            <Text style={styles.kHeaderTitle}>Home showcase</Text>
            <Text style={styles.breadcrumbText} numberOfLines={1}>
              {currentHome.name || "My home"}
            </Text>
          </View>
        </View>

        <View style={styles.kHeaderRight}>
          <TouchableOpacity
            style={styles.kHeaderIconBtn}
            onPress={handleAddPhoto}
            disabled={photosLoading}
          >
            <Ionicons name="add" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick actions */}
        <View style={styles.quickActionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsScroll}
          >
            <QuickActionChip
              icon="images-outline"
              label="Showcase"
              isPrimary
              onPress={() => {}}
            />
            <QuickActionChip icon="book-outline" label="Story" onPress={goToHomeStory} />
            <QuickActionChip icon="grid-outline" label="Systems" onPress={goToHomeSystems} />
            <QuickActionChip icon="hammer-outline" label="Add service" onPress={goToAddServiceRecord} />
            <QuickActionChip icon="create-outline" label="Edit home" onPress={goToEditHome} />
          </ScrollView>
        </View>

        {/* Blurb */}
        <View style={styles.blurbCard}>
          <Text style={styles.blurbText}>
            Use this screen as your “humble brag” — photos plus a full service history in Keepr make it easy to show off
            condition, upgrades, and how well this home has been maintained.
          </Text>
        </View>

        {/* Gallery */}
        {photosLoading && !hasGallery ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8 }}>Loading photos…</Text>
          </View>
        ) : hasGallery ? (
          <View style={styles.gridRow}>
            {columns.map((col, colIndex) => (
              <View
                key={`col-${colIndex}`}
                style={[styles.gridColumn, colIndex > 0 && styles.gridColumnSpacer]}
              >
                {col.map((photo) => {
                  if (!photo.url) return null;

                  return (
                    <TouchableOpacity
                      key={photo.id || photo.url}
                      style={styles.tile}
                      activeOpacity={0.9}
                      onPress={() => openLightbox(photo)}
                    >
                      <Image source={{ uri: photo.url }} style={styles.tileImage} resizeMode="cover" />

                      {photo.isHero && (
                        <View style={styles.heroBadge}>
                          <Ionicons name="star" size={11} style={styles.heroBadgeIcon} />
                          <Text style={styles.heroBadgeText}>Hero photo</Text>
                        </View>
                      )}

                      <View style={styles.tileActionsRow}>
                        <TouchableOpacity
                          style={styles.tileActionButton}
                          onPress={() => handleSetHero(photo)}
                          disabled={photosLoading}
                        >
                          <Text style={styles.tileActionText}>Set as hero</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.tileActionButtonDanger}
                          onPress={() => handleDeletePhoto(photo)}
                          disabled={photosLoading}
                        >
                          <Text style={styles.tileActionText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="images-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No showcase photos yet</Text>
            <Text style={styles.emptyText}>
              Add a photo of this home to create a curated showcase. Technical proof photos (HVAC, sump pump, etc.)
              still live in Attachments, but only the curated set appears here.
            </Text>
          </View>
        )}

        {photosError && (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <Text style={{ color: "red", fontSize: 12 }}>{photosError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Lightbox modal */}
      <Modal
        visible={lightboxVisible}
        transparent
        animationType="fade"
        onRequestClose={closeLightbox}
      >
        <View style={styles.lightboxBackdrop}>
          <View style={styles.lightboxInner}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: lightboxStartIndex * width, y: 0 }}
              style={styles.lightboxScroll}
            >
              {photos.map((p) => (
                <View key={p.id || p.url} style={[styles.lightboxPage, { width, height }]}>
                  {p.url && (
                    <Image source={{ uri: p.url }} style={styles.lightboxImage} resizeMode="contain" />
                  )}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.lightboxClose} onPress={closeLightbox}>
              <Ionicons name="close" size={24} color={colors.brandWhite} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ======================== STYLES ======================== */

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },

  // Quick actions
  quickActionsRow: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  quickActionsScroll: { paddingRight: spacing.sm, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
  },
  chipPrimary: { backgroundColor: colors.primary, borderColor: "transparent" },
  chipLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  chipLabelPrimary: { color: "white" },

  blurbCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  blurbText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },

  gridRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
  },
  gridColumn: { flex: 1 },
  gridColumnSpacer: { marginLeft: spacing.sm },

  tile: {
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    ...shadows.subtle,
  },
  tileImage: { width: "100%", aspectRatio: TILE_ASPECT },

  heroBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgb(45, 125, 227);",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroBadgeIcon: { color: "#FACC15", marginRight: 4 },
  heroBadgeText: { fontSize: 10, color: "white", fontWeight: "700" },

  tileActionsRow: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  tileActionButton: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "rgba(45, 124, 227, 0.6);",
    alignItems: "center",
    justifyContent: "center",
  },
  tileActionButtonDanger: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "rgba(81, 78, 78, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  tileActionText: { fontSize: 11, fontWeight: "600", color: "white" },

  emptyCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  emptyTitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
  },

  // Keepr header + breadcrumb
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
    color: colors.textPrimary,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  breadcrumbText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
    maxWidth: 220,
  },

  // Lightbox
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxInner: { width: "100%", height: "100%" },
  lightboxScroll: { flex: 1 },
  lightboxPage: { justifyContent: "center", alignItems: "center" },
  lightboxImage: { width: "100%", height: "100%" },
  lightboxClose: {
    position: "absolute",
    top: spacing.xl,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15,23,42,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
});
