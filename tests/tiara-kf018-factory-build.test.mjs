import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadFactoryBuildModule() {
  const source = read("data/tiaraKf018FactoryBuild.js").replaceAll("export ", "");
  return new Function(
    `${source}
return {
  TIARA_56_LS_TEMPLATE_KEY,
  TIARA_KF018_BUILD_KEY,
  tiara56LsCatalogTemplate,
  tiaraKf018FactoryBuild,
  tiaraKf018FactoryLines,
  getDefaultTiaraExactFactoryBuildForTemplate,
  getTiaraExactFactoryBuild,
  getTiaraKf018ManualQueue,
  answerTiaraKf018Question
};`
  )();
}

test("KF018 factory work-order lines preserve Tiara truth beside normalized mapping", () => {
  const { tiaraKf018FactoryLines } = loadFactoryBuildModule();

  assert.ok(tiaraKf018FactoryLines.length >= 29);

  for (const line of tiaraKf018FactoryLines) {
    assert.equal(line.source_type, "tiara_work_order");
    assert.equal(line.source_role, "factory_build_truth");
    assert.equal(line.factory_confirmed, true);
    assert.ok(line.factory_description);
    assert.ok(line.raw_source_text);
    assert.ok(line.normalized_name);
    assert.ok(line.relationship_type);
    assert.ok(line.mapping_status);
    assert.notEqual(line.factory_description, line.normalized_name, "normalization should sit beside original factory description");
  }

  const generator = tiaraKf018FactoryLines.find((line) => line.system_id === "kf018-system-generator");
  assert.equal(generator.factory_description, "OIL CHANGER FOR GENERATOR");
  assert.equal(generator.mapping_method, "exact_catalog_match");
});

test("Tiara 56 LS catalog template is reusable and separate from KF018 exact-build truth", () => {
  const {
    tiara56LsCatalogTemplate,
    tiaraKf018FactoryBuild,
    getDefaultTiaraExactFactoryBuildForTemplate,
    getTiaraExactFactoryBuild,
  } = loadFactoryBuildModule();

  assert.equal(tiara56LsCatalogTemplate.template_key, "tiara-2027-56-ls");
  assert.equal(tiara56LsCatalogTemplate.source_role, "reusable_model_template");
  assert.ok(tiara56LsCatalogTemplate.starter_systems.some((system) => system.system_category === "Generator / AC Power"));

  assert.equal(tiaraKf018FactoryBuild.work_order.source_role, "factory_build_truth");
  assert.equal(tiaraKf018FactoryBuild.work_order.hin, "SSUKF018H627");
  assert.equal(tiaraKf018FactoryBuild.catalog_template.template_key, "tiara-2027-56-ls");

  assert.equal(getDefaultTiaraExactFactoryBuildForTemplate("tiara-2027-56-ls").work_order.build_code, "KF018");
  assert.equal(getDefaultTiaraExactFactoryBuildForTemplate("tiara-2027-39-ls"), null);
  assert.equal(getTiaraExactFactoryBuild({ templateKey: "tiara-2027-56-ls", buildKey: "kf018" }).work_order.hin, "SSUKF018H627");
});

test("KF018 question answers return evidence from factory lines", () => {
  const { answerTiaraKf018Question } = loadFactoryBuildModule();

  const generatorAnswer = answerTiaraKf018Question("does this unit have a generator?");
  assert.match(generatorAnswer.answer, /factory line/);
  assert.ok(generatorAnswer.evidence.some((item) => /GENERATOR/i.test(item.factory_description)));
  assert.ok(generatorAnswer.evidence.every((item) => item.source_role === "factory_build_truth"));

  const electronicsAnswer = answerTiaraKf018Question("what electronics are on KF018?");
  assert.ok(electronicsAnswer.evidence.some((item) => /FLIR|STARLINK|ANTENNAS/i.test(item.factory_description)));
});

