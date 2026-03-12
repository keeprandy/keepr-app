// screens/BoatStoryScreen.js
import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import { formatKeeprDate } from "../lib/dateFormat";

import EventPill from "../components/EventPill";
import { getSignedUrl } from "../lib/attachmentsApi";

const HERO_ASPECT = 4 / 3;
const IS_WEB = Platform.OS === "web";
const WIDE_BREAKPOINT = 980;

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
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
        style={[
          styles.filterChipLabel,
          active && styles.filterChipLabelActive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* --------------------------- METADATA HELPERS --------------------------- */

// Supports both metadata.standard (preferred) and legacy flat metadata shapes.
function getStandardMetaFromMetadata(metadata) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const standard =
    meta.standard && typeof meta.standard === "object" ? meta.standard : null;

  if (standard) {
    return {
      identity: standard.identity || {},
      warranty: standard.warranty || {},
      value: standard.value || {},
      risk: standard.risk || {},
      story: standard.story || {},
      relationships: standard.relationships || {},
    };
  }

  return {
    identity: meta.identity || {},
    warranty: meta.warranty || {},
    value: meta.value || {},
    risk: meta.risk || {},
    story: meta.story || {},
    relationships: meta.relationships || {},
  };
}

function upsertStandardRelationships(metadata, relationshipsPatch) {
  const meta = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const standard =
    meta.standard && typeof meta.standard === "object" ? { ...meta.standard } : {};
  const relationships =
    standard.relationships && typeof standard.relationships === "object"
      ? { ...standard.relationships }
      : {};

  Object.assign(relationships, relationshipsPatch || {});
  standard.relationships = relationships;
  meta.standard = standard;
  return meta;
}



export default function BoatStoryScreen({ navigation, route }) {
  const { width } = useWindowDimensions();
  const isWide = IS_WEB && width >= WIDE_BREAKPOINT;

  const initialBoatId =
  route?.params?.assetId ??
  route?.params?.boatId ??
  null;

  const { assets: boats = [], loading, error } = useAssets("boat");

  const currentBoat = useMemo(() => {
    if (!boats || boats.length === 0) return null;
    if (!initialBoatId) return boats[0];
    return boats.find((v) => v.id === initialBoatId) || boats[0] || null;
  }, [boats, initialBoatId]);

  const boatDisplayName = useMemo(() => {
    return (
      currentBoat?.name ||
      [currentBoat?.year, currentBoat?.make, currentBoat?.model]
        .filter(Boolean)
        .join(" ") ||
      "Boat"
    );
  }, [currentBoat?.name, currentBoat?.year, currentBoat?.make, currentBoat?.model]);

  /* --------------------------- KEEPR PRO (asset-level) --------------------------- */

  // Keep a local metadata copy so we can update the UI immediately after assignment.
  // NOTE: assets table uses `extra_metadata` (not `metadata`).
  const [assetMetadata, setAssetMetadata] = useState(() =>
    currentBoat?.extra_metadata || currentBoat?.metadata || {}
  );

  useEffect(() => {
    setAssetMetadata(currentBoat?.extra_metadata || currentBoat?.metadata || {});
  }, [currentBoat?.id, currentBoat?.updated_at]);

  const { relationships: assetRelationships } = useMemo(
    () => getStandardMetaFromMetadata(assetMetadata),
    [assetMetadata]
  );

  const assetKeeprProIds = useMemo(() => {
    const rel = assetRelationships || {};
    const raw =
      rel.keepr_pro_ids ||
      rel.keeprProIds ||
      rel.keepr_pros ||
      rel.keeprPros ||
      [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [assetRelationships]);

  const [assignedPros, setAssignedPros] = useState([]);
  const [prosLoading, setProsLoading] = useState(false);
  const [prosError, setProsError] = useState(null);

  const [proPickerVisible, setProPickerVisible] = useState(false);
  const [allPros, setAllPros] = useState([]);
  const [allProsLoading, setAllProsLoading] = useState(false);
  const [selectedProIds, setSelectedProIds] = useState([]);

  const openKeeprPro = useCallback(
    (pro) => {
      if (!pro?.id) return;
      navigation.navigate("KeeprProDetail", { pro });
    },
    [navigation]
  );

  const loadAssignedPros = useCallback(async () => {
    const ids = assetKeeprProIds || [];
    if (!ids.length) {
      setAssignedPros([]);
      setProsLoading(false);
      setProsError(null);
      return;
    }

    setProsLoading(true);
    setProsError(null);

    try {
      const { data, error: pErr } = await supabase
        .from("keepr_pros")
        .select("id, name, category, phone, email, website, is_favorite")
        .in("id", ids);

      if (pErr) throw pErr;

      const byId = new Map((data || []).map((p) => [p.id, p]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

      setAssignedPros(ordered);
      setProsLoading(false);
    } catch (e) {
      console.log("BoatStory loadAssignedPros error", e?.message || e);
      setAssignedPros([]);
      setProsLoading(false);
      setProsError(e?.message || "Failed to load Keepr Pros.");
    }
  }, [assetKeeprProIds]);

  useEffect(() => {
    loadAssignedPros();
  }, [loadAssignedPros]);

  const loadAllPros = useCallback(async () => {
    if (allProsLoading) return;
    setAllProsLoading(true);

    try {
      const { data, error: pErr } = await supabase
        .from("keepr_pros")
        .select("id, name, category, phone, email, website, is_favorite")
        .order("is_favorite", { ascending: false })
        .order("name", { ascending: true });

      if (pErr) throw pErr;

      setAllPros(data || []);
      setAllProsLoading(false);
    } catch (e) {
      console.log("BoatStory loadAllPros error", e?.message || e);
      setAllPros([]);
      setAllProsLoading(false);
    }
  }, [allProsLoading]);

  const openProPicker = useCallback(() => {
    setSelectedProIds(assetKeeprProIds || []);
    setProPickerVisible(true);
    if (!allPros || allPros.length === 0) {
      loadAllPros();
    }
  }, [assetKeeprProIds, allPros, loadAllPros]);

  const togglePro = useCallback((id) => {
    if (!id) return;
    setSelectedProIds((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const idx = next.indexOf(id);
      if (idx >= 0) next.splice(idx, 1);
      else next.push(id);
      return next;
    });
  }, []);

  const saveAssetKeeprPros = useCallback(async () => {
    if (!currentBoat?.id) return;

    const nextIds = Array.isArray(selectedProIds) ? selectedProIds.filter(Boolean) : [];
    const nextMeta = upsertStandardRelationships(assetMetadata, { keepr_pro_ids: nextIds });

    try {
      const { error: upErr } = await supabase
        .from("assets")
        .update({ extra_metadata: nextMeta })
        .eq("id", currentBoat.id);

      if (upErr) throw upErr;

      setAssetMetadata(nextMeta);
      setProPickerVisible(false);
      setProsError(null);
    } catch (e) {
      console.log("BoatStory saveAssetKeeprPros error", e?.message || e);
      Alert.alert("Could not save", e?.message || "Please try again.");
    }
  }, [currentBoat?.id, selectedProIds, assetMetadata]);

  /* --------------------------- HERO RESOLUTION (placement-based) --------------------------- */

  const [heroUri, setHeroUri] = useState(null);
  const [heroResolving, setHeroResolving] = useState(false);

  const resolveHeroFromPlacement = useCallback(async () => {
    if (!currentBoat?.id) {
      setHeroUri(null);
      return;
    }

    const placementId = currentBoat?.hero_placement_id || null;

    // No placement hero yet → fallback legacy field
    if (!placementId) {
      setHeroUri(currentBoat?.hero_image_url || null);
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
        console.log("BoatStory hero placement lookup error", pErr);
        setHeroUri(currentBoat?.hero_image_url || null);
        return;
      }

      const a = data?.attachment || null;
      if (!a || a.deleted_at) {
        setHeroUri(currentBoat?.hero_image_url || null);
        return;
      }

      if (a.url) {
        setHeroUri(a.url);
        return;
      }

      if (a.bucket && a.storage_path) {
        const signed = await getSignedUrl({
          bucket: a.bucket,
          path: a.storage_path,
        });
        setHeroUri(signed || currentBoat?.hero_image_url || null);
        return;
      }

      setHeroUri(currentBoat?.hero_image_url || null);
    } catch (e) {
      console.log("BoatStory resolveHeroFromPlacement error", e);
      setHeroUri(currentBoat?.hero_image_url || null);
    } finally {
      setHeroResolving(false);
    }
  }, [currentBoat?.id, currentBoat?.hero_placement_id, currentBoat?.hero_image_url]);

  useFocusEffect(
    useCallback(() => {
      resolveHeroFromPlacement();
    }, [resolveHeroFromPlacement])
  );

  useEffect(() => {
    resolveHeroFromPlacement();
  }, [resolveHeroFromPlacement]);

  /* --------------------------- DATA: service + story + systems --------------------------- */

  const [serviceRecords, setServiceRecords] = useState([]);
  const [serviceAttachments, setServiceAttachments] = useState({});
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState(null);

  const [storyEvents, setStoryEvents] = useState([]);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState(null);

  const [systems, setSystems] = useState([]);

  const loadBoatData = useCallback(async () => {
    if (!currentBoat?.id) return;

    setSvcLoading(true);
    setStoryLoading(true);
    setSvcError(null);
    setStoryError(null);

    const boatId = currentBoat.id;

    try {
      // 1) Service records
      const { data: svcRows, error: svcErr } = await supabase
        .from("service_records")
        .select("*")
        .eq("asset_id", boatId)
        .order("performed_at", { ascending: false });

      if (svcErr) {
        console.error("Error loading boat service history", svcErr);
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
            console.error("Error loading attachments for service records", photosErr);
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
        .eq("asset_id", boatId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false });

      if (storyErr) {
        console.error("Error loading boat story events", storyErr);
        setStoryError("Could not load timeline.");
        setStoryEvents([]);
      } else {
        setStoryEvents(storyRows || []);
      }

      // 3) Systems
      const { data: systemRows, error: sysErr } = await supabase
        .from("systems")
        .select("id, name")
        .eq("asset_id", boatId)
        .order("name", { ascending: true });

      if (sysErr) {
        console.error("Error loading systems for boat", sysErr);
        setSystems([]);
      } else {
        setSystems(systemRows || []);
      }
    } finally {
      setSvcLoading(false);
      setStoryLoading(false);
    }
  }, [currentBoat?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentBoat?.id) loadBoatData();
    }, [currentBoat?.id, loadBoatData])
  );

  /* --------------------------- UI STATE --------------------------- */

  const [boatPickerVisible, setBoatPickerVisible] = useState(false);
  const scrollRef = useRef(null);
  const [timelineY, setTimelineY] = useState(null);

  const [timelineFilter, setTimelineFilter] = useState("all"); // all | service | story | pro | diy

  const [removeModalVisible, setRemoveModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  /* --------------------------- NAV + ACTIONS --------------------------- */

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Garage");
  };

  const goToShowcase = () => {
    if (!currentBoat) return;
    navigation.navigate("BoatShowcase", { boatId: currentBoat.id });
  };

  const goToAttachments = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: currentBoat.id,
      assetName: boatDisplayName,
      sourceType: "boat",
      initialTab: "file",
    });
  };

  const goToEditBoat = () => {
    if (!currentBoat) return;
    navigation.navigate("EditAsset", { assetId: currentBoat.id });
  };

  const goToLogPro = () =>
    navigation.navigate("AddServiceRecord", {
      source: "boat",
      assetId: currentBoat.id,
      boatId: currentBoat.id,
      assetName: boatDisplayName,
      serviceType: "pro",
    });

  const goToLogDIY = () =>
    navigation.navigate("AddServiceRecord", {
      source: "boat",
      assetId: currentBoat.id,
      boatId: currentBoat.id,
      assetName: boatDisplayName,
      serviceType: "diy",
    });

  const goToAddTimelineRecord = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("AddTimelineRecord", {
      scope: "asset",
      assetId: currentBoat.id,
      assetName: boatDisplayName,
      assetType: "boat",
    });
  };

  const goToTimelineRecord = (serviceRecordId) => {
    navigation.navigate("TimelineRecord", {
      sourceType: "service_record",
      serviceRecordId,
    });
  };
  const goToPublicView = () => {
    if (!currentBoat?.kac_id) {
      Alert.alert("Missing KAC", "This asset is not linked to a KAC yet.");
      return;
    }
    navigation.navigate("PublicAction", {
      kac: currentBoat.kac_id,
      assetId: currentBoat.id,
      assetName: boatDisplayName,
      assetType: "boat",
    });
  };
  const goToBoatSystems = () => {
    if (!currentBoat) return;
    navigation.navigate("BoatSystems", {
      boatId: currentBoat.id,
      boatName: boatDisplayName,
    });
  };

  const handleAddBoat = () => navigation.navigate("AddMarineAsset", { assetType: "boat" });

  const handleAddBoatChat = () =>
    navigation.navigate("AddAssetChat", {
      assetType: "boat",
      flow: "asset-intake",
    });

  const handleSelectBoat = (boat) => {
    setBoatPickerVisible(false);
    if (!boat?.id) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    navigation.navigate("BoatStory", { boatId: boat.id });
  };

  const scrollToTimeline = () => {
    if (!scrollRef.current || timelineY == null) return;
    scrollRef.current.scrollTo({ y: timelineY - 24, animated: true });
  };

  const startRemoveBoat = () => {
    if (!currentBoat?.id) return;
    setRemoveModalVisible(true);
  };

  const handleConfirmRemoveBoat = async () => {
    if (!currentBoat?.id) return;

    const boatId = currentBoat.id;
    setActionLoading(true);

    try {
      // best-effort legacy cleanup (kept because your current file expects it)
      const { data: photoRows } = await supabase
        .from("asset_photos")
        .select("id, storage_path")
        .eq("asset_id", boatId);

      if (photoRows && photoRows.length) {
        const paths = photoRows
          .map((p) => p.storage_path)
          .filter((p) => typeof p === "string" && p.length > 0);

        if (paths.length) {
          try {
            await supabase.storage.from("asset-photos").remove(paths);
          } catch (e) {
            console.error("Unexpected storage remove error", e);
          }
        }

        await supabase.from("asset_photos").delete().eq("asset_id", boatId);
      }

      const { error: assetErr } = await supabase
        .from("assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", boatId);

      if (assetErr) {
        console.error("Error soft-deleting boat asset", assetErr);
        Alert.alert("Couldn’t delete", assetErr.message || "Nothing was deleted.");
        return;
      }

      setRemoveModalVisible(false);
      Alert.alert("Deleted", "This boat was deleted from your Keepr.");
      navigation.navigate("Garage");
    } catch (e) {
      console.error("handleConfirmRemoveBoat error", e);
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
        rec.system_id && systemMap[rec.system_id] ? systemMap[rec.system_id] : null;

      items.push({
        id: rec.id,
        kind: "service",
        serviceRecordId: rec.id,
        title: rec.title || "Service visit",
        description: rec.notes || "",
        provider: rec.location || null,
        serviceType: rec.service_type || null,
        systemName,
        cost: rec.cost,
        date,
        hasAttachment: !!serviceAttachments?.[rec.id],
      });
    });

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [storyEvents, serviceRecords, systems, serviceAttachments]);

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
    }
  };

  /* --------------------------- GUARDS --------------------------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm }}>Loading boat…</Text>
        </View>
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

  if (!currentBoat) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.appTitle}>Keepr – A home for everything you own.</Text>
          <Text style={styles.appSubtitle}>
            Track homes, garage, and boats in one place.
          </Text>
          <View style={{ height: 10 }} />
          <Text>Add your Boats - Car, Motorcycle, Bike, Golf Cart</Text>
          <View style={{ height: 10 }} />
          <TouchableOpacity style={styles.emptyPrimaryBtn} onPress={handleAddBoat} activeOpacity={0.9}>
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.emptyPrimaryBtnText}>Add a boat</Text>
          </TouchableOpacity>
          <View style={{ height: 8 }} />
          <TouchableOpacity style={styles.emptySecondaryBtn} onPress={handleAddBoatChat} activeOpacity={0.9}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.emptySecondaryBtnText}>Add via chat</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /* --------------------------- HERO + META --------------------------- */


  // Display names (derived from assets table)
  // - boatDisplayName is a safe fallback used across the screen
  // - boatName / boatSubtitle are used only for header rendering
  const boatName = boatDisplayName;
  const boatSubtitle = [currentBoat?.trim, currentBoat?.location]
    .filter(Boolean)
    .join(" · ") || null;

  const heroImage = heroUri ? { uri: heroUri } : null;

  const meta = {
    year: currentBoat.year,
    make: currentBoat.make,
    model: currentBoat.model,
    trim: currentBoat.trim,
    mileage: currentBoat.mileage,
    vin: currentBoat.vin,
    plate: currentBoat.plate,
    estValue: currentBoat.estimated_value,
    purchasePrice: currentBoat.purchase_price,
    purchaseDate: currentBoat.purchase_date,
    location: currentBoat.location,
  };

  const hasMeta = Object.values(meta).some((v) => v);

  const formatMoney = (v) => {
    if (!v && v !== 0) return null;
    if (typeof v === "number") return `$${v.toLocaleString()}`;
    const str = v.toString();
    return str.startsWith("$") ? str : `$${str}`;
  };

  const formatMileage = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const num = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(num)) return v;
    return `${num.toLocaleString()} mi`;
  };

  const boatLocation = meta.location || null;

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
            <Text style={styles.headerTitle}>{boatDisplayName} Story</Text>
            <Text style={styles.headerSubtitle}>A home for everything you own.</Text>
          </View>
        </View>

        {/* Boat row */}
        <View style={styles.boatPickerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.boatPickerLabel}>Boat</Text>
            <Text style={styles.boatPickerSubtitle} numberOfLines={1}>
              {boatDisplayName}
              {boatLocation ? ` · ${boatLocation}` : ""}
            </Text>
          </View>
          {IS_WEB && currentBoat?.id && (
            <TouchableOpacity
              onPress={() => {
                const story = {
                  assetId: currentBoat.id,
                  assetType: "boat",
                  title: boatDisplayName,
                  subtitle: "Boat overview",
                  heroUri, // already resolved earlier
                  // high-level meta you might want on the sheet
                  purchaseDate: currentBoat.purchase_date || null,
                  purchasePrice: currentBoat.purchase_price || null,
                  estimatedValue: currentBoat.estimated_value || null,
                  location: currentBoat.location || null,
                  // story context (the “Story & notes” box)
                  context: currentBoat.notes || "",
                  // full timeline for printing
                  timeline: (timelineItems || []).map((item) => ({
                    id: item.id,
                    kind: item.kind, // "service" | "story"
                    title: item.title,
                    description: item.description,
                    date: item.date,
                    provider: item.provider || null,
                    serviceType: item.serviceType || null, // "pro" | "diy" | etc
                    systemName: item.systemName || null,
                    cost: item.cost ?? null,
                  })),
                };
                navigation.navigate("StoryPrint", { story });
              }}
              style={{ marginLeft: 8 }}
            >
              <Ionicons name="print-outline" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.addBoatCircle} activeOpacity={0.9} onPress={handleAddBoat}>
            <Ionicons name="add" size={18} color="white" />
          </TouchableOpacity>
          

          <TouchableOpacity
            style={styles.boatPickerButton}
            activeOpacity={0.9}
            onPress={() => setBoatPickerVisible(true)}
          >
            <Ionicons name="car-sport-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.boatPickerButtonText} numberOfLines={1}>
              {boatDisplayName}
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
            <QuickActionChip label="Story" icon="book-outline" isPrimary onPress={() => {}} />
            <QuickActionChip label="Systems" icon="grid-outline" onPress={goToBoatSystems} />
            <QuickActionChip label="Timeline" icon="time-outline" onPress={scrollToTimeline} />
            <QuickActionChip label="Add record" icon="add-circle-outline" onPress={goToAddTimelineRecord} />
            <QuickActionChip label="Attachments" icon="attach-outline" onPress={goToAttachments} />
            <QuickActionChip label="QR Codes" icon="qr-code-outline" onPress={() => navigation.navigate("AssetQRCodes", { assetId: currentBoat.id })}/>
            <QuickActionChip label="Showcase" icon="images-outline" onPress={goToShowcase} />
            <QuickActionChip label="Attachments" icon="attach-outline" onPress={goToAttachments} />
            <QuickActionChip label="Public view" icon="open-outline" onPress={goToPublicView} />
            <QuickActionChip label="Edit boat" icon="create-outline" onPress={goToEditBoat} />
            <QuickActionChip label="Delete boat" icon="trash-outline" onPress={startRemoveBoat} />
          </ScrollView>
        </View>

        {/* HERO + META (CarGurus-style on web wide) */}
        <View style={[styles.heroCard, isWide && styles.heroCardWide]}>
          <View style={[styles.heroTopRow, isWide && styles.heroTopRowWide]}>
            {/* Left: hero image */}
            <View style={[styles.heroLeft, isWide && styles.heroLeftWide]}>
              <View
                style={[
                  styles.heroImageWrap,
                  isWide ? styles.heroImageWrapWide : styles.heroImageWrapMobile,
                ]}
              >
                {heroImage ? (
                  <Image source={heroImage} style={styles.heroImage} resizeMode="contain" />
                ) : (
                  <View style={styles.heroPlaceholder}>
                    <Ionicons name="car-sport-outline" size={34} color={colors.textMuted} />
                    <Text style={styles.heroPlaceholderText}>Add a hero photo in Showcase.</Text>
                  </View>
                )}

                {heroResolving && (
                  <View style={styles.heroSpinner}>
                    <ActivityIndicator size="small" color="white" />
                  </View>
                )}
              </View>
            </View>

            {/* Right: title + specs (keep existing metadata fields/labels) */}
            <View style={[styles.heroRight, isWide && styles.heroRightWide]}>
              
              <View style={styles.heroMeta}>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {boatName}
                </Text>

                {/* Subtitle line mirrors current behavior (location / trim / misc) */}
                {!!boatSubtitle && (
                  <Text style={styles.heroSubtitle} numberOfLines={2}>
                    {boatSubtitle}
                  </Text>
                )}

                {hasMeta && (
                  <View style={styles.metaCardWide}>
                    {meta.year && <Text style={styles.metaLine}>Year: {meta.year}</Text>}
                    {meta.make && <Text style={styles.metaLine}>Make: {meta.make}</Text>}
                    {meta.model && <Text style={styles.metaLine}>Model: {meta.model}</Text>}
                    {meta.trim && <Text style={styles.metaLine}>Trim: {meta.trim}</Text>}
                    {meta.mileage && (
                      <Text style={styles.metaLine}>Mileage: {formatMileage(meta.mileage)}</Text>
                    )}
                    {meta.vin && <Text style={styles.metaLine}>VIN: {meta.vin}</Text>}
                    {meta.plate && <Text style={styles.metaLine}>Plate: {meta.plate}</Text>}
                    {meta.purchasePrice && (
                      <Text style={styles.metaLine}>
                        Purchase price: {formatMoney(meta.purchasePrice)}
                      </Text>
                    )}
                    {meta.estimatedValue && (
                      <Text style={styles.metaLine}>
                        Estimated value: {formatMoney(meta.estimatedValue)}
                      </Text>
                    )}
                    {meta.purchased && (
                      <Text style={styles.metaLine}>Purchased: {formatKeeprDate(meta.purchased)}</Text>
                    )}
                  </View>
                )}
                {/* KEEPR PRO (asset-level) */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Keepr Pro</Text>

            <QuickActionChip
              icon="people-outline"
              label={assignedPros?.length ? "Edit assignment" : "Assign"}
              onPress={openProPicker}
            />
          </View>

          <View style={styles.proCard}>
            {prosLoading ? (
              <View style={{ paddingVertical: spacing.sm }}>
                <ActivityIndicator size="small" />
              </View>
            ) : assignedPros?.length ? (
              <View>
                {assignedPros.slice(0, 3).map((pro) => (
                  <TouchableOpacity
                    key={pro.id}
                    style={styles.proRow}
                    onPress={() => openKeeprPro(pro)}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.proName} numberOfLines={1}>
                        {pro.name || "Keepr Pro"}
                      </Text>
                      <Text style={styles.proMeta} numberOfLines={1}>
                        {[pro.category, pro.phone || pro.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward-outline"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                ))}

                {assignedPros.length > 3 ? (
                  <TouchableOpacity
                    style={styles.proMoreRow}
                    onPress={openProPicker}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.proMoreText}>
                      + {assignedPros.length - 3} more
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyInlineText}>
                  No Keepr Pro assigned yet. Add your go-to contact so “Create action” is one click away.
                </Text>
              </View>
            )}

            {!!prosError && (
              <Text style={styles.warnText}>{prosError}</Text>
            )}
          </View>
        </View>
              </View>
            </View>
          </View>
        </View>

{/* STORY & NOTES */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Story & notes</Text>
          <View style={styles.storyCard}>
            {currentBoat.notes ? (
              <Text style={styles.storyText}>{currentBoat.notes}</Text>
            ) : (
              <Text style={styles.storyText}>
                Capture the story of this boat — trips, seasons, upgrades, and major service moments.
              </Text>
            )}
          </View>
        </View>

        {/* TIMELINE */}
        <View
          style={[styles.section, { marginTop: spacing.lg }]}
          onLayout={(e) => setTimelineY(e.nativeEvent.layout.y)}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={{ flex: 1 }} />
            {(svcLoading || storyLoading) && <ActivityIndicator size="small" />}
            <QuickActionChip
              label="Add record"
              icon="add-circle-outline"
              onPress={goToAddTimelineRecord}
            />
          </View>

          <View style={styles.filterRow}>
            {[
              ["all", "All"],
              ["service", "Service"],
              ["moment", "Moments"],
              ["pro", "Pro"],
              ["diy", "DIY"],
            ].map(([key, label]) => (
              <TimelineFilterChip
                key={key}
                label={label}
                active={timelineFilter === key}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setTimelineFilter(key);
                }}
              />
            ))}
          </View>

          {(storyLoading || svcLoading) && (
            <View style={styles.historyLoadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.historyLoadingText}>Loading…</Text>
            </View>
          )}

          {(storyError || svcError) && (
            <Text style={styles.historyErrorText}>{storyError || svcError}</Text>
          )}

          {!storyLoading && !svcLoading && !filteredTimelineItems.length && (
            <View style={styles.emptyHistoryCard}>
              <Ionicons name="time-outline" size={20} color={colors.textMuted} />
              <Text style={styles.emptyHistoryTitle}>Nothing here yet</Text>
              <Text style={styles.emptyHistoryText}>
                As you add service and systems data, it will appear here as a timeline of this boat’s story.
              </Text>
            </View>
          )}

          {!!filteredTimelineItems.length && (
            <View style={styles.timelineList}>
              {filteredTimelineItems.map((item) => {
                const dateLabel = item.date ? formatKeeprDate(item.date) : "Date unknown";
                const isService = item.kind === "service";

                return (
                  <TouchableOpacity
                    key={`${item.kind}-${item.id}`}
                    style={styles.timelineCard}
                    activeOpacity={0.85}
                    onPress={() => onTimelineItemPress(item)}
                  >
                    <View style={styles.timelineIconCircle}>
                      <Ionicons
                        name={isService ? "construct-outline" : "sparkles-outline"}
                        size={16}
                        color={colors.textSecondary}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={styles.timelineTitle} numberOfLines={1}>
                          {item.title || (isService ? "Service visit" : "Story")}
                        </Text>
                        <Text style={styles.timelineDate}>{dateLabel}</Text>
                      </View>

                      {isService &&
                        (item.serviceType ||
                          item.systemName ||
                          item.cost != null ||
                          item.hasAttachment) && (
                          <Text style={styles.timelineMetaRow} numberOfLines={1}>
                            {item.serviceType &&
                              `[${String(item.serviceType).toUpperCase()}] `}
                            {item.systemName && `${item.systemName} `}
                            {item.cost != null && `· $${Number(item.cost).toLocaleString()} `}
                            {item.hasAttachment ? "· 📎" : ""}
                          </Text>
                        )}

                      {!!item.description && (
                        <Text style={styles.timelineDescription} numberOfLines={3}>
                          {item.description}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Boat picker modal */}
      <Modal
        visible={boatPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBoatPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select boat</Text>
              <TouchableOpacity onPress={() => setBoatPickerVisible(false)}>
                <Ionicons name="close-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: spacing.sm }}
            >
              {boats.map((boat) => {
                const isActive = boat.id === currentBoat.id;
                const displayName =
                  boat.name ||
                  [boat.year, boat.make, boat.model]
                    .filter(Boolean)
                    .join(" ") ||
                  "Untitled boat";

                return (
                  <TouchableOpacity
                    key={boat.id}
                    style={[styles.modalBoatRow, isActive && styles.modalBoatRowActive]}
                    onPress={() => handleSelectBoat(boat)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="car-sport-outline"
                      size={18}
                      color={isActive ? colors.textPrimary : colors.textMuted}
                    />
                    <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                      <Text style={styles.modalBoatName} numberOfLines={1}>
                        {displayName}
                      </Text>
                      {!!boat.location && (
                        <Text style={styles.modalBoatMeta} numberOfLines={1}>
                          {boat.location}
                        </Text>
                      )}
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark" size={18} color={colors.accentGreen} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete boat modal */}
      <Modal
        visible={removeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Remove from my Keepr</Text>
              <TouchableOpacity onPress={() => setRemoveModalVisible(false)}>
                <Ionicons name="close-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalBodyText}>
              This deletes the boat from your Keepr and removes its photos.
            </Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonGhost]}
                onPress={() => setRemoveModalVisible(false)}
                disabled={actionLoading}
              >
                <Text style={styles.modalButtonGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.danger || "#DC2626" }]}
                onPress={handleConfirmRemoveBoat}
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

      {/* Event pill */}
      {currentBoat?.id ? <EventPill contextAssetId={currentBoat.id} /> : null}
          {/* Keepr Pro assignment modal */}
      <Modal
        visible={proPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProPickerVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setProPickerVisible(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={() => {}}
          >
            <Text style={styles.modalTitle}>Assign Keepr Pro</Text>
            <Text style={styles.modalSubtitle}>
              Pick one or more providers to show as the “1-click action” for this asset.
            </Text>

            {allProsLoading ? (
              <View style={{ paddingVertical: spacing.md }}>
                <ActivityIndicator />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {(allPros || []).map((p) => {
                  const selected = (selectedProIds || []).includes(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.proPickRow}
                      onPress={() => togglePro(p.id)}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={20}
                        color={selected ? colors.brandBlue : colors.textSecondary}
                        style={{ marginRight: 10 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.proPickName} numberOfLines={1}>
                          {p.name || "Keepr Pro"}
                        </Text>
                        <Text style={styles.proPickMeta} numberOfLines={1}>
                          {[p.category, p.phone || p.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.proPickViewBtn}
                        onPress={(e) => {
                          if (e?.stopPropagation) e.stopPropagation();
                          openKeeprPro(p);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.proPickViewBtnText}>View</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setProPickerVisible(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={saveAssetKeeprPros}
                activeOpacity={0.85}
              >
                <Text style={styles.modalBtnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
</SafeAreaView>
  );
}

/* --------------------------- STYLES --------------------------- */

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  appTitle: { ...typography.title },
  appSubtitle: { ...typography.subtitle, marginTop: 2 },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
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
  emptyPrimaryBtnText: { color: "white", fontWeight: "700" },
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
  emptySecondaryBtnText: { color: colors.textPrimary, fontWeight: "700" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
    ...shadows.subtle,
  },
  headerTitleCol: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 12, color: colors.textSecondary },

  boatPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  boatPickerLabel: { ...typography.sectionLabel },
  boatPickerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  addBoatCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    marginRight: spacing.sm,
    marginLeft: spacing.sm,
    ...shadows.subtle,
  },

  boatPickerButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.surface,
    ...shadows.subtle,
  },
  boatPickerButtonText: { fontSize: 12, color: colors.textPrimary, marginHorizontal: spacing.xs },

  quickActionsRow: { marginBottom: spacing.md },
  quickActionsScroll: { paddingVertical: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    marginRight: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  chipPrimary: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "500" },
  chipLabelPrimary: { color: "white" },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginRight: 6,
    marginBottom: 6,
  },
  filterChipActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  filterChipLabel: { fontSize: 11, color: colors.textSecondary },
  filterChipLabelActive: { color: "white", fontWeight: "600" },

  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    marginBottom: spacing.lg,
    ...shadows.subtle,
  },

  // Web-wide: split header (hero left, specs right). Mobile stays stacked.
  heroCardWide: {
    flexDirection: "column",
  },
  heroTopRow: {
    flexDirection: "column",
  },
  heroTopRowWide: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  heroLeft: { width: "100%" },
  heroLeftWide: {
    width: "46%",
    borderRightWidth: 1,
    borderRightColor: colors.borderSubtle,
  },
  heroRight: { width: "100%" },
  heroRightWide: { width: "54%" },

  heroImageWrap: {
    width: "100%",
    backgroundColor: colors.surfaceSubtle,
  },
  heroImageWrapMobile: {
    aspectRatio: 4 / 3,
  },
  heroImageWrapWide: {
    height: 300,
  },
  heroImage: { width: "100%", height: "100%" },
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

  // Keeps the existing field/label metadata framework, but presented as a tidy card.
  metaCardWide: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  heroImageWrapper: {
    width: "100%",
    aspectRatio: HERO_ASPECT,
    backgroundColor: colors.surfaceSubtle,
  },
  heroImage: { width: "100%", height: "100%" },
  heroPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroPlaceholderText: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary },

  heroSpinner: {
    position: "absolute",
    right: 10,
    bottom: 10,
    backgroundColor: "rgba(15,23,42,0.65)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  heroMeta: { padding: spacing.md },
  heroTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  heroSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
  heroMetaRow: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm },
  heroMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    marginRight: 6,
    marginBottom: 6,
  },
  heroMetaPillText: { fontSize: 11, color: colors.textSecondary },

  section: { marginTop: spacing.md },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  // HomeStory-style timeline header row
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  metaCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  metaLine: { fontSize: 12, color: colors.textPrimary, marginBottom: 2 },

  storyCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  storyText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },

  timelineList: { marginTop: spacing.sm },
  timelineCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
    ...shadows.subtle,
  },
  timelineIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  timelineTitle: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  timelineMetaRow: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  timelineDescription: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  timelineDate: { fontSize: 11, color: colors.textMuted, marginLeft: spacing.sm },

  historyLoadingRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  historyLoadingText: { marginLeft: spacing.xs, fontSize: 12, color: colors.textSecondary },
  historyErrorText: { marginTop: spacing.sm, fontSize: 12, color: colors.danger },

  emptyHistoryCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
  },
  emptyHistoryTitle: { marginTop: spacing.sm, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  emptyHistoryText: { marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 18 },

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
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  modalBodyText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.sm },

  modalBoatRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalBoatRowActive: { backgroundColor: colors.surfaceSubtle },
  modalBoatName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  modalBoatMeta: { fontSize: 12, color: colors.textMuted },

  modalButtonRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.lg, gap: spacing.sm },
  modalButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", minWidth: 100 },
  modalButtonGhost: { borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface },
  modalButtonGhostText: { color: colors.textPrimary, fontWeight: "600" },
  modalButtonPrimaryText: { color: "white", fontWeight: "700" },
  /* --------------------------- KEEPR PRO --------------------------- */
  proCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
  },
  proRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginTop: spacing.xs,
  },
  proName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  proMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  proMoreRow: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  proMoreText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  assignBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  assignBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.brandWhite,
  },
  emptyInline: {
    marginTop: 2,
  },
  emptyInlineText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  warnText: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },

  /* --------------------------- PRO PICKER MODAL --------------------------- */
  modalSubtitle: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  proPickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  proPickName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  proPickMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  proPickViewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginLeft: spacing.sm,
  },
  proPickViewBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  modalActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  modalBtn: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.sm,
  },
  modalBtnGhostText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  modalBtnPrimary: {
    backgroundColor: colors.brandBlue,
  },
  modalBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.brandWhite,
  },
});
