import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const SHARED_ROOT = new URL("../supabase/functions/_shared/", import.meta.url);

const cache = new Map();

function loadSharedModule(name) {
  const normalized = name.replace("../_shared/", "").replace("./", "");
  const path = new URL(normalized, SHARED_ROOT);
  const key = path.pathname;
  if (cache.has(key)) return cache.get(key).exports;

  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const module = { exports: {} };
  cache.set(key, module);
  const context = {
    module,
    exports: module.exports,
    require: (specifier) => loadSharedModule(specifier),
    console,
  };
  vm.createContext(context);
  new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
  return module.exports;
}

const {
  buildKacIntelligenceOrchestration,
  isBuild3ACallablePurpose,
} = loadSharedModule("kacIntelligenceOrchestration.ts");
const { collectAssetIdentityAssociations } = loadSharedModule("kacManifestIdentity.ts");
const { collectSystemAssociations } = loadSharedModule("kacManifestSystems.ts");

class Query {
  constructor(table, db) {
    this.table = table;
    this.db = db;
    this.filters = [];
  }
  select() { return this; }
  eq(key, value) {
    this.filters.push((row) => row?.[key] === value);
    return this;
  }
  is(key, value) {
    this.filters.push((row) => (value === null ? row?.[key] == null : row?.[key] === value));
    return this;
  }
  rows() {
    let rows = [...(this.db[this.table] || [])];
    for (const filter of this.filters) rows = rows.filter(filter);
    return rows;
  }
  then(resolve, reject) {
    if (this.db.__fail?.has(this.table)) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

function makeClient(db = {}) {
  return { from: (table) => new Query(table, db) };
}

function assoc(overrides = {}) {
  return {
    association_id: overrides.association_id || "asset:asset-1:identity",
    object_id: overrides.object_id || "asset-1",
    object_type: overrides.object_type || "asset",
    source_table: overrides.source_table || "assets",
    relationship_type: overrides.relationship_type || "canonical_manifest_asset",
    scope: overrides.scope || "kac_specific",
    proof_state: overrides.proof_state || "claimed",
    processing_status: overrides.processing_status || "not_required",
    transfer_classification: overrides.transfer_classification || "asset_persistent",
    safe_metadata: overrides.safe_metadata || { name: "Asset", type: "vehicle" },
    provenance: overrides.provenance || [{ table: overrides.source_table || "assets", row_id: overrides.object_id || "asset-1" }],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  const associations = overrides.associations || [
    assoc({ safe_metadata: { name: "2000 Porsche Boxster S", type: "vehicle" } }),
    assoc({ association_id: "asset_identifier:vin", object_id: "id-vin", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "vin", value: "WP0TESTVIN" } }),
    assoc({ association_id: "system:engine", object_id: "sys-engine", object_type: "system", source_table: "systems", relationship_type: "installed_system_instance", proof_state: "evidence_attached", safe_metadata: { name: "Engine", system_type: "engine", model: "M96" } }),
    assoc({ association_id: "work_event:service_record:svc", object_id: "svc", object_type: "work_event", source_table: "service_records", relationship_type: "service_record", event_roles: ["maintenance"], proof_state: "evidence_attached", safe_metadata: { title: "Annual service" } }),
  ];
  return {
    manifest_version: "1.0",
    generated_at: "2026-07-15T10:00:00Z",
    status: overrides.status || "complete",
    purpose: "asset_overview",
    kac: overrides.kac || "KPR-TEST-1",
    asset: {
      id: overrides.asset?.id || "asset-1",
      kac_id: overrides.kac || "KPR-TEST-1",
      name: overrides.asset?.name || "Asset",
      type: overrides.asset?.type || "vehicle",
      lifecycle_state: overrides.asset?.lifecycle_state || "active",
      availability: overrides.asset?.availability || "available",
    },
    authorization: { requester_user_id: "user-1", access: overrides.access || "owner", access_role: "owner" },
    associations,
    association_groups: { identity: associations.filter((a) => ["assets", "asset_identifiers", "master_assets"].includes(a.source_table)), systems: associations.filter((a) => a.source_table === "systems"), timeline: associations.filter((a) => a.source_table === "service_records"), attachments: [] },
    collector_summaries: overrides.collector_summaries || [
      { collector: "identity", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "systems", status: "complete", association_count: 1, diagnostics: [] },
      { collector: "timeline", status: "complete", association_count: 1, diagnostics: [] },
      { collector: "attachments", status: "complete_empty", association_count: 0, diagnostics: [] },
    ],
    knowledge_gaps: overrides.knowledge_gaps || [],
    diagnostics: overrides.diagnostics || [],
  };
}

function request(input = {}) {
  return {
    request_version: "3A.0",
    kac: input.manifest?.kac || "KPR-TEST-1",
    purpose: input.purpose || "asset_stewardship",
    caller: { authenticated: true, user_id: "user-1", authorization_role: input.manifest?.authorization?.access || "owner" },
    authorized_manifest: input.manifest || manifest(),
    model_invocation: input.model_invocation,
    generated_at: "2026-07-15T10:00:00Z",
    telemetry_id: "test-telemetry",
  };
}

async function run(input = {}) {
  return buildKacIntelligenceOrchestration({ request: request(input) });
}

function text(value) {
  return JSON.stringify(value);
}

function validProviderSummary(summary = "The asset context is grounded in Keepr records.") {
  return {
    generateStructured: async (modelInput) => {
      const brief = modelInput.input.brief;
      const fact = brief.known_facts[0];
      const source = brief.provenance_references[0] || { note: "source" };
      return {
        ok: true,
        model: "test-model",
        output: {
          summary,
          prioritized_observations: [
            {
              observation_id: `obs:${fact.id}`,
              title: fact.label,
              explanation: "This fact is present in the brief.",
              category: fact.category === "recent_change" ? "history" : fact.category,
              priority: "informational",
              confidence: fact.confidence_state,
              source_fact_ids: [fact.id],
              source_gap_ids: [],
              source_readiness_dimensions: [],
              visibility_classification: fact.visibility,
            },
          ],
        current_risks_or_concerns: [],
        evidence_limitations: [],
        proposed_plan: {
          plan_status: "no_action_required",
          plan_title: "No immediate work",
          plan_purpose: brief.purpose,
          rationale: "The supplied brief does not justify work.",
          supporting_evidence: [source],
          evidence_limitations: [],
          reassessment_conditions: ["new documented finding"],
          ordered_steps: [],
          unresolved_dependencies: [],
          plan_limitations: ["No reminder is created."],
          permitted_capabilities_used: [],
          provenance_references: [source],
        },
        source_references: [source],
        capability_references: [],
        diagnostics: [],
      },
      };
    },
  };
}

test("Build 3A callable purposes are frozen to asset stewardship and maintenance planning", () => {
  assert.equal(isBuild3ACallablePurpose("asset_stewardship"), true);
  assert.equal(isBuild3ACallablePurpose("maintenance_planning"), true);
  assert.equal(isBuild3ACallablePurpose("pre_purchase"), false);
  assert.equal(isBuild3ACallablePurpose("asset_overview"), false);
});

test("complete asset returns deterministic orchestration with envelope, brief, authority, and fallback interpretation", async () => {
  const result = await run();
  assert.equal(result.response_version, "3A.1");
  assert.equal(result.operational_status, "deterministic");
  assert.equal(result.context_envelope.envelope_version, "1.0");
  assert.equal(result.asset_brief.brief_version, "1.0");
  assert.equal(result.interpretation.interpretation_source, "deterministic_fallback");
  assert.equal(result.authority_reconciliation.reconciliation_version, "1.0");
  assert.equal(result.highest_value_next_question.question.length > 0, true);
  assert.equal(result.permitted_capabilities.every((cap) => typeof cap.enabled === "boolean"), true);
});

test("partial asset remains partial and does not claim complete", async () => {
  const partial = manifest({
    status: "partial",
    collector_summaries: [
      { collector: "identity", status: "complete", association_count: 1, diagnostics: [] },
      { collector: "systems", status: "not_visible", association_count: 0, diagnostics: [] },
    ],
  });
  const result = await run({ manifest: partial });
  assert.equal(result.manifest.status, "partial");
  assert.notEqual(result.asset_brief.brief_status, "complete");
});

test("restricted KAC short-circuits to restricted status without reconstructing hidden content", async () => {
  const restricted = manifest({ status: "restricted", associations: [], diagnostics: [{ code: "restricted_source_manifest", severity: "warning", message: "Restricted." }] });
  const result = await run({ manifest: restricted });
  assert.equal(result.operational_status, "restricted");
  assert.equal(result.asset_brief.brief_status, "restricted");
  assert.equal(text(result).includes("hidden private system"), false);
});

test("Formula configured metadata survives as configured or provisional, not verified installed components", async () => {
  const db = {
    assets: [{
      id: "asset-formula",
      kac_id: "KPR-6QEH-927H",
      type: "marine",
      name: "KeeprAfloat!",
      year: 2026,
      make: "Formula",
      model: "380 Super Sport Crossover",
      asset_subtype: "powerboat",
      length_feet: 38,
      engine_type: "stern_drive",
      extra_metadata: {
        model: "Formula 380 Super Sport Crossover",
        model_year: 2026,
        oem: "Formula",
        configuration: {
          engine_package: "MerCruiser Twin 8.2L MAG HO ECT 430",
          drives: "Bravo Three X",
          joystick_piloting: true,
          stabilization: ["Seakeeper 4 Gyro", "Seakeeper Ride 750"],
        },
      },
    }],
    asset_identifiers: [],
    systems: [{
      id: "sys-electronics",
      asset_id: "asset-formula",
      name: "Electronics",
      system_type: "electronics",
      metadata: { options: ["Raymarine electronics", "FLIR", "Starlink", "Mercury 1st Mate", "security safe"], origin: "Formula configuration" },
    }],
    vehicle_systems: [],
    boat_systems: [],
    home_systems: [],
  };
  const context = {
    kac: "KPR-6QEH-927H",
    access: "owner",
    association_visibility: "caller_rls",
    asset: {
      id: "asset-formula",
      kac_id: "KPR-6QEH-927H",
      owner_id: "owner",
      master_asset_id: null,
      type: "marine",
      status: "active",
      lifecycle_state: "active",
      manifest_availability: "available",
    },
  };
  const identity = await collectAssetIdentityAssociations(makeClient(db), context);
  const systems = await collectSystemAssociations(makeClient(db), context);
  const formulaManifest = manifest({
    kac: "KPR-6QEH-927H",
    asset: { id: "asset-formula", type: "marine", name: "KeeprAfloat!" },
    associations: [...identity.associations, ...systems.associations],
    knowledge_gaps: [{ id: "gap:formula:hin", category: "identity", question: "Can you confirm the HIN and propulsion serials?", priority: "high" }],
  });
  const result = await run({ manifest: formulaManifest, purpose: "asset_stewardship" });
  const serialized = text(result);
  for (const expected of ["Formula 380 Super Sport Crossover", "MerCruiser Twin 8.2L MAG HO ECT 430", "Bravo Three X", "Seakeeper 4 Gyro", "Seakeeper Ride 750", "Raymarine electronics", "FLIR", "Starlink", "Mercury 1st Mate", "security safe"]) {
    assert.equal(serialized.includes(expected), true, expected);
  }
  assert.equal(serialized.includes("configured_option_not_verified_installed_component"), true);
  assert.equal(serialized.includes("verified installed component instance"), false);
});

test("Porsche documented asset still produces grounded documented context", async () => {
  const result = await run({ manifest: manifest({ kac: "KPR-6GV2-MJ6W" }), purpose: "maintenance_planning" });
  assert.equal(result.kac, "KPR-6GV2-MJ6W");
  assert.equal(result.asset_brief.known_facts.some((fact) => fact.value.includes("Porsche") || fact.label.includes("Porsche")), true);
  assert.equal(text(result).includes("every 10,000 miles"), false);
});

test("invalid model output fails closed to deterministic fallback", async () => {
  const result = await run({
    model_invocation: {
      enabled: true,
      provider: { generateStructured: async () => ({ ok: true, raw_text: "not json", output: "not json" }) },
      max_attempts: 1,
    },
  });
  assert.equal(result.operational_status, "fallback");
  assert.equal(result.interpretation.orchestration_status, "fallback_parse_failure");
  assert.equal(result.interpretation.interpretation_source, "deterministic_fallback");
});

test("provider timeout fails closed to fallback", async () => {
  const result = await run({
    model_invocation: {
      enabled: true,
      provider: { generateStructured: async () => ({ ok: false, failure_state: "timeout", model: "timeout-test" }) },
      max_attempts: 2,
    },
  });
  assert.equal(result.operational_status, "fallback");
  assert.equal(result.interpretation.orchestration_status, "fallback_timeout");
  assert.equal(result.interpretation.retry_metadata.max_attempts, 2);
});

test("valid bounded interpretation is accepted when provider output passes validation", async () => {
  const result = await run({ model_invocation: { enabled: true, provider: validProviderSummary(), max_attempts: 1 } });
  assert.equal(result.operational_status, "interpreted");
  assert.equal(result.interpretation.orchestration_status, "accepted");
});

test("sensitive fields are excluded from Build 3A output", async () => {
  const sensitive = manifest({
    associations: [
      assoc({
        association_id: "asset:sensitive",
        safe_metadata: {
          name: "Safe",
          extracted_text: "secret text",
          signed_url: "https://signed.example/private",
          storage_path: "private/path",
          phone: "555-111-2222",
          email: "person@example.com",
        },
      }),
    ],
  });
  const result = await run({ manifest: sensitive });
  const serialized = text(result);
  assert.equal(serialized.includes("secret text"), false);
  assert.equal(serialized.includes("signed.example"), false);
  assert.equal(serialized.includes("private/path"), false);
  assert.equal(serialized.includes("person@example.com"), false);
});

test("insufficient evidence does not create generic maintenance recommendations", async () => {
  const sparse = manifest({
    asset: { type: "marine" },
    associations: [
      assoc({ safe_metadata: { name: "Sparse marine asset", type: "marine" } }),
    ],
    knowledge_gaps: [{ id: "gap:usage", category: "usage", question: "Can you confirm current hours?", priority: "high" }],
  });
  const result = await run({ manifest: sparse, purpose: "maintenance_planning" });
  const serialized = text(result).toLowerCase();
  assert.equal(serialized.includes("generic marine service"), false);
  assert.equal(serialized.includes("every 100 hours"), false);
  assert.equal(result.asset_brief.highest_value_next_question.question.toLowerCase().includes("hours") || serialized.includes("confirm current hours"), true);
});
