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

const { buildKacContextEnvelope } = loadSharedModule("kacContextEnvelope.ts");
const {
  buildKaiAssetBrief,
  CALLABLE_BUILD_2B_BRIEF_PURPOSES,
  isCallableBuild2BBriefPurpose,
} = loadSharedModule("kaiAssetBrief.ts");

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
    },
    authorization: { requester_user_id: "owner-1", access: "owner", access_role: "owner" },
    associations: [
      assoc({
        association_id: "asset:asset-porsche:identity",
        object_id: "asset-porsche",
        object_type: "asset",
        source_table: "assets",
        relationship_type: "canonical_manifest_asset",
        safe_metadata: { name: "2000 Porsche Boxster S", type: "vehicle", lifecycle_state: "active", email: "redact@example.invalid" },
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
        association_id: "asset_identifier:serial",
        object_id: "id-serial",
        object_type: "asset_identifier",
        source_table: "asset_identifiers",
        relationship_type: "identifies_asset",
        proof_state: "reported",
        safe_metadata: { kind: "serial", value: "SERIAL-SECRET-123456" },
      }),
      assoc({
        association_id: "systems:engine",
        object_id: "sys-engine",
        object_type: "system",
        source_table: "systems",
        relationship_type: "installed_system",
        proof_state: "evidence_attached",
        safe_metadata: { name: "Engine", system_type: "engine", status: "active", serial_number: "ENGINE-PRIVATE-123456" },
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
        safe_metadata: { system_type: "engine", model: "M96" },
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
        safe_metadata: { title: "Annual service", storage_path: "private/path" },
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
        safe_metadata: { title: "Service invoice", doc_type: "invoice", extracted_text: "do not leak", signed_url: "https://signed.example" },
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
    ],
    collector_summaries: [
      { collector: "identity", status: "complete", association_count: 3, diagnostics: [] },
      { collector: "systems", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "timeline", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "attachments", status: "complete", association_count: 3, diagnostics: [] },
    ],
    knowledge_gaps: [
      { id: "gap:maintenance_evidence:latest", category: "evidence", question: "Do you have the invoice for the most recent annual service?", priority: "high", related_association_ids: ["work_event:service_record:svc-1"], blocks_purpose: ["asset_overview"] },
      { id: "gap:warranty:transfer", category: "transfer", question: "Was this warranty successfully transferred?", priority: "medium" },
    ],
    diagnostics: [],
    ...overrides,
  };
}

function envelope(manifest = porscheManifest(), purpose = "asset_stewardship") {
  return buildKacContextEnvelope({ manifest, purpose, generated_at: "2026-07-13T12:00:00Z" });
}

function brief(env = envelope()) {
  return buildKaiAssetBrief({ envelope: env, generated_at: "2026-07-13T13:00:00Z" });
}

function serialized(value) {
  return JSON.stringify(value);
}

test("only Build 2B purposes are accepted and future purposes are rejected", () => {
  assert.deepEqual([...CALLABLE_BUILD_2B_BRIEF_PURPOSES], ["asset_stewardship", "maintenance_planning"]);
  assert.equal(isCallableBuild2BBriefPurpose("asset_stewardship"), true);
  assert.equal(isCallableBuild2BBriefPurpose("maintenance_planning"), true);
  for (const purpose of ["pre_purchase", "sale_readiness", "transfer_readiness", "insurance_readiness", "warranty_review", "annual_stewardship_review"]) {
    assert.equal(isCallableBuild2BBriefPurpose(purpose), false);
  }
});

test("KaiAssetBrief contract includes required presentation fields", () => {
  const result = brief();
  for (const field of [
    "brief_version",
    "generated_at",
    "purpose",
    "kac",
    "canonical_asset_id",
    "asset_display_identity",
    "source_envelope_status",
    "brief_status",
    "headline",
    "subheadline",
    "current_state_summary",
    "known_facts",
    "missing_or_uncertain_facts",
    "recent_updates",
    "attention_items",
    "readiness_cards",
    "evidence_summary",
    "highest_value_next_question",
    "permitted_next_capabilities",
    "visibility_classification",
    "diagnostics",
    "exclusions_and_redactions",
  ]) {
    assert.ok(field in result, field);
  }
});

test("complete Envelope becomes attention when deterministic blocking gaps exist", () => {
  const result = brief();
  assert.equal(result.source_envelope_status, "complete");
  assert.equal(result.brief_status, "attention");
  assert.equal(result.headline, "Important proof is still missing");
});

