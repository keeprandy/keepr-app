// screens/AssetGroupDashboardScreen.js
import React, { useMemo, useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";

/* ---------- Helper: stable sort for assets (honor sort_rank) ---------- */
function sortAssets(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    // 1) Explicit sort_rank (same logic as Dashboard)
    const ra = typeof a.sort_rank === "number" ? a.sort_rank : null;
    const rb = typeof b.sort_rank === "number" ? b.sort_rank : null;
    if (ra !== null || rb !== null) {
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (ra !== rb) return ra - rb;
    }

    // 2) Primary flag
    const aPrimary = a.is_primary || a.primary || a.metadata?.primary ? 1 : 0;
    const bPrimary = b.is_primary || b.primary || b.metadata?.primary ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;

    // 3) Created_at (older first, stable)
    const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (aCreated !== bCreated) return aCreated - bCreated;

    // 4) Name
    const aName = (a.name || "").toLowerCase();
    const bName = (b.name || "").toLowerCase();
    return aName.localeCompare(bName);
  });
}

/* ---------- Deterministic “masonry-like” heights (stable per asset) ---------- */
function stableHeightFromId(id) {
  if (!id) return 220;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const options = [180, 220, 280]; // subtle variance like masonry
  return options[h % options.length];
}

function getConfig(assetType) {
  if (assetType === "home") {
    return {
      title: "Homes",
      subtitle: "Everything about where you live — systems, projects, and proof.",
      icon: "home-outline",
      emptyTitle: "Add your first home",
      emptyBody:
        "Start with the place that matters most. Add photos, track systems, and build a clean ownership story.",
      addLabel: "Add home",
      addRoutes: ["AddHomeAsset", "AddHome", "CreateHome", "AddHomeScreen"],
      storyRoute: "HomeStory",
      storyParamKeys: { id: "homeId", name: "homeName" },
    };
  }

  if (assetType === "vehicle") {
    return {
      title: "Garage",
      subtitle: "Daily drivers, bikes, toys — service, upgrades, and history.",
      icon: "car-outline",
      emptyTitle: "Add your first vehicle or toy",
      emptyBody:
        "Golf cart, mower, motorcycle — anything with maintenance belongs here. Add it once and keep the story clean.",
      addLabel: "Add vehicle",
      addRoutes: ["AddVehicleAsset", "AddVehicle", "CreateVehicle", "AddVehicleScreen"],
      storyRoute: "VehicleStory",
      storyParamKeys: { id: "vehicleId", name: "vehicleName" },
    };
  }

  // boat
  return {
    title: "On the water",
    subtitle: "Trips, upgrades, marina work — one story you can trust.",
    icon: "boat-outline",
    emptyTitle: "Add your first boat",
    emptyBody:
      "Add a boat, then build its story with photos, service, and seasonal work. It becomes easy to share and easy to sell.",
    addLabel: "Add boat",
    addRoutes: ["AddMarineAsset", "AddBoat", "CreateBoat", "AddBoatScreen"],
    storyRoute: "BoatStory",
    storyParamKeys: { id: "boatId", name: "boatName" },
  };
}

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

/* ---------- Resolve hero_placement_id -> image URL ---------- */
async function resolveHeroUrisByPlacementId(placementIds) {
  const ids = Array.isArray(placementIds) ? placementIds.filter(Boolean) : [];
  const unique = Array.from(new Set(ids));
  if (!unique.length) return {};

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
    .in("id", unique);

  if (error) {
    console.log("AssetGroupDashboard: hero placement lookup error", error);
    return {};
  }

  const out = {};
  for (const row of data || []) {
    const pid = row?.id;
    const a = row?.attachment;
    if (!pid || !a || a.deleted_at) continue;

    if (a.url) {
      out[pid] = a.url;
      continue;
    }

    if (a.bucket && a.storage_path) {
      try {
        const signed = await getSignedUrl({ bucket: a.bucket, path: a.storage_path });
        if (signed) out[pid] = signed;
      } catch (e) {
        console.log("AssetGroupDashboard: getSignedUrl error", e);
      }
    }
  }

  return out;
}

/* ---------- Simple “masonry grid” that preserves order ---------- */
function splitIntoColumns(items, numCols) {
  const cols = Array.from({ length: numCols }, () => []);
  (items || []).forEach((it, idx) => {
    cols[idx % numCols].push(it);
  });
  return cols;
}

