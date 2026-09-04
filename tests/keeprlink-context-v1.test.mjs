import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("KeeprLINK V1 productizes existing /k links into purpose-scoped ontology context", async () => {
  const helper = await import("../lib/keeprLinkContext.js");
  const api = read("api/k/[kac]/context.js");
  const sql = read("supabase/migrations/20260904110500_keeprlink_context_resolver_v1.sql");

  assert.equal(helper.normalizeKeeprLinkAddress("https://app.keeprhome.com/k/Tiara?purpose=llm_context"), "Tiara");
  assert.equal(helper.normalizeKeeprLinkAddress("/api/k/KAC-TIARA-56LS-KF018/context"), "KAC-TIARA-56LS-KF018");
  assert.equal(helper.normalizeKeeprLinkPurpose("llm_context"), "llm_context");
  assert.equal(helper.normalizeKeeprLinkPurpose("random"), "understand");

  assert.match(api, /\/api\/k\/:kac\/context/);
  assert.match(api, /resolve_keeprlink_context/);
  assert.match(api, /p_purpose: purpose/);
  assert.match(api, /p_system_id: systemId/);
  assert.match(api, /p_authorized: authenticated/);
  assert.match(api, /decorateKeeprLinkProjection/);
  assert.match(api, /isPublicKeeprLinkPurpose/);
  assert.match(api, /authentication_required/);

  assert.match(sql, /create table if not exists public\.keepr_links/);
  assert.match(sql, /object_type text not null/);
  assert.match(sql, /'organization'::text/);
  assert.match(sql, /'asset_model_template'::text/);
  assert.match(sql, /'system_template'::text/);
  assert.match(sql, /'asset'::text/);
  assert.match(sql, /'system_instance'::text/);
  assert.match(sql, /create or replace function public\.resolve_keeprlink_context/);
  assert.match(sql, /keeprlink_compact_address/);
  assert.match(sql, /r\.source_url ~\* '\^https\?:\/\//);
  assert.match(sql, /r\.url ~\* '\^https\?:\/\//);
});

test("public LLM projection strips private owner and storage fields while keeping provenance", async () => {
  const { decorateKeeprLinkProjection } = await import("../lib/keeprLinkContext.js");

  const projection = decorateKeeprLinkProjection(
    {
      ok: true,
      object: {
        type: "asset",
        id: "asset-1",
        kac_id: "KAC-TIARA-56LS-KF018",
        owner_id: "private-owner",
        storage_path: "private/path",
      },
      provenance: [
        {
          source: "asset_resources",
          authority_state: "oem_published",
          title: "Buyer Guide",
          source_url: "https://example.com/buyer-guide.pdf",
          canonical_url: "https://project.supabase.co/storage/v1/object/sign/asset-files/private.pdf?token=secret",
        },
      ],
    },
    { purpose: "llm_context", authenticated: false }
  );

  assert.equal(projection.object.kac_id, "KAC-TIARA-56LS-KF018");
  assert.equal(projection.object.owner_id, undefined);
  assert.equal(projection.object.storage_path, undefined);
  assert.equal(projection.provenance[0].authority_state, "oem_published");
  assert.equal(projection.provenance[0].source_url, "https://example.com/buyer-guide.pdf");
  assert.equal(projection.provenance[0].canonical_url, undefined);
  assert.match(projection.instructions.rules.join(" "), /Do not promote inference/);
  assert.match(projection.instructions.rules.join(" "), /Prefer Keepr-established applicability/);
  assert.match(projection.instructions.rules.join(" "), /Keepr has not established it/);
  assert.match(projection.instructions.rules.join(" "), /missing context/i);
});

test("KeeprLINK SQL extends existing pattern without Tiara-specific runtime branching", () => {
  const sql = read("supabase/migrations/20260904110500_keeprlink_context_resolver_v1.sql");

  assert.match(sql, /KeeprLINK extends the existing \/k\/:\w+/);
  assert.match(sql, /keeprlink_purpose/);
  assert.match(sql, /knowledge_gaps/);
  assert.match(sql, /applicable_resources/);
  assert.match(sql, /applicable_system_templates/);
  assert.match(sql, /Prefer Keepr-established applicability and configuration facts/);
  assert.match(sql, /Keepr has not established it/);
  assert.match(sql, /supplier_org_id/);
  assert.doesNotMatch(sql, /if .*tiara/i);
  assert.doesNotMatch(sql, /KAC-TIARA-56LS-KF018/);
});

test("Core AI Context surface consumes the KeeprLINK resolver contract", () => {
  const surface = read("components/CoreAIContextSurface.js");
  const activator = read("screens/ActivatorHomeScreen.js");

  assert.match(surface, /api\/k\/\$\{encodeURIComponent\(address\)\}\/context/);
  assert.match(surface, /purpose = "llm_context"/);
  assert.match(surface, /context\?purpose=\$\{encodeURIComponent\(purpose\)\}/);
  assert.match(surface, /projection\.models/);
  assert.match(surface, /projection\.applicable_system_templates/);
  assert.match(surface, /projection\.applicable_resources/);
  assert.match(surface, /modelResources/);
  assert.match(surface, /Resources By Model/);
  assert.match(surface, /Organization-Wide Knowledge/);
  assert.match(surface, /organizationResourceComposer/);
  assert.match(surface, /organizationResourceActions/);
  assert.match(surface, /function resourceAttachmentId/);
  assert.match(surface, /function legacyResourceId/);
  assert.match(surface, /const canEditAttachment = actions && resourceAttachmentId\(resource\)/);
  assert.match(surface, /const canDeleteResource = actions && \(resourceAttachmentId\(resource\) \|\| legacyResourceId\(resource\)\)/);
  assert.match(surface, /Supersede/);
  assert.match(surface, /AI off/);
  assert.match(surface, /refreshKey/);
  assert.match(activator, /resource\.source_artifact\?\.attachment_id/);
  assert.match(surface, /projection\.knowledge_gaps/);
  assert.match(surface, /Copy for AI/);
  assert.match(surface, /Purpose ladder: understand, LLM context, Keepr enablement, self service/);
  assert.doesNotMatch(surface, /from \"\\.\\.\/lib\/attachmentsApi\"/);
  assert.doesNotMatch(surface, /from\\(\"attachments\"\\)/);
  assert.doesNotMatch(surface, /listAssetAIContextSources/);

  assert.match(activator, /import CoreAIContextSurface/);
  assert.match(activator, /templateSubview === "aiContext"/);
  assert.match(activator, /templateSubview === "resources"/);
  assert.match(activator, /<CoreAIContextSurface/);
  assert.match(activator, /OrgResourceComposer/);
  assert.match(activator, /Add organization-wide resource/);
  assert.match(activator, /Edit organization-wide resource/);
  assert.match(activator, /target_type: "org"/);
  assert.match(activator, /orgResourceAiMetadata/);
  assert.match(activator, /supersedeOrgResource/);
  assert.match(activator, /disableOrgResourceAI/);
  assert.match(activator, /deleteOrgResource/);
  assert.match(activator, /legacyAssetResourceId/);
  assert.match(activator, /\.from\("asset_resources"\)/);
  assert.match(activator, /deleted_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(activator, /sort_order: Date\.now\(\)/);
  assert.match(activator, /keeprLinkAddressFromOrgIdentity/);
});

test("KeeprLINK resource projection bridges attachment-backed model resources", () => {
  const sql = read("supabase/migrations/20260904131500_keeprlink_attachment_backed_model_resources.sql");

  assert.match(sql, /attachment_placements ap/);
  assert.match(sql, /join public\.attachments a on a\.id = ap\.attachment_id/);
  assert.match(sql, /when p_applies_to_type = 'template' then 'model_template'/);
  assert.match(sql, /a\.ai_metadata ->> 'ai_context'/);
  assert.match(sql, /in \('primary', 'supporting'\)/);
  assert.match(sql, /source_artifact/);
  assert.match(sql, /attachment_id', case when not p_public_only/);
  assert.doesNotMatch(sql, /storage_path/);
  assert.doesNotMatch(sql, /signed_url/i);
});

test("organization-wide resources can be placed on org targets", () => {
  const sql = read("supabase/migrations/20260904133500_org_attachment_placements.sql");
  const policies = read("supabase/migrations/20260904134500_org_resource_attachment_policies.sql");
  const lifecyclePolicies = read("supabase/migrations/20260904135500_org_resource_attachment_lifecycle_policies.sql");

  assert.match(sql, /attachment_placements_target_type_check/);
  assert.match(sql, /'org'::text/);
  assert.match(sql, /model_template/);
  assert.match(sql, /system_template/);
  assert.match(policies, /Org members create org attachment placements/);
  assert.match(policies, /target_type = 'org'/);
  assert.match(policies, /keepr_attachment_owned_by_user\(auth\.uid\(\), attachment_id\)/);
  assert.match(policies, /activator_user_can_act_for_org\(auth\.uid\(\), target_id\)/);
  assert.match(lifecyclePolicies, /Org members update org resource attachments/);
  assert.match(lifecyclePolicies, /ap\.target_type = 'org'/);
  assert.match(lifecyclePolicies, /activator_user_can_act_for_org\(auth\.uid\(\), ap\.target_id\)/);
});

test("organization resources can delete legacy asset_resource descriptors", () => {
  const policy = read("supabase/migrations/20260904142000_asset_resource_descriptor_delete_policy.sql");

  assert.match(policy, /grant delete on public\.asset_resources to authenticated/);
  assert.match(policy, /Org members delete owned resource descriptors/);
  assert.match(policy, /applies_to_type = 'org'/);
  assert.match(policy, /asset_model_templates t/);
  assert.match(policy, /asset_resources\.applies_to_type = 'template'/);
  assert.match(policy, /activator_user_can_act_for_org\(auth\.uid\(\), t\.organization_id\)/);
});

test("Tiara OEM shell keeps bundled header and logo when org media fields are empty", () => {
  const activator = read("screens/ActivatorHomeScreen.js");
  const fallbacks = read("lib/orgBrandFallbacks.js");

  assert.match(activator, /getOrgBrandMediaFallback/);
  assert.match(fallbacks, /tiara_oem_logo\.png/);
  assert.match(fallbacks, /tiara_oem_banner\.png/);
  assert.match(fallbacks, /bundledAssetUri\(TIARA_MEDIA\.logo\)/);
  assert.match(fallbacks, /bundledAssetUri\(TIARA_MEDIA\.banner\)/);
  assert.match(activator, /logoUri: context\.logo_url \|\| context\.photo_url \|\| fallback\.logoUri/);
  assert.match(activator, /headerImageUri: context\.header_image_url \|\| context\.team_photo_url \|\| fallback\.headerImageUri/);
  assert.match(activator, /logoUri: pro\.logo_url \|\| org\.logo_url \|\| org\.photo_url \|\| fallback\.logoUri/);
  assert.match(activator, /headerImageUri: pro\.header_image_url \|\| org\.header_image_url \|\| org\.team_photo_url \|\| fallback\.headerImageUri/);
});

test("Tiara KeeprLINK taxonomy covers organization and model address aliases without renaming templates", () => {
  const taxonomy = read("supabase/migrations/20260904113500_tiara_keeprlink_taxonomy_v1.sql");

  assert.match(taxonomy, /tiara_model_taxonomy/);
  assert.match(taxonomy, /\/k\/tiara-/);
  assert.match(taxonomy, /\/k\/tiarayachts-/);
  assert.match(taxonomy, /\/k\/tiara-yachts-/);
  assert.match(taxonomy, /\/k\/TiaraYachts/);
  assert.match(taxonomy, /object_type,\s*object_id/);
  assert.match(taxonomy, /asset_model_template/);
  assert.match(taxonomy, /jsonb_build_object\([\s\S]*'ai_context'/);
  assert.match(taxonomy, /'role', rr\.role/);
  assert.match(taxonomy, /'review_state', rr\.review_state/);
  assert.match(taxonomy, /'status', 'included'/);
  assert.match(taxonomy, /Primary/);
  assert.match(taxonomy, /Supporting/);
  assert.match(taxonomy, /public_safe/);
  assert.match(taxonomy, /internal_private/);
  assert.match(taxonomy, /knowledge_gaps/);
  assert.doesNotMatch(taxonomy, /update public\.asset_model_templates[\s\S]*set template_key/i);
});

test("org workspaces take precedence over personal onboarding for OEM and Dealer users", () => {
  const app = read("App.js");
  const workspaceContext = read("context/WorkspaceContext.js");
  const migration = read("supabase/migrations/20260904122500_org_workspace_precedes_personal_on_entry.sql");

  assert.match(app, /const hasOrgWorkspace =/);
  assert.match(app, /shouldShowOnboarding && !isOrgWorkspaceActive && !hasOrgWorkspace/);
  assert.match(workspaceContext, /function isOrgEntryWebPath/);
  assert.match(workspaceContext, /shouldPreferOrgEntry/);
  assert.match(workspaceContext, /firstOrgWorkspace\.workspace_id/);
  assert.match(migration, /active_workspace_id/);
  assert.match(migration, /v_org_workspaces -> 0 ->> 'workspace_id'/);
  assert.match(migration, /jsonb_build_array\(v_personal\) \|\| coalesce\(v_org_workspaces/);
});

test("organization relationships resolve existing orgs before create fallback", () => {
  const api = read("lib/keeprspaceApi.js");
  const activator = read("screens/ActivatorHomeScreen.js");
  const migration = read("supabase/migrations/20260904124500_keeprspace_organization_resolution_v1.sql");

  assert.match(api, /searchKeeprSpaceOrganizations/);
  assert.match(api, /search_keeprspace_organizations/);
  assert.match(activator, /function OrgResolutionPanel/);
  assert.match(activator, /Search Keepr before creating a new relationship target/);
  assert.match(activator, /to_org_id: org\.id/);
  assert.match(activator, /Connect selected organization/);
  assert.match(activator, /upsertKeeprSpaceOrgRelationship/);
  assert.match(migration, /create or replace function public\.search_keeprspace_organizations/);
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.match(migration, /grant execute on function public\.search_keeprspace_organizations\(text, text\) to authenticated/);
  assert.doesNotMatch(migration, /is_keepr_internal_admin/);
});
