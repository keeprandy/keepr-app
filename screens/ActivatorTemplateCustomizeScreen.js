import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  getCatalogTemplateDetail,
  retireCatalogTemplateItem,
  upsertCatalogTemplateItem,
} from "../lib/activatorApi";
import { projectModelTemplateDetail } from "../lib/modelTemplateProjection";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const CONFIG_SECTION_KEY = "section.configuration";
const SPEC_SECTION_KEY = "section.specifications";
const PRIME_FACTS = [
  { key: "spec.loa", label: "LOA", placeholder: "43'6\"", unitPlaceholder: "ft" },
  { key: "spec.beam", label: "Beam", placeholder: "13'0\"", unitPlaceholder: "ft" },
  { key: "spec.max_horsepower", label: "Max HP", placeholder: "1,200", unitPlaceholder: "HP" },
  { key: "spec.fuel_capacity", label: "Fuel", placeholder: "400", unitPlaceholder: "gal" },
  { key: "spec.water_capacity", label: "Water", placeholder: "60", unitPlaceholder: "gal" },
];
const ITEM_KINDS = ["configuration_item", "choice", "option", "component", "system"];
const ITEM_STATES = ["standard", "optional", "selected", "unselected", "model_expected"];
const MAPPING_STATES = ["unmapped", "partially_mapped", "mapped", "needs_review"];
const SELECTION_MODES = ["single", "multi"];
const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "standard", label: "Standard" },
  { key: "choice", label: "Choices" },
  { key: "option", label: "Options" },
  { key: "component", label: "Components" },
  { key: "system", label: "Systems" },
  { key: "unmapped", label: "Unmapped" },
];
const TYPE_LABELS = {
  section: "Section",
  configuration_group: "Group",
  configuration_item: "Item",
  choice: "Choice",
  option: "Option",
  component: "Component",
  system: "System",
};

function itemTypeLabel(item) {
  return TYPE_LABELS[item?.item_type] || String(item?.item_type || "item").replace(/_/g, " ");
}

function itemStateValue(item) {
  return item?.expected_value?.selection_state || item?.applicability?.standard_state || "model_expected";
}

function itemMappingValue(item) {
  return item?.applicability?.mapping_status || item?.metadata?.mapping_status || "unmapped";
}

function humanizeMeta(value) {
  return String(value || "").replace(/_/g, " ");
}

function matchesTypeFilter(item, filterKey) {
  if (!item) return false;
  if (filterKey === "all") return true;
  if (filterKey === "standard") return itemStateValue(item) === "standard";
  if (filterKey === "unmapped") return itemMappingValue(item) === "unmapped";
  return item.item_type === filterKey;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function jsonText(value, fallback = "{}") {
  try {
    return JSON.stringify(value && Object.keys(value).length ? value : JSON.parse(fallback), null, 2);
  } catch {
    return fallback;
  }
}

function jsonTextOrEmpty(value) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  return jsonText(value, "{}");
}

function valueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && Object.keys(value).length === 0) return "";
  if (value.value !== undefined) return [value.value, value.unit].filter(Boolean).join(" · ");
  return JSON.stringify(value);
}

function splitExpectedValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: value ? String(value) : "", unit: "", metric: "" };
  }
  return {
    value: value.value !== undefined ? String(value.value) : "",
    unit: value.unit !== undefined ? String(value.unit) : "",
    metric: value.metric !== undefined ? String(value.metric) : "",
  };
}

