import { supabase } from "./supabaseClient";

function listFromValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function serviceItemsFromValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return { label: item.trim() };
        if (item && typeof item === "object") {
          return {
            ...item,
            label: String(item.label || item.title || item.name || "").trim(),
          };
        }
        return null;
      })
      .filter((item) => item?.label);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((label) => ({ label }));
  }
  return [];
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const next = stripUndefined(item);
      if (next !== undefined) acc[key] = next;
      return acc;
    }, {});
  }
  return value === undefined ? undefined : value;
}

function formatSupabaseError(error, fallback = "Supabase request failed") {
  const parts = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code ? `code: ${error.code}` : null,
  ].filter(Boolean);
  return parts.join(" | ") || fallback;
}

function sanitizeServiceOfferingPayload(service = {}) {
  const existingTemplate = service.metadata?.service_template || {};
  const serviceItems = serviceItemsFromValue(
    service.service_items ||
      service.checklist_items ||
      existingTemplate.service_items ||
      existingTemplate.checklist_items
  );
  const serviceTemplate = {
    template_kind: service.template_kind || service.metadata?.service_template?.template_kind || "service_action_template",
    asset_system_type:
      service.asset_system_type ||
      service.metadata?.service_template?.asset_system_type ||
      service.supported_asset_types?.[0] ||
      null,
    brand_applicability:
      service.brand_applicability ||
      service.metadata?.service_template?.brand_applicability ||
      null,
    interval_trigger:
      service.interval_trigger ||
      service.metadata?.service_template?.interval_trigger ||
      null,
    service_items: serviceItems,
  };

  return stripUndefined({
    id: service.id || undefined,
    keepr_pro_id: service.keepr_pro_id || undefined,
    name: service.name || service.owner_facing_label || "",
    slug: service.slug || undefined,
    service_type: service.service_type || "",
    description: service.description || service.owner_facing_description || "",
    owner_facing_label: service.owner_facing_label || service.name || "",
    owner_facing_description:
      service.owner_facing_description || service.description || "",
    status: service.status || "active",
    visibility: service.visibility || "owner_portal",
    relationship_purposes: listFromValue(service.relationship_purposes),
    supported_asset_types: listFromValue(service.supported_asset_types),
    authority_state: service.authority_state || "org_managed",
    source_type: service.source_type || undefined,
    source_name: service.source_name || undefined,
    source_url: service.source_url || undefined,
    metadata: {
      ...(service.metadata || {}),
      service_template: serviceTemplate,
      asset_system_type: serviceTemplate.asset_system_type,
      brand_applicability: serviceTemplate.brand_applicability,
      interval_trigger: serviceTemplate.interval_trigger,
      service_items: serviceItems,
    },
  });
}

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
  relationshipMetadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("connect_keeprspace_boat", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_relationship_purpose: relationshipPurpose,
    p_operating_states: operatingStates,
    p_relationship_metadata: relationshipMetadata || {},
  });

  if (error) throw error;
  return data || null;
}

export async function assignKacDealer({
  assetId,
  dealerOrgId,
  relationshipType = "assigned_dealer",
  metadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("assign_kac_dealer", {
    p_asset_id: assetId,
    p_dealer_org_id: dealerOrgId,
    p_relationship_type: relationshipType,
    p_metadata: metadata || {},
  });

  if (error) throw error;
  return data || null;
}

export async function createKeeprSpaceBoat({
  organizationId,
  boat,
  relationshipPurpose = "service",
  operatingStates = [],
  relationshipMetadata = {},
} = {}) {
  const { data, error } = await supabase.rpc("create_keeprspace_boat", {
    p_organization_id: organizationId,
    p_boat: boat || {},
    p_relationship_purpose: relationshipPurpose,
    p_operating_states: operatingStates,
    p_relationship_metadata: relationshipMetadata || {},
  });

  if (error) throw error;
  return data || null;
}

export async function removeKeeprSpaceBoatRelationship({
  assetId,
  assetRelationshipId,
  stewardshipId,
  organizationId,
} = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  if (!organizationId) throw new Error("Missing organization id.");

  const { data, error } = await supabase.rpc("remove_keeprspace_boat", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_asset_relationship_id: assetRelationshipId || null,
    p_stewardship_id: stewardshipId || null,
  });

  if (error) throw error;
  return data || null;
}

export async function updateKeeprSpaceBoatAsset({
  assetId,
  organizationId,
  patch = {},
} = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  if (!organizationId) throw new Error("Missing organization id.");

  const { data, error } = await supabase.rpc("update_keeprspace_boat_asset", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_patch: patch || {},
  });

  if (error) throw error;
  return data || null;
}

export async function setKeeprSpaceAssetHero({
  assetId,
  organizationId,
  placementId,
} = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  if (!organizationId) throw new Error("Missing organization id.");
  if (!placementId) throw new Error("Missing placement id.");

  const { data, error } = await supabase.rpc("set_asset_relationship_hero_placement", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_placement_id: placementId,
  });

  if (error) throw error;
  return data || null;
}

export async function clearKeeprSpaceAssetHero({
  assetId,
  organizationId,
} = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  if (!organizationId) throw new Error("Missing organization id.");

  const { data, error } = await supabase.rpc("clear_asset_relationship_hero_placement", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
  });

  if (error) throw error;
  return data || null;
}

