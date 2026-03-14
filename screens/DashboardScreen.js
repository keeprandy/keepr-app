// screens/DashboardScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAssets } from "../hooks/useAssets";
import { getSignedUrl } from "../lib/attachmentsApi";
import { supabase } from "../lib/supabaseClient";
import { ROUTES } from "../navigation/routes";
import { cardStyles } from "../styles/cards";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing, typography } from "../styles/theme";
import KeeprProgressCard, { buildKeeprProgressModel } from "../components/KeeprProgressCard";

/**
 * Sort helper: prefers explicit sort_rank, then "primary", then created_at, then name.
 */
function sortAssets(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const ra = typeof a.sort_rank === "number" ? a.sort_rank : null;
    const rb = typeof b.sort_rank === "number" ? b.sort_rank : null;
    if (ra !== null || rb !== null) {
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (ra !== rb) return ra - rb;
    }

    const ap = a.is_primary || a.primary || a.metadata?.primary ? 1 : 0;
    const bp = b.is_primary || b.primary || b.metadata?.primary ? 1 : 0;
    if (ap !== bp) return bp - ap;

    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (at !== bt) return at - bt;

    return (a.name || "").localeCompare(b.name || "");
  });
}

function formatBytesMB(mb) {
  if (mb === null || mb === undefined || Number.isNaN(Number(mb))) return "0 MB";
  const n = Number(mb);
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
  return `${n.toFixed(2)} MB`;
}

function legacyHeroUrl(asset) {
  const url =
    asset?.hero_image_url ||
    asset?.heroImageUrl ||
    asset?.thumbnail_url ||
    asset?.image_url ||
    null;

  if (!url) return null;

  // Signed URLs expire. Treat any signed/object URLs as non-authoritative legacy.
  if (
    String(url).includes("/storage/v1/object/sign/") ||
    String(url).includes("/storage/v1/render/image/sign/") ||
    String(url).includes("token=")
  ) {
    return null;
  }

  return url;
}

function isCommercial(asset) {
  return String(asset?.asset_mode || "").toLowerCase() === "commercial";
}

function commercialLabel(asset) {
  if (!isCommercial(asset)) return null;
  const ent = String(asset?.commercial_entity || "").trim();
  return ent ? `Commercial · ${ent}` : "Commercial";
}

/**
 * Resolve hero image URIs for any assets that have hero_placement_id.
 */
