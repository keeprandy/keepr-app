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
  assert.match(helper, /eligiblePlaybookScopes/);
  assert.match(helper, /sales_prep/);
  assert.match(helper, /delivery/);
  assert.match(helper, /inventory/);
  assert.match(helper, /relationshipType === "owner"/);
  assert.match(helper, /pending_owner/);
  assert.match(helper, /showOwnerPanel: ownerPresent/);
  assert.match(helper, /showContribution: false/);
  assert.match(helper, /dealer_sales_workspace/);
  assert.match(helper, /owner_full/);
});

test("pending owner handoff does not grant owner projection", async () => {
  const mod = await import("../lib/assetProjectionSemantics.js");

  const pending = mod.assetProjectionSemantics({
    relationship: {
      relationship_type: "owner",
      status: "invited",
      access_scope: "transfer_workspace",
      claim_state: "invited",
    },
  });
  assert.equal(pending.projection, "pending_owner");
  assert.equal(pending.showPlaybooks, false);

  const accepted = mod.assetProjectionSemantics({
    relationship: {
      relationship_type: "owner",
      status: "active",
      access_scope: "owner_full",
      claim_state: "accepted",
    },
  });
  assert.equal(accepted.projection, "owner");
  assert.deepEqual(accepted.eligiblePlaybookScopes, ["owner"]);
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
  assert.match(playbooks, /playbookAllowedForProjection/);
  assert.match(playbooks, /selectedPlaybookScope/);
  assert.match(playbooks, /metadata:[\s\S]*playbook_scope: activePlaybookScope/);
  assert.match(playbooks, /playbooksAllowed/);
  assert.match(playbooks, /Playbooks unavailable/);
  assert.match(playbooks, /This relationship does not enable owner or service playbooks/);
});

test("playbook scopes follow projection semantics", async () => {
  const mod = await import("../lib/assetProjectionSemantics.js");

  const inventory = mod.assetProjectionSemantics({
    relationship: { relationship_type: "selling_dealer" },
  });
  assert.deepEqual(inventory.eligiblePlaybookScopes, ["inventory", "sales_prep", "delivery"]);
  assert.equal(mod.playbookAllowedForProjection({ metadata: { playbook_scope: "delivery" } }, inventory), true);
  assert.equal(mod.playbookAllowedForProjection({ metadata: { playbook_scope: "service" } }, inventory), false);
  assert.equal(mod.playbookAllowedForProjection({ metadata: {} }, inventory), false);

  const service = mod.assetProjectionSemantics({
    relationship: { relationship_type: "servicing_dealer" },
  });
  assert.deepEqual(service.eligiblePlaybookScopes, ["service"]);
  assert.equal(mod.playbookAllowedForProjection({ metadata: { playbook_scope: "delivery" } }, service), false);
  assert.equal(mod.playbookAllowedForProjection({ metadata: {} }, service), true);
});
