import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const MODULE_ROOT = new URL("../supabase/functions/_shared/", import.meta.url);
const REGAL_FIXTURE = new URL("../data/regal_3300_keepr_import.json", import.meta.url);

const cache = new Map();

function loadSharedModule(name) {
  const path = new URL(name, MODULE_ROOT);
  const key = path.pathname;
  if (cache.has(key)) return cache.get(key).exports;
  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  cache.set(key, module);
  function localRequire(specifier) {
    if (specifier.endsWith(".ts")) return loadSharedModule(specifier.replace("./", ""));
    throw new Error(`Unexpected require: ${specifier}`);
  }
  const context = { module, exports: module.exports, require: localRequire, console };
  vm.createContext(context);
  new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
  return module.exports;
}

const {
  buildKacContextEnvelope,
  CALLABLE_BUILD_2A_CONTEXT_PURPOSES,
  isCallableBuild2AContextPurpose,
} = loadSharedModule("kacContextEnvelope.ts");

function assoc(overrides) {
  return {
    association_id: overrides.association_id,
    object_id: overrides.object_id || overrides.association_id,
    object_type: overrides.object_type || "unknown",
    source_table: overrides.source_table,
    relationship_type: overrides.relationship_type || "related_to_asset",
    scope: overrides.scope || "kac_specific",
    proof_state: overrides.proof_state || "claimed",
    processing_status: overrides.processing_status || "not_required",
    transfer_classification: overrides.transfer_classification || "asset_persistent",
    safe_metadata: overrides.safe_metadata || {},
    provenance: overrides.provenance || [{ table: overrides.source_table, row_id: overrides.object_id || overrides.association_id }],
    ...overrides,
  };
}

