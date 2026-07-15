import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { colors, radius, spacing, typography } from "../../styles/theme";

function StatePill({ label }) {
  return (
    <View style={styles.statePill}>
      <Text style={styles.statePillText}>{label}</Text>
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function EmptyText({ children }) {
  return <Text style={styles.emptyText}>{children}</Text>;
}

function ReadinessCard({ item }) {
  return (
    <View style={styles.readinessCard}>
      <View style={styles.readinessTop}>
        <Text style={styles.readinessTitle}>{item.title}</Text>
        <StatePill label={item.status} />
      </View>
      {!!item.summary && <Text style={styles.readinessSummary}>{item.summary}</Text>}
    </View>
  );
}

function FactRow({ item }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{item.label}</Text>
      <Text style={styles.factValue}>{item.value}</Text>
      <Text style={styles.factMeta}>{item.category} · {item.confidence}</Text>
    </View>
  );
}

function AttentionRow({ item }) {
  return (
    <View style={styles.attentionRow}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.warning || "#B7791F"} />
      <View style={{ flex: 1 }}>
        <Text style={styles.attentionTitle}>{item.title}</Text>
        {!!item.explanation && <Text style={styles.attentionText}>{item.explanation}</Text>}
      </View>
    </View>
  );
}

export default function KeeprIntelligenceUpdatePanel({ viewModel, loading, onRetry }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  if (loading) {
    return (
      <View style={[styles.shell, styles.centerShell]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading Keepr Intelligence Update...</Text>
      </View>
    );
  }

  if (!viewModel || viewModel.state === "session_expired" || viewModel.state === "concealed" || viewModel.state === "endpoint_unavailable" || viewModel.state === "empty") {
    return (
      <View style={[styles.shell, styles.centerShell]}>
        <View style={styles.emptyIcon}>
          <Ionicons name="sparkles-outline" size={28} color={colors.textSecondary} />
        </View>
        <Text style={styles.errorTitle}>{viewModel?.title || "Intelligence update unavailable"}</Text>
        <Text style={styles.errorText}>{viewModel?.message || "Keepr could not load this update."}</Text>
        {viewModel?.retryable && (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.85}>
            <Ionicons name="refresh-outline" size={16} color="white" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.shell, isWide && styles.shellWide]}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Keepr Intelligence Update</Text>
          <Text style={styles.assetName}>{viewModel.assetName}</Text>
          <Text style={styles.kac}>{viewModel.kac}</Text>
        </View>
        <StatePill label={viewModel.ownerStatus} />
      </View>

      <Section title="Current State">
        <View style={styles.currentStateBox}>
          <Text style={styles.headline}>{viewModel.currentState.headline}</Text>
          <Text style={styles.subheadline}>{viewModel.currentState.subheadline}</Text>
          <View style={styles.statusRow}>
            <StatePill label={viewModel.currentState.contextStatus} />
            <StatePill label={viewModel.currentState.completeness} />
          </View>
        </View>
      </Section>

      <Section title="Readiness">
        <View style={styles.readinessGrid}>
          {viewModel.readiness.map((item) => (
            <ReadinessCard key={item.dimension} item={item} />
          ))}
        </View>
      </Section>

      <Section title="What Keepr Knows">
        {viewModel.knownFacts.length ? (
          <View style={styles.factList}>
            {viewModel.knownFacts.map((item) => <FactRow key={item.id} item={item} />)}
          </View>
        ) : (
          <EmptyText>Keepr does not yet have enough owner-safe intelligence to summarize this asset.</EmptyText>
        )}
      </Section>

      <Section title="What Needs Attention">
        {viewModel.attentionItems.length ? (
          <View style={styles.attentionList}>
            {viewModel.attentionItems.map((item) => <AttentionRow key={item.id} item={item} />)}
          </View>
        ) : (
          <EmptyText>No urgent gaps surfaced from the information currently available.</EmptyText>
        )}
      </Section>

      <Section title="Next Best Step">
        {viewModel.nextBestStep?.question ? (
          <View style={styles.nextBox}>
            <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.nextText}>{viewModel.nextBestStep.question}</Text>
          </View>
        ) : (
          <EmptyText>No next question is needed from the current information.</EmptyText>
        )}
      </Section>

      {!!viewModel.capabilities.length && (
        <Section title="Available Review Options">
          <View style={styles.capabilityRow}>
            {viewModel.capabilities.map((item) => (
              <View key={item.key} style={styles.capabilityPill}>
                <Text style={styles.capabilityText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      <Text style={styles.footer}>{viewModel.footer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shell: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  shellWide: {
    maxWidth: 980,
    alignSelf: "center",
    width: "100%",
  },
  centerShell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  assetName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  kac: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  statePill: {
    borderRadius: radius.full || 999,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statePillText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "800",
  },
  currentStateBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headline: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 26,
  },
  subheadline: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  readinessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  readinessCard: {
    flexGrow: 1,
    flexBasis: 145,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  readinessTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  readinessTitle: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  readinessSummary: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  factList: {
    gap: spacing.sm,
  },
  factRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  factLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  factValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },
  factMeta: {
    color: colors.textTertiary || colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  attentionList: {
    gap: spacing.sm,
  },
  attentionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  attentionTitle: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  attentionText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  nextBox: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  nextText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  capabilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  capabilityPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.full || 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  capabilityText: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    lineHeight: 20,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  errorText: {
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 420,
    marginTop: spacing.sm,
  },
  retryButton: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.full || 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: "white",
    fontWeight: "800",
  },
  footer: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
});
