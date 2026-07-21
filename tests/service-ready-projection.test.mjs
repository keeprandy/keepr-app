import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadProjectionRegistry() {
  const source = read("lib/projectionRegistry.js").replaceAll("export ", "");
  return new Function(
    `${source}
return {
  PROJECTION_TEMPLATES,
  getOperationalProjectionOptions,
  getProjectionActionsForPurpose,
  normalizeProjectionConfig
};`
  )();
}

test("Service Ready is an operational system-scoped projection", () => {
  const {
    PROJECTION_TEMPLATES,
    getOperationalProjectionOptions,
    getProjectionActionsForPurpose,
    normalizeProjectionConfig,
  } = loadProjectionRegistry();

  assert.equal(PROJECTION_TEMPLATES.service_ready.scope, "system");
  assert.equal(PROJECTION_TEMPLATES.service_ready.operational, true);
  assert.deepEqual(getProjectionActionsForPurpose("service_ready"), ["request_service"]);
  assert.ok(
    getOperationalProjectionOptions({ scope: "system" })
      .map((template) => template.key)
      .includes("service_ready")
  );
  assert.equal(
    normalizeProjectionConfig({ projection: { purpose: "service_ready" } }).purpose,
    "service_ready"
  );
});

test("Service Ready links use system-scoped public_links with hashed tokens", () => {
  const source = read("lib/systemServiceReadyLinks.js");

  assert.match(source, /SERVICE_READY_MODE = "service_ready"/);
  assert.match(source, /PUBLIC_LINK_ACTION_MODE = "action"/);
  assert.match(source, /\.from\("public_links"\)/);
  assert.match(source, /asset_id:\s*assetId/);
  assert.match(source, /system_id:\s*systemId/);
  assert.match(source, /mode:\s*PUBLIC_LINK_ACTION_MODE/);
  assert.match(source, /Service Ready/);
  assert.match(source, /token_hash:\s*tokenHash/);
  assert.match(source, /SystemStoryPrint\?token=/);
  assert.match(source, /EXPO_PUBLIC_KEEPR_BASE_URL/);
  assert.match(source, /configuredBase \|\|/);
  assert.doesNotMatch(source, /token:\s*token/);
});

test("System public print view renders resolved public system package payload", () => {
  const source = read("screens/SystemStoryPrintScreen.js");

  assert.match(source, /const payload = resolved\?\.payload/);
  assert.match(source, /buildSystemStoryFromPackage\(\s*payload/);
  assert.match(source, /projectionMode:\s*resolved\?\.mode/);
  assert.match(source, /projectionMode === "service_ready"/);
  assert.match(source, /includes\("service ready"\)/);
  assert.match(source, /Readiness:/);
});

test("System screens expose Share Service Ready actions", () => {
  for (const file of [
    "screens/HomeSystemStoryScreen.js",
    "screens/BoatSystemStoryScreen.js",
    "screens/VehicleSystemStoryScreen.js",
  ]) {
    const source = read(file);
    assert.match(source, /createOrReuseServiceReadyLink/);
    assert.match(source, /handleShareServiceReady/);
    assert.match(source, /Service Ready/);
  }
});

test("KeeprPro communication card is shared across asset, system, and public flows", () => {
  const cardSource = read("components/KeeprProCommunicationCard.js");
  assert.match(cardSource, /Your KeeprPro/);
  assert.match(cardSource, /Call/);
  assert.match(cardSource, /Email/);
  assert.match(cardSource, /Request Service/);
  assert.match(cardSource, /View KeeprPro/);
  assert.match(cardSource, /assignmentScope === "system"/);
  assert.match(cardSource, /getAssetKeeprProFromMetadata/);

  for (const file of [
    "screens/HomeStoryScreen.js",
    "screens/BoatStoryScreen.js",
    "screens/VehicleStoryScreen.js",
    "screens/HomeSystemStoryScreen.js",
    "screens/BoatSystemStoryScreen.js",
    "screens/VehicleSystemStoryScreen.js",
    "screens/SystemStoryPrintScreen.js",
  ]) {
    assert.match(read(file), /KeeprProCommunicationCard/);
  }
});

test("PublicAction request_service carries KeeprPro and system context", () => {
  const source = read("screens/PublicActionScreen.js");
  assert.match(source, /routeKeeprProId/);
  assert.match(source, /routeAssignmentScope/);
  assert.match(source, /routeSourceScreen/);
  assert.match(source, /system_id:/);
  assert.match(source, /keepr_pro_id:/);
  assert.match(source, /public_link_id:/);

  const fnSource = read("supabase/functions/public-action/index.ts");
  assert.match(fnSource, /const token = safeStr\(body\?\.token\)/);
  assert.match(fnSource, /from\("public_links"\)/);
  assert.match(fnSource, /system_id:/);
  assert.match(fnSource, /keepr_pro_id:/);
  assert.match(fnSource, /assignment_scope:/);
});
