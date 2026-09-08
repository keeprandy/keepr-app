import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("asset enablement projection separates known, inheritable, missing, unresolved, and proposed actions", async () => {
  const { projectAssetEnablement } = await import("../lib/assetEnablementProjection.js");

  const projection = projectAssetEnablement({
    asset: {
      id: "asset-kf018",
      kac_id: "KAC-TIARA-56LS-KF018",
      serial_number: "SSUKF018H627",
      year: 2027,
      make: "Tiara Yachts",
      model: "56 LS",
    },
    contextProjection: {
      projection: {
        parent_relationships: [
          {
            type: "model_template",
            binding_status: "verified",
            template: { template_key: "tiara-2027-56-ls" },
          },
        ],
        systems: [
          {
            id: "system-1",
            name: "Seakeeper SK10.5",
            system_template_id: "template-1",
            system_template: { id: "template-1", supplier_org_id: "supplier-seakeeper" },
          },
          { id: "system-2", name: "Unresolved accessory" },
        ],
        applicable_resources: [
          { id: "resource-1", title: "56 LS Buyer Guide", applies_to_type: "template" },
        ],
        knowledge_gaps: [{ title: "Generator serial unresolved" }],
      },
    },
    resources: [{ id: "resource-2", title: "KF018 commissioning photo", target_type: "asset" }],
    serviceRecords: [],
  });

  assert.equal(projection.contract, "keepr.asset.enablement.v1");
  assert.equal(projection.kac, "KAC-TIARA-56LS-KF018");
  assert.equal(projection.hin, "SSUKF018H627");
  assert.equal(projection.status.identity, "established");
  assert.equal(projection.status.model_resolution, "resolved");
  assert.equal(projection.status.system_templates, "partial");
  assert.equal(projection.status.suppliers, "partial");
  assert.equal(projection.counts.systems, 2);
  assert.equal(projection.counts.resources, 2);
  assert.ok(projection.known.some((item) => item.label === "Canonical KAC assigned"));
  assert.ok(projection.inheritable.some((item) => item.label === "Model-level ownership intelligence can apply"));
  assert.ok(projection.missing.some((item) => item.label === "Some systems lack canonical System Template links"));
  assert.ok(projection.unresolved.some((item) => item.label === "Generator serial unresolved"));
  assert.ok(projection.proposed_actions.some((item) => item.target === "systems"));
  assert.ok(projection.proposed_actions.some((item) => item.target === "timeline"));
});

test("bottom-up owner-created assets can start enablement without OEM model truth", async () => {
  const { projectAssetEnablement } = await import("../lib/assetEnablementProjection.js");

  const projection = projectAssetEnablement({
    asset: {
      id: "owner-asset",
      name: "Brighton Home",
      type: "home",
    },
    systems: [],
    resources: [],
  });

  assert.equal(projection.status.identity, "missing");
  assert.equal(projection.status.model_resolution, "unresolved");
  assert.equal(projection.status.systems, "missing");
  assert.ok(projection.missing.some((item) => item.label === "Canonical KAC missing"));
  assert.ok(projection.missing.some((item) => item.label === "Installed systems are not represented"));
  assert.ok(projection.proposed_actions.some((item) => item.key === "resolve-kac"));
  assert.ok(projection.proposed_actions.some((item) => item.key === "ask-kai"));
});

test("BoatStory exposes the owner-ready Keepr Enable surface without new routing or task systems", () => {
  const story = read("screens/BoatStoryScreen.js");
  const card = read("components/AssetEnablementCard.js");

  assert.match(story, /import AssetEnablementCard/);
  assert.match(story, /label="Keepr Enable"/);
  assert.match(story, /<AssetEnablementCard/);
  assert.match(story, /onOpenSystems=\{goToBoatSystems\}/);
  assert.match(story, /onOpenAttachments=\{goToAttachmentFiles\}/);
  assert.match(story, /onOpenTimeline=\{goToAddTimelineRecord\}/);
  assert.match(story, /onEditAsset=\{goToEditBoat\}/);
  assert.match(story, /onAskKai=\{goToMessages\}/);
  assert.match(story, /assetKacId\(boat\)/);

  assert.match(card, /purpose=self_service/);
  assert.match(card, /projectAssetEnablement/);
  assert.match(card, /Missing Intelligence/);
  assert.match(card, /Proposed next action/);
  assert.doesNotMatch(card, /\.from\("actions"\)|\.insert\(|createAction/);
});
