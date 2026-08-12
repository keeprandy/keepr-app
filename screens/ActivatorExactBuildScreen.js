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
import { getCatalogTemplateDetail } from "../lib/activatorApi";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const BOAT_HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");
const TIARA_OEM_LOGO = require("../assets/boats/tiara/tiara_oem_logo.png");

const SHOWCASE_ASSETS = {
  tiara_39ls_aft_cockpit: require("../assets/boats/tiara/tiara_39ls_aft_cockpit.jpg"),
  tiara_39ls_cabin_stateroom: require("../assets/boats/tiara/tiara_39ls_cabin_stateroom.jpg"),
  tiara_39ls_cockpit_lounge: require("../assets/boats/tiara/tiara_39ls_cockpit_lounge.jpg"),
  tiara_39ls_hero: require("../assets/boats/tiara/tiara_39ls_hero.jpg"),
};

const DEMO_FACTORY_OPTIONS = [
  {
    key: "propulsion.mercury_600_v12",
    group: "Propulsion",
    label: "Twin Mercury 600 V12",
    mode: "single",
    selected: true,
    locked: true,
    systems: ["Port Mercury V12 Verado", "Starboard Mercury V12 Verado", "Mercury joystick piloting"],
    resources: ["Tiara 39 LS Twin Mercury 600 Propulsion Manual", "Mercury VesselView guide"],
    playbooks: ["Engine serial verification", "Mercury break-in checklist"],
    requirements: ["Port engine serial", "Starboard engine serial"],
  },
  {
    key: "aft.buffet_lounge",
    group: "Aft Cockpit Module",
    label: "Buffet Lounge Module",
    mode: "single",
    selected: false,
    systems: ["Electric grill", "Cockpit entertainment module"],
    resources: ["Buffet Lounge Module owner's notes"],
    playbooks: ["Aft module delivery check"],
    requirements: ["Module install photo"],
  },
  {
    key: "aft.adventure",
    group: "Aft Cockpit Module",
    label: "Adventure Module",
    mode: "single",
    selected: true,
    systems: ["Livewell", "Electric grill", "Cockpit freezer", "Rod holder package"],
    resources: ["Adventure Module operation guide"],
    playbooks: ["Livewell commissioning", "Aft module delivery check"],
    requirements: ["Livewell pump verification", "Module install photo"],
  },
  {
    key: "mechanical.seakeeper",
    group: "Mechanical",
    label: "Seakeeper SK4.5 Gyro",
    mode: "multi",
    selected: true,
    systems: ["Seakeeper SK4.5 stabilization"],
    resources: ["Seakeeper SK4.5 manual"],
    playbooks: ["Gyro commissioning", "Seakeeper service interval setup"],
    requirements: ["Seakeeper serial number"],
  },
  {
    key: "mechanical.electrosea",
    group: "Mechanical",
    label: "ElectroSea",
    mode: "multi",
    selected: false,
    systems: ["ElectroSea Clearline system"],
    resources: ["ElectroSea owner's manual"],
    playbooks: ["Raw-water protection commissioning"],
    requirements: ["ElectroSea serial number"],
  },
  {
    key: "mechanical.bow_thruster",
    group: "Mechanical",
    label: "Bow Thruster",
    mode: "multi",
    selected: true,
    systems: ["Bow thruster"],
    resources: ["Bow thruster operation manual"],
    playbooks: ["Docking-system verification"],
    requirements: ["Thruster model and serial"],
  },
  {
    key: "electronics.garmin_standard",
    group: "Electronics",
    label: "Standard Garmin package",
    mode: "single",
    selected: true,
    locked: true,
    systems: ["Garmin GPSMAP 9000 display", "Garmin VHF", "Autopilot", "1kW transducer"],
    resources: ["Garmin GPSMAP 9000 owner's manual", "Garmin VHF quick guide"],
    playbooks: ["Electronics power-on check", "Navigation baseline setup"],
    requirements: ["Primary display serial"],
  },
  {
    key: "electronics.fantom_radar",
    group: "Electronics",
    label: "Fantom Radar",
    mode: "multi",
    selected: true,
    systems: ["Garmin Fantom radar"],
    resources: ["Garmin Fantom radar guide"],
    playbooks: ["Radar sea-trial verification"],
    requirements: ["Radar serial number"],
  },
  {
    key: "electronics.starlink",
    group: "Electronics",
    label: "Starlink",
    mode: "multi",
    selected: true,
    systems: ["Starlink marine internet"],
    resources: ["Starlink activation guide"],
    playbooks: ["Connectivity handoff setup"],
    requirements: ["Starlink kit number"],
  },
  {
    key: "electronics.flir",
    group: "Electronics",
    label: "FLIR",
    mode: "multi",
    selected: false,
    systems: ["FLIR thermal camera"],
    resources: ["FLIR operation manual"],
    playbooks: ["Night-vision calibration"],
    requirements: ["FLIR serial number"],
  },
];

