import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("projection semantics distinguish visibility from meaning", () => {
  const helper = read("lib/assetProjectionSemantics.js");

  assert.match(helper, /assigned_dealer/);
  assert.match(helper, /selling_dealer/);
  assert.match(helper, /servicing_dealer/);
  assert.match(helper, /relationshipType === "owner"/);
  assert.match(helper, /showPlaybooks: false/);
  assert.match(helper, /showOwnerPanel: ownerPresent/);
  assert.match(helper, /showContribution: false/);
  assert.match(helper, /dealer_sales_workspace/);
  assert.match(helper, /owner_full/);
});

test("fleet and detail screens use relationship projection semantics", () => {
  const fleet = read("screens/KeeprSpaceFleetScreen.js");
  const detail = read("screens/KeeprProStewardshipViewScreen.js");

  assert.match(fleet, /assetProjectionSemantics/);
  assert.match(fleet, /semantics\.openLabel/);
  assert.doesNotMatch(fleet, /Open Keeprship/);

  assert.match(detail, /assetProjectionSemantics/);
  assert.match(detail, /projectionSemantics\.headerEyebrow/);
  assert.match(detail, /projectionSemantics\.summaryHint/);
  assert.match(detail, /projectionSemantics\.showOwnerPanel/);
  assert.match(detail, /projectionSemantics\.showPlaybooks/);
  assert.match(detail, /projectionSemantics\.showContribution/);
  assert.match(detail, /rawSystemsRole === "oem"[\s\S]*\? null/);
  assert.doesNotMatch(detail, /Active Keeprship with/);
  assert.doesNotMatch(detail, /Owner ↔/);
});

test("playbooks are gated by asset relationship/access scope", () => {
  const playbooks = read("screens/KeeprSpacePlaybooksScreen.js");

  assert.match(playbooks, /assetProjectionSemantics/);
  assert.match(playbooks, /\.showPlaybooks/);
  assert.match(playbooks, /playbooksAllowed/);
  assert.match(playbooks, /Playbooks unavailable/);
  assert.match(playbooks, /This relationship does not enable owner or service playbooks/);
});
