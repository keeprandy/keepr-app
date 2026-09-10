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
    actions: [
      {
        id: "action-1",
        asset_id: "asset-kf018",
        title: "Schedule delivery walkthrough",
        status: "open",
        extra_metadata: { playbook_name: "Delivery" },
      },
    ],
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
  assert.ok(projection.owner.knows.some((item) => item.label === "Keepr knows this exact asset"));
  assert.ok(projection.owner.needs_attention.some((item) => item.label === "Schedule delivery walkthrough"));
  assert.ok(projection.owner.can_help.some((item) => item.label === "Continue the next care step"));
  assert.ok(projection.owner.can_help.some((item) => item.target === "ai_context"));
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
  assert.ok(projection.owner.summary.includes("Keepr can start building useful intelligence"));
  assert.ok(projection.owner.can_help.some((item) => item.label === "Ask KAI about this asset"));
});

test("story screens expose the generic owner-ready Asset Intelligence surface", () => {
  const story = read("screens/BoatStoryScreen.js");
  const homeStory = read("screens/HomeStoryScreen.js");
  const vehicleStory = read("screens/VehicleStoryScreen.js");
  const otherStory = read("screens/OtherAssetStoryScreen.js");
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
  assert.match(homeStory, /import AssetEnablementCard/);
  assert.match(homeStory, /asset=\{home\}/);
  assert.match(vehicleStory, /import AssetEnablementCard/);
  assert.match(vehicleStory, /asset=\{vehicle\}/);
  assert.match(otherStory, /import AssetEnablementCard/);
  assert.match(otherStory, /asset=\{asset\}/);

  assert.match(card, /purpose=self_service/);
  assert.match(card, /projectAssetEnablement/);
  assert.match(card, /What Keepr Knows/);
  assert.match(card, /What Needs Attention/);
  assert.match(card, /What Keepr Can Help Take Care Of/);
  assert.match(card, /Unresolved Diagnostics/);
  assert.match(card, /AI Context/);
  assert.ok(card.includes("/k/${encodeURIComponent(kac)}/ai"));
  assert.doesNotMatch(card, /\.from\("actions"\)|\.insert\(|createAction/);
});
