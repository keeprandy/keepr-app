import { supabase } from "./supabaseClient";

const ACTIVATOR_MISSING_RPC_CODE = "ACTIVATOR_FOUNDATION_MISSING";

function normalizeActivatorError(error) {
  if (!error) return error;

  if (error.code === "PGRST202" && String(error.message || "").includes("get_activator_boat_browser")) {
    const next = new Error(
      "Activator database foundation is not applied to the connected Supabase project yet."
    );
    next.code = ACTIVATOR_MISSING_RPC_CODE;
    next.details = [
      "Required RPC: public.get_activator_boat_browser(p_filters)",
      "Apply the Activator foundation, Phase 2A browser, and demo projection migrations to the intended non-production database.",
    ];
    return next;
  }

  if (error.code === "PGRST202" && String(error.message || "").includes("resolve_activator_boat_workspace")) {
    const next = new Error(
      "Activator vessel workspace resolver is not applied to the connected Supabase project yet."
    );
    next.code = ACTIVATOR_MISSING_RPC_CODE;
    next.details = [
      "Required RPC: public.resolve_activator_boat_workspace(p_asset_id, p_projection, p_organization_id)",
      "Apply the Activator Phase 2A browser migration to the intended non-production database.",
    ];
    return next;
  }

  if (error.code === "PGRST202" && String(error.message || "").includes("get_catalog_")) {
    const next = new Error(
      "Activator catalog resolvers are not applied to the connected Supabase project yet."
    );
    next.code = ACTIVATOR_MISSING_RPC_CODE;
    next.details = [
      "Required RPCs: public.get_catalog_templates(p_organization_id), public.get_catalog_template_detail(p_template_id, p_template_key)",
      "Apply the Activator Use Case 01 catalog migration to the intended non-production database.",
    ];
    return next;
  }

  if (error.code === "PGRST202" && String(error.message || "").includes("get_tiara_factory_build_workspace")) {
    const next = new Error(
      "Tiara factory build workspace resolver is not applied to the connected staging database yet."
    );
    next.code = ACTIVATOR_MISSING_RPC_CODE;
    next.details = [
      "Required RPC: public.get_tiara_factory_build_workspace(p_hull_number)",
      "Apply the Tiara factory work-order ingestion migration to the intended non-production database.",
    ];
    return next;
  }

  return error;
}

export async function getActivatorBoatBrowser(filters = {}) {
  const { data, error } = await supabase.rpc("get_activator_boat_browser", {
    p_filters: filters,
  });

  if (error) throw normalizeActivatorError(error);
  return data || {};
}

