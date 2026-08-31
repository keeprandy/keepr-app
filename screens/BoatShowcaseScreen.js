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
  listAttachmentsForAsset,
  getSignedUrl,
  removePlacementById,
} from "../lib/attachmentsApi";
import { getKeeprSpacePortfolio, setKeeprSpaceAssetHero } from "../lib/keeprspaceApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { buildServiceActionRouteParams } from "../lib/serviceActionPrefill";
import LightboxModal from "../components/LightboxModal";
import ShowcaseAttachmentsSection from "../components/showcase/ShowcaseAttachmentsSection";
import { MEDIA_VARIANTS, getAttachmentVariantUrl } from "../lib/mediaVariants";

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

function isImageAttachment(row = {}) {
  const kind = row.kind || "";
  const mime = String(row.mime_type || "").toLowerCase();
  const fileName = row.file_name || row.storage_path || "";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  return (
    kind === "photo" ||
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)
  );
}

function showcaseLayerFor(row = {}) {
  if (row.is_inherited_model_media) {
    return {
      key: "oem",
      label: "OEM model media",
      detail: "Inherited from the bound model template",
    };
  }

  const provenance = String(row.source_context?.provenance || "").toLowerCase();
  if (provenance.includes("owner")) {
    return {
      key: "owner",
      label: "Owner media",
      detail: "Contributed to this KAC by the owner",
    };
  }
  if (provenance.includes("dealer") || row.org_id) {
    return {
      key: "dealer",
      label: "Dealer media",
      detail: "Contributed to this exact KAC",
    };
  }
  return {
    key: "kac",
    label: "KAC media",
    detail: "Contributed to this exact KAC",
  };
}

function showcaseLayerSummary(photos = []) {
  const layers = [
    ["oem", "OEM"],
    ["dealer", "Dealer"],
    ["owner", "Owner"],
    ["kac", "KAC"],
  ];
  return layers
    .map(([key, label]) => {
      const count = photos.filter((photo) => photo.layer_key === key).length;
      return count ? { key, label, count } : null;
    })
    .filter(Boolean);
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
  const boatId = route?.params?.boatId ?? route?.params?.assetId ?? null;
  const routeOrganizationId = route?.params?.organizationId || null;
  const routeWorkspaceId = route?.params?.workspaceId || null;
  const routeKac = route?.params?.kac || null;
  const relationshipRole = route?.params?.relationshipRole || null;
  const teamMemberType = route?.params?.teamMemberType || null;
  const systemsRole = route?.params?.systemsRole || null;
  const parentRoute = route?.params?.parentRoute || null;
  const returnRoute = route?.params?.returnRoute || null;

  const { assets: boats = [], loading, error } = useAssets("boat");
  const [routeBoatSnapshot, setRouteBoatSnapshot] = useState(null);
  const [routeBoatLoading, setRouteBoatLoading] = useState(!!boatId);

  const currentBoat = useMemo(() => {
    const personalBoats = Array.isArray(boats) ? boats : [];
    if (!boatId) return personalBoats[0] || null;
    return (
      personalBoats.find((b) => b.id === boatId) ||
      (routeBoatSnapshot?.id === boatId ? routeBoatSnapshot : null)
    );
  }, [boats, boatId, routeBoatSnapshot]);

  useEffect(() => {
    let cancelled = false;

    async function loadRouteBoat() {
      if (!boatId) {
        setRouteBoatSnapshot(null);
        setRouteBoatLoading(false);
        return;
      }

      const personalBoats = Array.isArray(boats) ? boats : [];
      if (personalBoats.some((b) => b.id === boatId)) {
        setRouteBoatSnapshot(null);
        setRouteBoatLoading(false);
        return;
      }

      setRouteBoatLoading(true);

      const { data, error: fetchError } = await supabase
        .from("assets")
        .select("*")
        .eq("id", boatId)
        .maybeSingle();
      let resolved = data || null;

      if (!resolved && routeOrganizationId) {
        try {
          const portfolio = await getKeeprSpacePortfolio({
            organizationId: routeOrganizationId,
            search: routeKac || boatId,
            limit: 100,
            offset: 0,
          });
          const match = (portfolio?.boats || []).find((item) => {
            const assetId = item?.asset_id || item?.asset?.id || item?.id;
            return assetId === boatId;
          });
          const identity = match?.identity || {};
          const asset = match?.asset || {};
          if (match) {
            resolved = {
              ...asset,
              id: match.asset_id || asset.id || match.id || boatId,
              name:
                asset.name ||
                match.asset_name ||
                match.name ||
                route?.params?.assetName ||
                "Boat",
              type: asset.type || "boat",
              kac_id: asset.kac_id || match.kac_id || routeKac || null,
              year: asset.year || identity.year || null,
              make: asset.make || identity.make || null,
              model: asset.model || identity.model || null,
              serial_number:
                asset.serial_number ||
                identity.hin ||
                identity.serial_number ||
                null,
              hin: asset.hin || identity.hin || null,
              location:
                asset.location ||
                match?.dealer_relationship?.location_name ||
                match?.service_relationship?.location_name ||
                null,
              hero_image_url:
                asset.hero_image_url ||
                match?.hero_image_url ||
                match?.hero?.url ||
                null,
            };
          }
        } catch (portfolioError) {
          console.log("BoatShowcase portfolio route asset load error", portfolioError);
        }
      }

      if (!resolved) {
        resolved = {
          id: boatId,
          name: route?.params?.assetName || "Boat",
          type: "boat",
          kac_id: routeKac,
        };
      }

      if (!cancelled) {
        if (fetchError && !resolved) {
          console.log("BoatShowcase route asset load error", fetchError);
          setRouteBoatSnapshot(null);
        } else {
          setRouteBoatSnapshot(resolved || null);
        }
        setRouteBoatLoading(false);
      }
    }

    loadRouteBoat();

    return () => {
      cancelled = true;
    };
  }, [boats, boatId, route?.params?.assetName, routeKac, routeOrganizationId]);

  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);

  const [showcaseFiles, setShowcaseFiles] = useState([]);
