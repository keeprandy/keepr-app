import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".local-env", "staging.env"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

function loadFactoryBuildData() {
  const sourcePath = path.join(repoRoot, "data", "tiaraKf018FactoryBuild.js");
  const source = fs
    .readFileSync(sourcePath, "utf8")
    .replaceAll("export const ", "const ")
    .replaceAll("export function ", "function ")
    .replaceAll("export default ", "const __default = ");

  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${source}
result = {
  tiaraKf018FactoryBuild,
  tiaraKf018FactoryLines,
  tiaraKf018Systems,
  tiaraKf018WorkOrder,
  tiara56LsCatalogTemplate,
  tiara56LsPublicModelContext,
};`, context, { filename: sourcePath });
  return context.result;
}

const {
  tiaraKf018FactoryLines,
  tiaraKf018Systems,
  tiaraKf018WorkOrder,
  tiara56LsCatalogTemplate,
  tiara56LsPublicModelContext,
} = loadFactoryBuildData();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing staging Supabase URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const localDocRoot = "/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/56 LS";
const resources = [
  {
    resource_type: "oem_catalog",
    title: "Tiara Yachts 56 LS Buyer's Guide MY2027",
    source_name: "Tiara Yachts",
    source_platform: "local demo document",
    source_url: "Tiara_Yachts__56_LS_Buyers_Guide_MY2027.pdf",
    authority_state: "oem_published",
    rights_status: "review_permission",
    applies_to_type: "template",
    scope: "template",
    metadata: {
      document_scope: "model_template",
      local_path: path.join(localDocRoot, "Tiara_Yachts__56_LS_Buyers_Guide_MY2027.pdf"),
    },
  },
  {
    resource_type: "oem_catalog",
    title: "Tiara Yachts Material Selection Guide",
    source_name: "Tiara Yachts",
    source_platform: "local demo document",
    source_url: "Tiara_Yachts__Material_Selection_Guide.pdf",
    authority_state: "oem_published",
    rights_status: "review_permission",
    applies_to_type: "template",
    scope: "template",
    metadata: {
      document_scope: "model_template",
      local_path: path.join(localDocRoot, "Tiara_Yachts__Material_Selection_Guide.pdf"),
    },
  },
  {
    resource_type: "oem_catalog",
    title: "Tiara Yachts 56 LS Quad Mercury 600 Performance Report",
    source_name: "Tiara Yachts",
    source_platform: "local demo document",
    source_url: "Tiara_Yachts__56_LS_Quad_Mercury_600.pdf",
    authority_state: "oem_published",
    rights_status: "review_permission",
    applies_to_type: "template",
    scope: "template",
    metadata: {
      document_scope: "model_template",
      local_path: path.join(localDocRoot, "Tiara_Yachts__56_LS_Quad_Mercury_600.pdf"),
    },
  },
];

const payload = {
  workOrder: tiaraKf018WorkOrder,
  template: tiara56LsCatalogTemplate,
  publicModelContext: tiara56LsPublicModelContext,
  systems: tiaraKf018Systems,
  lines: tiaraKf018FactoryLines,
  resources,
};

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.rpc("materialize_tiara_factory_build_asset", {
  p_payload: payload,
});

if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
