import { supabase } from "./supabaseClient";

let relationshipSharedHistoryRpcUnavailable = false;

function unwrap(data, error, fallbackMessage) {
  if (error) throw error;
  return data || null;
}

function isMissingRpcError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "PGRST202" || error?.status === 404 || message.includes("could not find the function");
}

export async function shareAssetRecordToRelationship({
  serviceRecordId,
  organizationId,
  assetRelationshipId = null,
  stewardshipId = null,
} = {}) {
  if (!serviceRecordId) throw new Error("Missing service record.");

  const { data, error } = await supabase.rpc("share_asset_record_to_relationship", {
    p_service_record_id: serviceRecordId,
    p_organization_id: organizationId || null,
    p_asset_relationship_id: assetRelationshipId || null,
    p_stewardship_id: stewardshipId || null,
  });
  return unwrap(data, error);
}

export async function createRelationshipRecordContribution({
  assetId,
  organizationId,
  assetRelationshipId = null,
  stewardshipId = null,
  title,
  recordType = "service",
  performedAt = null,
  amount = null,
  note = null,
  metadata = {},
} = {}) {
  if (!assetId) throw new Error("Missing asset.");
  if (!organizationId && !assetRelationshipId && !stewardshipId) {
    throw new Error("Missing relationship context.");
  }
  if (!String(title || "").trim()) throw new Error("Title is required.");

  const { data, error } = await supabase.rpc("create_relationship_record_contribution", {
    p_asset_id: assetId,
    p_organization_id: organizationId || null,
    p_asset_relationship_id: assetRelationshipId || null,
    p_stewardship_id: stewardshipId || null,
    p_title: String(title || "").trim(),
    p_record_type: recordType || "service",
    p_performed_at: performedAt || null,
    p_amount: amount === "" || amount === undefined ? null : amount,
    p_note: note || null,
    p_metadata: metadata || {},
  });
  return unwrap(data, error);
}

export async function listRelationshipSharedHistory({
  assetId,
  organizationId = null,
  assetRelationshipId = null,
  stewardshipId = null,
} = {}) {
  if (!assetId) throw new Error("Missing asset.");
  if (relationshipSharedHistoryRpcUnavailable) return [];
  const { data, error } = await supabase.rpc("list_relationship_shared_history", {
    p_asset_id: assetId,
    p_organization_id: organizationId || null,
    p_asset_relationship_id: assetRelationshipId || null,
    p_stewardship_id: stewardshipId || null,
  });
  if (error && isMissingRpcError(error)) {
    relationshipSharedHistoryRpcUnavailable = true;
    return [];
  }
  return unwrap(data, error) || [];
}

export async function listMyRelationshipRecordContributions() {
  const { data, error } = await supabase.rpc("list_my_relationship_record_contributions");
  return unwrap(data, error) || [];
}

export async function acceptRelationshipRecordContribution({ contributionId } = {}) {
  if (!contributionId) throw new Error("Missing contribution.");
  const { data, error } = await supabase.rpc("accept_relationship_record_contribution", {
    p_contribution_id: contributionId,
  });
  return unwrap(data, error);
}

export async function dismissRelationshipRecordContribution({ contributionId } = {}) {
  if (!contributionId) throw new Error("Missing contribution.");
  const { data, error } = await supabase.rpc("dismiss_relationship_record_contribution", {
    p_contribution_id: contributionId,
  });
  return unwrap(data, error);
}

export async function getRelationshipServiceRecord({
  serviceRecordId,
  assetId = null,
  organizationId = null,
  assetRelationshipId = null,
  stewardshipId = null,
} = {}) {
  if (!serviceRecordId) throw new Error("Missing service record.");
  const { data, error } = await supabase.rpc("get_relationship_service_record", {
    p_service_record_id: serviceRecordId,
    p_asset_id: assetId || null,
    p_organization_id: organizationId || null,
    p_asset_relationship_id: assetRelationshipId || null,
    p_stewardship_id: stewardshipId || null,
  });
  return unwrap(data, error);
}