test("complete Envelope can become complete when no blocking gaps exist", () => {
  const result = brief(envelope(porscheManifest({ knowledge_gaps: [] })));
  assert.equal(result.brief_status, "complete");
});

test("partial Envelope creates non-complete brief", () => {
  const result = brief(envelope(porscheManifest({
    status: "partial",
    collector_summaries: [{ collector: "systems", status: "not_visible", association_count: 0, diagnostics: [] }],
  })));
  assert.equal(result.brief_status, "partial");
});

test("restricted Envelope creates restricted minimal brief", () => {
  const result = brief(envelope(porscheManifest({ status: "restricted", associations: [], knowledge_gaps: [] })));
  assert.equal(result.brief_status, "restricted");
  assert.deepEqual(JSON.parse(JSON.stringify(result.known_facts)), []);
  assert.equal(result.highest_value_next_question.visibility, "restricted");
});

test("output is stable for the same input", () => {
  const env = envelope();
  assert.equal(serialized(brief(env)), serialized(brief(env)));
});

test("transformation makes no database or LLM calls", () => {
  const env = envelope();
  const poison = { from() { throw new Error("database call attempted"); }, chat() { throw new Error("llm call attempted"); } };
  const result = buildKaiAssetBrief({ envelope: env, generated_at: "2026-07-13T13:00:00Z", poison });
  assert.equal(result.canonical_asset_id, "asset-porsche");
});

test("headline and subheadline do not overstate completeness", () => {
  const result = brief();
  const text = `${result.headline} ${result.subheadline}`.toLowerCase();
  for (const forbidden of ["fully documented", "perfect", "safe", "guaranteed", "all maintenance complete"]) {
    assert.equal(text.includes(forbidden), false);
  }
});

test("known facts preserve confidence, provenance, priority, and scope", () => {
  const result = brief();
  assert.equal(result.known_facts[0].category, "identity");
  assert.equal(result.known_facts.some((fact) => fact.confidence_state === "verified"), true);
  assert.equal(result.known_facts.some((fact) => fact.provenance.length > 0), true);
  assert.equal(result.known_facts.every((fact) => ["kac_specific", "horizontal"].includes(fact.scope)), true);
});

test("missing facts are grouped and resolvable only by carried capability flags", () => {
  const result = brief();
  assert.equal(result.missing_or_uncertain_facts.some((gap) => gap.category === "evidence"), true);
  assert.equal(result.missing_or_uncertain_facts.some((gap) => gap.category === "continuity"), true);
  assert.equal(result.missing_or_uncertain_facts.every((gap) => typeof gap.user_can_resolve === "boolean"), true);
});

test("recent updates are deterministic and provenance-backed", () => {
  const result = brief();
  assert.equal(result.recent_updates[0].id, "timeline_record:usage-1");
  assert.equal(Boolean(result.recent_updates[0].timestamp), true);
  assert.ok(result.recent_updates.every((update) => Array.isArray(update.provenance)));
});

test("attention items are derived from source context only", () => {
  const result = brief();
  assert.equal(result.attention_items.some((item) => item.id.includes("gap:")), true);
  assert.equal(serialized(result).includes("repair cost"), false);
  assert.equal(serialized(result).includes("schedule service now"), false);
});

test("readiness cards cover the six approved dimensions without scores", () => {
  const result = brief();
  assert.deepEqual(JSON.parse(JSON.stringify(result.readiness_cards.map((card) => card.dimension).sort())), ["continuity", "evidence", "history", "identity", "maintenance", "systems"]);
  assert.equal(serialized(result.readiness_cards).includes("percentage"), false);
  assert.equal(serialized(result.readiness_cards).includes("score"), false);
});

test("exactly one highest-value next question is generated", () => {
  const result = brief();
  assert.equal(typeof result.highest_value_next_question.question, "string");
  assert.equal(Array.isArray(result.highest_value_next_question), false);
  assert.equal(result.highest_value_next_question.related_gap_id, "gap:maintenance_evidence:latest");
});

test("next question priority selects identity conflict first", () => {
  const env = envelope(porscheManifest({
    knowledge_gaps: [
      { id: "gap:identity:conflict", category: "conflict", question: "Can you confirm the asset identity conflict?", priority: "high" },
      { id: "gap:evidence:service", category: "evidence", question: "Do you have the service invoice?", priority: "high" },
    ],
  }));
  const result = brief(env);
  assert.equal(result.highest_value_next_question.priority_reason, "critical_identity_conflict");
});

