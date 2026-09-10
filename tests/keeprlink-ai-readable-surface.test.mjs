import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("KeeprLINK AI surface is a thin renderer over the governed llm_context resolver", async () => {
  const route = read("api/k/[kac]/ai.js");
  const rewrites = read("vercel.json");

  assert.match(route, /resolve_keeprlink_context/);
  assert.match(route, /p_purpose: purpose/);
  assert.match(route, /const purpose = "llm_context"/);
  assert.match(route, /decorateKeeprLinkProjection/);
  assert.match(route, /renderKeeprLinkAiDocument/);
  assert.match(route, /Cache-Control", "no-store"/);
  assert.doesNotMatch(route, /\.from\(/);
  assert.doesNotMatch(route, /storage\/v1\/object\/sign/);
  assert.match(rewrites, /"source": "\/k\/:kac\/ai"/);
});

test("KeeprLINK AI document exposes semantic sections and canonical raw JSON", async () => {
  const { renderKeeprLinkAiDocument } = await import("../lib/keeprLinkAiDocument.js");

  const html = renderKeeprLinkAiDocument(
    {
      ok: true,
      manifest_version: "keepr.link.context.v2",
      generated_at: "2026-09-10T12:00:00.000Z",
      object: {
        type: "asset",
        name: "2009 Harris Kayot",
        kac_id: "BOAT-2008-3BOZ95",
        address: "/k/BOAT-2008-3BOZ95",
      },
      context_summary: {
        systems_count: 15,
        operational_history_count: 17,
      },
      systems: [
        {
          name: "Main Engine",
          facts: {
            manufacturer: "Mercury Marine",
            model: "MerCruiser 5.0 MPI",
          },
          claims: [
            {
              statement: "Service history is present.",
              provenance: { source_table: "service_records" },
            },
          ],
          resource_bindings: [{ title: "MerCruiser Service Manual #31" }],
          evidence_summary: { count: 3 },
          operational_history: { total_count: 1 },
        },
      ],
      applicable_resources: [{ title: "MerCruiser Service Manual #31", target_path: "systems/Main Engine" }],
      operational_history: {
        total_count: 17,
        recent_records: [{ title: "Oil Change", date: "2025-07-02" }],
      },
      relationships: [{ organization: "Wilson Marine", relationship_type: "provider_stewardship" }],
      evidence_summary: { attachment_count: 10 },
      knowledge_gaps: [{ label: "Engine hours not established" }],
    },
    {
      canonicalJsonUrl: "https://app.keeprhome.com/api/k/BOAT-2008-3BOZ95/context?purpose=llm_context",
      canonicalPageUrl: "https://app.keeprhome.com/k/BOAT-2008-3BOZ95",
    }
  );

  assert.match(html, /KeeprLINK AI-readable governed context/);
  assert.match(html, /manifest_version/);
  assert.match(html, /keepr\.link\.context\.v2/);
  assert.match(html, /BOAT-2008-3BOZ95/);
  assert.match(html, /<section id="identity">/);
  assert.match(html, /<section id="systems">/);
  assert.match(html, /<section id="resources">/);
  assert.match(html, /<section id="operational-history">/);
  assert.match(html, /<section id="relationships">/);
  assert.match(html, /<section id="evidence">/);
  assert.match(html, /<section id="gaps">/);
  assert.match(html, /Facts are Keepr-established canonical values/);
  assert.match(html, /MerCruiser Service Manual #31/);
  assert.match(html, /Wilson Marine/);
  assert.match(html, /Raw JSON/);
});
