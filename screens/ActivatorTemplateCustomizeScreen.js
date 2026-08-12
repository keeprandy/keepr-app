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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import {
  getTemplateSourceActivationWorkspace,
  publishTemplateFreshwaterActivation,
} from "../lib/activatorApi";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");
const TIARA_OEM_LOGO = require("../assets/boats/tiara/tiara_oem_logo.png");

const DEFAULT_GUIDANCE = [
  {
    canonical_key: "knowledge.freshwater.operation",
    label: "Freshwater operation",
    topic_type: "operation",
    page_start: 59,
    page_end: 60,
    body: "Fill the freshwater tank through the port gunwale WATER fill until water runs from the hull-side vent. Open faucets, switch on Fresh Water Pump from the Garmin EmpirBus Systems screen, purge air until a steady stream flows, then close faucets one by one. Turn the pump off when the boat is unattended.",
  },
  {
    canonical_key: "knowledge.freshwater.water_heater",
    label: "Water heater operation",
    topic_type: "operation",
    page_start: 60,
    page_end: 60,
    body: "The water heater is in the mechanical space. Purge all air from the heater and lines before turning on the WATER HEATER breaker on the atrium AC distribution panel. Do not energize the heater until filled and primed.",
  },
  {
    canonical_key: "knowledge.freshwater.commissioning",
    label: "Freshwater commissioning",
    topic_type: "commissioning",
    page_start: 60,
    page_end: 62,
    body: "Before first use and annually at the beginning of each season, disinfect the freshwater system. Drain antifreeze, fill through the WATER fill, run the Fresh Water Pump from the Garmin EmpirBus display, circulate sanitizing solution through hot and cold taps, drain, rinse, and final-fill until flow is smooth.",
  },
  {
    canonical_key: "knowledge.freshwater.maintenance",
    label: "Freshwater maintenance",
    topic_type: "maintenance",
    page_start: 67,
    page_end: 68,
    body: "Maintain the freshwater system by cleaning faucet filter screens, keeping the tank fresh with potable water conditioner, and turning Fresh Water Pump off when leaving the boat unattended. The system must be winterized before storage.",
  },
];

const DEFAULT_PLAYBOOKS = [
  {
    canonical_key: "playbook.freshwater_commissioning",
    label: "Commission Freshwater System",
    page_start: 60,
    page_end: 62,
    body: "Drain storage antifreeze, fill and flush the tank, sanitize with the recommended bleach solution, circulate through each hot and cold tap, drain, rinse twice, then final-fill and purge air until flow is smooth.",
  },
  {
    canonical_key: "playbook.freshwater_winterization",
    label: "Winterize Freshwater System",
    page_start: 59,
    page_end: 68,
    body: "Prepare the freshwater system for storage before winter lay-up. Follow Tiara seasonal maintenance guidance and ensure the water heater and freshwater pump are protected before storage.",
  },
];

function pageRange(item) {
  if (!item?.page_start && !item?.source_page_start) return "Source pages";
  const start = item.page_start || item.source_page_start;
  const end = item.page_end || item.source_page_end || start;
  return start === end ? `Page ${start}` : `Pages ${start}-${end}`;
}

function sourceState(source) {
  const family = source?.metadata?.document_family;
  if (family === "tiara_39ls_owners_manual") return "Added as source";
  return "Available";
}

