import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Boat Showcase composes inherited model media with exact-KAC media", () => {
  const source = read("screens/BoatShowcaseScreen.js");

  assert.match(source, /listAttachmentsForAsset\(currentBoat\.id,\s*\{\s*includeInheritedModelMedia: true,/);
  assert.doesNotMatch(source, /listAttachmentsForTarget\("asset", currentBoat\.id\)/);
  assert.match(source, /showcaseLayerFor/);
  assert.match(source, /OEM model media/);
  assert.match(source, /Dealer media/);
  assert.match(source, /Owner media/);
});

test("Inherited model media remains delete-safe in KAC Showcase", () => {
  const source = read("screens/BoatShowcaseScreen.js");

  assert.match(source, /photo\.isInheritedModelMedia/);
  assert.match(source, /It was not copied onto the boat/);
  assert.match(source, /readOnlyBadge/);
  assert.match(source, /Inherited/);
});

test("First exact-KAC showcase photo does not silently persist hero state", () => {
  const source = read("screens/BoatShowcaseScreen.js");

  assert.doesNotMatch(source, /const exactAssetGallery = gallery\.filter/);
  assert.doesNotMatch(source, /exactAssetGallery\.length === 1/);
  assert.doesNotMatch(source, /gallery\.length === 1 && gallery\[0\]\?\.placement_id/);
  assert.doesNotMatch(source, /auto-promote/);
  assert.match(source, /handleSetHero/);
});