const [showcaseLinks, setShowcaseLinks] = useState([]);

  // ✅ Persistent hero: assets.hero_placement_id (NOT a URL)
  const [heroPlacementId, setHeroPlacementId] = useState(
    currentBoat?.hero_placement_id || null
  );

  useEffect(() => {
    setHeroPlacementId(currentBoat?.hero_placement_id || null);
  }, [currentBoat?.hero_placement_id]);

  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const { width, height } = useWindowDimensions();
  const numColumns = width >= 1200 ? 3 : width >= 768 ? 2 : 1;

  const routeContext = useMemo(
    () => ({
      kac: routeKac || currentBoat?.kac_id || currentBoat?.kac || null,
      organizationId: routeOrganizationId,
      workspaceId: routeWorkspaceId,
      relationshipRole,
      teamMemberType,
      systemsRole,
      parentRoute,
    }),
    [
      currentBoat?.kac,
      currentBoat?.kac_id,
      parentRoute,
      relationshipRole,
      routeKac,
      routeOrganizationId,
      routeWorkspaceId,
      systemsRole,
      teamMemberType,
    ]
  );

  const handleBack = () => {
    if (returnRoute === "BoatStory" && currentBoat?.id) {
      navigation.navigate("BoatStory", {
        boatId: currentBoat.id,
        assetId: currentBoat.id,
        ...routeContext,
      });
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Boat");
  };

  

  // --- Navigation helpers ---

  const goToBoatStory = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatStory", {
      boatId: currentBoat.id,
      assetId: currentBoat.id,
      ...routeContext,
    });
  };

  const goToBoatSystems = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatSystems", {
      boatId: currentBoat.id,
      assetId: currentBoat.id,
      boatName: currentBoat.name || "Boat",
      ...routeContext,
    });
  };

  const goToAddServiceRecord = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("CreateReminder", buildServiceActionRouteParams({
      assetId: currentBoat.id,
      assetName: currentBoat.name,
      assetType: "boat",
      sourceScreen: "boat_showcase",
    }));
  };

  const goToEditBoat = () => {
    if (!currentBoat?.id) return;
    if (routeOrganizationId) {
      navigation.navigate("KeeprSpaceBoat", {
        assetId: currentBoat.id,
        kac: routeKac || currentBoat.kac_id || currentBoat.kac || null,
        organizationId: routeOrganizationId,
        stewardshipId: route?.params?.stewardshipId || null,
        parentRoute: parentRoute || "KeeprSpaceFleet",
        workspaceId: routeWorkspaceId || (routeOrganizationId ? `org:${routeOrganizationId}` : null),
        systemsRole,
        openEdit: true,
      });
      return;
    }
    navigation.navigate("EditAsset", {
      assetId: currentBoat.id,
      ...routeContext,
    });
  };

  const goToAIContext = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("AssetAIContext", {
      assetId: currentBoat.id,
      assetName: boatDisplayName,
      assetKind: "boat",
      ...routeContext,
    });
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
          setShowcaseFiles([]);
          setShowcaseLinks([]);
          return;
        }

      setPhotosLoading(true);
      setPhotosError(null);

      try {
        const latestHero = await refreshHeroPlacementId();
        const effectiveHero = latestHero ?? heroPlacementId ?? null;

        const rows = await listAttachmentsForAsset(currentBoat.id, {
          includeInheritedModelMedia: true,
        });

        const showcased = (rows || []).filter((row) => row.is_showcase);

        setShowcaseFiles(
          showcased.filter((row) => {
            return row.kind !== "link" && !isImageAttachment(row);
          })
        );

        setShowcaseLinks(showcased.filter((row) => row.kind === "link"));

        const gallery = [];

        for (const row of rows || []) {
          if (!row.is_showcase) continue;

          if (!isImageAttachment(row)) continue;

          let url = row.url || null;
          if (!url && row.bucket && row.storage_path) {
            try {
              url = await getAttachmentVariantUrl(row, MEDIA_VARIANTS.GALLERY_TILE);
            } catch (e) {
              console.log("BoatShowcase getSignedUrl error", e);
            }
          }

          if (!url) continue;

          const layer = showcaseLayerFor(row);
          gallery.push({
            id:
              row.placement_id ||
              row.asset_placement_id ||
              row.template_placement_id ||
              row.attachment_id ||
              row.id,
            url,
            placement_id: row.placement_id || row.asset_placement_id || null,
            template_placement_id: row.template_placement_id || null,
            storage_path: row.storage_path,
            bucket: row.bucket,
            created_at: row.created_at,
            attribution: row.provenance_label || row.attribution || null,
            provenance_detail: row.provenance_detail || row.source_context?.provenance_detail || null,
            layer_key: layer.key,
            layer_label: layer.label,
            layer_detail: layer.detail,
            isInheritedModelMedia: !!row.is_inherited_model_media,
            isExactAssetMedia: !row.is_inherited_model_media,
            // ✅ hero by placement id (persistent)
            isHero: effectiveHero ? effectiveHero === (row.placement_id || row.asset_placement_id) : !!row.is_hero,
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
        if (!effectiveHero && gallery.length === 1 && gallery[0]?.placement_id && !gallery[0]?.isInheritedModelMedia) {
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
        sourceContext: {
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
      if (photo.isInheritedModelMedia) {
        Alert.alert(
          "Inherited model media",
          "This photo comes from the model template. Add or choose a photo on this exact boat to make it the KAC hero."
        );
        return;
      }

      // Preferred: placement hero
      if (photo?.placement_id) {
        try {
          setPhotosLoading(true);

          if (routeOrganizationId) {
            await setKeeprSpaceAssetHero({
              assetId: currentBoat.id,
              organizationId: routeOrganizationId,
              placementId: photo.placement_id,
            });
          } else {
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
      if (photo.isInheritedModelMedia) {
        Alert.alert(
          "Inherited model media",
          "This photo belongs to the model template and is only inherited by this KAC. It was not copied onto the boat."
        );
        return;
      }

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
      setLightboxIndex(idx >= 0 ? idx : 0);
      setLightboxVisible(true);
    };

  const closeLightbox = () => {
  setLightboxVisible(false);
  setLightboxIndex(0);
};

  /* ---------- guards ---------- */

  if (loading || routeBoatLoading) {
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
  const showcaseLayers = showcaseLayerSummary(photos || []);

  const columns = Array.from({ length: numColumns }, () => []);
  if (hasGallery) {
    photos.forEach((photo, index) => {
      columns[index % numColumns].push(photo);
    });
  }

  const modalPhotos = photos
  .filter((p) => !!p.url)
  .map((p) => ({ uri: p.url }));

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
            <QuickActionChip icon="sparkles-outline" label="AI Context" onPress={goToAIContext} />
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
            This Showcase composes inherited model media with photos contributed to this exact KAC.
            Keepr keeps each source separate so the same boat can make sense to Bennington, Wilson,
            and the owner without duplicating the asset.
          </Text>
        </View>

        {showcaseLayers.length ? (
          <View style={styles.layerSummary}>
            {showcaseLayers.map((layer) => (
              <View key={layer.key} style={styles.layerPill}>
                <Text style={styles.layerPillLabel}>{layer.label}</Text>
                <Text style={styles.layerPillCount}>{layer.count}</Text>
              </View>
            ))}
          </View>
        ) : null}

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
                      {!!photo.attribution && (
                        <View style={styles.attributionBadge}>
                          <Text style={styles.attributionBadgeText} numberOfLines={1}>
                            {photo.attribution}
                          </Text>
                        </View>
                      )}

                      <View style={styles.layerBadge}>
                        <Text style={styles.layerBadgeText} numberOfLines={1}>
                          {photo.layer_label || "KAC media"}
                        </Text>
                      </View>

                      {photo.isHero && (
                        <View style={styles.heroBadge}>
                          <Ionicons name="star" size={11} style={styles.heroBadgeIcon} />
                          <Text style={styles.heroBadgeText}>Hero photo</Text>
                        </View>
                      )}
                    <View style={styles.tileActionsRow}>
                      {photo.isInheritedModelMedia ? (
                        <View style={styles.readOnlyBadge}>
                          <Text style={styles.readOnlyBadgeText}>Inherited</Text>
                        </View>
                      ) : !photo.isHero ? (
                        <TouchableOpacity
                          style={styles.tileActionButton}
                          onPress={() => handleSetHero(photo)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.tileActionText}>Set as hero</Text>
                        </TouchableOpacity>
                      ) : null}

                      {!photo.isInheritedModelMedia ? (
                        <TouchableOpacity
                          style={styles.tileActionButtonDanger}
                          onPress={() => handleDeletePhoto(photo)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.tileActionText}>Remove</Text>
                        </TouchableOpacity>
                      ) : null}
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

      <LightboxModal
        visible={lightboxVisible}
        photos={modalPhotos}
        initialIndex={lightboxIndex}
        onClose={closeLightbox}
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

  galleryHeading: {
  marginHorizontal: spacing.lg,
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
  fontSize: 18,
  fontWeight: "900",
  color: colors.textPrimary,
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
  layerSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  layerPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  layerPillLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  layerPillCount: {
    marginLeft: 6,
    minWidth: 18,
    borderRadius: 9,
    overflow: "hidden",
    textAlign: "center",
    backgroundColor: colors.brandBlue,
    color: colors.brandWhite,
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 5,
    paddingVertical: 1,
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
  attributionBadge: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 38,
    alignSelf: "flex-start",
    backgroundColor: "#111827CC",
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  attributionBadgeText: {
    fontSize: 10,
    color: colors.brandWhite,
    fontWeight: "600",
  },
  layerBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    maxWidth: "58%",
    backgroundColor: "#F8FAFCCC",
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  layerBadgeText: {
    fontSize: 10,
    color: colors.textPrimary,
    fontWeight: "800",
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
  readOnlyBadge: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "rgba(17, 24, 39, 0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  readOnlyBadgeText: {
    color: colors.brandWhite,
    fontSize: 11,
    fontWeight: "800",
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
