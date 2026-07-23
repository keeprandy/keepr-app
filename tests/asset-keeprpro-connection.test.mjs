import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadEngagementHelpers() {
  const source = read("lib/keeprProEngagement.js").replaceAll("export ", "");
  return new Function(
    `${source}
return {
  buildKeeprProProviderTarget,
  buildPrivateKeeprProActionPrefill
};`
  )();
}

function loadCardHelpers() {
  const source = read("components/KeeprProCommunicationCard.js")
    .replace(/import[\s\S]*?;\n/g, "")
    .replace(/export default function[\s\S]*/m, "")
    .replaceAll("export ", "");

  return new Function(
    `${source}
return {
  getAssetKeeprProsFromMetadata,
  getAssetKeeprProFromMetadata
};`
  )();
}

test("Edit Asset saves asset-level KeeprPro ids and assignment metadata", () => {
  const source = read("screens/EditAssetScreen.js");

  assert.match(source, /const effectiveType = \(assetId \? type : assetTypeParam \|\| type \|\| "home"\)\.toLowerCase\(\)/);
  assert.match(source, /const normalizedType = \(assetId \? type : assetTypeParam \|\| type \|\| "home"\)\.toLowerCase\(\)/);
  assert.match(source, /setType\(data\.type \|\| "home"\)/);
  assert.match(source, /"extra_metadata"/);
  assert.doesNotMatch(source, /"metadata"/);
  assert.match(source, /payload\.extra_metadata = nextMetadata/);
  assert.match(source, /standard\.relationships\.keepr_pro_ids = selectedIds/);
  assert.match(source, /standard\.relationships\.keepr_pro_assignments = assignments/);
  assert.match(source, /scope:\s*"asset"/);
  assert.match(source, /assignment_scope:\s*"asset"/);
  assert.match(source, /relationship_label:\s*"Linked Service Partner"/);
  assert.match(source, /Asset-level means this provider is connected to the asset generally/);
});

test("asset metadata projects Linked Service Partner rows without a provider lookup", () => {
  const { getAssetKeeprProsFromMetadata } = loadCardHelpers();

  const pros = getAssetKeeprProsFromMetadata({
    metadata: {
      standard: {
        relationships: {
          keepr_pro_ids: ["wilson"],
          keepr_pro_assignments: [
            {
              id: "wilson",
              label: "Wilson Marine",
              category: "Marine service",
              phone: "555-0100",
              scope: "asset",
              assignment_scope: "asset",
            },
          ],
        },
      },
    },
  });

  assert.equal(pros.length, 1);
  assert.equal(pros[0].id, "wilson");
  assert.equal(pros[0].name, "Wilson Marine");
  assert.equal(pros[0].category, "Marine service");
});

test("Asset Story renders selected providers as Linked Service Partner", () => {
  for (const file of [
    "screens/HomeStoryScreen.js",
    "screens/BoatStoryScreen.js",
    "screens/VehicleStoryScreen.js",
  ]) {
    const source = read(file);
    assert.match(source, /getAssetKeeprProsFromMetadata/);
    assert.match(source, /relationshipLabel="Linked Service Partner"/);
    assert.match(source, /assignmentScope="asset"/);
  }
});

test("asset-scoped Request Service opens private canonical Action prefill", () => {
  const boat = read("screens/BoatStoryScreen.js");
  const { buildPrivateKeeprProActionPrefill } = loadEngagementHelpers();

  assert.match(boat, /buildPrivateKeeprProActionPrefill/);
  assert.match(boat, /navigation\.navigate\("CreateReminder"/);
  assert.match(boat, /assetName:\s*boatName/);
  assert.match(boat, /assignmentScope:\s*"asset"/);
  assert.match(boat, /afterSave:\s*"Notifications"/);
  assert.doesNotMatch(boat, /requestAssetServiceFromKeeprPro[\s\S]*navigation\.navigate\("PublicAction"/);
  assert.doesNotMatch(boat, /Public link needed/);

  const prefill = buildPrivateKeeprProActionPrefill({
    assetId: "harris-kayot",
    assetName: "2009 Harris Kayot V220i",
    keeprProId: "wilson",
    keeprProLabel: "Wilson Marine",
    assignmentScope: "asset",
    sourceScreen: "boat_story",
  });

  assert.equal(prefill.asset_id, "harris-kayot");
  assert.equal(prefill.system_id, null);
  assert.equal(prefill.title, "Request service: 2009 Harris Kayot V220i");
  assert.equal(prefill.extra_metadata.provider_target.scope, "asset");
  assert.equal(prefill.extra_metadata.provider_target.system_id, null);
  assert.match(prefill.notes, /Subject asset: 2009 Harris Kayot V220i/);
});

test("provider attribution remains metadata only and child systems are not mutated", () => {
  const editAsset = read("screens/EditAssetScreen.js");
  const createReminder = read("screens/CreateReminderScreen.js");
  const authTests = read("tests/coordination-team-visibility.test.mjs");

  assert.match(createReminder, /extraMeta\.provider_target/);
  assert.match(authTests, /provider metadata alone grants no access/);
  assert.doesNotMatch(editAsset, /from\("systems"\)[\s\S]*keepr_pro_ids/);
  assert.doesNotMatch(editAsset, /all_systems|selected_system|system_ids/);
});