function porscheManifest(overrides = {}) {
  const associations = [
    assoc({
      association_id: "asset:asset-porsche:identity",
      object_id: "asset-porsche",
      object_type: "asset",
      source_table: "assets",
      relationship_type: "canonical_manifest_asset",
      proof_state: "claimed",
      safe_metadata: { kac_id: "KPR-6GV2-MJ6W", type: "vehicle", lifecycle_state: "active", email: "redact@example.invalid" },
    }),
    assoc({
      association_id: "asset_identifier:vin",
      object_id: "id-vin",
      object_type: "asset_identifier",
      source_table: "asset_identifiers",
      relationship_type: "identifies_asset",
      proof_state: "verified",
      safe_metadata: { kind: "vin", value: "WP0CB2980YU660000" },
    }),
    assoc({
      association_id: "systems:engine",
      object_id: "sys-engine",
      object_type: "system",
      source_table: "systems",
      relationship_type: "installed_system",
      proof_state: "evidence_attached",
      safe_metadata: { name: "Engine", system_type: "engine", status: "active", serial_number: "SYS-123456" },
      created_at: "2026-01-01T00:00:00Z",
    }),
    assoc({
      association_id: "vehicle_systems:engine",
      object_id: "veh-engine",
      object_type: "vehicle_system",
      source_table: "vehicle_systems",
      relationship_type: "system_extension",
      proof_state: "evidence_attached",
      affected_system_id: "sys-engine",
      safe_metadata: { system_type: "engine", model: "M96", serial_number: "ENG-123456" },
    }),
    assoc({
      association_id: "work_event:service_record:svc-1",
      object_id: "svc-1",
      object_type: "work_event",
      source_table: "service_records",
      relationship_type: "work_performed",
      event_roles: ["moment", "maintenance"],
      participant_roles: ["keepr_pro"],
      affected_system_id: "sys-engine",
      proof_state: "verified",
      processing_status: "not_required",
      safe_metadata: { title: "Oil change", cost: 200, storage_path: "private/path" },
      created_at: "2026-02-01T00:00:00Z",
      provenance: [
        { table: "service_records", row_id: "svc-1" },
        { table: "story_events", row_id: "story-1", note: "paired Moment" },
      ],
    }),
    assoc({
      association_id: "timeline_record:usage-1",
      object_id: "tl-1",
      object_type: "timeline_record",
      source_table: "timeline_records",
      relationship_type: "timeline_fact",
      event_role: "usage",
      proof_state: "claimed",
      safe_metadata: { title: "Mileage update", odometer: 40000 },
      created_at: "2026-03-01T00:00:00Z",
    }),
    assoc({
      association_id: "attachment:att-1",
      object_id: "att-1",
      object_type: "attachment",
      source_table: "attachments",
      relationship_type: "evidence_document",
      evidence_role: "invoice",
      proof_state: "evidence_attached",
      processing_status: "processed",
      safe_metadata: { title: "Invoice", doc_type: "invoice", extracted_text: "do not leak", signed_url: "https://signed.example" },
      created_at: "2026-02-02T00:00:00Z",
    }),
    assoc({
      association_id: "attachment_placement:pl-1",
      object_id: "pl-1",
      object_type: "attachment_placement",
      source_table: "attachment_placements",
      relationship_type: "places_attachment",
      evidence_role: "receipt",
      proof_state: "evidence_attached",
      safe_metadata: { role: "receipt", target_type: "service_record", target_id: "svc-1" },
    }),
    assoc({
      association_id: "attachment_placement:pl-2",
      object_id: "pl-2",
      object_type: "attachment_placement",
      source_table: "attachment_placements",
      relationship_type: "places_attachment",
      evidence_role: "evidence",
      proof_state: "evidence_attached",
      safe_metadata: { role: "evidence", target_type: "system", target_id: "sys-engine" },
    }),
  ];
  return {
    manifest_version: "1.0",
    generated_at: "2026-07-13T00:00:00Z",
    status: "complete",
    purpose: "asset_overview",
    kac: "KPR-6GV2-MJ6W",
    asset: {
      id: "asset-porsche",
      kac_id: "KPR-6GV2-MJ6W",
      name: "2000 Porsche Boxster S",
      type: "vehicle",
      lifecycle_state: "active",
      availability: "available",
      status: "active",
      asset_mode: "personal",
    },
    authorization: { requester_user_id: "owner-1", access: "owner", access_role: "owner" },
    associations,
    collector_summaries: [
      { collector: "identity", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "systems", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "timeline", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "attachments", status: "complete", association_count: 3, diagnostics: [] },
    ],
    knowledge_gaps: [
      { id: "gap:maintenance_evidence:old", category: "evidence", question: "Older maintenance lacks evidence.", priority: "medium" },
    ],
    diagnostics: [],
    ...overrides,
  };
}

function build(manifest, purpose = "asset_stewardship") {
  return buildKacContextEnvelope({ manifest, purpose, generated_at: "2026-07-13T12:00:00Z" });
}

function serialized(value) {
  return JSON.stringify(value);
}

test("only callable Build 2A purposes are accepted", () => {
  assert.deepEqual([...CALLABLE_BUILD_2A_CONTEXT_PURPOSES], ["asset_stewardship", "maintenance_planning"]);
  assert.equal(isCallableBuild2AContextPurpose("asset_stewardship"), true);
  assert.equal(isCallableBuild2AContextPurpose("maintenance_planning"), true);
});

test("future purposes are defined but rejected for Build 2A", () => {
  for (const purpose of ["pre_purchase", "sale_readiness", "transfer_readiness", "insurance_readiness", "warranty_review", "annual_stewardship_review"]) {
    assert.equal(isCallableBuild2AContextPurpose(purpose), false);
  }
});

test("complete Manifest creates complete Envelope", () => {
  const envelope = build(porscheManifest());
  assert.equal(envelope.envelope_version, "1.0");
  assert.equal(envelope.context_status, "complete");
  assert.equal(envelope.source_manifest_status, "complete");
  assert.equal(envelope.identity_summary.canonical_asset_id, "asset-porsche");
});

