import { supabase } from "./supabaseClient";

export async function searchKeeprAdminOrgs(query = "", filters = {}) {
  const { data, error } = await supabase.rpc("search_keepr_admin_orgs", {
    p_query: query?.trim?.() || "",
    p_organization_type: filters?.organizationType || null,
    p_workspace_type: filters?.workspaceType || null,
  });

  if (error) throw error;
  return data || { organizations: [] };
}

export async function getKeeprAdminOrgActivation(organizationId) {
  const { data, error } = await supabase.rpc("get_keepr_admin_org_activation", {
    p_organization_id: organizationId,
  });

  if (error) throw error;
  return data || null;
}

export async function upsertKeeprAdminOrgRelationship({
  fromOrgId,
  toOrgId,
  relationshipType,
  status = "active",
  metadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("upsert_keepr_admin_org_relationship", {
    p_from_org_id: fromOrgId,
    p_to_org_id: toOrgId,
    p_relationship_type: relationshipType,
    p_status: status,
    p_metadata: metadata,
  });

  if (error) throw error;
  return data || null;
}

export async function updateKeeprAdminOrgClassification({
  organizationId,
  organizationType,
  metadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("update_keepr_admin_org_classification", {
    p_organization_id: organizationId,
    p_organization_type: organizationType,
    p_metadata: metadata,
  });

  if (error) throw error;
  return data || null;
}

export async function searchKeeprAdminOperatorUsers(query = "") {
  const { data, error } = await supabase.rpc("search_keepr_admin_operator_users", {
    p_query: query?.trim?.() || "",
  });

  if (error) throw error;
  return data || { users: [] };
}

export async function activateKeeprSpaceOrg({
  organizationId,
  workspaceType = "keeprpro",
  operatorUserId,
  memberRole = "admin",
  capabilities = [],
} = {}) {
  const { data, error } = await supabase.rpc("activate_keeprspace_org", {
    p_organization_id: organizationId,
    p_workspace_type: workspaceType,
    p_operator_user_id: operatorUserId,
    p_member_role: memberRole,
    p_capabilities: capabilities,
  });

  if (error) throw error;
  return data || null;
}

export async function createKeeprOrganization({
  organizationName,
  preset = "org",
  adminEmail,
  password = "",
  brand = {},
  capabilities = null,
} = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Sign in before creating an organization.");

  const response = await fetch("/api/keepr-admin/create-organization", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      organization_name: organizationName,
      preset,
      admin_email: adminEmail,
      password,
      brand,
      capabilities,
    }),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    throw new Error(json?.error || text || `HTTP ${response.status}`);
  }

  return json || {};
}

export async function createOrgModelTemplate({
  organizationId,
  manufacturer,
  model,
  modelYear,
  templateKey = null,
  category = "marine",
  className = null,
} = {}) {
  const { data, error } = await supabase.rpc("create_org_model_template", {
    p_organization_id: organizationId,
    p_manufacturer: manufacturer,
    p_model: model,
    p_model_year: modelYear,
    p_template_key: templateKey,
    p_category: category,
    p_class: className,
  });

  if (error) throw error;
  return data || null;
}
