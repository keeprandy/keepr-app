import { supabase } from "./supabaseClient";

export async function searchKeeprAdminOrgs(query = "") {
  const { data, error } = await supabase.rpc("search_keepr_admin_orgs", {
    p_query: query?.trim?.() || "",
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
