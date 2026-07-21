import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Service Ready helper distinguishes hashed-only rows from usable session URLs", () => {
  const source = read("lib/systemServiceReadyLinks.js");

  assert.match(source, /export async function listActiveServiceReadyLinks/);
  assert.match(source, /\.limit\(25\)/);
  assert.doesNotMatch(source, /\.maybeSingle\(/);
  assert.match(source, /sessionUrl/);
  assert.match(source, /source:\s*"session"/);
  assert.match(source, /source:\s*"hashed_only"/);
  assert.match(source, /needsFreshToken:\s*true/);
  assert.match(source, /activeLinkCount:\s*activeLinks\.length/);
});

test("Fresh Service Ready link creation preserves exact system scope and hash-only storage", () => {
  const source = read("lib/systemServiceReadyLinks.js");

  assert.match(source, /export async function createServiceReadyLink/);
  assert.match(source, /asset_id:\s*assetId/);
  assert.match(source, /system_id:\s*systemId/);
  assert.match(source, /mode:\s*PUBLIC_LINK_ACTION_MODE/);
  assert.match(source, /token_hash:\s*tokenHash/);
  assert.doesNotMatch(source, /token_hash:\s*token\s*[,}]/);

  const insertBlock = source.match(/\.insert\(\{([\s\S]*?)\n\s*\}\)/)?.[1] || "";
  assert.ok(insertBlock, "expected public_links insert block");
  assert.doesNotMatch(insertBlock, /\btoken\s*:/);
  assert.doesNotMatch(insertBlock, /\btoken\s*[,}]/);
});

test("System screens require confirmation before creating a replacement QR and link", () => {
  for (const file of [
    "screens/HomeSystemStoryScreen.js",
    "screens/BoatSystemStoryScreen.js",
    "screens/VehicleSystemStoryScreen.js",
  ]) {
    const source = read(file);

    assert.match(source, /serviceReadyUrl/);
    assert.match(source, /ServiceReadyLinkModal/);
    assert.match(source, /sessionUrl:\s*serviceReadyUrl/);
    assert.match(source, /generateFreshServiceReadyLink/);
    assert.match(source, /forceNew:\s*true/);
    assert.match(source, /Generate New QR & Link/);
    assert.match(source, /Multiple active Service Ready links exist/);
    assert.match(source, /stored token hash/);
  }
});

test("Session QR modal shows the usable URL without exposing token hashes", () => {
  const source = read("components/ServiceReadyLinkModal.js");

  assert.match(source, /QRCode/);
  assert.match(source, /Copy Link/);
  assert.match(source, /Download QR|Share QR/);
  assert.match(source, /Keepr stores only a secure token hash/);
  assert.doesNotMatch(source, /token_hash/);
});
