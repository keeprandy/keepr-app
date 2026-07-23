import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadPrefillHelpers() {
  const source = read("lib/serviceActionPrefill.js").replaceAll("export ", "");
  return new Function(
    `${source}
return {
  buildServiceActionPrefill,
  buildServiceActionRouteParams
};`
  )();
}

test("asset Add Service builds an Inbox Action prefill with asset context", () => {
  const { buildServiceActionRouteParams } = loadPrefillHelpers();

  const params = buildServiceActionRouteParams({
    assetId: "asset-1",
    assetName: "2009 Harris Kayot V220i",
    assetType: "boat",
    sourceScreen: "boat_story",
  });

  assert.equal(params.afterSave, "Notifications");
  assert.equal(params.assetId, "asset-1");
  assert.equal(params.systemId, null);
  assert.equal(params.prefill.asset_id, "asset-1");
  assert.equal(params.prefill.system_id, null);
  assert.equal(params.prefill.title, "Service: 2009 Harris Kayot V220i");
  assert.equal(params.prefill.extra_metadata.action_type, "service");
  assert.equal(params.prefill.extra_metadata.assignment_scope, "asset");
});

test("system Add Service builds an Inbox Action prefill with system context", () => {
  const { buildServiceActionRouteParams } = loadPrefillHelpers();

  const params = buildServiceActionRouteParams({
    assetId: "asset-1",
    assetName: "Brighton Home",
    systemId: "system-1",
    systemName: "Whole House Generator",
    assetType: "home",
    sourceScreen: "home_system_story",
  });

  assert.equal(params.afterSave, "Notifications");
  assert.equal(params.assetId, "asset-1");
  assert.equal(params.systemId, "system-1");
  assert.equal(params.prefill.asset_id, "asset-1");
  assert.equal(params.prefill.system_id, "system-1");
  assert.equal(params.prefill.title, "Service: Whole House Generator");
  assert.match(params.prefill.notes, /Parent asset: Brighton Home/);
  assert.equal(params.prefill.extra_metadata.action_type, "service");
  assert.equal(params.prefill.extra_metadata.assignment_scope, "system");
});

test("visible Add Service handlers navigate to CreateReminder instead of timeline or public story", () => {
  for (const file of [
    "screens/HomeShowcaseScreen.js",
    "screens/BoatScreen.js",
    "screens/GarageScreen.js",
    "screens/BoatShowcaseScreen.js",
    "screens/HomeSystemStoryScreen.js",
    "screens/BoatSystemStoryScreen.js",
    "screens/VehicleSystemStoryScreen.js",
    "screens/HomeSystemsScreen.js",
    "screens/BoatSystemsScreen.js",
    "screens/VehicleSystemsScreen.js",
  ]) {
    const source = read(file);
    assert.match(source, /buildServiceActionRouteParams/);
    assert.match(source, /navigate\("CreateReminder",\s*buildServiceActionRouteParams/);
  }
});

test("historical timeline and completed-service entry points stay on timeline routes", () => {
  for (const file of [
    "screens/HomeStoryScreen.js",
    "screens/BoatStoryScreen.js",
    "screens/VehicleStoryScreen.js",
    "screens/OtherAssetStoryScreen.js",
  ]) {
    const source = read(file);
    assert.match(source, /const goToAddTimelineRecord = \(\) => \{[\s\S]*navigate\("AddTimelineRecord"/);
    assert.match(source, /const goToLogPro = \(\) => \{[\s\S]*navigate\("AddServiceRecord"/);
  }

  for (const file of [
    "screens/HomeSystemStoryScreen.js",
    "screens/BoatSystemStoryScreen.js",
    "screens/VehicleSystemStoryScreen.js",
  ]) {
    const source = read(file);
    assert.match(source, /goToAddTimelineRecord[\s\S]*navigate\("AddTimelineRecord"/);
  }
});
