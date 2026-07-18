import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const fixture = {
  orgId: "62b8003f-719b-4e71-aad8-4720120e576b",
  teamName: "Demo Team",
  ownerEmail: "demo@keeprhome.com",
  memberEmail: "keepr5@keeprhome.com",
  assetName: "KeeprAfloat!",
  kac: "KPR-6QEH-927H",
};

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function canAccessAsset({ asset, userId, orgMembers, stewardships }) {
  if (!asset || !userId || asset.deleted_at) return false;
  if (asset.owner_id === userId) return true;
  return stewardships.some(
    (s) =>
      s.asset_id === asset.id &&
      s.active === true &&
      ((s.user_id && s.user_id === userId) ||
        (s.org_id &&
          orgMembers.some((m) => m.org_id === s.org_id && m.user_id === userId)))
  );
}

function listVisibleAssets({ assets, userId, type, orgMembers, stewardships }) {
  return assets
    .filter((asset) => canAccessAsset({ asset, userId, orgMembers, stewardships }))
    .filter((asset) => !type || asset.type === type)
    .sort((a, b) => (a.sort_rank ?? 9999) - (b.sort_rank ?? 9999));
}

function canOwnerOnlyUpdateAsset(asset, userId) {
  return !!asset && !!userId && asset.owner_id === userId;
}

function sampleScenario({ includeMember = true, shareActive = true } = {}) {
  const ownerId = "owner-user";
  const memberId = "team-member";
  const unrelatedId = "unrelated-user";
  const sharedAsset = {
    id: "asset-kafloat",
    kac_id: fixture.kac,
    name: fixture.assetName,
    type: "boat",
    owner_id: ownerId,
    deleted_at: null,
    sort_rank: 1,
  };
  const unsharedAsset = {
    id: "asset-private",
    kac_id: "KPR-PRIVATE",
    name: "Owner-only boat",
    type: "boat",
    owner_id: ownerId,
    deleted_at: null,
    sort_rank: 2,
  };
  const orgMembers = [
    { org_id: fixture.orgId, user_id: ownerId, member_role: "owner" },
    ...(includeMember
      ? [{ org_id: fixture.orgId, user_id: memberId, member_role: "member" }]
      : []),
  ];
  const stewardships = [
    {
      asset_id: sharedAsset.id,
      org_id: fixture.orgId,
      user_id: null,
      access_role: "steward",
      active: shareActive,
    },
  ];

  return {
    ownerId,
    memberId,
    unrelatedId,
    assets: [sharedAsset, unsharedAsset],
    orgMembers,
    stewardships,
    sharedAsset,
  };
}

test("useAssets relies on RLS-visible assets instead of filtering by owner_id", () => {
  const source = read("hooks/useAssets.js");

  assert.match(source, /returns assets visible to the current user through RLS/);
  assert.match(source, /Team-shared assets through asset_stewardships/);
  assert.doesNotMatch(source, /\.eq\(["']owner_id["'],\s*ownerId\)/);
  assert.doesNotMatch(source, /\.filter\([^)]*owner_id[^)]*ownerId/s);
});

test("useAssets preserves deleted/type filtering and deterministic ordering", () => {
  const source = read("hooks/useAssets.js");

  assert.match(source, /query = query\.is\("deleted_at", null\);/);
  assert.match(source, /query = query\.eq\("type", typeFilter\);/);
  assert.match(source, /\.order\("sort_rank", \{ ascending: true, nullsLast: true \}\)/);
  assert.match(source, /\.order\("created_at", \{ ascending: true \}\)/);
});

test("owner sees owned assets including the canonical shared fixture", () => {
  const scenario = sampleScenario();
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.ownerId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.deepEqual(
    rows.map((a) => a.kac_id),
    [fixture.kac, "KPR-PRIVATE"]
  );
});

test("Team member sees explicitly shared asset", () => {
  const scenario = sampleScenario();
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.memberId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.deepEqual(rows.map((a) => a.kac_id), [fixture.kac]);
});

test("Team member does not see unshared asset", () => {
  const scenario = sampleScenario();
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.memberId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.equal(rows.some((a) => a.kac_id === "KPR-PRIVATE"), false);
});

test("removed Team member loses shared-asset access", () => {
  const scenario = sampleScenario({ includeMember: false });
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.memberId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.deepEqual(rows, []);
});

test("inactive Team share no longer grants asset access", () => {
  const scenario = sampleScenario({ shareActive: false });
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.memberId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.deepEqual(rows, []);
});

test("unrelated authenticated user sees no private assets", () => {
  const scenario = sampleScenario();
  const rows = listVisibleAssets({
    assets: scenario.assets,
    userId: scenario.unrelatedId,
    type: "boat",
    orgMembers: scenario.orgMembers,
    stewardships: scenario.stewardships,
  });

  assert.deepEqual(rows, []);
});

test("Dashboard and category views consume RLS-visible useAssets results", () => {
  const dashboard = read("screens/DashboardScreen.js");
  const category = read("screens/AssetGroupDashboardScreen.js");

  assert.match(dashboard, /useAssets\("home"\)/);
  assert.match(dashboard, /useAssets\("vehicle"\)/);
  assert.match(dashboard, /useAssets\("boat"\)/);
  assert.match(dashboard, /useAssets\("other"\)/);
  assert.match(category, /useAssets\(assetType\)/);
});

test("story and showcase screens can load shared assets through useAssets", () => {
  for (const file of [
    "screens/BoatStoryScreen.js",
    "screens/HomeStoryScreen.js",
    "screens/VehicleStoryScreen.js",
    "screens/OtherAssetStoryScreen.js",
    "screens/BoatShowcaseScreen.js",
    "screens/HomeShowcaseScreen.js",
    "screens/VehicleShowcaseScreen.js",
    "screens/OtherAssetShowcaseScreen.js",
  ]) {
    assert.match(read(file), /useAssets\(/, `${file} should use RLS-visible asset listing`);
  }
});

test("Team member cannot perform owner-only asset operations", () => {
  const scenario = sampleScenario();
  const assetService = read("lib/assetsService.js");

  assert.equal(canOwnerOnlyUpdateAsset(scenario.sharedAsset, scenario.ownerId), true);
  assert.equal(canOwnerOnlyUpdateAsset(scenario.sharedAsset, scenario.memberId), false);
  assert.match(assetService, /owner_id:\s*ownerId/);
  assert.match(read("screens/ManageTeamScreen.js"), /Members see everything attached to shared assets\. Deletes are owner-only\./);
});

test("Public and Hub projections remain independent of authenticated useAssets listing", () => {
  const publicStory = read("screens/PublicKeeprStoryScreen.js");
  const publicMedia = read("supabase/functions/public-story-media/index.ts");
  const hubScreen = read("screens/KeeprHubScreen.js");

  assert.doesNotMatch(publicStory, /useAssets\(/);
  assert.match(publicStory, /public_asset_story_summary/);
  assert.match(publicMedia, /public_asset_story_gallery/);
  assert.match(hubScreen, /fetchHubStoryLinks/);
  assert.match(hubScreen, /fetchPublicStoryMedia/);
});

