import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useRoute } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import {
  getCatalogTemplateDetail,
  linkModelItemSystemTemplate,
  listSystemTemplates,
  promoteModelItemToSystemTemplate,
  unlinkModelItemSystemTemplate,
  upsertCatalogTemplateItem,
} from "../lib/activatorApi";
import { listAttachmentsForTarget, removePlacementById } from "../lib/attachmentsApi";
import { createLinkAttachment, uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { supabase } from "../lib/supabaseClient";

const colors = {
  ink: "#0f172a",
  muted: "#5f6b7a",
  border: "#dfe5ec",
  bg: "#f5f7fb",
  panel: "#ffffff",
  navy: "#171d4f",
  blue: "#2f80ed",
  lightBlue: "#eaf3ff",
  green: "#dcfce7",
  greenInk: "#166534",
  amber: "#fef3c7",
  amberInk: "#92400e",
};

const ITEM_KINDS = [
  { value: "configuration_item", label: "Configuration Item" },
  { value: "choice", label: "Choice" },
  { value: "option", label: "Option" },
  { value: "component", label: "Component" },
  { value: "system", label: "System" },
  { value: "spec", label: "Spec" },
];

const ITEM_STATES = [
  { value: "standard", label: "Standard" },
  { value: "optional", label: "Optional" },
  { value: "selected", label: "Selected" },
  { value: "unselected", label: "Unselected" },
  { value: "model_expected", label: "Model Expected" },
];

const MAPPING_STATES = [
  { value: "unmapped", label: "Unmapped" },
  { value: "partially_mapped", label: "Partially Mapped" },
  { value: "mapped", label: "Mapped" },
  { value: "needs_review", label: "Needs Review" },
];

const SELECTION_MODES = [
  { value: "single", label: "Single" },
  { value: "multi", label: "Multi" },
];

const PROJECTION_KINDS = [
  { value: "system", label: "System" },
  { value: "asset_fact", label: "Configuration Fact" },
  { value: "resource", label: "Resource/Knowledge" },
  { value: "component", label: "Component" },
  { value: "playbook", label: "Playbook/Action" },
  { value: "none", label: "Do Not Project" },
];

const RESOURCE_ROLES = ["Manual", "Buyer Guide", "Warranty", "Spec Sheet", "Install Guide", "Web Page", "Other"];
const PROMOTABLE_SYSTEM_ITEM_TYPES = new Set(["system", "component", "equipment", "configuration_item", "choice", "option"]);

function activeItems(items = []) {
  return items.filter((item) => item.authority_state !== "retired" && item.metadata?.retired !== true);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function jsonText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function jsonTextOrEmpty(value) {
  const text = jsonText(value);
  return text === "{}" ? "" : text;
}

function parseJsonField(value, fallback = {}) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Value JSON must be valid JSON.");
  }
}

function linesToArray(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function itemStateValue(item) {
  return item?.applicability?.standard_state || item?.expected_value?.selection_state || item?.metadata?.selection_state || "standard";
}

function itemMappingValue(item) {
  return item?.metadata?.mapping_status || item?.applicability?.mapping_status || "unmapped";
}

function itemCode(item) {
  return item?.metadata?.oem_item_code || item?.metadata?.source_oem_code || item?.expected_value?.source_oem_code || item?.metadata?.oem_group_code || "";
}

function itemDescription(item) {
  return item?.metadata?.oem_description || item?.metadata?.description || item?.expected_value?.description || "";
}

function itemElementList(item, key) {
  const elements = item?.metadata?.downstream_elements || {};
  const value = elements[key] || item?.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function defaultProjectionKind(item, isGroup) {
  if (isGroup) return "system_group";
  const explicit = item?.metadata?.projection?.kind;
  if (explicit) return explicit;
  const mapping = itemMappingValue(item);
  if (!["mapped", "partially_mapped"].includes(mapping)) return "none";
  if (PROMOTABLE_SYSTEM_ITEM_TYPES.has(item?.item_type)) return "system";
  return "none";
}

function resourceUrl(resource) {
  return resource?.url || resource?.source_url || resource?.attachment_url || resource?.metadata?.url || resource?.metadata?.source_url || null;
}

function linkedTemplateItemIds(resource) {
  const metadata = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  const sourceContext = resource?.source_context && typeof resource.source_context === "object" ? resource.source_context : {};
  const aiMetadata = resource?.ai_metadata && typeof resource.ai_metadata === "object" ? resource.ai_metadata : {};
  const ids = [
    ...(Array.isArray(metadata.linked_template_item_ids) ? metadata.linked_template_item_ids : []),
    ...(Array.isArray(metadata.template_item_ids) ? metadata.template_item_ids : []),
    ...(Array.isArray(sourceContext.linked_template_item_ids) ? sourceContext.linked_template_item_ids : []),
    ...(Array.isArray(sourceContext.template_item_ids) ? sourceContext.template_item_ids : []),
    ...(Array.isArray(aiMetadata.linked_template_item_ids) ? aiMetadata.linked_template_item_ids : []),
    ...(Array.isArray(aiMetadata.template_item_ids) ? aiMetadata.template_item_ids : []),
  ];
  const singles = [
    metadata.template_item_id,
    metadata.linked_template_item_id,
    sourceContext.template_item_id,
    sourceContext.linked_template_item_id,
    aiMetadata.template_item_id,
    aiMetadata.linked_template_item_id,
  ];
  return Array.from(new Set([...ids, ...singles].filter(Boolean)));
}

function normalizeResourceRole(role) {
  const raw = String(role || "").trim();
  const lower = raw.toLowerCase().replace(/[_-]+/g, " ");
  if (["manual", "owner manual", "owners manual", "owner's manual"].includes(lower)) return "Manual";
  if (["buyer guide", "buyers guide", "buyer's guide", "brochure"].includes(lower)) return "Buyer Guide";
  if (lower === "warranty") return "Warranty";
  if (["spec sheet", "specification", "specifications"].includes(lower)) return "Spec Sheet";
  if (["install guide", "installation guide"].includes(lower)) return "Install Guide";
  if (["web page", "webpage", "website", "page"].includes(lower)) return "Web Page";
  return RESOURCE_ROLES.includes(raw) ? raw : "Other";
}

function modelItemResourceAiMetadata(role, item) {
  const normalizedRole = normalizeResourceRole(role);
  return {
    role: normalizedRole,
    authority: "official",
    privacy: "moves_with_asset",
    ai_scope: "systems",
    ai_context: ["Manual", "Buyer Guide", "Warranty", "Spec Sheet"].includes(normalizedRole) ? "primary" : "supporting",
    applies_to: "model_template_item",
    template_item_id: item?.id || null,
    linked_template_item_ids: item?.id ? [item.id] : [],
  };
}

function parseRapidChildLine(line) {
  const cleaned = String(line || "")
    .replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\]|☐|☑)\s*/, "")
    .trim();
  if (!cleaned) return null;

  const splitOn = cleaned.includes("\t") ? "\t" : cleaned.includes("|") ? "|" : null;
  if (splitOn) {
    const [first, ...rest] = cleaned.split(splitOn).map((part) => part.trim()).filter(Boolean);
    if (first && rest.length) {
      return { code: first, label: rest.join(" ") };
    }
  }

  const codeAndLabel = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{3,})\s{2,}(.+)$/);
  if (codeAndLabel) {
    return { code: codeAndLabel[1].trim(), label: codeAndLabel[2].trim() };
  }

  return { code: "", label: cleaned };
}