function ProposalEditor({ title, icon, items, onChange }) {
  return (
    <View style={styles.editorPanel}>
      <View style={styles.panelHeader}>
        <View style={styles.titleRow}>
          <Ionicons name={icon} size={17} color={colors.brandBlue} />
          <Text style={styles.panelTitle}>{title}</Text>
        </View>
        <Text style={styles.countText}>{items.length}</Text>
      </View>
      <View style={styles.proposalList}>
        {items.map((item, index) => (
          <View key={item.canonical_key} style={styles.proposalCard}>
            <View style={styles.proposalHeader}>
              <View style={styles.proposalKickerWrap}>
                <Text style={styles.kicker}>{pageRange(item)}</Text>
                <Text style={styles.proposalTitle}>{item.label}</Text>
              </View>
              <View style={styles.reviewPill}>
                <Text style={styles.reviewPillText}>Editable</Text>
              </View>
            </View>
            <TextInput
              multiline
              value={item.body}
              onChangeText={(value) => onChange(index, value)}
              style={styles.proposalInput}
              textAlignVertical="top"
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function SourceCard({ source, selected }) {
  return (
    <View style={[styles.sourceCard, selected && styles.sourceCardSelected]}>
      <View style={styles.sourceIcon}>
        <Ionicons name="document-text-outline" size={19} color={colors.brandBlue} />
      </View>
      <View style={styles.sourceText}>
        <Text style={styles.sourceTitle}>{source.title}</Text>
        <Text style={styles.sourceMeta}>
          {source.metadata?.version_label || source.metadata?.resource_version || "Versioned resource"}
        </Text>
      </View>
      <View style={styles.sourceState}>
        <Text style={styles.sourceStateText}>{sourceState(source)}</Text>
      </View>
    </View>
  );
}

export default function ActivatorTemplateCustomizeScreen({ navigation, route }) {
  const templateKey = route?.params?.templateKey || "tiara-2027-39-ls";
  const [workspace, setWorkspace] = useState(null);
  const [guidance, setGuidance] = useState(DEFAULT_GUIDANCE);
  const [playbooks, setPlaybooks] = useState(DEFAULT_PLAYBOOKS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await getTemplateSourceActivationWorkspace(templateKey);
      setWorkspace(next);
    } catch (err) {
      console.error("Template source activation failed:", err);
      setError(err?.message || "Could not open template authoring.");
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const template = workspace?.template || {};
  const sources = workspace?.sources || [];
  const segments = workspace?.segments || [];
  const publishedItems = workspace?.published_items || [];
  const ownerManual = sources.find((source) => source.metadata?.document_key === "tiara_39ls_owners_manual_my2026");
  const activated = segments.length > 0 && segments.every((segment) => segment.status === "activated");
  const freshwaterPublished = publishedItems.some((item) => item.canonical_key === "system.freshwater");

  const segmentByKey = useMemo(() => {
    return segments.reduce((acc, segment) => {
      acc[segment.segment_key] = segment;
      return acc;
    }, {});
  }, [segments]);

  const updateGuidance = (index, body) => {
    setGuidance((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, body } : item));
  };

  const updatePlaybook = (index, body) => {
    setPlaybooks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, body } : item));
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const next = await publishTemplateFreshwaterActivation({ templateKey, guidance, playbooks });
      setWorkspace(next);
    } catch (err) {
      console.error("Freshwater publish failed:", err);
      setError(err?.message || "Could not publish Freshwater into the template.");
    } finally {
      setPublishing(false);
    }
  };

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const openExactBuild = () => {
    navigation.navigate("ActivatorExactBuild", { templateKey: template.template_key || templateKey });
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ActivatorBreadcrumb
          navigation={navigation}
          items={[
            { label: "Customize Catalog", route: "ActivatorHome", params: { initialMode: "templates" } },
            { label: `${template.model || "39 LS"} Template`, route: "ActivatorCatalogTemplate", params: { templateKey } },
          ]}
          current="Freshwater Source Activation"
        />
        <ImageBackground source={HERO} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroBrandCard}>
              <Image source={TIARA_OEM_LOGO} resizeMode="contain" style={styles.heroLogo} />
              <View style={styles.heroBrandTextWrap}>
                <Text style={styles.heroBrandName}>Tiara Yachts</Text>
                <Text style={styles.heroBrandMeta}>OEM catalog authoring</Text>
              </View>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Customize Template</Text>
              <Text style={styles.title}>Activate Freshwater for the 39 LS</Text>
              <Text style={styles.subtitle}>
                Turn source manuals into reviewed operational guidance and playbooks that publish into the reusable MY{template.model_year || "2027"} 39 LS template, then flow into every exact hull built from it.
              </Text>
              <View style={styles.heroBadges}>
                <View style={styles.heroBadge}>
                  <Ionicons name="library-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>Source-backed</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="git-branch-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>Template-level</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="boat-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>Flows to hulls</Text>
                </View>
              </View>
            </View>
          </View>
        </ImageBackground>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Opening Tiara authoring workspace...</Text>
          </View>
        ) : error && !workspace ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.accentRed} />
            <Text style={styles.emptyTitle}>Template authoring is not available</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.workspaceGrid}>
            <View style={styles.leftColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Catalog Source Library</Text>
                    <Text style={styles.panelTitle}>Versioned resources</Text>
                  </View>
                  <Text style={styles.countText}>{sources.length}</Text>
                </View>
                <Text style={styles.panelText}>
                  The owner manual remains one versioned source. Freshwater is an activated domain inside that source, not a duplicate document.
                </Text>
                <View style={styles.sourceList}>
                  {sources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      selected={source.id === ownerManual?.id}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Freshwater Domain</Text>
                    <Text style={styles.panelTitle}>Manual sections mapped</Text>
                  </View>
                  <View style={[styles.statusPill, activated && styles.statusPillGood]}>
                    <Text style={[styles.statusPillText, activated && styles.statusPillTextGood]}>
                      {activated ? "Activated" : "Review needed"}
                    </Text>
                  </View>
                </View>
                <View style={styles.segmentList}>
                  {DEFAULT_GUIDANCE.map((item) => {
                    const segment = segmentByKey[item.canonical_key.replace("knowledge.", "")];
                    return (
                      <View key={item.canonical_key} style={styles.segmentCard}>
                        <Text style={styles.segmentPage}>{pageRange(segment || item)}</Text>
                        <Text style={styles.segmentTitle}>{item.label}</Text>
                        <Text style={styles.segmentExcerpt} numberOfLines={4}>
                          {segment?.excerpt || item.body}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.middleColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Review Proposal</Text>
                    <Text style={styles.panelTitle}>Freshwater System</Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>Standard system</Text>
                  </View>
                </View>
                <Text style={styles.panelText}>
                  This is the first proof of “Activate Source”: source text becomes owner-consumable context and operational playbooks that belong to the template.
                </Text>
              </View>

              <ProposalEditor
                title="Owner guidance"
                icon="sparkles-outline"
                items={guidance}
                onChange={updateGuidance}
              />

              <ProposalEditor
                title="Playbook candidates"
                icon="checkbox-outline"
                items={playbooks}
                onChange={updatePlaybook}
              />
            </View>

            <View style={styles.rightColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Publish Checkpoint</Text>
                    <Text style={styles.panelTitle}>What will flow down</Text>
                  </View>
                </View>
                <View style={styles.flowList}>
                  <View style={styles.flowItem}>
                    <Ionicons name="hardware-chip-outline" size={16} color={colors.accentGreen} />
                    <Text style={styles.flowText}>Freshwater System</Text>
                  </View>
                  <View style={styles.flowItem}>
                    <Ionicons name="sparkles-outline" size={16} color={colors.accentGreen} />
                    <Text style={styles.flowText}>{guidance.length} owner guidance topics</Text>
                  </View>
                  <View style={styles.flowItem}>
                    <Ionicons name="checkbox-outline" size={16} color={colors.accentGreen} />
                    <Text style={styles.flowText}>{playbooks.length} playbook candidates</Text>
                  </View>
                  <View style={styles.flowItem}>
                    <Ionicons name="document-text-outline" size={16} color={colors.accentGreen} />
                    <Text style={styles.flowText}>One shared Tiara owner manual source</Text>
                  </View>
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={publishing}
                  onPress={publish}
                  style={[styles.publishButton, publishing && styles.publishButtonDisabled]}
                >
                  {publishing ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={18} color={colors.onPrimary} />}
                  <Text style={styles.publishButtonText}>
                    {freshwaterPublished ? "Republish Freshwater" : "Publish Freshwater to Template"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.86} onPress={openExactBuild} style={styles.secondaryButton}>
                  <Ionicons name="boat-outline" size={17} color={colors.brandNavy} />
                  <Text style={styles.secondaryButtonText}>Build exact hull from template</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Published Template Items</Text>
                    <Text style={styles.panelTitle}>Freshwater layer</Text>
                  </View>
                  <Text style={styles.countText}>{publishedItems.length}</Text>
                </View>
                <View style={styles.publishedList}>
                  {publishedItems.length ? publishedItems.map((item) => (
                    <View key={item.id} style={styles.publishedItem}>
                      <Ionicons name="checkmark-circle-outline" size={15} color={colors.accentGreen} />
                      <View style={styles.publishedTextWrap}>
                        <Text style={styles.publishedTitle}>{item.label}</Text>
                        <Text style={styles.publishedMeta}>{item.item_type}</Text>
                      </View>
                    </View>
                  )) : (
                    <Text style={styles.panelText}>Nothing is published yet. Review and publish the Freshwater domain to make it part of the 39 LS template.</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  hero: {
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    minHeight: 300,
    overflow: "hidden",
    ...shadows.sm,
  },
  heroImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  heroOverlay: {
    backgroundColor: "rgba(5, 10, 24, 0.38)",
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 300,
    padding: spacing.xl,
  },
  heroBrandCard: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.md,
    left: spacing.xl,
    minHeight: 74,
    paddingHorizontal: spacing.md,
    position: "absolute",
    top: spacing.xl,
  },
  heroLogo: {
    backgroundColor: "#050505",
    borderRadius: radius.sm,
    height: 52,
    width: 52,
  },
  heroBrandTextWrap: {
    minWidth: 0,
  },
  heroBrandName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  heroBrandMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  heroCopy: {
    maxWidth: 790,
  },
  eyebrow: {
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.onPrimary,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 42,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 760,
  },
  heroBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  heroBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  heroBadgeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  workspaceGrid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  leftColumn: {
    flex: 0.92,
    gap: spacing.lg,
    minWidth: 300,
  },
  middleColumn: {
    flex: 1.25,
    gap: spacing.lg,
    minWidth: 360,
  },
  rightColumn: {
    flex: 0.9,
    gap: spacing.lg,
    minWidth: 300,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  editorPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  panelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  kicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 2,
  },
  countText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  panelText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  sourceList: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  sourceCard: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  sourceCardSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  sourceIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sourceText: {
    flex: 1,
    minWidth: 0,
  },
  sourceTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  sourceMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  sourceState: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  sourceStateText: {
    color: colors.brandNavy,
    fontSize: 10,
    fontWeight: "900",
  },
  statusPill: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusPillGood: {
    backgroundColor: "#DCFCE7",
  },
  statusPillText: {
    color: "#92400E",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusPillTextGood: {
    color: "#166534",
  },
  segmentList: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  segmentCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  segmentPage: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  segmentTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  segmentExcerpt: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  proposalList: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  proposalCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  proposalHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  proposalKickerWrap: {
    flex: 1,
    minWidth: 0,
  },
  proposalTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  reviewPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  reviewPillText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "900",
  },
  proposalInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
    minHeight: 92,
    outlineStyle: "none",
    padding: spacing.md,
  },
  flowList: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  flowItem: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  flowText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  publishButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  publishButtonDisabled: {
    opacity: 0.62,
  },
  publishButtonText: {
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
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.brandNavy,
    fontSize: 13,
    fontWeight: "900",
  },
  publishedList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  publishedItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  publishedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  publishedTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  publishedMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
    textTransform: "capitalize",
  },
  errorText: {
    color: colors.accentRed,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: spacing.md,
  },
  centered: {
    alignItems: "center",
    gap: spacing.md,
    justifyContent: "center",
    minHeight: 220,
  },
  emptyPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 220,
    padding: spacing.xl,
    ...shadows.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  mutedText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
});
