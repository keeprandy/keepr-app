import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function loadHubConfig() {
  const source = fs
    .readFileSync(path.join(repoRoot, "lib/hubConfig.js"), "utf8")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");

  return new Function(
    `${source}
return {
  HUB_PARTICIPATION_PRESETS,
  getHubPresetKey,
  getHubParticipationConfig,
  assetMatchesHubParticipation,
};`
  )();
}

test("membership club preset creates moderated pending submissions with generic CTA by default", () => {
  const { getHubParticipationConfig } = loadHubConfig();
  const config = getHubParticipationConfig({
    name: "Membership Club",
    slug: "membership-club",
    visibility: "public",
    settings: {
      participation_preset: "membership_club",
    },
  });

  assert.equal(config.presetKey, "membership_club");
  assert.equal(config.participation, "moderated");
  assert.equal(config.submissionStatus, "pending");
  assert.equal(config.ctaLabel, "Add Your Car");
});

test("membership club eligibility can be configured by make model and year", () => {
  const { getHubParticipationConfig, assetMatchesHubParticipation } = loadHubConfig();
  const hub = {
    name: "2000 Porsche Boxster Club",
    slug: "boxster-club",
    settings: {
      participation_preset: "membership_club",
      primary_asset_type: "vehicle",
      eligible_make: "Porsche",
      eligible_model: "Boxster",
      eligible_year: "2000",
    },
  };
  const config = getHubParticipationConfig(hub);

  assert.equal(config.ctaLabel, "Add Your 2000 Porsche Boxster");
  assert.equal(
    assetMatchesHubParticipation(
      { type: "vehicle", make: "Porsche", model: "Boxster", year: 2000 },
      hub
    ),
    true
  );
  assert.equal(
    assetMatchesHubParticipation(
      { type: "vehicle", make: "Chevrolet", model: "Corvette", year: 2000 },
      hub
    ),
    false
  );
});

test("Rally Sport Region keeps moderated Porsche submissions on quick activation", () => {
  const { getHubParticipationConfig } = loadHubConfig();
  const config = getHubParticipationConfig({
    name: "Rally Sport Region",
    slug: "rally-sport-region",
    visibility: "public",
    hub_type: "community",
    settings: {
      cta_label: "Add Your Porsche",
      asset_label: "Porsche",
      eligible_make: "Porsche",
      primary_asset_type: "vehicle",
      participation_model: "moderated",
      submission_status: "pending",
      can_quick_activate: false,
      participation_preset: "membership_club",
    },
  });

  assert.equal(config.ctaLabel, "Add Your Porsche");
  assert.equal(config.primaryAssetType, "vehicle");
  assert.equal(config.eligibleMake, "Porsche");
  assert.equal(config.submissionStatus, "pending");
  assert.equal(config.canQuickActivate, true);
});

test("public Hub activation stores intent instead of serializing it into navigation params", () => {
  const source = fs.readFileSync(path.join(repoRoot, "screens/KeeprHubScreen.js"), "utf8");
  const authNavigateMatch = source.match(/navigation\.navigate\("Auth",\s*\{[\s\S]*?preferredAssetType:[\s\S]*?\}\);/);

  assert.ok(authNavigateMatch, "Expected the Hub CTA to navigate to Auth with scalar resume params");
  assert.doesNotMatch(authNavigateMatch[0], /activationIntent\s*,/);
});

test("open event preset creates public approved submissions with event CTA", () => {
  const { getHubParticipationConfig } = loadHubConfig();
  const config = getHubParticipationConfig({
    name: "Depot Town Cruise Night",
    slug: "depot-town-cruise-night",
    visibility: "public",
    settings: {
      event_date: "2026-08-15",
    },
  });

  assert.equal(config.presetKey, "open_event");
  assert.equal(config.participation, "public");
  assert.equal(config.submissionStatus, "approved");
  assert.equal(config.ctaLabel, "Add Your Car");
  assert.equal(config.eventIdentity, "Depot Town Cruise Night");
  assert.equal(config.eventDate, "2026-08-15");
});

test("public Hub story helper filters public loads to approved rows by default", () => {
  const source = fs.readFileSync(path.join(repoRoot, "lib/hubsApi.js"), "utf8");

  assert.match(source, /includeReviewStatuses = false/);
  assert.match(source, /\.filter\(\(row\) => includeReviewStatuses \|\| \(row\.status \|\| "approved"\) === "approved"\)/);
  assert.match(source, /\.in\("status", \["approved", "pending", "declined"\]\)/);
});
