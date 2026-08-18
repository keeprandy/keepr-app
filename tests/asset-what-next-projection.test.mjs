import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadProjection() {
  const helperSource = read("lib/playbookActionContext.js")
    .replace(/export function /g, "function ");
  const source = read("lib/assetWhatNextProjection.js")
    .replace(/import \{ getActionScheduledDueAt \} from "\.\/playbookSchedule";/, "function getActionScheduledDueAt(action) { return action?.extra_metadata?.playbook_due_date_pending ? null : action?.due_at || null; }")
    .replace(/import \{\s*enrichPlaybookActions,\s*getPlaybookStepPosition,\s*\} from "\.\/playbookActionContext";/, "")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");
  return Function(
    `${helperSource}
${source}
return {
  WHAT_NEXT_MAX_VISIBLE_ACTIONS,
  isWhatNextActionOverdue,
  sortWhatNextActions,
  projectWhatNextActions,
};`
  )();
}

function loadPlaybookActionContext() {
  const source = read("lib/playbookActionContext.js")
    .replace(/export function /g, "function ");
  return Function(
    `${source}
return {
  enrichPlaybookActions,
  getPlaybookStepPosition,
};`
  )();
}

function loadPlaybookSchedule() {
  const source = read("lib/playbookSchedule.js")
    .replace(/export function /g, "function ");
  return Function(
    `${source}
return {
  getActionEstimatedDueAt,
  getActionScheduleLabel,
};`
  )();
}

const {
  WHAT_NEXT_MAX_VISIBLE_ACTIONS,
  isWhatNextActionOverdue,
  projectWhatNextActions,
} = loadProjection();
const { enrichPlaybookActions } = loadPlaybookActionContext();
const { getActionEstimatedDueAt, getActionScheduleLabel } = loadPlaybookSchedule();

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

test("What Next projection identifies and prioritizes the next Playbook step", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const projection = projectWhatNextActions(
    [
      {
        id: "plain-action",
        asset_id: "asset-1",
        status: "open",
        created_at: "2026-01-01",
      },
      {
        id: "playbook-step-5",
        asset_id: "asset-1",
        status: "open",
        created_at: "2026-01-03",
        extra_metadata: {
          source: "keeprspace_playbook",
          playbook_id: "plan-1",
          playbook_name: "Wilson Winter Storage & Care",
          playbook_step_position: 5,
        },
      },
      {
        id: "playbook-step-4",
        asset_id: "asset-1",
        status: "open",
        created_at: "2026-01-04",
        extra_metadata: {
          source: "keeprspace_playbook",
          playbook_id: "plan-1",
          playbook_name: "Wilson Winter Storage & Care",
          playbook_step_position: 4,
        },
      },
    ],
    "asset-1",
    { now }
  );

  assert.equal(projection.actions[0].id, "playbook-step-4");
  assert.equal(projection.actions[0].what_next.is_next_playbook_step, true);
  assert.equal(projection.actions[0].what_next.playbook_name, "Wilson Winter Storage & Care");
  assert.equal(projection.actions[0].what_next.playbook_step_position, 4);
  assert.equal(projection.actions[0].what_next.playbook_total_steps, 5);
});

test("What Next projection keeps overdue non-Playbook actions ahead of care-plan steps", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const projection = projectWhatNextActions(
    [
      {
        id: "playbook-step-4",
        asset_id: "asset-1",
        status: "open",
        extra_metadata: {
          source: "keeprspace_playbook",
          playbook_id: "plan-1",
          playbook_step_position: 4,
        },
      },
      {
        id: "overdue",
        asset_id: "asset-1",
        status: "open",
        due_at: "2026-07-01T12:00:00.000Z",
      },
    ],
    "asset-1",
    { now }
  );

  assert.deepEqual(
    projection.actions.map((action) => action.id),
    ["overdue", "playbook-step-4"]
  );
});

test("Playbook action context marks only the next open step as next", () => {
  const enriched = enrichPlaybookActions([
    {
      id: "step-2-completed",
      status: "completed",
      extra_metadata: {
        source: "keeprspace_playbook",
        playbook_id: "plan-1",
        playbook_name: "Wilson Winter Storage & Care",
        playbook_step_position: 2,
      },
    },
    {
      id: "step-3-open",
      status: "open",
      extra_metadata: {
        source: "keeprspace_playbook",
        playbook_id: "plan-1",
        playbook_name: "Wilson Winter Storage & Care",
        playbook_step_position: 3,
      },
    },
    {
      id: "step-4-open",
      status: "open",
      extra_metadata: {
        source: "keeprspace_playbook",
        playbook_id: "plan-1",
        playbook_name: "Wilson Winter Storage & Care",
        playbook_step_position: 4,
      },
    },
  ]);

  assert.equal(enriched[0].playbook_context.is_next_playbook_step, false);
  assert.equal(enriched[1].playbook_context.is_next_playbook_step, true);
  assert.equal(enriched[2].playbook_context.is_next_playbook_step, false);
  assert.equal(enriched[1].playbook_context.playbook_name, "Wilson Winter Storage & Care");
  assert.equal(enriched[1].playbook_context.playbook_step_position, 3);
  assert.equal(enriched[1].playbook_context.playbook_total_steps, 4);
});

test("Playbook pending due_at placeholder is not treated as an estimated date", () => {
  const action = {
    due_at: "2026-09-13T12:00:00.000Z",
    extra_metadata: {
      source: "keeprspace_playbook",
      playbook_due_date_pending: true,
      playbook_due_date_placeholder: "2026-09-13T12:00:00.000Z",
    },
  };

  assert.equal(getActionEstimatedDueAt(action), null);
  assert.equal(getActionScheduleLabel(action, (value) => String(value).slice(0, 10)), "No estimated date");
});

test("Playbook explicit estimate displays as an estimated date", () => {
  const action = {
    due_at: "2026-09-13T12:00:00.000Z",
    extra_metadata: {
      source: "keeprspace_playbook",
      playbook_due_date_pending: true,
      playbook_estimated_date: "2026-10-16",
    },
  };

  assert.equal(getActionEstimatedDueAt(action), "2026-10-16");
  assert.equal(getActionScheduleLabel(action, (value) => String(value).slice(0, 10)), "Estimated 2026-10-16");
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
