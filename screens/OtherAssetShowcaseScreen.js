// screens/OtherAssetShowcaseScreen.js
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
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import LightboxModal from "../components/LightboxModal";
import ShowcaseAttachmentsSection from "../components/showcase/ShowcaseAttachmentsSection";

import {
  listAttachmentsForTarget,
  getSignedUrl,
  removePlacementById,
} from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { MEDIA_VARIANTS, getAttachmentVariantUrl } from "../lib/mediaVariants";

const TILE_ASPECT = 4 / 3;

/* ---------- quick action chip (nav only, like BoatShowcase) ---------- */
function QuickActionChip({ icon, label, onPress, isPrimary }) {
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

export default function OtherAssetShowcaseScreen({ navigation, route }) {
  const assetId = route?.params?.assetId ?? null;
  const { width } = useWindowDimensions();
  const numColumns = width >= 1200 ? 3 : width >= 768 ? 2 : 1;

  const { assets = [], loading, error } = useAssets("other");

  const currentAsset = useMemo(() => {
    if (!assets || assets.length === 0) return null;
    if (!assetId) return assets[0];
    return assets.find((v) => v.id === assetId) || assets[0] || null;
  }, [assets, assetId]);

  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);

  const [showcaseFiles, setShowcaseFiles] = useState([]);
const [showcaseLinks, setShowcaseLinks] = useState([]);

  // Lightbox state
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // ✅ hero persistence: use assets.hero_placement_id
  const [heroPlacementId, setHeroPlacementId] = useState(
    currentAsset?.hero_placement_id || null
  );

  useEffect(() => {
    setHeroPlacementId(currentAsset?.hero_placement_id || null);
  }, [currentAsset?.hero_placement_id]);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Dashboard");
  };

  /* ---------- navigation helpers ---------- */

  const goToAssetStory = () => {
    if (!currentAsset?.id) return;
    navigation.navigate("OtherAssetStory", { assetId: currentAsset.id });
  };

  const goToAssetSystems = () => {
    if (!currentAsset?.id) return;
    Alert.alert("Systems coming soon", "Systems for other assets are coming soon.");
  };

  const goToAddTimelineRecord = () => {
    if (!currentAsset?.id) return;
    navigation.navigate("AddTimelineRecord", {
      source: "other",
      assetType: "other",
      assetId: currentAsset.id,
      assetName: currentAsset.name || assetDisplayName,
    });
  };

  const goToEditAsset = () => {
    if (!currentAsset?.id) return;
    navigation.navigate("EditAsset", { assetId: currentAsset.id });
  };

  /* ---------- helper: fallback gallery from legacy fields ---------- */
  // (kept ONLY so the screen isn't blank if attachments aren't present yet)
  const buildFallbackGallery = (asset) => {
    const gallery = [];
    if (!asset) return gallery;

    if (asset.hero_image_url) {
      gallery.push({
        id: "legacy-hero-url",
        url: asset.hero_image_url,
        placement_id: null,
        fromTable: false,
        isHero: false,
      });
    }

    if (Array.isArray(asset.photo_urls) && asset.photo_urls.length) {
      asset.photo_urls.forEach((u, idx) => {
        if (u && u !== asset.hero_image_url) {
          gallery.push({
            id: `legacy-url-${idx}`,
            url: u,
            placement_id: null,
            fromTable: false,
            isHero: false,
          });
        }
      });
    } else if (Array.isArray(asset.photos) && asset.photos.length) {
      asset.photos.forEach((u, idx) => {
        if (u && u !== asset.hero_image_url) {
          gallery.push({
            id: `legacy-photo-${idx}`,
            url: u,
            placement_id: null,
            fromTable: false,
            isHero: false,
          });
        }
      });
    }

    return gallery;
  };

  /* ---------- load gallery from attachments (is_showcase = true) ---------- */

  const loadPhotos = useCallback(
    async (opts = { useFallback: true }) => {
      if (!currentAsset?.id) {
        setPhotos([]);
        setShowcaseFiles([]);
        setShowcaseLinks([]);
        return;
      }

      setPhotosLoading(true);
      setPhotosError(null);

      try {
        const rows = await listAttachmentsForTarget("asset", currentAsset.id);

        const showcased = (rows || []).filter((row) => row.is_showcase);

        setShowcaseFiles(
          showcased.filter((row) => {
            const kind = row.kind || "";
            const mime = String(row.mime_type || "").toLowerCase();
            const fileName = row.file_name || row.storage_path || "";
            const ext = fileName.split(".").pop()?.toLowerCase() || "";

            const isImage =
              kind === "photo" ||
              mime.startsWith("image/") ||
              ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext);

            return row.kind !== "link" && !isImage;
          })
        );

        setShowcaseLinks(showcased.filter((row) => row.kind === "link"));

        const gallery = [];

        for (const row of rows || []) {
          if (!row.is_showcase) continue;

          const kind = row.kind || "";
          const mime = String(row.mime_type || "").toLowerCase();
          const fileName = row.file_name || row.storage_path || "";
          const ext = fileName.split(".").pop()?.toLowerCase() || "";

          const looksLikeImage =
            kind === "photo" ||
            mime.startsWith("image/") ||
            ["jpg", "jpeg", "png", "webp"].includes(ext)

          if (!looksLikeImage) continue;

          let url = row.url || null;

          if (!url && row.bucket && row.storage_path) {
            try {
              url = await getAttachmentVariantUrl(row, MEDIA_VARIANTS.GALLERY_TILE);
            } catch (e) {
              console.log("OtherAssetShowcase getSignedUrl error", e);
            }
          }

          if (!url) continue;

          gallery.push({
            id: row.placement_id || row.attachment_id || row.id,
            url,
            placement_id: row.placement_id || null,
            storage_path: row.storage_path,
            bucket: row.bucket,
            created_at: row.created_at,
            fromTable: true,
            isHero:
              !!heroPlacementId &&
              !!row.placement_id &&
              row.placement_id === heroPlacementId,
          });
        }

        // sort newest first
        gallery.sort((a, b) => {
          const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bT - aT;
        });

        // ✅ AUTO HERO (core fix):
        // If there's exactly one showcase photo AND no hero is set yet, persist it as the hero.
        // This ensures: (a) first photo becomes hero automatically, and (b) existing assets with 1 photo get a hero.
        if (!heroPlacementId && gallery.length === 1 && gallery[0]?.placement_id) {
          try {
            const only = gallery[0];

            const { error: promoteErr } = await supabase
              .from("assets")
              .update({ hero_placement_id: only.placement_id })
              .eq("id", currentAsset.id);

            if (!promoteErr) {
              setHeroPlacementId(only.placement_id);
              only.isHero = true; // immediate UI feedback
            } else {
              console.log("OtherAssetShowcase auto-hero promote error", promoteErr);
            }
          } catch (e) {
            console.log("OtherAssetShowcase auto-hero promote exception", e);
          }
        } else if (heroPlacementId && gallery.length) {
          // Keep hero flag accurate even if state changed between loads
          const heroId = heroPlacementId;
          gallery.forEach((p) => {
            p.isHero = !!p.placement_id && p.placement_id === heroId;
          });
        }

        if (!gallery.length && opts.useFallback) {
          setPhotos(buildFallbackGallery(currentAsset));
        } else {
          setPhotos(gallery);
        }
      } catch (e) {
        console.error("Error loading asset showcase attachments", e);
        setPhotosError("Could not load photos.");
        if (opts.useFallback) setPhotos(buildFallbackGallery(currentAsset));
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentAsset?.id, heroPlacementId]
  );

  useFocusEffect(
    useCallback(() => {
      if (!currentAsset?.id) return;
      loadPhotos({ useFallback: true });
    }, [currentAsset?.id, loadPhotos])
  );

  /* ---------- lightbox helpers ---------- */

  const allPhotos = photos.filter((p) => !!p.url).map((p) => ({ uri: p.url }));

  const findLightboxIndex = (photo) => {
    const idx = photos.findIndex((p) => p.id === photo.id || p.url === photo.url);
    return idx >= 0 ? idx : 0;
  };

  const openLightboxForPhoto = (photo) => {
    if (!allPhotos.length) return;
    setLightboxIndex(findLightboxIndex(photo));
    setLightboxVisible(true);
  };

  /* ---------- permissions ---------- */

  const ensurePermission = async () => {
    if (Platform.OS === "web") return true;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your photos to add pictures of your asset."
      );
      return false;
    }
    return true;
  };

  /* ---------- add photo (attachments pipeline, is_showcase = true) ---------- */

  const handleAddPhoto = async () => {
    if (!currentAsset?.id) return;
    const ok = await ensurePermission();
    if (!ok) return;

    const pickerMediaTypes =
      ImagePicker.MediaType?.Images ||
      ImagePicker.MediaTypeOptions?.Images ||
      "images";

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: pickerMediaTypes,
      quality: 0.6,
      selectionLimit: 1,
    });

    if (result.canceled) return;

    const picked = result.assets && result.assets[0];
    if (!picked?.uri) return;

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
        picked.fileName ||
        picked.name ||
        `asset-${currentAsset.id}-${Date.now()}.jpg`;

      await uploadAttachmentFromUri({
        userId,
        assetId: currentAsset.id,
        kind: "photo",
        fileUri: picked.uri,
        fileName,
        mimeType: picked.mimeType || "image/jpeg",
        sizeBytes: picked.fileSize || null,
        placements: [
          {
            target_type: "asset",
            target_id: currentAsset.id,
            role: "showcase",
            is_showcase: true,
          },
        ],
        source_context: {
          origin: "other_asset_showcase",
          asset_id: currentAsset.id,
        },
      });

      // loadPhotos now auto-promotes to hero when it's the only photo
      await loadPhotos({ useFallback: false });
    } catch (err) {
      console.error("Add asset showcase photo error", err);
      Alert.alert("Error", "Something went wrong adding this photo.");
      setPhotosError("Could not save photo.");
    } finally {
      setPhotosLoading(false);
    }
  };

  /* ---------- set hero (assets.hero_placement_id) ---------- */

  const handleSetHero = async (photo) => {
    if (!currentAsset?.id) return;

    if (!photo?.placement_id) {
      Alert.alert(
        "Can’t set hero",
        "This photo is a legacy/fallback item. Add it through Showcase so it becomes a real attachment."
      );
      return;
    }

    try {
      setPhotosLoading(true);

      const { error: updateError } = await supabase
        .from("assets")
        .update({ hero_placement_id: photo.placement_id })
        .eq("id", currentAsset.id);

      if (updateError) {
        console.error("Set hero error", updateError);
        Alert.alert("Could not set hero", updateError.message || "Please try again.");
        return;
      }

      setHeroPlacementId(photo.placement_id);
      setPhotos((prev) =>
        (prev || []).map((p) => ({
          ...p,
          isHero: !!p.placement_id && p.placement_id === photo.placement_id,
        }))
      );
    } catch (err) {
      console.error("Set hero error", err);
      Alert.alert("Error", "Could not set hero photo.");
    } finally {
      setPhotosLoading(false);
    }
  };

  /* ---------- delete photo (remove placement only) ---------- */

  const handleDeletePhoto = async (photo) => {
    if (!photo) return;

    if (!photo.fromTable || !photo.placement_id) {
      setPhotos((prev) => (prev || []).filter((p) => p.id !== photo.id && p.url !== photo.url));
      return;
    }

    Alert.alert(
      "Remove photo",
      "Remove this photo from the asset’s showcase? (It may still exist on other records.)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              setPhotosLoading(true);

              await removePlacementById(photo.placement_id);

              if (photo.isHero) {

                // remove hero flag first
              const remaining = (photos || [])
                .filter((p) => p.placement_id && p.placement_id !== photo.placement_id)
                .sort((a, b) => {
                  const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
                  const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
                  return bT - aT;
                });

              const nextHero = remaining[0] || null;

              await supabase
                .from("assets")
                .update({
                  hero_placement_id: nextHero?.placement_id || null,
                })
                .eq("id", currentAsset.id);

              setHeroPlacementId(nextHero?.placement_id || null);
                return;
              }

              await loadPhotos({ useFallback: true });
            } catch (err) {
              console.error("Delete asset showcase photo error", err);
              Alert.alert("Error", "Could not remove photo. Please try again.");
            } finally {
              setPhotosLoading(false);
            }
          },
        },
      ]
    );
  };

  const columns = useMemo(() => {
    const next = Array.from({ length: numColumns }, () => []);
    (photos || []).forEach((photo, index) => {
      next[index % numColumns].push(photo);
    });
    return next;
  }, [photos, numColumns]);

  /* ---------- guards ---------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm }}>Loading asset…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading asset: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentAsset) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center" }}>
            You don’t have any assets set up yet.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasGallery = photos && photos.length > 0;

  const assetDisplayName =
    currentAsset.name ||
    [currentAsset.year, currentAsset.make, currentAsset.model]
      .filter(Boolean)
      .join(" ") ||
    "My asset";

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>{assetDisplayName} Showcase</Text>
            <Text style={styles.appSubtitle}>
              Photos that show condition, provenance, and what makes this asset worth keeping.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.addPhotoButton}
            onPress={handleAddPhoto}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={16} style={styles.addPhotoIcon} />
            <Text style={styles.addPhotoText}>Add photo</Text>
          </TouchableOpacity>
        </View>

        {/* Asset label */}
        <View style={styles.assetLabelRow}>
          <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.assetLabelText} numberOfLines={1}>
            {assetDisplayName}
          </Text>
          {currentAsset.location ? (
            <Text style={styles.assetLabelMeta} numberOfLines={1}>
              {" · "}
              {currentAsset.location}
            </Text>
          ) : null}
        </View>

        {/* Quick actions */}
        <View style={styles.quickActionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsScroll}
          >
            <QuickActionChip icon="images-outline" label="Showcase" isPrimary onPress={() => {}} />
            <QuickActionChip icon="book-outline" label="Story" onPress={goToAssetStory} />
            <QuickActionChip icon="grid-outline" label="Systems (soon)" onPress={goToAssetSystems} />
            <QuickActionChip icon="hammer-outline" label="Add to Timeline" onPress={goToAddTimelineRecord} />
            <QuickActionChip icon="create-outline" label="Edit asset" onPress={goToEditAsset} />
          </ScrollView>
        </View>

        {/* Blurb */}
        <View style={styles.blurbCard}>
          <Text style={styles.blurbText}>
            Curate the photos that show condition, provenance, details, and the reasons this
            asset is worth keeping.
          </Text>
        </View>

        <ShowcaseAttachmentsSection
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

        {/* Gallery */}
        <Text style={styles.galleryHeading}>Gallery</Text>
        {photosLoading && !hasGallery ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Text style={{ marginTop: spacing.sm }}>Loading photos…</Text>
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
                      onPress={() => openLightboxForPhoto(photo)}
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
              No showcase photos yet. Add photos that help tell this asset’s story.
            </Text>
          </View>
        )}

        {photosError && (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <Text style={{ color: "red", fontSize: 12 }}>{photosError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Lightbox */}
      <LightboxModal
        visible={lightboxVisible}
        photos={allPhotos}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxVisible(false)}
      />
    </SafeAreaView>
  );
}