export async function getActivatorBoatWorkspace({
  assetId,
  projection = "owner",
  organizationId = null,
}) {
  const { data, error } = await supabase.rpc("resolve_activator_boat_workspace", {
    p_asset_id: assetId,
    p_projection: projection,
    p_organization_id: organizationId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function getActivatorSeedOrgs() {
  const { data, error } = await supabase
    .from("orgs")
    .select("id, slug, name, display_name")
    .in("slug", ["tiara-yachts", "skipperbuds"])
    .order("display_name", { ascending: true });

  if (error) throw error;

  return (data || []).reduce((acc, org) => {
    if (org.slug === "tiara-yachts") acc.tiaraYachts = org;
    if (org.slug === "skipperbuds") acc.skipperBuds = org;
    return acc;
  }, {});
}

export async function getCatalogTemplates(organizationId = null) {
  const { data, error } = await supabase.rpc("get_catalog_templates", {
    p_organization_id: organizationId,
  });

  if (error) throw normalizeActivatorError(error);
  return Array.isArray(data) ? data : [];
}

export async function getCatalogTemplateDetail({ templateId = null, templateKey = null } = {}) {
  const { data, error } = await supabase.rpc("get_catalog_template_detail", {
    p_template_id: templateId,
    p_template_key: templateKey,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function getTiaraFactoryBuildWorkspace({
  hullNumber = null,
  templateKey = null,
  buildKey = null,
} = {}) {
  const { data, error } = await supabase.rpc("get_tiara_factory_build_workspace", {
    p_hull_number: hullNumber,
    p_template_key: templateKey,
    p_build_key: buildKey,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function getTemplateSourceActivationWorkspace(templateKey) {
  const { data, error } = await supabase.rpc("get_template_source_activation_workspace", {
    p_template_key: templateKey,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function publishTemplateFreshwaterActivation({
  templateKey,
  guidance = null,
  playbooks = null,
}) {
  const { data, error } = await supabase.rpc("publish_template_freshwater_activation", {
    p_template_key: templateKey,
    p_guidance: guidance,
    p_playbooks: playbooks,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function publishCatalogTemplateDraft({
  organizationId,
  draft,
  approvedFacts,
  approvedSystems = [],
  approvedConfigurationGroups = [],
}) {
  const payload = {
    draft,
    approved_facts: approvedFacts,
    approved_systems: approvedSystems,
    approved_configuration_groups: approvedConfigurationGroups,
  };

  const { data, error } = await supabase.rpc("publish_catalog_template_draft", {
    p_organization_id: organizationId,
    p_template_key: draft?.template_key,
    p_payload: payload,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function upsertCatalogTemplateItem({
  templateId,
  itemType,
  canonicalKey,
  label,
  parentItemId = null,
  parentCanonicalKey = null,
  expectedValue = {},
  applicability = {},
  authorityState = "oem_published",
  sourceResourceId = null,
  metadata = {},
  sortOrder = 0,
}) {
  const { data, error } = await supabase.rpc("upsert_asset_model_template_item", {
    p_template_id: templateId,
    p_item_type: itemType,
    p_canonical_key: canonicalKey,
    p_label: label,
    p_parent_item_id: parentItemId,
    p_parent_canonical_key: parentCanonicalKey,
    p_expected_value: expectedValue,
    p_applicability: applicability,
    p_authority_state: authorityState,
    p_source_resource_id: sourceResourceId,
    p_metadata: metadata,
    p_sort_order: sortOrder,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function listSystemTemplates({ query = "", limit = 25 } = {}) {
  const { data, error } = await supabase.rpc("list_system_templates", {
    p_query: query,
    p_limit: limit,
  });

  if (error) throw normalizeActivatorError(error);
  return Array.isArray(data) ? data : [];
}

export async function linkModelItemSystemTemplate({ templateItemId, systemTemplateId }) {
  const { data, error } = await supabase.rpc("link_model_item_system_template", {
    p_template_item_id: templateItemId,
    p_system_template_id: systemTemplateId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function unlinkModelItemSystemTemplate(templateItemId) {
  const { data, error } = await supabase.rpc("unlink_model_item_system_template", {
    p_template_item_id: templateItemId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function promoteSystemToSystemTemplate({ systemId, payload = {} } = {}) {
  const { data, error } = await supabase.rpc("promote_system_to_system_template", {
    p_system_id: systemId,
    p_payload: payload || {},
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function retireCatalogTemplateItem(templateItemId) {
  const { data, error } = await supabase.rpc("retire_asset_model_template_item", {
    p_template_item_id: templateItemId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function getExactBuildDraft({
  draftId = null,
  draftKey = null,
  templateKey = null,
  organizationId = null,
} = {}) {
  const { data, error } = await supabase.rpc("get_exact_build_draft", {
    p_draft_id: draftId,
    p_draft_key: draftKey,
    p_template_key: templateKey,
    p_organization_id: organizationId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function upsertExactBuildDraft({
  organizationId,
  templateKey,
  draftId = null,
  draftKey = null,
  displayName = null,
  identity = {},
  finishSelections = [],
  items = [],
  status = "draft",
  sourceResourceId = null,
  metadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("upsert_exact_build_draft", {
    p_organization_id: organizationId,
    p_template_key: templateKey,
    p_draft_id: draftId,
    p_draft_key: draftKey,
    p_display_name: displayName,
    p_identity: identity || {},
    p_finish_selections: finishSelections || [],
    p_items: items || [],
    p_status: status,
    p_source_resource_id: sourceResourceId,
    p_metadata: metadata || {},
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}

export async function getExactBuildWorkQueue(organizationId) {
  const { data, error } = await supabase.rpc("get_exact_build_work_queue", {
    p_organization_id: organizationId,
  });

  if (error) throw normalizeActivatorError(error);
  return Array.isArray(data) ? data : [];
}

export async function publishExactBuildDraft(draftId) {
  const { data, error } = await supabase.rpc("publish_exact_build_draft", {
    p_draft_id: draftId,
  });

  if (error) throw normalizeActivatorError(error);
  return data || null;
}
