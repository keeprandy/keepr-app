import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const exportRoot = path.join(repoRoot, "exports", "kf018-package");

dotenv.config({ path: path.join(repoRoot, ".local-env", "staging.env"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const kacId = process.argv[2] || "KAC-TIARA-56LS-KF018";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing staging Supabase URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: pkg, error } = await supabase.rpc("export_asset_package_by_kac", {
  p_kac_id: kacId,
});

if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

if (!pkg) {
  console.error(`No package returned for ${kacId}. Materialize the asset first.`);
  process.exit(1);
}

const assetId = pkg?.package_contract?.asset_id;
const { data: graph, error: graphError } = assetId
  ? await supabase.rpc("get_asset_graph_projection", { p_asset_id: assetId })
  : { data: null, error: null };

if (graphError) {
  console.error(JSON.stringify(graphError, null, 2));
  process.exit(1);
}

const { data: releases, error: releaseError } = assetId
  ? await supabase
      .from("asset_graph_releases")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false })
      .limit(1)
  : { data: [], error: null };

if (releaseError) {
  console.error(JSON.stringify(releaseError, null, 2));
  process.exit(1);
}

const { data: systemsExperience, error: systemsExperienceError } = assetId
  ? await supabase.rpc("get_asset_systems_experience", {
      p_asset_id: assetId,
      p_role: "oem",
    })
  : { data: null, error: null };

if (systemsExperienceError) {
  console.error(JSON.stringify(systemsExperienceError, null, 2));
  process.exit(1);
}

const enrichedPackage = {
  ...pkg,
  asset_graph: graph || { nodes: [], edges: [] },
  asset_systems_experience: systemsExperience || null,
  graph_release: releases?.[0] || null,
};

await fs.mkdir(exportRoot, { recursive: true });

const sections = {
  "asset-package.json": enrichedPackage,
  "asset.json": enrichedPackage.asset || null,
  "template.json": enrichedPackage.template || null,
  "systems.json": enrichedPackage.systems || [],
  "asset-systems-experience.json": enrichedPackage.asset_systems_experience || null,
  "factory-build.json": enrichedPackage.factory_build || null,
  "asset-graph.json": enrichedPackage.asset_graph || null,
  "graph-release.json": enrichedPackage.graph_release || null,
  "resources.json": enrichedPackage.resources || [],
  "facts.json": enrichedPackage.facts || [],
};

for (const [fileName, value] of Object.entries(sections)) {
  await fs.writeFile(path.join(exportRoot, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

const summary = {
  kac_id: enrichedPackage?.package_contract?.kac_id,
  asset_id: enrichedPackage?.package_contract?.asset_id,
  template_key: enrichedPackage?.template?.template?.template_key,
  systems_count: Array.isArray(enrichedPackage.systems) ? enrichedPackage.systems.length : 0,
  canonical_systems_count: Array.isArray(enrichedPackage?.asset_systems_experience?.systems) ? enrichedPackage.asset_systems_experience.systems.length : 0,
  configurations_count: Array.isArray(enrichedPackage?.asset_systems_experience?.configurations) ? enrichedPackage.asset_systems_experience.configurations.length : 0,
  manual_queue_count: Array.isArray(enrichedPackage?.asset_systems_experience?.manual_queue) ? enrichedPackage.asset_systems_experience.manual_queue.length : 0,
  factory_lines_count: Array.isArray(enrichedPackage?.factory_build?.line_items) ? enrichedPackage.factory_build.line_items.length : 0,
  graph_nodes_count: Array.isArray(enrichedPackage?.asset_graph?.nodes) ? enrichedPackage.asset_graph.nodes.length : 0,
  graph_edges_count: Array.isArray(enrichedPackage?.asset_graph?.edges) ? enrichedPackage.asset_graph.edges.length : 0,
  graph_release_key: enrichedPackage?.graph_release?.release_key || null,
  facts_count: Array.isArray(enrichedPackage.facts) ? enrichedPackage.facts.length : 0,
  resources_count: Array.isArray(enrichedPackage.resources) ? enrichedPackage.resources.length : 0,
};

await fs.writeFile(
  path.join(exportRoot, "README.md"),
  [
    "# KF018 Keepr Asset Package",
    "",
    "Generated from staging using `export_asset_package_by_kac`.",
    "",
    "This package is a proof bundle for the contract:",
    "",
    "- reusable Tiara 56 LS template",
    "- exact KF018 asset identity",
    "- preserved Tiara factory work-order lines",
    "- normalized systems/components/options mapping",
    "- source/manual resolution queue",
    "- provenance facts proving why each mapped item belongs on KF018",
    "- operational asset graph projection with evidence-backed nodes",
    "- canonical role-projected asset systems experience",
    "- graph release snapshot for future dealer/owner release control",
    "",
    "## Summary",
    "",
    `- KAC: ${summary.kac_id}`,
    `- Asset ID: ${summary.asset_id}`,
    `- Template: ${summary.template_key}`,
    `- Systems: ${summary.systems_count}`,
    `- Canonical graph systems: ${summary.canonical_systems_count}`,
    `- Configurations/finishes: ${summary.configurations_count}`,
    `- Canonical manual queue: ${summary.manual_queue_count}`,
    `- Factory lines: ${summary.factory_lines_count}`,
    `- Graph nodes: ${summary.graph_nodes_count}`,
    `- Graph edges: ${summary.graph_edges_count}`,
    `- Graph release: ${summary.graph_release_key || "not created"}`,
    `- Facts: ${summary.facts_count}`,
    `- Resources: ${summary.resources_count}`,
    "",
  ].join("\n")
);

console.log(JSON.stringify({ exportRoot, ...summary }, null, 2));
