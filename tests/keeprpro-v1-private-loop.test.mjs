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
  KEEPRPRO_SYSTEM_CONNECTOR_TYPE,
  KEEPRPRO_CONNECTOR_CAPABILITIES,
  buildKeeprProProviderTarget,
  buildPrivateKeeprProActionPrefill
};`
  )();
}

test("system KeeprPro connector builds provider_target for GenPro Action context", () => {
  const { buildPrivateKeeprProActionPrefill } = loadEngagementHelpers();

  const prefill = buildPrivateKeeprProActionPrefill({
    actionMessage: "Annual generator service",
    assetId: "brighton-home",
    assetName: "Brighton Home",
    systemId: "whole-house-generator",
    systemName: "Whole House Generator",
    keeprProId: "genpro",
    keeprProLabel: "GenPro Technician",
    assignmentScope: "system",
    sourceScreen: "home_system_story",
    dueAt: "2026-07-22T12:00:00.000Z",
  });

  assert.equal(prefill.asset_id, "brighton-home");
  assert.equal(prefill.system_id, "whole-house-generator");
  assert.equal(prefill.extra_metadata.source, "keeprpro_private_request");
  assert.deepEqual(prefill.extra_metadata.provider_target, {
    type: "keepr_pro",
    id: "genpro",
    label: "GenPro Technician",
    scope: "system",
    asset_id: "brighton-home",
    system_id: "whole-house-generator",
    connector_type: "services_system",
    capabilities: ["organization", "operational", "action"],
  });
  assert.equal(
    prefill.extra_metadata.keeprpro_connector.target_node.id,
    "whole-house-generator",
  );
  assert.match(prefill.notes, /Subject system: Whole House Generator/);
  assert.match(prefill.notes, /Parent asset: Brighton Home/);
});

test("private system Request Service opens CreateReminder with exact generator provider context", () => {
  const source = read("screens/HomeSystemStoryScreen.js");

  assert.match(source, /rel\.keepr_pro_ids \|\| rel\.keeprProIds \|\| rel\.keepr_pros/);
  assert.match(source, /assignmentScope="system"/);
  assert.match(source, /buildPrivateKeeprProActionPrefill/);
  assert.match(source, /navigation\.navigate\("CreateReminder"/);
  assert.match(source, /assignmentScope:\s*"system"/);
  assert.match(source, /sourceScreen:\s*"home_system_story"/);
  assert.match(source, /keeprProId:\s*pro\?\.id/);
  assert.match(source, /keeprProLabel:\s*pro\?\.name/);
  assert.match(source, /afterSave:\s*"Notifications"/);
  assert.doesNotMatch(source, /handleRequestServiceFromKeeprPro[\s\S]*navigation\.navigate\("PublicAction"/);
  assert.doesNotMatch(source, /handleRequestServiceFromKeeprPro[\s\S]*createOrReuseServiceReadyLink/);
});

test("private PublicAction creates canonical Action prefill instead of public inbox event", () => {
  const source = read("screens/PublicActionScreen.js");

  assert.match(source, /buildPrivateKeeprProActionPrefill/);
  assert.match(source, /isPrivateKeeprProRequest/);
  assert.match(source, /handleCreatePrivateKeeprProAction/);
  assert.match(source, /navigation\.navigate\("CreateReminder"/);
  assert.match(source, /afterSave:\s*"Notifications"/);
  assert.match(source, /Create Action/);
  assert.match(source, /navigation\.navigate\("HomeSystemStory"/);
  assert.match(source, /systemId:\s*routeSystemId/);
  assert.match(source, /systemName:\s*routeSystemName \|\| effectiveSystemName/);
});

test("system Action UI foregrounds the system as the linked subject", () => {
  const source = read("screens/CreateReminderScreen.js");

  assert.match(source, /if \(systemName\) return systemName;/);
  assert.match(source, /Parent asset: \{linkedParentContextLabel\(\)\}/);
  assert.match(source, /Set an Action that can be linked to a Keepr asset or system/);
});

test("View KeeprStory opens the registered system story destination", () => {
  const source = read("screens/HomeSystemStoryScreen.js");
  const app = read("App.js");

  assert.match(app, /name="SystemStoryPrint"/);
  assert.match(source, /handleViewSystemKeeprStory/);
  assert.match(source, /navigation\.navigate\("SystemStoryPrint"/);
  assert.match(source, /systemId,/);
  assert.match(source, /assetName,/);
  assert.match(source, /<Text style=\{styles\.chipLabel\}>View KeeprStory<\/Text>/);
  assert.doesNotMatch(source, /navigation\.navigate\("KeeprStory"/);
});

test("Action save and completion preserve provider attribution through service history", () => {
  const createReminder = read("screens/CreateReminderScreen.js");
  const serviceRecords = read("lib/serviceRecordsService.js");
  const teamActions = read("lib/teamActions.js");

  assert.match(createReminder, /extraMeta\.provider_target/);
  assert.match(createReminder, /completion_provider_target/);
  assert.match(createReminder, /providerTarget\?\.type === "keepr_pro" \? providerTarget\.id : null/);
  assert.match(createReminder, /findExistingCompletionServiceRecord/);
  assert.match(createReminder, /Created from completed reminder/);
  assert.match(serviceRecords, /keepr_pro_id:\s*keeprProId \|\| null/);
  assert.match(serviceRecords, /keepr_pro_name:\s*keeprProName \|\| null/);
  assert.match(teamActions, /provider_target: meta\.provider_target \|\| null/);
});

test("provider metadata remains attribution only and does not grant read access", () => {
  const source = read("tests/coordination-team-visibility.test.mjs");
  assert.match(source, /provider metadata alone grants no access/);
  assert.match(source, /provider_target: \{ type: "keepr_pro"/);
});
