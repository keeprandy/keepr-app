import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("public story media listing returns only Keepr proxy URLs", () => {
  const source = read("supabase/functions/public-story-media/index.ts");

  assert.equal(source.includes("createSignedUrl"), false);
  assert.match(source, /image_url:\s*`\/api\/public-media\//);

  for (const forbidden of [
    "attachment_id:",
    "bucket:",
    "storage_path:",
    "file_name:",
    "mime_type:",
    "signedUrl",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be in the public response`);
  }
});

test("public story screen normalizes media to same-origin proxy URLs", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function normalizePublicStoryMediaRows/);
  assert.match(source, /\/api\/public-media\//);
  assert.match(source, /url\.includes\("\/api\/public-media\/"\)/);
  assert.equal(source.includes("PUBLIC STORY MEDIA JSON"), false);
});

test("public hub story cards consume only proxy-safe media URLs", () => {
  const source = read("screens/KeeprHubScreen.js");

  assert.match(source, /function normalizePublicStoryMediaRows/);
  assert.match(source, /\/api\/public-media\//);
  assert.match(source, /String\(x\.public_media_id\)/);
});

test("Open Graph route emits proxy media URLs or fallback only", () => {
  const source = read("api/og/k/[kac].js");

  assert.match(source, /function toPublicMediaOgUrl/);
  assert.match(source, /\/api\/public-media\//);
  assert.equal(source.includes("signedUrl"), false);
  assert.equal(source.includes("storage_path"), false);
});

test("public media proxy signs and fetches storage only server-side", () => {
  const source = read("api/public-media/[mediaId].js");

  assert.match(source, /createSignedUrl/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /select\("placement_id,url,bucket,storage_path,mime_type"\)/);

  for (const forbidden of ["res.json({ signedUrl", "res.json({ storage_path", "res.json({ bucket"]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be returned`);
  }
});
