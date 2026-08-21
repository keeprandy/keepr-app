import { supabase } from "./supabaseClient";

const OWNER_RELATIONSHIP_TYPE = "owner";
const OWNER_ACCESS_SCOPE = "owner_full";

function mergeMetadata(base, next) {
  return {
    ...((base && typeof base === "object" && !Array.isArray(base)) ? base : {}),
    ...next,
  };
}

export async function reconcileAcceptedAssetTransfer({
  assetId,
  previousOwnerId,
  newOwnerId,
  transferId,
}) {
  if (!assetId || !newOwnerId) return { ok: false, skipped: true };

  const now = new Date().toISOString();
  const { data: relationships, error: readError } = await supabase
    .from("asset_relationships")
    .select("id, user_id, status, metadata")
    .eq("asset_id", assetId)
    .eq("relationship_type", OWNER_RELATIONSHIP_TYPE);

  if (readError) throw readError;

  const rows = Array.isArray(relationships) ? relationships : [];
  const staleActiveOwners = rows.filter(
    (row) => row.status === "active" && row.user_id && row.user_id !== newOwnerId
  );

  await Promise.all(
    staleActiveOwners.map((row) =>
      supabase
        .from("asset_relationships")
        .update({
          status: "ended",
          effective_to: now,
          updated_at: now,
          metadata: mergeMetadata(row.metadata, {
            source: row.metadata?.source || "asset_transfer",
            former_owner: true,
            ownership_ended_at: now,
            ownership_transfer_id: transferId || null,
            ownership_transferred_to_user_id: newOwnerId,
          }),
        })
        .eq("id", row.id)
    )
  ).then((results) => {
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  });

  if (previousOwnerId && previousOwnerId !== newOwnerId) {
    const { error: stewardshipError } = await supabase
      .from("asset_stewardships")
      .update({
        active: false,
        ends_at: now,
      })
      .eq("asset_id", assetId)
      .eq("user_id", previousOwnerId)
      .eq("active", true);
    if (stewardshipError) throw stewardshipError;
  }

  const existingNewOwner = rows.find((row) => row.user_id === newOwnerId);
  if (existingNewOwner) {
    const { error } = await supabase
      .from("asset_relationships")
      .update({
        status: "active",
        access_scope: OWNER_ACCESS_SCOPE,
        claim_state: "accepted",
        effective_to: null,
        updated_at: now,
        metadata: mergeMetadata(existingNewOwner.metadata, {
          source: "asset_transfer",
          current_owner: true,
          ownership_started_at: now,
          ownership_transfer_id: transferId || null,
          previous_owner_user_id: previousOwnerId || null,
        }),
      })
      .eq("id", existingNewOwner.id);
    if (error) throw error;
    return { ok: true, mode: "updated_existing_owner_relationship" };
  }

  const { error } = await supabase.from("asset_relationships").insert({
    asset_id: assetId,
    user_id: newOwnerId,
    relationship_type: OWNER_RELATIONSHIP_TYPE,
    status: "active",
    access_scope: OWNER_ACCESS_SCOPE,
    claim_state: "accepted",
    effective_from: now,
    initiated_by_user_id: newOwnerId,
    metadata: {
      source: "asset_transfer",
      current_owner: true,
      ownership_started_at: now,
      ownership_transfer_id: transferId || null,
      previous_owner_user_id: previousOwnerId || null,
    },
  });
  if (error) throw error;

  return { ok: true, mode: "inserted_owner_relationship" };
}
