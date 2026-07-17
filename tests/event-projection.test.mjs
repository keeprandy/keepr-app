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
  PROJECTION_PURPOSES,
  PROJECTION_TEMPLATES,
  getProjectionTemplate,
  getOperationalProjectionOptions,
  mapLegacyModeToProjectionPurpose,
  getDefaultEventProjectionConfig,
  normalizeProjectionConfig,
  getProjectionActionsForPurpose,
  isFinancialControlAllowedForProjection,
  splitConfiguredHighlights
};`
  )();
}

test("Projection registry exposes operational share, event, and custom templates only", () => {
  const { getOperationalProjectionOptions, PROJECTION_TEMPLATES } = loadProjectionRegistry();
  const exposed = getOperationalProjectionOptions().map((template) => template.key);

  assert.deepEqual(exposed, ["share", "event", "custom"]);
  assert.equal(PROJECTION_TEMPLATES.for_sale.operational, false);
  assert.equal(PROJECTION_TEMPLATES.if_found.operational, false);
  assert.equal(PROJECTION_TEMPLATES.for_rent.exposed, false);
});

test("Event template defines supported asset types, fields, cards, actions, and maturity", () => {
  const { getProjectionTemplate } = loadProjectionRegistry();
  const event = getProjectionTemplate("event");

  assert.deepEqual(event.supportedAssetTypes, ["vehicle", "boat", "other", "asset"]);
  assert.ok(event.fields.includes("event.eventLocation"));
  assert.deepEqual(event.cardDefinitions, ["event_showcase", "vehicle_highlights", "message_owner"]);
  assert.deepEqual(event.defaultCardOrder, ["event_showcase", "vehicle_highlights", "message_owner"]);
  assert.deepEqual(event.supportedActions, ["request_info"]);
  assert.equal(event.ctaLabels.askOwner, "Ask Owner");
  assert.equal(event.privacyDefaults.showFinancials, false);
  assert.equal(event.capabilityMaturity, "operational");
});

test("Legacy stored public modes map to backward-compatible projection purposes", () => {
  const { mapLegacyModeToProjectionPurpose, normalizeProjectionConfig } = loadProjectionRegistry();

  assert.equal(mapLegacyModeToProjectionPurpose("inquiry"), "share");
  assert.equal(mapLegacyModeToProjectionPurpose("current_story"), "share");
  assert.equal(mapLegacyModeToProjectionPurpose("system_story"), "share");
  assert.equal(mapLegacyModeToProjectionPurpose("event"), "event");
  assert.equal(mapLegacyModeToProjectionPurpose("custom"), "custom");

  assert.equal(
    normalizeProjectionConfig({ actions: { mode: "inquiry" } }).purpose,
    "share"
  );
});

test("Event field defaults are deterministic and financial controls are excluded", () => {
  const {
    getDefaultEventProjectionConfig,
    getProjectionActionsForPurpose,
    isFinancialControlAllowedForProjection,
  } = loadProjectionRegistry();

  const defaults = getDefaultEventProjectionConfig();
  assert.equal(defaults.eventName, "");
  assert.equal(defaults.includeEventShowcase, true);
  assert.equal(defaults.allowAskOwner, true);
  assert.equal(defaults.showOwnerName, false);
  assert.deepEqual(getProjectionActionsForPurpose("event"), ["request_info"]);
  assert.equal(isFinancialControlAllowedForProjection("event"), false);
  assert.equal(isFinancialControlAllowedForProjection("share"), true);
});

test("Configured event highlights split from owner-entered text only", () => {
  const { splitConfiguredHighlights } = loadProjectionRegistry();

  assert.deepEqual(
    splitConfiguredHighlights("Concours prep\nRecent service, Original books"),
    ["Concours prep", "Recent service", "Original books"]
  );
});

test("PublicConfigScreen persists projection config and hides unsupported Event controls", () => {
  const source = read("screens/PublicConfigScreen.js");

  assert.match(source, /Projection Purpose/);
  assert.match(source, /Event Projection/);
  assert.match(source, /projection:\s*\{/);
  assert.match(source, /purpose:\s*projectionPurpose/);
  assert.match(source, /event:\s*\{/);
  assert.match(source, /setProjectionPurpose\(projectionConfig\.purpose\)/);
  assert.match(source, /setEventProjection\(projectionConfig\.event\)/);
  assert.match(source, /projectionPurpose !== "event"/);
  assert.match(source, /financialControlsAllowed \? showFinancials : false/);
  assert.match(source, /getProjectionActionsForPurpose\("event"\)/);
  assert.doesNotMatch(source, /for_rent[\s\S]{0,120}Projection Purpose/);
});

test("Public Story renders Event cards in configured order without empty cards", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /eventCardsToRender\.map\(\(card\) => renderEventProjectionCard\(card\)\)\.filter\(Boolean\)/);
  assert.match(source, /case "event_showcase":/);
  assert.match(source, /case "vehicle_highlights":/);
  assert.match(source, /case "message_owner":/);
  assert.match(source, /if \(!hasContent\) return null;/);
  assert.match(source, /if \(!hasIdentity && !highlights\.length\) return null;/);
});

test("Event Message Owner card reuses PublicAction and carries projection, Hub, and event context", () => {
  const storySource = read("screens/PublicKeeprStoryScreen.js");
  const actionSource = read("screens/PublicActionScreen.js");
  const functionSource = read("supabase/functions/public-action/index.ts");

  assert.match(storySource, /navigation\.navigate\("PublicAction", eventActionRouteParams\)/);
  assert.match(storySource, /projectionType:\s*"event"/);
  assert.match(storySource, /hubId:\s*eventHubId/);
  assert.match(storySource, /eventName:\s*eventProjection\.eventName/);
  assert.match(storySource, /Ask the owner about this/);
  assert.doesNotMatch(storySource, /SecondMessage|new message form/i);

  assert.match(actionSource, /const projectionType = route\?\.params\?\.projectionType/);
  assert.match(actionSource, /projection_type:\s*projectionType/);
  assert.match(actionSource, /hub_id:\s*originHubId/);
  assert.match(actionSource, /event:\s*\{/);

  assert.match(functionSource, /projection_type:\s*safeStr\(payloadPublicAction\.projection_type\)/);
  assert.match(functionSource, /hub_id:\s*safeStr\(payloadPublicAction\.hub_id\)/);
  assert.match(functionSource, /hub_id:\s*publicAction\.hub_id \|\| null/);
  assert.match(functionSource, /projection_type:\s*publicAction\.projection_type \|\| null/);
});

test("Share projection remains compatible with current Public Story surface", () => {
  const storySource = read("screens/PublicKeeprStoryScreen.js");
  const { normalizeProjectionConfig } = loadProjectionRegistry();
  const config = normalizeProjectionConfig({
    actions: { mode: "current_story" },
    story: { showHero: true },
  });

  assert.equal(config.purpose, "share");
  assert.deepEqual(config.cardOrder, ["hero", "story_context", "timeline", "showcase", "actions"]);
  assert.match(storySource, /Timeline/);
  assert.match(storySource, /Showcase/);
  assert.match(storySource, /Actions/);
  assert.match(storySource, /ShowcaseAttachmentsSection/);
});

test("Custom projection is operational but does not expose unsupported financial modes", () => {
  const { getProjectionTemplate, getOperationalProjectionOptions } = loadProjectionRegistry();

  assert.equal(getProjectionTemplate("custom").operational, true);
  assert.ok(getProjectionTemplate("custom").cardDefinitions.includes("showcase"));
  assert.deepEqual(
    getOperationalProjectionOptions().map((template) => template.key),
    ["share", "event", "custom"]
  );
});
