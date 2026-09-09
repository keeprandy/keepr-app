import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function loadProvenanceHelpers() {
  const source = fs
    .readFileSync(path.join(repoRoot, "lib/provenance.js"), "utf8")
    .replaceAll("export ", "");

  return new Function(
    `${source}
return {
  getContributionMetadata,
  formatContributionAttribution
};`
  )();
}

test("contribution attribution tolerates null production rows", () => {
  const { getContributionMetadata, formatContributionAttribution } = loadProvenanceHelpers();

  assert.deepEqual(getContributionMetadata(null), {});
  assert.equal(formatContributionAttribution(null), null);
  assert.equal(formatContributionAttribution({ source_context: null }), null);
});

test("contribution attribution still formats row metadata", () => {
  const { formatContributionAttribution } = loadProvenanceHelpers();

  assert.equal(
    formatContributionAttribution({
      source_context: { contribution_context: "owner_import", source_system: "carfax" },
    }),
    "Imported from CARFAX"
  );
  assert.equal(
    formatContributionAttribution({
      contributed_by_user_label: "Andy",
      contributed_by_org_label: "Wilson Marine",
    }),
    "Added by Andy · Wilson Marine"
  );
});
