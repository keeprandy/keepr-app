import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("public media proxy delegates to public-story-media by opaque media id", () => {
  const source = read("api/public-media/[mediaId].js");

  assert.match(source, /functions\/v1\/public-story-media\?media_id=/);
  assert.match(source, /UUIDISH_RE/);
  assert.match(source, /application\/octet-stream/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /keepr-showcase-document\.pdf/);
  assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(source.includes("createSignedUrl"), false);
  assert.equal(source.includes("storage_path"), false);

  for (const forbidden of ["res.json({ signedUrl", "res.json({ storage_path", "res.json({ bucket"]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be returned`);
  }
});

test("public story screen normalizes current safe media rows to proxy URLs", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function normalizePublicStoryMediaRows/);
  assert.match(source, /\/api\/public-media\//);
  assert.match(source, /String\(x\.public_media_id\)/);
  assert.match(source, /url\.includes\("\/api\/public-media\/"\)/);
  assert.equal(source.includes("PUBLIC STORY MEDIA JSON"), false);
});

test("public story screen normalizes Showcase files to proxy URLs without browser signing", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function normalizePublicStoryFileRows/);
  assert.match(source, /showcaseFiles:\s*normalizePublicStoryFileRows\(json\?\.showcaseFiles\)/);
  assert.match(source, /file_name:\s*safeName/);
  assert.match(source, /mime_type:\s*row\?\.mime_type \|\| row\?\.content_type \|\| null/);
  assert.match(source, /if \(file\.url\) return file\.url/);
  assert.equal(source.includes("getSignedUrl"), false);
  assert.equal(source.includes("bucket && file.storage_path"), false);
});

test("public Showcase links remain external links and are not proxied", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /showcaseLinks:\s*Array\.isArray\(json\?\.showcaseLinks\) \? json\.showcaseLinks : \[\]/);
  assert.doesNotMatch(source, /showcaseLinks:\s*normalizePublicStoryFileRows/);
});

test("public hub story cards consume only proxy-compatible media rows", () => {
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