function parseJsonField(text, fieldName) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function linesToArray(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function itemElementList(item, key) {
  const metadata = item?.metadata || {};
  const expected = item?.expected_value?.value || {};
  const downstream = metadata.downstream_elements || {};
  return metadata[key] || downstream[key] || expected[key] || [];
}

function activeItems(items) {
  return (items || []).filter((item) => item?.applicability?.active !== false);
}

function BadgeButton({ label, active, onPress }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.badgeButton, active && styles.badgeButtonActive]}
    >
      <Text style={[styles.badgeButtonText, active && styles.badgeButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline = false }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A8B1C1"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

function PrimeFactTile({ definition, item, selected, onPress }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.factTile, selected && styles.factTileSelected]}
    >
      <Text style={styles.factValue} numberOfLines={1}>
        {valueText(item?.expected_value) || "Not set"}
      </Text>
      <Text style={styles.factLabel}>{definition.label}</Text>
      <Text style={styles.factSource} numberOfLines={1}>
        {item?.source_resource_id ? "Source-backed" : "Needs source"}
      </Text>
    </TouchableOpacity>
  );
}

function TemplateItemRow({
  item,
  childrenCount,
  selected,
  indented = false,
  expanded = true,
  onPress,
  onRetire,
  onToggleExpand = null,
}) {
  const mappingStatus = itemMappingValue(item);
  const state = itemStateValue(item);
  const sourceCode = item?.metadata?.oem_item_code || item?.metadata?.source_oem_code;
  const isGroup = item.item_type === "configuration_group";
  return (
    <View style={[indented && styles.indentedRowWrap]}>
      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.86}
        onPress={onPress}
        style={[styles.itemRow, indented && styles.itemRowIndented, selected && styles.itemRowSelected]}
      >
        {isGroup && onToggleExpand ? (
          <TouchableOpacity
            accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
            activeOpacity={0.82}
            onPress={onToggleExpand}
            style={styles.expandButton}
          >
            <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.itemIcon}>
          <Ionicons
            name={isGroup ? (expanded ? "folder-open-outline" : "folder-outline") : "list-outline"}
            size={17}
            color={colors.brandBlue}
          />
        </View>
        <View style={styles.itemText}>
          <Text style={styles.itemTitle}>{item.label}</Text>
          <View style={styles.metaBadgeRow}>
            <View style={[styles.typeBadge, isGroup && styles.typeBadgeGroup]}>
              <Text style={[styles.typeBadgeText, isGroup && styles.typeBadgeTextGroup]}>
                {itemTypeLabel(item)}
              </Text>
            </View>
            <View style={styles.stateBadge}>
              <Text style={styles.stateBadgeText}>{humanizeMeta(state)}</Text>
            </View>
            <View style={[styles.mappingBadge, mappingStatus === "mapped" && styles.mappingBadgeMapped]}>
              <Text style={[styles.mappingBadgeText, mappingStatus === "mapped" && styles.mappingBadgeTextMapped]}>
                {humanizeMeta(mappingStatus)}
              </Text>
            </View>
          </View>
          {sourceCode ? <Text style={styles.itemMeta}>{sourceCode}</Text> : null}
          {childrenCount ? <Text style={styles.itemSubtle}>{childrenCount} child items</Text> : null}
        </View>
        <TouchableOpacity
          accessibilityLabel={`Retire ${item.label}`}
          activeOpacity={0.86}
          onPress={onRetire}
          style={styles.iconButton}
        >
          <Ionicons name="archive-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

export default function ActivatorTemplateCustomizeScreen({ navigation, route }) {
  const templateKey = route?.params?.templateKey || null;
  const organizationId = route?.params?.organizationId || null;
  const workspaceId = route?.params?.workspaceId || null;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupLabel, setGroupLabel] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [itemLabel, setItemLabel] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemKind, setItemKind] = useState("configuration_item");
  const [itemState, setItemState] = useState("standard");
  const [mappingStatus, setMappingStatus] = useState("unmapped");
  const [quantity, setQuantity] = useState("1");
  const [valueText, setValueText] = useState("{}");
  const [provenanceNote, setProvenanceNote] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const [selectionMode, setSelectionMode] = useState("multi");
  const [systemsText, setSystemsText] = useState("");
  const [resourcesText, setResourcesText] = useState("");
  const [playbooksText, setPlaybooksText] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [editingFactKey, setEditingFactKey] = useState(route?.params?.focusCanonicalKey || PRIME_FACTS[0].key);
  const [factValue, setFactValue] = useState("");
  const [factUnit, setFactUnit] = useState("");
  const [factMetric, setFactMetric] = useState("");
  const [factSourceResourceId, setFactSourceResourceId] = useState(null);
  const [factProvenanceNote, setFactProvenanceNote] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!templateKey) {
      setError("Open this workbench from a model template.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await getCatalogTemplateDetail({ templateKey });
      setDetail(next);
      const projected = projectModelTemplateDetail(next);
      const groups = projected.configuration.groups.map(({ group }) => group);
      setSelectedGroupId((current) => current || groups[0]?.id || null);
    } catch (err) {
      console.error("Template configuration workbench failed:", err);
      setError(err?.message || "Could not open this model template.");
      setDetail(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const modelProjection = useMemo(() => projectModelTemplateDetail(detail), [detail]);
  const template = modelProjection.template || {};
  const resources = modelProjection.resources || [];
  const items = modelProjection.items || [];
  const configurationSection = items.find((item) => item.canonical_key === CONFIG_SECTION_KEY);
  const configurationGroups = modelProjection.configuration.groups || [];
  const groups = configurationGroups.map(({ group }) => group);
  const specItems = PRIME_FACTS.map((definition) => ({
    definition,
    item: items.find((item) => item.canonical_key === definition.key) || null,
  }));
  const editingFactDefinition = PRIME_FACTS.find((definition) => definition.key === editingFactKey) || PRIME_FACTS[0];
  const editingFactItem = items.find((item) => item.canonical_key === editingFactDefinition.key) || null;
  const childrenByParent = useMemo(() => {
    return items.reduce((acc, item) => {
      if (!item.parent_item_id) return acc;
      acc[item.parent_item_id] = acc[item.parent_item_id] || [];
      acc[item.parent_item_id].push(item);
      return acc;
    }, {});
  }, [items]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0] || null;
  const collapsedGroupSet = useMemo(() => new Set(collapsedGroupIds), [collapsedGroupIds]);
  const filterCounts = useMemo(() => {
    const nonGroupItems = configurationGroups.flatMap(({ children }) => children);
    return TYPE_FILTERS.reduce((acc, filter) => {
      acc[filter.key] = filter.key === "all"
        ? nonGroupItems.length
        : nonGroupItems.filter((item) => matchesTypeFilter(item, filter.key)).length;
      return acc;
    }, {});
  }, [configurationGroups]);
  const visibleGroups = useMemo(() => {
    if (typeFilter === "all") {
      return configurationGroups;
    }
    return configurationGroups
      .map(({ group, children }) => ({
        group,
        children: children.filter((child) => matchesTypeFilter(child, typeFilter)),
      }))
      .filter(({ group, children }) => matchesTypeFilter(group, typeFilter) || children.length);
  }, [configurationGroups, typeFilter]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const resetGroupForm = () => {
    setEditingGroup(null);
    setGroupLabel("");
    setGroupCode("");
  };

  const editFact = (definition) => {
    const item = items.find((candidate) => candidate.canonical_key === definition.key) || null;
    const parsed = splitExpectedValue(item?.expected_value);
    setEditingFactKey(definition.key);
    setFactValue(parsed.value);
    setFactUnit(parsed.unit);
    setFactMetric(parsed.metric);
    setFactSourceResourceId(item?.source_resource_id || resources[0]?.id || null);
    setFactProvenanceNote(item?.metadata?.provenance_note || item?.metadata?.source_note || "");
  };

  useEffect(() => {
    if (!detail || !editingFactKey) return;
    const definition = PRIME_FACTS.find((candidate) => candidate.key === editingFactKey);
    if (definition) editFact(definition);
  }, [detail, editingFactKey]);

  const toggleGroupCollapsed = (groupId) => {
    setCollapsedGroupIds((current) => (
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    ));
  };

  const resetItemForm = () => {
    setEditingItem(null);
    setItemLabel("");
    setItemCode("");
    setItemDescription("");
    setItemKind("configuration_item");
    setItemState("standard");
    setMappingStatus("unmapped");
    setQuantity("1");
    setValueText("");
    setProvenanceNote("");
    setSelectedResourceId(null);
    setSelectionMode("multi");
    setSystemsText("");
    setResourcesText("");
    setPlaybooksText("");
    setRequirementsText("");
  };

  const editItem = (item) => {
    setEditingItem(item);
    setSelectedGroupId(item.parent_item_id || selectedGroupId);
    setItemLabel(item.label || "");
    setItemCode(item.metadata?.oem_item_code || item.metadata?.source_oem_code || "");
    setItemDescription(item.metadata?.oem_description || item.metadata?.description || item.expected_value?.description || "");
    setItemKind(item.item_type || "configuration_item");
    setItemState(item.expected_value?.selection_state || item.applicability?.standard_state || "standard");
    setMappingStatus(item.applicability?.mapping_status || item.metadata?.mapping_status || "unmapped");
    setQuantity(String(item.expected_value?.quantity ?? ""));
    setValueText(jsonTextOrEmpty(item.expected_value?.value));
    setProvenanceNote(item.metadata?.provenance_note || item.metadata?.evidence || "");
    setSelectedResourceId(item.source_resource_id || null);
    setSelectionMode(item.metadata?.selection_mode || (item.item_type === "choice" ? "single" : "multi"));
    setSystemsText(arrayToLines(itemElementList(item, "systems")));
    setResourcesText(arrayToLines(itemElementList(item, "resources")));
    setPlaybooksText(arrayToLines(itemElementList(item, "playbooks")));
    setRequirementsText(arrayToLines(itemElementList(item, "requirements")));
  };

  const editGroup = (group) => {
    setEditingGroup(group);
    setEditingItem(null);
    setSelectedGroupId(group.id);
    setGroupLabel(group.label || "");
    setGroupCode(group.metadata?.oem_group_code || group.expected_value?.oem_group_code || "");
  };

  const ensureConfigurationSection = async () => {
    if (configurationSection?.id) return configurationSection;
    const result = await upsertCatalogTemplateItem({
      templateId: template.id,
      itemType: "section",
      canonicalKey: CONFIG_SECTION_KEY,
      label: "Configuration",
      expectedValue: {},
      applicability: { standard_state: "model_expected" },
      metadata: {
        source: "template_configuration_workbench",
        purpose: "source_backed_oem_configuration",
      },
      sortOrder: 30,
    });
    return result?.item;
  };

  const ensureSpecSection = async () => {
    const existing = items.find((item) => item.canonical_key === SPEC_SECTION_KEY || item.canonical_key === "brochure.specifications");
    if (existing?.id) return existing;
    const result = await upsertCatalogTemplateItem({
      templateId: template.id,
      itemType: "section",
      canonicalKey: SPEC_SECTION_KEY,
      label: "Specifications",
      expectedValue: {},
      applicability: { standard_state: "model_expected" },
      metadata: {
        source: "template_configuration_workbench",
        purpose: "model_prime_facts",
      },
      sortOrder: 10,
    });
    return result?.item;
  };

  const saveFact = async () => {
    if (!template?.id || !editingFactDefinition) return;
    const value = factValue.trim();
    if (!value) {
      Alert.alert("Value required", `Enter a value for ${editingFactDefinition.label} before saving.`);
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const section = await ensureSpecSection();
      const expectedValue = {
        value,
        unit: factUnit.trim() || null,
        metric: factMetric.trim() || null,
      };
      await upsertCatalogTemplateItem({
        templateId: template.id,
        itemType: "spec",
        canonicalKey: editingFactDefinition.key,
        label: editingFactDefinition.label,
        parentItemId: section?.id || null,
        expectedValue,
        applicability: {
          standard_state: "standard",
          source_backed: !!factSourceResourceId,
        },
        sourceResourceId: factSourceResourceId,
        metadata: {
          source: "template_configuration_workbench",
          provenance_note: factProvenanceNote.trim() || null,
          display_priority: "prime",
          editable_as: "model_fact",
        },
        sortOrder: 11 + PRIME_FACTS.findIndex((definition) => definition.key === editingFactDefinition.key),
      });
      await load({ quiet: true });
      setNotice(`${editingFactDefinition.label} saved to this model template.`);
    } catch (err) {
      setNotice({ type: "error", message: err?.message || "The model fact could not be saved." });
      Alert.alert("Could not save fact", err?.message || "The model fact could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    if (!template?.id) return;
    const label = groupLabel.trim();
    if (!label) {
      Alert.alert("Group label required", "Enter an OEM group label before saving.");
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const section = await ensureConfigurationSection();
      const groupKey = editingGroup?.canonical_key || (groupCode.trim()
        ? `configuration_group.${slugify(groupCode)}`
        : `configuration_group.${slugify(label)}`);
      const result = await upsertCatalogTemplateItem({
        templateId: template.id,
        itemType: "configuration_group",
        canonicalKey: groupKey,
        label,
        parentItemId: section?.id || null,
        expectedValue: {
          oem_group_name: label,
          oem_group_code: groupCode.trim() || null,
        },
        applicability: { standard_state: "model_expected" },
        metadata: {
          source: "template_configuration_workbench",
          oem_group_name: label,
          oem_group_code: groupCode.trim() || null,
          oem_vocabulary_preserved: true,
        },
        sortOrder: editingGroup?.sort_order || 31 + groups.length,
      });
      resetGroupForm();
      setShowGroupModal(false);
      await load({ quiet: true });
      setSelectedGroupId(result?.item?.id || selectedGroupId);
      setNotice(`${label} saved to this model template.`);
    } catch (err) {
      setNotice({ type: "error", message: err?.message || "The configuration group could not be saved." });
      Alert.alert("Could not save group", err?.message || "The configuration group could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async () => {
    if (!template?.id) return;
    const label = itemLabel.trim();
    if (!label) {
      Alert.alert("Item label required", "Enter an OEM item label before saving.");
      return;
    }
    const parent = groups.find((group) => group.id === selectedGroupId) || selectedGroup;
    if (!parent?.id) {
      Alert.alert("Configuration group required", "Create or select a configuration group first.");
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const parsedValue = parseJsonField(valueText, "Value");
      const itemKey = editingItem?.canonical_key || `${parent.canonical_key}.${slugify(itemCode || label)}`;
      const downstreamElements = {
        systems: linesToArray(systemsText),
        resources: linesToArray(resourcesText),
        playbooks: linesToArray(playbooksText),
        requirements: linesToArray(requirementsText),
      };
      const result = await upsertCatalogTemplateItem({
        templateId: template.id,
        itemType: itemKind,
        canonicalKey: itemKey,
        label,
        parentItemId: parent.id,
        expectedValue: {
          description: itemDescription.trim() || null,
          value: parsedValue,
          quantity: quantity.trim() || null,
          selection_state: itemState,
          source_oem_code: itemCode.trim() || null,
        },
        applicability: {
          standard_state: itemState,
          mapping_status: mappingStatus,
        },
        sourceResourceId: selectedResourceId,
        metadata: {
          source: "template_configuration_workbench",
          oem_group_name: parent.metadata?.oem_group_name || parent.label,
          oem_item_name: label,
          oem_item_code: itemCode.trim() || null,
          oem_description: itemDescription.trim() || null,
          description: itemDescription.trim() || null,
          source_oem_code: itemCode.trim() || null,
          selection_mode: selectionMode,
          systems: downstreamElements.systems,
          resources: downstreamElements.resources,
          playbooks: downstreamElements.playbooks,
          requirements: downstreamElements.requirements,
          downstream_elements: downstreamElements,
          mapping_status: mappingStatus,
          provenance_note: provenanceNote.trim() || null,
          can_remain_unmapped: true,
          oem_vocabulary_preserved: true,
        },
        sortOrder: editingItem?.sort_order || 40 + (childrenByParent[parent.id]?.length || 0),
      });
      await load({ quiet: true });
      if (result?.item) {
        setEditingItem(result.item);
        setSelectedGroupId(result.item.parent_item_id || parent.id);
      }
      setShowItemModal(false);
      setNotice(`${label} saved under ${parent.label}.`);
    } catch (err) {
      setNotice({ type: "error", message: err?.message || "The configuration item could not be saved." });
      Alert.alert("Could not save item", err?.message || "The configuration item could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const retireItem = async (item) => {
    Alert.alert("Retire item?", `${item.label} will be hidden from the active configuration workbench.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Retire",
        style: "destructive",
        onPress: async () => {
          setSaving(true);
          try {
            await retireCatalogTemplateItem(item.id);
            if (editingItem?.id === item.id) resetItemForm();
            if (editingGroup?.id === item.id) resetGroupForm();
            await load({ quiet: true });
            setNotice(`${item.label} retired from the active configuration.`);
          } catch (err) {
            setNotice({ type: "error", message: err?.message || "The item could not be retired." });
            Alert.alert("Could not retire item", err?.message || "The item could not be retired.");
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
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
            {
              label: `${template.model || "Model"} Template`,
              route: "ActivatorCatalogTemplate",
              params: {
                templateKey,
                organizationId,
                workspaceId,
              },
            },
          ]}
          current="Configure"
        />

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Template Configuration</Text>
          <Text style={styles.title}>
            {template.manufacturer || "OEM"} {template.model || "model"} workbench
          </Text>
          <Text style={styles.subtitle}>
            Author Level-1 OEM groups and items as reusable model configuration. OEM labels, codes, source references, and provenance stay preserved as data.
          </Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{groups.length}</Text>
              <Text style={styles.summaryLabel}>Groups</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>
                {groups.reduce((sum, group) => sum + (childrenByParent[group.id]?.length || 0), 0)}
              </Text>
              <Text style={styles.summaryLabel}>Items</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{resources.length}</Text>
              <Text style={styles.summaryLabel}>Sources</Text>
            </View>
          </View>
        </View>

        {!loading && !error ? (
          <View style={styles.primeFactsPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.kicker}>Prime Model Facts</Text>
                <Text style={styles.panelTitle}>Specs shown on the catalog page</Text>
              </View>
              <Text style={styles.countText}>{specItems.filter(({ item }) => item).length} set</Text>
            </View>
            <View style={styles.factRow}>
              {specItems.map(({ definition, item }) => (
                <PrimeFactTile
                  key={definition.key}
                  definition={definition}
                  item={item}
                  selected={editingFactKey === definition.key}
                  onPress={() => {
                    if (item?.id) {
                      navigation.navigate("ActivatorTemplateItemEditor", {
                        templateKey,
                        itemId: item.id,
                        organizationId,
                        workspaceId,
                      });
                    } else {
                      editFact(definition);
                    }
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {notice ? (
          <View style={[styles.notice, notice?.type === "error" && styles.noticeError]}>
            <Ionicons
              name={notice?.type === "error" ? "alert-circle-outline" : "checkmark-circle-outline"}
              size={18}
              color={notice?.type === "error" ? colors.accentRed : colors.accentGreen}
            />
            <Text style={styles.noticeText}>{typeof notice === "string" ? notice : notice.message}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Opening template configuration...</Text>
          </View>
        ) : error && !detail ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.accentRed} />
            <Text style={styles.emptyTitle}>Template configuration is not available</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            <View style={styles.leftColumn}>
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Level-1 Groups</Text>
                    <Text style={styles.panelTitle}>OEM configuration</Text>
                  </View>
                  <View style={styles.headerActions}>
                    <Text style={styles.countText}>{typeFilter === "all" ? groups.length : visibleGroups.length}</Text>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      onPress={() => {
                        resetGroupForm();
                        setShowGroupModal(true);
                      }}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Add Group</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      onPress={() => {
                        resetItemForm();
                        setSelectedGroupId(selectedGroup?.id || groups[0]?.id || null);
                        setShowItemModal(true);
                      }}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Add Item</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.filterRow}>
                  {TYPE_FILTERS.map((filter) => (
                    <BadgeButton
                      key={filter.key}
                      label={`${filter.label} ${filterCounts[filter.key] || 0}`}
                      active={typeFilter === filter.key}
                      onPress={() => setTypeFilter(filter.key)}
                    />
                  ))}
                </View>
                <View style={styles.list}>
                  {visibleGroups.length ? visibleGroups.map(({ group, children }) => (
                    <View key={group.id} style={styles.groupBlock}>
                      <TemplateItemRow
                        item={group}
                        childrenCount={typeFilter === "all" ? children.length : children.length}
                        selected={selectedGroup?.id === group.id && !editingItem}
                        expanded={!collapsedGroupSet.has(group.id)}
                        onPress={() => {
                          navigation.navigate("ActivatorTemplateItemEditor", {
                            templateKey,
                            itemId: group.id,
                            organizationId,
                            workspaceId,
                          });
                        }}
                        onToggleExpand={() => toggleGroupCollapsed(group.id)}
                        onRetire={() => retireItem(group)}
                      />
                      {!collapsedGroupSet.has(group.id) ? (
                        <View style={styles.childList}>
                          {children.map((child) => (
                            <TemplateItemRow
                              key={child.id}
                              item={child}
                              indented
                              selected={editingItem?.id === child.id}
                              onPress={() => {
                                navigation.navigate("ActivatorTemplateItemEditor", {
                                  templateKey,
                                  itemId: child.id,
                                  organizationId,
                                  workspaceId,
                                });
                              }}
                              onRetire={() => retireItem(child)}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )) : (
                    <Text style={styles.panelText}>
                      {groups.length
                        ? "No items match this filter yet."
                        : "No configuration groups yet. Add the first group, save, and reopen this model to prove persistence."}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        <Modal visible={showGroupModal} transparent animationType="fade" onRequestClose={() => setShowGroupModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.kicker}>Add Group</Text>
                  <Text style={styles.panelTitle}>OEM group label</Text>
                </View>
                <TouchableOpacity accessibilityLabel="Close" onPress={() => setShowGroupModal(false)} style={styles.iconButton}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.modalBodyContent}>
                <Field label="OEM group label" value={groupLabel} onChangeText={setGroupLabel} placeholder="Propulsion" />
                <Field label="OEM group/source code" value={groupCode} onChangeText={setGroupCode} placeholder="Optional code" />
              </View>
              <View style={styles.modalFooter}>
                <TouchableOpacity disabled={saving} activeOpacity={0.86} style={styles.primaryButton} onPress={saveGroup}>
                  {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="save-outline" size={16} color={colors.onPrimary} />}
                  <Text style={styles.primaryButtonText}>Save Group</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showItemModal} transparent animationType="fade" onRequestClose={() => setShowItemModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.kicker}>Add Item</Text>
                  <Text style={styles.panelTitle}>{selectedGroup?.label || "Select a group first"}</Text>
                </View>
                <TouchableOpacity accessibilityLabel="Close" onPress={() => setShowItemModal(false)} style={styles.iconButton}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                <Text style={styles.fieldLabel}>Parent group</Text>
                <View style={styles.buttonWrap}>
                  {groups.map((group) => (
                    <BadgeButton key={group.id} label={group.label} active={selectedGroupId === group.id} onPress={() => setSelectedGroupId(group.id)} />
                  ))}
                </View>
                <Field label="OEM item label" value={itemLabel} onChangeText={setItemLabel} placeholder="Mercury Verado V12 600" />
                <Field label="OEM/source code" value={itemCode} onChangeText={setItemCode} placeholder="Factory or source code" />
                <Text style={styles.fieldLabel}>Item kind</Text>
                <View style={styles.buttonWrap}>
                  {ITEM_KINDS.map((kind) => (
                    <BadgeButton key={kind} label={kind.replace(/_/g, " ")} active={itemKind === kind} onPress={() => setItemKind(kind)} />
                  ))}
                </View>
                <Text style={styles.fieldLabel}>State</Text>
                <View style={styles.buttonWrap}>
                  {ITEM_STATES.map((state) => (
                    <BadgeButton key={state} label={state.replace(/_/g, " ")} active={itemState === state} onPress={() => setItemState(state)} />
                  ))}
                </View>
              </ScrollView>
              <View style={styles.modalFooter}>
                <TouchableOpacity disabled={saving} activeOpacity={0.86} style={styles.primaryButton} onPress={saveItem}>
                  {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="save-outline" size={16} color={colors.onPrimary} />}
                  <Text style={styles.primaryButtonText}>Save Item</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: {
    color: colors.onPrimary,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 860,
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
    minWidth: 130,
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
  notice: {
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderColor: "#BBF7D0",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  noticeText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
  },
  grid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  leftColumn: {
    flex: 1,
    minWidth: 360,
  },
  rightColumn: {
    gap: spacing.lg,
    minWidth: 360,
    width: "38%",
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
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
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: "900",
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  panelText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  primeFactsPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  factRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  factTile: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 86,
    minWidth: 150,
    padding: spacing.md,
  },
  factTileSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: colors.brandBlue,
  },
  factValue: {
    color: colors.textPrimary,
    fontSize: 23,
    fontWeight: "900",
  },
  factLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 4,
    textTransform: "uppercase",
  },
  factSource: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
  },
  elementsPanel: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  filterRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  groupBlock: {
    gap: spacing.xs,
  },
  childList: {
    borderLeftColor: "#BFDBFE",
    borderLeftWidth: 2,
    gap: spacing.xs,
    marginLeft: 18,
    paddingLeft: spacing.sm,
  },
  indentedRowWrap: {
    marginTop: spacing.xs,
  },
  itemRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
  },
  itemRowIndented: {
    backgroundColor: colors.surface,
    minHeight: 58,
  },
  itemRowSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: colors.brandBlue,
  },
  expandButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 30,
    justifyContent: "center",
    width: 24,
  },
  itemIcon: {
    alignItems: "center",
    backgroundColor: "#EAF2FF",
    borderRadius: radius.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  itemMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  itemSubtle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  metaBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: 5,
  },
  typeBadge: {
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  typeBadgeGroup: {
    backgroundColor: "#EAF2FF",
    borderColor: "#BFDBFE",
  },
  typeBadgeText: {
    color: "#3730A3",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  typeBadgeTextGroup: {
    color: colors.brandBlue,
  },
  stateBadge: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  stateBadgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  mappingBadge: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mappingBadgeMapped: {
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
  },
  mappingBadgeText: {
    color: "#92400E",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  mappingBadgeTextMapped: {
    color: "#166534",
  },
  iconButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  textarea: {
    minHeight: 96,
    paddingTop: spacing.sm,
  },
  buttonWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  badgeButton: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  badgeButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  badgeButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  badgeButtonTextActive: {
    color: colors.onPrimary,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  headerSaveButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  headerSaveButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: spacing.lg,
    position: "absolute",
    right: 0,
    top: 0,
  },
  modalPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: "86%",
    maxWidth: 560,
    padding: spacing.lg,
    width: "100%",
    ...shadows.lg,
  },
  modalBody: {
    maxHeight: 420,
  },
  modalBodyContent: {
    gap: spacing.md,
  },
  modalFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
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
  emptyPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  mutedText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