test("next question does not ask for already-known data when no gaps exist", () => {
  const result = brief(envelope(porscheManifest({ knowledge_gaps: [] })));
  assert.equal(result.highest_value_next_question.priority_reason, "no_open_question");
  assert.equal(result.highest_value_next_question.question.includes("VIN"), false);
});

test("capability flags are never broadened", () => {
  const env = envelope();
  env.permitted_next_capabilities.can_add_evidence = false;
  const result = brief(env);
  assert.equal(result.permitted_next_capabilities.find((cap) => cap.key === "can_add_evidence").enabled, false);
});

test("visibility classification is owner-private or restricted by default", () => {
  const result = brief();
  assert.equal(result.visibility_classification.every((section) => ["owner_private", "restricted", "shareable", "public_candidate"].includes(section.classification)), true);
  assert.equal(result.known_facts.filter((fact) => fact.category === "identity").every((fact) => fact.visibility === "owner_private"), true);
});

test("prohibited fields are excluded", () => {
  const text = serialized(brief());
  for (const forbidden of ["do not leak", "signed.example", "private/path", "redact@example.invalid", "storage_path", "extracted_text"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("Porsche asset stewardship acceptance case", () => {
  const result = brief(envelope(porscheManifest(), "asset_stewardship"));
  assert.equal(result.kac, "KPR-6GV2-MJ6W");
  assert.ok(result.known_facts.some((fact) => fact.category === "identity"));
  assert.ok(result.known_facts.some((fact) => fact.category === "maintenance"));
  assert.ok(result.readiness_cards.length, 6);
  assert.equal(result.permitted_next_capabilities.some((cap) => cap.enabled), true);
});

test("Porsche maintenance planning emphasizes systems and maintenance without service intervals", () => {
  const result = brief(envelope(porscheManifest(), "maintenance_planning"));
  assert.equal(result.purpose, "maintenance_planning");
  assert.ok(result.known_facts.some((fact) => fact.category === "systems"));
  assert.ok(result.known_facts.some((fact) => fact.category === "maintenance"));
  assert.equal(serialized(result).includes("every 10,000 miles"), false);
});

test("service record plus paired Moment remains one known event with both provenance records", () => {
  const result = brief();
  const serviceFacts = result.known_facts.filter((fact) => fact.id === "work_event:service_record:svc-1");
  assert.equal(serviceFacts.length, 1);
  assert.deepEqual(serviceFacts[0].provenance.map((p) => p.table), ["service_records", "story_events"]);
});

test("one source attachment can retain multiple placement relationships without duplicate source document", () => {
  const result = brief();
  assert.equal(result.known_facts.filter((fact) => fact.id === "attachment:att-1").length, 1);
  assert.equal(result.known_facts.filter((fact) => fact.id.startsWith("attachment_placement:")).length, 2);
});

test("Regal marine context preserves HIN, marine systems, and no vehicle-only assumptions", () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const manifest = porscheManifest({
    kac: "KPR-REGAL-3300",
    asset: { id: "asset-regal", kac_id: "KPR-REGAL-3300", type: "marine", lifecycle_state: "active", availability: "available" },
    associations: [
      assoc({ association_id: "asset:asset-regal:identity", object_id: "asset-regal", object_type: "asset", source_table: "assets", relationship_type: "canonical_manifest_asset", safe_metadata: { name: "Regal 3300", type: "marine" } }),
      assoc({ association_id: "asset_identifier:hin", object_id: "id-hin", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "hin", value: "RGMBUILD2B" } }),
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
    ],
    knowledge_gaps: [
      { id: "gap:systems:port-engine", category: "systems", question: "Can you confirm the serial number for the port engine?", priority: "high" },
    ],
  });
  const result = brief(envelope(manifest, "maintenance_planning"));
  assert.equal(result.asset_type, "marine");
  assert.equal(result.asset_display_identity.primary_identifier_kind, "hin");
  assert.ok(result.known_facts.some((fact) => fact.id.startsWith("boat_systems:")));
  assert.equal(serialized(result).includes("vehicle_systems"), false);
  assert.equal(result.highest_value_next_question.question, "Can you confirm the serial number for the port engine?");
});

test("HIN is owner-private and serial values are masked", () => {
  const result = brief();
  const serialFact = result.known_facts.find((fact) => fact.id === "asset_identifier:serial");
  assert.equal(serialFact.value, "masked-3456");
  assert.equal(serialFact.visibility, "owner_private");
});

test("no recommendations, costs, actions, or report generation are emitted", () => {
  const text = serialized(brief()).toLowerCase();
  for (const forbidden of ["recommendation", "estimated cost", "actions api", "execute", "report generation"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});
