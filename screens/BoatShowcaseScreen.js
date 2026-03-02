// screens/BoatShowcaseScreen.js
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
import { colors, spacing, radius, typography, shadows } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import {
  listAttachmentsForTarget,
  getSignedUrl,
  removePlacementById,
} from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

const TILE_ASPECT = 4 / 3;

// Small reusable chip for quick actions (nav only)
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

async function ensurePermission() {
  if (Platform.OS === "web") return true;

  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    Alert.alert(
      "Permission needed",
      "We need access to your photos to add pictures of your boat."
    );
    return false;
  }
  return true;
}

function buildFallbackGallery(asset) {
  if (!asset) return [];

  const gallery = [];

  // Legacy fallback (non-placement)
  if (asset.hero_image_url) {
    gallery.push({
      id: "hero",
      url: asset.hero_image_url,
      isHero: true,
      fromTable: false,
      placement_id: null,
    });
  }

  if (Array.isArray(asset.photo_urls)) {
    asset.photo_urls.forEach((u, idx) => {
      if (!u) return;
      if (u === asset.hero_image_url) return;
      gallery.push({
        id: `legacy-url-${idx}`,
        url: u,
        isHero: false,
        fromTable: false,
        placement_id: null,
      });
    });
  } else if (Array.isArray(asset.photos)) {
    asset.photos.forEach((u, idx) => {
      if (!u) return;
      if (u === asset.hero_image_url) return;
      gallery.push({
        id: `legacy-photo-${idx}`,
        url: u,
        isHero: false,
        fromTable: false,
        placement_id: null,
      });
    });
  }

  return gallery;
}

// Persist legacy delete + hero for fallback items
async function persistLegacyRemoveFromAsset(assetId, url) {
  if (!assetId || !url) return;

  const { data, error } = await supabase
    .from("assets")
    .select("hero_image_url, photo_urls, photos")
    .eq("id", assetId)
    .maybeSingle();

  if (error) throw error;

  const next = {};

  if (data?.hero_image_url === url) {
    next.hero_image_url = null;
  }

  if (Array.isArray(data?.photo_urls)) {
    next.photo_urls = data.photo_urls.filter((u) => u && u !== url);
  }
  if (Array.isArray(data?.photos)) {
    next.photos = data.photos.filter((u) => u && u !== url);
  }

  // If nothing to update, bail quietly
  const keys = Object.keys(next);
  if (!keys.length) return;

  const { error: updErr } = await supabase.from("assets").update(next).eq("id", assetId);
  if (updErr) throw updErr;
}

async function persistLegacySetHeroOnAsset(assetId, url) {
  if (!assetId || !url) return;
  const { error } = await supabase
    .from("assets")
    .update({ hero_image_url: url, hero_placement_id: null })
    .eq("id", assetId);
  if (error) throw error;
}

