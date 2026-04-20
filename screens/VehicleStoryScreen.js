// screens/VehicleStoryScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutAnimation,
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

// ✅ low-level upload helper (NOT a hook)
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

// ✅ attachments helpers (for hero placement resolution)
import { getSignedUrl, listAttachmentsForTarget } from "../lib/attachmentsApi";

// Context-aware Add Event pill
import EventPill from "../components/EventPill";
import ReportsModal from "../components/ReportsModal";
import { buildVehicleStory } from "../lib/storyBuilders";

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
// TEMP: Public QR test token (replace later with per-asset QR management)
const PUBLIC_QR_TEST_TOKEN = "xMgfiowNQ6g0ovLjheBnnufFwsRwXS2YdW3_YXAuRU4";

// TEMP: Status of Completion for an Asset)


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

/* --------------------------- SCREEN --------------------------- */

export default function VehicleStoryScreen({ navigation, route }) {
  // Responsive layout (web-first): use a two-column "listing" header on wide screens.
  const { width } = useWindowDimensions();
  const isWide = IS_WEB && width >= 980;
 const initialVehicleId =
  route?.params?.assetId ??
  route?.params?.vehicleId ??
  null;
  
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

  const { assets: vehicles = [], loading, error } = useAssets("vehicle");

  const goToKeeprStory = () => {
    if (!currentVehicle?.id) return;

    const story = buildVehicleStory({
      asset: currentVehicle,
      heroUri,
      records: timelineItems || [],
      systems: systems || [],
      attachments: storyAttachments || [],
      heroPlacementId: currentVehicle?.hero_placement_id || null,
    });

    navigation.navigate("KeeprStory", { story });
  };

  const currentVehicle = useMemo(() => {
    if (!vehicles || vehicles.length === 0) return null;
    if (!initialVehicleId) return vehicles[0];
    return vehicles.find((h) => h.id === initialVehicleId) || vehicles[0] || null;
  }, [vehicles, initialVehicleId]);

  // Local snapshot so big updates (hero photo, delete, edits) reflect immediately
  const [vehicleSnapshot, setVehicleSnapshot] = useState(null);
  const vehicle = vehicleSnapshot || currentVehicle;

  // Keep snapshot in sync when user switches vehicles
    useEffect(() => {
      setVehicleSnapshot(currentVehicle || null);
    }, [currentVehicle?.id]);


  const refreshVehicle = useCallback(async () => {
    if (!vehicle?.id) return;
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("id", vehicle.id)
      .maybeSingle();

    if (!error && data) setVehicleSnapshot(data);
  }, [vehicle?.id]);

const [reportsOpen, setReportsOpen] = useState(false);
 const [assetProgress, setAssetProgress] = useState(null);
 const [storyAttachments, setStoryAttachments] = useState([]);

useEffect(() => {
  if (vehicle?.id) {
    loadAssetProgress(vehicle.id);
  } else {
    setAssetProgress(null);
  }
}, [vehicle?.id, loadAssetProgress]);


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

  // Systems for this vehicle
  const [systems, setSystems] = useState([]);

  // Vehicle picker & timeline scroll
  const [vehiclePickerVisible, setVehiclePickerVisible] = useState(false);
  const scrollRef = useRef(null);
  const [timelineY, setTimelineY] = useState(null);

  // Timeline filter
  const [timelineFilter, setTimelineFilter] = useState("all"); // all | service | moment| pro | diy

  // Delete state
  const [removeModalVisible, setRemoveModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  /* --------------------------- HERO RESOLUTION --------------------------- */

  const resolveHeroFromPlacement = useCallback(async () => {
    if (!vehicle?.id) {
      setHeroUri(null);
      return;
    }

    const placementId = vehicle?.hero_placement_id || null;

    // No placement hero yet → fallback to legacy URL field
    if (!placementId) {
      setHeroUri(vehicle?.hero_image_url || null);
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
        console.log("VehicleStory hero placement lookup error", pErr);
        // fallback so we never show blank due to lookup problems
        setHeroUri(vehicle?.hero_image_url || null);
        return;
      }

      const a = data?.attachment || null;
      if (!a || a.deleted_at) {
        // placement points to missing/deleted attachment
        setHeroUri(vehicle?.hero_image_url || null);
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
        setHeroUri(signed || vehicle?.hero_image_url || null);
        return;
      }

      setHeroUri(vehicle?.hero_image_url || null);
    } catch (e) {
      console.log("VehicleStory resolveHeroFromPlacement error", e);
      setHeroUri(vehicle?.hero_image_url || null);
    } finally {
      setHeroResolving(false);
    }
  }, [vehicle?.id, vehicle?.hero_placement_id, vehicle?.hero_image_url]);

  useFocusEffect(
    useCallback(() => {
      refreshVehicle();
      resolveHeroFromPlacement();
    }, [refreshVehicle, resolveHeroFromPlacement])
  );

  // Also re-resolve if asset changes in-place
  useEffect(() => {
    refreshVehicle();
    resolveHeroFromPlacement();
  }, [refreshVehicle, resolveHeroFromPlacement]);

  /* --------------------------- LOAD DATA ON FOCUS --------------------------- */

  const loadVehicleData = useCallback(async () => {
    if (!vehicle?.id) return;

    setSvcLoading(true);
    setStoryLoading(true);
    setSvcError(null);
    setStoryError(null);

    const vehicleId = vehicle.id;

    try {
      // 1) Service records
      const { data: svcRows, error: svcErr } = await supabase
        .from("service_records")
        .select("*")
        .eq("asset_id", vehicleId)
        .order("performed_at", { ascending: false });

      if (svcErr) {
        console.error("Error loading vehicle service history", svcErr);
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
        .eq("asset_id", vehicleId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false });

      if (storyErr) {
        console.error("Error loading vehicle story events", storyErr);
        setStoryError("Could not load timeline.");
        setStoryEvents([]);
      } else {
        setStoryEvents(storyRows || []);
      }

      // 3) Systems
      const { data: systemRows, error: sysErr } = await supabase
        .from("systems")
        .select("id, name")
        .eq("asset_id", vehicleId)
        .order("name", { ascending: true });

      if (sysErr) {
        console.error("Error loading systems for vehicle", sysErr);
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
        const rows = await listAttachmentsForTarget("asset", vehicleId);
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
              console.log("VehicleStory attachment signed URL error", e);
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
        console.log("VehicleStory attachment load error", e);
        setStoryAttachments([]);
      }
  }, [vehicle?.id]);

  useFocusEffect(
    useCallback(() => {
      if (vehicle?.id) loadVehicleData();
    }, [vehicle?.id, loadVehicleData])
  );

  /* --------------------------- NAV + ACTIONS --------------------------- */

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Garage");
  };

  const goToShowcase = () => {
    if (!vehicle) return;
    navigation.navigate("VehicleShowcase", { vehicleId: vehicle.id });
  };

  const goToAttachments = () => {
    if (!vehicle?.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: vehicle.id,
      assetName: vehicle.name || "Vehicle",
      sourceType: "vehicle",
      initialTab: "file",
    });
  };
  const goToAttachmentsMobile = () => {
  navigation.navigate("AssetAttachmentsMobile", {
    assetId: currentVehicle?.id,
    assetName: currentVehicle?.name,
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
      if (!vehicle?.id) return;

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
        assetId: vehicle.id,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "hero.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements: [
        {
          target_type: "asset",
          target_id: vehicle.id,
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
        .eq("target_id", vehicle.id)
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
          .eq("id", vehicle.id);

        if (uErr) throw uErr;
      }

      await refreshVehicle();
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
  }, [vehicle?.id, ensureMediaPermission, refreshVehicle, resolveHeroFromPlacement]);


  const goToEditVehicle = () => {
    if (!vehicle) return;
    navigation.navigate("EditAsset", { assetId: vehicle.id });
  };

  const goToLogPro = () => {
    if (!vehicle) return;
    navigation.navigate("AddServiceRecord", {
      source: "vehicle",
      assetId: vehicle.id,
      vehicleId: vehicle.id,
      assetName: vehicle.name,
      serviceType: "pro",
    });
  };

  const goToLogDIY = () => {
    if (!vehicle) return;
    navigation.navigate("AddServiceRecord", {
      source: "vehicle",
      assetId: vehicle.id,
      vehicleId: vehicle.id,
      assetName: vehicle.name,
      serviceType: "diy",
    });
  };

  const goToAddTimelineRecord = () => {
    if (!vehicle) return;
    navigation.navigate("AddTimelineRecord", {
      scope: "asset",
      assetId: vehicle.id,
      assetName: vehicle.name || "Vehicle",
      assetType: "vehicle",
    });
  };

  const goToVehicleSystems = () => {
    if (!vehicle) return;
    navigation.navigate("VehicleSystems", {
      vehicleId: vehicle.id,
      vehicleName: vehicle.name || "Vehicle",
    });
  };

      const handleKeeprProgressPress = useCallback(
  (step) => {
    if (!vehicle?.id) return;

    if (step === "asset") {
      return;
    }

    if (step === "system") {
      goToVehicleSystems();
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
  [vehicle?.id, goToVehicleSystems, goToAddTimelineRecord, goToAttachments]
);

const handleAddVehicle = () => {
  setVehiclePickerVisible(false);
  navigation.navigate("AddVehicleAsset");
};

const handleAddVehicleChat = () => {
  setVehiclePickerVisible(false);
  navigation.navigate("AddAssetChat", {
    assetType: "vehicle",
    flow: "asset-intake",
    source: "vehicle-picker-chat",
  });
};

const goToPublicView = () => {
  if (!vehicle?.id) return;

  const kacFromRoute =
    route?.params?.kac ||
    route?.params?.kacId ||
    route?.params?.kac_id ||
    null;

  const kacFromAsset =
    vehicle?.kac ||
    vehicle?.kac_code ||
    vehicle?.kac_id ||
    vehicle?.kacId ||
    null;

  const kac = (kacFromRoute || kacFromAsset || "").toString().trim();

  if (kac) {
    navigation.navigate("PublicAction", { kac });
    return;
  }

  // Fallback for now (until per-asset public link tokens are stored/generated)
  if (PUBLIC_QR_TEST_TOKEN) {
    navigation.navigate("PublicAction", { token: PUBLIC_QR_TEST_TOKEN });
    return;
  }

  Alert.alert(
    "Public view not ready",
    "No KAC or public token was found for this vehicle yet."
  );
};


  const handleSelectVehicle = (vehicle) => {
    setVehiclePickerVisible(false);
    if (!vehicle?.id) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    navigation.navigate("VehicleStory", { vehicleId: vehicle.id });
  };

  const scrollToTimeline = () => {
    if (!scrollRef.current || timelineY == null) return;
    scrollRef.current.scrollTo({ y: timelineY - 24, animated: true });
  };

// Delete flow
const startRemove = () => {
  if (!vehicle?.id) return;
  setRemoveModalVisible(true);
};

const handleConfirmRemove = async () => {
  if (!vehicle?.id) return;

  setActionLoading(true);
  try {
    const { error: updErr } = await supabase
      .from("assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", vehicle.id);

    if (updErr) {
      console.error("soft delete vehicle error", updErr);
      Alert.alert(
        "Couldn’t delete",
        updErr?.message || "Nothing was deleted."
      );
      return;
    }

    setRemoveModalVisible(false);
    Alert.alert("Deleted", "This vehicle was removed from your account.");

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
    console.log("handleConfirmRemove vehicle error:", e);
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

const meta = {
  vehicleType: vehicle?.vehicle_type || vehicle?.type,
  year: vehicle?.year,
  make: vehicle?.make,
  model: vehicle?.model,
  trim: vehicle?.trim || null,
  vin: vehicle?.vin || null,
  serialNumber: vehicle?.serial_number || null,
  mileage: vehicle?.current_odometer || null,
  engineHours: vehicle?.engine_hours || null,
  estValue: vehicle?.estimated_value,
  purchasePrice: vehicle?.purchase_price,
  purchaseDate: vehicle?.purchase_date,
  location: vehicle?.location || null,
};

  const hasMeta = Object.values(meta).some((v) => v);

  const formatMoney = (v) => {
    if (!v && v !== 0) return null;
    if (typeof v === "number") return `$${v.toLocaleString()}`;
    const s = String(v);
    return s.startsWith("$") ? s : `$${s}`;
  };

  const vehicleLocation = meta.location || null;
  const vehicleName = vehicle?.name || "My vehicle";

  const vehicleDisplayName =
  `${vehicle?.year || ""} ${vehicle?.make || ""} ${vehicle?.model || ""}`.trim() || "Vehicle";


  const goToStoryPrint = () => {
  if (!currentVehicle?.id) return;

  const story = {
    assetId: currentVehicle.id,
    assetType: "vehicle",
    title: vehicleDisplayName,
    subtitle: "Vehicle overview",
    heroUri,
    purchaseDate: currentVehicle.purchase_date || null,
    purchasePrice: currentVehicle.purchase_price || null,
    estimatedValue: currentVehicle.estimated_value || null,
    location: currentVehicle.location || null,
    context: currentVehicle.notes || "",
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
          <Text style={{ marginTop: spacing.sm }}>Loading vehicle…</Text>
        </View>

        <ReportsModal
        visible={reportsOpen}
        onClose={() => setReportsOpen(false)}
        asset={vehicle}
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

  if (!vehicle) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.appTitle}>
            Keepr – Add your Vehicle to Keepr.
          </Text>
          <Text style={styles.appSubtitle}>
           This is where the living record of your vehicle will grow over time.
          </Text>
          <Text style={styles.appSubtitle}>
           Cars, motorcycles, golf carts, trailers, and equipment — add them all.
          </Text>
          <View style={{ height: 10 }} />
          <Text style={{ color: colors.textSecondary }}>
            You don’t have a vehicle added yet.
          </Text>

          <View style={{ height: 14 }} />

          <TouchableOpacity
            style={styles.emptyPrimaryBtn}
            onPress={handleAddVehicle}
            activeOpacity={0.9}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.emptyPrimaryBtnText}>Add a vehicle</Text>
          </TouchableOpacity>

          <View style={{ height: 8 }} />

          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={handleAddVehicleChat}
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
  asset={vehicle}
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
            <Text style={styles.headerTitle}>{vehicleName} Story</Text>
            <Text style={styles.headerSubtitle}>
              A home for everything you own.
            </Text>
          </View>
        </View>

        {/* Vehicle row */}
        <View style={styles.vehiclePickerRow}>
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
            style={styles.addVehicleCircle}
            activeOpacity={0.9}
            onPress={handleAddVehicle}
          >
            <Ionicons name="add-circle" size={35} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.vehiclePickerButton}
            activeOpacity={0.9}
            onPress={() => setVehiclePickerVisible(true)}
          >
            <Ionicons name="car-sport-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.vehiclePickerButtonText} numberOfLines={1}>
              {vehicleName}
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
              label="Systems"
              icon="grid-outline"
              onPress={goToVehicleSystems}
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
              label="Edit vehicle"
              icon="create-outline"
              onPress={goToEditVehicle}
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
              onPress={handleAddVehicleChat}
            />
            */}
            <QuickActionChip
              label="Delete vehicle"
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
              {vehicleName}
            </Text>
            {!!vehicleLocation && (
              <Text style={styles.heroSubtitle} numberOfLines={1}>
                {vehicleLocation}
              </Text>
            )}

            {!!hasMeta && (
              <View style={styles.metaGrid}>
              {!!meta.year && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Year</Text>
                  <Text style={styles.metaValue}>{meta.year}</Text>
                </View>
              )}

              {!!meta.make && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Make</Text>
                  <Text style={styles.metaValue}>{meta.make}</Text>
                </View>
              )}

              {!!meta.model && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Model</Text>
                  <Text style={styles.metaValue}>{meta.model}</Text>
                </View>
              )}

              {!!meta.mileage && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Mileage</Text>
                  <Text style={styles.metaValue}>
                    {Number(meta.mileage).toLocaleString()} mi
                  </Text>
                </View>
              )}

              {!!meta.engineHours && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Engine Hours</Text>
                  <Text style={styles.metaValue}>
                    {Number(meta.engineHours).toLocaleString()}
                  </Text>
                </View>
              )}

              {!!meta.vin && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>VIN</Text>
                  <Text style={styles.metaValue}>{meta.vin}</Text>
                </View>
              )}

              {!!meta.serialNumber && !meta.vin && (
                <View style={styles.metaTile}>
                  <Text style={styles.metaLabel}>Serial Number</Text>
                  <Text style={styles.metaValue}>{meta.serialNumber}</Text>
                </View>
              )}
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
                  if (step === "system") goToVehicleSystems();
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

      {/* Add event pill (context: vehicle) */}
      {!!vehicle?.id && (
        <EventPill
          label="Add a quick event"
          onPress={() =>
            navigation.navigate("CreateEvent", {
              assetId: vehicle.id,
              assetType: "vehicle",
              assetName: vehicle.name || "Vehicle",
            })
          }
        />
      )}

      {/* Vehicle picker modal */}
      <Modal
        visible={vehiclePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVehiclePickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Select vehicle</Text>
              </View>

              <TouchableOpacity
                onPress={handleAddVehicleChat}
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
                onPress={() => setVehiclePickerVisible(false)}
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
              {vehicles.map((h) => {
                const isActive = h.id === vehicle?.id;

                return (
                  <TouchableOpacity
                    key={h.id}
                    style={[
                      styles.modalVehicleRow,
                      isActive && styles.modalVehicleRowActive,
                    ]}
                    onPress={() => handleSelectVehicle(h)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="car-sport-outline"
                      size={18}
                      color={isActive ? colors.textPrimary : colors.textMuted}
                    />
                    <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                      <Text style={styles.modalVehicleName} numberOfLines={1}>
                        {h.name || "Untitled vehicle"}
                      </Text>
                      {!!h.location && (
                        <Text style={styles.modalVehicleMeta} numberOfLines={1}>
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
              <Text style={styles.modalTitle}>Delete vehicle?</Text>
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
            This will remove this vehicle from your account.
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
  asset={vehicle}
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

  vehiclePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  vehiclePickerLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  vehiclePickerSubtitle: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 2,
  },
  addVehicleCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.subtle,
  },
  vehiclePickerButton: {
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
  vehiclePickerButtonText: {
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

  modalVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalVehicleRowActive: { backgroundColor: colors.surfaceSubtle },
  modalVehicleName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  modalVehicleMeta: { fontSize: 12, color: colors.textMuted },

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