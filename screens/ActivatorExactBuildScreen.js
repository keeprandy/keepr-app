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
  getExactBuildDraft,
  getCatalogTemplateDetail,
  getTiaraFactoryBuildWorkspace,
  publishExactBuildDraft,
  upsertExactBuildDraft,
} from "../lib/activatorApi";
import { getSignedUrl, listAttachmentsForTarget } from "../lib/attachmentsApi";
import { getKeeprSpaceOrgConfig } from "../lib/keeprspaceApi";
import {
  TIARA_56_LS_TEMPLATE_KEY,
  TIARA_SYSTEM_CATEGORIES,
  getDefaultTiaraExactFactoryBuildForTemplate,
  getTiaraExactFactoryBuild,
  tiara56LsCatalogTemplate,
  tiaraKf018FactoryBuild,
} from "../data/tiaraKf018FactoryBuild";
import { projectModelTemplateDetail } from "../lib/modelTemplateProjection";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const BOAT_HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");

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
  { key: "hull_color", label: "Exterior color", value: "Pearl White" },
  { key: "bootline", label: "Bootline", value: "Crystal Blue" },
  { key: "upholstery", label: "Upholstery", value: "Cool Touch Natural" },
  { key: "interior_package", label: "Interior package", value: "Modern teak" },
];