export async function removeKeeprSpaceBoatAsset({
  assetId,
  organizationId,
} = {}) {
  if (!assetId) throw new Error("Missing asset id.");
  if (!organizationId) throw new Error("Missing organization id.");

  const { data, error } = await supabase.rpc("remove_keeprspace_boat_asset", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
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
  const payload = sanitizeServiceOfferingPayload(service || {});
  const { data, error } = await supabase.rpc("upsert_keeprspace_org_service_offering", {
    p_organization_id: organizationId,
    p_service: payload,
  });

  if (error) {
    console.error("KeeprSpace service offering save failed", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      payload,
    });
    throw new Error(formatSupabaseError(error, "Could not save service offering."));
  }
  return data || null;
}

export async function listKeeprSpacePlaybooks({
  organizationId = null,
  assetId = null,
  systemId = null,
} = {}) {
  const { data, error } = await supabase.rpc("list_keeprspace_playbooks", {
    p_organization_id: organizationId,
    p_asset_id: assetId,
    p_system_id: systemId,
  });

  if (error) throw error;
  return data || { playbooks: [] };
}

export async function upsertKeeprSpacePlaybook({ playbook } = {}) {
  const { data, error } = await supabase.rpc("upsert_keeprspace_playbook", {
    p_playbook: playbook || {},
  });

  if (error) throw error;
  return data || null;
}

export async function activateKeeprSpacePlaybook({ playbookId } = {}) {
  const { data, error } = await supabase.rpc("activate_keeprspace_playbook", {
    p_playbook_id: playbookId,
  });

  if (error) {
    console.error("KeeprSpace playbook activation failed", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      playbookId,
    });
    throw new Error(formatSupabaseError(error, "Could not activate playbook."));
  }
  return data || null;
}

export async function initiateAssetOwnerHandoff({
  assetId,
  ownerEmail,
  ownerDisplayName = null,
  initiatedByOrgId = null,
} = {}) {
  const { data, error } = await supabase.rpc("initiate_asset_owner_handoff", {
    p_asset_id: assetId,
    p_owner_email: ownerEmail,
    p_owner_display_name: ownerDisplayName,
    p_initiated_by_org_id: initiatedByOrgId,
  });

  if (error) throw error;
  return data || null;
}

export async function listPendingAssetOwnerHandoffs() {
  const { data, error } = await supabase.rpc("list_pending_asset_owner_handoffs");

  if (error) throw error;
  return data || { handoffs: [] };
}

export async function acceptAssetOwnerHandoff({ assetRelationshipId } = {}) {
  const { data, error } = await supabase.rpc("accept_asset_owner_handoff", {
    p_asset_relationship_id: assetRelationshipId,
  });

  if (error) throw error;
  return data || null;
}

async function archivePlaybookActions(actionIds = []) {
  const ids = Array.from(new Set(actionIds.filter(Boolean)));
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("reminders")
    .select("id,status")
    .in("id", ids);

  if (error) throw error;

  const archiveIds = (data || [])
    .filter((row) => !["completed", "deleted", "archived"].includes(String(row.status || "open").toLowerCase()))
    .map((row) => row.id);

  if (!archiveIds.length) return;

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("reminders")
    .update({ status: "archived", updated_at: now })
    .in("id", archiveIds);

  if (updateError) throw updateError;
}

export async function deactivateKeeprSpacePlaybook({ playbookId } = {}) {
  if (!playbookId) throw new Error("Missing playbook id.");

  const { data: playbook, error: playbookError } = await supabase
    .from("playbooks")
    .select(`
      id,
      name,
      asset_id,
      system_id,
      asset_relationship_id,
      organization_id,
      owner_user_id,
      status,
      created_by_type,
      source_playbook_id,
      metadata,
      steps:playbook_steps(
        id,
        position,
        title,
        step_type,
        service_offering_id,
        responsible_party,
        due_date,
        action_id,
        status,
        metadata
      )
    `)
    .eq("id", playbookId)
    .single();

  if (playbookError) throw playbookError;

  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  await archivePlaybookActions((steps || []).map((step) => step.action_id));

  const result = await upsertKeeprSpacePlaybook({
    playbook: {
      id: playbook.id,
      name: playbook.name,
      asset_id: playbook.asset_id,
      system_id: playbook.system_id || undefined,
      asset_relationship_id: playbook.asset_relationship_id || undefined,
      organization_id: playbook.organization_id || undefined,
      owner_user_id: playbook.owner_user_id || undefined,
      status: "draft",
      created_by_type: playbook.created_by_type || "organization",
      source_playbook_id: playbook.source_playbook_id || undefined,
      metadata: {
        ...(playbook?.metadata || {}),
        deactivated_at: new Date().toISOString(),
        deactivated_from_status: playbook?.status || null,
      },
      steps: steps.map((step, index) => ({
        id: step.id,
        position: step.position || index + 1,
        title: step.title,
        step_type: step.step_type || "action",
        service_offering_id: step.service_offering_id || undefined,
        responsible_party: step.responsible_party || undefined,
        due_date: step.due_date || undefined,
        action_id: step.action_id || undefined,
        status: step.status || "planned",
        metadata: step.metadata || {},
      })),
    },
  });

  return result?.playbook || result || null;
}

export async function deleteKeeprSpacePlaybook({ playbookId } = {}) {
  if (!playbookId) throw new Error("Missing playbook id.");

  const { data: steps, error: stepsError } = await supabase
    .from("playbook_steps")
    .select("action_id")
    .eq("playbook_id", playbookId);

  if (stepsError) throw stepsError;

  await archivePlaybookActions((steps || []).map((step) => step.action_id));

  const { error } = await supabase
    .from("playbooks")
    .delete()
    .eq("id", playbookId);

  if (error) throw error;
  return { ok: true };
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
