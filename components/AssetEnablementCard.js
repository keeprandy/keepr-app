import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { projectAssetEnablement } from "../lib/assetEnablementProjection";
import { assetKacId } from "../lib/assetIdentity";
import { useAuth } from "../context/AuthContext";
import { fetchCoordinationActions } from "../lib/teamActions";
import { colors, radius, shadows, spacing } from "../styles/theme";

function currentOrigin() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_KEEPR_BASE_URL || "";
}

function openWebPath(path) {
  const origin = currentOrigin();
  if (!origin || !path) return;
  Linking.openURL(`${origin}${path}`);
}

function displayItems(items, limit = 4) {
  return (items || []).slice(0, limit);
}

function StatusPill({ label, value }) {
  const normalized = String(value || "").toLowerCase();
  const good = ["established", "resolved", "represented", "started"].includes(normalized);
  const partial = ["partial", "active"].includes(normalized);
  return (
    <View style={[styles.statusPill, good && styles.statusGood, partial && styles.statusPartial]}>
      <Text style={[styles.statusLabel, (good || partial) && styles.statusLabelStrong]}>{label}</Text>
      <Text style={[styles.statusValue, (good || partial) && styles.statusValueStrong]}>
        {String(value || "unknown").replaceAll("_", " ")}
      </Text>
    </View>
  );
}

