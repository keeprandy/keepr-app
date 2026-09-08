import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Supplier V1 projects canonical Organizations through relationships and System Templates", () => {
  const sql = read("supabase/migrations/20260908100000_supplier_graph_projection_v1.sql");

  assert.match(sql, /No supplier-local table is introduced/);
  assert.doesNotMatch(sql, /create table if not exists public\.suppliers/i);
  assert.doesNotMatch(sql, /create table if not exists public\.supplier_profiles/i);
  assert.match(sql, /public\.org_relationships/);
  assert.match(sql, /'supplier'/);
  assert.match(sql, /'system_supplier'/);
  assert.match(sql, /'component_supplier'/);
  assert.match(sql, /public\.system_templates \(owner_org_id, supplier_org_id\)/);
  assert.match(sql, /public\.asset_model_template_items \(template_id, system_template_id\)/);
  assert.match(sql, /create or replace function public\.list_organization_supplier_network/);
  assert.match(sql, /public\.activator_user_can_act_for_org\(auth\.uid\(\), p_organization_id\)/);
  assert.match(sql, /st\.supplier_org_id = o\.id/);
  assert.match(sql, /template\.organization_id = p_organization_id/);
  assert.match(sql, /public\.asset_relationship_edges/);
  assert.match(sql, /Connected org members create supplier attachment placements/);
  assert.match(sql, /public\.keepr_attachment_owned_by_user\(auth\.uid\(\), attachment_id\)/);
  assert.match(sql, /r\.to_org_id = attachment_placements\.target_id/);
  assert.doesNotMatch(sql, /min\(s\.relationship_id\)/);
  assert.doesNotMatch(sql, /o\.logo_url/);
  assert.doesNotMatch(sql, /o\.website/);
  assert.doesNotMatch(sql, /o\.phone/);
  assert.doesNotMatch(sql, /o\.email/);
  assert.match(sql, /grant execute on function public\.list_organization_supplier_network/);
});

test("Supplier V1 seeds shared fixture suppliers without duplicating by OEM", () => {
  const sql = read("supabase/migrations/20260908100000_supplier_graph_projection_v1.sql");

  assert.equal((sql.match(/'mercury-marine'/g) || []).length, 2);
  assert.equal((sql.match(/'seakeeper'/g) || []).length, 2);
  assert.equal((sql.match(/'cummins-onan'/g) || []).length, 2);
  assert.match(sql, /where lower\(slug\) = 'tiara-yachts'/);
  assert.match(sql, /where lower\(slug\) = 'bennington'/);
  assert.match(sql, /values\s*\(\s*v_bennington_id, v_mercury_id, 'supplier'/);
});

test("OEM Supplier nav uses the shared lookup/profile pattern", () => {
  const activator = read("screens/ActivatorHomeScreen.js");
  const api = read("lib/activatorApi.js");

  assert.match(api, /export async function listSupplierNetwork/);
  assert.match(api, /supabase\.rpc\("list_organization_supplier_network"/);
  assert.match(activator, /function SupplierNetworkPanel/);
  assert.match(activator, /<OrgResolutionPanel/);
  assert.match(activator, /upsertKeeprSpaceOrgRelationship/);
  assert.match(activator, /relationship_basis: "organization_resolution"/);
  assert.match(activator, /isSupplierNetworkView = routeNavSection === "ActivatorSuppliers"/);
  assert.match(activator, /<SupplierNetworkPanel/);
  assert.doesNotMatch(activator, /SupplierStack/);
});

test("System Library links templates to supplier Organizations without replacing provider text", () => {
  const systemLibrary = read("screens/SystemLibraryScreen.js");
  const api = read("lib/activatorApi.js");

  assert.match(systemLibrary, /supplierOrgId: null/);
  assert.match(systemLibrary, /template\?\.supplier_org_id/);
  assert.match(systemLibrary, /listSupplierNetwork/);
  assert.match(systemLibrary, /Canonical supplier Organization/);
  assert.match(systemLibrary, /Attach to/);
  assert.match(systemLibrary, /placeOnSystemTemplate/);
  assert.match(systemLibrary, /placeOnSupplier/);
  assert.match(systemLibrary, /placeOnOem/);
  assert.match(systemLibrary, /target_type: "system_template"/);
  assert.match(systemLibrary, /target_type: "org"/);
  assert.match(systemLibrary, /placement_targets/);
  assert.match(systemLibrary, /Manufacturer \/ provider text remains for compatibility/);
  assert.match(systemLibrary, /supplierOrgId: draft\.supplierOrgId \|\| null/);
  assert.match(systemLibrary, /navSection: "ActivatorSuppliers"/);
  assert.match(api, /supplier_org_id: input\.supplierOrgId \|\| null/);
});