test("Attachment API already preserves inherited model media provenance", () => {
  const source = read("lib/attachmentsApi.js");

  assert.match(source, /async function listInheritedTemplateMediaForAsset/);
  assert.match(source, /async function listTemplatesFromAssetMetadata/);
  assert.match(source, /catalog_template_id/);
  assert.match(source, /catalog_template_key/);
  assert.match(source, /extra_metadata/);
  assert.match(source, /target_type", "model_template"/);
  assert.match(source, /is_inherited_model_media: true/);
  assert.match(source, /not_exact_hull_media: true/);
  assert.match(source, /return \[\.\.\.directRows, \.\.\.inheritedOnly\]/);
});

test("General attachment surfaces do not inherit model media by default", () => {
  const source = read("lib/attachmentsApi.js");

  assert.match(source, /export async function listAttachmentsForAsset\(assetId, options = \{\}\)/);
  assert.match(source, /const includeInheritedModelMedia = !!options\.includeInheritedModelMedia/);
  assert.match(source, /const includeInheritedModelAttachments = !!options\.includeInheritedModelAttachments/);
  assert.match(source, /const includeInheritedTemplateAttachments = includeInheritedModelAttachments \|\| includeInheritedModelMedia/);
  assert.match(source, /if \(!includeInheritedTemplateAttachments\) return directRows/);
  assert.match(source, /mediaOnly: includeInheritedModelMedia && !includeInheritedModelAttachments/);
});

test("Asset attachment screen can filter composed KAC media by contributor lane", () => {
  const source = read("screens/AssetAttachmentsScreen.js");
  const hook = read("hooks/useAttachments.js");

  assert.match(source, /const \[sourceFilter, setSourceFilter\] = useState\("all"\)/);
  assert.match(source, /function sourceLaneForAttachment/);
  assert.match(source, /is_inherited_model_media[\s\S]*return "oem"/);
  assert.match(source, /is_inherited_model_attachment/);
  assert.match(source, /source_lane_label: sourceLaneLabel\(sourceLane\)/);
  assert.match(source, /const includeInheritedModelMedia = \["all", "photo", "showcase"\]\.includes\(tab\)/);
  assert.match(source, /const includeInheritedModelAttachments = \["all", "file", "showcase"\]\.includes\(tab\)/);
  assert.match(source, /useAssetAttachments\(assetId,\s*\{\s*includeInheritedModelMedia,/);
  assert.match(source, /includeInheritedModelAttachments,/);
  assert.match(source, /\["all", "All sources"\]/);
  assert.match(source, /\["oem", "OEM"\]/);
  assert.match(source, /\["dealer", "Dealer"\]/);
  assert.match(source, /\["owner", "Owner"\]/);
  assert.match(source, /styles\.sourceLanePill/);
  assert.match(hook, /listAttachmentsForAsset\(targetId,\s*\{[\s\S]*includeInheritedModelMedia,[\s\S]*includeInheritedModelAttachments,/);
});

test("Model resources are attachment-backed and inherit to KACs", () => {
  const catalog = read("screens/ActivatorCatalogTemplateScreen.js");
  const api = read("lib/attachmentsApi.js");

  assert.match(catalog, /MODEL_RESOURCE_ROLES/);
  assert.match(catalog, /\{ key: "Manual", label: "Manual" \}/);
  assert.match(catalog, /\{ key: "Warranty", label: "Warranty" \}/);
  assert.match(catalog, /\{ key: "Spec Sheet", label: "Spec Sheet" \}/);
  assert.match(catalog, /\{ key: "Install Guide", label: "Install Guide" \}/);
  assert.match(catalog, /function normalizeModelResourceRole/);
  assert.match(catalog, /ai_context: \["Manual", "Warranty", "Spec Sheet"\]\.includes/);
  assert.match(catalog, /hydrateTemplateAttachmentResources/);
  assert.match(catalog, /createLinkAttachment/);
  assert.match(catalog, /uploadTemplateResourceFile/);
  assert.match(catalog, /target_type: "model_template"[\s\S]*role,/);
  assert.match(catalog, /provenance: "model_template"/);
  assert.match(catalog, /provided_by_label/);
  assert.match(catalog, /authored_by_label/);
  assert.doesNotMatch(catalog, /\.from\("asset_resources"\)\s*\.insert/);
  assert.match(api, /normalizeTemplateAttachmentPlacement/);
  assert.match(api, /is_inherited_model_attachment: true/);
  assert.match(api, /listAssetAIContextSources[\s\S]*includeInheritedModelAttachments: true/);
});

test("Model resource roles can be changed using Proof Builder vocabulary", () => {
  const catalog = read("screens/ActivatorCatalogTemplateScreen.js");
  const attachments = read("screens/AssetAttachmentsScreen.js");

  assert.match(catalog, /onChangeResourceRole/);
  assert.match(catalog, /const changeTemplateResourceRole = async/);
  assert.match(catalog, /\.from\("attachment_placements"\)[\s\S]*\.update\(\{ role: nextRole \}\)/);
  assert.match(catalog, /updateTemplateResourceMetadata\(attachmentId, nextRole, nextSourceContext\)/);
  assert.match(catalog, /templateResourceSourceContext\(nextRole/);
  assert.match(attachments, /\{ id: "manual", label: "Manual" \}/);
  assert.match(attachments, /owner_manual[\s\S]*return "manual"/);
});

test("Proof Builder can load dealer-visible attachments through asset projection fallback", () => {
  const proofBuilder = read("screens/ProofBuilderScreen.js");

  assert.match(proofBuilder, /listAttachmentsForAsset/);
  assert.match(proofBuilder, /listAttachmentsForTarget/);
  assert.match(proofBuilder, /includeInheritedModelAttachments: true/);
  assert.match(proofBuilder, /includeInheritedModelMedia: true/);
  assert.match(proofBuilder, /visibleAttachments[\s\S]*\.find\(\(row\) => \(row\.attachment_id \|\| row\.id\) === attachmentId\)/);
  assert.match(proofBuilder, /routeTargetType === "model_template" && routeTargetId/);
  assert.match(proofBuilder, /visibleTemplateAttachments[\s\S]*\.find\(\(row\) => \(row\.attachment_id \|\| row\.id\) === attachmentId\)/);
  assert.match(proofBuilder, /safeStr\(route\?\.params\?\.role\)/);
  assert.match(proofBuilder, /safeStr\(att\?\.asset_role\)/);
});

test("OEM model resources can open Proof Builder at model-template scope", () => {
  const catalog = read("screens/ActivatorCatalogTemplateScreen.js");
  const proofBuilder = read("screens/ProofBuilderScreen.js");

  assert.match(catalog, /const openTemplateResourceProofBuilder = \(resource\) =>/);
  assert.match(catalog, /navigation\.navigate\("ProofBuilder"[\s\S]*targetType: "model_template"/);
  assert.match(catalog, /targetId: template\.id/);
  assert.match(catalog, /returnRoute: "ActivatorCatalogTemplate"/);
  assert.match(catalog, /templateKey: template\.template_key \|\| templateKey/);
  assert.match(proofBuilder, /routeTargetType === "model_template"[\s\S]*\.update\(\{ role: roleValue \|\| "Other" \}\)/);
  assert.match(proofBuilder, /\.eq\("target_type", "model_template"\)/);
});

test("Public KAC source manifest includes inherited AI-enabled model resources", () => {
  const sourceRoute = read("api/k/[kac]/source.js");

  assert.match(sourceRoute, /async function listTemplatesForAsset/);
  assert.match(sourceRoute, /asset_template_bindings/);
  assert.match(sourceRoute, /collectTemplateRefsFromAsset/);
  assert.match(sourceRoute, /\.eq\("target_type", "model_template"\)/);
  assert.match(sourceRoute, /\.in\("target_id", templateIds\)/);
  assert.match(sourceRoute, /inherited_from_model: row\.target_type === "model_template"/);
  assert.match(sourceRoute, /provenance_label: sourceContext\.provenance_label/);
  assert.match(sourceRoute, /listAuthorizedAISources\(sourceSupabase, asset,/);
});

test("Public KAC source-file route can serve inherited model resource files", () => {
  const sourceFileRoute = read("api/k/[kac]/source-file/[attachmentId].js");

  assert.match(sourceFileRoute, /async function listTemplateIdsForAsset/);
  assert.match(sourceFileRoute, /asset_template_bindings/);
  assert.match(sourceFileRoute, /collectTemplateRefsFromAsset/);
  assert.match(sourceFileRoute, /\.eq\("target_type", "model_template"\)/);
  assert.match(sourceFileRoute, /\.in\("target_id", templateIds\)/);
  assert.match(sourceFileRoute, /inheritedModelPlacement/);
  assert.match(sourceFileRoute, /streamStorageAttachment/);
  assert.match(sourceFileRoute, /aiContext === "off" \|\| isPrivatePrivacy\(privacy\)/);
});

test("Workspace-context boat actions use projection-safe edit and hero paths", () => {
  const showcase = read("screens/BoatShowcaseScreen.js");
  const story = read("screens/BoatStoryScreen.js");
  const workspace = read("screens/KeeprProStewardshipViewScreen.js");
  const keeprspaceApi = read("lib/keeprspaceApi.js");

  assert.match(showcase, /setKeeprSpaceAssetHero/);
  assert.match(showcase, /if \(routeOrganizationId\) \{[\s\S]*navigation\.navigate\("KeeprSpaceBoat"/);
  assert.match(story, /if \(organizationId\) \{[\s\S]*navigation\.navigate\("KeeprSpaceBoat"/);
  assert.match(workspace, /route\?\.params\?\.openEdit/);
  assert.match(workspace, /setShowBoatEdit\(true\)/);
  assert.match(keeprspaceApi, /rpc\("set_asset_hero_placement"/);
  assert.doesNotMatch(keeprspaceApi, /rpc\("set_asset_relationship_hero_placement"/);
});

test("Personal EditAsset avoids single-row coercion failures", () => {
  const source = read("screens/EditAssetScreen.js");

  assert.doesNotMatch(source, /\.eq\("id", assetId\)\s*\.single\(\)/);
  assert.match(source, /\.eq\("id", assetId\)\s*\.maybeSingle\(\)/);
  assert.match(source, /This asset is not available to edit from this account/);
  assert.match(source, /Could not reach Keepr to save this asset/);
});

test("Attachment routes keep return context flat on web", () => {
  const attachments = read("screens/AssetAttachmentsScreen.js");
  const workspace = read("screens/KeeprProStewardshipViewScreen.js");
  const proofBuilder = read("screens/ProofBuilderScreen.js");

  assert.doesNotMatch(workspace, /returnParams:\s*\{/);
  assert.doesNotMatch(attachments, /returnParams:\s*\{\s*assetId,\s*assetName\s*\}/);
  assert.match(attachments, /const editContextForRow = useCallback/);
  assert.equal((attachments.match(/navigation\.navigate\("ProofBuilder"/g) || []).length, 1);
  assert.match(attachments, /returnRoute: "AssetAttachments"[\s\S]*assetName,[\s\S]*organizationId,/);
  assert.match(proofBuilder, /typeof route\.params\.returnParams === "object"/);
  assert.match(proofBuilder, /organizationId: route\?\.params\?\.organizationId/);
});

test("KAC media writes allow operational asset relationship scopes only", () => {
  const migration = read("supabase/migrations/20260831193000_asset_relationship_media_write_scopes.sql");

  assert.match(migration, /from public\.asset_relationships r/);
  assert.match(migration, /r\.asset_id = p_asset_id/);
  assert.match(migration, /'dealer_sales_workspace'/);
  assert.match(migration, /'dealer_delivery_workspace'/);
  assert.match(migration, /'oem_context'/);
  assert.doesNotMatch(migration, /organization_brand_relationships/);
});

test("Boat Story resolves one canonical KAC hero without projection-local overrides", () => {
  const source = read("screens/BoatStoryScreen.js");
  const resolver = read("lib/assetHeroResolver.js");

  assert.match(source, /resolveAssetHeroUri\(boat,\s*\{\s*expiresIn: 60 \* 30/);
  assert.doesNotMatch(source, /resolveAssetHeroUri\(boat,\s*\{[\s\S]{0,120}organizationId/);
  assert.match(source, /heroRequestRef/);
  assert.match(source, /heroUriRef/);
  assert.doesNotMatch(source, /\[boat\?\.hero_image_url, boat\?\.hero_placement_id, boat\?\.id, heroUri\]/);
  assert.match(source, /listAttachmentsForAsset\(boatId,\s*\{\s*includeInheritedModelMedia: true,/);
  assert.doesNotMatch(source, /listAttachmentsForTarget\("asset", boatId\)/);
  assert.match(resolver, /async function resolveInheritedModelHero/);
  assert.match(resolver, /listAttachmentsForAsset\(assetId, \{ includeInheritedModelMedia: true \}\)/);
});

test("Dealer workspace resolves canonical KAC hero before projection media", () => {
  const detail = read("screens/KeeprProStewardshipViewScreen.js");
  const fleet = read("screens/KeeprSpaceFleetScreen.js");
  const resolver = read("lib/assetHeroResolver.js");
  const migration = read("supabase/migrations/20260901172000_canonical_kac_hero_contract.sql");

  assert.match(detail, /fetchAssetHeroUris\(\[heroAssetId\], BOAT_HERO_OPTIONS\)/);
  assert.doesNotMatch(detail, /fetchAssetHeroUris\(\[heroAssetId\],[\s\S]{0,160}organizationId/);
  assert.doesNotMatch(detail, /relationship_hero_placement_id: heroAsset\.relationship_hero_placement_id/);
  assert.match(fleet, /fetchAssetHeroUris\(boatHeroIds, FLEET_HERO_OPTIONS\)/);
  assert.match(resolver, /const assetHero = await resolvePlacementHeroUri\(placementId/);
  assert.match(resolver, /const bestExactAssetHero = await resolveBestAssetAttachmentHero/);
  assert.match(resolver, /const inheritedModelHero = await resolveInheritedModelHero/);
  assert.match(migration, /when ap\.id = v_asset\.hero_placement_id then 300/);
  assert.doesNotMatch(migration, /v_relationship_hero_placement_id/);
});

test("Canonical KAC Hero contract has one shared read and write path", () => {
  const resolver = read("lib/assetHeroResolver.js");
  const api = read("lib/keeprspaceApi.js");
  const migration = read("supabase/migrations/20260901172000_canonical_kac_hero_contract.sql");

  assert.match(resolver, /export async function resolveKacHero/);
  assert.match(resolver, /export async function fetchKacHeroUris/);
  assert.match(resolver, /export const resolveAssetHeroUri = resolveKacHero/);
  assert.match(resolver, /export const fetchAssetHeroUris = fetchKacHeroUris/);
  assert.doesNotMatch(resolver, /relationshipHeroPlacementIdFromMetadata/);
  assert.doesNotMatch(resolver, /resolveSharedHeroMediaViaRpc/);
  assert.doesNotMatch(resolver, /resolve_asset_shared_hero_media/);
  assert.doesNotMatch(resolver, /organizationId && assetId/);

  assert.match(api, /export async function setKacHero/);
  assert.match(api, /export async function clearKacHero/);
  assert.match(api, /rpc\("set_asset_hero_placement"/);
  assert.match(api, /rpc\("clear_asset_hero_placement"/);
  assert.doesNotMatch(api, /clear_asset_relationship_hero_placement/);
  assert.doesNotMatch(api, /set_asset_relationship_hero_placement/);

  assert.match(migration, /create table if not exists public\.asset_hero_audit_events/);
  assert.match(migration, /public\.kac_hero_placement_is_valid/);
  assert.match(migration, /ap\.target_type = 'asset'/);
  assert.match(migration, /ap\.target_type = 'model_template'/);
  assert.match(migration, /public\.kac_has_active_owner/);
  assert.match(migration, /relationship_type in \('assigned_dealer', 'selling_dealer', 'delivery_dealer'\)/);
  assert.match(migration, /drop function if exists public\.set_asset_hero_placement\(uuid, uuid\)/);
  assert.doesNotMatch(migration, /update public\.attachment_placements[\s\S]{0,180}set role/);
});

test("Showcase and attachments only mutate explicit KAC Hero pointer", () => {
  const showcase = read("screens/BoatShowcaseScreen.js");
  const attachments = read("screens/AssetAttachmentsScreen.js");

  assert.match(showcase, /setKacHero/);
  assert.match(showcase, /clearKacHero/);
  assert.doesNotMatch(showcase, /\.from\("assets"\)[\s\S]{0,120}\.update\(\{ hero_placement_id/);
  assert.doesNotMatch(showcase, /relationship_hero_placement_id/);
  assert.doesNotMatch(showcase, /workspace Hero/);

  assert.match(attachments, /clearKeeprSpaceAssetHero/);
  assert.match(attachments, /Clear KAC Hero/);
  assert.doesNotMatch(attachments, /relationshipHeroPlacementId/);
  assert.doesNotMatch(attachments, /activeAssetRelationshipId/);
  assert.doesNotMatch(attachments, /workspace Hero/);
});

test("Exact build shell uses organization branding instead of Tiara fallback copy", () => {
  const source = read("screens/ActivatorExactBuildScreen.js");

  assert.match(source, /getKeeprSpaceOrgConfig\(\{ organizationId \}\)/);
  assert.match(source, /orgBrandContextFromConfig/);
  assert.match(source, /<Text style=\{styles\.heroBrandName\}>\{orgBrandContext\.name\}<\/Text>/);
  assert.match(source, /`Build a \$\{modelBrandLabel\} \$\{modelLabel\}`/);
  assert.match(source, /label: "Configure Boats"/);
  assert.match(source, /Exact Boat Identity/);
  assert.doesNotMatch(source, /Build a Tiara \$\{modelLabel\}/);
  assert.doesNotMatch(source, /Opening Tiara starter pack/);
  assert.doesNotMatch(source, /Selected for this hull/);
});

test("Exact build draft UI can add systems that are not template choices", () => {
  const source = read("screens/ActivatorExactBuildScreen.js");

  assert.match(source, /Exact-Unit Additions/);
  assert.match(source, /Add systems on this boat/);
  assert.match(source, /addExactUnitSystem/);
  assert.match(source, /exactSystemDraftItemPayload/);
  assert.match(source, /source: "manual_exact_unit_addition"/);
  assert.match(source, /kind: "system"/);
  assert.match(source, /mapping_status: "mapped"/);
  assert.match(source, /\.\.\.exactUnitSystems\.map\(exactSystemDraftItemPayload\)/);
});

test("Exact build screen does not use Tiara starter options for non-Tiara templates", () => {
  const source = read("screens/ActivatorExactBuildScreen.js");

  assert.match(source, /useTiaraFactoryFallback = isTiaraTemplateKey\(templateKey\)/);
  assert.match(source, /useState\(\(\) => useTiaraFactoryFallback \? DEMO_FACTORY_OPTIONS : \[\]\)/);
  assert.match(source, /useTiaraFactoryFallback \? getTiaraFactoryBuildWorkspace/);
  assert.doesNotMatch(source, /useState\(DEMO_FACTORY_OPTIONS\)/);
  assert.match(source, /const draftTemplate = draftWorkspace\?\.template \|\| null/);
  assert.match(source, /const template = modelProjection\.template \|\| draftTemplate \|\| \{\}/);
});
