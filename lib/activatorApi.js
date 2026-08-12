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