function ButtonChoice({ active, label, onPress }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChangeText, multiline = false, placeholder = "" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.textarea]}
        placeholderTextColor="#9aa5b1"
      />
    </View>
  );
}

function Section({ title, eyebrow, iconName, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {iconName ? (
          <View style={styles.sectionIcon}>
            <Ionicons name={iconName} size={18} color={colors.blue} />
          </View>
        ) : null}
        <View>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

export default function ActivatorTemplateItemEditorScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { templateKey, itemId, organizationId, workspaceId } = route.params || {};

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("definition");

  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("configuration_item");
  const [state, setState] = useState("standard");
  const [mappingStatus, setMappingStatus] = useState("unmapped");
  const [quantity, setQuantity] = useState("1");
  const [valueJsonText, setValueJsonText] = useState("");
  const [provenanceNote, setProvenanceNote] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [parentGroupId, setParentGroupId] = useState("");
  const [selectionMode, setSelectionMode] = useState("multi");
  const [projectionKind, setProjectionKind] = useState("none");
  const [projectionFactType, setProjectionFactType] = useState("");
  const [systemsText, setSystemsText] = useState("");
  const [resourcesText, setResourcesText] = useState("");
  const [playbooksText, setPlaybooksText] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrlText, setResourceUrlText] = useState("");
  const [resourceRole, setResourceRole] = useState("Other");
  const [templateItemAttachments, setTemplateItemAttachments] = useState([]);
  const [savingResource, setSavingResource] = useState(false);
  const [systemTemplateQuery, setSystemTemplateQuery] = useState("");
  const [systemTemplateResults, setSystemTemplateResults] = useState([]);
  const [systemTemplateLoading, setSystemTemplateLoading] = useState(false);
  const [systemTemplateSaving, setSystemTemplateSaving] = useState(false);
  const [systemTemplatePromoting, setSystemTemplatePromoting] = useState(false);
  const [rapidChildLines, setRapidChildLines] = useState("");
  const [rapidChildKind, setRapidChildKind] = useState("configuration_item");
  const [rapidChildState, setRapidChildState] = useState("optional");
  const [rapidChildMappingStatus, setRapidChildMappingStatus] = useState("unmapped");
  const [rapidChildSourceId, setRapidChildSourceId] = useState("");
  const [savingChildren, setSavingChildren] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getCatalogTemplateDetail({ templateKey });
      setDetail(next);
      if (next?.template?.id) {
        const placements = await listAttachmentsForTarget("model_template", next.template.id);
        setTemplateItemAttachments(placements || []);
      } else {
        setTemplateItemAttachments([]);
      }
    } catch (err) {
      setError(err?.message || "Could not load template item.");
      setTemplateItemAttachments([]);
    } finally {
      setLoading(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => activeItems(detail?.items || []), [detail?.items]);
  const item = useMemo(() => items.find((candidate) => candidate.id === itemId), [itemId, items]);
  const isGroup = item?.item_type === "configuration_group";
  const isSystemLike =
    !isGroup &&
    (kind === "system" ||
      projectionKind === "system" ||
      PROMOTABLE_SYSTEM_ITEM_TYPES.has(item?.item_type) ||
      item?.metadata?.projection?.kind === "system");
  const linkedSystemTemplateId = item?.system_template_id || item?.metadata?.system_template_id || null;
  const linkedSystemTemplate = useMemo(() => {
    if (!linkedSystemTemplateId) return null;
    return (
      systemTemplateResults.find((candidate) => candidate.id === linkedSystemTemplateId) || {
        id: linkedSystemTemplateId,
        name: item?.metadata?.system_template_name || "Linked System Template",
        canonical_key: item?.metadata?.system_template_key || null,
      }
    );
  }, [item?.metadata?.system_template_key, item?.metadata?.system_template_name, linkedSystemTemplateId, systemTemplateResults]);
  const parent = useMemo(() => (item?.parent_item_id ? items.find((candidate) => candidate.id === item.parent_item_id) : null), [item, items]);
  const children = useMemo(() => items.filter((candidate) => candidate.parent_item_id === itemId), [itemId, items]);
  const groups = useMemo(
    () => items.filter((candidate) => candidate.item_type === "configuration_group" && candidate.id !== itemId),
    [itemId, items]
  );
  const legacyResources = detail?.resources || [];
  const attachmentResources = useMemo(
    () => (templateItemAttachments || []).filter((resource) => linkedTemplateItemIds(resource).includes(itemId)),
    [itemId, templateItemAttachments]
  );
  const resources = useMemo(() => {
    const byKey = new Map();
    [...attachmentResources, ...legacyResources].forEach((resource) => {
      const key = resource?.attachment_id || resource?.id || resource?.url || resource?.source_url;
      if (key && !byKey.has(key)) byKey.set(key, resource);
    });
    return Array.from(byKey.values());
  }, [attachmentResources, legacyResources]);
  const linkedResources = useMemo(
    () => resources.filter((resource) => linkedTemplateItemIds(resource).includes(itemId) || resource.id === selectedResourceId),
    [itemId, resources, selectedResourceId]
  );

  useEffect(() => {
    if (!item) return;
    setLabel(item.label || "");
    setCode(itemCode(item));
    setDescription(itemDescription(item));
    setKind(isGroup ? "configuration_group" : item.item_type || "configuration_item");
    setState(itemStateValue(item));
    setMappingStatus(itemMappingValue(item));
    setQuantity(String(item.expected_value?.quantity || item.metadata?.quantity || "1"));
    setValueJsonText(jsonTextOrEmpty(item.expected_value?.value));
    setProvenanceNote(item.metadata?.provenance_note || "");
    setSelectedResourceId(item.source_resource_id || "");
    setParentGroupId(isGroup ? "" : item.parent_item_id || "");
    setSelectionMode(item.metadata?.selection_mode || "multi");
    setProjectionKind(defaultProjectionKind(item, isGroup));
    setProjectionFactType(item.metadata?.projection?.fact_type || "");
    setSystemsText(arrayToLines(itemElementList(item, "systems")));
    setResourcesText(arrayToLines(itemElementList(item, "resources")));
    setPlaybooksText(arrayToLines(itemElementList(item, "playbooks")));
    setRequirementsText(arrayToLines(itemElementList(item, "requirements")));
    setSystemTemplateQuery(item.label || "");
  }, [isGroup, item]);

  const searchSystemTemplates = useCallback(async (queryOverride = null) => {
    const query = queryOverride == null ? systemTemplateQuery : queryOverride;
    setSystemTemplateLoading(true);
    setError("");
    try {
      const results = await listSystemTemplates({ query, limit: 12 });
      setSystemTemplateResults(results || []);
    } catch (err) {
      setError(err?.message || "Could not search System Templates.");
      setSystemTemplateResults([]);
    } finally {
      setSystemTemplateLoading(false);
    }
  }, [systemTemplateQuery]);

  useEffect(() => {
    if (!item || !isSystemLike) return;
    searchSystemTemplates(item.label || "");
  }, [isSystemLike, item?.id]);

  const linkSystemTemplate = useCallback(async (systemTemplate) => {
    if (!item?.id || !systemTemplate?.id) return;
    setSystemTemplateSaving(true);
    setError("");
    setNotice("");
    try {
      await linkModelItemSystemTemplate({
        templateItemId: item.id,
        systemTemplateId: systemTemplate.id,
      });
      setNotice("Linked to canonical System Template. Model-specific applicability remains on this item.");
      await load();
      await searchSystemTemplates(systemTemplate.name || systemTemplateQuery);
    } catch (err) {
      setError(err?.message || "Could not link this System Template.");
    } finally {
      setSystemTemplateSaving(false);
    }
  }, [item?.id, load, searchSystemTemplates, systemTemplateQuery]);

  const unlinkSystemTemplate = useCallback(async () => {
    if (!item?.id) return;
    setSystemTemplateSaving(true);
    setError("");
    setNotice("");
    try {
      await unlinkModelItemSystemTemplate(item.id);
      setNotice("System Template link removed. The model item still works as unresolved model data.");
      await load();
    } catch (err) {
      setError(err?.message || "Could not unlink this System Template.");
    } finally {
      setSystemTemplateSaving(false);
    }
  }, [item?.id, load]);

  const promoteModelItemToLibrary = useCallback(async () => {
    if (!item?.id || !isSystemLike) return;
    setSystemTemplatePromoting(true);
    setError("");
    setNotice("");
    try {
      const result = await promoteModelItemToSystemTemplate({
        templateItemId: item.id,
        payload: {
          name: label.trim() || item.label,
          manufacturer: detail?.template?.manufacturer || null,
          system_category: parent?.label || item?.metadata?.projection?.group || null,
          description: description.trim() || itemDescription(item) || null,
          owner_org_id: organizationId || detail?.template?.organization_id || null,
          promote_resources: true,
          authority_state: "keepr_curated",
          metadata: {
            promotion_ui: "activator_template_item_editor",
            reusable_fields_selected: ["name", "manufacturer", "system_category", "description"],
            source_oem_code: code.trim() || itemCode(item) || null,
          },
        },
      });
      const promoted = result?.system_template || null;
      const count = result?.promoted_resource_count || 0;
      setNotice(
        `Promoted to ${promoted?.name || label || item.label}. ${count} reusable resource${
          count === 1 ? "" : "s"
        } referenced by the System Template. Model applicability stayed on this item.`
      );
      await load();
      await searchSystemTemplates(promoted?.name || label || item.label);
    } catch (err) {
      setError(err?.message || "Could not promote this model item to the System Library.");
    } finally {
      setSystemTemplatePromoting(false);
    }
  }, [
    code,
    description,
    detail?.template?.manufacturer,
    detail?.template?.organization_id,
    isSystemLike,
    item,
    label,
    load,
    organizationId,
    parent?.label,
    searchSystemTemplates,
  ]);

  const tabs = isGroup
    ? [
        ["definition", "Definition"],
        ["children", "Children"],
        ["projection", "Projection"],
        ["evidence", "Evidence"],
      ]
    : [
        ["definition", "Definition"],
        ["knowledge", "Knowledge"],
        ["resources", "Resources"],
        ["projection", "Projection"],
        ["evidence", "Evidence"],
      ];

  const save = useCallback(async () => {
    if (!item || !detail?.template?.id) return;
    const trimmed = label.trim();
    if (!trimmed) {
      Alert.alert("Missing label", "Add a label before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const parsedValue = parseJsonField(valueJsonText, undefined);
      const selectedParent = !isGroup && parentGroupId ? groups.find((group) => group.id === parentGroupId) : null;
      const nextMetadata = {
        ...(item.metadata || {}),
        oem_vocabulary_preserved: true,
        provenance_note: provenanceNote.trim() || null,
      };
      let nextExpectedValue = { ...(item.expected_value || {}) };
      let nextApplicability = { ...(item.applicability || {}) };

      if (isGroup) {
        nextExpectedValue = {
          ...nextExpectedValue,
          oem_group_name: trimmed,
          oem_group_code: code.trim() || null,
        };
        nextMetadata.oem_group_name = trimmed;
        nextMetadata.oem_group_code = code.trim() || null;
        nextMetadata.projection = {
          ...(nextMetadata.projection || {}),
          kind: "system_group",
          name: trimmed,
        };
      } else {
        nextExpectedValue = {
          ...nextExpectedValue,
          source_oem_code: code.trim() || null,
          description: description.trim() || null,
          quantity: Number(quantity) || 1,
          value: parsedValue,
          selection_state: state,
        };
        nextApplicability = {
          ...nextApplicability,
          standard_state: state,
          mapping_status: mappingStatus,
        };
        nextMetadata.oem_item_name = trimmed;
        nextMetadata.oem_item_code = code.trim() || null;
        nextMetadata.source_oem_code = code.trim() || null;
        nextMetadata.description = description.trim() || null;
        nextMetadata.oem_description = description.trim() || null;
        nextMetadata.mapping_status = mappingStatus;
        nextMetadata.selection_mode = selectionMode;
        nextMetadata.projection = {
          ...(nextMetadata.projection || {}),
          kind: projectionKind,
          name: trimmed,
          group: selectedParent?.label || parent?.label || null,
          quantity: Number(quantity) || 1,
          source_code: code.trim() || null,
          fact_type: projectionKind === "asset_fact" ? projectionFactType.trim() || null : null,
        };
        nextMetadata.downstream_elements = {
          ...(nextMetadata.downstream_elements || {}),
          systems: linesToArray(systemsText),
          resources: linesToArray(resourcesText),
          playbooks: linesToArray(playbooksText),
          requirements: linesToArray(requirementsText),
        };
      }

      await upsertCatalogTemplateItem({
        templateId: detail.template.id,
        itemType: isGroup ? "configuration_group" : kind,
        canonicalKey: item.canonical_key || `${isGroup ? "group" : "item"}.${slugify(trimmed)}`,
        label: trimmed,
        parentItemId: isGroup ? item.parent_item_id || null : parentGroupId || null,
        parentCanonicalKey: isGroup ? parent?.canonical_key || null : selectedParent?.canonical_key || null,
        expectedValue: nextExpectedValue,
        applicability: nextApplicability,
        authorityState: item.authority_state || "oem_published",
        sourceResourceId: selectedResourceId || null,
        metadata: nextMetadata,
        sortOrder: item.sort_order || 0,
      });
      setNotice("Saved. This definition is still model data, not a canonical boat system.");
      await load();
    } catch (err) {
      setError(err?.message || "Could not save this definition.");
    } finally {
      setSaving(false);
    }
  }, [
    code,
    description,
    detail?.template?.id,
    isGroup,
    item,
    kind,
    label,
    load,
    mappingStatus,
    parent,
    parentGroupId,
    groups,
    playbooksText,
    projectionFactType,
    projectionKind,
    provenanceNote,
    quantity,
    requirementsText,
    resourcesText,
    selectedResourceId,
    selectionMode,
    state,
    systemsText,
    valueJsonText,
  ]);

  const getTemplateEditorUserId = useCallback(async () => {
    if (!detail?.template?.id) throw new Error("Template is not loaded yet.");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error("Sign in is required to save template resources.");

    const { data: canManage, error: manageError } = await supabase.rpc("activator_user_can_manage_template", {
      p_user_id: userId,
      p_template_id: detail.template.id,
    });
    if (manageError) throw manageError;
    if (!canManage) throw new Error("This account can view the model, but cannot add resources to this OEM template.");
    return userId;
  }, [detail?.template?.id]);

  const itemResourceSourceContext = useCallback((role, contributionContext) => {
    const normalizedRole = normalizeResourceRole(role);
    const template = detail?.template || {};
    return {
      provenance: "model_template_item",
      provenance_label: `${template.manufacturer || "OEM"} ${normalizedRole}`,
      provenance_detail: "Reusable system/item knowledge attached to model DNA; exact KAC systems inherit this context without copying it.",
      contribution_context: contributionContext,
      contributor_role: "oem",
      contributed_by_org_role: "oem",
      organization_id: organizationId || template.organization_id || null,
      contributed_by_org_id: organizationId || template.organization_id || null,
      contributed_by_org_label: template.manufacturer || "OEM",
      provided_by_label: template.manufacturer || "OEM",
      authored_by_label: template.manufacturer || "OEM",
      source_name: `${template.manufacturer || "OEM"} ${item?.label || "model item"}`.trim(),
      template_id: template.id,
      template_key: template.template_key || templateKey,
      template_item_id: item?.id || null,
      template_item_label: item?.label || null,
      linked_template_item_ids: item?.id ? [item.id] : [],
      applies_to_type: "model_template_item",
      applies_to_id: item?.id || null,
      role: normalizedRole,
      not_exact_hull_evidence: true,
    };
  }, [detail?.template, item?.id, item?.label, organizationId, templateKey]);

  const addLinkedResource = useCallback(async () => {
    if (!item || !detail?.template?.id) return;
    const url = resourceUrlText.trim();
    const titleValue = resourceTitle.trim() || url;
    if (!titleValue) {
      Alert.alert("Missing resource", "Add a title or URL before saving this resource.");
      return;
    }
    setSavingResource(true);
    setError("");
    setNotice("");
    try {
      const userId = await getTemplateEditorUserId();
      const normalizedUrl = url && !/^https?:\/\//i.test(url) ? `https://${url}` : url || null;
      if (!normalizedUrl) throw new Error("Add a resource URL.");
      const role = normalizeResourceRole(resourceRole);
      const created = await createLinkAttachment({
        userId,
        assetId: null,
        url: normalizedUrl,
        title: titleValue,
        notes: `${role} for ${item.label}`,
        sourceContext: {
          ...itemResourceSourceContext(role, "oem_template_item_resource_link"),
          source_url: normalizedUrl,
        },
        placements: [
          {
            target_type: "model_template",
            target_id: detail.template.id,
            role,
            label: titleValue,
            is_showcase: false,
          },
        ],
      });
      if (created?.attachment?.id) {
        await supabase
          .from("attachments")
          .update({ ai_metadata: modelItemResourceAiMetadata(role, item) })
          .eq("id", created.attachment.id);
      }
      setResourceTitle("");
      setResourceUrlText("");
      setNotice("Attachment-backed resource linked to this model definition.");
      await load();
    } catch (err) {
      setError(err?.message || "Could not add this model resource.");
    } finally {
      setSavingResource(false);
    }
  }, [detail?.template, getTemplateEditorUserId, item, itemResourceSourceContext, load, resourceRole, resourceTitle, resourceUrlText]);

  const uploadLinkedResourceFile = useCallback(async () => {
    if (!item || !detail?.template?.id) return;
    setSavingResource(true);
    setError("");
    setNotice("");
    try {
      const userId = await getTemplateEditorUserId();
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;
      const role = normalizeResourceRole(resourceRole);
      const titleValue = resourceTitle.trim() || picked.name || `${role} for ${item.label}`;
      const created = await uploadAttachmentFromUri({
        userId,
        assetId: null,
        kind: "file",
        fileUri: picked.uri,
        fileName: picked.name || titleValue,
        mimeType: picked.mimeType || "application/octet-stream",
        sizeBytes: picked.size || null,
        title: titleValue,
        notes: `${role} for ${item.label}`,
        sourceContext: itemResourceSourceContext(role, "oem_template_item_resource_upload"),
        placements: [
          {
            target_type: "model_template",
            target_id: detail.template.id,
            role,
            label: titleValue,
            is_showcase: false,
          },
        ],
      });
      if (created?.attachment?.id) {
        await supabase
          .from("attachments")
          .update({ ai_metadata: modelItemResourceAiMetadata(role, item) })
          .eq("id", created.attachment.id);
      }
      setResourceTitle("");
      setResourceUrlText("");
      setNotice("Attachment-backed resource uploaded to this model definition.");
      await load();
    } catch (err) {
      setError(err?.message || "Could not upload this model resource.");
    } finally {
      setSavingResource(false);
    }
  }, [detail?.template?.id, getTemplateEditorUserId, item, itemResourceSourceContext, load, resourceRole, resourceTitle]);

  const openResourceProofBuilder = useCallback((resource) => {
    const attachmentId = resource?.attachment_id || resource?.id;
    if (!attachmentId || !resource?.placement_id || !detail?.template?.id) {
      Alert.alert("Proof Builder", "Only attachment-backed system/item resources can be edited in Proof Builder.");
      return;
    }
    navigation.navigate("ProofBuilder", {
      attachmentId,
      role: normalizeResourceRole(resource.role || resource.ai_metadata?.role),
      targetType: "model_template",
      targetId: detail.template.id,
      assetName: `${detail.template.manufacturer || "OEM"} ${detail.template.model || "model"}`.trim(),
      returnRoute: "ActivatorTemplateItemEditor",
      templateKey: detail.template.template_key || templateKey,
      itemId: item?.id || itemId,
      organizationId,
      workspaceId,
    });
  }, [detail?.template, item?.id, itemId, navigation, organizationId, templateKey, workspaceId]);

  const removeLinkedResourcePlacement = useCallback(async (resource) => {
    if (!resource?.placement_id) return;
    setSavingResource(true);
    setError("");
    setNotice("");
    try {
      await getTemplateEditorUserId();
      await removePlacementById(resource.placement_id);
      setNotice("Resource removed from this model definition.");
      await load();
    } catch (err) {
      setError(err?.message || "Could not remove this model resource.");
    } finally {
      setSavingResource(false);
    }
  }, [getTemplateEditorUserId, load]);

  const addRapidChildren = useCallback(async () => {
    if (!isGroup || !item || !detail?.template?.id) return;
    const parsedRows = linesToArray(rapidChildLines)
      .map(parseRapidChildLine)
      .filter((row) => row?.label);

    if (!parsedRows.length) {
      Alert.alert("No child rows", "Add one child per line as Item # | Item Description.");
      return;
    }

    setSavingChildren(true);
    setError("");
    setNotice("");
    try {
      const parentKey = item.canonical_key || `group.${slugify(item.label)}`;
      const baseSort = children.reduce((max, child) => Math.max(max, Number(child.sort_order) || 0), 0);
      const seenKeys = new Map();

      for (const [index, row] of parsedRows.entries()) {
        const keyPart = slugify(row.code || row.label) || `child.${index + 1}`;
        const seenCount = seenKeys.get(keyPart) || 0;
        seenKeys.set(keyPart, seenCount + 1);
        const canonicalKey = `${parentKey}.${keyPart}${seenCount ? `.${seenCount + 1}` : ""}`;
        const sourceResourceId = rapidChildSourceId || selectedResourceId || item.source_resource_id || null;

        await upsertCatalogTemplateItem({
          templateId: detail.template.id,
          itemType: rapidChildKind,
          canonicalKey,
          label: row.label,
          parentItemId: item.id,
          parentCanonicalKey: item.canonical_key || null,
          expectedValue: {
            source_oem_code: row.code || null,
            description: row.label,
            quantity: 1,
            selection_state: rapidChildState,
          },
          applicability: {
            standard_state: rapidChildState,
            mapping_status: rapidChildMappingStatus,
          },
          authorityState: "oem_published",
          sourceResourceId,
          metadata: {
            oem_vocabulary_preserved: true,
            oem_item_name: row.label,
            oem_item_code: row.code || null,
            source_oem_code: row.code || null,
            description: row.label,
            oem_description: row.label,
            mapping_status: rapidChildMappingStatus,
            rapid_child_entry: true,
            rapid_child_format: "item_number_item_description",
            parent_group_id: item.id,
            parent_group_label: item.label,
            provenance_note: row.code
              ? `Entered from source line ${row.code}. Enrich details later.`
              : "Entered from source line. Enrich details later.",
          },
          sortOrder: baseSort + (index + 1) * 10,
        });
      }

      setRapidChildLines("");
      setNotice(`Added ${parsedRows.length} child ${parsedRows.length === 1 ? "item" : "items"} to ${item.label}.`);
      await load();
    } catch (err) {
      setError(err?.message || "Could not add child items.");
    } finally {
      setSavingChildren(false);
    }
  }, [
    children,
    detail?.template?.id,
    isGroup,
    item,
    load,
    rapidChildKind,
    rapidChildLines,
    rapidChildMappingStatus,
    rapidChildSourceId,
    rapidChildState,
    selectedResourceId,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.muted}>Loading template definition...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Template item not found</Text>
          <Text style={styles.muted}>Return to the model structure and choose another group or item.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryButtonText}>Back to Model Structure</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <ActivatorBreadcrumb
          navigation={navigation}
          items={[
            { label: "Model Catalog", route: "ActivatorHome", params: { initialMode: "templates", navSection: "ActivatorTemplates", organizationId, workspaceId } },
            { label: detail?.template?.model || templateKey, route: "ActivatorCatalogTemplate", params: { templateKey, organizationId, workspaceId } },
            { label: "Configure", route: "ActivatorTemplateCustomize", params: { templateKey, organizationId, workspaceId } },
          ]}
          current={label || item.label}
        />

        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Ionicons name={isGroup ? "folder-outline" : "server-outline"} size={22} color={colors.blue} />
            <View>
              <Text style={styles.heroBadgeTitle}>{detail?.template?.manufacturer || "Model"} {detail?.template?.model || ""}</Text>
              <Text style={styles.heroBadgeSub}>Model definition editor</Text>
            </View>
          </View>
          <Text style={styles.kicker}>{isGroup ? "System Group Definition" : "System Definition"}</Text>
          <Text style={styles.heroTitle}>{label || item.label}</Text>
          <Text style={styles.heroCopy}>
            {isGroup
              ? "Organize reusable model configuration before it projects into exact hulls."
              : "Describe what this model item means, what knowledge supports it, and how it can project into a KAC."}
          </Text>
          <View style={styles.pills}>
            <Text style={styles.pill}>{item.item_type}</Text>
            <Text style={styles.pill}>{state}</Text>
            <Text style={styles.pill}>{mappingStatus}</Text>
          </View>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(([key, tabLabel]) => (
            <ButtonChoice key={key} label={tabLabel} active={tab === key} onPress={() => setTab(key)} />
          ))}
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tab === "definition" ? (
          <Section title="Definition" eyebrow="OEM vocabulary" iconName="layers-outline">
            <Field label={isGroup ? "OEM group label" : "OEM item label"} value={label} onChangeText={setLabel} />
            <Field label={isGroup ? "OEM group/source code" : "OEM/source code"} value={code} onChangeText={setCode} placeholder="Optional code" />
            {!isGroup ? (
              <>
                <Field label="OEM description / included text" value={description} onChangeText={setDescription} multiline />
                <Text style={styles.label}>Parent group</Text>
                <View style={styles.choiceWrap}>
                  <ButtonChoice label="No Group" active={!parentGroupId} onPress={() => setParentGroupId("")} />
                  {groups.map((group) => (
                    <ButtonChoice
                      key={group.id}
                      label={group.label || "Untitled group"}
                      active={parentGroupId === group.id}
                      onPress={() => setParentGroupId(group.id)}
                    />
                  ))}
                </View>
                {!groups.length ? (
                  <Text style={styles.helpText}>No groups yet. Add a group from the model structure screen, then return here to place this item.</Text>
                ) : (
                  <Text style={styles.helpText}>Moves this item in the reusable model outline. It does not create a canonical Keepr System Group until an exact KAC is published.</Text>
                )}
                <Text style={styles.label}>Item kind</Text>
                <View style={styles.choiceWrap}>
                  {ITEM_KINDS.filter((candidate) => candidate.value !== "configuration_group").map((candidate) => (
                    <ButtonChoice key={candidate.value} label={candidate.label} active={kind === candidate.value} onPress={() => setKind(candidate.value)} />
                  ))}
                </View>
                <Text style={styles.label}>State</Text>
                <View style={styles.choiceWrap}>
                  {ITEM_STATES.map((candidate) => (
                    <ButtonChoice key={candidate.value} label={candidate.label} active={state === candidate.value} onPress={() => setState(candidate.value)} />
                  ))}
                </View>
                <Field label="Quantity" value={quantity} onChangeText={setQuantity} />
                <Field label="Value JSON" value={valueJsonText} onChangeText={setValueJsonText} multiline />
              </>
            ) : null}
          </Section>
        ) : null}

        {tab === "children" && isGroup ? (
          <Section title="Children" eyebrow="Group contents" iconName="folder-outline">
            <View style={styles.rapidPanel}>
              <View style={styles.rapidHeader}>
                <View>
                  <Text style={styles.rapidTitle}>Rapid add from build sheet</Text>
                  <Text style={styles.helpText}>Paste one row per line as Item # | Item Description. You can enrich each child later.</Text>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, savingChildren && styles.disabledButton]}
                  onPress={addRapidChildren}
                  disabled={savingChildren}
                >
                  <Ionicons name="add-circle-outline" size={17} color={colors.blue} />
                  <Text style={styles.secondaryButtonText}>{savingChildren ? "Adding..." : "Add Children"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.rapidColumns}>
                <Text style={styles.rapidColumnLabel}>Item #</Text>
                <Text style={styles.rapidColumnLabel}>Item Description</Text>
              </View>
              <Field
                label="Line items"
                value={rapidChildLines}
                onChangeText={setRapidChildLines}
                multiline
                placeholder={"KFA275Q0039221 | Quad Mercury V12 600 HP\nKFA275Q0322420 | Seakeeper SK6 Gyro"}
              />
              <Text style={styles.label}>Default kind</Text>
              <View style={styles.choiceWrap}>
                {ITEM_KINDS.filter((candidate) => candidate.value !== "configuration_group" && candidate.value !== "spec").map((candidate) => (
                  <ButtonChoice key={candidate.value} label={candidate.label} active={rapidChildKind === candidate.value} onPress={() => setRapidChildKind(candidate.value)} />
                ))}
              </View>
              <Text style={styles.label}>Default state</Text>
              <View style={styles.choiceWrap}>
                {ITEM_STATES.map((candidate) => (
                  <ButtonChoice key={candidate.value} label={candidate.label} active={rapidChildState === candidate.value} onPress={() => setRapidChildState(candidate.value)} />
                ))}
              </View>
              <Text style={styles.label}>Default mapping</Text>
              <View style={styles.choiceWrap}>
                {MAPPING_STATES.map((candidate) => (
                  <ButtonChoice
                    key={candidate.value}
                    label={candidate.label}
                    active={rapidChildMappingStatus === candidate.value}
                    onPress={() => setRapidChildMappingStatus(candidate.value)}
                  />
                ))}
              </View>
              <Text style={styles.label}>Source/resource reference</Text>
              <View style={styles.choiceWrap}>
                <ButtonChoice label="No Source" active={!rapidChildSourceId} onPress={() => setRapidChildSourceId("")} />
                {legacyResources.map((resource) => (
                  <ButtonChoice
                    key={resource.id}
                    label={resource.title || resource.url || "Resource"}
                    active={rapidChildSourceId === resource.id}
                    onPress={() => setRapidChildSourceId(resource.id)}
                  />
                ))}
              </View>
            </View>

            {children.length ? (
              <View style={styles.childList}>
                {children.map((child) => (
                  <TouchableOpacity
                    key={child.id}
                    style={styles.childRow}
                    onPress={() =>
                      navigation.navigate("ActivatorTemplateItemEditor", {
                        templateKey,
                        itemId: child.id,
                        organizationId,
                        workspaceId,
                      })
                    }
                  >
                    <View style={styles.childCodeCell}>
                      <Text style={styles.childCode}>{itemCode(child) || "-"}</Text>
                      <Text style={styles.childCodeLabel}>Item #</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.childTitle}>{child.label}</Text>
                      <Text style={styles.childMeta}>{child.item_type} - {itemStateValue(child)} - {itemMappingValue(child)}</Text>
                    </View>
                    <Text style={styles.openText}>Open</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>No children yet. Add build-sheet rows above to start this group.</Text>
            )}
          </Section>
        ) : null}

        {tab === "knowledge" && !isGroup ? (
          <Section title="Knowledge" eyebrow="Reusable meaning" iconName="star-outline">
            {isSystemLike ? (
              <View style={styles.systemTemplatePanel}>
                <View style={styles.rapidHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Core System Template</Text>
                    <Text style={styles.helpText}>
                      Link reusable system truth here; keep Tiara/model applicability on this item.
                    </Text>
                  </View>
                  {linkedSystemTemplate ? (
                    <TouchableOpacity
                      style={[styles.tinyButton, systemTemplateSaving && styles.disabledButton]}
                      onPress={unlinkSystemTemplate}
                      disabled={systemTemplateSaving}
                    >
                      <Ionicons name="unlink-outline" size={14} color="#dc2626" />
                      <Text style={[styles.tinyButtonText, styles.dangerText]}>Unlink</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {linkedSystemTemplate ? (
                  <View style={styles.linkedResourceRow}>
                    <View style={styles.linkedResourceMain}>
                      <Ionicons name="hardware-chip-outline" size={18} color={colors.blue} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.childTitle}>{linkedSystemTemplate.name}</Text>
                        <Text style={styles.childMeta}>
                          {[
                            linkedSystemTemplate.manufacturer,
                            linkedSystemTemplate.system_category,
                            linkedSystemTemplate.canonical_key,
                          ].filter(Boolean).join(" - ") || "Canonical reusable system truth"}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.helpText}>No canonical System Template is linked yet.</Text>
                )}
                <View style={styles.promotePanel}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.childTitle}>Promote this model item to the System Library</Text>
                    <Text style={styles.helpText}>
                      Creates or updates one canonical System Template, links this item back, and promotes non-photo reusable resources by reference.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.secondaryButton, systemTemplatePromoting && styles.disabledButton]}
                    onPress={promoteModelItemToLibrary}
                    disabled={systemTemplatePromoting}
                  >
                    <Ionicons name="arrow-up-circle-outline" size={17} color={colors.blue} />
                    <Text style={styles.secondaryButtonText}>
                      {systemTemplatePromoting ? "Promoting..." : "Promote to Library"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1, minWidth: 260 }}>
                    <Field
                      label="Find System Template"
                      value={systemTemplateQuery}
                      onChangeText={setSystemTemplateQuery}
                      placeholder="Search Onan, Seakeeper, Mercury..."
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.secondaryButton, systemTemplateLoading && styles.disabledButton]}
                    onPress={() => searchSystemTemplates()}
                    disabled={systemTemplateLoading}
                  >
                    <Ionicons name="search-outline" size={17} color={colors.blue} />
                    <Text style={styles.secondaryButtonText}>{systemTemplateLoading ? "Searching..." : "Search"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => navigation.navigate("SystemLibrary", {
                      organizationId,
                      workspaceId,
                      systemTemplateId: linkedSystemTemplateId || undefined,
                      query: systemTemplateQuery || item?.label || "",
                    })}
                  >
                    <Ionicons name="library-outline" size={17} color={colors.blue} />
                    <Text style={styles.secondaryButtonText}>Open Library</Text>
                  </TouchableOpacity>
                </View>
                {systemTemplateResults.length ? (
                  <View style={styles.linkedResourceList}>
                    {systemTemplateResults.map((candidate) => {
                      const alreadyLinked = candidate.id === linkedSystemTemplateId;
                      return (
                        <View key={candidate.id} style={styles.linkedResourceRow}>
                          <View style={styles.linkedResourceMain}>
                            <Ionicons name="hardware-chip-outline" size={18} color={colors.blue} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.childTitle}>{candidate.name}</Text>
                              <Text style={styles.childMeta}>
                                {[
                                  candidate.manufacturer,
                                  candidate.system_category,
                                  `${candidate.resource_count || 0} reusable resources`,
                                ].filter(Boolean).join(" - ")}
                              </Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={[styles.tinyButton, (alreadyLinked || systemTemplateSaving) && styles.disabledButton]}
                            onPress={() => linkSystemTemplate(candidate)}
                            disabled={alreadyLinked || systemTemplateSaving}
                          >
                            <Ionicons name={alreadyLinked ? "checkmark-circle-outline" : "link-outline"} size={14} color={colors.blue} />
                            <Text style={styles.tinyButtonText}>{alreadyLinked ? "Linked" : "Link"}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.label}>Selection mode</Text>
            <View style={styles.choiceWrap}>
              {SELECTION_MODES.map((candidate) => (
                <ButtonChoice key={candidate.value} label={candidate.label} active={selectionMode === candidate.value} onPress={() => setSelectionMode(candidate.value)} />
              ))}
            </View>
            <Field label="Systems/components created" value={systemsText} onChangeText={setSystemsText} multiline />
            <Field label="Resources/manuals needed" value={resourcesText} onChangeText={setResourcesText} multiline />
            <Field label="Playbooks/actions" value={playbooksText} onChangeText={setPlaybooksText} multiline />
            <Field label="Verification fields" value={requirementsText} onChangeText={setRequirementsText} multiline />
          </Section>
        ) : null}

        {tab === "resources" && !isGroup ? (
          <Section title="Resources" eyebrow="Source package" iconName="document-text-outline">
            {linkedResources.length ? (
              <View style={styles.linkedResourceList}>
                {linkedResources.map((resource) => (
                  <View key={resource.placement_id || resource.id} style={styles.linkedResourceRow}>
                    <TouchableOpacity
                      style={styles.linkedResourceMain}
                      activeOpacity={resourceUrl(resource) ? 0.86 : 1}
                      onPress={() => {
                        const url = resourceUrl(resource);
                        if (url) Linking.openURL(url);
                      }}
                    >
                      <Ionicons name="document-text-outline" size={18} color={colors.blue} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.childTitle}>{resource.title || "Reusable resource"}</Text>
                        <Text style={styles.childMeta}>
                          {resource.placement_id ? "Attachment-backed model item resource" : "Legacy model resource"} - inherited by matching exact KAC systems
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {resource.placement_id ? (
                      <View style={styles.resourceActions}>
                        <TouchableOpacity style={styles.tinyButton} onPress={() => openResourceProofBuilder(resource)}>
                          <Ionicons name="document-text-outline" size={14} color={colors.blue} />
                          <Text style={styles.tinyButtonText}>Proof</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.tinyButton} onPress={() => removeLinkedResourcePlacement(resource)}>
                          <Ionicons name="remove-circle-outline" size={14} color="#dc2626" />
                          <Text style={[styles.tinyButtonText, styles.dangerText]}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helpText}>No reusable resources are linked to this definition yet.</Text>
            )}
            <Text style={styles.label}>Resource role</Text>
            <View style={styles.choiceWrap}>
              {RESOURCE_ROLES.map((candidate) => (
                <ButtonChoice
                  key={candidate}
                  label={candidate}
                  active={resourceRole === candidate}
                  onPress={() => setResourceRole(candidate)}
                />
              ))}
            </View>
            <Field label="Add resource title" value={resourceTitle} onChangeText={setResourceTitle} placeholder="e.g., Mercury V12 600 owner's manual" />
            <Field label="Add resource URL" value={resourceUrlText} onChangeText={setResourceUrlText} placeholder="https://..." />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.secondaryButton, savingResource && styles.disabledButton]} onPress={addLinkedResource} disabled={savingResource}>
                <Ionicons name="link-outline" size={17} color={colors.blue} />
                <Text style={styles.secondaryButtonText}>{savingResource ? "Saving..." : "Add resource link"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryButton, savingResource && styles.disabledButton]} onPress={uploadLinkedResourceFile} disabled={savingResource}>
                <Ionicons name="cloud-upload-outline" size={17} color={colors.blue} />
                <Text style={styles.secondaryButtonText}>{savingResource ? "Saving..." : "Add resource file"}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Source/resource reference</Text>
            <View style={styles.choiceWrap}>
              <ButtonChoice label="No Source" active={!selectedResourceId} onPress={() => setSelectedResourceId("")} />
              {legacyResources.map((resource) => (
                <ButtonChoice
                  key={resource.id}
                  label={resource.title || resource.url || "Resource"}
                  active={selectedResourceId === resource.id}
                  onPress={() => setSelectedResourceId(resource.id)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {tab === "projection" ? (
          <Section title="Projection" eyebrow="Future KAC behavior" iconName="shield-checkmark-outline">
            {!isGroup ? (
              <>
                <Text style={styles.label}>Mapping status</Text>
                <View style={styles.choiceWrap}>
                  {MAPPING_STATES.map((candidate) => (
                    <ButtonChoice key={candidate.value} label={candidate.label} active={mappingStatus === candidate.value} onPress={() => setMappingStatus(candidate.value)} />
                  ))}
                </View>
                <Text style={styles.label}>Projection destination</Text>
                <View style={styles.choiceWrap}>
                  {PROJECTION_KINDS.map((candidate) => (
                    <ButtonChoice key={candidate.value} label={candidate.label} active={projectionKind === candidate.value} onPress={() => setProjectionKind(candidate.value)} />
                  ))}
                </View>
                {projectionKind === "asset_fact" ? (
                  <Field label="Fact type" value={projectionFactType} onChangeText={setProjectionFactType} placeholder="e.g., interior_finish" />
                ) : null}
              </>
            ) : null}
            <Text style={styles.helpText}>
              {isGroup
                ? "This group can later project to a canonical System Group on an exact KAC."
                : "This item can later project to a canonical System, component, installed instance, fact, resource requirement, or action. Unmapped Level-1 OEM truth is still valid."}
            </Text>
          </Section>
        ) : null}

        {tab === "evidence" ? (
          <Section title="Evidence" eyebrow="Provenance" iconName="link-outline">
            <Field label="Provenance note" value={provenanceNote} onChangeText={setProvenanceNote} multiline />
            {isGroup ? (
              <>
                <Text style={styles.label}>Source/resource reference</Text>
                <View style={styles.choiceWrap}>
                  <ButtonChoice label="No Source" active={!selectedResourceId} onPress={() => setSelectedResourceId("")} />
                  {legacyResources.map((resource) => (
                    <ButtonChoice
                      key={resource.id}
                      label={resource.title || resource.url || "Resource"}
                      active={selectedResourceId === resource.id}
                      onPress={() => setSelectedResourceId(resource.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </Section>
        ) : null}

        <View style={styles.saveBar}>
          <TouchableOpacity style={[styles.primaryButton, saving && styles.disabledButton]} onPress={save} disabled={saving}>
            <Ionicons name="save-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Save Definition"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  page: { padding: 18, gap: 14, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  hero: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    padding: 24,
    gap: 12,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderRadius: 8,
    padding: 10,
  },
  heroBadgeTitle: { color: colors.ink, fontWeight: "900", fontSize: 16 },
  heroBadgeSub: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  kicker: { color: "#93c5fd", fontWeight: "900", textTransform: "uppercase", letterSpacing: 0, fontSize: 12 },
  heroTitle: { color: "#fff", fontWeight: "900", fontSize: 34 },
  heroCopy: { color: "#e5e7eb", fontWeight: "700", maxWidth: 760, lineHeight: 22 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { backgroundColor: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "rgba(255,255,255,0.25)", borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontWeight: "800" },
  tabBar: { flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: colors.panel, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 10 },
  section: { backgroundColor: colors.panel, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.lightBlue, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: colors.blue, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0, fontSize: 12 },
  sectionTitle: { color: colors.ink, fontWeight: "900", fontSize: 22 },
  title: { color: colors.ink, fontWeight: "900", fontSize: 24 },
  muted: { color: colors.muted, fontWeight: "700" },
  label: { color: "#3b4655", fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0 },
  field: { gap: 6 },
  input: { minHeight: 46, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, color: colors.ink, fontSize: 15 },
  textarea: { minHeight: 108, paddingTop: 12 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fff" },
  choiceActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  choiceText: { color: "#334155", fontWeight: "900", fontSize: 12 },
  choiceTextActive: { color: "#fff" },
  helpText: { color: colors.muted, fontWeight: "700", lineHeight: 22 },
  notice: { color: colors.greenInk, backgroundColor: colors.green, borderRadius: 8, padding: 10, fontWeight: "800" },
  error: { color: "#991b1b", backgroundColor: "#fee2e2", borderRadius: 8, padding: 10, fontWeight: "800" },
  rapidPanel: { borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, backgroundColor: "#f8fbff", padding: 14, gap: 12 },
  systemTemplatePanel: { borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, backgroundColor: "#f8fbff", padding: 14, gap: 12 },
  rapidHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  rapidTitle: { color: colors.ink, fontWeight: "900", fontSize: 18 },
  rapidColumns: { flexDirection: "row", gap: 10, paddingHorizontal: 2 },
  rapidColumnLabel: { flex: 1, color: colors.blue, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  childList: { gap: 8 },
  childRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: "#fbfdff" },
  childCodeCell: { width: 170, borderRightWidth: 1, borderRightColor: colors.border, paddingRight: 12 },
  childCode: { color: colors.ink, fontWeight: "900", fontSize: 13 },
  childCodeLabel: { color: colors.muted, fontWeight: "900", fontSize: 10, textTransform: "uppercase", marginTop: 4 },
  linkedResourceList: { gap: 8 },
  linkedResourceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: "#fbfdff" },
  linkedResourceMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  promotePanel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, padding: 12, backgroundColor: "#eff6ff" },
  resourceActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tinyButton: { minHeight: 30, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5, backgroundColor: "#fff" },
  tinyButtonText: { color: colors.blue, fontWeight: "900", fontSize: 12 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  dangerText: { color: "#dc2626" },
  childTitle: { color: colors.ink, fontWeight: "900", fontSize: 16 },
  childMeta: { color: colors.muted, fontWeight: "700", marginTop: 4 },
  openText: { color: colors.blue, fontWeight: "900" },
  saveBar: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  primaryButton: { minHeight: 46, borderRadius: 8, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 16 },
  primaryButtonText: { color: "#fff", fontWeight: "900" },
  secondaryButton: { minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  secondaryButtonText: { color: colors.blue, fontWeight: "900" },
  disabledButton: { opacity: 0.55 },
});