test("partial Manifest creates partial Envelope and preserves hidden-domain diagnostics", () => {
  const manifest = porscheManifest({
    status: "partial",
    collector_summaries: [
      { collector: "identity", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "systems", status: "not_visible", association_count: 0, diagnostics: [] },
    ],
  });
  const envelope = build(manifest);
  assert.equal(envelope.context_status, "partial");
  assert.equal(envelope.evidence_confidence_summary.hidden_domain_count, 1);
  assert.equal(envelope.exclusions_and_redactions.some((e) => e.reason === "not_visible"), true);
});

test("restricted Manifest creates restricted minimal Envelope", () => {
  const envelope = build(porscheManifest({ status: "restricted", associations: [], knowledge_gaps: [] }));
  assert.equal(envelope.context_status, "restricted");
  assert.equal(envelope.relevant_systems.length, 0);
  assert.equal(envelope.diagnostics.some((d) => d.code === "restricted_source_manifest"), true);
});

test("owner and steward context is preserved", () => {
  assert.equal(build(porscheManifest()).caller_authorization_role, "owner");
  assert.equal(build(porscheManifest({ authorization: { access: "direct_steward", access_role: "steward" } })).caller_authorization_role, "direct_steward");
});

test("not_visible associations are excluded because they are not present as content", () => {
  const envelope = build(porscheManifest({
    status: "partial",
    collector_summaries: [{ collector: "attachments", status: "not_visible", association_count: 0, diagnostics: [] }],
  }));
  assert.equal(envelope.relevant_evidence.some((e) => e.id.includes("not_visible")), false);
  assert.equal(envelope.diagnostics.some((d) => d.code === "associations_excluded_due_to_visibility"), true);
});

test("provenance is retained", () => {
  const envelope = build(porscheManifest());
  const event = envelope.relevant_normalized_events.find((e) => e.id === "work_event:service_record:svc-1");
  assert.deepEqual(event.provenance.map((p) => p.table), ["service_records", "story_events"]);
});

test("service/Moment event remains deduplicated", () => {
  const envelope = build(porscheManifest());
  assert.equal(envelope.relevant_normalized_events.filter((e) => e.id === "work_event:service_record:svc-1").length, 1);
});

test("attachment with multiple placements remains one evidence object", () => {
  const envelope = build(porscheManifest());
  assert.equal(envelope.relevant_evidence.filter((e) => e.id === "attachment:att-1").length, 1);
  assert.equal(envelope.relevant_evidence.filter((e) => e.id.startsWith("attachment_placement:")).length, 2);
});

test("evidence confidence counts are deterministic", () => {
  const envelope = build(porscheManifest());
  assert.ok(envelope.evidence_confidence_summary.verified_fact_count >= 2);
  assert.ok(envelope.evidence_confidence_summary.supported_fact_count >= 3);
  assert.ok(envelope.evidence_confidence_summary.reported_only_fact_count >= 1);
});

test("readiness dimensions are produced", () => {
  const envelope = build(porscheManifest());
  const dimensions = envelope.readiness_dimensions.map((d) => d.dimension).sort();
  assert.deepEqual(JSON.parse(JSON.stringify(dimensions)), ["continuity", "evidence", "history", "identity", "maintenance", "systems"]);
});

test("recent changes are deterministic from Manifest dates", () => {
  const envelope = build(porscheManifest());
  assert.equal(envelope.recently_changed_facts[0].id, "timeline_record:usage-1");
});

test("no extracted text, signed URLs, or personal contact fields are emitted", () => {
  const envelope = build(porscheManifest());
  const text = serialized(envelope);
  assert.equal(text.includes("do not leak"), false);
  assert.equal(text.includes("signed.example"), false);
  assert.equal(text.includes("redact@example.invalid"), false);
  assert.equal(text.includes("private/path"), false);
});

