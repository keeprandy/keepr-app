import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadProjection() {
  const source = read("lib/assetWhatNextProjection.js")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");
  return Function(
    `${source}
return {
  WHAT_NEXT_MAX_VISIBLE_ACTIONS,
  isWhatNextActionOverdue,
  sortWhatNextActions,
  projectWhatNextActions,
};`
  )();
}

const {
  WHAT_NEXT_MAX_VISIBLE_ACTIONS,
  isWhatNextActionOverdue,
  projectWhatNextActions,
} = loadProjection();

test("What Next projection scopes open actions to the current asset", () => {
  const projection = projectWhatNextActions(
    [
      { id: "current-open", asset_id: "asset-1", status: "open" },
      { id: "current-completed", asset_id: "asset-1", status: "completed" },
      { id: "other-open", asset_id: "asset-2", status: "open" },
      { id: "missing-asset", status: "open" },
    ],
    "asset-1"
  );

  assert.deepEqual(
    projection.actions.map((action) => action.id),
    ["current-open"]
  );
});

test("What Next projection sorts overdue first, then upcoming dates, then undated actions", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const projection = projectWhatNextActions(
    [
      { id: "undated", asset_id: "asset-1", status: "open", created_at: "2026-01-01" },
      { id: "future-late", asset_id: "asset-1", status: "open", due_at: "2026-09-05" },
      { id: "overdue", asset_id: "asset-1", status: "open", due_at: "2026-07-30" },
      { id: "future-soon", asset_id: "asset-1", status: "open", due_at: "2026-08-10" },
    ],
    "asset-1",
    { now }
  );

  assert.equal(isWhatNextActionOverdue(projection.actions[0], now), true);
  assert.deepEqual(
    projection.actions.map((action) => action.id),
    ["overdue", "future-soon", "future-late", "undated"]
  );
});

test("What Next projection caps visible actions and reports hidden count", () => {
  const actions = Array.from({ length: WHAT_NEXT_MAX_VISIBLE_ACTIONS + 2 }, (_, index) => ({
    id: `action-${index}`,
    asset_id: "asset-1",
    status: "open",
    due_at: `2026-08-${String(index + 1).padStart(2, "0")}`,
  }));

  const projection = projectWhatNextActions(actions, "asset-1");

  assert.equal(projection.visibleActions.length, WHAT_NEXT_MAX_VISIBLE_ACTIONS);
  assert.equal(projection.hiddenCount, 2);
});

test("What Next projection returns an empty result without an asset id", () => {
  const projection = projectWhatNextActions(
    [{ id: "open", asset_id: "asset-1", status: "open" }],
    null
  );

  assert.deepEqual(projection, { actions: [], visibleActions: [], hiddenCount: 0 });
});

test("authenticated story screens include What Next while Public Story stays unchanged", () => {
  const storyScreens = [
    "screens/VehicleStoryScreen.js",
    "screens/HomeStoryScreen.js",
    "screens/BoatStoryScreen.js",
    "screens/OtherAssetStoryScreen.js",
  ];

  for (const screen of storyScreens) {
    const source = read(screen);
    assert.match(source, /import AssetWhatNextSection from "\.\.\/components\/AssetWhatNextSection";/);
    assert.match(source, /<AssetWhatNextSection[\s\S]+navigation=\{navigation\}/);
  }

  assert.doesNotMatch(read("screens/PublicKeeprStoryScreen.js"), /AssetWhatNextSection/);
});