/* ======================== STYLES ======================== */

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  appTitle: { ...typography.title },
  appSubtitle: { ...typography.subtitle, marginTop: 2 },

  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  addPhotoIcon: { marginRight: 4, color: colors.textSecondary },
  addPhotoText: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },

  assetLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  assetLabelText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    marginLeft: spacing.xs,
  },
  assetLabelMeta: { fontSize: 12, color: colors.textSecondary },

  quickActionsRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  quickActionsScroll: { paddingVertical: 2 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.xs,
  },
  chipPrimary: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },
  chipLabelPrimary: { color: "white" },

  blurbCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  blurbText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },

  galleryHeading: {
  marginHorizontal: spacing.lg,
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
  fontSize: 18,
  fontWeight: "900",
  color: colors.textPrimary,
},

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
    backgroundColor: colors.surfaceSubtle,
    ...shadows.subtle,
  },
  tileImage: {
    width: "100%",
    aspectRatio: TILE_ASPECT,
    backgroundColor: colors.surface,
  },

  heroBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827CC",
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  heroBadgeIcon: { color: colors.brandWhite, marginRight: 3 },
  heroBadgeText: { fontSize: 10, color: colors.brandWhite, fontWeight: "700" },

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
    backgroundColor: "rgba(45, 124, 227, 0.6)",
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
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
  },
  emptyTitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
});
