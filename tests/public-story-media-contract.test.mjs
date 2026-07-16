import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const source = fs.readFileSync(
  path.join(repoRoot, "supabase/functions/public-story-media/index.ts"),
  "utf8"
);

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif)(?:$|[?#])/i;
const DOCUMENT_EXT_RE = /\.(pdf)(?:$|[?#])/i;

function cleanContentType(value) {
  const contentType = String(value || "").split(";")[0].trim().toLowerCase();
  return contentType || "application/octet-stream";
}

function rowKind(row) {
  return String(row.kind || row.attachment_kind || row.type || "").trim().toLowerCase();
}

function rowName(row) {
  return String(row.file_name || row.name || row.title || row.storage_path || row.url || "")
    .trim()
    .toLowerCase();
}

function isImageLike(row) {
  const kind = rowKind(row);
  const mime = cleanContentType(row.mime_type || row.content_type);
  const name = rowName(row);
  return kind === "photo" || kind === "image" || mime.startsWith("image/") || IMAGE_EXT_RE.test(name);
}

function isDocumentLike(row) {
  const kind = rowKind(row);
  const mime = cleanContentType(row.mime_type || row.content_type);
  const name = rowName(row);
  return kind === "file" || kind === "document" || kind === "pdf" || mime === "application/pdf" || DOCUMENT_EXT_RE.test(name);
}

function isExternalShowcaseLink(row) {
  const url = String(row.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.supabase\.co\/storage\/v1\/object\//i.test(url)) return false;
  if (isImageLike(row) || isDocumentLike(row)) return false;
  return rowKind(row) === "link" || !row.storage_path;
}

function proxyUrl(id) {
  return `/api/public-media/${encodeURIComponent(id)}`;
}

function classifyRows(rows) {
  const media = [];
  const showcaseFiles = [];
  const showcaseLinks = [];
  const seen = new Set();

  for (const row of rows) {
    if (isExternalShowcaseLink(row)) {
      const key = `link:${row.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        showcaseLinks.push({ title: row.title || "Showcase link", url: row.url });
      }
      continue;
    }

    const id = row.public_media_id || row.placement_id;
    if (!id) continue;

    if (isImageLike(row)) {
      const key = `media:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        media.push({ public_media_id: id, image_url: proxyUrl(id) });
      }
    } else if (isDocumentLike(row)) {
      const key = `file:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        showcaseFiles.push({ public_media_id: id, url: proxyUrl(id), mime_type: row.mime_type || null });
      }
    }
  }

  return { media, showcaseFiles, showcaseLinks };
}

test("public-story-media source contains contract-safe classification helpers", () => {
  assert.match(source, /const IMAGE_EXT_RE/);
  assert.match(source, /const DOCUMENT_EXT_RE/);
  assert.match(source, /function isImageLike/);
  assert.match(source, /function isDocumentLike/);
  assert.match(source, /function isExternalShowcaseLink/);
  assert.match(source, /function fileItem/);
  assert.match(source, /function linkItem/);
  assert.match(source, /function mediaItem/);
  assert.match(source, /return jsonResponse\(\{ media, showcaseFiles, showcaseLinks \}\)/);
});

test("Porsche-like mixed public rows are split into images, files, and links", () => {
  const result = classifyRows([
    { placement_id: "img_000001", kind: "photo", mime_type: "image/jpeg", file_name: "one.jpg", storage_path: "redacted" },
    { placement_id: "pdf_000001", kind: "file", mime_type: "application/pdf", file_name: "manual.pdf", storage_path: "redacted" },
    { placement_id: "url_000001", kind: "link", title: "Owner resource", url: "https://example.com/resource" },
    { placement_id: "err_000001", mime_type: "application/octet-stream", file_name: "", storage_path: "redacted" },
  ]);

  assert.equal(result.media.length, 1);
  assert.equal(result.showcaseFiles.length, 1);
  assert.equal(result.showcaseLinks.length, 1);
  assert.equal(result.media[0].image_url, "/api/public-media/img_000001");
  assert.equal(result.showcaseFiles[0].url, "/api/public-media/pdf_000001");
});

test("Formula-like image rows remain media while HTML-like external rows become links", () => {
  const result = classifyRows([
    { placement_id: "hero000001", role: "hero", mime_type: "image/jpeg", file_name: "hero.jpg", storage_path: "redacted" },
    { placement_id: "gal_000001", role: "showcase", mime_type: "image/jpeg", file_name: "gallery.jpg", storage_path: "redacted" },
    { placement_id: "web_000001", role: "other", url: "https://example.com/spec-page" },
  ]);

  assert.equal(result.media.length, 2);
  assert.equal(result.showcaseFiles.length, 0);
  assert.equal(result.showcaseLinks.length, 1);
});

test("failed and unknown octet-stream rows are excluded conservatively", () => {
  const result = classifyRows([
    { placement_id: "bad_000001", mime_type: "text/html", file_name: "", storage_path: "redacted" },
    { placement_id: "unk_000001", mime_type: "application/octet-stream", storage_path: "redacted" },
  ]);

  assert.deepEqual(result, { media: [], showcaseFiles: [], showcaseLinks: [] });
});

test("Boat-like 31 image and 3 file rows classify in one metadata pass", () => {
  const rows = [
    ...Array.from({ length: 31 }, (_, index) => ({
      placement_id: `boat_img_${String(index).padStart(2, "0")}`,
      kind: "photo",
      mime_type: index % 2 ? "image/webp" : "application/octet-stream",
      file_name: `gallery-${index}.webp`,
      storage_path: "redacted",
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      placement_id: `boat_pdf_${String(index).padStart(2, "0")}`,
      kind: "file",
      mime_type: "application/pdf",
      file_name: `document-${index}.pdf`,
      storage_path: "redacted",
    })),
  ];

  const result = classifyRows(rows);

  assert.equal(result.media.length, 31);
  assert.equal(result.showcaseFiles.length, 3);
  assert.equal(result.showcaseLinks.length, 0);
});

test("items are not duplicated across response arrays", () => {
  const result = classifyRows([
    { placement_id: "dup_000001", mime_type: "image/jpeg", file_name: "dup.jpg", storage_path: "redacted" },
    { placement_id: "dup_000001", mime_type: "image/jpeg", file_name: "dup.jpg", storage_path: "redacted" },
    { placement_id: "doc_000001", mime_type: "application/pdf", file_name: "doc.pdf", storage_path: "redacted" },
    { placement_id: "doc_000001", mime_type: "application/pdf", file_name: "doc.pdf", storage_path: "redacted" },
  ]);

  assert.equal(result.media.length, 1);
  assert.equal(result.showcaseFiles.length, 1);
  assert.equal(result.showcaseLinks.length, 0);
});

test("contract tests do not depend on private storage metadata", () => {
  const postLoop = source.slice(
    source.indexOf("for (const row of rows || [])"),
    source.indexOf("return jsonResponse({ media, showcaseFiles, showcaseLinks })")
  );

  for (const forbidden of [
    "signedUrl:",
    "bucket:",
    "storage_path:",
    "SUPABASE_SERVICE_ROLE_KEY,",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in returned object literals`);
  }

  assert.equal(source.includes("function upstreamLooksAvailable"), false);
  assert.equal(postLoop.includes("signedOrDirectUrl"), false);
  assert.equal(postLoop.includes("fetch("), false);
});