test("Porsche asset_stewardship surfaces identity, systems, history, proof, and gaps", () => {
  const envelope = build(porscheManifest(), "asset_stewardship");
  assert.equal(envelope.kac, "KPR-6GV2-MJ6W");
  assert.ok(envelope.relevant_systems.length >= 2);
  assert.ok(envelope.relevant_normalized_events.length >= 2);
  assert.ok(envelope.relevant_evidence.length >= 3);
  assert.equal(envelope.deterministic_knowledge_gaps.length, 1);
});

test("Porsche maintenance_planning filters to maintenance-relevant context without recommendations", () => {
  const envelope = build(porscheManifest(), "maintenance_planning");
  assert.ok(envelope.relevant_systems.length >= 2);
  assert.ok(envelope.relevant_normalized_events.some((e) => e.id === "work_event:service_record:svc-1"));
  assert.equal(serialized(envelope).includes("recommendation"), false);
  assert.equal(envelope.permitted_next_capabilities.can_build_maintenance_plan, true);
});

test("Regal marine context preserves marine systems and HIN without vehicle assumptions", () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const manifest = porscheManifest({
    kac: "KPR-REGAL-3300",
    asset: { id: "asset-regal", kac_id: "KPR-REGAL-3300", type: "marine", lifecycle_state: "active", availability: "available" },
    associations: [
      assoc({ association_id: "asset:asset-regal:identity", object_id: "asset-regal", object_type: "asset", source_table: "assets", relationship_type: "canonical_manifest_asset", safe_metadata: { type: "marine" } }),
      assoc({ association_id: "asset_identifier:hin", object_id: "id-hin", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "hin", value: "RGMBUILD2A" } }),
      assoc({ association_id: "systems:propulsion", object_id: "sys-propulsion", object_type: "system", source_table: "systems", relationship_type: "installed_system", proof_state: "evidence_attached", safe_metadata: { name: "Propulsion", system_type: "propulsion" } }),
      ...fixture.systems.slice(0, 2).map((system, index) => assoc({
        association_id: `boat_systems:${index}`,
        object_id: `boat-${index}`,
        object_type: "boat_system",
        source_table: "boat_systems",
        relationship_type: "system_extension",
        affected_system_id: "sys-propulsion",
        proof_state: "reported",
        safe_metadata: { name: system.name, system_type: system.type, manufacturer: system.manufacturer, model: system.model },
      })),
      assoc({ association_id: "work_event:service_record:regal", object_id: "svc-regal", object_type: "work_event", source_table: "service_records", relationship_type: "work_performed", event_roles: ["maintenance"], proof_state: "claimed", safe_metadata: { title: "Marine service history capture" } }),
    ],
    knowledge_gaps: [],
  });
  const envelope = build(manifest, "maintenance_planning");
  assert.equal(envelope.asset_type, "marine");
  assert.equal(envelope.identity_summary.identity_facts.some((f) => f.metadata.kind === "hin"), true);
  assert.equal(envelope.relevant_systems.some((s) => s.source_table === "boat_systems"), true);
  assert.equal(serialized(envelope).includes("vehicle_systems"), false);
});

test("no home, vehicle, or marine fields are interchanged", () => {
  const envelope = build(porscheManifest(), "asset_stewardship");
  assert.equal(envelope.relevant_systems.some((s) => s.source_table === "boat_systems" || s.source_table === "home_systems"), false);
});

test("transformation layer does not query a database", () => {
  const manifest = porscheManifest();
  const poison = { from() { throw new Error("database call attempted"); }, rpc() { throw new Error("rpc call attempted"); } };
  const envelope = buildKacContextEnvelope({ manifest, purpose: "asset_stewardship", generated_at: "2026-07-13T12:00:00Z", poison });
  assert.equal(envelope.canonical_asset_id, "asset-porsche");
});

test("Envelope returns capability flags but no generated actions", () => {
  const envelope = build(porscheManifest(), "maintenance_planning");
  assert.equal(typeof envelope.permitted_next_capabilities.can_ask_kai, "boolean");
  assert.equal("actions" in envelope, false);
  assert.equal(serialized(envelope).includes("schedule service now"), false);
});
