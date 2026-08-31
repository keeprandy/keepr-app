import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("owner handoff reuses asset_relationships and keeps the same asset/KAC", () => {
  const sql = read("supabase/migrations/20260831170000_owner_handoff_same_kac_v1.sql");

  assert.match(sql, /create or replace function public\.initiate_asset_owner_handoff/);
  assert.match(sql, /create or replace function public\.accept_asset_owner_handoff/);
  assert.match(sql, /create or replace function public\.list_pending_asset_owner_handoffs/);
  assert.match(sql, /insert into public\.asset_relationships/);
  assert.match(sql, /relationship_type,[\s\S]*'owner'/);
  assert.match(sql, /'transfer_workspace'/);
  assert.match(sql, /'owner_full'/);
  assert.match(sql, /pending_owner_email/);
  assert.match(sql, /update public\.assets[\s\S]*owner_id = v_user_id/);
  assert.doesNotMatch(sql, /insert into public\.assets/);
  assert.doesNotMatch(sql, /create table if not exists public\.asset_owner_handoffs/);
});

test("dealer handoff requires an active dealer relationship and preserves dealer participation", () => {
  const sql = read("supabase/migrations/20260831170000_owner_handoff_same_kac_v1.sql");

  assert.match(sql, /relationship_type in \('assigned_dealer', 'selling_dealer', 'delivery_dealer'\)/);
  assert.match(sql, /public\.activator_user_can_act_for_org\(v_actor_user_id, ar\.organization_id\)/);
  assert.doesNotMatch(sql, /relationship_type in \('assigned_dealer', 'selling_dealer', 'delivery_dealer'\)[\s\S]{0,240}status = 'ended'/);
});

test("UI exposes dealer initiation and owner acceptance without replacing ownership surfaces", () => {
  const detail = read("screens/KeeprProStewardshipViewScreen.js");
  const dashboard = read("screens/DashboardScreen.js");
  const api = read("lib/keeprspaceApi.js");

  assert.match(api, /initiateAssetOwnerHandoff/);
  assert.match(api, /acceptAssetOwnerHandoff/);
  assert.match(api, /listPendingAssetOwnerHandoffs/);
  assert.match(detail, /Start Owner Handoff/);
  assert.match(detail, /projectionSemantics\.showInventoryActions/);
  assert.match(dashboard, /Owner Handoff/);
  assert.match(dashboard, /acceptOwnerHandoff/);
  assert.match(dashboard, /refetchBoats/);
});
