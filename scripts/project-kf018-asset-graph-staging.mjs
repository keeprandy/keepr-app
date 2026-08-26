import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".local-env", "staging.env"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const assetId = process.argv[2] || "a5b0d793-0aa2-4c3b-842e-5d2375aba8ed";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing staging Supabase URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: projection, error: projectionError } = await supabase.rpc("project_tiara_factory_build_asset_graph", {
  p_asset_id: assetId,
  p_hin: null,
});

if (projectionError) {
  console.error(JSON.stringify(projectionError, null, 2));
  process.exit(1);
}

const { data: release, error: releaseError } = await supabase.rpc("create_asset_graph_release", {
  p_asset_id: assetId,
  p_release_key: "kf018-working-asset-graph-v1",
  p_release_label: "KF018 working asset graph V1",
  p_release_status: "draft",
});

if (releaseError) {
  console.error(JSON.stringify(releaseError, null, 2));
  process.exit(1);
}

const { data: instanceState, error: instanceStateError } = await supabase.rpc("ensure_asset_graph_instance_state", {
  p_asset_id: assetId,
});

if (instanceStateError) {
  console.error(JSON.stringify(instanceStateError, null, 2));
  process.exit(1);
}

const { data: systemsExperience, error: systemsExperienceError } = await supabase.rpc("get_asset_systems_experience", {
  p_asset_id: assetId,
  p_role: "oem",
});

if (systemsExperienceError) {
  console.error(JSON.stringify(systemsExperienceError, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ projection, release, instanceState, systemsExperience }, null, 2));