const FINISH_FIELDS = [
  { key: "hull_color", label: "Hull color", value: "Pearl White" },
  { key: "bootline", label: "Bootline", value: "Crystal Blue" },
  { key: "upholstery", label: "Upholstery", value: "Cool Touch Natural" },
  { key: "interior_package", label: "Interior package", value: "Modern teak" },
];

const LIFECYCLE = ["Template", "OEM Build", "Factory Frozen", "Dealer", "Delivery Ready", "Owner Activated", "Operational"];

function compact(parts) {
  return parts.filter(Boolean).join(" · ");
}

function valueText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  if (value.value !== undefined) return compact([value.value, value.metric || value.unit]);
  if (value.summary) return value.summary;
  if (value.components) return value.components.join(", ");
  return null;
}

function mediaAsset(media) {
  return SHOWCASE_ASSETS[media?.local_asset_key] || SHOWCASE_ASSETS[media?.metadata?.local_asset_key] || BOAT_HERO;
}

function mediaByRole(media = [], role) {
  return media.find((item) => item.role === role || item.metadata?.role === role);
}

function groupTemplateItems(items = []) {
  const sectionById = new Map(items.filter((item) => item.item_type === "section").map((item) => [item.id, item]));
  return items
    .filter((item) => item.item_type !== "section" && item.item_type !== "option" && item.item_type !== "option_group")
    .map((item) => ({
      ...item,
      sectionLabel: sectionById.get(item.parent_item_id)?.label || "Model baseline",
    }));
}

