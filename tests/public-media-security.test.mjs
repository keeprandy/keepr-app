import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadPublicMediaHandler() {
  const source = read("api/public-media/[mediaId].js");
  const executable = source.replace("export default async function handler", "async function handler");
  return new Function(
    "process",
    "fetch",
    "Buffer",
    `${executable}\nreturn handler;`
  );
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    send(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function runPublicMediaHandler({ upstreamStatus = 200, upstreamContentType = "image/jpeg", upstreamBody = "ok" }) {
  const calls = [];
  const handlerFactory = loadPublicMediaHandler();
  const handler = handlerFactory(
    {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
      },
    },
    async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: upstreamStatus >= 200 && upstreamStatus < 300,
        status: upstreamStatus,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? upstreamContentType : null;
          },
        },
        async arrayBuffer() {
          return Buffer.from(upstreamBody).buffer.slice(
            Buffer.from(upstreamBody).byteOffset,
            Buffer.from(upstreamBody).byteOffset + Buffer.from(upstreamBody).byteLength
          );
        },
      };
    },
    Buffer
  );

  const req = { method: "GET", query: { mediaId: "media_123456" } };
  const res = createMockResponse();
  await handler(req, res);
  return { calls, res };
}

test("public media proxy delegates to public-story-media by opaque media id", () => {
  const source = read("api/public-media/[mediaId].js");

  assert.match(source, /functions\/v1\/public-story-media\?media_id=/);
  assert.match(source, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /apikey:\s*anonKey/);
  assert.match(source, /Authorization:\s*`Bearer \$\{anonKey\}`/);
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

test("public media proxy forwards public anon auth upstream without service-role credentials", async () => {
  const { calls, res } = await runPublicMediaHandler({});

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /functions\/v1\/public-story-media\?media_id=media_123456/);
  assert.equal(calls[0].options.headers.apikey, "anon-test-key");
  assert.equal(calls[0].options.headers.Authorization, "Bearer anon-test-key");
  assert.equal(JSON.stringify(calls[0]).includes("SERVICE_ROLE"), false);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes("anon-test-key"), false);
});

test("public media proxy streams upstream image responses with safe headers", async () => {
  const { res } = await runPublicMediaHandler({
    upstreamContentType: "image/jpeg",
    upstreamBody: "image-body",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.equal(res.headers["Content-Disposition"], 'inline; filename="keepr-showcase-media"');
  assert.equal(Buffer.isBuffer(res.body), true);
});

test("public media proxy streams upstream PDF responses with safe headers", async () => {
  const { res } = await runPublicMediaHandler({
    upstreamContentType: "application/pdf",
    upstreamBody: "%PDF-redacted",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.equal(res.headers["Content-Disposition"], 'inline; filename="keepr-showcase-document.pdf"');
  assert.equal(Buffer.isBuffer(res.body), true);
});

test("public media proxy maps upstream failures to generic safe errors", async () => {
  const unauthorized = await runPublicMediaHandler({ upstreamStatus: 401 });
  const missing = await runPublicMediaHandler({ upstreamStatus: 404 });
  const failed = await runPublicMediaHandler({ upstreamStatus: 500 });

  assert.equal(unauthorized.res.statusCode, 502);
  assert.deepEqual(unauthorized.res.body, { error: "media_fetch_failed" });
  assert.equal(missing.res.statusCode, 404);
  assert.deepEqual(missing.res.body, { error: "media_not_found" });
  assert.equal(failed.res.statusCode, 502);
  assert.deepEqual(failed.res.body, { error: "media_fetch_failed" });
});

test("public story screen normalizes current safe media rows to proxy URLs", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function normalizePublicStoryMediaRows/);
  assert.match(source, /\/api\/public-media\//);
  assert.match(source, /String\(x\.public_media_id\)/);
  assert.match(source, /url\.includes\("\/api\/public-media\/"\)/);
  assert.equal(source.includes("PUBLIC STORY MEDIA JSON"), false);
});

test("local Public Story review uses configured public media host instead of localhost API fallback", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function getPublicStoryBaseUrl/);
  assert.match(source, /EXPO_PUBLIC_KEEPR_BASE_URL/);
  assert.match(source, /isLocalOrigin/);
  assert.match(source, /localhost\|127\\\.0\\\.0\\\.1/);
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

test("public showcase documents iframe only public-media PDF URLs", () => {
  const source = read("components/showcase/ShowcaseAttachmentsSection.js");

  assert.match(source, /const isPublicMediaUrl/);
  assert.match(source, /pathname\.startsWith\("\/api\/public-media\/"\)/);
  assert.match(source, /variant !== "public" \|\| isPublicMediaUrl\(previewUrl\)/);
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

test("public-story-media returns separate media, files, and links arrays", () => {
  const source = read("supabase/functions/public-story-media/index.ts");
  const postLoop = source.slice(
    source.indexOf("for (const row of rows || [])"),
    source.indexOf("return jsonResponse({ media, showcaseFiles, showcaseLinks })")
  );

  assert.match(source, /return jsonResponse\(\{ media, showcaseFiles, showcaseLinks \}\)/);
  assert.match(source, /function isImageLike/);
  assert.match(source, /function isDocumentLike/);
  assert.match(source, /function isExternalShowcaseLink/);
  assert.match(source, /public_asset_story_gallery/);
  assert.doesNotMatch(source, /function upstreamLooksAvailable/);
  assert.doesNotMatch(postLoop, /signedOrDirectUrl/);
  assert.doesNotMatch(postLoop, /fetch\(/);
  assert.doesNotMatch(postLoop, /createSignedUrl/);
  assert.doesNotMatch(source, /return jsonResponse\(\{ media \}\)/);
});
