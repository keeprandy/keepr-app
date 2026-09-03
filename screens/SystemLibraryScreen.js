import { Ionicons } from "@expo/vector-icons";
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
import { useNavigation, useRoute } from "@react-navigation/native";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { createLinkAttachment } from "../lib/attachmentsUploader";
import { listAttachmentsForTarget, removePlacementById } from "../lib/attachmentsApi";
import { getSystemTemplate, listSystemTemplates, upsertSystemTemplate } from "../lib/activatorApi";
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

const EMPTY_DRAFT = {
  id: null,
  name: "",
  manufacturer: "",
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

function draftFromTemplate(template, ownerOrgId) {
  const metadata = template?.metadata || {};
  return {
    id: template?.id || null,
    name: template?.name || "",
    manufacturer: template?.manufacturer || "",
    canonicalKey: template?.canonical_key || canonicalKeyFor(template || {}),
    systemCategory: template?.system_category || "",
    description: template?.description || "",
    authorityState: template?.authority_state || "draft",
    ownerOrgId: template?.owner_org_id || ownerOrgId || null,
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

function ResourceRow({ resource, onRemove }) {
  const title = resource?.title || resource?.label || resource?.url || resource?.file_name || "Resource";
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
          <Text style={styles.resourceMeta}>{[resource?.role, resource?.url].filter(Boolean).join(" - ") || "System Template resource"}</Text>
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
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, ownerOrgId: organizationId });
  const [resources, setResources] = useState([]);
  const [resourceDraft, setResourceDraft] = useState({ title: "", url: "", role: "manual" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async (queryOverride = query) => {
    setLoading(true);
    setError("");
    try {
      const rows = await listSystemTemplates({ query: queryOverride, limit: 50 });
      setTemplates(rows || []);
    } catch (err) {
      setError(err?.message || "Could not load System Library.");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadResources = useCallback(async (templateId) => {
    if (!templateId) {
      setResources([]);
      return;
    }
    try {
      setResources(await listAttachmentsForTarget("system_template", templateId));
    } catch (err) {
      setError(err?.message || "Could not load reusable resources.");
      setResources([]);
    }
  }, []);

  const selectTemplate = useCallback(async (template) => {
    setSelected(template);
    setNotice("");
    setError("");
    const next = template?.id ? await getSystemTemplate(template.id) : template;
    const fullTemplate = next || template;
    setDraft(draftFromTemplate(fullTemplate, organizationId));
    await loadResources(fullTemplate?.id);
  }, [loadResources, organizationId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

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
    setDraft({ ...EMPTY_DRAFT, ownerOrgId: organizationId, canonicalKey: canonicalKeyFor({}) });
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
        ownerOrgId: draft.ownerOrgId || organizationId,
        systemCategory: draft.systemCategory.trim(),
        description: draft.description.trim(),
        authorityState: draft.authorityState,
        metadata: metadataFromDraft(draft),
      });
      setSelected(saved);
      setDraft(draftFromTemplate(saved, organizationId));
      setNotice("System Template saved. Reusable truth remains separate from applicability and exact installed evidence.");
      await loadList(query);
      await loadResources(saved.id);
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
        },
        placements: [{
          target_type: "system_template",
          target_id: selectedId,
          role: resourceDraft.role,
          label: resourceDraft.title.trim() || resourceDraft.role,
        }],
      });
      setResourceDraft({ title: "", url: "", role: "manual" });
      await loadResources(selectedId);
    } catch (err) {
      setError(err?.message || "Could not add reusable resource.");
    } finally {
      setResourceSaving(false);
    }
  };

  const removeResource = async (resource) => {
    try {
      await removePlacementById(resource.placement_id);
      await loadResources(selectedId);
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
          <Text style={styles.panelHint}>System Template = reusable truth. It is never another exact system record.</Text>
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

          <View style={styles.formGrid}>
            <Field label="Name" value={draft.name} onChangeText={(value) => updateDraft("name", value)} placeholder="Mercury 600 V12 Verado" />
            <Field label="Manufacturer / provider" value={draft.manufacturer} onChangeText={(value) => updateDraft("manufacturer", value)} placeholder="Mercury Marine" />
            <Field label="Canonical key" value={draft.canonicalKey} onChangeText={(value) => updateDraft("canonicalKey", value)} placeholder="system_template.mercury.mercury_600_v12_verado" />
            <Field label="Category" value={draft.systemCategory} onChangeText={(value) => updateDraft("systemCategory", value)} placeholder="Propulsion" />
          </View>
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
  formGrid: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
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
  secondaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: radius.md, paddingVertical: 11 },
  secondaryButtonText: { color: colors.primary, fontWeight: "900" },
  countBadge: { color: colors.primary, fontWeight: "900", backgroundColor: "#eaf3ff", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  ontologyPanel: { borderWidth: 1, borderColor: "#dfe5ec", backgroundColor: "#f8fafc", borderRadius: radius.md, padding: spacing.md, gap: 5 },
  ontologyLine: { color: colors.text, fontWeight: "700" },
  emptyText: { color: colors.textMuted, fontWeight: "700", paddingVertical: 10 },
  errorText: { color: "#b91c1c", fontWeight: "800" },
  noticeText: { color: "#166534", fontWeight: "800" },
});
