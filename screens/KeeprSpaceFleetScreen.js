import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  ImageBackground,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { useWorkspace } from "../context/WorkspaceContext";
import { getSignedUrl } from "../lib/attachmentsApi";
import { fetchAssetHeroUris, getCachedAssetHeroUris } from "../lib/assetHeroResolver";
import { getKeeprSpacePortfolio, removeKeeprSpaceBoatRelationship } from "../lib/keeprspaceApi";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

const FALLBACK_HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");
const FALLBACK_PONTOON_HERO = require("../assets/boats/boat_bennington_hero.jpg");
const FLEET_HERO_OPTIONS = {
  transform: null,
  expiresIn: 60 * 60 * 24,
};

const APP_ASSET_HERO_MAP = {
  "app://assets/boats/boat_bennington_hero.jpg": FALLBACK_PONTOON_HERO,
  "app://assets/boats/tiara/tiara_39ls_hero.jpg": FALLBACK_HERO,
  "app://assets/boats/tiara/tiara_39le_hero.jpg": require("../assets/boats/tiara/tiara_39le_hero.jpg"),
};

function compact(parts) {
  return parts.filter(Boolean).join(" • ");
}

function labelize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["active", "connected", "verified", "complete", "open"].some((token) => normalized.includes(token))) return "success";
  if (["pending", "review", "draft", "scheduled"].some((token) => normalized.includes(token))) return "warning";
  return "neutral";
}

function workspaceDisplayName(workspace, portfolio) {
  return (
    portfolio?.context?.display_name ||
    workspace?.display_name ||
    workspace?.name ||
    workspace?.label ||
    "KeeprSpace"
  );
}

function workspaceCopy(workspace, portfolio) {
  const name = workspaceDisplayName(workspace, portfolio);
  if (workspace?.workspace_type === "keeproem") {
    return {
      name,
      modeMetric: "OEM",
      primaryMetric: "Visible boats",
      filteredMetric: "In view",
      search: "Search activated boats, HIN, model, dealer",
      emptyTitle: "No activated boats yet",
      emptyBody: "Once a vessel is connected through an OEM relationship or template binding, it becomes part of this fleet view.",
    };
  }
  if (workspace?.workspace_type === "keeprdealer") {
    return {
      name,
      modeMetric: "Dealer",
      primaryMetric: "Active inventory",
      filteredMetric: "In view",
      search: "Search inventory, HIN, customer, service state",
      emptyTitle: "No active inventory yet",
      emptyBody: "Active dealer relationships and inventory connections will appear here.",
    };
  }
  return {
    name,
    modeMetric: "Service",
    primaryMetric: "Supported boats",
    filteredMetric: "In view",
    search: "Search supported boats, HIN, customer, service state",
    emptyTitle: "No supported boats yet",
    emptyBody: "Assigned vessels from active service relationships will appear here.",
  };
}

function titleForBoat(boat) {
  const identity = boat?.identity || {};
  return compact([
    identity.year || boat?.year,
    identity.make || boat?.make,
    identity.model || boat?.model,
  ]) || boat?.kac_id || "Connected asset";
}

function assetName(boat) {
  return boat?.asset_name || boat?.name || titleForBoat(boat) || "Untitled boat";
}

function localHeroFallbackForBoat(boat) {
  const identity = boat?.identity || {};
  const signature = [
    boat?.asset_name,
    boat?.name,
    identity.make,
    identity.model,
    boat?.make,
    boat?.model,
  ].filter(Boolean).join(" ").toLowerCase();

  if (signature.includes("pontoon")) {
    return FALLBACK_PONTOON_HERO;
  }
  return FALLBACK_HERO;
}

function heroSourceForBoat(boat, heroUri = null) {
  const uri = heroUri || boat?.hero_image_url || boat?.hero_thumb_url || boat?.asset?.hero_image_url || boat?.asset?.hero_thumb_url;
  if (APP_ASSET_HERO_MAP[uri]) return APP_ASSET_HERO_MAP[uri];
  return uri ? { uri } : localHeroFallbackForBoat(boat);
}

function workspaceConnectionLabel(boat) {
  if (boat?.stewardship_id || boat?.service_relationship?.stewardship_id) {
    return "Connected";
  }
  if (boat?.asset_relationship_id) {
    return "Workspace only";
  }
  return "Not connected";
}

