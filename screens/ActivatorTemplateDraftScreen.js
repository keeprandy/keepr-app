import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { publishCatalogTemplateDraft } from "../lib/activatorApi";
import { tiara43LsTemplateDraft } from "../data/tiara43LsTemplateDraft";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

function valueToText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseEditedValue(text, fallback) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if (typeof fallback === "object" && fallback !== null) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed;
    }
  }
  if (typeof fallback === "number") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return trimmed;
}

function toneForReview(state) {
  if (state === "accepted") return "green";
  if (state === "rejected") return "red";
  return "yellow";
}

function DraftSourceCard({ source }) {
  return (
    <View style={styles.sourceCard}>
      <View style={styles.sourceIcon}>
        <Ionicons name="document-text-outline" size={18} color={colors.brandBlue} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sourceTitle}>{source.title}</Text>
        <Text style={styles.sourceMeta}>{source.source_type} · {source.authority_state}</Text>
        <TouchableOpacity onPress={() => source.url && Linking.openURL(source.url)}>
          <Text style={styles.sourceUrl} numberOfLines={1}>{source.url}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ReviewButtons({ state, onChange }) {
  return (
    <View style={styles.reviewButtons}>
      {[
        ["accepted", "Accept", "checkmark-circle-outline"],
        ["needs_review", "Review", "alert-circle-outline"],
        ["rejected", "Reject", "close-circle-outline"],
      ].map(([next, label, icon]) => {
        const active = state === next;
        return (
          <TouchableOpacity
            key={next}
            style={[styles.reviewButton, active && styles.reviewButtonActive]}
            onPress={() => onChange(next)}
            activeOpacity={0.86}
          >
            <Ionicons name={icon} size={14} color={active ? colors.onPrimary : colors.textSecondary} />
            <Text style={[styles.reviewButtonText, active && styles.reviewButtonTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function FactCard({ fact, onValueChange, onReviewChange }) {
  const tone = toneForReview(fact.review_state);
  return (
    <View style={styles.factCard}>
      <View style={styles.factHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.factLabel}>{fact.label}</Text>
          <Text style={styles.factDestination}>{fact.destination}</Text>
        </View>
        <View style={[styles.statusPill, styles[`statusPill_${tone}`]]}>
          <Text style={[styles.statusText, styles[`statusText_${tone}`]]}>{fact.review_state.replace(/_/g, " ")}</Text>
        </View>
      </View>

      <TextInput
        value={fact.edit_text}
        onChangeText={onValueChange}
        multiline={fact.edit_text.length > 48 || fact.edit_text.includes("\n")}
        style={[styles.factInput, fact.edit_text.includes("\n") && styles.factInputTall]}
      />

      <View style={styles.factMetaGrid}>
        <Text style={styles.factMeta}>confidence {Math.round((fact.confidence || 0) * 100)}%</Text>
        <Text style={styles.factMeta}>{fact.extraction_type.replace(/_/g, " ")}</Text>
      </View>
      <Text style={styles.evidence}>{fact.evidence}</Text>
      <ReviewButtons state={fact.review_state} onChange={onReviewChange} />
    </View>
  );
}

function SystemCard({ system, onReviewChange }) {
  const tone = toneForReview(system.review_state);
  return (
    <View style={styles.systemCard}>
      <View style={styles.factHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.factLabel}>{system.name}</Text>
          <Text style={styles.factDestination}>{system.creates}</Text>
        </View>
        <View style={[styles.statusPill, styles[`statusPill_${tone}`]]}>
          <Text style={[styles.statusText, styles[`statusText_${tone}`]]}>{system.review_state.replace(/_/g, " ")}</Text>
        </View>
      </View>
      <Text style={styles.systemModels}>
        {(system.component_models || []).length ? system.component_models.join(", ") : "No component model proposed yet"}
      </Text>
      <Text style={styles.factMeta}>confidence {Math.round((system.confidence || 0) * 100)}%</Text>
      <ReviewButtons state={system.review_state} onChange={onReviewChange} />
    </View>
  );
}

function ConfigurationGroupCard({ group, onReviewChange }) {
  const tone = toneForReview(group.review_state);
  const acceptedItems = (group.items || []).filter((item) => item.review_state === "accepted").length;
  return (
    <View style={styles.systemCard}>
      <View style={styles.factHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.factLabel}>{group.label || group.oem_group_name}</Text>
          <Text style={styles.factDestination}>configuration_group · OEM label preserved</Text>
        </View>
        <View style={[styles.statusPill, styles[`statusPill_${tone}`]]}>
          <Text style={[styles.statusText, styles[`statusText_${tone}`]]}>{group.review_state.replace(/_/g, " ")}</Text>
        </View>
      </View>
      <Text style={styles.systemModels}>
        OEM group: {group.oem_group_name || group.label}
      </Text>
      <Text style={styles.factMeta}>
        {acceptedItems}/{(group.items || []).length} accepted items · confidence {Math.round((group.confidence || 0) * 100)}%
      </Text>
      {(group.items || []).slice(0, 3).map((item) => (
        <Text key={item.id} style={styles.configurationItem} numberOfLines={2}>
          {item.oem_item_code ? `${item.oem_item_code} · ` : ""}{item.oem_item_name || item.label}
        </Text>
      ))}
      <ReviewButtons state={group.review_state} onChange={onReviewChange} />
    </View>
  );
}

export default function ActivatorTemplateDraftScreen({ navigation, route }) {
  const organizationId = route?.params?.organizationId || null;
  const workspaceId = route?.params?.workspaceId || null;
  const [sources, setSources] = useState(tiara43LsTemplateDraft.sources);
  const [sourceUrl, setSourceUrl] = useState("https://www.tiarayachts.com/series/ls/models/43ls");
  const [facts, setFacts] = useState(() =>
    tiara43LsTemplateDraft.proposed_facts.map((fact) => ({
      ...fact,
      edit_text: valueToText(fact.proposed_value),
    }))
  );
  const [systems, setSystems] = useState(tiara43LsTemplateDraft.proposed_systems);
  const [configurationGroups, setConfigurationGroups] = useState(tiara43LsTemplateDraft.proposed_configuration_groups || []);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  const summary = useMemo(() => {
    const acceptedFacts = facts.filter((fact) => fact.review_state === "accepted");
    const rejectedFacts = facts.filter((fact) => fact.review_state === "rejected");
    const reviewFacts = facts.filter((fact) => fact.review_state === "needs_review");
    const acceptedSystems = systems.filter((system) => system.review_state === "accepted");
    const acceptedConfigurationGroups = configurationGroups
      .filter((group) => group.review_state === "accepted")
      .map((group) => ({
        ...group,
        items: (group.items || []).filter((item) => item.review_state === "accepted"),
      }))
      .filter((group) => group.items.length);
    return {
      acceptedFacts,
      rejectedFacts,
      reviewFacts,
      acceptedSystems,
      acceptedConfigurationGroups,
    };
  }, [facts, systems, configurationGroups]);

  const addSource = () => {
    const url = sourceUrl.trim();
    if (!url) return;
    if (sources.some((source) => source.url === url)) return;
    setSources((current) => [
      ...current,
      {
        id: `src-${Date.now()}`,
        source_type: "source_snapshot",
        title: "Added review source",
        url,
        authority_state: "source_reported",
        rights_status: "review_permission",
      },
    ]);
  };

  const publish = async () => {
    if (!organizationId) {
      Alert.alert("Missing organization", "Open this draft from the Tiara workspace before publishing.");
      return;
    }
    if (!summary.acceptedFacts.length) {
      Alert.alert("Nothing accepted", "Accept at least one fact before publishing.");
      return;
    }

    setPublishing(true);
    setPublishResult(null);
    try {
      const approvedFacts = summary.acceptedFacts.map((fact) => ({
        ...fact,
        proposed_value: parseEditedValue(fact.edit_text, fact.proposed_value),
      }));
      const result = await publishCatalogTemplateDraft({
        organizationId,
        draft: {
          ...tiara43LsTemplateDraft,
          sources,
          template: {
            manufacturer: "Tiara Yachts",
            model: "43 LS",
            model_year: Number(approvedFacts.find((fact) => fact.destination === "asset_model_templates.model_year")?.proposed_value) || 2027,
          },
        },
        approvedFacts,
        approvedSystems: summary.acceptedSystems,
        approvedConfigurationGroups: summary.acceptedConfigurationGroups,
      });
      setPublishResult(result);
      Alert.alert("Draft published", "The accepted 43 LS facts are now in the Model Catalog.");
    } catch (err) {
      console.error("Publish template draft failed", err);
      Alert.alert("Could not publish draft", err?.message || "Apply the draft migration to staging and try again.");
    } finally {
      setPublishing(false);
    }
  };

  const openCatalog = () => {
    navigation.navigate("ActivatorCatalogTemplate", {
      templateKey: tiara43LsTemplateDraft.template_key,
      organizationId,
      workspaceId,
    });
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <ActivatorBreadcrumb
          navigation={navigation}
          items={[
            {
              label: "Model Catalog",
              route: "ActivatorHome",
              params: {
                initialMode: "templates",
                navSection: "ActivatorTemplates",
                organizationId,
                workspaceId,
              },
            },
          ]}
          current="43 LS Draft"
        />

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Source Draft</Text>
          <Text style={styles.title}>43 LS template draft</Text>
          <Text style={styles.subtitle}>
            Proposed model facts stay in review until a human accepts, edits, or rejects them. Publish writes only accepted facts into the existing Keepr Model Catalog.
          </Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.acceptedFacts.length}</Text>
              <Text style={styles.summaryLabel}>accepted facts</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.reviewFacts.length}</Text>
              <Text style={styles.summaryLabel}>need review</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.acceptedSystems.length}</Text>
              <Text style={styles.summaryLabel}>systems ready</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{summary.acceptedConfigurationGroups.length}</Text>
              <Text style={styles.summaryLabel}>config groups</Text>
            </View>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionKicker}>Sources</Text>
              <Text style={styles.sectionTitle}>Evidence before canonical data</Text>
            </View>
            <Text style={styles.countText}>{sources.length}</Text>
          </View>
          <View style={styles.sourceInputRow}>
            <TextInput
              value={sourceUrl}
              onChangeText={setSourceUrl}
              placeholder="Paste source URL"
              style={styles.sourceInput}
            />
            <TouchableOpacity style={styles.secondaryButton} onPress={addSource}>
              <Ionicons name="add-outline" size={15} color={colors.brandNavy} />
              <Text style={styles.secondaryButtonText}>Add Source</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.sourceList}>
            {sources.map((source) => <DraftSourceCard key={source.id} source={source} />)}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionKicker}>Configuration</Text>
              <Text style={styles.sectionTitle}>OEM vocabulary preserved as data</Text>
            </View>
            <Text style={styles.countText}>{configurationGroups.length}</Text>
          </View>
          <View style={styles.factGrid}>
            {configurationGroups.map((group) => (
              <ConfigurationGroupCard
                key={group.id}
                group={group}
                onReviewChange={(state) => setConfigurationGroups((current) => current.map((item) => item.id === group.id ? {
                  ...item,
                  review_state: state,
                  items: (item.items || []).map((child) => ({
                    ...child,
                    review_state: state === "accepted" || state === "rejected" ? state : child.review_state,
                  })),
                } : item))}
              />
            ))}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionKicker}>Review Facts</Text>
              <Text style={styles.sectionTitle}>Accept, edit, or reject before publish</Text>
            </View>
            <Text style={styles.countText}>{facts.length}</Text>
          </View>
          <View style={styles.factGrid}>
            {facts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                onValueChange={(text) => setFacts((current) => current.map((item) => item.id === fact.id ? { ...item, edit_text: text, review_state: item.review_state === "accepted" ? "needs_review" : item.review_state } : item))}
                onReviewChange={(state) => setFacts((current) => current.map((item) => item.id === fact.id ? { ...item, review_state: state } : item))}
              />
            ))}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionKicker}>Proposed Systems</Text>
              <Text style={styles.sectionTitle}>Publish only confirmed operational structure</Text>
            </View>
            <Text style={styles.countText}>{systems.length}</Text>
          </View>
          <View style={styles.factGrid}>
            {systems.map((system) => (
              <SystemCard
                key={system.id}
                system={system}
                onReviewChange={(state) => setSystems((current) => current.map((item) => item.id === system.id ? { ...item, review_state: state } : item))}
              />
            ))}
          </View>
        </View>

        <View style={styles.publishPanel}>
          <View>
            <Text style={styles.sectionTitle}>Publish reviewed draft</Text>
            <Text style={styles.publishText}>
              Accepted facts become template fields, source records, specs, and model systems. Rejected facts remain draft history.
            </Text>
            {publishResult ? (
              <Text style={styles.resultText}>
                Published {publishResult.published_facts} facts, {publishResult.published_systems} systems, and {publishResult.published_configuration_items || 0} configuration items to {publishResult.template_key}.
              </Text>
            ) : null}
          </View>
          <View style={styles.publishActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={openCatalog}>
              <Ionicons name="open-outline" size={15} color={colors.brandNavy} />
              <Text style={styles.secondaryButtonText}>Open Catalog</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={publish} disabled={publishing}>
              {publishing ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={15} color={colors.onPrimary} />}
              <Text style={styles.primaryButtonText}>{publishing ? "Publishing..." : "Publish Accepted"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  hero: {
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    gap: spacing.md,
    padding: spacing.xl,
    ...shadows.sm,
  },
  eyebrow: {
    color: "#93C5FD",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: colors.onPrimary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 820,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  summaryTile: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 150,
    padding: spacing.md,
  },
  summaryValue: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  summaryLabel: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  sourceInputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sourceInput: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    minHeight: 42,
    minWidth: 260,
    paddingHorizontal: spacing.md,
  },
  sourceList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sourceCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  sourceIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  sourceTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  sourceMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  sourceUrl: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  factCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 310,
    padding: spacing.md,
    width: "31%",
  },
  systemCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 310,
    padding: spacing.md,
    width: "31%",
  },
  factHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  factLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
  },
  factDestination: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  factInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 42,
    padding: spacing.sm,
  },
  factInputTall: {
    minHeight: 94,
    textAlignVertical: "top",
  },
  factMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  factMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  evidence: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  systemModels: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  configurationItem: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    paddingTop: spacing.sm,
  },
  statusPill: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusPill_green: {
    backgroundColor: "#DCFCE7",
  },
  statusPill_yellow: {
    backgroundColor: "#FEF3C7",
  },
  statusPill_red: {
    backgroundColor: "#FEE2E2",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusText_green: {
    color: "#166534",
  },
  statusText_yellow: {
    color: "#92400E",
  },
  statusText_red: {
    color: "#991B1B",
  },
  reviewButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  reviewButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  reviewButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  reviewButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  reviewButtonTextActive: {
    color: colors.onPrimary,
  },
  publishPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.lg,
    ...shadows.sm,
  },
  publishText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
    maxWidth: 760,
  },
  resultText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  publishActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.brandNavy,
    fontSize: 13,
    fontWeight: "900",
  },
});
