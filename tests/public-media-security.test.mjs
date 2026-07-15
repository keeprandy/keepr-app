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

  assert.match(source, /image_url:\s*`\/api\/public-media\//);
  assert.match(source, /media_id/);
  assert.match(source, /createSignedUrl/);

  for (const forbidden of [
    "attachment_id:",
    "file_name:",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be in the public response`);
  }

  assert.equal(source.includes("image_url: signed"), false);
  assert.equal(source.includes("image_url: upstream"), false);
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

  assert.match(source, /functions\/v1\/public-story-media\?media_id=/);
  assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(source.includes("createSignedUrl"), false);
  assert.equal(source.includes("storage_path"), false);

  for (const forbidden of ["res.json({ signedUrl", "res.json({ storage_path", "res.json({ bucket"]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be returned`);
  }
});

test("orchestration keeps JWT verification enabled while public media is explicit", () => {
  const source = read("supabase/config.toml");

  assert.match(
    source,
    /\[functions\.kac-intelligence-orchestration\][\s\S]*?verify_jwt = true/
  );
  assert.match(source, /\[functions\.public-story-media\][\s\S]*?verify_jwt = false/);
});
