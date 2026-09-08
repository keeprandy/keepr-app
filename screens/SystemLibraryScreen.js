import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { createLinkAttachment } from "../lib/attachmentsUploader";
import { listAttachmentsForTarget, removePlacementById } from "../lib/attachmentsApi";
import { getCatalogTemplates, getSystemTemplate, listSupplierNetwork, listSystemTemplates, linkModelItemSystemTemplate, upsertCatalogTemplateItem, upsertSystemTemplate } from "../lib/activatorApi";
import { searchKeeprSpaceOrganizations, upsertKeeprSpaceOrgRelationship } from "../lib/keeprspaceApi";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

const AUTHORITY_STATES = [
  { key: "draft", label: "Draft" },
  { key: "keepr_curated", label: "Keepr Curated" },
  { key: "supplier_verified", label: "Supplier Verified" },
  { key: "oem_verified", label: "OEM Verified" },
  { key: "official", label: "Official" },
];

const RESOURCE_ROLES = ["manual", "warranty", "spec_sheet", "install_guide", "support_link", "proof_expectation"];
const APPLY_STATES = ["standard", "optional", "model_expected"];
const EMPTY_RESOURCE_DRAFT = {
  title: "",
  url: "",
  role: "manual",
  placeOnSystemTemplate: true,
  placeOnSupplier: false,
  placeOnOem: false,
};

const EMPTY_DRAFT = {
  id: null,
  name: "",
  manufacturer: "",
  supplierOrgId: null,
  canonicalKey: "",
  systemCategory: "",
  description: "",
  authorityState: "draft",
  reusableSpecs: "",
  warrantyGuidance: "",
  ownershipTasks: "",
  playbooks: "",
  proofExpectations: "",
};

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalKeyFor({ manufacturer, name }) {
  return `system_template.${slugify(manufacturer) || "generic"}.${slugify(name) || "system"}`;
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

function metadataFromDraft(draft) {
  return {
    ...(draft.metadata || {}),
    reusable_specs_text: draft.reusableSpecs || "",
    warranty_guidance: draft.warrantyGuidance || "",
    ownership_tasks: linesToArray(draft.ownershipTasks),
    playbooks: linesToArray(draft.playbooks),
    proof_expectations: linesToArray(draft.proofExpectations),
    ontology: {
      system_template: "reusable truth",
      asset_model_template_item: "model-specific applicability",
      system_instance: "exact truth",
    },
  };
}

function draftFromTemplate(template) {
  const metadata = template?.metadata || {};
  return {
    id: template?.id || null,
    name: template?.name || "",
    manufacturer: template?.manufacturer || "",
    supplierOrgId: template?.supplier_org_id || null,
    canonicalKey: template?.canonical_key || canonicalKeyFor(template || {}),
    systemCategory: template?.system_category || "",
    description: template?.description || "",
    authorityState: template?.authority_state || "draft",
    ownerOrgId: template?.owner_org_id || null,
    metadata,
    reusableSpecs: metadata.reusable_specs_text || "",
    warrantyGuidance: metadata.warranty_guidance || "",
    ownershipTasks: arrayToLines(metadata.ownership_tasks),
    playbooks: arrayToLines(metadata.playbooks),
    proofExpectations: arrayToLines(metadata.proof_expectations),
  };
}

function Field({ label, value, onChangeText, placeholder, multiline = false }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        style={[styles.input, multiline && styles.textArea]}
      />
    </View>
  );
}

function Chip({ active, label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function OwnershipChoice({ activeOrgId, ownerOrgId, onChange }) {
  return (
    <View style={styles.ownerChoice}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>System Template owner</Text>
        <Text style={styles.panelHint}>
          Shared or supplier-owned systems can be reused across OEMs. OEM-owned systems stay specific to that organization's standard build.
        </Text>
      </View>
      <View style={styles.chipRow}>
        <Chip active={!ownerOrgId} label="Shared / supplier" onPress={() => onChange(null)} />
        {activeOrgId ? <Chip active={ownerOrgId === activeOrgId} label="Active OEM" onPress={() => onChange(activeOrgId)} /> : null}
      </View>
    </View>
  );
}

function ResourceRow({ resource, onRemove }) {
  const title = resource?.title || resource?.label || resource?.url || resource?.file_name || "Resource";
  const targetLabel = resource?.target_label || resource?.target_type?.replace(/_/g, " ") || "Resource";
  return (
    <View style={styles.resourceRow}>
      <TouchableOpacity
        style={styles.resourceMain}
        activeOpacity={0.82}
        onPress={() => resource?.url && Linking.openURL(resource.url)}
        disabled={!resource?.url}
      >
        <Ionicons name="document-text-outline" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.resourceTitle}>{title}</Text>
          <Text style={styles.resourceMeta}>{[targetLabel, resource?.role, resource?.url].filter(Boolean).join(" - ") || "System Template resource"}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconButton} onPress={onRemove}>
        <Ionicons name="trash-outline" size={16} color="#dc2626" />
      </TouchableOpacity>
    </View>
  );
}

