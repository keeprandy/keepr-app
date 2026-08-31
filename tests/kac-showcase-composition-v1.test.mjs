import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Boat Showcase composes inherited model media with exact-KAC media", () => {
  const source = read("screens/BoatShowcaseScreen.js");

  assert.match(source, /listAttachmentsForAsset\(currentBoat\.id,\s*\{\s*includeInheritedModelMedia: true,/);
  assert.doesNotMatch(source, /listAttachmentsForTarget\("asset", currentBoat\.id\)/);
  assert.match(source, /showcaseLayerFor/);
  assert.match(source, /OEM model media/);
  assert.match(source, /Dealer media/);
  assert.match(source, /Owner media/);
});

test("Inherited model media remains read-only in KAC Showcase", () => {
  const source = read("screens/BoatShowcaseScreen.js");

  assert.match(source, /photo\.isInheritedModelMedia/);
  assert.match(source, /This photo comes from the model template/);
  assert.match(source, /It was not copied onto the boat/);
  assert.match(source, /readOnlyBadge/);
  assert.match(source, /Inherited/);
});

test("Attachment API already preserves inherited model media provenance", () => {
  const source = read("lib/attachmentsApi.js");

  assert.match(source, /async function listInheritedTemplateMediaForAsset/);
  assert.match(source, /target_type", "model_template"/);
  assert.match(source, /is_inherited_model_media: true/);
  assert.match(source, /not_exact_hull_media: true/);
  assert.match(source, /return \[\.\.\.directRows, \.\.\.inheritedOnly\]/);
});

test("General attachment surfaces do not inherit model media by default", () => {
  const source = read("lib/attachmentsApi.js");

  assert.match(source, /export async function listAttachmentsForAsset\(assetId, options = \{\}\)/);
  assert.match(source, /const includeInheritedModelMedia = !!options\.includeInheritedModelMedia/);
  assert.match(source, /return includeInheritedModelMedia \? await listInheritedTemplateMediaForAsset\(assetId\) : \[\]/);
  assert.match(source, /if \(!includeInheritedModelMedia\) return directRows/);
});

test("Workspace-context boat actions use projection-safe edit and hero paths", () => {
  const showcase = read("screens/BoatShowcaseScreen.js");
  const story = read("screens/BoatStoryScreen.js");
  const workspace = read("screens/KeeprProStewardshipViewScreen.js");

  assert.match(showcase, /setKeeprSpaceAssetHero/);
  assert.match(showcase, /if \(routeOrganizationId\) \{[\s\S]*navigation\.navigate\("KeeprSpaceBoat"/);
  assert.match(story, /if \(organizationId\) \{[\s\S]*navigation\.navigate\("KeeprSpaceBoat"/);
  assert.match(workspace, /route\?\.params\?\.openEdit/);
  assert.match(workspace, /setShowBoatEdit\(true\)/);
});

test("Personal EditAsset avoids single-row coercion failures", () => {
  const source = read("screens/EditAssetScreen.js");

  assert.doesNotMatch(source, /\.eq\("id", assetId\)\s*\.single\(\)/);
  assert.match(source, /\.eq\("id", assetId\)\s*\.maybeSingle\(\)/);
  assert.match(source, /This asset is not available to edit from this account/);
  assert.match(source, /Could not reach Keepr to save this asset/);
});
