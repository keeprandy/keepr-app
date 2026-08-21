import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { useWorkspace } from "../context/WorkspaceContext";
import { getKeeprSpaceOrgConfig, getKeeprSpacePortfolio } from "../lib/keeprspaceApi";
import { getActionScheduledDueAt, isPlaybookDueDatePending } from "../lib/playbookSchedule";
import { colors, radius, shadows, spacing } from "../styles/theme";

const MARINE_FALLBACK_HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");
const OEM_FALLBACK_HERO = require("../assets/boats/tiara/tiara_oem_banner.png");

function compact(parts) {
  return parts.filter(Boolean).join(" • ");
}

function initialsForName(name) {
  return String(name || "KS")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "KS";
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

function workspaceHeaderImage(workspace, portfolio) {
  return (
    portfolio?.org_brand?.header_image_url ||
    portfolio?.org_brand?.team_photo_url ||
    portfolio?.context?.header_image_url ||
    portfolio?.context?.team_photo_url ||
    workspace?.header_image_url ||
    workspace?.team_photo_url ||
    workspace?.display?.header_image_url ||
    workspace?.display?.team_photo_url ||
    null
  );
}

function workspaceLogoImage(workspace, portfolio) {
  return (
    portfolio?.org_brand?.logo_url ||
    portfolio?.org_brand?.photo_url ||
    portfolio?.context?.logo_url ||
    portfolio?.context?.photo_url ||
    workspace?.logo_url ||
    workspace?.photo_url ||
    workspace?.display?.logo_url ||
    workspace?.display?.photo_url ||
    null
  );
}

function workspaceFallbackHero(workspace) {
  return workspace?.workspace_type === "keeproem" ? OEM_FALLBACK_HERO : MARINE_FALLBACK_HERO;
}

function orgBrandFromConfig(config, organizationId) {
  const org = config?.organization || {};
  const pro = config?.keepr_pro || {};
  return {
    id: org.id || organizationId || pro.organization_id || null,
    display_name: org.display_name || org.name || pro.display_name || pro.name || null,
    name: org.name || pro.name || null,
    photo_url: pro.logo_url || org.logo_url || org.photo_url || null,
    logo_url: pro.logo_url || org.logo_url || org.photo_url || null,
    team_photo_url: pro.header_image_url || org.header_image_url || org.team_photo_url || null,
    header_image_url: pro.header_image_url || org.header_image_url || org.team_photo_url || null,
  };
}

function workspaceKind(workspace) {
  switch (workspace?.workspace_type) {
    case "keeproem":
      return "OEM";
    case "keeprdealer":
      return "Dealer";
    case "keeprpro":
      return "KeeprPro";
    default:
      return "KeeprSpace";
  }
}

function workspaceCopy(workspace, portfolio) {
  const name = workspaceDisplayName(workspace, portfolio);
  const kind = workspaceKind(workspace);
  if (workspace?.workspace_type === "keeproem") {
    return {
      name,
      kind,
      eyebrow: "KeeprSpace OEM",
      title: "Catalog activation and ownership continuity",
      subtitle: "A manufacturer workspace for model templates, dealer activation, resources, and owner handoff.",
      modeMetric: "OEM",
      operationTitle: "OEM Operations",
      primaryMetric: "Visible boats",
      filteredMetric: "In view",
      search: "Search activated boats, HIN, model, dealer",
    };
  }
  if (workspace?.workspace_type === "keeprdealer") {
    return {
      name,
      kind,
      eyebrow: "KeeprSpace Dealer",
      title: "Inventory, delivery, and service continuity",
      subtitle: "A dealer workspace for represented brands, active boats, service needs, and customer follow-through.",
      modeMetric: "Dealer",
      operationTitle: "Dealer Operations",
      primaryMetric: "Active inventory",
      filteredMetric: "In view",
      search: "Search inventory, HIN, customer, service state",
    };
  }
  return {
    name,
    kind,
    eyebrow: "KeeprPro",
    title: "Supported boats and service continuity",
    subtitle: "A service workspace for assigned vessels, open care needs, records, and customer follow-through.",
    modeMetric: "Service",
    operationTitle: "Service Operations",
    primaryMetric: "Supported boats",
    filteredMetric: "In view",
    search: "Search supported boats, HIN, customer, service state",
  };
}

function openItems(portfolio) {
  const actions = portfolio?.open_actions || [];
  const messages = portfolio?.recent_messages || [];
  const upcoming = portfolio?.upcoming_work || [];
  return [
    ...actions.map((item) => ({
      ...item,
      item_type: "action",
      label: getActionScheduledDueAt(item) ? "Scheduled work" : isPlaybookDueDatePending(item) ? "Unscheduled work" : "Open request",
    })),
    ...messages.map((item) => ({ ...item, item_type: "message", label: "Customer message" })),
    ...upcoming.map((item) => ({ ...item, item_type: "upcoming", label: "Upcoming work" })),
  ];
}

function WorkAreaButton({ item, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.workAreaButton, active && styles.workAreaButtonActive, item.disabled && styles.workAreaButtonDisabled]}
      activeOpacity={item.disabled ? 1 : 0.86}
      disabled={item.disabled}
      onPress={onPress}
    >
      <View style={[styles.workAreaIcon, active && styles.workAreaIconActive]}>
        <Ionicons name={item.icon} size={19} color={active ? colors.onPrimary : colors.brandBlue} />
      </View>
      <View style={styles.workAreaTextWrap}>
        <View style={styles.workAreaTitleRow}>
          <Text style={[styles.workAreaLabel, active && styles.workAreaLabelActive]}>{item.label}</Text>
          {item.pill ? (
            <View style={styles.authorityPill}>
              <Text style={styles.authorityPillText}>{item.pill}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.workAreaDescription, active && styles.workAreaDescriptionActive]} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function WorkAreaRail({ copy, boatsCount, currentWorkCount, onOpenFleet, onOpenAddBoat }) {
  const areas = [
    {
      key: "needs",
      label: "Needs Attention",
      icon: "alert-circle-outline",
      description: "Open requests, customer replies, upcoming work, and service follow-through.",
    },
    {
      key: "fleet",
      label: "Active Boats",
      icon: "boat-outline",
      description: "Searchable customer boat portfolio from active service relationships.",
      onPress: onOpenFleet,
    },
    {
      key: "addBoat",
      label: "Add Boat",
      icon: "add-circle-outline",
      description: "Resolve an existing boat before creating a new customer KAC.",
      onPress: onOpenAddBoat,
    },
  ];

  return (
    <View style={styles.workAreaRail}>
      <View style={styles.railHeader}>
        <Text style={styles.railKicker}>Workspace</Text>
        <Text style={styles.railTitle}>{copy.operationTitle}</Text>
        <View style={styles.projectionSwitch}>
          <View style={styles.projectionButton}>
            <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.projectionButtonText}>Sales</Text>
          </View>
          <View style={[styles.projectionButton, styles.projectionButtonActive]}>
            <Ionicons name="construct-outline" size={14} color={colors.onPrimary} />
            <Text style={[styles.projectionButtonText, styles.projectionButtonTextActive]}>{copy.modeMetric}</Text>
          </View>
        </View>
      </View>
      <View style={styles.railList}>
        {areas.map((item) => (
          <WorkAreaButton
            key={item.key}
            item={item}
            active={item.key === "needs"}
            onPress={item.onPress}
          />
        ))}
      </View>
      <View style={styles.statusPanel}>
        <Text style={styles.statusPanelKicker}>{copy.modeMetric} status</Text>
        <View style={styles.statusMetricGrid}>
          <View style={styles.statusMetric}>
            <Text style={styles.statusMetricValue}>{boatsCount}</Text>
            <Text style={styles.statusMetricLabel}>{copy.primaryMetric}</Text>
          </View>
          <View style={styles.statusMetric}>
            <Text style={styles.statusMetricValue}>{currentWorkCount}</Text>
            <Text style={styles.statusMetricLabel}>Needs Attention</Text>
          </View>
        </View>
      </View>
    </View>
  );
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

function NeedsAttentionPanel({ portfolio, onOpenAsset }) {
  const items = openItems(portfolio);

  return (
    <View style={styles.servicePanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>Service Mode</Text>
          <Text style={styles.sectionTitle}>Needs Attention</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{items.length}</Text>
          <Text style={styles.networkCountLabel}>items</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        This queue is sourced from relationship messages, service history, stewarded assets, and upcoming work.
      </Text>
      <View style={styles.serviceList}>
        {items.length ? items.slice(0, 16).map((item, index) => (
          <TouchableOpacity
            key={`${item.item_type}-${item.id || item.thread_id || item.asset_id || "item"}-${index}`}
            style={styles.serviceRow}
            activeOpacity={0.86}
            onPress={() => item.asset_id && onOpenAsset(item)}
          >
            <View style={styles.serviceRowIcon}>
              <Ionicons
                name={item.item_type === "message" ? "chatbubble-ellipses-outline" : item.item_type === "upcoming" ? "calendar-outline" : "construct-outline"}
                size={17}
                color={colors.brandBlue}
              />
            </View>
            <View style={styles.serviceRowBody}>
              <Text style={styles.serviceRowKicker}>{item.label}</Text>
              <Text style={styles.serviceRowTitle} numberOfLines={1}>{item.title || item.subject || item.asset_name || "Service item"}</Text>
              <Text style={styles.serviceRowMeta} numberOfLines={1}>
                {compact([item.asset_name, item.kac_id, item.status || item.queue_label || item.relationship_type])}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )) : (
          <View style={styles.emptyPanelCompact}>
            <Text style={styles.emptyTitle}>No urgent service work</Text>
            <Text style={styles.mutedText}>No open service actions or recent customer messages are blocking this KeeprSpace view.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function KeeprSpaceHomeScreen({ navigation }) {
  const { currentWorkspace } = useWorkspace();
  const organizationId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
  const [portfolio, setPortfolio] = useState(null);
  const [orgBrand, setOrgBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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
        limit: 50,
        offset: 0,
      });
      setPortfolio(next);
    } catch (err) {
      setError(err?.message || "Could not load KeeprSpace.");
      setPortfolio(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!organizationId) {
      setOrgBrand(null);
      return undefined;
    }

    let mounted = true;
    getKeeprSpaceOrgConfig({ organizationId })
      .then((config) => {
        if (!mounted) return;
        setOrgBrand(orgBrandFromConfig(config, organizationId));
      })
      .catch((err) => {
        if (!mounted) return;
        console.warn("Workspace org brand image unavailable:", err?.message || err);
        setOrgBrand(null);
      });

    return () => {
      mounted = false;
    };
  }, [organizationId]);

  const boats = portfolio?.boats || [];
  const brandedPortfolio = useMemo(
    () => (orgBrand ? { ...(portfolio || {}), org_brand: orgBrand } : portfolio),
    [orgBrand, portfolio]
  );
  const copy = useMemo(() => workspaceCopy(currentWorkspace, brandedPortfolio), [currentWorkspace, brandedPortfolio]);
  const currentWorkCount = openItems(portfolio).length;
  const boatsCount = boats.length || portfolio?.counts?.visible_boats || 0;

  const openFleet = () => navigation.navigate("KeeprSpaceFleet");
  const openAddBoat = () => navigation.navigate("KeeprSpaceActivator");
  const openBoat = (item) => {
    if (!item?.asset_id) return;
    navigation.navigate("KeeprSpaceBoat", {
      assetId: item.asset_id,
      kac: item.kac_id,
      organizationId: item.organization_id || organizationId,
      parentRoute: "KeeprSpaceHome",
      workspaceId: currentWorkspace?.workspace_id || null,
    });
  };

  const heroLogo = workspaceLogoImage(currentWorkspace, brandedPortfolio);
  const heroImage = workspaceHeaderImage(currentWorkspace, brandedPortfolio);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
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
          current="Needs Attention"
          right={(
            <View style={styles.breadcrumbWorkspace}>
              <Ionicons name="briefcase-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{copy.name}</Text>
              <Text style={styles.breadcrumbSwitchText}>{copy.modeMetric}</Text>
            </View>
          )}
        />

        <ImageBackground source={heroImage ? { uri: heroImage } : workspaceFallbackHero(currentWorkspace)} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            {heroLogo ? (
              <Image source={{ uri: heroLogo }} resizeMode="contain" style={styles.oemLogo} />
            ) : (
              <View style={styles.oemLogo}>
                <Text style={styles.dealerLogoFallback}>{initialsForName(copy.name)}</Text>
              </View>
            )}
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.heroTitle}>{copy.title}</Text>
              <Text style={styles.heroSubtitle}>{copy.subtitle}</Text>
              <View style={styles.heroActions}>
                <View style={styles.workspaceBadge}>
                  <Ionicons name="briefcase-outline" size={15} color={colors.brandNavy} />
                  <Text style={styles.workspaceBadgeText} numberOfLines={1}>{copy.kind}</Text>
                </View>
                <View style={styles.workspaceBadge}>
                  <Ionicons name="lock-closed-outline" size={15} color={colors.brandNavy} />
                  <Text style={styles.workspaceBadgeText}>Relationship scoped</Text>
                </View>
              </View>
            </View>
          </View>
        </ImageBackground>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Preparing your workspace...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyPanel}>
            <View style={styles.emptyIcon}>
              <Ionicons name="warning-outline" size={24} color={colors.danger} />
            </View>
            <Text style={styles.emptyTitle}>Workspace unavailable</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.workspaceShell}>
            <WorkAreaRail
              copy={copy}
              boatsCount={boatsCount}
              currentWorkCount={currentWorkCount}
              onOpenFleet={openFleet}
              onOpenAddBoat={openAddBoat}
            />
            <View style={styles.workspaceMain}>
              <View style={styles.commandBar}>
                <View style={styles.commandHeader}>
                  <View>
                    <Text style={styles.commandKicker}>Service Queue</Text>
                    <Text style={styles.commandTitle}>Needs Attention</Text>
                  </View>
                  <View style={styles.commandBadge}>
                    <Text style={styles.commandBadgeText}>{copy.modeMetric}</Text>
                  </View>
                </View>
                <View style={styles.commandProjectionRow}>
                  <Text style={styles.projectionHint}>
                    Same organization, relationship-scoped operating projection.
                  </Text>
                </View>
              </View>

              <View style={styles.metricsRow}>
                <MetricTile label={copy.primaryMetric} value={boatsCount} icon="boat-outline" />
                <MetricTile label={copy.filteredMetric} value={boatsCount} icon="filter-outline" />
                <MetricTile label="Workspace" value={copy.modeMetric} icon="compass-outline" />
              </View>

              <NeedsAttentionPanel portfolio={portfolio} onOpenAsset={openBoat} />

              <View style={styles.servicePanel}>
                <View style={styles.networkHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Portfolio</Text>
                    <Text style={styles.sectionTitle}>Active Boats</Text>
                  </View>
                  <TouchableOpacity style={styles.openButton} activeOpacity={0.86} onPress={openFleet}>
                    <Text style={styles.openButtonText}>Open Fleet</Text>
                    <Ionicons name="chevron-forward" size={17} color={colors.onPrimary} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.networkText}>
                  {boatsCount} boats are available from active relationships in this KeeprSpace.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
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
  hero: {
    alignSelf: "stretch",
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    minHeight: 292,
    overflow: "hidden",
    width: "100%",
    ...shadows.sm,
  },
  heroImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  heroOverlay: {
    backgroundColor: "rgba(5, 10, 24, 0.46)",
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 292,
    padding: spacing.xl,
  },
  oemLogo: {
    alignItems: "center",
    backgroundColor: "#050505",
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 78,
    justifyContent: "center",
    position: "absolute",
    right: spacing.xl,
    top: spacing.xl,
    width: 78,
  },
  dealerLogoFallback: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0,
  },
  heroCopy: {
    maxWidth: 760,
  },
  heroEyebrow: {
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.onPrimary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 39,
    marginTop: spacing.sm,
  },
  heroSubtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 660,
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  workspaceBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    maxWidth: 280,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  workspaceBadgeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "800",
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
  projectionSwitch: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.md,
    padding: 4,
  },
  projectionButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.md,
  },
  projectionButtonActive: {
    backgroundColor: colors.brandNavy,
  },
  projectionButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  projectionButtonTextActive: {
    color: colors.onPrimary,
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
  workAreaButtonDisabled: {
    opacity: 0.72,
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
  workAreaTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  workAreaLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
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
  authorityPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  authorityPillText: {
    color: colors.brandBlue,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
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
  servicePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  networkHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  sectionKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  networkCount: {
    alignItems: "flex-end",
  },
  networkCountValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  networkCountLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  networkText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: spacing.md,
  },
  serviceList: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  serviceRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 74,
    padding: spacing.md,
  },
  serviceRowIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  serviceRowBody: {
    flex: 1,
    minWidth: 0,
  },
  serviceRowKicker: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  serviceRowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  serviceRowMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
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
  emptyPanelCompact: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
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
  openButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  openButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
});