export default function SystemLibraryScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const organizationId = route?.params?.organizationId || null;
  const initialSystemTemplateId = route?.params?.systemTemplateId || null;
  const [query, setQuery] = useState(route?.params?.query || "");
  const [templates, setTemplates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, ownerOrgId: null });
  const [resources, setResources] = useState([]);
  const [resourceDraft, setResourceDraft] = useState(EMPTY_RESOURCE_DRAFT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierMatches, setSupplierMatches] = useState([]);
  const [supplierLookupLoading, setSupplierLookupLoading] = useState(false);
  const [supplierConnectSaving, setSupplierConnectSaving] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [catalogTemplates, setCatalogTemplates] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCatalogTemplateId, setSelectedCatalogTemplateId] = useState(null);
  const [applyState, setApplyState] = useState("optional");
  const [applyLabel, setApplyLabel] = useState("");
  const [applySaving, setApplySaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async (queryOverride = query) => {
    setLoading(true);
    setError("");
    try {
      const rows = await listSystemTemplates({ query: queryOverride, limit: 50, organizationId, scope: organizationId ? "owned" : "all" });
      setTemplates(rows || []);
    } catch (err) {
      setError(err?.message || "Could not load System Library.");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, query]);

  const loadResources = useCallback(async ({ templateId, supplierOrgId = null, activeOrgId = organizationId } = {}) => {
    if (!templateId) {
      setResources([]);
      return;
    }
    try {
      const targetRequests = [
        ["system_template", templateId, "System Template"],
        supplierOrgId ? ["org", supplierOrgId, "Supplier KB"] : null,
        activeOrgId ? ["org", activeOrgId, "OEM KB"] : null,
      ].filter(Boolean);
      const nested = await Promise.all(
        targetRequests.map(async ([targetType, targetId, targetLabel]) => {
          const rows = await listAttachmentsForTarget(targetType, targetId);
          return rows.map((row) => ({ ...row, target_label: targetLabel }));
        })
      );
      setResources(nested.flat());
    } catch (err) {
      setError(err?.message || "Could not load reusable resources.");
      setResources([]);
    }
  }, [organizationId]);

  const selectTemplate = useCallback(async (template) => {
    setSelected(template);
    setNotice("");
    setError("");
    const next = template?.id ? await getSystemTemplate(template.id) : template;
    const fullTemplate = next || template;
    setDraft(draftFromTemplate(fullTemplate));
    await loadResources({
      templateId: fullTemplate?.id,
      supplierOrgId: fullTemplate?.supplier_org_id || null,
      activeOrgId: organizationId,
    });
  }, [loadResources]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    let active = true;
    async function loadSuppliers() {
      if (!organizationId) {
        setSuppliers([]);
        return;
      }
      try {
        const result = await listSupplierNetwork({ organizationId, limit: 50 });
        if (active) setSuppliers(result?.suppliers || []);
      } catch (err) {
        if (active) setSuppliers([]);
      }
    }
    loadSuppliers();
    return () => {
      active = false;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!initialSystemTemplateId) return;
    let active = true;
    async function loadInitial() {
      try {
        const template = await getSystemTemplate(initialSystemTemplateId);
        if (active && template) await selectTemplate(template);
      } catch (err) {
        if (active) setError(err?.message || "Could not open System Template.");
      }
    }
    loadInitial();
    return () => {
      active = false;
    };
  }, [initialSystemTemplateId, selectTemplate]);

  const selectedId = selected?.id || draft.id || null;
  const canSave = draft.name.trim() && draft.canonicalKey.trim();
  const visibleTemplates = useMemo(() => templates || [], [templates]);
  const selectedSupplier = suppliers.find((supplier) => supplier.organization_id === draft.supplierOrgId) || null;
  const selectedCatalogTemplate = catalogTemplates.find((template) => template.id === selectedCatalogTemplateId) || null;

  const refreshSuppliers = useCallback(async () => {
    if (!organizationId) {
      setSuppliers([]);
      return [];
    }
    const result = await listSupplierNetwork({ organizationId, limit: 50 });
    const rows = result?.suppliers || [];
    setSuppliers(rows);
    return rows;
  }, [organizationId]);

  const updateDraft = (key, value) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if ((key === "name" || key === "manufacturer") && !current.id) {
        next.canonicalKey = canonicalKeyFor(next);
      }
      return next;
    });
  };

  const startNew = () => {
    setSelected(null);
    setResources([]);
    setNotice("");
    setError("");
    setResourceDraft({ ...EMPTY_RESOURCE_DRAFT });
    setDraft({ ...EMPTY_DRAFT, ownerOrgId: null, canonicalKey: canonicalKeyFor({}) });
  };

  const openSupplierNetwork = () => {
    navigation.navigate("ActivatorHome", {
      initialMode: "connect",
      navSection: "ActivatorSuppliers",
      organizationId,
      workspaceId: organizationId ? `org:${organizationId}` : null,
    });
  };

  const searchSuppliers = async () => {
    const term = supplierQuery.trim();
    if (!term) {
      setSupplierMatches([]);
      return;
    }
    setSupplierLookupLoading(true);
    setError("");
    try {
      const result = await searchKeeprSpaceOrganizations(term, {});
      setSupplierMatches(result?.organizations || []);
    } catch (err) {
      setError(err?.message || "Could not search organizations.");
      setSupplierMatches([]);
    } finally {
      setSupplierLookupLoading(false);
    }
  };

  const connectSupplierOrganization = async (match = null) => {
    const supplierName = match?.display_name || match?.name || supplierQuery.trim();
    if (!organizationId || !supplierName) {
      Alert.alert("Supplier required", "Search for or enter a supplier Organization first.");
      return;
    }
    setSupplierConnectSaving(true);
    setError("");
    try {
      await upsertKeeprSpaceOrgRelationship({
        fromOrgId: organizationId,
        toOrgId: match?.organization_id || match?.id || null,
        toOrgName: supplierName,
        relationshipType: "supplier",
        payload: {
          relationship_type: "supplier",
          status: "source_reported",
          authority_state: "public_source_reported",
          evidence_state: "org_reported",
          source_name: "System Library supplier picker",
          metadata: {
            supplier_v1: true,
            relationship_basis: "system_library_supplier_picker",
          },
        },
      });
      const rows = await refreshSuppliers();
      const connected =
        rows.find((supplier) => supplier.organization_id === (match?.organization_id || match?.id)) ||
        rows.find((supplier) => supplier.name?.toLowerCase?.() === supplierName.toLowerCase()) ||
        rows.find((supplier) => supplier.name?.toLowerCase?.().includes(supplierName.toLowerCase())) ||
        null;
      setDraft((current) => ({
        ...current,
        supplierOrgId: connected?.organization_id || current.supplierOrgId,
        manufacturer: current.manufacturer.trim() ? current.manufacturer : supplierName,
      }));
      setSupplierQuery("");
      setSupplierMatches([]);
      setNotice(`Connected ${supplierName} as a supplier.`);
    } catch (err) {
      setError(err?.message || "Could not connect supplier Organization.");
    } finally {
      setSupplierConnectSaving(false);
    }
  };

  const openApplyModal = async () => {
    if (!selectedId) {
      Alert.alert("Save first", "Save the System Template before applying it to a model.");
      return;
    }
    setApplyModalOpen(true);
    setApplyLabel(draft.name || "");
    setCatalogLoading(true);
    setError("");
    try {
      const rows = await getCatalogTemplates(organizationId);
      setCatalogTemplates(rows || []);
      setSelectedCatalogTemplateId((current) => current || rows?.[0]?.id || null);
    } catch (err) {
      setError(err?.message || "Could not load model templates.");
      setCatalogTemplates([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  const applySystemTemplateToModel = async () => {
    if (!selectedId || !selectedCatalogTemplate?.id) {
      Alert.alert("Choose model", "Choose a model template before applying this reusable system.");
      return;
    }
    const label = applyLabel.trim() || draft.name.trim();
    if (!label) {
      Alert.alert("Label required", "Add the model-facing system label.");
      return;
    }
    setApplySaving(true);
    setError("");
    setNotice("");
    try {
      const section = await upsertCatalogTemplateItem({
        templateId: selectedCatalogTemplate.id,
        itemType: "section",
        canonicalKey: "section.configuration",
        label: "Configuration",
        expectedValue: {},
        applicability: { standard_state: "model_expected" },
        metadata: {
          source: "system_library_apply",
          purpose: "source_backed_oem_configuration",
        },
        sortOrder: 30,
      });
      const groupKey = `configuration_group.${slugify(draft.systemCategory || draft.manufacturer || "systems")}`;
      const group = await upsertCatalogTemplateItem({
        templateId: selectedCatalogTemplate.id,
        itemType: "configuration_group",
        canonicalKey: groupKey,
        label: draft.systemCategory || draft.manufacturer || "Systems",
        parentItemId: section?.item?.id || null,
        expectedValue: {
          oem_group_name: draft.systemCategory || draft.manufacturer || "Systems",
        },
        applicability: { standard_state: "model_expected" },
        metadata: {
          source: "system_library_apply",
          oem_group_name: draft.systemCategory || draft.manufacturer || "Systems",
          oem_vocabulary_preserved: true,
        },
        sortOrder: 31,
      });
      const itemKey = `system.${slugify(draft.canonicalKey || draft.name)}`;
      const result = await upsertCatalogTemplateItem({
        templateId: selectedCatalogTemplate.id,
        itemType: "system",
        canonicalKey: itemKey,
        label,
        parentItemId: group?.item?.id || null,
        expectedValue: {
          description: draft.description || null,
          quantity: 1,
          selection_state: applyState,
        },
        applicability: {
          standard_state: applyState,
          mapping_status: "mapped",
        },
        metadata: {
          source: "system_library_apply",
          projection: {
            kind: "system",
            source: "system_library_apply",
            system_template_id: selectedId,
            system_template_key: draft.canonicalKey,
            system_template_name: draft.name,
            system_template_manufacturer: draft.manufacturer || null,
            system_template_category: draft.systemCategory || null,
          },
          system_template_id: selectedId,
          system_template_key: draft.canonicalKey,
          system_template_name: draft.name,
          system_template_reference_source: "system_library_apply",
          inherits_system_template_intelligence: true,
          inherited_intelligence: {
            supplier: !!draft.supplierOrgId,
            resources: true,
            playbooks: true,
            proof_expectations: true,
            keeprlink_context: true,
          },
          oem_item_name: label,
          oem_description: draft.description || null,
          mapping_status: "mapped",
          downstream_elements: {
            systems: [draft.name].filter(Boolean),
            resources: [],
            playbooks: linesToArray(draft.playbooks),
            requirements: linesToArray(draft.proofExpectations),
          },
          systems: [draft.name].filter(Boolean),
          playbooks: linesToArray(draft.playbooks),
          requirements: linesToArray(draft.proofExpectations),
          oem_vocabulary_preserved: true,
        },
        sortOrder: 40,
      });
      if (result?.item?.id) {
        await linkModelItemSystemTemplate({
          templateItemId: result.item.id,
          systemTemplateId: selectedId,
        });
      }
      setApplyModalOpen(false);
      setNotice(`Applied ${draft.name} to ${selectedCatalogTemplate.model || selectedCatalogTemplate.template_name || selectedCatalogTemplate.template_key}.`);
    } catch (err) {
      setError(err?.message || "Could not apply this System Template to the model.");
    } finally {
      setApplySaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await upsertSystemTemplate({
        id: draft.id,
        name: draft.name.trim(),
        canonicalKey: draft.canonicalKey.trim(),
        manufacturer: draft.manufacturer.trim(),
        supplierOrgId: draft.supplierOrgId || null,
        ownerOrgId: draft.ownerOrgId || null,
        systemCategory: draft.systemCategory.trim(),
        description: draft.description.trim(),
        authorityState: draft.authorityState,
        metadata: metadataFromDraft(draft),
      });
      setSelected(saved);
      setDraft(draftFromTemplate(saved));
      setNotice("System Template saved. Reusable truth remains separate from applicability and exact installed evidence.");
      await loadList(query);
      await loadResources({ templateId: saved.id, supplierOrgId: saved.supplier_org_id || null, activeOrgId: organizationId });
    } catch (err) {
      setError(err?.message || "Could not save System Template.");
    } finally {
      setSaving(false);
    }
  };

  const addResource = async () => {
    if (!selectedId) {
      Alert.alert("Save first", "Save the System Template before adding reusable resources.");
      return;
    }
    if (!resourceDraft.url.trim()) {
      Alert.alert("Resource URL required", "Add a manual, spec, warranty, or support URL.");
      return;
    }
    const placementTargets = [
      resourceDraft.placeOnSystemTemplate ? {
        target_type: "system_template",
        target_id: selectedId,
        target_label: "System Template",
      } : null,
      resourceDraft.placeOnSupplier && draft.supplierOrgId ? {
        target_type: "org",
        target_id: draft.supplierOrgId,
        target_label: "Supplier KB",
      } : null,
      resourceDraft.placeOnOem && organizationId ? {
        target_type: "org",
        target_id: organizationId,
        target_label: "OEM KB",
      } : null,
    ].filter(Boolean);
    if (!placementTargets.length) {
      Alert.alert("Choose placement", "Choose at least one place for this resource.");
      return;
    }
    setResourceSaving(true);
    setError("");
    try {
      const { data: userResult } = await supabase.auth.getUser();
      const userId = userResult?.user?.id;
      await createLinkAttachment({
        userId,
        url: resourceDraft.url.trim(),
        title: resourceDraft.title.trim() || resourceDraft.url.trim(),
        sourceContext: {
          provenance: "system_template",
          provenance_label: "System Template resource",
          system_template_id: selectedId,
          system_template_name: draft.name,
          supplier_org_id: draft.supplierOrgId || null,
          supplier_name: selectedSupplier?.name || draft.manufacturer || null,
          organization_id: organizationId || null,
          placement_targets: placementTargets.map((target) => ({
            target_type: target.target_type,
            target_id: target.target_id,
            target_label: target.target_label,
          })),
        },
        placements: placementTargets.map((target) => ({
          target_type: target.target_type,
          target_id: target.target_id,
          role: resourceDraft.role,
          label: resourceDraft.title.trim() || resourceDraft.role,
        })),
      });
      setResourceDraft({ ...EMPTY_RESOURCE_DRAFT });
      await loadResources({ templateId: selectedId, supplierOrgId: draft.supplierOrgId || null, activeOrgId: organizationId });
    } catch (err) {
      setError(err?.message || "Could not add reusable resource.");
    } finally {
      setResourceSaving(false);
    }
  };

  const removeResource = async (resource) => {
    try {
      await removePlacementById(resource.placement_id);
      await loadResources({ templateId: selectedId, supplierOrgId: draft.supplierOrgId || null, activeOrgId: organizationId });
    } catch (err) {
      Alert.alert("Could not remove resource", err?.message || "Please try again.");
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ActivatorBreadcrumb
        items={[
          { label: "Activator Home", route: "ActivatorHome", params: { initialMode: "templates", organizationId } },
          { label: "System Library" },
        ]}
      />

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="hardware-chip-outline" size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Reusable System Truth</Text>
          <Text style={styles.title}>System Library</Text>
          <Text style={styles.subtitle}>
            Create one canonical system, attach reusable resources, then reference it from model templates and exact installed systems.
          </Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={startNew}>
          <Ionicons name="add-circle-outline" size={17} color="#fff" />
          <Text style={styles.primaryButtonText}>New System Template</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

      <View style={styles.layout}>
        <View style={styles.listPanel}>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Mercury, Starlink, generator..."
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              onSubmitEditing={() => loadList()}
            />
            <TouchableOpacity style={styles.searchButton} onPress={() => loadList()} disabled={loading}>
              {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search-outline" size={17} color="#fff" />}
            </TouchableOpacity>
          </View>
          <Text style={styles.panelHint}>
            {organizationId
              ? "Showing this OEM's System Library. Shared supplier catalog browsing is separate from OEM-owned standard systems."
              : "System Template = reusable truth. It is never another exact system record."}
          </Text>
          {visibleTemplates.map((template) => {
            const active = template.id === selectedId;
            return (
              <TouchableOpacity
                key={template.id}
                activeOpacity={0.84}
                onPress={() => selectTemplate(template)}
                style={[styles.templateRow, active && styles.templateRowActive]}
              >
                <Ionicons name="hardware-chip-outline" size={18} color={active ? colors.primary : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>{template.name}</Text>
                  <Text style={styles.templateMeta}>
                    {[template.manufacturer, template.system_category, template.authority_state].filter(Boolean).join(" - ")}
                  </Text>
                </View>
                <Text style={styles.resourceCount}>{template.resource_count || 0}</Text>
              </TouchableOpacity>
            );
          })}
          {!loading && !visibleTemplates.length ? (
            <Text style={styles.emptyText}>No reusable systems found.</Text>
          ) : null}
        </View>

        <View style={styles.editorPanel}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>{draft.id ? "Edit Canonical System" : "Create Canonical System"}</Text>
              <Text style={styles.sectionTitle}>{draft.name || "Reusable system template"}</Text>
            </View>
            <TouchableOpacity style={[styles.saveButton, (!canSave || saving) && styles.disabledButton]} onPress={save} disabled={!canSave || saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="save-outline" size={16} color="#fff" />}
              <Text style={styles.saveButtonText}>{saving ? "Saving" : "Save"}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.applyButton, !selectedId && styles.disabledButton]} onPress={openApplyModal} disabled={!selectedId}>
            <Ionicons name="arrow-redo-circle-outline" size={17} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Apply to Model</Text>
          </TouchableOpacity>

          <View style={styles.formGrid}>
            <Field label="Name" value={draft.name} onChangeText={(value) => updateDraft("name", value)} placeholder="Mercury 600 V12 Verado" />
            <Field label="Manufacturer / provider" value={draft.manufacturer} onChangeText={(value) => updateDraft("manufacturer", value)} placeholder="Mercury Marine" />
            <Field label="Canonical key" value={draft.canonicalKey} onChangeText={(value) => updateDraft("canonicalKey", value)} placeholder="system_template.mercury.mercury_600_v12_verado" />
            <Field label="Category" value={draft.systemCategory} onChangeText={(value) => updateDraft("systemCategory", value)} placeholder="Propulsion" />
          </View>
          <View style={styles.supplierPicker}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Canonical supplier Organization</Text>
              <Text style={styles.panelHint}>
                Supplier identity comes from the OEM Supplier Network. Manufacturer / provider text remains for compatibility.
              </Text>
            </View>
            <TouchableOpacity style={styles.secondaryButtonCompact} onPress={openSupplierNetwork}>
              <Ionicons name="git-network-outline" size={15} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>Supplier Network</Text>
            </TouchableOpacity>
            <View style={styles.lookupRow}>
              <TextInput
                value={supplierQuery}
                onChangeText={setSupplierQuery}
                placeholder="Search Dometic, Garmin, Seakeeper..."
                placeholderTextColor={colors.textMuted}
                style={styles.lookupInput}
                onSubmitEditing={searchSuppliers}
              />
              <TouchableOpacity style={styles.lookupButton} onPress={searchSuppliers} disabled={supplierLookupLoading}>
                {supplierLookupLoading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search-outline" size={16} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButtonCompact, (!supplierQuery.trim() || supplierConnectSaving) && styles.disabledButton]}
                onPress={() => connectSupplierOrganization(null)}
                disabled={!supplierQuery.trim() || supplierConnectSaving}
              >
                <Ionicons name="add-circle-outline" size={15} color={colors.primary} />
                <Text style={styles.secondaryButtonText}>Quick Add</Text>
              </TouchableOpacity>
            </View>
            {supplierMatches.length ? (
              <View style={styles.matchList}>
                {supplierMatches.slice(0, 5).map((match) => {
                  const matchId = match.organization_id || match.id;
                  const matchName = match.display_name || match.name || "Organization";
                  return (
                    <TouchableOpacity
                      key={matchId || matchName}
                      style={styles.matchRow}
                      activeOpacity={0.86}
                      onPress={() => connectSupplierOrganization(match)}
                      disabled={supplierConnectSaving}
                    >
                      <Ionicons name="business-outline" size={15} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.matchTitle}>{matchName}</Text>
                        <Text style={styles.matchMeta}>{[match.slug, match.organization_type || match.org_type, match.status].filter(Boolean).join(" · ")}</Text>
                      </View>
                      <Ionicons name="chevron-forward-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            <View style={styles.chipRow}>
              <Chip
                active={!draft.supplierOrgId}
                label="Unresolved"
                onPress={() => updateDraft("supplierOrgId", null)}
              />
              {suppliers.map((supplier) => (
                <Chip
                  key={supplier.organization_id}
                  active={draft.supplierOrgId === supplier.organization_id}
                  label={supplier.name}
                  onPress={() => {
                    setDraft((current) => ({
                      ...current,
                      supplierOrgId: supplier.organization_id,
                      manufacturer: current.manufacturer.trim() ? current.manufacturer : supplier.name,
                    }));
                  }}
                />
              ))}
            </View>
            {selectedSupplier ? (
              <Text style={styles.panelHint}>
                Linked to {selectedSupplier.name}: {selectedSupplier.system_template_count || 0} systems, {selectedSupplier.model_count || 0} model references.
              </Text>
            ) : null}
          </View>
          <OwnershipChoice
            activeOrgId={organizationId}
            ownerOrgId={draft.ownerOrgId}
            onChange={(value) => updateDraft("ownerOrgId", value)}
          />
          <View style={styles.chipRow}>
            {AUTHORITY_STATES.map((state) => (
              <Chip
                key={state.key}
                label={state.label}
                active={draft.authorityState === state.key}
                onPress={() => updateDraft("authorityState", state.key)}
              />
            ))}
          </View>
          <Field label="Reusable description" value={draft.description} onChangeText={(value) => updateDraft("description", value)} multiline placeholder="Reusable product description, not asset-specific condition or evidence." />
          <Field label="Reusable specs" value={draft.reusableSpecs} onChangeText={(value) => updateDraft("reusableSpecs", value)} multiline placeholder="HP, voltage, dimensions, fuel type, network support..." />
          <Field label="Warranty guidance" value={draft.warrantyGuidance} onChangeText={(value) => updateDraft("warrantyGuidance", value)} multiline placeholder="Reusable warranty registration and coverage guidance." />
          <View style={styles.formGrid}>
            <Field label="Ownership tasks" value={draft.ownershipTasks} onChangeText={(value) => updateDraft("ownershipTasks", value)} multiline placeholder={"Annual inspection\nReplace filter\nFirmware check"} />
            <Field label="Playbooks" value={draft.playbooks} onChangeText={(value) => updateDraft("playbooks", value)} multiline placeholder={"Annual service\nWinterization\nCommissioning"} />
            <Field label="Proof / evidence expectations" value={draft.proofExpectations} onChangeText={(value) => updateDraft("proofExpectations", value)} multiline placeholder={"Serial photo\nWarranty registration\nInstall invoice"} />
          </View>

          <View style={styles.resourcesPanel}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Reusable Resources</Text>
                <Text style={styles.sectionTitle}>Manuals, specs, warranty, support</Text>
              </View>
              <Text style={styles.countBadge}>{resources.length}</Text>
            </View>
            {resources.map((resource) => (
              <ResourceRow key={resource.placement_id || resource.attachment_id} resource={resource} onRemove={() => removeResource(resource)} />
            ))}
            {!resources.length ? <Text style={styles.emptyText}>No reusable resources yet.</Text> : null}
            <View style={styles.resourceForm}>
              <Field label="Resource title" value={resourceDraft.title} onChangeText={(value) => setResourceDraft((current) => ({ ...current, title: value }))} placeholder="Owner manual" />
              <Field label="Resource URL" value={resourceDraft.url} onChangeText={(value) => setResourceDraft((current) => ({ ...current, url: value }))} placeholder="https://..." />
              <View style={styles.chipRow}>
                {RESOURCE_ROLES.map((role) => (
                  <Chip key={role} label={role.replace(/_/g, " ")} active={resourceDraft.role === role} onPress={() => setResourceDraft((current) => ({ ...current, role }))} />
                ))}
              </View>
              <View style={styles.placementPicker}>
                <Text style={styles.label}>Attach to</Text>
                <Text style={styles.panelHint}>
                  One attachment can participate in supplier knowledge, OEM knowledge, and reusable system truth without creating duplicate files.
                </Text>
                <View style={styles.chipRow}>
                  <Chip
                    label="System Template"
                    active={resourceDraft.placeOnSystemTemplate}
                    onPress={() => setResourceDraft((current) => ({ ...current, placeOnSystemTemplate: !current.placeOnSystemTemplate }))}
                  />
                  <Chip
                    label={selectedSupplier ? `${selectedSupplier.name} KB` : "Supplier KB"}
                    active={resourceDraft.placeOnSupplier}
                    onPress={() => setResourceDraft((current) => ({ ...current, placeOnSupplier: !current.placeOnSupplier }))}
                  />
                  <Chip
                    label="OEM KB"
                    active={resourceDraft.placeOnOem}
                    onPress={() => setResourceDraft((current) => ({ ...current, placeOnOem: !current.placeOnOem }))}
                  />
                </View>
                {!draft.supplierOrgId && resourceDraft.placeOnSupplier ? (
                  <Text style={styles.errorText}>Choose a canonical supplier Organization before attaching supplier KB.</Text>
                ) : null}
              </View>
              <TouchableOpacity style={[styles.secondaryButton, resourceSaving && styles.disabledButton]} onPress={addResource} disabled={resourceSaving}>
                <Ionicons name="attach-outline" size={17} color={colors.primary} />
                <Text style={styles.secondaryButtonText}>{resourceSaving ? "Adding..." : "Add reusable resource"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.ontologyPanel}>
            <Text style={styles.sectionEyebrow}>Ontology Guardrail</Text>
            <Text style={styles.ontologyLine}>System Template: reusable truth.</Text>
            <Text style={styles.ontologyLine}>Asset Template Item: model-specific applicability.</Text>
            <Text style={styles.ontologyLine}>System Instance: exact installed truth, serials, service, photos, and evidence.</Text>
          </View>
        </View>
      </View>

      <Modal visible={applyModalOpen} transparent animationType="fade" onRequestClose={() => setApplyModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionEyebrow}>Apply Reusable System</Text>
                <Text style={styles.sectionTitle}>{draft.name || "System Template"}</Text>
                <Text style={styles.panelHint}>
                  Creates or updates a model-template item linked to this canonical System Template. Applicability stays on the model.
                </Text>
              </View>
              <TouchableOpacity style={styles.iconButton} onPress={() => setApplyModalOpen(false)}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {catalogLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.panelHint}>Loading model templates...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Model template</Text>
                <View style={styles.modelApplyList}>
                  {catalogTemplates.map((template) => (
                    <TouchableOpacity
                      key={template.id}
                      activeOpacity={0.86}
                      style={[styles.modelApplyRow, selectedCatalogTemplateId === template.id && styles.modelApplyRowActive]}
                      onPress={() => setSelectedCatalogTemplateId(template.id)}
                    >
                      <Ionicons name="boat-outline" size={16} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.matchTitle}>
                          {[template.manufacturer, template.model || template.template_name || template.name].filter(Boolean).join(" ")}
                        </Text>
                        <Text style={styles.matchMeta}>{template.template_key}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {!catalogTemplates.length ? <Text style={styles.emptyText}>No model templates are available for this organization.</Text> : null}
                </View>
                <Field label="Model-facing label" value={applyLabel} onChangeText={setApplyLabel} placeholder={draft.name || "Dometic VacuFlush"} />
                <Text style={styles.label}>Applicability</Text>
                <View style={styles.chipRow}>
                  {APPLY_STATES.map((state) => (
                    <Chip
                      key={state}
                      label={state.replace(/_/g, " ")}
                      active={applyState === state}
                      onPress={() => setApplyState(state)}
                    />
                  ))}
                </View>
              </>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, (applySaving || catalogLoading || !selectedCatalogTemplateId) && styles.disabledButton]}
              onPress={applySystemTemplateToModel}
              disabled={applySaving || catalogLoading || !selectedCatalogTemplateId}
            >
              {applySaving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-redo-outline" size={17} color="#fff" />}
              <Text style={styles.primaryButtonText}>{applySaving ? "Applying..." : "Apply to Model"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f7fb" },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 1280, width: "100%", alignSelf: "center" },
  hero: { backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: "#dfe5ec", padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center", ...shadows.sm },
  heroIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: "#eaf3ff", alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 12, fontWeight: "900", color: colors.textMuted, textTransform: "uppercase" },
  title: { fontSize: 30, fontWeight: "900", color: colors.text },
  subtitle: { color: colors.textMuted, marginTop: 4, lineHeight: 20 },
  primaryButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.full },
  primaryButtonText: { color: "#fff", fontWeight: "900" },
  layout: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", flexWrap: "wrap" },
  listPanel: { flex: 0.8, minWidth: 320, backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: "#dfe5ec", padding: spacing.md, gap: spacing.sm },
  editorPanel: { flex: 1.25, minWidth: 420, backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: "#dfe5ec", padding: spacing.md, gap: spacing.md },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  searchInput: { flex: 1, borderWidth: 1, borderColor: "#dfe5ec", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontWeight: "700", color: colors.text },
  searchButton: { width: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  lookupRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  lookupInput: { flex: 1, minWidth: 220, borderWidth: 1, borderColor: "#dfe5ec", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontWeight: "700", color: colors.text, backgroundColor: "#fff" },
  lookupButton: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  matchList: { borderWidth: 1, borderColor: "#dfe5ec", borderRadius: radius.md, backgroundColor: "#fff", overflow: "hidden" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eef2f7" },
  matchTitle: { color: colors.text, fontWeight: "900" },
  matchMeta: { color: colors.textMuted, fontWeight: "700", fontSize: 12, marginTop: 2 },
  panelHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  templateRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#e6ebf2", borderRadius: radius.md, padding: 12 },
  templateRowActive: { borderColor: colors.primary, backgroundColor: "#eaf3ff" },
  templateTitle: { color: colors.text, fontWeight: "900" },
  templateMeta: { color: colors.textMuted, fontWeight: "700", marginTop: 3, fontSize: 12 },
  resourceCount: { minWidth: 26, textAlign: "center", color: colors.primary, fontWeight: "900" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, alignItems: "center" },
  sectionEyebrow: { fontSize: 11, fontWeight: "900", color: colors.primary, textTransform: "uppercase" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  saveButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  saveButtonText: { color: "#fff", fontWeight: "900" },
  disabledButton: { opacity: 0.55 },
  applyButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#fff", borderColor: "#bfdbfe", borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  formGrid: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  supplierPicker: { backgroundColor: "#f8fbff", borderColor: "#dfe5ec", borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  ownerChoice: { backgroundColor: "#f8fafc", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  field: { flex: 1, minWidth: 220, gap: 5 },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "900" },
  input: { borderWidth: 1, borderColor: "#dfe5ec", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontWeight: "700", backgroundColor: "#fff" },
  textArea: { minHeight: 84, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#dfe5ec", borderRadius: radius.full, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: "#fff" },
  chipActive: { borderColor: colors.primary, backgroundColor: "#eaf3ff" },
  chipText: { color: colors.textMuted, fontWeight: "900", fontSize: 12, textTransform: "capitalize" },
  chipTextActive: { color: colors.primary },
  resourcesPanel: { borderTopWidth: 1, borderTopColor: "#e6ebf2", paddingTop: spacing.md, gap: spacing.sm },
  resourceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: "#e6ebf2", borderRadius: radius.md, padding: 10 },
  resourceMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  resourceTitle: { color: colors.text, fontWeight: "900" },
  resourceMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  iconButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fee2e2" },
  resourceForm: { gap: spacing.sm, marginTop: spacing.sm },
  placementPicker: { borderWidth: 1, borderColor: "#dfe5ec", backgroundColor: "#f8fafc", borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  secondaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: radius.md, paddingVertical: 11 },
  secondaryButtonCompact: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#fff", borderColor: "#bfdbfe", borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryButtonText: { color: colors.primary, fontWeight: "900" },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(15, 23, 42, 0.48)", bottom: 0, justifyContent: "center", left: 0, padding: spacing.lg, position: "absolute", right: 0, top: 0 },
  modalPanel: { backgroundColor: "#fff", borderColor: "#dfe5ec", borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, maxHeight: "86%", maxWidth: 680, padding: spacing.lg, width: "100%", ...shadows.lg },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  modelApplyList: { borderColor: "#dfe5ec", borderRadius: radius.md, borderWidth: 1, maxHeight: 280, overflow: "hidden" },
  modelApplyRow: { alignItems: "center", backgroundColor: "#fff", borderBottomColor: "#eef2f7", borderBottomWidth: 1, flexDirection: "row", gap: spacing.sm, padding: spacing.sm },
  modelApplyRowActive: { backgroundColor: "#eaf3ff", borderColor: colors.primary },
  countBadge: { color: colors.primary, fontWeight: "900", backgroundColor: "#eaf3ff", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  ontologyPanel: { borderWidth: 1, borderColor: "#dfe5ec", backgroundColor: "#f8fafc", borderRadius: radius.md, padding: spacing.md, gap: 5 },
  ontologyLine: { color: colors.text, fontWeight: "700" },
  emptyText: { color: colors.textMuted, fontWeight: "700", paddingVertical: 10 },
  errorText: { color: "#b91c1c", fontWeight: "800" },
  noticeText: { color: "#166534", fontWeight: "800" },
});