test("KF018 exact-build screen keeps the factory mapping UI without local Tiara fallbacks", () => {
  const source = read("screens/ActivatorExactBuildScreen.js");

  assert.match(source, /Factory Build/);
  assert.match(source, /Mapping Assignment/);
  assert.match(source, /Missing Source Queue/);
  assert.match(source, /Public Model Context/);
  assert.match(source, /getCatalogTemplateDetail\(\{ templateKey \}\)/);
  assert.match(source, /getExactBuildDraft/);
  assert.doesNotMatch(source, /getTiaraFactoryBuildWorkspace/);
  assert.doesNotMatch(source, /getDefaultTiaraExactFactoryBuildForTemplate/);
  assert.doesNotMatch(source, /DEMO_FACTORY_OPTIONS/);
  assert.match(source, /factory_item_code/);
  assert.match(source, /factory_description/);
  assert.doesNotMatch(source, /templateKey = route\?\.params\?\.templateKey \|\| "tiara-2027-39-ls"/);
});

test("model template projection shows top-level reusable systems as Systems catalog DNA", async () => {
  const { projectModelTemplateDetail } = await import("../lib/modelTemplateProjection.js");
  const detail = {
    template: {
      id: "template-56ls",
      template_key: "tiara-2027-56-ls",
      manufacturer: "Tiara Yachts",
      model: "56 LS",
      model_year: 2027,
    },
    items: [
      {
        id: "generator-system",
        item_type: "system",
        system_template_id: "11111111-1111-4111-8111-111111111111",
        label: "Onan 13.5kW Generator",
        canonical_key: "system.generator.onan_13_5kw",
        sort_order: 10,
        authority_state: "active",
        expected_value: { system_category: "Electrical", quantity: 1 },
        applicability: { standard_state: "standard", mapping_status: "mapped" },
        metadata: { projection: { kind: "system", name: "Onan 13.5kW Generator" } },
      },
      {
        id: "macerator-system",
        item_type: "system",
        label: "Head Macerator System",
        canonical_key: "system.sanitation.head_macerator",
        sort_order: 20,
        authority_state: "active",
        expected_value: { system_category: "Waste / Sanitation", quantity: 1 },
        applicability: { standard_state: "standard", mapping_status: "mapped" },
        metadata: { projection: { kind: "system", name: "Head Macerator System" } },
      },
    ],
    resources: [],
  };

  const projection = projectModelTemplateDetail(detail);
  const systemsGroup = projection.catalog.chaptersByKey.systems.find((group) => group.section.id === "projection-reusable-systems");

  assert.ok(systemsGroup, "top-level reusable systems should render under the Systems tab");
  assert.deepEqual(systemsGroup.children.map((item) => item.label), ["Onan 13.5kW Generator", "Head Macerator System"]);
  assert.equal(systemsGroup.children[0].metadata.projection.system_template_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(projection.configuration.buildEligibleItems[0].system_template_id, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(projection.reusableSystems.map((item) => item.label), ["Onan 13.5kW Generator", "Head Macerator System"]);
});

test("System Template reference migration keeps reusable system truth separate from item applicability and exact instance state", () => {
  const sql = read("supabase/migrations/20260903164000_system_template_references_v1.sql");
  const attachmentsApi = read("lib/attachmentsApi.js");
  const projectionSource = read("lib/modelTemplateProjection.js");
  const proofBuilderSource = read("screens/ProofBuilderScreen.js");

  assert.match(sql, /create table if not exists public\.system_templates/);
  assert.match(sql, /alter table public\.asset_model_template_items[\s\S]*system_template_id uuid references public\.system_templates/);
  assert.match(sql, /alter table public\.systems[\s\S]*system_template_id uuid references public\.system_templates/);
  assert.match(sql, /target_type = any[\s\S]*'system_template'::text/);
  assert.match(sql, /create trigger systems_apply_system_template_reference/);
  assert.match(sql, /exact_build_template_item_id/);
  assert.match(sql, /system_template\.onan\.13_5kw_generator/);
  assert.match(sql, /system_template\.seakeeper\.sk10_5/);
  assert.match(sql, /system\.generator\.onan_13_5kw/);
  assert.match(sql, /system\.stabilization\.seakeeper_sk10_5/);
  assert.match(sql, /Reusable system-template knowledge inherited by model items and exact systems by reference/);

  assert.match(attachmentsApi, /function canonicalSystemTemplateIds/);
  assert.match(attachmentsApi, /\.from\("system_templates"\)/);
  assert.match(attachmentsApi, /\.eq\("target_type", "system_template"\)/);
  assert.match(attachmentsApi, /normalizeInheritedSystemTemplateResource/);
  assert.match(attachmentsApi, /provenance: "system_template"/);

  assert.match(projectionSource, /function systemTemplateIdForItem/);
  assert.match(projectionSource, /system_template_id: explicit\.system_template_id \|\| systemTemplateId/);
  assert.match(projectionSource, /systemTemplateId: projection\.system_template_id/);

  assert.match(proofBuilderSource, /system_template_id/);
  assert.match(proofBuilderSource, /select\("id,label,item_type,canonical_key,metadata,applicability,system_template_id"\)/);
});

test("System Template promote and link operations are explicit product actions", () => {
  const sql = read("supabase/migrations/20260903172000_system_template_promote_link_ops.sql");
  const activatorApi = read("lib/activatorApi.js");
  const systemStorySource = read("screens/BoatSystemStoryScreen.js");
  const itemEditorSource = read("screens/ActivatorTemplateItemEditorScreen.js");

  assert.match(sql, /create or replace function public\.promote_system_to_system_template/);
  assert.match(sql, /create or replace function public\.link_model_item_system_template/);
  assert.match(sql, /create or replace function public\.unlink_model_item_system_template/);
  assert.match(sql, /create or replace function public\.list_system_templates/);
  assert.match(sql, /activator_user_can_manage_asset\(auth\.uid\(\), v_system\.asset_id\)/);
  assert.match(sql, /activator_user_can_manage_template\(auth\.uid\(\), v_item\.template_id\)/);
  assert.match(sql, /promote_resources/);
  assert.match(sql, /coalesce\(att\.kind, ''\) <> 'photo'/);
  assert.match(sql, /exact_truth_excluded/);
  assert.doesNotMatch(sql, /KAC-TIARA-56LS-KF018|tiara-2027-56-ls|Onan 13\.5kW Generator|Seakeeper SK10\.5/);

  assert.match(activatorApi, /export async function listSystemTemplates/);
  assert.match(activatorApi, /export async function linkModelItemSystemTemplate/);
  assert.match(activatorApi, /export async function unlinkModelItemSystemTemplate/);
  assert.match(activatorApi, /export async function promoteSystemToSystemTemplate/);

  assert.match(systemStorySource, /Promote \/ Update System Template/);
  assert.match(systemStorySource, /promote_resources: promoteResources/);
  assert.match(systemStorySource, /exact serials, photos, service history/i);

  assert.match(itemEditorSource, /Core System Template/);
  assert.match(itemEditorSource, /linkModelItemSystemTemplate/);
  assert.match(itemEditorSource, /unlinkModelItemSystemTemplate/);
  assert.match(itemEditorSource, /Model-specific applicability remains/);
});

test("KF018 fleet routing consumes generic exact-build metadata without local runtime projection", () => {
  const source = read("screens/ActivatorHomeScreen.js");
  const fleetSource = read("screens/KeeprSpaceFleetScreen.js");
  const materializerSql = read("supabase/migrations/20260824143000_materialize_tiara_factory_build_asset.sql");
  const genericKf018Sql = read("supabase/migrations/20260903150000_productize_tiara_56ls_kf018_generic_build.sql");
  const portfolioSql = read("supabase/migrations/20260824143500_keeprspace_portfolio_exact_build_metadata.sql");
  const graphSql = read("supabase/migrations/20260824144000_asset_graph_projection.sql");
  const systemsExperienceSql = read("supabase/migrations/20260824144500_canonical_asset_systems_experience.sql");
  const materializeScript = read("scripts/materialize-kf018-staging.mjs");
  const graphScript = read("scripts/project-kf018-asset-graph-staging.mjs");
  const exportScript = read("scripts/export-kf018-package.mjs");

  assert.doesNotMatch(source, /ENABLE_KF018_LOCAL_FLEET_FALLBACK/);
  assert.doesNotMatch(source, /withKf018FleetProjection/);
  assert.doesNotMatch(source, /source_type:\s*"factory_build_workspace"/);
  assert.doesNotMatch(source, /asset_name:\s*"KF018 · 2027 Tiara 56 LS"/);
  assert.doesNotMatch(source, /kac_id:\s*"KAC-TIARA-56LS-KF018"/);
  assert.doesNotMatch(source, /template_key:\s*TIARA_56_LS_TEMPLATE_KEY/);
  assert.doesNotMatch(source, /build_key:\s*TIARA_KF018_BUILD_KEY/);
  assert.match(source, /navigation\.navigate\("ActivatorExactBuild"/);
  assert.match(source, /exactTemplateKey = boat\?\.exact_build\?\.template_key/);
  assert.match(source, /templateKey:\s*exactTemplateKey/);
  assert.match(source, /buildKey:\s*template\.buildKey \|\| null/);
  assert.doesNotMatch(source, /tiara-2027-39-ls[\s\S]{0,80}KF018/);

  assert.doesNotMatch(fleetSource, /ENABLE_KF018_LOCAL_FLEET_FALLBACK/);
  assert.doesNotMatch(fleetSource, /withKf018FleetProjection/);
  assert.doesNotMatch(fleetSource, /asset_name:\s*"KF018 · 2027 Tiara 56 LS"/);
  assert.match(fleetSource, /navigation\.navigate\("ActivatorExactBuild"/);
  assert.match(fleetSource, /function hasFactoryBuildLayer/);
  assert.match(fleetSource, /function factoryBuildParamsForBoat/);
  assert.match(fleetSource, /Open Factory Build/);
  assert.match(fleetSource, /templateKey:\s*exact\.template_key \|\| boat\?\.template\?\.template_key \|\| null/);
  assert.match(fleetSource, /buildKey:\s*buildCode \? String\(buildCode\)\.toLowerCase\(\) : null/);
  assert.match(fleetSource, /setPortfolio\(next\)/);

  assert.match(genericKf018Sql, /tiara-2027-56-ls/);
  assert.match(genericKf018Sql, /KAC-TIARA-56LS-KF018/);
  assert.match(genericKf018Sql, /exact_build_drafts/);
  assert.match(genericKf018Sql, /exact_build_draft_items/);
  assert.match(genericKf018Sql, /asset_template_bindings/);
  assert.match(genericKf018Sql, /reusable_model_dna/);
  assert.match(genericKf018Sql, /exact_kf018_truth/);

  assert.match(materializerSql, /materialize_tiara_factory_build_asset/);
  assert.match(materializerSql, /insert into public\.assets/);
  assert.match(materializerSql, /insert into public\.asset_relationships/);
  assert.match(materializerSql, /insert into public\.factory_build_line_items/);
  assert.match(materializerSql, /insert into public\.asset_facts/);
  assert.match(materializerSql, /export_asset_package_by_kac/);
  assert.match(portfolioSql, /'exact_build'/);
  assert.match(portfolioSql, /p\.extra_metadata ->> 'catalog_template_key'/);
  assert.match(portfolioSql, /p\.extra_metadata ->> 'exact_build_key'/);
  assert.match(materializeScript, /materialize_tiara_factory_build_asset/);
  assert.match(graphScript, /project_tiara_factory_build_asset_graph/);
  assert.match(graphScript, /create_asset_graph_release/);
  assert.match(graphScript, /ensure_asset_graph_instance_state/);
  assert.match(graphScript, /get_asset_systems_experience/);
  assert.match(exportScript, /export_asset_package_by_kac/);
  assert.match(exportScript, /get_asset_graph_projection/);
  assert.match(exportScript, /asset_systems_experience/);
  assert.match(exportScript, /asset_graph_releases/);
  assert.match(graphSql, /create table if not exists public\.asset_graph_nodes/);
  assert.match(graphSql, /node_type in \('system', 'component_model', 'component_instance', 'option_accessory', 'configuration', 'build_evidence'\)/);
  assert.match(graphSql, /component_model\.mercury\.v12-600/);
  assert.match(graphSql, /component_instance\.mercury-v12-600\.engine-/);
  assert.match(graphSql, /create table if not exists public\.asset_graph_releases/);
  assert.match(graphSql, /factory_evidence_immutable/);
  assert.match(systemsExperienceSql, /create table if not exists public\.asset_graph_instance_state/);
  assert.match(systemsExperienceSql, /create or replace function public\.get_asset_systems_experience/);
  assert.match(systemsExperienceSql, /component_model_to_instances/);
  assert.match(systemsExperienceSql, /factory_evidence_immutable/);
  assert.match(systemsExperienceSql, /get_asset_graph_node_evidence/);
  assert.match(systemsExperienceSql, /get_asset_graph_node_resources/);
});

test("KF018 asset screen consumes canonical graph systems and exact build links to the digital twin", () => {
  const stewardshipSource = read("screens/KeeprProStewardshipViewScreen.js");
  const exactBuildSource = read("screens/ActivatorExactBuildScreen.js");

  assert.match(stewardshipSource, /get_asset_systems_experience/);
  assert.match(stewardshipSource, /canonicalSystemsExperience/);
  assert.match(stewardshipSource, /experienceComponents/);
  assert.match(stewardshipSource, /serial/);
  assert.match(stewardshipSource, /warranty/);
  assert.match(exactBuildSource, /View Digital Twin/);
  assert.match(exactBuildSource, /systemsRole:\s*"oem"/);
});

test("org fleet routing uses a neutral workspace path with Wilson only as legacy compatibility", () => {
  const source = read("App.js");

  assert.match(source, /function isKeeprSpaceWebPath/);
  assert.match(source, /path === "\/workspace"/);
  assert.match(source, /path\.startsWith\("\/workspace\/"\)/);
  assert.match(source, /KeeprSpaceModule:\s*\{\s*path:\s*"workspace"/);
  assert.match(source, /KeeprSpaceLegacyModule:\s*\{\s*path:\s*"wilson"/);
  assert.match(source, /if \(path === "\/workspace" \|\| path\.startsWith\("\/workspace\/"\)\) return "KeeprSpaceModule"/);
  assert.match(source, /if \(path === "\/wilson" \|\| path\.startsWith\("\/wilson\/"\)\) return "KeeprSpaceLegacyModule"/);
  assert.match(source, /if \(path === "\/activator" \|\| path\.startsWith\("\/activator\/"\)\) return "ActivatorHome"/);
});

test("staging migration creates reusable factory line model and resolver", () => {
  const sql = read("supabase/migrations/20260824120000_tiara_kf018_factory_work_order_ingestion.sql");

  assert.match(sql, /create table if not exists public\.factory_build_documents/);
  assert.match(sql, /create table if not exists public\.factory_build_line_items/);
  assert.match(sql, /factory_item_code text/);
  assert.match(sql, /factory_description text not null/);
  assert.match(sql, /relationship_type in \('system', 'component', 'option', 'configuration', 'build_only'\)/);
  assert.match(sql, /get_tiara_factory_build_workspace/);
  assert.match(sql, /p_template_key text default null/);
  assert.match(sql, /p_build_key text default null/);
  assert.match(sql, /manual_queue/);
});
