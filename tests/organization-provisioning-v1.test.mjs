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
  const client = read("lib/keeprAdminApi.js");
  const relationshipsSql = read("supabase/migrations/20260831133000_keepr_admin_org_relationships_v1.sql");

  assert.match(source, /Create Organization/);
  assert.match(source, /ORG_PRESETS/);
  assert.match(source, /key: "oem"/);
  assert.match(source, /key: "dealer"/);
  assert.match(source, /key: "member_team"/);
  assert.match(source, /key: "parent_company"/);
  assert.match(source, /ORG_FILTERS/);
  assert.match(source, /organizationType: orgTypeFilter/);
  assert.match(source, /createKeeprOrganization/);
  assert.doesNotMatch(source, /Create OEM/);
  assert.doesNotMatch(source, /Bennington/);
  assert.doesNotMatch(source, /useState\("Wilson Marine"\)/);
  assert.match(client, /p_organization_type: filters\?\.organizationType/);
  assert.match(relationshipsSql, /when 'parent_company' then jsonb_build_object/);
  assert.match(relationshipsSql, /drop function if exists public\.search_keepr_admin_orgs\(text\)/);
  assert.match(relationshipsSql, /p_organization_type text default null/);
});

test("Keepr Admin models org relationships without customer-specific routes", () => {
  const detail = read("screens/KeeprAdminOrgDetailScreen.js");
  const client = read("lib/keeprAdminApi.js");
  const relationshipsSql = read("supabase/migrations/20260831133000_keepr_admin_org_relationships_v1.sql");

  assert.match(detail, /RELATIONSHIP_TYPES/);
  assert.match(detail, /authorized_dealer/);
  assert.match(detail, /parent_company/);
  assert.match(detail, /searchKeeprAdminOrgs\(relationshipQuery/);
  assert.match(detail, /upsertKeeprAdminOrgRelationship/);
  assert.match(detail, /name: "KeeprSpaceModule"/);
  assert.match(detail, /name: "ActivatorHome"/);
  assert.doesNotMatch(detail, /WilsonHome/);
  assert.match(client, /upsertKeeprAdminOrgRelationship/);
  assert.match(relationshipsSql, /create or replace function public\.upsert_keepr_admin_org_relationship/);
  assert.match(relationshipsSql, /organization\.relationship\.upserted/);
  assert.match(relationshipsSql, /relationships_from/);
  assert.match(relationshipsSql, /relationships_to/);
  assert.match(relationshipsSql, /parent_chain/);
  assert.match(relationshipsSql, /with recursive parent_chain/);
  assert.match(detail, /ParentChain/);
  assert.match(detail, /Parent Company Chain/);
  assert.match(relationshipsSql, /check \(relationship_type in \(/);
});

test("Keepr Admin edits organization classification separately from workspace surface", () => {
  const detail = read("screens/KeeprAdminOrgDetailScreen.js");
  const client = read("lib/keeprAdminApi.js");
  const sql = read("supabase/migrations/20260831143000_keepr_admin_org_classification_v1.sql");

  assert.match(detail, /Organization Classification/);
  assert.match(detail, /ORG_CLASSIFICATIONS/);
  assert.match(detail, /Save Classification/);
  assert.match(detail, /updateKeeprAdminOrgClassification/);
  assert.match(client, /updateKeeprAdminOrgClassification/);
  assert.match(sql, /create or replace function public\.update_keepr_admin_org_classification/);
  assert.match(sql, /organization\.classification\.updated/);
  assert.match(sql, /workspace_type', v_updated\.workspace_type/);
  assert.doesNotMatch(sql, /workspace_type =/);
  assert.match(sql, /when 'dealer' then 'dealer'/);
  assert.match(sql, /when 'oem' then 'manufacturer'/);
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

test("sidebar exposes Keepr Admin from platform-admin authority only", () => {
  const source = read("components/SidebarNav.js");

  assert.match(source, /const KEEPR_ADMIN_ITEM = \{ key: "KeeprAdminHome"/);
  assert.match(source, /supabase\.rpc\("is_keepr_internal_admin"/);
  assert.match(source, /p_user_id: userId/);
  assert.match(source, /setIsInternalAdmin\(!error && data === true\)/);
  assert.match(source, /isInternalAdmin/);
  assert.match(source, /window\.location\.assign\("\/keepr-admin"\)/);
  assert.match(source, /routeName === "KeeprAdminHome" \|\| routeName === "KeeprAdminOrgDetail"/);
  assert.doesNotMatch(source, /user\.email.*keeprhome\.com/);
  assert.doesNotMatch(source, /userRole === "keepr_admin"/);
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
