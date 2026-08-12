import { supabase } from "./supabaseClient";

export async function getKeeprSpacePortfolio({
  organizationId = null,
  search = "",
  limit = 50,
  offset = 0,
} = {}) {
  const { data, error } = await supabase.rpc("get_keeprspace_portfolio", {
    p_organization_id: organizationId,
    p_search: search?.trim?.() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return data || {};
}

export async function resolveKeeprSpaceKac({ query, organizationId = null } = {}) {
  const { data, error } = await supabase.rpc("resolve_keeprspace_kac", {
    p_query: query?.trim?.() || "",
    p_organization_id: organizationId,
  });

  if (error) throw error;
  return data || { matches: [] };
}

export async function connectKeeprSpaceServiceAsset({
  assetId,
  organizationId,
  relationshipType = "service_provider",
} = {}) {
  const { data, error } = await supabase.rpc("connect_keeprspace_service_asset", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_relationship_type: relationshipType,
  });

  if (error) throw error;
  return data || null;
}

export async function connectKeeprSpaceBoat({
  assetId,
  organizationId,
  relationshipPurpose = "service",
  operatingStates = [],
} = {}) {
  const { data, error } = await supabase.rpc("connect_keeprspace_boat", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_relationship_purpose: relationshipPurpose,
    p_operating_states: operatingStates,
  });

  if (error) throw error;
  return data || null;
}

export async function createKeeprSpaceBoat({
  organizationId,
  boat,
  relationshipPurpose = "service",
  operatingStates = [],
} = {}) {
  const { data, error } = await supabase.rpc("create_keeprspace_boat", {
    p_organization_id: organizationId,
    p_boat: boat || {},
    p_relationship_purpose: relationshipPurpose,
    p_operating_states: operatingStates,
  });

  if (error) throw error;
  return data || null;
}

export async function updateKeeprSpaceServiceProfile({
  keeprProId,
  organizationId,
  patch,
} = {}) {
  const { data, error } = await supabase.rpc("update_keeprpro_claimed_profile", {
    p_keepr_pro_id: keeprProId,
    p_organization_id: organizationId,
    p_patch: patch || {},
  });

  if (error) throw error;
  return data || null;
}

export async function updateKeeprSpaceOrgProfile({
  organizationId,
  patch,
} = {}) {
  const { data, error } = await supabase.rpc("update_keeprspace_org_profile", {
    p_organization_id: organizationId,
    p_patch: patch || {},
  });

  if (error) throw error;
  return data || null;
}

export async function getKeeprSpaceOrgConfig({ organizationId } = {}) {
  const { data, error } = await supabase.rpc("get_keeprspace_org_config", {
    p_organization_id: organizationId,
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgProfile({
  organizationId,
  patch,
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_profile", {
    p_organization_id: organizationId,
    p_patch: patch || {},
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgLocation({
  organizationId,
  location,
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_location", {
    p_organization_id: organizationId,
    p_location: location || {},
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgTeam({
  organizationId,
  team,
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_team", {
    p_organization_id: organizationId,
    p_team: team || {},
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgMemberAssignment({
  organizationId,
  assignment,
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_member_assignment", {
    p_organization_id: organizationId,
    p_assignment: assignment || {},
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgServiceOffering({
  organizationId,
  service,
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_service_offering", {
    p_organization_id: organizationId,
    p_service: service || {},
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprSpaceOrgRelationship({
  fromOrgId,
  toOrgId = null,
  toOrgName = null,
  relationshipType = "represented_brand",
  payload = {},
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_relationship", {
    p_from_org_id: fromOrgId,
    p_to_org_id: toOrgId,
    p_to_org_name: toOrgName,
    p_relationship_type: relationshipType,
    p_payload: payload || {},
  });

  if (error) throw error;
  return data || null;
}
