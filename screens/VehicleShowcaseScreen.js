// screens/VehicleShowcaseScreen.js
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

import {
  listAttachmentsForTarget,
  getSignedUrl,
  removePlacementById,
} from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

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

export default function VehicleShowcaseScreen({ navigation, route }) {
  const vehicleId = route?.params?.vehicleId ?? null;

  const { assets: vehicles = [], loading, error } = useAssets("vehicle");

  const currentVehicle = useMemo(() => {
    if (!vehicles || vehicles.length === 0) return null;
    if (!vehicleId) return vehicles[0];
    return vehicles.find((v) => v.id === vehicleId) || vehicles[0] || null;
  }, [vehicles, vehicleId]);

  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);

  // Lightbox state
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Masonry columns
  const [leftColumn, setLeftColumn] = useState([]);
  const [rightColumn, setRightColumn] = useState([]);

  // ✅ hero persistence: use assets.hero_placement_id
  const [heroPlacementId, setHeroPlacementId] = useState(
    currentVehicle?.hero_placement_id || null
  );

  useEffect(() => {
    setHeroPlacementId(currentVehicle?.hero_placement_id || null);
  }, [currentVehicle?.hero_placement_id]);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Garage");
  };

  /* ---------- navigation helpers ---------- */

  const goToVehicleStory = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("VehicleStory", { vehicleId: currentVehicle.id });
  };

  const goToVehicleSystems = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("VehicleSystems", {
      vehicleId: currentVehicle.id,
      vehicleName: currentVehicle.name || "Vehicle",
    });
  };

  const goToAddServiceRecord = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("AddServiceRecord", {
      source: "vehicle",
      assetId: currentVehicle.id,
      vehicleId: currentVehicle.id,
      assetName: currentVehicle.name,
    });
  };

  const goToEditVehicle = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("EditAsset", { assetId: currentVehicle.id });
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
      if (!currentVehicle?.id) {
        setPhotos([]);
        return;
      }

      setPhotosLoading(true);
      setPhotosError(null);

      try {
        const rows = await listAttachmentsForTarget("asset", currentVehicle.id);

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
              console.log("VehicleShowcase getSignedUrl error", e);
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
              .eq("id", currentVehicle.id);

            if (!promoteErr) {
              setHeroPlacementId(only.placement_id);
              only.isHero = true; // immediate UI feedback
            } else {
              console.log("VehicleShowcase auto-hero promote error", promoteErr);
            }
          } catch (e) {
            console.log("VehicleShowcase auto-hero promote exception", e);
          }
        } else if (heroPlacementId && gallery.length) {
          // Keep hero flag accurate even if state changed between loads
          const heroId = heroPlacementId;
          gallery.forEach((p) => {
            p.isHero = !!p.placement_id && p.placement_id === heroId;
          });
        }

        if (!gallery.length && opts.useFallback) {
          setPhotos(buildFallbackGallery(currentVehicle));
        } else {
          setPhotos(gallery);
        }
      } catch (e) {
        console.error("Error loading vehicle showcase attachments", e);
        setPhotosError("Could not load photos.");
        if (opts.useFallback) setPhotos(buildFallbackGallery(currentVehicle));
      } finally {
        setPhotosLoading(false);
      }
    },
    [currentVehicle?.id, heroPlacementId]
  );

  useFocusEffect(
    useCallback(() => {
      if (!currentVehicle?.id) return;
      loadPhotos({ useFallback: true });
    }, [currentVehicle?.id, loadPhotos])
  );

  /* ---------- measure + masonry columns ---------- */

  useEffect(() => {
    if (!photos || photos.length === 0) {
      setLeftColumn([]);
      setRightColumn([]);
      return;
    }

    let isCancelled = false;

    const measureAndDistribute = async () => {
      const measured = await Promise.all(
        photos.map(
          (p) =>
            new Promise((resolve) => {
              if (!p.url) return resolve({ ...p, aspect: 4 / 3 });

              Image.getSize(
                p.url,
                (w, h) => {
                  const rawAspect = h && w ? h / w : 4 / 3;
                  const isPortrait = rawAspect > 1;
                  const displayAspect = isPortrait ? 3 / 4 : 4 / 3;
                  resolve({ ...p, aspect: displayAspect });
                },
                () => resolve({ ...p, aspect: 4 / 3 })
              );
            })
        )
      );

      if (isCancelled) return;

      const left = [];
      const right = [];
      let leftHeight = 0;
      let rightHeight = 0;

      measured.forEach((p) => {
        if (leftHeight <= rightHeight) {
          left.push(p);
          leftHeight += p.aspect;
        } else {
          right.push(p);
          rightHeight += p.aspect;
        }
      });

      setLeftColumn(left);
      setRightColumn(right);
    };

    measureAndDistribute();

    return () => {
      isCancelled = true;
    };
  }, [photos]);

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
        "We need access to your photos to add pictures of your vehicle."
      );
      return false;
    }
    return true;
  };

  /* ---------- add photo (attachments pipeline, is_showcase = true) ---------- */

  const handleAddPhoto = async () => {
    if (!currentVehicle?.id) return;
    const ok = await ensurePermission();
    if (!ok) return;

    const pickerMediaTypes =
      ImagePicker.MediaType?.Images ||
      ImagePicker.MediaTypeOptions?.Images ||
      "images";

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: pickerMediaTypes,
      quality: 0.9,
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
        `vehicle-${currentVehicle.id}-${Date.now()}.jpg`;

      await uploadAttachmentFromUri({
        userId,
        assetId: currentVehicle.id,
        kind: "photo",
        fileUri: picked.uri,
        fileName,
        mimeType: picked.mimeType || "image/jpeg",
        sizeBytes: picked.fileSize || null,
        placements: [
          {
            target_type: "asset",
            target_id: currentVehicle.id,
            role: "showcase",
            is_showcase: true,
          },
        ],
        source_context: {
          origin: "vehicle_showcase",
          asset_id: currentVehicle.id,
        },
      });

      // loadPhotos now auto-promotes to hero when it's the only photo
      await loadPhotos({ useFallback: false });
    } catch (err) {
      console.error("Add vehicle showcase photo error", err);
      Alert.alert("Error", "Something went wrong adding this photo.");
      setPhotosError("Could not save photo.");
    } finally {
      setPhotosLoading(false);
    }
  };

  /* ---------- set hero (assets.hero_placement_id) ---------- */

  const handleSetHero = async (photo) => {
    if (!currentVehicle?.id) return;

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
        .eq("id", currentVehicle.id);

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
      "Remove this photo from the vehicle’s showcase? (It may still exist on other records.)",
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
                await supabase
                  .from("assets")
                  .update({ hero_placement_id: null })
                  .eq("id", currentVehicle.id);

                setHeroPlacementId(null);
              }

              await loadPhotos({ useFallback: true });
            } catch (err) {
              console.error("Delete vehicle showcase photo error", err);
              Alert.alert("Error", "Could not remove photo. Please try again.");
            } finally {
              setPhotosLoading(false);
            }
          },
        },
      ]
    );
  };

  /* ---------- guards ---------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm }}>Loading vehicle…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading vehicle: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentVehicle) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center" }}>
            You don’t have any vehicles set up yet.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasGallery = photos && photos.length > 0;

  /* ---------- render helpers ---------- */

  const renderTile = (photo) => {
    if (!photo.url) return null;

    const showActions = true;// only for real placements
    const aspect = photo.aspect || 4 / 3;

    return (
      <View key={photo.id || photo.url} style={styles.tile}>
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={0.9}
          onPress={() => openLightboxForPhoto(photo)}
        >
          <Image
            source={{ uri: photo.url }}
            style={[styles.tileImage, { aspectRatio: aspect }]}
            resizeMode="cover"
          />
        </TouchableOpacity>

        {photo.isHero && (
          <View style={styles.heroBadge}>
            <Ionicons name="star" size={11} style={styles.heroBadgeIcon} />
            <Text style={styles.heroBadgeText}>Hero photo</Text>
          </View>
        )}

        {showActions && (
          <View style={styles.tileActionsRow}>
            <TouchableOpacity
              style={styles.tileActionButton}
              onPress={() => handleSetHero(photo)}
              activeOpacity={0.85}
            >
              <Text style={styles.tileActionText}>Set as hero</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tileActionButtonDanger}
              onPress={() => handleDeletePhoto(photo)}
              activeOpacity={0.85}
            >
              <Text style={styles.tileActionText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const vehicleDisplayName =
    currentVehicle.name ||
    [currentVehicle.year, currentVehicle.make, currentVehicle.model]
      .filter(Boolean)
      .join(" ") ||
    "My vehicle";

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>{vehicleDisplayName} Showcase</Text>
            <Text style={styles.appSubtitle}>
              Perfect when a friend asks, “So tell me about the car?”
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

        {/* Vehicle label */}
        <View style={styles.vehicleLabelRow}>
          <Ionicons name="car-sport-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.vehicleLabelText} numberOfLines={1}>
            {vehicleDisplayName}
          </Text>
          {currentVehicle.location ? (
            <Text style={styles.vehicleLabelMeta} numberOfLines={1}>
              {" · "}
              {currentVehicle.location}
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
            <QuickActionChip icon="book-outline" label="Story" onPress={goToVehicleStory} />
            <QuickActionChip icon="grid-outline" label="Systems" onPress={goToVehicleSystems} />
            <QuickActionChip icon="hammer-outline" label="Add service" onPress={goToAddServiceRecord} />
            <QuickActionChip icon="create-outline" label="Edit vehicle" onPress={goToEditVehicle} />
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
            <Text style={{ marginTop: spacing.sm }}>Loading photos…</Text>
          </View>
        ) : hasGallery ? (
          <View style={styles.masonryRow}>
            <View style={styles.masonryColumn}>{leftColumn.map(renderTile)}</View>
            <View style={styles.masonryColumn}>{rightColumn.map(renderTile)}</View>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="images-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No showcase photos yet</Text>
            <Text style={styles.emptyText}>
              Add a photo of this vehicle to create a curated showcase. Only the curated set appears here.
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

  vehicleLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  vehicleLabelText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    marginLeft: spacing.xs,
  },
  vehicleLabelMeta: { fontSize: 12, color: colors.textSecondary },

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

  masonryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  masonryColumn: { width: "48%" },

  tile: {
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
    ...shadows.subtle,
    position: "relative",
  },
  tileImage: {
    width: "100%",
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