async function resolveHeroUrisForAssets(allAssets) {
  const placementIds = (allAssets || [])
    .map((a) => a?.hero_placement_id)
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(placementIds));
  if (!uniqueIds.length) return {};

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment:attachments (
        url,
        bucket,
        storage_path,
        deleted_at
      )
    `
    )
    .in("id", uniqueIds);

  if (error) {
    console.log("Dashboard hero placement lookup error", error);
    return {};
  }

  const map = {};
  for (const row of data || []) {
    const placementId = row?.id;
    const a = row?.attachment;
    if (!placementId || !a || a.deleted_at) continue;

    // Prefer storage_path-based signing (fresh, team-safe). Never trust persisted signed URLs.
    if (a.bucket && a.storage_path) {
      try {
        const signed = await getSignedUrl({
          bucket: a.bucket,
          path: a.storage_path,
          transform: {
            width: 320,
            height: 320,
            resize: "cover",
            quality: 75,
          },
        });
        if (signed) {
          map[placementId] = signed;
          continue;
        }
      } catch (e) {
        console.log("Dashboard hero signed URL error", {
          placementId,
          bucket: a.bucket,
          path: a.storage_path,
          e,
        });
      }
    }

    // Legacy fallback (only if it does NOT look like a signed URL).
    if (a.url && !String(a.url).includes("token=") && !String(a.url).includes("/object/sign/")) {
      map[placementId] = a.url;
    }
  }

  return map;
}

/** Collect route names so we can navigate safely. */
function collectRouteNames(nav) {
  const names = new Set();
  try {
    const s = nav?.getState?.();
    if (s?.routeNames?.length) s.routeNames.forEach((n) => names.add(n));
  } catch {}
  try {
    const p = nav?.getParent?.();
    const ps = p?.getState?.();
    if (ps?.routeNames?.length) ps.routeNames.forEach((n) => names.add(n));
  } catch {}
  return names;
}

/** Try candidates in order, return true on first success. */
function tryNavigateFirst(nav, candidates, params) {
  const names = collectRouteNames(nav);
  for (const name of candidates) {
    if (!name) continue;
    if (names.has(name)) {
      nav.navigate(name, params);
      return true;
    }
  }
  for (const name of candidates) {
    if (!name) continue;
    try {
      nav.navigate(name, params);
      return true;
    } catch {}
  }
  return false;
}

export default function DashboardScreen({ navigation }) {
  const MAX_WIDTH = 1200;
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 900;

  const {
    assets: rawHomes = [],
    loading: lh,
    error: eh,
    refetch: refetchHomes,
  } = useAssets("home");

  const {
    assets: rawVehicles = [],
    loading: lv,
    error: ev,
    refetch: refetchVehicles,
  } = useAssets("vehicle");

  const {
    assets: rawBoats = [],
    loading: lb,
    error: eb,
    refetch: refetchBoats,
  } = useAssets("boat");

  

  const loading = lh || lv || lb;
  const anyError = eh || ev || eb;

  // Base sorted lists from DB
  const homesSorted = useMemo(() => sortAssets(rawHomes), [rawHomes]);
  const vehiclesSorted = useMemo(() => sortAssets(rawVehicles), [rawVehicles]);
  const boatsSorted = useMemo(() => sortAssets(rawBoats), [rawBoats]);

  // Local ordering state (used only while reorderMode is on; kept in sync otherwise)
  const [reorderMode, setReorderMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [homeOrder, setHomeOrder] = useState([]);
  const [vehicleOrder, setVehicleOrder] = useState([]);
  const [boatOrder, setBoatOrder] = useState([]);

  // Hero images
  const [heroUriByPlacementId, setHeroUriByPlacementId] = useState({});
  const [heroResolving, setHeroResolving] = useState(false);


  // Identity / achievements (for avatar + accomplishments card)
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [meId, setMeId] = useState(null);
  const [ach, setAch] = useState(null);
  const [achLoading, setAchLoading] = useState(true);

  // Dashboard Mode
const dashboardMode = useMemo(() => {
  const assetCount = ach?.asset_count || 0;
  const recordCount = ach?.service_record_count || 0;
  const recent = ach?.service_records_30d || 0;

  if (assetCount === 0) return "no_assets";
  if (assetCount > 0 && recordCount === 0) return "no_records";
  if (recordCount > 0 && recent === 0) return "stalled";
  if (recent > 0) return "active";

  return "activation";
}, [ach]);

const [dismissKeeprProgress, setDismissKeeprProgress] = useState(false);

const keeprProgress = useMemo(
  () =>
    buildKeeprProgressModel({
      assetCount: ach?.asset_count,
      systemCount: ach?.system_count,
      recordCount: ach?.service_record_count,
      proofCount: ach?.attachment_count,
    }),
  [ach]
);

// Systems Check - good to go or something else?
const [systemModeSummary, setSystemModeSummary] = useState(null);
const [systemModeLoading, setSystemModeLoading] = useState(false);

const loadSystemModeSummary = useCallback(async () => {
  try {
    setSystemModeLoading(true);

    const { data, error } = await supabase
      .from("event_inbox")
      .select("asset_id, system_id, context")
      .eq("status", "draft");

    if (error) throw error;

    if (!data || data.length === 0) {
      setSystemModeSummary({ status: "all_good" });
      return;
    }

    const modeMap = {};
    const assetSet = new Set();
    const systemSet = new Set();

    for (const row of data) {
      const mode = row?.context?.mode;
      if (!mode) continue;

      assetSet.add(row.asset_id);
      systemSet.add(row.system_id);

      if (!modeMap[mode]) {
        modeMap[mode] = { assets: new Set(), systems: new Set() };
      }

      modeMap[mode].assets.add(row.asset_id);
      modeMap[mode].systems.add(row.system_id);
    }

    setSystemModeSummary({
      status: "active",
      totalAssets: assetSet.size,
      totalSystems: systemSet.size,
      modes: modeMap,
    });
  } catch (e) {
    console.log("System mode summary error", e);
  } finally {
    setSystemModeLoading(false);
  }
}, []);
const handleSystemAttentionPress = useCallback(() => {
  navigation.navigate("Notifications", {
    filter: "draft",      // optional – future-proof
    source: "dashboard",  // optional analytics hook
  });
}, [navigation]);
  const renderSystemModeWidget = useCallback(() => {
    if (systemModeLoading) return null;
    if (!systemModeSummary) return null;

    // Keep this subtle: only show when something needs attention.
    if (systemModeSummary.status !== "active") return null;

    const sys = Number(systemModeSummary.totalSystems || 0);
    const assets = Number(systemModeSummary.totalAssets || 0);
    if (!sys) return null;

return (
  <ModeWidget
    icon="bandage-outline"
    title={`${sys} system${sys === 1 ? "" : "s"} need attention`}
    subtitle="Tap to review and complete."
    onPress={handleSystemAttentionPress}
  />
);
  }, [systemModeLoading, systemModeSummary]);

  // Add asset picker
  const [addPickerVisible, setAddPickerVisible] = useState(false);

  const allAssets = useMemo(
    () => [...homesSorted, ...vehiclesSorted, ...boatsSorted],
    [homesSorted, vehiclesSorted, boatsSorted]
  );

  // Keep reorder lists in sync when not actively reordering
  useEffect(() => {
    if (!reorderMode) {
      setHomeOrder(homesSorted);
      setVehicleOrder(vehiclesSorted);
      setBoatOrder(boatsSorted);
    }
  }, [homesSorted, vehiclesSorted, boatsSorted, reorderMode]);

  const homes = reorderMode ? homeOrder : homesSorted;
  const vehicles = reorderMode ? vehicleOrder : vehiclesSorted;
  const boats = reorderMode ? boatOrder : boatsSorted;

  // Hero resolution
  const refreshHeroUris = useCallback(async () => {
    if (!allAssets.length) {
      setHeroUriByPlacementId({});
      return;
    }
    setHeroResolving(true);
    try {
      const map = await resolveHeroUrisForAssets(allAssets);
      // Merge into existing cache so unchanged URIs remain stable (prevents flicker)
      setHeroUriByPlacementId((prev) => {
        const safePrev = prev || {};
        const safeMap = map || {};
        const next = { ...safePrev, ...safeMap };
        // Avoid render loops: if nothing changed, keep previous reference.
        const prevKeys = Object.keys(safePrev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length === nextKeys.length) {
          let same = true;
          for (const k of nextKeys) {
            if (safePrev[k] !== next[k]) { same = false; break; }
          }
          if (same) return prev;
        }
        return next;
      });
    } finally {
      setHeroResolving(false);
    }
  }, [allAssets]);

  useEffect(() => {
    // Re-resolve hero URIs whenever the assets list changes (new asset, new hero, etc.)
    refreshHeroUris();
  }, [allAssets, refreshHeroUris]);

  const getAssetHeroImage = useCallback(
    (asset) => {
      const placementId = asset?.hero_placement_id || null;

      // If an asset has a placement-driven hero, we only trust the placement resolution.
      // (hero_image_url is typically a signed URL and may be expired / not team-safe.)
      if (placementId) {
        return heroUriByPlacementId?.[placementId] || null;
      }

      return legacyHeroUrl(asset);
    },
    [heroUriByPlacementId]
  );

  /* ---- Navigation helpers ---- */

  const goHome = () => navigation.navigate(ROUTES.HOME);
  const goGarage = () => navigation.navigate(ROUTES.GARAGE);
  const goBoats = () => navigation.navigate(ROUTES.BOATS);
  const goPros = () => navigation.navigate(ROUTES.KEEPR_PROS);

  const goNotifications = () => {
    const parent = navigation.getParent?.();
    (parent || navigation).navigate(ROUTES.NOTIFICATIONS);
  };

  const goCreateEvent = () => {
    const parent = navigation.getParent?.() || navigation;
    parent.navigate(ROUTES.CREATE_EVENT || "CreateEvent", { afterSave: "Notifications" });
  };

  const hydrateAvatarFromAttachmentId = useCallback(
    async (attachmentId) => {
      try {
        if (!attachmentId) {
          setAvatarUrl(null);
          return;
        }
        const { data, error } = await supabase
          .from("attachments")
          .select("id, bucket, storage_path, url")
          .eq("id", attachmentId)
          .maybeSingle();

        if (error) throw error;

        if (data?.url) {
          setAvatarUrl(data.url);
          return;
        }

        if (!data?.bucket || !data?.storage_path) {
          setAvatarUrl(null);
          return;
        }

        const { data: signed, error: sErr } = await supabase.storage
          .from(data.bucket)
          .createSignedUrl(data.storage_path, 60 * 60 * 24 * 7);

        if (sErr) throw sErr;
        setAvatarUrl(signed?.signedUrl || null);
      } catch (e) {
        console.log("Dashboard avatar signed URL error", e);
        setAvatarUrl(null);
      }
    },
    [setAvatarUrl]
  );

  
  const loadIdentityAndAchievements = useCallback(async () => {
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const u = userRes?.user || null;
      if (!u?.id) {
        setProfileName("");
        setAvatarUrl(null);
        setMeId(null);
        setAch(null);
        return;
      }

      setMeId(u.id);

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, full_name, display_name, profile_photo_attachment_id")
        .eq("id", u.id)
        .maybeSingle();

      if (profErr) throw profErr;

      const name = prof?.display_name || prof?.full_name || "";
      setProfileName(name);

      if (prof?.profile_photo_attachment_id) {
        await hydrateAvatarFromAttachmentId(prof.profile_photo_attachment_id);
      } else {
        setAvatarUrl(null);
      }

      setAchLoading(true);
      const { data: achData, error: achErr } = await supabase.rpc("get_my_achievements");
      if (achErr) throw achErr;
      const row = Array.isArray(achData) ? achData[0] : achData;
      setAch(row || null);
    } catch (e) {
      console.log("Dashboard identity/achievements load error", e);
    } finally {
      setAchLoading(false);
    }
  }, [hydrateAvatarFromAttachmentId]);

  useEffect(() => {
    loadIdentityAndAchievements();
  }, [loadIdentityAndAchievements]);

  useEffect(() => {
  loadSystemModeSummary();
}, [loadSystemModeSummary]);



  const goProfile = useCallback(() => {
    tryNavigateFirst(navigation, ["Profile", "ProfileScreen", "UserProfile", "AccountProfile"], {});
  }, [navigation]);

  const goStory = (type, asset) => {
    if (!asset?.id) return;
    navigation.navigate(
      type === "home" ? "HomeStory" : type === "vehicle" ? "VehicleStory" : "BoatStory",
      {
        [`${type}Id`]: asset.id,
        [`${type}Name`]: asset.name,
      }
    );
  };

  const goGroup = useCallback(
    (assetType) => navigation.navigate("AssetGroupDashboard", { assetType }),
    [navigation]
  );

  /* ---- Add asset flow ---- */

  const goAddHome = useCallback(() => {
    const ok = tryNavigateFirst(
      navigation,
      ["AddHomeAsset", "AddHome", "CreateHome", "AddHomeScreen"],
      {}
    );
    if (!ok) goHome();
  }, [navigation]);

  const goAddVehicle = useCallback(() => {
    const ok = tryNavigateFirst(
      navigation,
      ["AddVehicleAsset", "AddVehicle", "CreateVehicle", "AddVehicleScreen"],
      {}
    );
    if (!ok) goGarage();
  }, [navigation]);

  const goAddBoat = useCallback(() => {
    const ok = tryNavigateFirst(
      navigation,
      ["AddMarineAsset", "AddBoat", "CreateBoat", "AddBoatScreen"],
      {}
    );
    if (!ok) goBoats();
  }, [navigation]);

  const openAddAssetPicker = useCallback(() => {
    const options = ["Home", "Vehicle", "Boat", "Cancel"];
    const cancelButtonIndex = 3;

    const go = (idx) => {
      if (idx === 0) return goAddHome();
      if (idx === 1) return goAddVehicle();
      if (idx === 2) return goAddBoat();
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, title: "Add an asset" },
        (idx) => {
          if (idx === cancelButtonIndex) return;
          go(idx);
        }
      );
      return;
    }

    if (Platform.OS === "web") {
      setAddPickerVisible(true);
      return;
    }

    Alert.alert("Add an asset", "Choose a type", [
      { text: "Home", onPress: () => go(0) },
      { text: "Vehicle", onPress: () => go(1) },
      { text: "Boat", onPress: () => go(2) },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [goAddHome, goAddVehicle, goAddBoat]);

  const handleKeeprProgressPress = useCallback(() => {
    const next = keeprProgress?.nextStep;

    if (next === "asset") {
      openAddAssetPicker();
      return;
    }

    if (next === "system" || next === "record" || next === "proof") {
      const firstAsset = homesSorted?.[0] || vehiclesSorted?.[0] || boatsSorted?.[0] || null;

      if (!firstAsset?.id) {
        openAddAssetPicker();
        return;
      }

      const type = homesSorted.some((a) => a.id === firstAsset.id)
        ? "home"
        : vehiclesSorted.some((a) => a.id === firstAsset.id)
        ? "vehicle"
        : "boat";

      goStory(type, firstAsset);
      return;
    }

    goProfile();
  }, [
    keeprProgress,
    openAddAssetPicker,
    homesSorted,
    vehiclesSorted,
    boatsSorted,
    goProfile,
  ]);
  const restartGuidedSetup = async () => {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    await supabase
      .from("profiles")
      .update({ onboarding_completed: false })
      .eq("id", user.id);

    navigation.replace("KaiWelcome");
  } catch (err) {
    console.log("Restart onboarding failed", err);
  }
};

  /* ---- Reorder helpers ---- */

  const moveAsset = useCallback(
    (type, index, delta) => {
      if (!reorderMode) return;

      const move = (arr) => {
        const to = index + delta;
        if (to < 0 || to >= arr.length) return arr;
        const next = [...arr];
        const [item] = next.splice(index, 1);
        next.splice(to, 0, item);
        return next;
      };

      if (type === "home") {
        setHomeOrder((prev) => move(prev));
      } else if (type === "vehicle") {
        setVehicleOrder((prev) => move(prev));
      } else if (type === "boat") {
        setBoatOrder((prev) => move(prev));
      }
    },
    [reorderMode]
  );

  const startReorder = useCallback(() => {
    setHomeOrder(homesSorted);
    setVehicleOrder(vehiclesSorted);
    setBoatOrder(boatsSorted);
    setReorderMode(true);
  }, [homesSorted, vehiclesSorted, boatsSorted]);

  const cancelReorder = useCallback(() => {
    // Just exit the mode; the DB order stays as last saved
    setReorderMode(false);
  }, []);

  const saveReorder = useCallback(async () => {
    try {
      setSavingOrder(true);

      const makeUpdates = (list) =>
        list.map((asset, index) => ({
          id: asset.id,
          sort_rank: index + 1,
        }));

      const updates = [
        ...makeUpdates(homeOrder),
        ...makeUpdates(vehicleOrder),
        ...makeUpdates(boatOrder),
      ];

      if (!updates.length) {
        return;
      }

      // UPDATE only – avoids INSERT/RLS problems from upsert
      for (const u of updates) {
        const { error } = await supabase
          .from("assets")
          .update({ sort_rank: u.sort_rank })
          .eq("id", u.id);

        if (error) {
          throw error;
        }
      }

      // 🔁 Refetch so Dashboard sees the new order immediately
      await Promise.all([refetchHomes?.(), refetchVehicles?.(), refetchBoats?.()]);
    } catch (e) {
      console.log("Save asset order error", e);
      Alert.alert("Couldn't save order", "Please try again.");
    } finally {
      setSavingOrder(false);
      // ✅ Leave reorder mode after save
      setReorderMode(false);
    }
  }, [homeOrder, vehicleOrder, boatOrder, refetchHomes, refetchVehicles, refetchBoats]);

  /* ---- Circle strip model ---- */

  const circles = useMemo(() => {
    const items = [];
    items.push({ id: "add-asset", kind: "add", label: "Add" });

    const pushAsset = (asset, type) => {
      items.push({
        id: `${type}-${asset.id}`,
        kind: "asset",
        type,
        asset,
        label: (asset?.name || type).slice(0, 12),
      });
    };

    homesSorted.forEach((h) => pushAsset(h, "home"));
    vehiclesSorted.forEach((v) => pushAsset(v, "vehicle"));
    boatsSorted.forEach((b) => pushAsset(b, "boat"));

    return items;
  }, [homesSorted, vehiclesSorted, boatsSorted]);

  const MAX_PREVIEW_WEB = 20;
  const MAX_PREVIEW_NATIVE = 10;
  const MAX_PREVIEW = Platform.OS === "web" ? MAX_PREVIEW_WEB : MAX_PREVIEW_NATIVE;

  const topHomes = homes.slice(0, MAX_PREVIEW);
  const topVehicles = vehicles.slice(0, MAX_PREVIEW);
  const topBoats = boats.slice(0, MAX_PREVIEW);

  // V1 ownership markers (UI only): owner vs. shared/collaborative
  const getOwnershipBadges = useCallback(
    (asset) => {
      const ownerId = asset?.owner_id || asset?.ownerId || null;
      const isOwner = !!meId && !!ownerId && ownerId === meId;
      // V1: treat any non-owner visible asset as shared/collaborative.
      const isShared = !!meId && !!ownerId && ownerId !== meId;
      return { isOwner, isShared };
    },
    [meId]
  );

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading your worlds…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const scrollContainerStyle = [
    styles.scroll,
    Platform.OS === "web" && { maxWidth: MAX_WIDTH, alignSelf: "center", width: "100%" },
  ];

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.root}>
        <BackgroundWash />

        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={scrollContainerStyle} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.headerWrap}>
              {isWide ? (
                <View style={styles.headerWebRow}>
                  {/* Left: identity + headlines + chips */}
                  <View style={styles.headerLeft}>
                    <View style={styles.headerTopRow}>
                      <TouchableOpacity
                        style={isWide ? styles.avatarBtnWide : styles.avatarBtn}
                        onPress={goProfile}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Open profile"
                      >
                        {typeof avatarUrl === "string" && avatarUrl.length > 0 ? (
                            <Image source={{ uri: avatarUrl }} style={isWide ? styles.avatarImgWide : styles.avatarImg} />
                          ) : (
                          <View style={styles.avatarStub}>
                            <Ionicons name="person-outline" size={30} color={colors.textMuted} />
                          </View>
                        )}
                      </TouchableOpacity>

                      <View style={styles.headerTextBlock}>
                        <Text style={styles.title}>My Keepr™ Home Dashboard</Text>
                        <Text style={styles.subtitle}>The living story of what you own...and share.</Text>
                      </View>
                    </View>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.worldChipsRow}
                    >
                      <WorldChip icon="home-outline" label="Home" count={homesSorted.length} onPress={goHome} />
                      <WorldChip icon="car-outline" label="Garage" count={vehiclesSorted.length} onPress={goGarage} />
                      <WorldChip icon="boat-outline" label="Water" count={boatsSorted.length} onPress={goBoats} />
                    </ScrollView>

                    <View style={{ marginTop: spacing.md, maxWidth: 640 }}>
                      <AchievementsCard
                        ach={ach}
                        loading={achLoading}
                        dashboardMode={dashboardMode}
                        onPress={goProfile}
                      />
                    </View>

                    {!dismissKeeprProgress ? (
                      <View style={{ marginTop: spacing.md, maxWidth: 640 }}>
                      <KeeprProgressCard
                        progress={keeprProgress}
                        loading={achLoading}
                        onPress={handleKeeprProgressPress}
                        onRestartGuidedSetup={restartGuidedSetup}
                        onDismiss={keeprProgress?.complete ? () => setDismissKeeprProgress(true) : null}
                      />                    
                      </View>
                    ) : null}
                  </View>

                  {/* Right: fluid signals */}
                  <View style={styles.headerRight}>
                    <View style={styles.headerRightCol}>
                      {renderSystemModeWidget()}
                    </View>
                  </View>
                </View>
              ) : (
                <View>
                  <View style={styles.headerMobileTop}>
                    <TouchableOpacity
                      style={isWide ? styles.avatarBtnWide : styles.avatarBtn}
                      onPress={goProfile}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel="Open profile"
                    >
                      {typeof avatarUrl === "string" && avatarUrl.length > 0 ? (
                          <Image source={{ uri: avatarUrl }} style={isWide ? styles.avatarImgWide : styles.avatarImg} />
                        ) : (
                        <View style={styles.avatarStub}>
                          <Ionicons name="person" size={20} color={colors.textMuted} />
                        </View>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.iconBtn, { marginLeft: "auto" }]}
                      onPress={goNotifications}
                      activeOpacity={0.9}
                      accessibilityRole="button"
                      accessibilityLabel="Notifications"
                    >
                      <Ionicons name="notifications-outline" size={26} color={colors.textPrimary} />
                      <View style={styles.dot} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.title}>My Keepr™ Home Dashboard</Text>
                  <Text style={styles.subtitle}>The living story of what you own....and share.</Text>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.worldChipsRow}
                  >
                    <WorldChip icon="home-outline" label="Home" count={homesSorted.length} onPress={goHome} />
                    <WorldChip icon="car-outline" label="Garage" count={vehiclesSorted.length} onPress={goGarage} />
                    <WorldChip icon="boat-outline" label="Water" count={boatsSorted.length} onPress={goBoats} />
                  </ScrollView>

                  {!dismissKeeprProgress ? (
                    <View style={{ marginTop: spacing.md }}>
                      <KeeprProgressCard
                        progress={keeprProgress}
                        loading={achLoading}
                        onPress={handleKeeprProgressPress}
                        onDismiss={keeprProgress?.complete ? () => setDismissKeeprProgress(true) : null}
                      />
                    </View>
                  ) : null}

                  <View style={{ marginTop: spacing.md }}>
                    <AchievementsCard
                      ach={ach}
                      loading={achLoading}
                      dashboardMode={dashboardMode}
                      onPress={goProfile}
                    />
                  </View>

                  {/* System modes (subtle) */}
                  {renderSystemModeWidget()}

                  {/* Dashboard mode prompts (lightweight, after status) */}
                  {dashboardMode === "activation" && (
                    <ModeWidget
                      icon="add-circle-outline"
                      title="Start your Keepr"
                      subtitle="Add your first asset and begin building your ownership story."
                      onPress={openAddAssetPicker}
                      subtle
                    />
                  )}

                  {dashboardMode === "stalled" && (
                    <ModeWidget
                      icon="time-outline"
                      title="Keep your story current"
                      subtitle="Nothing added in the last 30 days."
                      onPress={goCreateEvent}
                      subtle
                    />
                  )}
                </View>
              )}
            </View>

            {anyError ? (
              <View style={styles.warnCard}>
                <Ionicons name="warning-outline" size={18} color={colors.textMuted} />
                <Text style={styles.warnText}>Some items didn’t load. Pull to refresh or try again.</Text>
              </View>
            ) : null}

            {/* HERO CIRCLES STRIP */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.cardTitle}>Your Assets: Keepr™ enabled!</Text>
                <View style={styles.sectionHeaderRight}>
                  {!reorderMode && heroResolving ? (
                    <View style={styles.syncRow}>
                      <ActivityIndicator size="small" color={colors.textMuted} />
                      <Text style={styles.syncText}>Syncing</Text>
                    </View>
                  ) : null}
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={goNotifications}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                        accessibilityLabel="Notifications"
                      >
                        <Ionicons name="notifications-outline" size={26} color={colors.textPrimary} />
                        <View style={styles.dot} />
                      </TouchableOpacity>
                  {reorderMode ? (
                    <View style={styles.reorderActionsRow}>
                      {savingOrder && (
                        <ActivityIndicator size="small" color={colors.textMuted} style={{ marginRight: 6 }} />
                      )}
                      <TouchableOpacity
                        style={[styles.reorderBtn, styles.reorderBtnPrimary]}
                        onPress={saveReorder}
                        disabled={savingOrder}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.reorderBtnPrimaryText}>Save order</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.reorderBtn, styles.reorderBtnSecondary]}
                        onPress={cancelReorder}
                        disabled={savingOrder}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.reorderBtnSecondaryText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.reorderToggle} onPress={startReorder} activeOpacity={0.9}>
                      <Ionicons name="reorder-three-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.reorderToggleText}>Reorder</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circlesRow}>
                {circles.map((c) => {
                  if (c.kind === "add") {
                    return (
                      <Pressable key={c.id} style={styles.circleItem} onPress={openAddAssetPicker}>
                        <View style={[styles.circle, styles.circleAdd]}>
                          <Ionicons name="add" size={20} color="#fff" />
                        </View>
                        <Text style={styles.circleLabel} numberOfLines={1}>
                          Add Asset
                        </Text>
                      </Pressable>
                    );
                  }

                  const uri = getAssetHeroImage(c.asset);
                  const badgeIcon = c.type === "home" ? "home" : c.type === "vehicle" ? "car" : "boat";
                  const showBiz = isCommercial(c.asset);
                  const { isOwner, isShared } = getOwnershipBadges(c.asset);

                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.circleItem}
                      activeOpacity={0.9}
                      onPress={() => goStory(c.type, c.asset)}
                    >
                      <View style={styles.circleWrapper}>
                        <View style={styles.circle}>
                          {typeof uri === "string" && uri.length > 0 ? (
                            <Image source={{ uri }} style={styles.circleImg} />
                          ) : (
                            <View style={styles.circleStub}>
                              <Ionicons
                                name={
                                  c.type === "home"
                                    ? "home-outline"
                                    : c.type === "vehicle"
                                    ? "car-outline"
                                    : "boat-outline"
                                }
                                size={48}
                                color="#fff"
                              />
                            </View>
                          )}
                        </View>

                        {/* type badge */}
                        <View style={styles.circleBadge}>
                          <Ionicons name={badgeIcon} size={18} color="#fff" />
                        </View>

                        {/* shared/team badge */}
                        {isShared ? (
                          <View style={styles.circleShareBadge} pointerEvents="none">
                            <Ionicons name="share-social-outline" size={16} color="#0f172a" />
                          </View>
                        ) : null}

                        {/* owner badge */}
                        {isOwner ? (
                          <View style={styles.circleOwnerBadge} pointerEvents="none">
                            <Ionicons name="ribbon-outline" size={16} color="#0f172a" />
                          </View>
                        ) : null}

                        {/* commercial badge */}
                        {showBiz ? (
                          <View style={styles.circleModeBadge} pointerEvents="none">
                            <Ionicons name="briefcase-outline" size={18} color="rgba(15,23,42,0.78)" />
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.circleLabel} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.circlesHint}>
                Tip: add a hero photo in Showcase — it becomes your asset thumbnail everywhere.
              </Text>
            </View>

            {/* Sections */}
            <Text style={styles.cardTitle}>Homes</Text>
            <AssetSection
              label="Properties"
              hint="Primary Home, Second Homes, and Rental Properties"
              icon="home-outline"
              onViewAll={() => goGroup("home")}
              items={topHomes}
              emptyText="Add your home to start tracking Home Systems, Repair and Improvements."
              renderItem={(a, index) => (
                (() => {
                  const { isOwner, isShared } = getOwnershipBadges(a);
                  return (
                    <AssetRowCard
                      key={a.id}
                      title={a?.name || "Home"}
                      subtitle={a?.location || "Open story"}
                      modeLine={commercialLabel(a)}
                      icon="home-outline"
                      image={getAssetHeroImage(a)}
                      isOwner={isOwner}
                      isShared={isShared}
                      onPress={() => goStory("home", a)}
                      reorderMode={reorderMode}
                      onMoveUp={reorderMode && index > 0 ? () => moveAsset("home", index, -1) : null}
                      onMoveDown={
                        reorderMode && index < topHomes.length - 1 ? () => moveAsset("home", index, 1) : null
                      }
                    />
                  );
                })()
              )}
            />

            <Text style={styles.cardTitle}>Vehicles</Text>
            <AssetSection
              label="In the Garage"
              hint="Vehicles, Motorcycles, RV's, Golf Cart, Mower..."
              icon="car-outline"
              onViewAll={() => goGroup("vehicle")}
              items={topVehicles}
              emptyText="Add a vehicle to log service, warranties, upgrades, and proof."
              renderItem={(a, index) => (
                (() => {
                  const { isOwner, isShared } = getOwnershipBadges(a);
                  return (
                    <AssetRowCard
                      key={a.id}
                      title={a?.name || "Vehicle"}
                      subtitle={
                        a?.make || a?.model
                          ? `${a?.year ? a.year + " " : ""}${a?.make || ""} ${a?.model || ""}`.trim()
                          : "Open story"
                      }
                      modeLine={commercialLabel(a)}
                      icon="car-outline"
                      image={getAssetHeroImage(a)}
                      isOwner={isOwner}
                      isShared={isShared}
                      onPress={() => goStory("vehicle", a)}
                      reorderMode={reorderMode}
                      onMoveUp={reorderMode && index > 0 ? () => moveAsset("vehicle", index, -1) : null}
                      onMoveDown={
                        reorderMode && index < topVehicles.length - 1 ? () => moveAsset("vehicle", index, 1) : null
                      }
                    />
                  );
                })()
              )}
            />

            <Text style={styles.cardTitle}>Boats</Text>
            <AssetSection
              label="On the Water"
              hint="Boats and Water Craft"
              icon="boat-outline"
              color={colors.accentBlue}
              onViewAll={() => goGroup("boat")}
              items={topBoats}
              emptyText="Add your boat to capture the story and maintain its value."
              renderItem={(a, index) => (
                (() => {
                  const { isOwner, isShared } = getOwnershipBadges(a);
                  return (
                    <AssetRowCard
                      key={a.id}
                      title={a?.name || "Boat"}
                      subtitle={
                        a?.make || a?.model
                          ? `${a?.year ? a.year + " " : ""}${a?.make || ""} ${a?.model || ""}`.trim()
                          : "Open story"
                      }
                      modeLine={commercialLabel(a)}
                      icon="boat-outline"
                      image={getAssetHeroImage(a)}
                      isOwner={isOwner}
                      isShared={isShared}
                      onPress={() => goStory("boat", a)}
                      reorderMode={reorderMode}
                      onMoveUp={reorderMode && index > 0 ? () => moveAsset("boat", index, -1) : null}
                      onMoveDown={
                        reorderMode && index < topBoats.length - 1 ? () => moveAsset("boat", index, 1) : null
                      }
                    />
                  );
                })()
              )}
            />

            {/* Pros */}
            <View style={styles.section}>
              <Text style={styles.cardTitle}>KeeprPros</Text>
              <Text style={styles.cardSub}>People you trust</Text>
              <Text style={styles.cardSub}> </Text>
              <TouchableOpacity style={styles.glassCard} onPress={goPros} activeOpacity={0.92}>
                <Ionicons name="construct" size={50} color={colors.accentBlue} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={styles.cardSub}>
                    Mechanics, marinas, pool techs — that help you care for your assets.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={{ height: 90 }} />
          </ScrollView>

          {/* Web add-asset picker modal */}
          <Modal
            visible={addPickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setAddPickerVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setAddPickerVisible(false)}>
              <Pressable style={styles.modalCard} onPress={() => {}}>
                <Text style={styles.modalTitle}>Add an asset</Text>

                <Pressable
                  style={styles.modalBtn}
                  onPress={() => {
                    setAddPickerVisible(false);
                    goAddHome();
                  }}
                >
                  <Ionicons name="home-outline" size={24} color={colors.textPrimary} />
                  <Text style={styles.modalBtnText}>Home</Text>
                </Pressable>

                <Pressable
                  style={styles.modalBtn}
                  onPress={() => {
                    setAddPickerVisible(false);
                    goAddVehicle();
                  }}
                >
                  <Ionicons name="car-outline" size={24} color={colors.textPrimary} />
                  <Text style={styles.modalBtnText}>Vehicle</Text>
                </Pressable>

                <Pressable
                  style={styles.modalBtn}
                  onPress={() => {
                    setAddPickerVisible(false);
                    goAddBoat();
                  }}
                >
                  <Ionicons name="boat-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.modalBtnText}>Boat</Text>
                </Pressable>

                <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setAddPickerVisible(false)}>
                  <Text style={[styles.modalBtnText, { fontWeight: "900" }]}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>

          {/* FAB */}
          <TouchableOpacity style={styles.fab} onPress={goCreateEvent} activeOpacity={0.95}>
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.fabText}>Add Event </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* ---- Small components ---- */
function ModeWidget({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity
      style={styles.modeWidget}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <Ionicons name={icon} size={22} color={colors.brandBlue} />
      <View style={{ marginLeft: 10, flex: 1 }}>
        <Text style={styles.modeTitle}>{title}</Text>
        <Text style={styles.modeSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
function AchievementsCard({ ach, loading, dashboardMode, onPress }) {
  return (
    <TouchableOpacity
      style={styles.achCard}
      activeOpacity={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View achievements"
    >
      <View style={styles.achTopRow}>
        <Text style={styles.achTitle}>Ownership Status: Owned</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>

      {loading ? (
        <Text style={styles.achMuted}>Loading…</Text>
      ) : ach ? (
        <>
          <Text style={styles.achStats}>
            <Text style={styles.achStrong}>{ach.asset_count}</Text> assets ·{" "}
            <Text style={styles.achStrong}>{ach.system_count}</Text> systems ·{" "}
            <Text style={styles.achStrong}>{ach.service_record_count}</Text> records ·{" "}
            <Text style={styles.achStrong}>{ach.attachment_count}</Text> attachments ·{" "}
            <Text style={styles.achStrong}>
              {typeof ach.attachment_mb === "number" ? ach.attachment_mb.toFixed(2) : ach.attachment_mb}
            </Text>{" "}
            MB
          </Text>
          {dashboardMode === "no_assets" && (
            <Text style={styles.achMuted}>
              Start by adding your first asset to begin documenting your ownership.
            </Text>
          )}

          {dashboardMode === "no_records" && (
            <Text style={styles.achMuted}>
              Great start. Add your first record to build your ownership story.
            </Text>
          )}

          {dashboardMode === "stalled" && (
            <Text style={styles.achMuted}>
              Your documentation exists. Add a new record to stay protected.
            </Text>
          )}

          {dashboardMode === "active" && (
            <Text style={styles.achMomentum}>
              Protection Level: Active — your documentation is current.
            </Text>
          )}
        {dashboardMode === "active" && ach.service_records_30d > 0 && (
          <Text style={styles.achMomentum}>
            Momentum — {ach.service_records_30d} records added in the last 30 days.
          </Text>
        )}
        </>
      ) : (
        <Text style={styles.achMuted}>Add assets and proof to build your story.</Text>
      )}
    </TouchableOpacity>
  );
}

function BackgroundWash() {
  return (
    <View pointerEvents="none" style={styles.bgWrap}>
      <View style={styles.bgMidFade} />
      <View style={styles.bgBottomFade} />
    </View>
  );
}

function WorldChip({ icon, label, count, onPress }) {
  return (
    <TouchableOpacity style={styles.worldChip} onPress={onPress} activeOpacity={0.9}>
      <Ionicons name={icon} size={14} color={colors.textSecondary} />
      <Text style={styles.worldChipText}>
        <Text style={styles.worldChipNum}>{count}</Text> {label}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function AssetSection({ label, hint, icon, onViewAll, items, emptyText, renderItem }) {
  const hasItems = (items?.length || 0) > 0;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Ionicons name={icon} size={24} color={colors.textSecondary} />
          <View style={{ marginLeft: spacing.xs }}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <Text style={styles.sectionHint}>{hint}</Text>
          </View>
        </View>

        <TouchableOpacity onPress={onViewAll} style={styles.viewAllBtn} activeOpacity={0.9}>
          <Text style={styles.viewAllText}>View all</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {!hasItems ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <View style={{ marginTop: spacing.xs }}>{items.map((item, index) => renderItem(item, index))}</View>
      )}
    </View>
  );
}

function AssetRowCard({ title, subtitle, modeLine, icon, image, isOwner, isShared, onPress, reorderMode, onMoveUp, onMoveDown }) {
  return (
    <TouchableOpacity
      style={styles.assetRowCard}
      onPress={reorderMode ? undefined : onPress}
      activeOpacity={reorderMode ? 1 : 0.92}
    >
      <View style={styles.assetThumb}>
        {typeof image === "string" && image.length > 0 ? (
          <Image source={{ uri: image }} style={styles.assetThumbImg} />
        ) : (
          <View style={styles.assetThumbStub}>
            <Ionicons name={icon} size={18} color="#fff" />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.assetRowTitleRow}>
          <Text style={styles.assetRowTitle} numberOfLines={1}>
            {title}
          </Text>
          {isShared ? (
            <View style={styles.assetBadge} pointerEvents="none">
              <Ionicons name="share-social-outline" size={14} color={colors.textMuted} />
            </View>
          ) : null}
          {isOwner ? (
            <View style={styles.assetBadge} pointerEvents="none">
              <Ionicons name="ribbon-outline" size={14} color={colors.textMuted} />
            </View>
          ) : null}
        </View>
        <Text style={styles.assetRowSub} numberOfLines={1}>
          {subtitle}
        </Text>

        {modeLine ? (
          <View style={styles.assetModeRow}>
            <Ionicons name="briefcase-outline" size={12} color={colors.textMuted} />
            <Text style={styles.assetModeText} numberOfLines={1}>
              {modeLine}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.assetRowRight}>
        {reorderMode ? (
          <View style={styles.reorderHandleCol}>
            <TouchableOpacity
              onPress={onMoveUp || undefined}
              disabled={!onMoveUp}
              style={[styles.reorderArrowBtn, !onMoveUp && styles.reorderArrowDisabled]}
            >
              <Ionicons name="chevron-up" size={14} color={onMoveUp ? colors.textMuted : colors.borderSubtle} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onMoveDown || undefined}
              disabled={!onMoveDown}
              style={[styles.reorderArrowBtn, !onMoveDown && styles.reorderArrowDisabled]}
            >
              <Ionicons name="chevron-down" size={14} color={onMoveDown ? colors.textMuted : colors.borderSubtle} />
            </TouchableOpacity>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

/* ---- Styles ---- */

const styles = StyleSheet.create({
root: {
  flex: 1,
  position: "relative",
  backgroundColor: colors.background, // or your standard dashboard color
},
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
  },

  headerWrap: {
    marginBottom: spacing.sm,
  },
headerWebRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.md,
  marginBottom: spacing.sm, // add this
},

  headerLeft: { flex: 1, minWidth: 0 },
  headerRight: { justifyContent: "flex-start", alignItems: "flex-end" },
  headerRightRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerRightCol: { width: 420, maxWidth: "100%", gap: spacing.sm },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.sm },
  headerTextBlock: { flex: 1, minWidth: 0 },
  headerMobileTop: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  header: {
    flexDirection: "row",
    marginBottom: 0,
    alignItems: "center",
  },
  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    ...cardStyles.shadowSoft,
  },
  avatarImg: {
    width: 44,
    height: 44,
    borderRadius: 44,
    alignItems: "center",
  },
  avatarStub: {
    width: 88,
    height: 88,
    backgroundColor: "rgba(15,23,42,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },
  worldChipsRow: {
    paddingTop: spacing.sm,
    paddingBottom: 2,
    paddingRight: spacing.md,
    gap: spacing.xs,
    alignItems: "center",
  },
  worldChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: 8,
  },
  worldChipText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  worldChipNum: {
    color: colors.textPrimary,
    fontWeight: "900",
  },

  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },

  warnCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  warnText: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
  },

  section: {
    marginTop: spacing.sm,
  },
  sectionLabel: {
    ...typography.sectionLabel,
  },
  sectionHint: {
    fontSize: 11,
    color: colors.textMuted,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sectionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  viewAllText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
  },

  circleWrapper: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  circlesRow: {
    paddingVertical: spacing.sm,
  },
  circleItem: {
    width: 72,
    marginRight: 10,
    marginLeft: 5,
    alignItems: "center",
  },
  circle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(32, 60, 137, 0.85)",
    backgroundColor: "rgba(15,23,42,0.18)",
    ...cardStyles.shadowSoft,
  },

  circleAdd: {
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.brandBlue,
  },
  circleImg: {
    width: "100%",
    height: "100%",
  },
  circleStub: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.accentBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  circleBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(8, 10, 86, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    zIndex: 20,
  },

  // New: shared/team + owner markers on circles (subtle)
  circleShareBadge: {
    position: "absolute",
    left: -2,
    top: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    zIndex: 22,
  },
  circleOwnerBadge: {
    position: "absolute",
    left: 26,
    top: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    zIndex: 22,
  },

  // New: commercial marker on circles
  circleModeBadge: {
    position: "absolute",
    left: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    zIndex: 21,
  },

  circleLabel: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  circlesHint: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
  },

  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  syncText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
  },

  reorderToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  reorderToggleText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
    marginLeft: 4,
  },
  reorderActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reorderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  reorderBtnPrimary: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  reorderBtnPrimaryText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "800",
  },
  reorderBtnSecondary: {
    backgroundColor: "#ffffff",
    borderColor: colors.borderSubtle,
  },
  reorderBtnSecondaryText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
  },

  emptyCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },

  assetRowCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
    ...cardStyles.shadowSoft,
    gap: spacing.sm,
  },
  assetThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.15)",
  },
  assetThumbImg: {
    width: "100%",
    height: "100%",
  },
  assetThumbStub: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.accentBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  assetRowTitle: {
    fontWeight: "800",
    fontSize: 14,
    color: colors.textPrimary,
  },
  assetRowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  assetBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.04)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  assetRowSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // New: subtle "Commercial · Entity" line under subtitle
  assetModeRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  assetModeText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "700",
  },

  assetRowRight: {
    marginLeft: spacing.sm,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  reorderHandleCol: {
    justifyContent: "center",
    alignItems: "center",
  },
  reorderArrowBtn: {
    padding: 2,
  },
  reorderArrowDisabled: {
    opacity: 0.3,
  },

  glassCard: {
    ...cardStyles.base,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: "#ffffff",
  },
  cardTitle: {
    fontWeight: "800",
    paddingTop: spacing.md,
    fontSize: 14,
    color: colors.textPrimary,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: Platform.OS === "ios" ? spacing.lg + 10 : spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(45, 124, 227, 0.8);",
    ...cardStyles.shadowStrong,
  },
  fabText: {
    color: "#fff",
    fontWeight: "700",
    marginLeft: 8,
  },

  // Achievements card (clickable)
  achCard: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...cardStyles.shadowSoft,
  },
  achTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  achTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  achStats: {
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  achStrong: {
    fontWeight: "900",
    color: colors.textPrimary,
  },
  achMomentum: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  achMuted: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  modeWidget: {
  marginTop: spacing.md,
  padding: spacing.md,
  borderRadius: radius.lg,
  backgroundColor: "#ffffff",
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  flexDirection: "row",
  alignItems: "center",
  ...cardStyles.shadowSoft,
},
modeTitle: {
  fontWeight: "800",
  fontSize: 14,
  color: colors.textPrimary,
},
modeSubtitle: {
  fontSize: 12,
  color: colors.textMuted,
  marginTop: 2,
},

  // Wide avatar sizing (match asset circles)
  avatarBtnWide: { width: 70, height: 70, borderRadius: 80, overflow: "hidden" },
  avatarImgWide: { width: 80, height: 80, },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.xl || 20,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 14,
    ...cardStyles.shadowStrong,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 10,
  },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: 10,
  },
  modalBtnText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  modalCancel: {
    backgroundColor: "rgba(15,23,42,0.06)",
  },
});