export default function AssetGroupDashboardScreen({ navigation, route }) {
  const { width } = useWindowDimensions();

  const assetType = route?.params?.assetType || "vehicle";
  const cfg = useMemo(() => getConfig(assetType), [assetType]);

  const { assets: rawAssets = [], loading, error } = useAssets(assetType);
  const assets = useMemo(() => sortAssets(rawAssets), [rawAssets]);

  const groupAssets = useMemo(() => assets, [assets]);

  const [heroUriByPlacementId, setHeroUriByPlacementId] = useState({});
  const [heroResolving, setHeroResolving] = useState(false);

useEffect(() => {
  let cancelled = false;

  async function run() {
    const ids = groupAssets.map((a) => a.hero_placement_id).filter(Boolean);
    if (!ids.length) {
      setHeroUriByPlacementId({});
      return;
    }

    setHeroResolving(true);

    const map = await resolveHeroUrisByPlacementId(ids);

    if (!cancelled) {
      setHeroUriByPlacementId(map || {});
      setHeroResolving(false);
    }
  }

  run();

  return () => {
    cancelled = true;
  };
}, [groupAssets]);

  const goAdd = useCallback(() => {
    const ok = tryNavigateFirst(navigation.getParent?.() || navigation, cfg.addRoutes, {});
    if (!ok) {
      // fallback: no-op
    }
  }, [navigation, cfg]);

  const goStory = useCallback(
    (asset) => {
      if (!asset?.id) return;
      navigation.navigate(cfg.storyRoute, {
        [cfg.storyParamKeys.id]: asset.id,
        [cfg.storyParamKeys.name]: asset.name,
      });
    },
    [navigation, cfg]
  );

  const goBack = () => navigation.goBack();

  // Keep top nav pills (asset types) without assuming route names too hard.
  const goType = useCallback(
    (nextType) => {
      if (!nextType || nextType === assetType) return;

      // Prefer “replace” so Back doesn’t bounce between types.
      const selfName = route?.name;
      const parent = navigation.getParent?.() || navigation;

      const candidates = [
        selfName,
        "AssetGroupDashboard",
        "AssetGroupDashboardScreen",
        "AssetsGroupDashboard",
      ].filter(Boolean);

      // Try replace first
      let replaced = false;
      for (const r of candidates) {
        try {
          parent.replace?.(r, { assetType: nextType });
          replaced = true;
          break;
        } catch {}
      }
      if (replaced) return;

      // fallback to navigate
      tryNavigateFirst(parent, candidates, { assetType: nextType });
    },
    [assetType, navigation, route?.name]
  );


  const hasAssets = groupAssets.length > 0;

  // Responsive columns (web gets more room, but never overflows)
  const isWeb = Platform.OS === "web";
  const maxGridWidth = 1120;
  const containerWidth = Math.min(width, maxGridWidth);
  const numCols = isWeb ? (containerWidth >= 980 ? 3 : 2) : 2;

  const columns = useMemo(() => splitIntoColumns(groupAssets, numCols), [groupAssets, numCols]);

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{cfg.title}</Text>
            <Text style={styles.subtitle}>{cfg.subtitle}</Text>
          </View>

          <TouchableOpacity style={styles.addBtn} onPress={goAdd} activeOpacity={0.9}>
            <Ionicons name="add" size={18} color={colors.brandWhite} />
            <Text style={styles.addBtnText}>{cfg.addLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* Top navigation (retain) */}
        <View style={styles.topNavRow}>
          <TouchableOpacity
            style={[styles.topNavPill, assetType === "home" && styles.topNavPillActive]}
            onPress={() => goType("home")}
            activeOpacity={0.9}
          >
            <Ionicons
              name="home-outline"
              size={16}
              color={assetType === "home" ? colors.brandWhite : colors.textPrimary}
            />
            <Text
              style={[
                styles.topNavPillText,
                assetType === "home" && styles.topNavPillTextActive,
              ]}
            >
              Homes
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.topNavPill, assetType === "boat" && styles.topNavPillActive]}
            onPress={() => goType("boat")}
            activeOpacity={0.9}
          >
            <Ionicons
              name="boat-outline"
              size={16}
              color={assetType === "boat" ? colors.brandWhite : colors.textPrimary}
            />
            <Text
              style={[
                styles.topNavPillText,
                assetType === "boat" && styles.topNavPillTextActive,
              ]}
            >
              Boats
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.topNavPill, assetType === "vehicle" && styles.topNavPillActive]}
            onPress={() => goType("vehicle")}
            activeOpacity={0.9}
          >
            <Ionicons
              name="car-outline"
              size={16}
              color={assetType === "vehicle" ? colors.brandWhite : colors.textPrimary}
            />
            <Text
              style={[
                styles.topNavPillText,
                assetType === "vehicle" && styles.topNavPillTextActive,
              ]}
            >
              Garage
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            ...
          </View>
        ) : null}

        {/* Section header */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name={cfg.icon} size={18} color={colors.textSecondary} />
              <View style={{ marginLeft: spacing.xs }}>
                <Text style={styles.sectionLabel}>All</Text>
                <Text style={styles.sectionHint}>
                  {hasAssets ? `${groupAssets.length} assets` : "Add a hero photo in Showcase to see it here"}
                </Text>
              </View>
            </View>

            {heroResolving ? (
              <View style={styles.syncRow}>
                <ActivityIndicator size="small" />
                <Text style={styles.syncText}>Syncing</Text>
              </View>
            ) : null}
          </View>

          {!hasAssets ? (
            <TouchableOpacity style={styles.emptyCard} onPress={goAdd} activeOpacity={0.92}>
              <View style={styles.emptyImageStub}>
                <Ionicons name={cfg.icon} size={34} color={colors.brandWhite} />
              </View>
              <View style={styles.cardFooter}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {cfg.emptyTitle}
                  </Text>
                  <Text style={styles.cardSubtitle} numberOfLines={3}>
                    {cfg.emptyBody}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          ) : (
            <View
              style={[
                styles.gridOuter,
                {
                  maxWidth: maxGridWidth,
                  width: "100%",
                  alignSelf: "center",
                },
              ]}
            >
              <View style={[styles.gridRow, { gap: spacing.md }]}>
                {columns.map((colItems, colIdx) => (
                  <View
                    key={`col-${colIdx}`}
                    style={[
                      styles.gridCol,
                      {
                        flex: 1,
                        minWidth: 0, // critical to prevent overflow on web
                      },
                    ]}
                  >
                    {colItems.map((asset) => {
                      const uri =
                        asset?.hero_placement_id && heroUriByPlacementId?.[asset.hero_placement_id]
                          ? heroUriByPlacementId[asset.hero_placement_id]
                          : null;

                      const imgH = uri ? stableHeightFromId(asset.id) : 180;

                      return (
                        <TouchableOpacity
                          key={asset.id}
                          style={styles.card}
                          activeOpacity={0.92}
                          onPress={() => goStory(asset)}
                        >
                          {uri ? (
                            <Image
                              source={{ uri }}
                              style={[styles.cardImage, { height: imgH }]}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={[styles.cardImageStub, { height: imgH }]}>
                              <Ionicons name={cfg.icon} size={34} color={colors.brandWhite} />
                            </View>
                          )}

                          <View style={styles.cardFooter}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.cardTitle} numberOfLines={1}>
                                {asset.name || "Untitled"}
                              </Text>
                              <Text style={styles.cardSubtitle} numberOfLines={2}>
                                {asset.location || "Tap to open story"}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: spacing.xl },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  title: { ...typography.title },
  subtitle: { ...typography.subtitle, marginTop: 2 },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: 999,
    ...shadows.subtle,
    gap: 8,
  },
  addBtnText: { color: colors.brandWhite, fontSize: 12, fontWeight: "700" },

  topNavRow: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  topNavPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  topNavPillActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  topNavPillText: { fontSize: 12, fontWeight: "800", color: colors.textPrimary },
  topNavPillTextActive: { color: colors.brandWhite },

  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: { fontSize: 12, color: "#B91C1C", flex: 1 },

  section: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: spacing.sm,
  },
  sectionLabel: { ...typography.sectionLabel, marginBottom: spacing.xs },
  sectionHint: { fontSize: 11, color: colors.textMuted },

  syncRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  syncText: { fontSize: 11, color: colors.textMuted, fontWeight: "800" },

  gridOuter: {
    alignSelf: "center",
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  gridCol: {
    flexDirection: "column",
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
    ...shadows.subtle,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },

  cardImage: {
    width: "100%",
    backgroundColor: colors.surfaceSubtle,
  },
  cardImageStub: {
    width: "100%",
    backgroundColor: colors.accentBlue,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyImageStub: {
    height: 220,
    backgroundColor: colors.accentBlue,
    alignItems: "center",
    justifyContent: "center",
  },

  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  cardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
});