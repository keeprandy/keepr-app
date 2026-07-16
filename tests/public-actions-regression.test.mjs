import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadActionHelpers(relativePath, startMarker, endMarker) {
  const source = read(relativePath);
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} not found in ${relativePath}`);
  assert.notEqual(end, -1, `${endMarker} not found in ${relativePath}`);

  return new Function(
    `${source.slice(start, end)}
return {
  ACTION_META: typeof ACTION_META !== "undefined" ? ACTION_META : null,
  getActionsForMode,
  normalizeActionKey: typeof normalizeActionKey !== "undefined" ? normalizeActionKey : normalizePublicActionKey,
  uniqueSupportedActions,
  getEffectivePublicActions
};`
  )();
}

const actionScreenHelpers = () =>
  loadActionHelpers(
    "screens/PublicActionScreen.js",
    "const ACTION_META =",
    "export default function PublicActionScreen"
  );

const storyScreenHelpers = () =>
  loadActionHelpers(
    "screens/PublicKeeprStoryScreen.js",
    "const SUPPORTED_PUBLIC_ACTIONS =",
    "function getPublicStoryBaseUrl"
  );

test("configured public actions appear in configured order", () => {
  const { getEffectivePublicActions } = actionScreenHelpers();
  const actions = getEffectivePublicActions({
    actionConfig: {
      actionsEnabled: [
        "request_info",
        "request_service",
        "submit_quote",
        "submit_proposal",
        "pay_rent",
      ],
    },
    allowedActions: ["view"],
    mode: "inquiry",
  });

  assert.deepEqual(actions, [
    "request_info",
    "request_service",
    "submit_quote",
    "submit_proposal",
    "pay_rent",
  ]);
});

test("legacy resolver vocabulary normalizes to supported public actions", () => {
  const { getEffectivePublicActions } = actionScreenHelpers();
  const actions = getEffectivePublicActions({
    actionConfig: {},
    allowedActions: ["answer_question", "capture_event_inbox", "request_access"],
    mode: "inquiry",
  });

  assert.deepEqual(actions, ["request_info", "request_service"]);
});

test("unsupported actions are filtered and duplicates are removed", () => {
  const { uniqueSupportedActions } = actionScreenHelpers();

  assert.deepEqual(
    uniqueSupportedActions([
      "view",
      "request_info",
      "request_info",
      "capture_event_inbox",
      "unknown",
      "pay_rent",
    ]),
    ["request_info", "request_service", "pay_rent"]
  );
});

test("empty configured actions fall back to mode defaults", () => {
  const { getEffectivePublicActions } = actionScreenHelpers();

  assert.deepEqual(
    getEffectivePublicActions({
      actionConfig: { actionsEnabled: [] },
      allowedActions: [],
      mode: "for_rent",
    }),
    ["request_info", "request_service", "pay_rent"]
  );
});

test("Public Story and Public Action share the same effective action behavior", () => {
  const story = storyScreenHelpers();
  const action = actionScreenHelpers();

  const input = {
    actionConfig: { actionsEnabled: ["submit_quote", "view", "answer_question"] },
    allowedActions: ["capture_event_inbox"],
    mode: "inquiry",
  };

  assert.deepEqual(
    story.getEffectivePublicActions(input),
    action.getEffectivePublicActions(input)
  );
});

test("Public Story shows Actions from effective actions, not only raw actionsEnabled", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /const showActionsTab =\s*actionConfig\.enabled !== false && effectivePublicActions\.length > 0;/);
  assert.match(source, /\{showActionsTab && \(/);
  assert.doesNotMatch(source, /\{actionConfig\.actionsEnabled\?\.length > 0 && \(/);
});

test("actions.enabled false hides the Story Actions tab", () => {
  const { getEffectivePublicActions } = storyScreenHelpers();
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.deepEqual(
    getEffectivePublicActions({
      actionConfig: { enabled: false, actionsEnabled: ["request_info"] },
      allowedActions: [],
      mode: "inquiry",
    }),
    ["request_info"]
  );
  assert.match(source, /actionConfig\.enabled !== false && effectivePublicActions\.length > 0/);
});

test("Public Action never renders an empty chooser for unsupported actions", () => {
  const source = read("screens/PublicActionScreen.js");

  assert.match(source, /actionConfig\.enabled !== false && enabledActions\.length > 0/);
  assert.match(source, /Actions unavailable/);
  assert.match(source, /This public story is not currently accepting supported public actions/);
});

test("Public Action resolves configured actions from public story summary", () => {
  const source = read("screens/PublicActionScreen.js");

  assert.match(source, /async function fetchPublicSummaryConfig/);
  assert.match(source, /\.from\("public_asset_story_summary"\)/);
  assert.match(source, /public_config:\s*normalized\?\.public_config \|\|\s*publicSummary\?\.public_config/);
});

test("Public Story releases initial loading before secondary requests finish", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /setAsset\(assetRow\);\s*if \(assetRow\.hero_placement_id\) \{\s*setHeroUri\(toPublicMediaUrl\(assetRow\.hero_placement_id\)\);\s*\}\s*setLoading\(false\);\s*setSecondaryLoading\(true\);/s);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /Loading timeline\.\.\./);
  assert.match(source, /Loading Showcase\.\.\./);
});

test("Public Story can request the hero from summary before media hydration completes", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");
  const summaryHeroIndex = source.indexOf("setHeroUri(toPublicMediaUrl(assetRow.hero_placement_id))");
  const mediaRequestIndex = source.indexOf("fetchPublicStoryMedia(publicKac)");
  const mediaHeroIndex = source.indexOf("setHeroUri(heroPlacement?.image_url || null)");

  assert.notEqual(summaryHeroIndex, -1, "summary hero assignment missing");
  assert.notEqual(mediaRequestIndex, -1, "media request missing");
  assert.notEqual(mediaHeroIndex, -1, "media reconciliation hero assignment missing");
  assert.ok(summaryHeroIndex < mediaRequestIndex, "summary hero must be set before media POST starts");
  assert.ok(mediaRequestIndex < mediaHeroIndex, "typed media response should still reconcile hero later");
  assert.match(source, /setHeroUri\(null\);/);
});

test("slow or failed secondary story requests do not turn a valid story into not found", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /timelineResult\.status === "fulfilled"/);
  assert.match(source, /mediaResult\.status === "fulfilled"/);
  assert.match(source, /systemsResult\.status === "fulfilled"/);
  assert.doesNotMatch(source, /await Promise\.all\(\[/);
});

test("public Story no longer performs public-mode private asset enrichment or systems reads", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.doesNotMatch(source, /\.from\("assets"\)\s*\.select\("extra_metadata"\)/s);
  assert.match(source, /assetId && !kac\s*\?\s*supabase\s*\.from\("systems"\)/s);
});
