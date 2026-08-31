import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("organization provisioning uses one org primitive with presets", () => {
  const sql = read("supabase/migrations/20260828150000_organization_provisioning_v1.sql");
  const hardeningSql = read("supabase/migrations/20260828154500_organization_provisioning_v1_hardening.sql");
  const catalogAuthoritySql = read("supabase/migrations/20260828162500_catalog_truth_requires_catalog_capability.sql");
  const ownerGuardSql = read("supabase/migrations/20260828161500_organization_provisioning_member_owner_guard.sql");
  const roleCompatSql = read("supabase/migrations/20260828162000_organization_provisioning_member_role_compat.sql");
  const api = read("api/keepr-admin/create-organization.js");
  const client = read("lib/keeprAdminApi.js");

  assert.match(sql, /create or replace function public\.create_keepr_organization/);
  assert.match(sql, /create or replace function public\.keepr_org_preset_config/);
  assert.match(hardeningSql, /create or replace function public\.keepr_unique_template_key/);
  assert.match(sql, /when 'oem' then jsonb_build_object/);
  assert.match(sql, /when 'dealer' then jsonb_build_object/);
  assert.match(sql, /when 'member_team' then jsonb_build_object/);
  assert.match(sql, /'workspace_type', 'keeproem'/);
  assert.match(sql, /'workspace_type', 'keeprdealer'/);
  assert.match(sql, /'workspace_type', 'org'/);
  assert.match(sql, /insert into public\.orgs/);
  assert.match(sql, /insert into public\.org_members/);
  assert.match(sql, /insert into public\.org_activations/);
  assert.match(ownerGuardSql, /ensure_provisioned_org_member_owner/);
  assert.match(ownerGuardSql, /owner_user_id = coalesce\(owner_user_id, new\.user_id\)/);
  assert.match(roleCompatSql, /new\.member_role := 'owner'/);

  assert.match(api, /create_keepr_organization/);
  assert.match(api, /plan: "team"/);
  assert.match(api, /preset/);
  assert.doesNotMatch(api, /create_oem_organization/);
  assert.match(client, /createKeeprOrganization/);
  assert.match(client, /api\/keepr-admin\/create-organization/);
});

test("catalog authoring requires owner, admin, or manager roles", () => {
  const sql = read("supabase/migrations/20260828150000_organization_provisioning_v1.sql");
  const hardeningSql = read("supabase/migrations/20260828154500_organization_provisioning_v1_hardening.sql");
  const catalogAuthoritySql = read("supabase/migrations/20260828162500_catalog_truth_requires_catalog_capability.sql");

  assert.match(sql, /activator_user_can_author_for_org/);
  assert.match(catalogAuthoritySql, /activator_user_can_author_catalog_for_org/);
  assert.match(catalogAuthoritySql, /model_catalog/);
  assert.match(catalogAuthoritySql, /not allowed to author reusable catalog truth for this organization/);
  assert.match(sql, /in \('owner', 'admin', 'manager'\)/);
  assert.doesNotMatch(sql, /in \('owner', 'admin', 'manager', 'member'/);
  assert.match(sql, /create policy "Org authors manage templates"/);
  assert.match(sql, /create policy "Org authors manage catalog template drafts"/);
  assert.match(sql, /create policy "Org authors manage exact build drafts"/);
  assert.match(sql, /create policy "Org authors manage exact build draft items"/);
  assert.match(sql, /activator_user_can_manage_template[\s\S]*activator_user_can_author_for_org/);
  assert.match(sql, /create or replace function public\.create_org_model_template/);
  assert.match(hardeningSql, /public\.keepr_unique_template_key\(v_template_key, 1\)/);
  assert.match(sql, /not allowed to author catalog for this organization/);
});

test("admin home creates generic organizations without OEM-specific branching", () => {
  const source = read("screens/KeeprAdminHomeScreen.js");

  assert.match(source, /Create Organization/);
  assert.match(source, /ORG_PRESETS/);
  assert.match(source, /key: "oem"/);
  assert.match(source, /key: "dealer"/);
  assert.match(source, /key: "member_team"/);
  assert.match(source, /createKeeprOrganization/);
  assert.doesNotMatch(source, /Create OEM/);
  assert.doesNotMatch(source, /Bennington/);
});

test("Keepr Admin route bypasses customer workspace and personal onboarding gates", () => {
  const source = read("App.js");

  assert.equal(source.includes('path.startsWith("/keepr-admin/org/")'), true);
  assert.equal(source.includes('path === "/keepr-admin" || path.startsWith("/keepr-admin/")'), true);
  assert.match(source, /const isKeeprAdminWebPathRoute =/);
  assert.match(source, /isKeeprAdminWebPathRoute\s*\?\s*currentWebPathRoute/);
  assert.match(source, /webRoute === "KeeprAdminHome" \|\| webRoute === "KeeprAdminOrgDetail"/);
  assert.match(source, /isOrgWorkspaceActive && currentWebPathRoute/);
  assert.equal(source.includes('path.startsWith("/keepr-admin")'), true);
});

test("generic OEM shell does not use Tiara fallback catalog or brand assumptions", () => {
  const source = read("screens/ActivatorHomeScreen.js");

  for (const forbidden of [
    "TIARA_OEM_BANNER",
    "TIARA_OEM_LOGO",
    "TIARA_MODEL_CATALOG",
    "DEMO_BUILDS_IN_PROGRESS",
    "DEMO_PRODUCTION_STATUS",
    "draftForCatalogModel",
    "getActivatorSeedOrgs",
  ]) {
    assert.equal(source.includes(forbidden), false, `found forbidden fallback ${forbidden}`);
  }

  assert.match(source, /No models are in this organization's catalog yet/);
  assert.match(source, /Create Model/);
  assert.match(source, /createOrgModelTemplate/);
  assert.match(source, /canAuthorCatalog/);
  assert.match(source, /workspaceHasCapability\(currentWorkspace, "model_catalog"\)/);
  assert.match(source, /\["owner", "admin", "manager"\]/);
  assert.match(source, /Only org owners, admins, and managers can author reusable catalog models/);
});

test("catalog template detail exposes editable model identity without Tiara text fallbacks", () => {
  const source = read("screens/ActivatorCatalogTemplateScreen.js");

  assert.match(source, /Catalog Identity/);
  assert.match(source, /saveTemplateIdentity/);
  assert.match(source, /setIdentityModalVisible\(true\)/);
  assert.match(source, /Edit Details/);
  assert.match(source, /onPress=\{\(\) => customizeTemplate\(\)\}/);
  assert.match(source, /manufacturer: nextManufacturer/);
  assert.match(source, /model: nextModel/);
  assert.match(source, /model_year: nextModelYear/);
  assert.doesNotMatch(source, /template\.manufacturer \|\| "Tiara Yachts"/);
  assert.doesNotMatch(source, /template\.model \|\| "39 LE"/);
});