export default function BoatShowcaseScreen({ navigation, route }) {
  const boatId = route?.params?.boatId ?? null;

  const { assets: boats = [], loading, error } = useAssets("boat");

  const currentBoat = useMemo(() => {
    if (!boats || boats.length === 0) return null;
    if (!boatId) return boats[0];
    return boats.find((b) => b.id === boatId) || boats[0] || null;
  }, [boats, boatId]);

  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);

  // ✅ Persistent hero: assets.hero_placement_id (NOT a URL)
  const [heroPlacementId, setHeroPlacementId] = useState(
    currentBoat?.hero_placement_id || null
  );

  useEffect(() => {
    setHeroPlacementId(currentBoat?.hero_placement_id || null);
  }, [currentBoat?.hero_placement_id]);

  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxStartIndex, setLightboxStartIndex] = useState(0);

  const { width, height } = useWindowDimensions();
  const numColumns = width >= 1200 ? 3 : width >= 768 ? 2 : 1;

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Boat");
  };

  // --- Navigation helpers ---

  const goToBoatStory = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatStory", { boatId: currentBoat.id });
  };

  const goToBoatSystems = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatSystems", {
      boatId: currentBoat.id,
      boatName: currentBoat.name || "Boat",
    });
  };

  const goToAddServiceRecord = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("AddServiceRecord", {
      source: "boat",
      assetId: currentBoat.id,
      boatId: currentBoat.id,
      assetName: currentBoat.name,
    });
  };

  const goToEditBoat = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("EditAsset", { assetId: currentBoat.id });
  };

  // Pull the latest hero_placement_id from DB so we don’t rely on stale context
  const refreshHeroPlacementId = useCallback(async () => {
    if (!currentBoat?.id) return null;

    const { data, error: err } = await supabase
      .from("assets")
      .select("hero_placement_id")
      .eq("id", currentBoat.id)
      .maybeSingle();

    if (err) {
      console.log("BoatShowcase refresh hero_placement_id error", err);
      return null;
    }

    const next = data?.hero_placement_id ?? null;
    setHeroPlacementId(next);
    return next;
  }, [currentBoat?.id]);

  /* ---------- load showcase photos from attachments (is_showcase = true) ---------- */

  const loadPhotos = useCallback(
    async (opts = { useFallback: true }) => {
      if (!currentBoat?.id) {
        setPhotos([]);
        return;
      }

      setPhotosLoading(true);
      setPhotosError(null);

      try {
        const latestHero = await refreshHeroPlacementId();
        const effectiveHero = latestHero ?? heroPlacementId ?? null;

        const rows = await listAttachmentsForTarget("asset", currentBoat.id);

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
            ["jpg", "jpeg", "png", "webp", "heic"].includes(ext);

          if (!looksLikeImage) continue;

          let url = row.url || null;
          if (!url && row.bucket && row.storage_path) {
            try {
              url = await getSignedUrl({
                bucket: row.bucket,
                path: row.storage_path,
              });
            } catch (e) {
              console.log("BoatShowcase getSignedUrl error", e);
            }
          }

          if (!url) continue;

          gallery.push({
            id: row.placement_id || row.attachment_id || row.id,
            url,
            placement_id: row.placement_id,
            storage_path: row.storage_path,
            bucket: row.bucket,
            created_at: row.created_at,
            // ✅ hero by placement id (persistent)
            isHero: effectiveHero ? effectiveHero === row.placement_id : false,
            fromTable: true,
          });
        }

        // Newest first
        gallery.sort((a, b) => {
          const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bT - aT;
        });

        // ✅ AUTO HERO: if exactly 1 showcase photo and no hero_placement_id, persist it
        if (!effectiveHero && gallery.length === 1 && gallery[0]?.placement_id) {
          try {
            const only = gallery[0];
            const { error: promoteErr } = await supabase
              .from("assets")
              .update({ hero_placement_id: only.placement_id, hero_image_url: null })
              .eq("id", currentBoat.id);

            if (!promoteErr) {
              setHeroPlacementId(only.placement_id);
              only.isHero = true; // immediate UI feedback
            } else {
              console.log("BoatShowcase auto-hero promote error", promoteErr);
            }
          } catch (e) {
            console.log("BoatShowcase auto-hero promote exception", e);
          }
        } else if ((effectiveHero || heroPlacementId) && gallery.length) {
          const heroId = effectiveHero || heroPlacementId;
          gallery.forEach((p) => {
            p.isHero = !!p.placement_id && p.placement_id === heroId;
          });
        }

        if (!gallery.length && opts.useFallback) {
          setPhotos(buildFallbackGallery(currentBoat));
        } else {
          setPhotos(gallery);
        }
      } catch (e) {
        console.error("Error loading boat showcase attachments", e);
        setPhotosError("Could not load photos.");
        if (opts.useFallback) {
          setPhotos(buildFallbackGallery(currentBoat));
        }
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentBoat, heroPlacementId, refreshHeroPlacementId]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = async () => {
        if (!active) return;
        if (!currentBoat?.id) return;
        await loadPhotos({ useFallback: true });
      };
      run();
      return () => {
        active = false;
      };
    }, [currentBoat?.id, loadPhotos])
  );

  /* ---------- add photo (attachments pipeline, is_showcase = true) ---------- */

  const handleAddPhoto = useCallback(async () => {
    if (!currentBoat?.id) return;

    const ok = await ensurePermission();
    if (!ok) return;

    try {
      const pickerMediaTypes =
        ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: pickerMediaTypes,
        quality: 0.9,
        selectionLimit: 1,
      });

      if (result.canceled) return;

      const picked = result.assets?.[0];
      if (!picked?.uri) return;

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
        `boat-${currentBoat.id}-${Date.now()}.jpg`;

      await uploadAttachmentFromUri({
        userId,
        assetId: currentBoat.id,
        kind: "photo",
        fileUri: picked.uri,
        fileName,
        mimeType: picked.mimeType || "image/jpeg",
        sizeBytes: picked.fileSize || null,
        placements: [
          {
            target_type: "asset",
            target_id: currentBoat.id,
            role: "showcase",
            is_showcase: true,
          },
        ],
        source_context: {
          origin: "boat_showcase",
          asset_id: currentBoat.id,
        },
      });

      // loadPhotos will auto-promote to hero if it's the only showcase photo
      await loadPhotos({ useFallback: false });
    } catch (err) {
      console.error("Add boat showcase photo error", err);
      Alert.alert("Error", "Something went wrong adding this photo.");
      setPhotosError("Could not save photo.");
    } finally {
      setPhotosLoading(false);
    }
  }, [currentBoat, loadPhotos]);

  /* ---------- set hero (assets.hero_placement_id) ---------- */

  const handleSetHero = useCallback(
    async (photo) => {
      if (!currentBoat?.id || !photo) return;

      // Preferred: placement hero
      if (photo?.placement_id) {
        try {
          setPhotosLoading(true);

          const { error: updateError } = await supabase
            .from("assets")
            .update({ hero_placement_id: photo.placement_id, hero_image_url: null })
            .eq("id", currentBoat.id);

          if (updateError) {
            console.error("Error updating hero_placement_id", updateError);
            Alert.alert(
              "Could not set hero",
              updateError.message || "Please try again."
            );
            return;
          }

          setHeroPlacementId(photo.placement_id);
          setPhotos((prev) =>
            (prev || []).map((p) => ({
              ...p,
              isHero: p.placement_id === photo.placement_id,
            }))
          );
          return;
        } catch (e) {
          console.error("Set hero error", e);
          Alert.alert("Could not set hero", e?.message || "Please try again.");
          return;
        } finally {
          setPhotosLoading(false);
        }
      }

      // Legacy fallback: persist hero_image_url (so old assets aren't “stuck”)
      try {
        setPhotosLoading(true);
        await persistLegacySetHeroOnAsset(currentBoat.id, photo.url);

        setHeroPlacementId(null);
        setPhotos((prev) =>
          (prev || []).map((p) => ({
            ...p,
            isHero: p.url === photo.url,
          }))
        );
      } catch (e) {
        console.error("Legacy set hero error", e);
        Alert.alert("Could not set hero", e?.message || "Please try again.");
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentBoat]
  );

  /* ---------- remove from showcase (remove placement) ---------- */

  const handleDeletePhoto = useCallback(
    async (photo) => {
      if (!photo) return;

      // Legacy fallback: persist removal from asset fields
      if (!photo.fromTable || !photo.placement_id) {
        const performLegacyRemove = async () => {
          try {
            setPhotosLoading(true);
            await persistLegacyRemoveFromAsset(currentBoat.id, photo.url);
            setPhotos((prev) =>
              (prev || []).filter((p) => p.id !== photo.id && p.url !== photo.url)
            );
          } catch (e) {
            console.error("Legacy remove error", e);
            Alert.alert("Could not remove", e?.message || "Please try again.");
          } finally {
            setPhotosLoading(false);
          }
        };

        if (Platform.OS === "web") {
          // eslint-disable-next-line no-undef
          const confirmed = window.confirm("Remove this photo?");
          if (confirmed) await performLegacyRemove();
          return;
        }

        Alert.alert("Remove photo", "Remove this photo?", [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: performLegacyRemove },
        ]);
        return;
      }

      const performRemove = async () => {
        try {
          setPhotosLoading(true);
          await removePlacementById(photo.placement_id);

          // If we removed the hero photo from showcase, clear hero_placement_id
          if (photo.isHero) {
            await supabase
              .from("assets")
              .update({ hero_placement_id: null })
              .eq("id", currentBoat.id);
            setHeroPlacementId(null);
          }

          await loadPhotos({ useFallback: true });
        } catch (e) {
          console.error("Error removing boat showcase placement", e);
          Alert.alert("Could not remove", e?.message || "Please try again.");
        } finally {
          setPhotosLoading(false);
        }
      };

      if (Platform.OS === "web") {
        // eslint-disable-next-line no-undef
        const confirmed = window.confirm(
          "Remove this photo from the boat’s showcase? (It may still exist on other records.)"
        );
        if (confirmed) await performRemove();
        return;
      }

      Alert.alert(
        "Remove photo",
        "Remove this photo from the boat’s showcase? (It may still exist on other records.)",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: performRemove },
        ]
      );
    },
    [currentBoat?.id, loadPhotos]
  );

  /* ---------- lightbox ---------- */

  const openLightbox = (photo) => {
    if (!photo?.url) return;

    const idx = photos.findIndex((p) => p.id === photo.id || p.url === photo.url);
    setLightboxStartIndex(idx >= 0 ? idx : 0);
    setLightboxVisible(true);
  };

  const closeLightbox = () => {
    setLightboxVisible(false);
    setLightboxStartIndex(0);
  };

  /* ---------- guards ---------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8 }}>Loading boat…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading boats: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentBoat) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center" }}>
            You don’t have any boats set up yet.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasGallery = photos && photos.length > 0;

  const columns = Array.from({ length: numColumns }, () => []);
  if (hasGallery) {
    photos.forEach((photo, index) => {
      columns[index % numColumns].push(photo);
    });
  }

  const boatDisplayName =
    currentBoat.name ||
    [currentBoat.year, currentBoat.make, currentBoat.model]
      .filter(Boolean)
      .join(" ") ||
    "My boat";

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>{boatDisplayName} Showcase</Text>
            <Text style={styles.appSubtitle}>
              Perfect when a friend asks, “So tell me about the boat?”
            </Text>
          </View>

          <TouchableOpacity
            style={styles.addPhotoButton}
            onPress={handleAddPhoto}
            activeOpacity={0.85}
            disabled={photosLoading}
          >
            <Ionicons
              name="add-circle-outline"
              size={16}
              style={styles.addPhotoIcon}
            />
            <Text style={styles.addPhotoText}>Add photo</Text>
          </TouchableOpacity>
        </View>

        {/* Boat row */}
        <View style={styles.boatRow}>
          <View style={styles.boatLabelRow}>
            <Ionicons name="boat-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.boatLabelText} numberOfLines={1}>
              {boatDisplayName}
            </Text>
            {currentBoat.location ? (
              <Text style={styles.boatLabelMeta} numberOfLines={1}>
                {" · "}
                {currentBoat.location}
              </Text>
            ) : null}
          </View>
        </View>

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
            <QuickActionChip icon="book-outline" label="Story" onPress={goToBoatStory} />
            <QuickActionChip icon="grid-outline" label="Systems" onPress={goToBoatSystems} />
            <QuickActionChip
              icon="hammer-outline"
              label="Add service"
              onPress={goToAddServiceRecord}
            />
            <QuickActionChip icon="create-outline" label="Edit boat" onPress={goToEditBoat} />
          </ScrollView>
        </View>

        {/* Blurb */}
        <View style={styles.blurbCard}>
          <Text style={styles.blurbText}>
            Use this screen as your “humble brag” — photos plus a full service history in Keepr
            make it easy to show off condition, upgrades, and how well it’s been maintained.
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
                style={[
                  styles.gridColumn,
                  colIndex > 0 && styles.gridColumnSpacer,
                ]}
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
                      <Image
                        source={{ uri: photo.url }}
                        style={styles.tileImage}
                        resizeMode="cover"
                      />

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
              Add a photo of this boat to create a curated showcase. Proof photos (engine serials,
              bilge, etc.) still live in Attachments, but only the curated set appears here.
            </Text>
          </View>
        )}

        {photosError && (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <Text style={{ color: "red", fontSize: 12 }}>{photosError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Lightbox modal with horizontal swipe */}
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
                <View
                  key={p.id || p.url}
                  style={[styles.lightboxPage, { width, height }]}
                >
                  {p.url && (
                    <Image
                      source={{ uri: p.url }}
                      style={styles.lightboxImage}
                      resizeMode="contain"
                    />
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
  appTitle: {
    ...typography.title,
  },
  appSubtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    marginLeft: spacing.sm,
  },
  addPhotoIcon: {
    marginRight: 4,
    color: colors.textSecondary,
  },
  addPhotoText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "500",
  },

  boatRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  boatLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  boatLabelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginLeft: spacing.xs,
  },
  boatLabelMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  quickActionsRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  quickActionsScroll: {
    paddingVertical: 2,
  },
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
  chipPrimary: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  chipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  chipLabelPrimary: {
    color: "white",
  },

  blurbCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  blurbText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  gridRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
  },
  gridColumn: {
    flex: 1,
  },
  gridColumnSpacer: {
    marginLeft: spacing.sm,
  },

  tile: {
    width: "100%",
    aspectRatio: TILE_ASPECT,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
    ...shadows.subtle,
    position: "relative",
  },
  tileImage: {
    width: "100%",
    height: "100%",
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
  heroBadgeIcon: {
    color: colors.brandWhite,
    marginRight: 3,
  },
  heroBadgeText: {
    fontSize: 10,
    color: colors.brandWhite,
    fontWeight: "600",
  },

  tileActionsRow: {
    position: "absolute",
    bottom: 6,
    left: 6,
    right: 6,
    flexDirection: "row",
    justifyContent: "space-between",
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
    fontWeight: "600",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },

  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxInner: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  lightboxScroll: {
    flex: 1,
  },
  lightboxPage: {
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxImage: {
    width: "90%",
    height: "80%",
  },
  lightboxClose: {
    position: "absolute",
    top: 40,
    right: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0F172ACC",
    justifyContent: "center",
    alignItems: "center",
  },
});