async function signedHeroMediaUrl(hero, transform, expiresIn = 3600) {
  if (!hero?.bucket || !hero?.storage_path) return null;
  try {
    return await getSignedUrl({
      bucket: hero.bucket,
      path: hero.storage_path,
      expiresIn,
      transform,
    });
  } catch (_) {
    return (
      supabase.storage
        .from(hero.bucket)
        .getPublicUrl(hero.storage_path)?.data?.publicUrl || null
    );
  }
}

async function loadStewardshipHeroUrl(boat, organizationId, transform, expiresIn) {
  const assetId = boat?.asset_id || boat?.id || null;
  const kac = boat?.kac_id || null;
  if (!assetId && !kac) return null;

  const rpc = kac
    ? supabase.rpc("get_keeprpro_stewardship_asset_by_kac", {
        p_kac: kac,
        p_organization_id: organizationId || null,
      })
    : supabase.rpc("get_keeprpro_stewardship_asset", {
        p_asset_id: assetId,
        p_organization_id: organizationId || null,
      });

  const { data, error } = await rpc;
  if (error) return null;
  return signedHeroMediaUrl(data?.hero_media, transform, expiresIn);
}

function MetricTile({ label, value, icon }) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricIcon}>
        <Ionicons name={icon} size={16} color={colors.brandBlue} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BoatCard({ boat, onPress, heroUri = null, onRemove = null, removing = false }) {
  const dealer = boat?.dealer_relationship || boat?.service_relationship || {};
  const verification = boat?.verification || {};
  const activation = boat?.activation || {};
  const readiness = `${verification.percent || boat?.verification_percent || 0}% verified`;
  const state = activation.status || boat?.owner_state || dealer.status || "in review";
  const tone = statusTone(state);
  const relationshipLabel = dealer.relationship_purpose || dealer.relationship_type || boat?.relationship_type || "Service";
  const relationshipStatus = dealer.status || activation.status || boat?.owner_state || "Active";

  return (
    <TouchableOpacity style={styles.boatCard} onPress={onPress} activeOpacity={0.9}>
      <ImageBackground
        source={heroSourceForBoat(boat, heroUri)}
        resizeMode="cover"
        style={styles.cardImage}
        imageStyle={styles.cardImageAsset}
      >
        <View style={styles.cardShade}>
          <View style={styles.statusRibbon}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.onPrimary} />
            <Text style={styles.statusRibbonText}>{readiness}</Text>
          </View>
        </View>
      </ImageBackground>

      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle} numberOfLines={1}>{assetName(boat)}</Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>{titleForBoat(boat)}</Text>
          </View>
          <View style={[styles.statePill, styles[`statePill_${tone}`]]}>
            <Text style={[styles.statePillText, styles[`statePillText_${tone}`]]} numberOfLines={1}>
              {labelize(state)}
            </Text>
          </View>
        </View>

        <View style={styles.serviceRelationshipStrip}>
          <View style={styles.serviceRelationshipRow}>
            <View style={styles.relationshipCell}>
              <Text style={styles.relationshipLabel}>Relationship</Text>
              <Text style={styles.relationshipValue} numberOfLines={1}>{labelize(relationshipLabel)}</Text>
            </View>
            <View style={styles.relationshipCell}>
              <Text style={styles.relationshipLabel}>Status</Text>
              <Text style={styles.relationshipValue} numberOfLines={1}>{labelize(relationshipStatus)}</Text>
            </View>
          </View>
          <View style={styles.relationshipGrid}>
            <View style={styles.relationshipCell}>
              <Text style={styles.relationshipLabel}>Connection</Text>
              <Text style={styles.relationshipValue} numberOfLines={1}>
                {workspaceConnectionLabel(boat)}
              </Text>
            </View>
            <View style={styles.relationshipCell}>
              <Text style={styles.relationshipLabel}>Keepr Code</Text>
              <Text style={styles.relationshipValue} numberOfLines={1}>{boat?.kac_id || "Pending"}</Text>
            </View>
          </View>
          <View style={styles.serviceRelationshipOpen}>
            <Text style={styles.serviceRelationshipOpenText}>Open Keeprship</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
          {boat?.asset_relationship_id || boat?.stewardship_id ? (
            <TouchableOpacity
              style={styles.removeRelationshipButton}
              activeOpacity={0.86}
              disabled={removing}
              onPress={(event) => {
                event?.stopPropagation?.();
                onRemove?.(boat);
              }}
            >
              {removing ? (
                <ActivityIndicator color={colors.danger} size="small" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={15} color={colors.danger} />
                  <Text style={styles.removeRelationshipText}>Remove from this workspace</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function KeeprSpaceFleetScreen({ route, navigation }) {
  const { currentWorkspace } = useWorkspace();
  const routeOrganizationId = route?.params?.organizationId || null;
  const organizationId = routeOrganizationId || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
  const [portfolio, setPortfolio] = useState(null);
  const [search, setSearch] = useState("");
  const [heroUrls, setHeroUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!organizationId) {
      setPortfolio(null);
      setError("This workspace does not have an organization id.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await getKeeprSpacePortfolio({
        organizationId,
        search,
        limit: 50,
        offset: 0,
      });
      setPortfolio(next);
    } catch (err) {
      setError(err?.message || "Could not load fleet.");
      setPortfolio(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organizationId, search]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load({ quiet: true });
    }, [load])
  );

  const boats = useMemo(() => portfolio?.boats || [], [portfolio?.boats]);
  const boatHeroIds = useMemo(
    () => Array.from(new Set(boats.map((boat) => boat.asset_id || boat.id).filter(Boolean))),
    [boats]
  );
  const boatHeroIdsKey = boatHeroIds.join("|");
  const copy = useMemo(() => workspaceCopy(currentWorkspace, portfolio), [currentWorkspace, portfolio]);
  const visibleCount = boats.length || portfolio?.counts?.visible_boats || 0;

  useEffect(() => {
    let active = true;
    if (!boatHeroIds.length) {
      return () => {
        active = false;
      };
    }

    const cached = getCachedAssetHeroUris(boatHeroIds, FLEET_HERO_OPTIONS, { allowAnySize: true });
    if (Object.keys(cached).length) {
      setHeroUrls((prev) => ({ ...prev, ...cached }));
    }

    fetchAssetHeroUris(boatHeroIds, { ...FLEET_HERO_OPTIONS, organizationId })
      .then(async (urls) => {
        const nextUrls = { ...(urls || {}) };
        await Promise.all(
          boats.map(async (boat) => {
            const assetId = boat.asset_id || boat.id;
            if (!assetId || nextUrls[assetId]) return;
            const url = await loadStewardshipHeroUrl(
              boat,
              organizationId,
              FLEET_HERO_OPTIONS.transform,
              FLEET_HERO_OPTIONS.expiresIn
            );
            if (url) nextUrls[assetId] = url;
          })
        );
        if (active && Object.keys(nextUrls).length) {
          setHeroUrls((prev) => ({ ...prev, ...nextUrls }));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [boatHeroIdsKey, organizationId]);

  const openBoat = (boat) => {
    const assetId = boat.asset_id || boat.id;
    if (!assetId) return;
    navigation.navigate("KeeprSpaceBoat", {
      assetId,
      kac: boat.kac_id,
      organizationId: boat.organization_id || organizationId,
      stewardshipId: boat.stewardship_id || boat.service_relationship?.stewardship_id || null,
      parentRoute: "KeeprSpaceFleet",
      workspaceId: currentWorkspace?.workspace_id || null,
    });
  };

  const confirmRemoveBoat = useCallback((boat) => {
    const relationshipId = boat?.asset_relationship_id || null;
    const stewardshipId = boat?.stewardship_id || boat?.service_relationship?.stewardship_id || null;
    const assetId = boat?.asset_id || boat?.id || null;
    if (!assetId || !organizationId) return;
    const name = assetName(boat);

    const remove = async () => {
      setRemovingId(relationshipId || stewardshipId || assetId);
      setActionMessage(null);
      try {
        await removeKeeprSpaceBoatRelationship({
          assetId,
          assetRelationshipId: relationshipId,
          stewardshipId,
          organizationId,
        });
        setPortfolio((prev) => {
          if (!prev) return prev;
          const nextBoats = (prev.boats || []).filter((item) => (item.asset_id || item.id) !== assetId);
          return {
            ...prev,
            boats: nextBoats,
            counts: {
              ...(prev.counts || {}),
              visible_boats: Math.max(0, Number(prev.counts?.visible_boats || nextBoats.length + 1) - 1),
            },
          };
        });
        setActionMessage({ tone: "success", text: `${name} was removed from this workspace projection. The Keepr Asset was not deleted.` });

        try {
          const next = await getKeeprSpacePortfolio({
            organizationId,
            search,
            limit: 50,
            offset: 0,
          });
          setPortfolio(next);
        } catch (refreshErr) {
          setActionMessage({
            tone: "warning",
            text: `Removed ${name}, but the fleet refresh did not complete. Refresh the page if the count looks stale.`,
          });
        }
      } catch (err) {
        setActionMessage({ tone: "danger", text: err?.message || "Could not remove this boat from the workspace." });
      } finally {
        setRemovingId(null);
      }
    };

    if (Platform.OS === "web") {
      const ok = typeof window === "undefined" ? true : window.confirm(`Remove ${name} from this workspace? The Keepr Asset will not be deleted.`);
      if (ok) remove();
      return;
    }

    Alert.alert(
      "Remove from workspace?",
      `${name} will be removed from this workspace projection. The Keepr Asset will not be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: remove },
      ]
    );
  }, [organizationId, search]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load({ quiet: true });
            }}
          />
        }
      >
        <ActivatorBreadcrumb
          navigation={navigation}
          homeRoute="KeeprSpaceHome"
          current="Active Fleet"
          right={(
            <View style={styles.breadcrumbWorkspace}>
              <Ionicons name="briefcase-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{copy.name}</Text>
              <Text style={styles.breadcrumbSwitchText}>{copy.modeMetric}</Text>
            </View>
          )}
        />

        <View style={styles.workspaceShell}>
          <View style={styles.workAreaRail}>
            <View style={styles.railHeader}>
              <Text style={styles.railKicker}>Workspace</Text>
              <Text style={styles.railTitle}>{copy.modeMetric} Operations</Text>
            </View>
            <View style={styles.railList}>
              <TouchableOpacity style={styles.workAreaButton} activeOpacity={0.86} onPress={() => navigation.navigate("KeeprSpaceHome")}>
                <View style={styles.workAreaIcon}>
                  <Ionicons name="alert-circle-outline" size={19} color={colors.brandBlue} />
                </View>
                <View style={styles.workAreaTextWrap}>
                  <Text style={styles.workAreaLabel}>Needs Attention</Text>
                  <Text style={styles.workAreaDescription}>Open requests, customer replies, upcoming work, and service follow-through.</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.workAreaButton, styles.workAreaButtonActive]} activeOpacity={0.86}>
                <View style={[styles.workAreaIcon, styles.workAreaIconActive]}>
                  <Ionicons name="boat-outline" size={19} color={colors.onPrimary} />
                </View>
                <View style={styles.workAreaTextWrap}>
                  <Text style={[styles.workAreaLabel, styles.workAreaLabelActive]}>Active Boats</Text>
                  <Text style={[styles.workAreaDescription, styles.workAreaDescriptionActive]}>
                    Searchable customer boat portfolio from active service relationships.
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.workAreaButton} activeOpacity={0.86} onPress={() => navigation.navigate("KeeprSpaceActivator")}>
                <View style={styles.workAreaIcon}>
                  <Ionicons name="add-circle-outline" size={19} color={colors.brandBlue} />
                </View>
                <View style={styles.workAreaTextWrap}>
                  <Text style={styles.workAreaLabel}>Add Boat</Text>
                  <Text style={styles.workAreaDescription}>Resolve an existing boat before creating a new customer KAC.</Text>
                </View>
              </TouchableOpacity>
            </View>
            <View style={styles.statusPanel}>
              <Text style={styles.statusPanelKicker}>{copy.modeMetric} status</Text>
              <View style={styles.statusMetricGrid}>
                <View style={styles.statusMetric}>
                  <Text style={styles.statusMetricValue}>{visibleCount}</Text>
                  <Text style={styles.statusMetricLabel}>{copy.primaryMetric}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.workspaceMain}>
            <View style={styles.commandBar}>
              <View style={styles.commandHeader}>
                <View>
                  <Text style={styles.commandKicker}>Portfolio</Text>
                  <Text style={styles.commandTitle}>Active Fleet</Text>
                </View>
                <View style={styles.commandBadge}>
                  <Text style={styles.commandBadgeText}>{copy.modeMetric}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.addBoatButton} activeOpacity={0.86} onPress={() => navigation.navigate("KeeprSpaceActivator")}>
                <Ionicons name="add-circle-outline" size={16} color={colors.onPrimary} />
                <Text style={styles.addBoatButtonText}>Add Boat</Text>
              </TouchableOpacity>
              <View style={styles.commandProjectionRow}>
                <Text style={styles.projectionHint}>Same organization, relationship-scoped operating projection.</Text>
              </View>
              <View style={styles.searchRow}>
                <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  onSubmitEditing={() => load({ quiet: true })}
                  placeholder={copy.search}
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="search"
                  style={styles.searchInput}
                />
              </View>
            </View>

            <View style={styles.metricsRow}>
              <MetricTile label={copy.primaryMetric} value={visibleCount} icon="boat-outline" />
              <MetricTile label={copy.filteredMetric} value={visibleCount} icon="filter-outline" />
              <MetricTile label="Workspace" value={copy.modeMetric} icon="compass-outline" />
            </View>

            {actionMessage ? (
              <View style={[styles.actionMessage, styles[`actionMessage_${actionMessage.tone}`]]}>
                <Text style={styles.actionMessageText}>{actionMessage.text}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.brandBlue} />
                <Text style={styles.mutedText}>Preparing your fleet...</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="warning-outline" size={24} color={colors.danger} />
                </View>
                <Text style={styles.emptyTitle}>Fleet unavailable</Text>
                <Text style={styles.mutedText}>{error}</Text>
              </View>
            ) : boats.length ? (
              <View style={styles.cardGrid}>
                {boats.map((boat) => {
                  const assetId = boat.asset_id || boat.id;
                  return (
                    <BoatCard
                      key={assetId}
                      boat={boat}
                      onPress={() => openBoat(boat)}
                      heroUri={heroUrls[assetId] || null}
                      onRemove={confirmRemoveBoat}
                      removing={removingId === (boat.asset_relationship_id || boat.stewardship_id || assetId)}
                    />
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="boat-outline" size={24} color={colors.brandBlue} />
                </View>
                <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
                <Text style={styles.mutedText}>{copy.emptyBody}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xl * 3,
  },
  breadcrumbWorkspace: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 320,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  breadcrumbWorkspaceText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  breadcrumbSwitchText: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  workspaceShell: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  workAreaRail: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 290,
    flexGrow: 0,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  railHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingBottom: spacing.md,
  },
  railKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  railTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  railList: {
    gap: spacing.sm,
  },
  workAreaButton: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 82,
    padding: spacing.md,
  },
  workAreaButtonActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  workAreaIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  workAreaIconActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  workAreaTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  workAreaLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  workAreaLabelActive: {
    color: colors.brandNavy,
  },
  workAreaDescription: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  workAreaDescriptionActive: {
    color: colors.textSecondary,
  },
  statusPanel: {
    backgroundColor: "#0F172A",
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  statusPanelKicker: {
    color: "#BFDBFE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusMetric: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 96,
  },
  statusMetricValue: {
    color: colors.onPrimary,
    fontSize: 19,
    fontWeight: "900",
  },
  statusMetricLabel: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 2,
  },
  workspaceMain: {
    flex: 1,
    gap: spacing.lg,
    minWidth: 420,
  },
  commandBar: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  commandHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  commandProjectionRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  projectionHint: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  commandKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  commandTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  commandBadge: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  commandBadgeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  addBoatButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  addBoatButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    outlineStyle: "none",
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metricTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 148,
    padding: spacing.md,
    ...shadows.sm,
  },
  metricIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "900",
    marginTop: spacing.md,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  actionMessage: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  actionMessage_success: {
    backgroundColor: "#ECFDF5",
    borderColor: "#BBF7D0",
  },
  actionMessage_warning: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  actionMessage_danger: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  actionMessageText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  boatCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 310,
    flexGrow: 1,
    maxWidth: 460,
    overflow: "hidden",
    ...shadows.sm,
  },
  cardImage: {
    backgroundColor: colors.surfaceSubtle,
    height: 174,
  },
  cardImageAsset: {
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    objectFit: "cover",
    resizeMode: "cover",
  },
  cardShade: {
    backgroundColor: "rgba(15,23,42,0.22)",
    flex: 1,
    padding: spacing.md,
  },
  statusRibbon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(15,23,42,0.8)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  statusRibbonText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  cardBody: {
    gap: spacing.md,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  statePill: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  statePill_neutral: {
    backgroundColor: colors.surfaceSubtle,
  },
  statePill_success: {
    backgroundColor: "#DCFCE7",
  },
  statePill_warning: {
    backgroundColor: "#FEF3C7",
  },
  statePillText: {
    fontSize: 10,
    fontWeight: "900",
  },
  statePillText_neutral: {
    color: colors.textSecondary,
  },
  statePillText_success: {
    color: "#166534",
  },
  statePillText_warning: {
    color: "#92400E",
  },
  serviceRelationshipStrip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  serviceRelationshipRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  relationshipGrid: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  relationshipCell: {
    flex: 1,
    minWidth: 0,
  },
  relationshipLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  relationshipValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 3,
  },
  serviceRelationshipOpen: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  serviceRelationshipOpenText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  removeRelationshipButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#FECACA",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  removeRelationshipText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: "900",
  },
  emptyPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
    ...shadows.sm,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  mutedText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  centered: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
});