function FactList({ title, items, empty }) {
  return (
    <View style={styles.factColumn}>
      <Text style={styles.columnTitle}>{title}</Text>
      {items?.length ? (
        displayItems(items).map((item, index) => (
          <View key={`${title}-${item.kind}-${item.label}-${index}`} style={styles.factRow}>
            <Ionicons name="ellipse" size={7} color={colors.primary} style={styles.factDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.factLabel}>{item.label}</Text>
              {!!item.detail && <Text style={styles.factDetail} numberOfLines={2}>{item.detail}</Text>}
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>{empty}</Text>
      )}
    </View>
  );
}

function OwnerList({ title, items, empty, icon = "checkmark-circle-outline" }) {
  return (
    <View style={styles.ownerSection}>
      <Text style={styles.ownerSectionTitle}>{title}</Text>
      {items?.length ? (
        displayItems(items, 4).map((item, index) => (
          <View key={`${title}-${item.kind}-${item.label}-${index}`} style={styles.ownerRow}>
            <View style={styles.ownerIconBubble}>
              <Ionicons name={icon} size={15} color={colors.primary} />
            </View>
            <View style={styles.ownerTextWrap}>
              <Text style={styles.ownerLabel}>{item.label}</Text>
              {!!item.detail && <Text style={styles.ownerDetail} numberOfLines={2}>{item.detail}</Text>}
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>{empty}</Text>
      )}
    </View>
  );
}

export default function AssetEnablementCard({
  asset,
  systems = [],
  resources = [],
  serviceRecords = [],
  storyEvents = [],
  actions = [],
  onOpenSystems,
  onOpenAttachments,
  onOpenTimeline,
  onEditAsset,
  onAskKai,
}) {
  const kac = assetKacId(asset);
  const { user } = useAuth();
  const [contextProjection, setContextProjection] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [actionRows, setActionRows] = useState(actions || []);
  const [showDetails, setShowDetails] = useState(false);

  const ownerId = user?.id || null;

  useEffect(() => {
    let cancelled = false;

    async function loadSelfServiceContext() {
      if (!kac) {
        setContextProjection(null);
        return;
      }
      const origin = currentOrigin();
      if (!origin) return;

      setLoadingContext(true);
      try {
        const response = await fetch(`${origin}/api/k/${encodeURIComponent(kac)}/context?purpose=self_service`);
        const json = await response.json();
        if (!cancelled) setContextProjection(response.ok ? json : null);
      } catch {
        if (!cancelled) setContextProjection(null);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    }

    loadSelfServiceContext();
    return () => {
      cancelled = true;
    };
  }, [kac]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadActions() {
        if (actions?.length || !asset?.id || !ownerId) {
          setActionRows(actions || []);
          return;
        }
        try {
          const rows = await fetchCoordinationActions({
            statuses: ["open"],
            ownerId,
          });
          if (!cancelled) setActionRows(rows || []);
        } catch {
          if (!cancelled) setActionRows([]);
        }
      }

      loadActions();
      return () => {
        cancelled = true;
      };
    }, [actions, asset?.id, ownerId])
  );

  const projection = useMemo(
    () =>
      projectAssetEnablement({
        asset,
        contextProjection,
        systems,
        resources,
        serviceRecords,
        storyEvents,
        actions: actionRows,
      }),
    [asset, actionRows, contextProjection, resources, serviceRecords, storyEvents, systems]
  );

  const ownerProjection = projection.owner || {};
  const primaryAction = projection.proposed_actions[0] || null;

  function runAction(target) {
    if (target === "actions") return onOpenTimeline?.();
    if (target === "systems") return onOpenSystems?.();
    if (target === "attachments") return onOpenAttachments?.();
    if (target === "timeline") return onOpenTimeline?.();
    if (target === "edit_asset") return onEditAsset?.();
    if (target === "ask_kai") return onAskKai?.();
    if (target === "ai_context" && kac) return openWebPath(`/k/${encodeURIComponent(kac)}/ai`);
    return onOpenAttachments?.();
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>KEEPR ENABLE</Text>
          <Text style={styles.title}>Asset Intelligence</Text>
        </View>
        {loadingContext ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={styles.contractBadge}>
            <Text style={styles.contractText}>V1</Text>
          </View>
        )}
      </View>

      <Text style={styles.summary}>
        {ownerProjection.summary}
      </Text>

      <View style={styles.ownerGrid}>
        <OwnerList
          title="What Keepr Knows"
          items={ownerProjection.knows}
          empty="Keepr is ready to learn from this asset's identity, systems, history and proof."
          icon="shield-checkmark-outline"
        />
        <OwnerList
          title="What Needs Attention"
          items={ownerProjection.needs_attention}
          empty="No immediate care item is standing out from the current context."
          icon="alert-circle-outline"
        />
        <OwnerList
          title="What Keepr Can Help Take Care Of"
          items={ownerProjection.can_help}
          empty="Ask KAI, add evidence, or open the asset story to keep building context."
          icon="sparkles-outline"
        />
      </View>

      {!!ownerProjection.next_action && (
        <View style={styles.actionPanel}>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionKicker}>Next known step</Text>
            <Text style={styles.actionTitle}>{ownerProjection.next_action.title || "Continue this action"}</Text>
            <Text style={styles.actionReason}>This comes from the asset's open actions and care-plan context.</Text>
          </View>
          <TouchableOpacity style={styles.actionButton} onPress={() => runAction("actions")} activeOpacity={0.86}>
            <Ionicons name="arrow-forward-outline" size={15} color="#fff" />
            <Text style={styles.actionButtonText}>Open</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onAskKai} activeOpacity={0.86}>
          <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>Ask KAI</Text>
        </TouchableOpacity>
        {!!kac && (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => runAction("ai_context")} activeOpacity={0.86}>
            <Ionicons name="globe-outline" size={15} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>AI Context</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={onOpenSystems} activeOpacity={0.86}>
          <Ionicons name="grid-outline" size={15} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>Systems</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onOpenAttachments} activeOpacity={0.86}>
          <Ionicons name="attach-outline" size={15} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>Evidence</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDetails((value) => !value)} activeOpacity={0.86}>
          <Ionicons name={showDetails ? "chevron-up-outline" : "chevron-down-outline"} size={15} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>Details</Text>
        </TouchableOpacity>
      </View>

      {showDetails && (
        <View style={styles.detailsPanel}>
          <View style={styles.statusGrid}>
            <StatusPill label="Identity" value={projection.status.identity} />
            <StatusPill label="Model" value={projection.status.model_resolution} />
            <StatusPill label="Systems" value={projection.status.system_templates} />
            <StatusPill label="Resources" value={projection.status.resources} />
          </View>

          <View style={styles.countRow}>
            <View style={styles.countTile}>
              <Text style={styles.countValue}>{projection.counts.systems}</Text>
              <Text style={styles.countLabel}>systems</Text>
            </View>
            <View style={styles.countTile}>
              <Text style={styles.countValue}>{projection.counts.resources}</Text>
              <Text style={styles.countLabel}>resources</Text>
            </View>
            <View style={styles.countTile}>
              <Text style={styles.countValue}>{projection.counts.missing}</Text>
              <Text style={styles.countLabel}>missing</Text>
            </View>
            <View style={styles.countTile}>
              <Text style={styles.countValue}>{projection.counts.unresolved}</Text>
              <Text style={styles.countLabel}>unresolved</Text>
            </View>
          </View>

          <View style={styles.factGrid}>
            <FactList title="Known Technical Signals" items={projection.known} empty="No established asset intelligence yet." />
            <FactList title="Inherited Context" items={projection.inheritable} empty="No reusable model or system knowledge is resolved yet." />
            <FactList title="Unresolved Diagnostics" items={projection.missing} empty="No high-value missing intelligence detected." />
          </View>

          {!!projection.conflicting.length && (
            <FactList title="Conflicting" items={projection.conflicting} empty="" />
          )}

          {!!primaryAction && !ownerProjection.next_action && (
            <View style={styles.actionPanel}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionKicker}>Context improvement</Text>
                <Text style={styles.actionTitle}>{primaryAction.title}</Text>
                <Text style={styles.actionReason}>{primaryAction.reason}</Text>
              </View>
              <TouchableOpacity style={styles.actionButton} onPress={() => runAction(primaryAction.target)} activeOpacity={0.86}>
                <Ionicons name="arrow-forward-outline" size={15} color="#fff" />
                <Text style={styles.actionButtonText}>Open</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...shadows.subtle,
    marginBottom: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  title: {
    marginTop: 2,
    fontSize: 17,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  contractBadge: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  contractText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textSecondary,
  },
  summary: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  statusGrid: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ownerGrid: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  ownerSection: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  ownerSectionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  ownerRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 7,
  },
  ownerIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  ownerTextWrap: {
    flex: 1,
  },
  ownerLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  ownerDetail: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  detailsPanel: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm,
  },
  statusPill: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 116,
  },
  statusGood: {
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
  },
  statusPartial: {
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  statusLabelStrong: { color: colors.textSecondary },
  statusValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
    textTransform: "capitalize",
  },
  statusValueStrong: { color: colors.textPrimary },
  countRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.md,
  },
  countTile: {
    minWidth: 86,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 10,
  },
  countValue: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  countLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  factGrid: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  factColumn: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm,
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 7,
  },
  factRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 5,
  },
  factDot: { marginTop: 6 },
  factLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  factDetail: {
    marginTop: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  actionPanel: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  actionKicker: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  actionTitle: {
    marginTop: 2,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  actionReason: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actionButton: {
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  buttonRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  secondaryButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
});