const EXACT_SYSTEM_GROUPS = [
  "Propulsion",
  "Steering",
  "Helm & Electronics",
  "Audio",
  "Electrical",
  "Deck Equipment",
  "Interior",
  "Other Systems",
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

function templateHeroPlacementId(template = {}) {
  const metadata = template?.metadata && typeof template.metadata === "object" ? template.metadata : {};
  return (
    metadata.presentation?.hero_placement_id ||
    metadata.presentation?.heroPlacementId ||
    metadata.model_media?.hero_placement_id ||
    metadata.hero_placement_id ||
    null
  );
}

function mediaAsset(media) {
  const localAsset = SHOWCASE_ASSETS[media?.local_asset_key] || SHOWCASE_ASSETS[media?.metadata?.local_asset_key];
  if (localAsset) return localAsset;

  const uri =
    media?.attachment_signed_url ||
    media?.attachment_storage_signed_url ||
    media?.signed_url ||
    media?.attachment_url ||
    media?.url ||
    media?.public_url ||
    media?.publicUrl ||
    media?.uri ||
    media?.metadata?.attachment_signed_url ||
    media?.metadata?.attachment_storage_signed_url ||
    media?.metadata?.attachment_url ||
    media?.metadata?.url ||
    media?.metadata?.uri ||
    null;

  if (uri && !String(uri).startsWith("app://")) return { uri };
  return BOAT_HERO;
}

function mediaByRole(media = [], role) {
  if (role === "hero") return media.find((item) => item.is_hero || item.role === role || item.metadata?.role === role);
  if (role === "showcase") return media.find((item) => item.is_showcase || item.role === role || item.metadata?.role === role);
  return media.find((item) => item.role === role || item.metadata?.role === role);
}

function imageSourceFromUri(uri, fallback = null) {
  const clean = typeof uri === "string" ? uri.trim() : "";
  if (clean) return { uri: clean };
  return fallback;
}

function initialsForName(name) {
  return String(name || "OEM")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "OEM";
}

function orgBrandContextFromConfig(config, fallback = {}) {
  const org = config?.organization || {};
  const pro = config?.keepr_pro || {};
  const name =
    pro.display_name ||
    org.display_name ||
    org.name ||
    fallback.manufacturer ||
    fallback.brand ||
    "OEM Organization";
  const location =
    pro.location ||
    org.location ||
    fallback.location ||
    "";

  return {
    name,
    location,
    logoUri: pro.logo_url || org.logo_url || org.photo_url || null,
    headerImageUri: pro.header_image_url || org.header_image_url || org.team_photo_url || null,
    isFallback: !config?.organization && !config?.keepr_pro,
  };
}

async function hydrateTemplateAttachmentMedia(template) {
  if (!template?.id) return [];
  const rows = await listAttachmentsForTarget("model_template", template.id);
  const heroPlacementId = templateHeroPlacementId(template);
  const mediaRows = (rows || []).filter((row) => {
    const mime = String(row.mime_type || "").toLowerCase();
    return row.kind === "photo" || mime.startsWith("image/");
  });

  return Promise.all(
    mediaRows.map(async (row) => {
      let signedUrl = row.attachment_signed_url || row.signed_url || null;
      if (!signedUrl && !row.url && row.bucket && row.storage_path) {
        try {
          signedUrl = await getSignedUrl({
            bucket: row.bucket,
            path: row.storage_path,
            expiresIn: 3600,
            transform: { width: 1600, height: 900, resize: "cover", quality: 86 },
          });
        } catch (err) {
          console.log("Exact build template hero signing failed", err);
        }
      }
      const isHero = !!row.placement_id && row.placement_id === heroPlacementId;
      return {
        ...row,
        id: row.placement_id || row.attachment_id || row.id,
        role: isHero ? "hero" : row.role || "gallery",
        is_hero: isHero,
        attachment_signed_url: signedUrl || row.attachment_signed_url || null,
        attachment_storage_signed_url: signedUrl || row.attachment_storage_signed_url || null,
        signed_url: signedUrl || row.signed_url || null,
        metadata: {
          ...(row.metadata || {}),
          ...(row.ai_metadata || {}),
          attachment_id: row.attachment_id || null,
          placement_id: row.placement_id || null,
          media_source: "attachment_placements",
          placements: {
            hero: isHero,
            showcase: !!row.is_showcase,
          },
          not_exact_hull_media: true,
        },
      };
    })
  );
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

function activeTemplateItems(items = []) {
  return (items || []).filter((item) => item?.applicability?.active !== false);
}

function itemList(item, key) {
  const metadata = item?.metadata || {};
  const downstream = metadata.downstream_elements || {};
  const expectedValue = item?.expected_value?.value || {};
  const value = metadata[key] || downstream[key] || expectedValue[key] || [];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function templateConfiguredOptions(items = []) {
  const activeItems = activeTemplateItems(items);
  const groups = activeItems.filter((item) => item.item_type === "configuration_group");
  const groupById = new Map(groups.map((group) => [group.id, group]));
  return activeItems
    .filter((item) => item.parent_item_id && groupById.has(item.parent_item_id))
    .filter((item) => item.item_type !== "configuration_group" && item.item_type !== "section")
    .map((item) => {
      const group = groupById.get(item.parent_item_id);
      const state = item.expected_value?.selection_state || item.applicability?.standard_state || "optional";
      const metadata = item.metadata || {};
      return {
        templateItemId: item.id,
        key: item.canonical_key || item.id,
        group: group?.metadata?.oem_group_name || group?.label || "Configuration",
        label: item.label,
        description: metadata.oem_description || metadata.description || item.expected_value?.description || null,
        mode: metadata.selection_mode || (item.item_type === "choice" ? "single" : "multi"),
        selected: state === "selected" || state === "standard" || metadata.default_selected === true,
        locked: state === "standard" || metadata.locked === true,
        quantity: item.expected_value?.quantity || 1,
        value: item.expected_value?.value || {},
        systems: itemList(item, "systems"),
        resources: itemList(item, "resources"),
        playbooks: itemList(item, "playbooks"),
        requirements: itemList(item, "requirements"),
      };
    });
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

function normalizeDraftKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isTiaraTemplateKey(value) {
  const key = String(value || "").toLowerCase();
  return key === TIARA_56_LS_TEMPLATE_KEY || key.startsWith("tiara-") || key.includes("tiara");
}

function optionDraftState(option) {
  return option.selected ? "selected" : "unselected";
}

function applyDraftToOptions(nextOptions = [], draftItems = []) {
  const itemByTemplateId = new Map();
  const itemByKey = new Map();
  (draftItems || []).forEach((item) => {
    if (item.template_item_id) itemByTemplateId.set(item.template_item_id, item);
    if (item.item_key) itemByKey.set(item.item_key, item);
  });

  return nextOptions.map((option) => {
    const draftItem = itemByTemplateId.get(option.templateItemId) || itemByKey.get(option.key);
    if (!draftItem) return option;
    return {
      ...option,
      selected: draftItem.state === "selected" || draftItem.state === "overridden",
      quantity: draftItem.quantity || option.quantity || 1,
      value: draftItem.value || option.value || {},
      draftItemId: draftItem.id,
    };
  });
}

function draftItemPayload(option) {
  return {
    templateItemId: option.templateItemId || null,
    itemKey: option.key,
    state: optionDraftState(option),
    selected: Boolean(option.selected),
    quantity: option.quantity || 1,
    value: option.value || {},
    provenance: {
      source: "manual_exact_build_draft",
    },
    metadata: {
      label: option.label,
      group: option.group,
      mode: option.mode,
      projection: option.projection || { kind: "none", reason: "missing_projection" },
    },
  };
}

function exactSystemFromDraftItem(item = {}) {
  const metadata = item.metadata || {};
  const projection = metadata.projection || {};
  if (metadata.source !== "manual_exact_unit_addition" || projection.kind !== "system") return null;
  const label = projection.name || metadata.label || item.value?.label || "";
  if (!label) return null;
  return {
    key: item.item_key,
    label,
    group: projection.group || metadata.group || "Other Systems",
    notes: item.notes || metadata.notes || "",
    quantity: item.quantity || projection.quantity || 1,
    source: item.provenance?.source_url || metadata.source_url || "",
  };
}

function exactSystemDraftItemPayload(item = {}) {
  const label = String(item.label || "").trim();
  const group = String(item.group || "Other Systems").trim() || "Other Systems";
  const quantity = Math.max(1, Number(item.quantity || 1));
  return {
    templateItemId: null,
    itemKey: item.key || `exact-system-${normalizeDraftKey(`${group}-${label}`)}`,
    state: "selected",
    selected: true,
    quantity,
    value: {
      label,
      group,
      source_url: item.source || null,
    },
    provenance: {
      source: "manual_exact_build_draft",
      source_url: item.source || null,
    },
    notes: item.notes || null,
    metadata: {
      source: "manual_exact_unit_addition",
      label,
      group,
      notes: item.notes || null,
      source_url: item.source || null,
      projection: {
        kind: "system",
        mapping_status: "mapped",
        name: label,
        group,
        quantity: String(quantity),
      },
    },
  };
}

function unselectedExactSystemDraftItemPayload(item = {}) {
  const payload = exactSystemDraftItemPayload(item);
  return {
    ...payload,
    state: "unselected",
    selected: false,
  };
}

function statusLabel(status) {
  if (status === "mapped") return "Mapped";
  if (status === "partially_mapped") return "Partially mapped";
  if (status === "needs_review") return "Needs review";
  if (status === "unmapped") return "Unmapped";
  return status || "Needs review";
}

function relationshipLabel(type) {
  if (type === "build_only") return "Build-only";
  return String(type || "mapping").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function mappingPath(item) {
  if (!item?.system_category) return "—";
  if (item.relationship_type === "configuration") return item.system_category;
  if (item.relationship_type === "system") return item.system_category;
  return `${item.system_category} > ${item.normalized_name || item.factory_description}`;
}

function statusTone(status) {
  if (status === "mapped") return styles.statusMapped;
  if (status === "partially_mapped") return styles.statusPartial;
  if (status === "needs_review") return styles.statusReview;
  return styles.statusUnmapped;
}

function manualStatusLabel(status) {
  if (status === "needs_exact_model") return "Needs exact model";
  if (status === "found") return "Found";
  if (status === "missing") return "Missing";
  return status || "Missing";
}

function webSearchParam(...keys) {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

function ToggleRow({ option, onToggle, onQuantityChange }) {
  const selected = option.selected;
  const quantity = Number(option.quantity || 1);
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
            {selected ? "Selected for this boat" : "Not on this boat"}
          </Text>
        </View>
        {option.description ? <Text style={styles.optionDescription}>{option.description}</Text> : null}
        <Text style={styles.optionMeta}>Adds:</Text>
        <View style={styles.addsRow}>
          {adds.map((item, index) => (
            <View key={`${option.key || option.label}-add-${index}-${item}`} style={[styles.addChip, selected && styles.addChipSelected]}>
              <Text style={[styles.addChipText, selected && styles.addChipTextSelected]}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
      {selected ? (
        <View style={styles.quantityStepper}>
          <TouchableOpacity
            activeOpacity={0.82}
            style={styles.quantityButton}
            onPress={(event) => {
              event?.stopPropagation?.();
              onQuantityChange(Math.max(1, quantity - 1));
            }}
          >
            <Ionicons name="remove" size={14} color={colors.brandBlue} />
          </TouchableOpacity>
          <Text style={styles.quantityValue}>Qty {quantity}</Text>
          <TouchableOpacity
            activeOpacity={0.82}
            style={styles.quantityButton}
            onPress={(event) => {
              event?.stopPropagation?.();
              onQuantityChange(quantity + 1);
            }}
          >
            <Ionicons name="add" size={14} color={colors.brandBlue} />
          </TouchableOpacity>
        </View>
      ) : null}
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

function FactoryBuildTable({ lines, selectedLineId, onPressLine }) {
  return (
    <View style={styles.factoryTable}>
      <View style={[styles.factoryRow, styles.factoryHeaderRow]}>
        <Text style={[styles.factoryHeaderText, styles.factoryCodeCell]}>Factory Code</Text>
        <Text style={[styles.factoryHeaderText, styles.factoryDescriptionCell]}>Factory Description</Text>
        <Text style={[styles.factoryHeaderText, styles.factoryMappingCell]}>Keepr Mapping</Text>
        <Text style={[styles.factoryHeaderText, styles.factoryStatusCell]}>Status</Text>
      </View>
      {lines.map((item) => (
        <TouchableOpacity
          key={item.id}
          activeOpacity={0.84}
          onPress={() => onPressLine(item)}
          style={[styles.factoryRow, selectedLineId === item.id && styles.factoryRowSelected]}
        >
          <Text style={[styles.factoryCellText, styles.factoryCodeCell]} numberOfLines={1}>
            {item.factory_item_code || "Derived"}
          </Text>
          <View style={styles.factoryDescriptionCell}>
            <Text style={styles.factoryDescriptionText}>{item.factory_description}</Text>
            <Text style={styles.factoryRawText} numberOfLines={1}>{item.raw_source_text}</Text>
          </View>
          <View style={styles.factoryMappingCell}>
            <Text style={styles.factoryMappingText}>{mappingPath(item)}</Text>
            <Text style={styles.factoryRelationshipText}>
              {relationshipLabel(item.relationship_type)} · {Math.round((item.mapping_confidence || 0) * 100)}% · {item.mapping_method}
            </Text>
          </View>
          <View style={styles.factoryStatusCell}>
            <View style={[styles.statusPill, statusTone(item.mapping_status)]}>
              <Text style={styles.statusPillText}>{statusLabel(item.mapping_status)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ManualQueuePanel({ queue }) {
  return (
    <View style={styles.queueList}>
      {queue.map((item) => (
        <View key={item.system_id} style={styles.queueItem}>
          <View style={styles.queueItemHeader}>
            <View>
              <Text style={styles.queueTitle}>{item.normalized_name}</Text>
              <Text style={styles.queueMeta}>{item.system_category} · {item.evidence_lines.length} factory evidence line{item.evidence_lines.length === 1 ? "" : "s"}</Text>
            </View>
            <View style={styles.manualPill}>
              <Text style={styles.manualPillText}>{manualStatusLabel(item.manual_status)}</Text>
            </View>
          </View>
          <View style={styles.sourceSlots}>
            {item.missing_sources.map((source) => (
              <View key={source} style={styles.sourceSlot}>
                <Ionicons name="document-attach-outline" size={13} color={colors.textMuted} />
                <Text style={styles.sourceSlotText}>{source.replace(/_/g, " ")}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
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
  const templateKey = route?.params?.templateKey || TIARA_56_LS_TEMPLATE_KEY;
  const useTiaraFactoryFallback = isTiaraTemplateKey(templateKey);
  const exactBuildKey = route?.params?.buildKey || route?.params?.exactBuildKey || webSearchParam("build", "buildKey", "exactBuildKey") || null;
  const hullNumber = route?.params?.hullNumber || route?.params?.hin || webSearchParam("hull", "hullNumber", "hin") || null;
  const organizationId = route?.params?.organizationId || webSearchParam("organizationId") || null;
  const workspaceId = route?.params?.workspaceId || webSearchParam("workspaceId") || null;
  const routeDraftId = route?.params?.draftId || webSearchParam("draftId") || null;
  const routeDraftKey = route?.params?.draftKey || webSearchParam("draftKey") || null;
  const [detail, setDetail] = useState(null);
  const [orgConfig, setOrgConfig] = useState(null);
  const [templateAttachmentMedia, setTemplateAttachmentMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [draftWorkspace, setDraftWorkspace] = useState(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [factoryBuild, setFactoryBuild] = useState(() => (
    useTiaraFactoryFallback
      ? (
        getTiaraExactFactoryBuild({ templateKey, buildKey: exactBuildKey, hullNumber })
        || getDefaultTiaraExactFactoryBuildForTemplate(templateKey)
      )
      : null
  ));
  const [factoryBuildSource, setFactoryBuildSource] = useState("none");
  const [options, setOptions] = useState(() => useTiaraFactoryFallback ? DEMO_FACTORY_OPTIONS : []);
  const [finish, setFinish] = useState(FINISH_FIELDS);
  const [selectedFactoryLineId, setSelectedFactoryLineId] = useState(() => (
    useTiaraFactoryFallback
      ? (
        getTiaraExactFactoryBuild({ templateKey, buildKey: exactBuildKey, hullNumber })
        || getDefaultTiaraExactFactoryBuildForTemplate(templateKey)
      )
      : null
  )?.line_items?.[0]?.id || null);
  const [assignmentDraft, setAssignmentDraft] = useState({
    system_category: TIARA_SYSTEM_CATEGORIES[0],
    target: "existing_system",
    relationship_type: "system",
  });
  const [exactUnitSystems, setExactUnitSystems] = useState([]);
  const [systemDraft, setSystemDraft] = useState({
    label: "",
    group: EXACT_SYSTEM_GROUPS[0],
    quantity: "1",
    source: "",
    notes: "",
  });
  const [identity, setIdentity] = useState({
    hin: "",
    buildNumber: "",
    buildDate: "",
    dealer: "",
    location: "",
  });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const localBuild = useTiaraFactoryFallback
        ? (
          getTiaraExactFactoryBuild({ templateKey, buildKey: exactBuildKey, hullNumber })
          || (!exactBuildKey && !hullNumber ? getDefaultTiaraExactFactoryBuildForTemplate(templateKey) : null)
        )
        : null;
      const localTemplateFallback = useTiaraFactoryFallback && templateKey === TIARA_56_LS_TEMPLATE_KEY
        ? { template: tiara56LsCatalogTemplate, resources: [], showcase_media: [], items: [] }
        : null;
      const [next, buildWorkspace, exactDraft, organizationConfig] = await Promise.allSettled([
        getCatalogTemplateDetail({ templateKey }),
        useTiaraFactoryFallback ? getTiaraFactoryBuildWorkspace({
          hullNumber: hullNumber || localBuild?.work_order?.hull_number || null,
          templateKey,
          buildKey: exactBuildKey || localBuild?.build_key || null,
        }) : Promise.resolve(null),
        organizationId ? getExactBuildDraft({
          draftId: routeDraftId,
          draftKey: routeDraftKey,
          templateKey,
          organizationId,
        }) : Promise.resolve(null),
        organizationId ? getKeeprSpaceOrgConfig({ organizationId }) : Promise.resolve(null),
      ]);
      if (next.status === "fulfilled" && next.value) {
        setDetail(next.value);
        setTemplateAttachmentMedia(await hydrateTemplateAttachmentMedia(next.value?.template));
      }
      else if (localTemplateFallback) {
        setDetail(localTemplateFallback);
        setTemplateAttachmentMedia([]);
      }
      else {
        console.warn("Activator catalog detail unavailable for exact-build route.", next.reason);
        setDetail(null);
        setTemplateAttachmentMedia([]);
      }

      if (buildWorkspace.status === "fulfilled" && buildWorkspace.value?.line_items?.length) {
        setFactoryBuild(buildWorkspace.value);
        setFactoryBuildSource("staging");
        setSelectedFactoryLineId(buildWorkspace.value.line_items[0]?.id || null);
      } else if (localBuild) {
        setFactoryBuild(localBuild);
        setFactoryBuildSource("local");
        setSelectedFactoryLineId(localBuild.line_items?.[0]?.id || null);
      } else {
        setFactoryBuild(null);
        setFactoryBuildSource("none");
        setSelectedFactoryLineId(null);
      }

      if (exactDraft.status === "fulfilled" && exactDraft.value?.draft) {
        setDraftWorkspace(exactDraft.value);
      } else {
        setDraftWorkspace(null);
      }

      if (organizationConfig.status === "fulfilled" && organizationConfig.value) {
        setOrgConfig(organizationConfig.value);
      } else {
        setOrgConfig(null);
      }
    } catch (err) {
      console.error("Activator exact build failed:", err);
      setError(err?.message || "Could not open this build workspace.");
      setDetail(null);
      setOrgConfig(null);
      setTemplateAttachmentMedia([]);
      const localBuild = useTiaraFactoryFallback
        ? (
          getTiaraExactFactoryBuild({ templateKey, buildKey: exactBuildKey, hullNumber })
          || (!exactBuildKey && !hullNumber ? getDefaultTiaraExactFactoryBuildForTemplate(templateKey) : null)
        )
        : null;
      setFactoryBuild(localBuild);
      setFactoryBuildSource(localBuild ? "local" : "none");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [exactBuildKey, hullNumber, organizationId, routeDraftId, routeDraftKey, templateKey, useTiaraFactoryFallback]);

  useEffect(() => {
    load();
  }, [load]);

  const workOrder = factoryBuild?.work_order || null;
  const exactDraft = draftWorkspace?.draft || null;
  const exactDraftItems = useMemo(() => draftWorkspace?.items || [], [draftWorkspace?.items]);
  const modelProjection = useMemo(() => projectModelTemplateDetail(detail), [detail]);
  const draftTemplate = draftWorkspace?.template || null;
  const template = modelProjection.template || draftTemplate || {};
  const resources = modelProjection.resources || [];
  const catalogTemplate = factoryBuild?.catalog_template || template || {};
  const publicModelContext = factoryBuild?.public_model_context || null;
  const factoryLines = factoryBuild?.line_items || [];
  const manualQueue = factoryBuild?.manual_queue || [];
  const selectedFactoryLine = factoryLines.find((item) => item.id === selectedFactoryLineId) || factoryLines[0];
  const exactBuildLabel = workOrder?.build_code || exactDraft?.draft_key || exactBuildKey || "Exact build";
  const modelLabel = catalogTemplate?.model || template?.model || "model";
  const modelYearLabel = catalogTemplate?.model_year || template?.model_year || "2027";
  const orgBrandContext = orgBrandContextFromConfig(orgConfig, catalogTemplate || template || {});
  const orgLogoSource = imageSourceFromUri(orgBrandContext.logoUri);
  const orgLocationMeta = compact([orgBrandContext.location, "OEM factory build"]) || "OEM factory build";
  const modelBrandLabel = catalogTemplate?.manufacturer || template?.manufacturer || orgBrandContext.name;
  const hasFactoryBuild = Boolean(factoryBuild && factoryLines.length);
  const digitalTwinAssetId = workOrder?.asset_id || factoryBuild?.asset_id || null;
  const digitalTwinKac = workOrder?.kac_id || factoryBuild?.kac_id || (workOrder?.build_code ? `KAC-TIARA-56LS-${String(workOrder.build_code).toUpperCase()}` : null);
  const projectedMedia = modelProjection.media?.items?.length ? modelProjection.media.items : detail?.showcase_media || [];
  const showcaseMedia = templateAttachmentMedia.length ? templateAttachmentMedia : projectedMedia;
  const heroMedia =
    mediaByRole(templateAttachmentMedia, "hero") ||
    modelProjection.media?.hero ||
    mediaByRole(showcaseMedia, "hero");
  const heroSource = heroMedia ? mediaAsset(heroMedia) : imageSourceFromUri(orgBrandContext.headerImageUri, BOAT_HERO);
  const templateItems = useMemo(() => groupTemplateItems(detail?.items || []), [detail?.items]);
  const standardItems = templateItems.filter((item) => item.applicability?.standard_state === "standard");
  const operationalTemplateItems = standardItems.filter((item) => ["system", "equipment", "resource"].includes(item.item_type));
  const freshwaterItems = standardItems.filter((item) => item.canonical_key?.startsWith("system.freshwater") || item.canonical_key?.startsWith("knowledge.freshwater") || item.canonical_key?.startsWith("playbook.freshwater"));
  const configuredTemplateOptions = useMemo(() => {
    const projectedOptions = modelProjection.configuration?.buildEligibleItems || [];
    return projectedOptions.length ? projectedOptions : templateConfiguredOptions(detail?.items || []);
  }, [detail?.items, modelProjection]);
  const optionGroups = useMemo(() => groupedOptions(options), [options]);
  const selectedOptions = options.filter((option) => option.selected);
  const selectedExactUnitSystems = exactUnitSystems.filter((item) => item.label);
  const compiled = useMemo(() => {
    const baselineSystems = operationalTemplateItems
      .filter((item) => item.item_type === "system" || item.item_type === "equipment")
      .map((item) => item.label);
    const templatePlaybooks = standardItems
      .filter((item) => item.item_type === "playbook")
      .map((item) => item.label);
    const optionSystems = hasFactoryBuild ? [] : selectedOptions.flatMap((option) => option.systems);
    const optionResources = hasFactoryBuild ? [] : selectedOptions.flatMap((option) => option.resources);
    const optionPlaybooks = hasFactoryBuild ? [] : selectedOptions.flatMap((option) => option.playbooks);
    const optionRequirements = hasFactoryBuild ? [] : selectedOptions.flatMap((option) => option.requirements);
    return {
      systems: unique([...baselineSystems, ...optionSystems, ...selectedExactUnitSystems.map((system) => system.label), ...(factoryBuild?.systems || []).map((system) => system.name)]),
      resources: unique([...resources.map((resource) => resource.title), ...optionResources]),
      playbooks: unique([
        "Factory configuration review",
        hasFactoryBuild ? `${exactBuildLabel} factory work-order evidence reconciliation` : null,
        "HIN and KAC verification",
        "OEM as-built evidence packet",
        ...templatePlaybooks,
        ...optionPlaybooks,
      ]),
      requirements: unique([
        "HIN",
        hasFactoryBuild ? "Hull number" : "Build number",
        hasFactoryBuild ? "Order number" : "Factory build date",
        hasFactoryBuild ? "Factory completion date" : "Destination dealer",
        hasFactoryBuild ? "Manual/source queue" : null,
        ...optionRequirements,
      ]),
    };
  }, [exactBuildLabel, factoryBuild?.systems, hasFactoryBuild, operationalTemplateItems, resources, selectedExactUnitSystems, selectedOptions, standardItems]);

  const readyToFreeze = Boolean(identity.hin && identity.buildNumber && identity.buildDate && identity.dealer && selectedOptions.length);

  useEffect(() => {
    if (!workOrder && exactDraft) {
      const draftIdentity = exactDraft.identity || {};
      setIdentity({
        hin: exactDraft.hin || draftIdentity.hin || "",
        buildNumber: exactDraft.work_order_number || draftIdentity.buildNumber || exactDraft.draft_key || "",
        buildDate: exactDraft.build_date || draftIdentity.buildDate || "",
        dealer: exactDraft.dealer_name || draftIdentity.dealer || "",
        location: draftIdentity.location || "",
      });
      setFinish(Array.isArray(exactDraft.finish_selections) && exactDraft.finish_selections.length ? exactDraft.finish_selections : FINISH_FIELDS);
      return;
    }

    if (!workOrder) {
      setIdentity({
        hin: "",
        buildNumber: "",
        buildDate: "",
        dealer: "",
        location: "",
      });
      return;
    }

    setIdentity({
      hin: workOrder.hin || "",
      buildNumber: workOrder.build_code || "",
      buildDate: workOrder.order_date || "",
      dealer: workOrder.dealer || "",
      location: workOrder.dealer_location || "Stuart, FL",
    });
  }, [exactDraft, workOrder]);

  useEffect(() => {
    if (hasFactoryBuild || !configuredTemplateOptions.length) return;
    setOptions(applyDraftToOptions(configuredTemplateOptions, exactDraftItems));
  }, [configuredTemplateOptions, exactDraftItems, hasFactoryBuild]);

  useEffect(() => {
    if (hasFactoryBuild) return;
    const nextSystems = (exactDraftItems || [])
      .map(exactSystemFromDraftItem)
      .filter(Boolean);
    setExactUnitSystems(nextSystems);
  }, [exactDraftItems, hasFactoryBuild]);

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
  const updateOptionQuantity = (option, quantity) => {
    setOptions((current) => current.map((item) => (
      item.key === option.key ? { ...item, quantity } : item
    )));
  };

  const updateIdentity = (key, value) => setIdentity((current) => ({ ...current, [key]: value }));
  const updateFinish = (key, value) => setFinish((current) => current.map((item) => item.key === key ? { ...item, value } : item));
  const updateSystemDraft = (key, value) => setSystemDraft((current) => ({ ...current, [key]: value }));
  const addExactUnitSystem = () => {
    const label = String(systemDraft.label || "").trim();
    if (!label) {
      setDraftNotice("Add a system name first, like Suzuki Stealth 200.");
      return;
    }
    const next = {
      key: `exact-system-${normalizeDraftKey(`${systemDraft.group}-${label}`)}`,
      label,
      group: systemDraft.group || "Other Systems",
      quantity: Math.max(1, Number(systemDraft.quantity || 1)),
      source: systemDraft.source || "",
      notes: systemDraft.notes || "",
    };
    setExactUnitSystems((current) => {
      const withoutDuplicate = current.filter((item) => item.key !== next.key);
      return [...withoutDuplicate, next];
    });
    setSystemDraft({
      label: "",
      group: EXACT_SYSTEM_GROUPS[0],
      quantity: "1",
      source: systemDraft.source || "",
      notes: "",
    });
    setDraftNotice(`${label} added to this exact boat. Save Draft to persist it.`);
  };
  const removeExactUnitSystem = (key) => {
    setExactUnitSystems((current) => current.filter((item) => item.key !== key));
    setDraftNotice("Exact-unit system removed. Save Draft to persist the change.");
  };
  const pressFactoryLine = (item) => {
    setSelectedFactoryLineId(item.id);
    const metadata = item.mapping_metadata && typeof item.mapping_metadata === "object" ? item.mapping_metadata : {};
    const canonicalIds = Array.isArray(metadata.canonical_system_ids) ? metadata.canonical_system_ids.filter(Boolean) : [];
    const canonicalId = metadata.canonical_system_id || (canonicalIds.length === 1 ? canonicalIds[0] : null);
    const canOpenSystem = ["system", "component"].includes(item.relationship_type);
    setAssignmentDraft({
      system_category: item.system_category || TIARA_SYSTEM_CATEGORIES[0],
      target: item.relationship_type === "build_only" ? "build_only" : canonicalId || item.system_id ? "existing_system" : "new_system",
      relationship_type: item.relationship_type || "system",
    });

    if (canOpenSystem && canonicalIds.length > 1 && item.asset_id) {
      navigation.navigate("BoatSystems", {
        boatId: item.asset_id,
        assetId: item.asset_id,
        boatName: workOrder?.asset?.name || workOrder?.boat?.name || identity.hin || "Boat",
        kac: workOrder?.asset?.kac_id || workOrder?.kac || null,
        organizationId,
        workspaceId,
        relationshipRole: "oem",
        teamMemberType: "oem",
        systemsRole: "oem",
        parentRoute: route?.params?.parentRoute || "ActivatorHome",
      });
      return;
    }

    if (canOpenSystem && canonicalId && item.asset_id) {
      navigation.navigate("BoatSystemStory", {
        boatId: item.asset_id,
        assetId: item.asset_id,
        systemId: canonicalId,
        systemName: item.normalized_name || item.system_category,
        organizationId,
        workspaceId,
        relationshipRole: "oem",
        teamMemberType: "oem",
        systemsRole: "oem",
        parentRoute: route?.params?.parentRoute || "ActivatorHome",
      });
    }
  };
  const updateAssignmentDraft = (key, value) => setAssignmentDraft((current) => ({ ...current, [key]: value }));
  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };
  const openDigitalTwin = () => {
    if (!digitalTwinAssetId && !digitalTwinKac) return;
    navigation.navigate("KeeprSpaceBoat", {
      assetId: digitalTwinAssetId,
      kac: digitalTwinKac,
      organizationId: route?.params?.organizationId || null,
      parentRoute: route?.params?.parentRoute === "KeeprSpaceFleet" ? "KeeprSpaceFleet" : "ActivatorHome",
      workspaceId: route?.params?.workspaceId || null,
      systemsRole: "oem",
    });
  };
  const replaceDraftRoute = (savedDraft) => {
    const savedDraftId = savedDraft?.id;
    if (!savedDraftId || typeof window === "undefined" || !window.location) return;
    const params = new URLSearchParams(window.location.search || "");
    params.set("draftId", savedDraftId);
    params.set("draftKey", savedDraft.draft_key);
    if (organizationId) params.set("organizationId", organizationId);
    if (workspaceId) params.set("workspaceId", workspaceId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };
  const buildDraftPayload = () => {
    const activeSystemKeys = new Set(exactUnitSystems.map((item) => item.key).filter(Boolean));
    const removedSystemPayloads = (exactDraftItems || [])
      .map(exactSystemFromDraftItem)
      .filter((item) => item?.key && !activeSystemKeys.has(item.key))
      .map(unselectedExactSystemDraftItemPayload);

    return {
      organizationId,
      templateKey,
      draftId: exactDraft?.id || routeDraftId,
      draftKey: routeDraftKey || exactDraft?.draft_key || normalizeDraftKey(identity.buildNumber || identity.hin || ""),
      displayName: compact([identity.buildNumber || identity.hin || null, modelLabel, "Draft"]),
      identity: {
        ...identity,
        buildYear: modelYearLabel,
        workOrderNumber: identity.buildNumber,
        sourceType: "manual",
      },
      finishSelections: finish,
      items: [
        ...options.map(draftItemPayload),
        ...exactUnitSystems.map(exactSystemDraftItemPayload),
        ...removedSystemPayloads,
      ],
      status: "draft",
      sourceResourceId: resources[0]?.id || null,
      metadata: {
        source: "exact_build_screen",
        selected_count: selectedOptions.length,
        exact_unit_system_count: exactUnitSystems.length,
      },
    };
  };
  const saveDraft = async () => {
    if (!organizationId) {
      setDraftNotice("Missing organization context. Return through Models or Work and try again.");
      return;
    }
    setSavingDraft(true);
    setDraftNotice("");
    try {
      const saved = await upsertExactBuildDraft(buildDraftPayload());
      setDraftWorkspace(saved);
      replaceDraftRoute(saved?.draft);
      setDraftNotice(`Draft saved: ${saved?.draft?.display_name || saved?.draft?.draft_key || "exact build"}.`);
    } catch (err) {
      console.error("Exact build draft save failed:", err);
      setDraftNotice(err?.message || "Could not save this exact build draft.");
    } finally {
      setSavingDraft(false);
    }
  };
  const publishDraft = async () => {
    const draftId = exactDraft?.id || routeDraftId;
    if (!draftId) {
      setDraftNotice("Save the draft before publishing.");
      return;
    }
    setPublishingDraft(true);
    setDraftNotice("");
    try {
      const published = await publishExactBuildDraft(draftId);
      setDraftWorkspace(published);
      const assetId = published?.asset_id || published?.draft?.asset_id;
      const kac = published?.kac_id;
      if (assetId || kac) {
        navigation.navigate("BoatStory", {
          boatId: assetId,
          assetId,
          kac,
          organizationId,
          workspaceId,
          relationshipRole: "oem",
          teamMemberType: "oem",
          systemsRole: "oem",
          parentRoute: "ActivatorHome",
        });
      } else {
        setDraftNotice("Draft published, but no canonical boat id was returned.");
      }
    } catch (err) {
      console.error("Exact build draft publish failed:", err);
      setDraftNotice(err?.message || "Could not publish this exact build draft.");
    } finally {
      setPublishingDraft(false);
    }
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
              label: "Configure Boats",
              route: "ActivatorHome",
              params: {
                initialMode: "builds",
                navSection: "ActivatorBuilds",
                organizationId: route?.params?.organizationId || null,
                workspaceId: route?.params?.workspaceId || null,
              },
            },
          ]}
          current={hasFactoryBuild ? `${exactBuildLabel} · ${modelLabel}` : `Build ${modelLabel}`}
          right={(
            <View style={styles.breadcrumbKac}>
              <Ionicons name="key-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbKacText}>{hasFactoryBuild ? `${exactBuildLabel} · ${workOrder?.hin || "HIN pending"}` : templateKey}</Text>
            </View>
          )}
        />
        <ImageBackground source={heroSource} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroBrandCard}>
              {orgLogoSource ? (
                <Image source={orgLogoSource} resizeMode="contain" style={styles.heroLogo} />
              ) : (
                <View style={styles.heroLogoFallback}>
                  <Text style={styles.heroLogoFallbackText}>{initialsForName(orgBrandContext.name)}</Text>
                </View>
              )}
              <View style={styles.heroBrandTextWrap}>
                <Text style={styles.heroBrandName}>{orgBrandContext.name}</Text>
                <Text style={styles.heroBrandMeta}>{orgLocationMeta}</Text>
              </View>
            </View>
            <Text style={styles.modelWatermark}>{hasFactoryBuild ? exactBuildLabel : modelLabel}</Text>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Keepr Activator · Exact Factory Build</Text>
              <Text style={styles.title}>{hasFactoryBuild ? `${exactBuildLabel} exact build metadata` : `Build a ${modelBrandLabel} ${modelLabel}`}</Text>
              <Text style={styles.subtitle}>
                {hasFactoryBuild
                  ? `${orgBrandContext.name} work order ${workOrder?.order_number} is preserved line by line, then mapped into Keepr systems, components, options, configuration, and source-material work queues for this exact boat.`
                  : `Configure one exact boat from the published MY${modelYearLabel} ${modelLabel} template. A factory work order can then turn that model definition into as-built systems, components, options, and source queues.`}
              </Text>
              <View style={styles.heroBadges}>
                <View style={styles.heroBadge}>
                  <Ionicons name="layers-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>{hasFactoryBuild ? `${factoryLines.length} factory lines` : `Template v${template.version || catalogTemplate.version || 1}`}</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="boat-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>{hasFactoryBuild ? `HIN ${workOrder?.hin}` : "Exact boat workspace"}</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="document-text-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.heroBadgeText}>{hasFactoryBuild ? (factoryBuildSource === "staging" ? "Factory build source" : "Local factory fallback") : "Model template"}</Text>
                </View>
              </View>
            </View>
          </View>
        </ImageBackground>

        <LifecycleRail />

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Opening exact build workspace...</Text>
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
              {hasFactoryBuild ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.kicker}>Factory Build</Text>
                      <Text style={styles.panelTitle}>Factory work-order ingestion</Text>
                    </View>
                    <Text style={styles.panelCount}>{factoryLines.length} lines</Text>
                  </View>
                  <Text style={styles.panelText}>
                    Factory codes and original descriptions remain authoritative evidence. Keepr mappings sit beside them and resolve to the exact systems graph for {exactBuildLabel}.
                  </Text>
                  <View style={styles.workOrderSummary}>
                    <View style={styles.workOrderFact}>
                      <Text style={styles.workOrderFactLabel}>Order</Text>
                      <Text style={styles.workOrderFactValue}>{workOrder?.order_number}</Text>
                    </View>
                    <View style={styles.workOrderFact}>
                      <Text style={styles.workOrderFactLabel}>Order date</Text>
                      <Text style={styles.workOrderFactValue}>{workOrder?.order_date}</Text>
                    </View>
                    <View style={styles.workOrderFact}>
                      <Text style={styles.workOrderFactLabel}>HIN</Text>
                      <Text style={styles.workOrderFactValue}>{workOrder?.hin}</Text>
                    </View>
                    <View style={styles.workOrderFact}>
                      <Text style={styles.workOrderFactLabel}>Completion</Text>
                      <Text style={styles.workOrderFactValue}>{workOrder?.completion_date}</Text>
                    </View>
                  </View>
                  <FactoryBuildTable
                    lines={factoryLines}
                    selectedLineId={selectedFactoryLine?.id}
                    onPressLine={pressFactoryLine}
                  />
                </View>
              ) : null}

              {hasFactoryBuild ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.kicker}>Mapping Assignment</Text>
                      <Text style={styles.panelTitle}>Resolve selected line</Text>
                    </View>
                  </View>
                  {selectedFactoryLine ? (
                    <View style={styles.assignmentPanel}>
                      <View style={styles.selectedEvidenceBox}>
                        <Text style={styles.selectedEvidenceCode}>{selectedFactoryLine.factory_item_code || "Derived line"}</Text>
                        <Text style={styles.selectedEvidenceDescription}>{selectedFactoryLine.factory_description}</Text>
                        <Text style={styles.selectedEvidenceRaw}>{selectedFactoryLine.raw_source_text}</Text>
                      </View>
                      {selectedFactoryLine.review_note ? (
                        <View style={styles.reviewNote}>
                          <Ionicons name="alert-circle-outline" size={15} color="#92400E" />
                          <Text style={styles.reviewNoteText}>{selectedFactoryLine.review_note}</Text>
                        </View>
                      ) : null}
                      <View style={styles.assignmentControls}>
                        <View style={styles.assignmentControl}>
                          <Text style={styles.inputLabel}>System category</Text>
                          <View style={styles.segmentWrap}>
                            {TIARA_SYSTEM_CATEGORIES.map((category) => (
                              <TouchableOpacity
                                key={category}
                                activeOpacity={0.82}
                                onPress={() => updateAssignmentDraft("system_category", category)}
                                style={[styles.segmentChip, assignmentDraft.system_category === category && styles.segmentChipSelected]}
                              >
                                <Text style={[styles.segmentChipText, assignmentDraft.system_category === category && styles.segmentChipTextSelected]}>
                                  {category}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                        <View style={styles.assignmentControl}>
                          <Text style={styles.inputLabel}>Assign as</Text>
                          <View style={styles.segmentWrap}>
                            {[
                              ["existing_system", "Existing system"],
                              ["new_system", "New system"],
                              ["component", "Component"],
                              ["option", "Option"],
                              ["build_only", "Build-only"],
                            ].map(([key, label]) => (
                              <TouchableOpacity
                                key={key}
                                activeOpacity={0.82}
                                onPress={() => updateAssignmentDraft("target", key)}
                                style={[styles.segmentChip, assignmentDraft.target === key && styles.segmentChipSelected]}
                              >
                                <Text style={[styles.segmentChipText, assignmentDraft.target === key && styles.segmentChipTextSelected]}>{label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      </View>
                      <TouchableOpacity activeOpacity={0.86} style={styles.assignButton}>
                        <Ionicons name="git-merge-outline" size={17} color={colors.onPrimary} />
                        <Text style={styles.assignButtonText}>Save mapping in staging</Text>
                      </TouchableOpacity>
                      <Text style={styles.stopNote}>
                        Staging-only first version: the selected assignment is local UI state until the factory-build migration is applied.
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.panelText}>Select a factory line to review or assign its Keepr mapping.</Text>
                  )}
                </View>
              ) : null}

              {!hasFactoryBuild ? (
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
                        <ToggleRow
                          key={option.key}
                          option={option}
                          onToggle={() => toggleOption(option)}
                          onQuantityChange={(quantity) => updateOptionQuantity(option, quantity)}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {!hasFactoryBuild ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.kicker}>Exact-Unit Additions</Text>
                      <Text style={styles.panelTitle}>Add systems on this boat</Text>
                    </View>
                    <Text style={styles.panelCount}>{exactUnitSystems.length}</Text>
                  </View>
                  <Text style={styles.panelText}>
                    Add installed systems that are visible on this exact boat but not yet modeled as template choices.
                  </Text>
                  <View style={styles.exactSystemForm}>
                    <View style={styles.inputWrap}>
                      <Text style={styles.inputLabel}>System name</Text>
                      <TextInput
                        value={systemDraft.label}
                        onChangeText={(value) => updateSystemDraft("label", value)}
                        style={styles.input}
                        placeholder="Suzuki Stealth 200"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                    <View style={styles.segmentRow}>
                      {EXACT_SYSTEM_GROUPS.map((group) => (
                        <TouchableOpacity
                          key={group}
                          activeOpacity={0.82}
                          onPress={() => updateSystemDraft("group", group)}
                          style={[styles.segmentChip, systemDraft.group === group && styles.segmentChipSelected]}
                        >
                          <Text style={[styles.segmentChipText, systemDraft.group === group && styles.segmentChipTextSelected]}>{group}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.fieldGrid}>
                      <View style={styles.inputWrap}>
                        <Text style={styles.inputLabel}>Quantity</Text>
                        <TextInput
                          value={String(systemDraft.quantity)}
                          onChangeText={(value) => updateSystemDraft("quantity", value)}
                          keyboardType="numeric"
                          style={styles.input}
                          placeholder="1"
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                      <View style={styles.inputWrap}>
                        <Text style={styles.inputLabel}>Source URL</Text>
                        <TextInput
                          value={systemDraft.source}
                          onChangeText={(value) => updateSystemDraft("source", value)}
                          style={styles.input}
                          placeholder="Listing or OEM source"
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                    </View>
                    <View style={styles.inputWrap}>
                      <Text style={styles.inputLabel}>Notes</Text>
                      <TextInput
                        value={systemDraft.notes}
                        onChangeText={(value) => updateSystemDraft("notes", value)}
                        style={[styles.input, styles.textArea]}
                        multiline
                        placeholder="Serial number, observed detail, or source note"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                    <TouchableOpacity activeOpacity={0.86} style={styles.addSystemButton} onPress={addExactUnitSystem}>
                      <Ionicons name="add-circle-outline" size={18} color={colors.onPrimary} />
                      <Text style={styles.addSystemButtonText}>Add System to This Boat</Text>
                    </TouchableOpacity>
                  </View>
                  {exactUnitSystems.length ? (
                    <View style={styles.exactSystemList}>
                      {exactUnitSystems.map((system) => (
                        <View key={system.key} style={styles.exactSystemItem}>
                          <View style={styles.exactSystemItemText}>
                            <Text style={styles.exactSystemName}>{system.label}</Text>
                            <Text style={styles.exactSystemMeta}>{compact([system.group, Number(system.quantity || 1) > 1 ? `Qty ${system.quantity}` : null])}</Text>
                          </View>
                          <TouchableOpacity activeOpacity={0.82} style={styles.removeSystemButton} onPress={() => removeExactUnitSystem(system.key)}>
                            <Text style={styles.removeSystemButtonText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {!hasFactoryBuild ? (
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
              ) : null}

              <FreshwaterFlowdownPanel items={freshwaterItems} />

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View>
                    <Text style={styles.kicker}>Inherited Standards</Text>
                    <Text style={styles.panelTitle}>From published {modelLabel} template</Text>
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
                    <Text style={styles.kicker}>Exact Boat Identity</Text>
                    <Text style={styles.panelTitle}>{hasFactoryBuild ? "From Tiara work order" : "Freeze inputs"}</Text>
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
                    <Text style={styles.inputLabel}>Build code</Text>
                    <TextInput value={identity.buildNumber} onChangeText={(value) => updateIdentity("buildNumber", value)} style={styles.input} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Order date</Text>
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
                {hasFactoryBuild ? (
                  <View style={styles.kacCard}>
                    <Text style={styles.kacLabel}>Factory source role</Text>
                    <Text style={styles.kacValue}>{workOrder?.source_role}</Text>
                  </View>
                ) : null}
                <View style={[styles.milestoneCard, readyToFreeze && styles.milestoneCardReady]}>
                  <Text style={styles.milestoneKicker}>{hasFactoryBuild ? "Factory Build Evidence" : "Factory Configuration Ready"}</Text>
                  <Text style={styles.milestoneTitle}>{hasFactoryBuild ? `${orgBrandContext.name} proof is attached before normalization.` : "OEM layer can be frozen for this boat."}</Text>
                  <View style={styles.milestoneStats}>
                    <Text style={styles.milestoneStat}>{compiled.systems.length} systems</Text>
                    <Text style={styles.milestoneStat}>{hasFactoryBuild ? `${factoryLines.length} factory lines` : `${compiled.resources.length} resources`}</Text>
                    <Text style={styles.milestoneStat}>{compiled.playbooks.length} playbooks</Text>
                    <Text style={styles.milestoneStat}>{hasFactoryBuild ? `${manualQueue.length} source queues` : `${compiled.requirements.length} verification items`}</Text>
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
                {!hasFactoryBuild ? (
                  <View style={styles.draftActionStack}>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      style={[styles.freezeButton, savingDraft && styles.freezeButtonDisabled]}
                      onPress={saveDraft}
                      disabled={savingDraft}
                    >
                      {savingDraft ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="save-outline" size={18} color={colors.onPrimary} />}
                      <Text style={styles.freezeButtonText}>{savingDraft ? "Saving Draft..." : "Save Draft"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      style={[styles.digitalTwinButton, (!exactDraft?.id || publishingDraft) && styles.freezeButtonDisabled]}
                      onPress={publishDraft}
                      disabled={!exactDraft?.id || publishingDraft}
                    >
                      {publishingDraft ? <ActivityIndicator size="small" color={colors.brandBlue} /> : <Ionicons name="cloud-upload-outline" size={18} color={colors.brandBlue} />}
                      <Text style={styles.digitalTwinButtonText}>{publishingDraft ? "Publishing..." : "Factory Freeze / Publish KAC"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      style={styles.workQueueButton}
                      onPress={() => navigation.navigate("ActivatorHome", {
                        initialMode: "builds",
                        navSection: "ActivatorWork",
                        organizationId,
                        workspaceId,
                      })}
                    >
                      <Ionicons name="list-outline" size={17} color={colors.brandBlue} />
                      <Text style={styles.workQueueButtonText}>Return to Work</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity activeOpacity={0.86} style={[styles.freezeButton, !readyToFreeze && styles.freezeButtonDisabled]}>
                    <Ionicons name="cloud-upload-outline" size={18} color={colors.onPrimary} />
                    <Text style={styles.freezeButtonText}>Stage {exactBuildLabel} Ingestion</Text>
                  </TouchableOpacity>
                )}
                {hasFactoryBuild ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[styles.digitalTwinButton, !digitalTwinAssetId && !digitalTwinKac && styles.freezeButtonDisabled]}
                    onPress={openDigitalTwin}
                    disabled={!digitalTwinAssetId && !digitalTwinKac}
                  >
                    <Ionicons name="boat-outline" size={18} color={colors.brandBlue} />
                    <Text style={styles.digitalTwinButtonText}>View Digital Twin</Text>
                  </TouchableOpacity>
                ) : null}
                {draftNotice ? <Text style={styles.draftNotice}>{draftNotice}</Text> : null}
                <Text style={styles.stopNote}>
                  {hasFactoryBuild ? "No production changes: this action is intentionally staged before Dealer Handoff." : "Save preserves this boat's selected template items and identity fields. Publish creates or binds the canonical Keepr boat."}
                </Text>
              </View>

              {hasFactoryBuild ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.kicker}>Missing Source Queue</Text>
                      <Text style={styles.panelTitle}>Manual resolution</Text>
                    </View>
                    <Text style={styles.panelCount}>{manualQueue.length}</Text>
                  </View>
                  <Text style={styles.panelText}>
                    Every mapped system/component is factory-confirmed, then queued for owner manual, service manual, installation manual, and warranty-source resolution.
                  </Text>
                  <ManualQueuePanel queue={manualQueue} />
                </View>
              ) : null}

              {publicModelContext ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.kicker}>Public Model Context</Text>
                      <Text style={styles.panelTitle}>Website, specs & gallery</Text>
                    </View>
                    <Ionicons name="globe-outline" size={18} color={colors.brandBlue} />
                  </View>
                  <Text style={styles.panelText}>
                    Published model content supports presentation and catalog alignment. It does not replace the {exactBuildLabel} work order as proof that equipment belongs on this boat.
                  </Text>
                  <View style={styles.publicContextGrid}>
                    {(publicModelContext?.specs || []).slice(0, 6).map((spec) => (
                      <View key={spec.label} style={styles.publicSpecCard}>
                        <Text style={styles.publicSpecLabel}>{spec.label}</Text>
                        <Text style={styles.publicSpecValue}>{spec.value}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.publicResourceList}>
                    {(publicModelContext?.resources || []).map((resource) => (
                      <View key={resource.label} style={styles.publicResourceItem}>
                        <Ionicons name="link-outline" size={14} color={colors.brandBlue} />
                        <Text style={styles.publicResourceText}>{resource.label}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.galleryChipRow}>
                    {(publicModelContext?.media_gallery || []).map((item) => (
                      <View key={item} style={styles.galleryChip}>
                        <Ionicons name="images-outline" size={13} color={colors.textMuted} />
                        <Text style={styles.galleryChipText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

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
  heroLogoFallback: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  heroLogoFallbackText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
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
  optionDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  optionMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  quantityStepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  quantityButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  quantityValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 48,
    textAlign: "center",
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
  exactSystemForm: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
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
  digitalTwinButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  digitalTwinButtonText: {
    color: colors.brandBlue,
    fontSize: 13,
    fontWeight: "900",
  },
  draftActionStack: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  workQueueButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  workQueueButtonText: {
    color: colors.brandBlue,
    fontSize: 13,
    fontWeight: "900",
  },
  draftNotice: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: spacing.sm,
    textAlign: "center",
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
  workOrderSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  workOrderFact: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.md,
  },
  workOrderFactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  workOrderFactValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 4,
  },
  factoryTable: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  factoryRow: {
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    padding: spacing.sm,
  },
  factoryHeaderRow: {
    backgroundColor: colors.surfaceSubtle,
    borderTopWidth: 0,
    minHeight: 38,
  },
  factoryRowSelected: {
    backgroundColor: "#EFF6FF",
  },
  factoryHeaderText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  factoryCellText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  factoryCodeCell: {
    minWidth: 112,
    width: "18%",
  },
  factoryDescriptionCell: {
    flex: 1.2,
    minWidth: 150,
  },
  factoryMappingCell: {
    flex: 1,
    minWidth: 150,
  },
  factoryStatusCell: {
    alignItems: "flex-start",
    minWidth: 112,
    width: "16%",
  },
  factoryDescriptionText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  factoryRawText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  factoryMappingText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  factoryRelationshipText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  statusPill: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  statusMapped: {
    backgroundColor: "#DCFCE7",
  },
  statusPartial: {
    backgroundColor: "#DBEAFE",
  },
  statusReview: {
    backgroundColor: "#FEF3C7",
  },
  statusUnmapped: {
    backgroundColor: "#FEE2E2",
  },
  statusPillText: {
    color: colors.brandNavy,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  assignmentPanel: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  selectedEvidenceBox: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  selectedEvidenceCode: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
  },
  selectedEvidenceDescription: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  selectedEvidenceRaw: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  reviewNote: {
    alignItems: "flex-start",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  textArea: {
    minHeight: 76,
    textAlignVertical: "top",
  },
  addSystemButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  addSystemButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  exactSystemList: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  exactSystemItem: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  exactSystemItemText: {
    flex: 1,
    minWidth: 0,
  },
  exactSystemName: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  exactSystemMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  removeSystemButton: {
    borderColor: colors.accentRed,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  removeSystemButtonText: {
    color: colors.accentRed,
    fontSize: 11,
    fontWeight: "900",
  },
  reviewNoteText: {
    color: "#92400E",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  assignmentControls: {
    gap: spacing.md,
  },
  assignmentControl: {
    gap: spacing.xs,
  },
  segmentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  segmentChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  segmentChipSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
  },
  segmentChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  segmentChipTextSelected: {
    color: colors.brandNavy,
  },
  assignButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  assignButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  queueList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  queueItem: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  queueItemHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  queueTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  queueMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  manualPill: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  manualPillText: {
    color: "#92400E",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sourceSlots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  sourceSlot: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  sourceSlotText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  publicContextGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  publicSpecCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 118,
    padding: spacing.sm,
  },
  publicSpecLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 14,
    textTransform: "uppercase",
  },
  publicSpecValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  publicResourceList: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  publicResourceItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  publicResourceText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  galleryChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  galleryChip: {
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
  galleryChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
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