function groupedOptions(options) {
  return options.reduce((acc, option) => {
    acc[option.group] = [...(acc[option.group] || []), option];
    return acc;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ToggleRow({ option, onToggle }) {
  const selected = option.selected;
  const icon = option.mode === "single"
    ? selected ? "radio-button-on" : "radio-button-off"
    : selected ? "checkbox" : "square-outline";
  const adds = [
    option.systems[0],
    option.resources[0] || null,
    option.playbooks[0]?.replace(/ checklist| setup| verification| commissioning/i, "") || null,
    option.requirements.length ? "Verification" : null,
  ].filter(Boolean);

  return (
    <TouchableOpacity
      activeOpacity={option.locked ? 1 : 0.82}
      disabled={option.locked}
      onPress={onToggle}
      style={[styles.optionRow, selected && styles.optionRowSelected, option.locked && styles.optionRowLocked]}
    >
      <Ionicons name={icon} size={20} color={selected ? colors.brandBlue : colors.textMuted} />
      <View style={styles.optionTextWrap}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{option.label}</Text>
          <Text style={[styles.optionState, selected && styles.optionStateSelected]}>
            {selected ? "Selected for this hull" : "Not on this hull"}
          </Text>
        </View>
        <Text style={styles.optionMeta}>Adds:</Text>
        <View style={styles.addsRow}>
          {adds.map((item) => (
            <View key={item} style={[styles.addChip, selected && styles.addChipSelected]}>
              <Text style={[styles.addChipText, selected && styles.addChipTextSelected]}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
      {option.locked ? <Text style={styles.lockedText}>Standard</Text> : null}
    </TouchableOpacity>
  );
}

function LifecycleRail() {
  return (
    <View style={styles.lifecycleRail}>
      {LIFECYCLE.map((step, index) => {
        const active = step === "OEM Build";
        const complete = index === 0;
        return (
          <View key={step} style={styles.lifecycleStep}>
            <View style={[styles.lifecycleDot, complete && styles.lifecycleDotComplete, active && styles.lifecycleDotActive]}>
              {complete ? <Ionicons name="checkmark" size={11} color={colors.onPrimary} /> : null}
            </View>
            <Text style={[styles.lifecycleText, active && styles.lifecycleTextActive]} numberOfLines={1}>{step}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CompileColumn({ title, icon, items, empty }) {
  return (
    <View style={styles.compileColumn}>
      <View style={styles.compileHeader}>
        <Ionicons name={icon} size={16} color={colors.brandBlue} />
        <Text style={styles.compileTitle}>{title}</Text>
        <Text style={styles.compileCount}>{items.length}</Text>
      </View>
      {items.length ? items.map((item) => (
        <View key={item} style={styles.compileItem}>
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.accentGreen} />
          <Text style={styles.compileText}>{item}</Text>
        </View>
      )) : (
        <Text style={styles.compileEmpty}>{empty}</Text>
      )}
    </View>
  );
}

function operationalBody(item) {
  return item?.expected_value?.guidance || item?.expected_value?.playbook || valueText(item?.expected_value);
}

function FreshwaterFlowdownPanel({ items }) {
  const freshwaterSystem = items.find((item) => item.canonical_key === "system.freshwater");
  const guidance = items.filter((item) => item.item_type === "knowledge");
  const playbooks = items.filter((item) => item.item_type === "playbook");

  if (!freshwaterSystem && !guidance.length && !playbooks.length) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.kicker}>Operational Knowledge</Text>
          <Text style={styles.panelTitle}>Freshwater flows into this hull</Text>
        </View>
        <View style={styles.inheritedPill}>
          <Text style={styles.inheritedPillText}>Inherited</Text>
        </View>
      </View>
      <Text style={styles.panelText}>
        Published Tiara manual content is attached to the reusable 39 LS template and inherited by this exact KAC without duplicating the source document.
      </Text>
      <View style={styles.freshwaterCard}>
        <View style={styles.freshwaterHeader}>
          <Ionicons name="water-outline" size={20} color={colors.brandBlue} />
          <View style={styles.freshwaterTitleWrap}>
            <Text style={styles.freshwaterTitle}>{freshwaterSystem?.label || "Freshwater System"}</Text>
            <Text style={styles.freshwaterMeta}>Source: Tiara 39 LS Owner's Manual MY2026</Text>
          </View>
        </View>

        <View style={styles.guidanceList}>
          {guidance.map((item) => (
            <View key={item.id} style={styles.guidanceItem}>
              <Text style={styles.guidanceTitle}>{item.label}</Text>
              <Text style={styles.guidanceBody}>{operationalBody(item)}</Text>
            </View>
          ))}
        </View>

        {playbooks.length ? (
          <View style={styles.playbookRow}>
            {playbooks.map((item) => (
              <View key={item.id} style={styles.playbookChip}>
                <Ionicons name="checkbox-outline" size={14} color={colors.brandNavy} />
                <Text style={styles.playbookChipText}>{item.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ActivatorExactBuildScreen({ navigation, route }) {
  const templateKey = route?.params?.templateKey || "tiara-2027-39-ls";
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [options, setOptions] = useState(DEMO_FACTORY_OPTIONS);
  const [finish, setFinish] = useState(FINISH_FIELDS);
  const [identity, setIdentity] = useState({
    hin: "SSUXA039L627",
    buildNumber: "LS-2027-014",
    buildDate: "2026-11-18",
    dealer: "SkipperBud's",
    location: "Lake Fenton Marina",
  });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await getCatalogTemplateDetail({ templateKey });
      setDetail(next);
    } catch (err) {
      console.error("Activator exact build failed:", err);
      setError(err?.message || "Could not open this build workspace.");
      setDetail(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const template = detail?.template || {};
  const resources = detail?.resources || [];
  const showcaseMedia = detail?.showcase_media || [];
  const heroMedia = mediaByRole(showcaseMedia, "hero");
  const templateItems = useMemo(() => groupTemplateItems(detail?.items || []), [detail?.items]);
  const standardItems = templateItems.filter((item) => item.applicability?.standard_state === "standard");
  const operationalTemplateItems = standardItems.filter((item) => ["system", "equipment", "resource"].includes(item.item_type));
  const freshwaterItems = standardItems.filter((item) => item.canonical_key?.startsWith("system.freshwater") || item.canonical_key?.startsWith("knowledge.freshwater") || item.canonical_key?.startsWith("playbook.freshwater"));
  const optionGroups = useMemo(() => groupedOptions(options), [options]);
  const selectedOptions = options.filter((option) => option.selected);
  const compiled = useMemo(() => {
    const baselineSystems = operationalTemplateItems
      .filter((item) => item.item_type === "system" || item.item_type === "equipment")
      .map((item) => item.label);
    const templatePlaybooks = standardItems
      .filter((item) => item.item_type === "playbook")
      .map((item) => item.label);
    return {
      systems: unique([...baselineSystems, ...selectedOptions.flatMap((option) => option.systems)]),
      resources: unique([...resources.map((resource) => resource.title), ...selectedOptions.flatMap((option) => option.resources)]),
      playbooks: unique([
        "Factory configuration review",
        "HIN and KAC verification",
        "OEM as-built evidence packet",
        ...templatePlaybooks,
        ...selectedOptions.flatMap((option) => option.playbooks),
      ]),
      requirements: unique([
        "HIN",
        "Build number",
        "Factory build date",
        "Destination dealer",
        ...selectedOptions.flatMap((option) => option.requirements),
      ]),
    };
  }, [operationalTemplateItems, resources, selectedOptions, standardItems]);

  const readyToFreeze = Boolean(identity.hin && identity.buildNumber && identity.buildDate && identity.dealer && selectedOptions.length);

  const toggleOption = (option) => {
    if (option.locked) return;
    setOptions((current) => current.map((item) => {
      if (option.mode === "single" && item.group === option.group) {
        return { ...item, selected: item.key === option.key };
      }
      if (item.key === option.key) return { ...item, selected: !item.selected };
      return item;
    }));
  };

  const updateIdentity = (key, value) => setIdentity((current) => ({ ...current, [key]: value }));
  const updateFinish = (key, value) => setFinish((current) => current.map((item) => item.key === key ? { ...item, value } : item));
  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
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
            { label: "Configure Hulls", route: "ActivatorHome", params: { initialMode: "builds" } },
          ]}
          current={`Build ${template.model || "39 LS"}`}
          right={(
            <View style={styles.breadcrumbKac}>
              <Ionicons name="key-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbKacText}>KAC-TIARA-39LS-BUILD-DEMO</Text>
            </View>
          )}
        />
        <ImageBackground source={mediaAsset(heroMedia)} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroBrandCard}>
              <Image source={TIARA_OEM_LOGO} resizeMode="contain" style={styles.heroLogo} />
              <View style={styles.heroBrandTextWrap}>
                <Text style={styles.heroBrandName}>Tiara Yachts</Text>
                <Text style={styles.heroBrandMeta}>Holland, Michigan · OEM factory build</Text>
              </View>
            </View>
            <Text style={styles.modelWatermark}>39 LS</Text>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Keepr Activator · OEM Build</Text>
              <Text style={styles.title}>Build a Tiara 39 LS</Text>
              <Text style={styles.subtitle}>
                Configure one exact hull from the published MY{template.model_year || "2027"} 39 LS template. Selections compile into the systems, manuals, playbooks, and verification requirements that will flow to dealer and owner.
              </Text>
              <View style={styles.heroBadges}>
                <View style={styles.heroBadge}>
                  <Ionicons name="layers-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>Template v{template.version || 1}</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="boat-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>Exact hull workspace</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="lock-open-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>OEM Build</Text>
                </View>
              </View>
            </View>
          </View>
        </ImageBackground>

        <LifecycleRail />

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Opening Tiara starter pack...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.accentRed} />
            <Text style={styles.emptyTitle}>Build workspace is not available</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.workspaceGrid}>
            <View style={styles.leftColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Starter Pack</Text>
                    <Text style={styles.panelTitle}>Factory configuration</Text>
                  </View>
                  <Text style={styles.panelCount}>{selectedOptions.length} selected</Text>
                </View>
                <Text style={styles.panelText}>
                  Standard model content is inherited. Factory choices and options add the operational context that will become the owner passport.
                </Text>
                {Object.entries(optionGroups).map(([group, groupOptions]) => (
                  <View key={group} style={styles.optionGroup}>
                    <Text style={styles.optionGroupTitle}>{group}</Text>
                    {groupOptions.map((option) => (
                      <ToggleRow key={option.key} option={option} onToggle={() => toggleOption(option)} />
                    ))}
                  </View>
                ))}
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Finish</Text>
                    <Text style={styles.panelTitle}>Factory selections</Text>
                  </View>
                </View>
                <View style={styles.fieldGrid}>
                  {finish.map((field) => (
                    <View key={field.key} style={styles.inputWrap}>
                      <Text style={styles.inputLabel}>{field.label}</Text>
                      <TextInput
                        value={field.value}
                        onChangeText={(value) => updateFinish(field.key, value)}
                        style={styles.input}
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  ))}
                </View>
              </View>

              <FreshwaterFlowdownPanel items={freshwaterItems} />

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Inherited Standards</Text>
                    <Text style={styles.panelTitle}>From published 39 LS template</Text>
                  </View>
                  <Text style={styles.panelCount}>{operationalTemplateItems.length}</Text>
                </View>
                <View style={styles.standardGrid}>
                  {operationalTemplateItems.slice(0, 12).map((item) => (
                    <View key={item.id} style={styles.standardCard}>
                      <Text style={styles.standardSection}>{item.sectionLabel}</Text>
                      <Text style={styles.standardTitle}>{item.label}</Text>
                      {valueText(item.expected_value) ? <Text style={styles.standardValue}>{valueText(item.expected_value)}</Text> : null}
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.rightColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Exact Hull Identity</Text>
                    <Text style={styles.panelTitle}>Freeze inputs</Text>
                  </View>
                  <View style={[styles.freezePill, readyToFreeze && styles.freezePillReady]}>
                    <Text style={[styles.freezePillText, readyToFreeze && styles.freezePillTextReady]}>
                      {readyToFreeze ? "Ready" : "Missing"}
                    </Text>
                  </View>
                </View>
                <View style={styles.identityFields}>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>HIN</Text>
                    <TextInput value={identity.hin} onChangeText={(value) => updateIdentity("hin", value)} style={styles.input} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Build number</Text>
                    <TextInput value={identity.buildNumber} onChangeText={(value) => updateIdentity("buildNumber", value)} style={styles.input} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Build date</Text>
                    <TextInput value={identity.buildDate} onChangeText={(value) => updateIdentity("buildDate", value)} style={styles.input} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Destination dealer</Text>
                    <TextInput value={identity.dealer} onChangeText={(value) => updateIdentity("dealer", value)} style={styles.input} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Dealer location</Text>
                    <TextInput value={identity.location} onChangeText={(value) => updateIdentity("location", value)} style={styles.input} />
                  </View>
                </View>
                <View style={styles.kacCard}>
                  <Text style={styles.kacLabel}>Keepr Code</Text>
                  <Text style={styles.kacValue}>KAC-TIARA-39LS-BUILD-DEMO</Text>
                </View>
                <View style={[styles.milestoneCard, readyToFreeze && styles.milestoneCardReady]}>
                  <Text style={styles.milestoneKicker}>Factory Configuration Ready</Text>
                  <Text style={styles.milestoneTitle}>OEM layer can be frozen for this HIN.</Text>
                  <View style={styles.milestoneStats}>
                    <Text style={styles.milestoneStat}>{compiled.systems.length} systems</Text>
                    <Text style={styles.milestoneStat}>{compiled.resources.length} resources</Text>
                    <Text style={styles.milestoneStat}>{compiled.playbooks.length} playbooks</Text>
                    <Text style={styles.milestoneStat}>{compiled.requirements.length} verification items</Text>
                  </View>
                  <View style={styles.milestoneChecks}>
                    <View style={styles.milestoneCheck}>
                      <Ionicons name={identity.hin ? "checkmark-circle" : "ellipse-outline"} size={15} color={identity.hin ? colors.accentGreen : colors.textMuted} />
                      <Text style={styles.milestoneCheckText}>HIN assigned</Text>
                    </View>
                    <View style={styles.milestoneCheck}>
                      <Ionicons name={identity.dealer ? "checkmark-circle" : "ellipse-outline"} size={15} color={identity.dealer ? colors.accentGreen : colors.textMuted} />
                      <Text style={styles.milestoneCheckText}>Dealer destination assigned</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity activeOpacity={0.86} style={[styles.freezeButton, !readyToFreeze && styles.freezeButtonDisabled]}>
                  <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.onPrimary} />
                  <Text style={styles.freezeButtonText}>Freeze & Hand Off</Text>
                </TouchableOpacity>
                <Text style={styles.stopNote}>
                  Review checkpoint: this action is intentionally not wired to Dealer Handoff yet.
                </Text>
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Compiled Ownership Context</Text>
                    <Text style={styles.panelTitle}>What flows down</Text>
                  </View>
                </View>
                <View style={styles.compileGrid}>
                  <CompileColumn title="Systems" icon="hardware-chip-outline" items={compiled.systems} empty="No systems compiled yet." />
                  <CompileColumn title="Resources" icon="document-text-outline" items={compiled.resources} empty="No resources compiled yet." />
                  <CompileColumn title="Playbooks" icon="checkbox-outline" items={compiled.playbooks} empty="No playbooks compiled yet." />
                  <CompileColumn title="Verification" icon="shield-checkmark-outline" items={compiled.requirements} empty="No requirements compiled yet." />
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
  breadcrumbKac: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  breadcrumbKacText: {
    color: colors.brandNavy,
    fontSize: 11,
    fontWeight: "900",
  },
  hero: {
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    minHeight: 310,
    overflow: "hidden",
    ...shadows.sm,
  },
  heroImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  heroOverlay: {
    backgroundColor: "rgba(5, 10, 24, 0.34)",
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 310,
    padding: spacing.xl,
  },
  heroBrandCard: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: "rgba(255,255,255,0.42)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    left: spacing.xl,
    maxWidth: 390,
    minHeight: 76,
    paddingHorizontal: spacing.md,
    position: "absolute",
    top: spacing.xl,
  },
  heroLogo: {
    backgroundColor: "#050505",
    borderRadius: radius.sm,
    height: 54,
    width: 54,
  },
  heroBrandTextWrap: {
    flex: 1,
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
    fontWeight: "700",
    marginTop: 3,
  },
  modelWatermark: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 0,
    position: "absolute",
    right: spacing.xl,
    textAlign: "right",
    textTransform: "uppercase",
    top: spacing.xl,
  },
  heroCopy: {
    maxWidth: 820,
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
    lineHeight: 23,
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
  lifecycleRail: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  lifecycleStep: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 28,
  },
  lifecycleDot: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  lifecycleDotComplete: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  lifecycleDotActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  lifecycleText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  lifecycleTextActive: {
    color: colors.textPrimary,
  },
  workspaceGrid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  leftColumn: {
    flex: 1.35,
    gap: spacing.lg,
    minWidth: 360,
  },
  rightColumn: {
    flex: 1,
    gap: spacing.lg,
    minWidth: 330,
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
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
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
  panelCount: {
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
  optionGroup: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  optionGroupTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  optionRow: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  optionRowSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  optionRowLocked: {
    opacity: 0.9,
  },
  optionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  optionTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  optionState: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  optionStateSelected: {
    color: colors.brandBlue,
  },
  optionMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  addsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  addChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  addChipSelected: {
    backgroundColor: colors.surface,
    borderColor: "#BFDBFE",
  },
  addChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  addChipTextSelected: {
    color: colors.textPrimary,
  },
  lockedText: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  fieldGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  inputWrap: {
    flexGrow: 1,
    minWidth: 170,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 42,
    outlineStyle: "none",
    paddingHorizontal: spacing.md,
  },
  standardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  standardCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 92,
    minWidth: 190,
    padding: spacing.md,
    width: "30%",
  },
  standardSection: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  standardTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  standardValue: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  identityFields: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  freezePill: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  freezePillReady: {
    backgroundColor: "#ECFDF5",
  },
  freezePillText: {
    color: colors.accentRed,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  freezePillTextReady: {
    color: colors.accentGreen,
  },
  kacCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  kacLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  kacValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  milestoneCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  milestoneCardReady: {
    backgroundColor: "#F8FAFC",
    borderColor: "#BFDBFE",
  },
  milestoneKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  milestoneTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  milestoneStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  milestoneStat: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  milestoneChecks: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  milestoneCheck: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  milestoneCheckText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  freezeButton: {
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
  freezeButtonDisabled: {
    opacity: 0.52,
  },
  freezeButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  inheritedPill: {
    backgroundColor: "#DCFCE7",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inheritedPillText: {
    color: "#166534",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  freshwaterCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  freshwaterHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  freshwaterTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  freshwaterTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  freshwaterMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  guidanceList: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  guidanceItem: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  guidanceTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  guidanceBody: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  playbookRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  playbookChip: {
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
  playbookChipText: {
    color: colors.brandNavy,
    fontSize: 11,
    fontWeight: "900",
  },
  stopNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  compileGrid: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  compileColumn: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  compileHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  compileTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  compileCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  compileItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compileText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  compileEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
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
    maxWidth: 720,
    textAlign: "center",
  },
});
