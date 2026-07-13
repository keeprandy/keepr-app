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
const { buildKaiAssetBrief } = loadSharedModule("kaiAssetBrief.ts");
const {
  buildKaiInterpretation,
  buildKaiModelInput,
  validateKaiInterpretation,
  CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES,
  isCallableBuild2CInterpretationPurpose,
  KAI_INTERPRETATION_SYSTEM_PROMPT,
} = loadSharedModule("kaiInterpretation.ts");

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
    asset: { id: "asset-porsche", kac_id: "KPR-6GV2-MJ6W", name: "2000 Porsche Boxster S", type: "vehicle", lifecycle_state: "active", availability: "available" },
    authorization: { requester_user_id: "owner-1", access: "owner", access_role: "owner" },
    associations: [
      assoc({ association_id: "asset:asset-porsche:identity", object_id: "asset-porsche", object_type: "asset", source_table: "assets", relationship_type: "canonical_manifest_asset", safe_metadata: { name: "2000 Porsche Boxster S", type: "vehicle", email: "redact@example.invalid" } }),
      assoc({ association_id: "asset_identifier:vin", object_id: "id-vin", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "vin", value: "WP0CB2980YU660000" } }),
      assoc({ association_id: "asset_identifier:serial", object_id: "id-serial", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "reported", safe_metadata: { kind: "serial", value: "SERIAL-SECRET-123456" } }),
      assoc({ association_id: "systems:engine", object_id: "sys-engine", object_type: "system", source_table: "systems", relationship_type: "installed_system", proof_state: "evidence_attached", safe_metadata: { name: "Engine", system_type: "engine" }, created_at: "2026-01-01T00:00:00Z" }),
      assoc({ association_id: "vehicle_systems:engine", object_id: "veh-engine", object_type: "vehicle_system", source_table: "vehicle_systems", relationship_type: "system_extension", proof_state: "evidence_attached", affected_system_id: "sys-engine", safe_metadata: { system_type: "engine", model: "M96" } }),
      assoc({ association_id: "work_event:service_record:svc-1", object_id: "svc-1", object_type: "work_event", source_table: "service_records", relationship_type: "work_performed", event_roles: ["moment", "maintenance"], proof_state: "verified", safe_metadata: { title: "Annual service", storage_path: "private/path" }, created_at: "2026-02-01T00:00:00Z", provenance: [{ table: "service_records", row_id: "svc-1" }, { table: "story_events", row_id: "story-1", note: "paired Moment" }] }),
      assoc({ association_id: "timeline_record:usage-1", object_id: "tl-1", object_type: "timeline_record", source_table: "timeline_records", relationship_type: "timeline_fact", event_role: "usage", proof_state: "claimed", safe_metadata: { title: "Mileage update" }, created_at: "2026-03-01T00:00:00Z" }),
      assoc({ association_id: "attachment:att-1", object_id: "att-1", object_type: "attachment", source_table: "attachments", relationship_type: "evidence_document", evidence_role: "invoice", proof_state: "evidence_attached", processing_status: "processed", safe_metadata: { title: "Service invoice", extracted_text: "do not leak", signed_url: "https://signed.example" }, created_at: "2026-02-02T00:00:00Z" }),
      assoc({ association_id: "attachment_placement:pl-1", object_id: "pl-1", object_type: "attachment_placement", source_table: "attachment_placements", relationship_type: "places_attachment", evidence_role: "receipt", proof_state: "evidence_attached", safe_metadata: { role: "receipt", target_type: "service_record", target_id: "svc-1" } }),
    ],
    collector_summaries: [
      { collector: "identity", status: "complete", association_count: 3, diagnostics: [] },
      { collector: "systems", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "timeline", status: "complete", association_count: 2, diagnostics: [] },
      { collector: "attachments", status: "complete", association_count: 2, diagnostics: [] },
    ],
    knowledge_gaps: [
      { id: "gap:maintenance_evidence:latest", category: "evidence", question: "Do you have the invoice for the most recent annual service?", priority: "high", related_association_ids: ["work_event:service_record:svc-1"], blocks_purpose: ["asset_overview"] },
      { id: "gap:warranty:transfer", category: "transfer", question: "Was this warranty successfully transferred?", priority: "medium" },
    ],
    diagnostics: [],
    ...overrides,
  };
}

function makeBrief(manifest = porscheManifest(), purpose = "asset_stewardship") {
  const env = buildKacContextEnvelope({ manifest, purpose, generated_at: "2026-07-13T12:00:00Z" });
  return buildKaiAssetBrief({ envelope: env, generated_at: "2026-07-13T13:00:00Z" });
}

function validOutput(brief, overrides = {}) {
  const fact = brief.known_facts[0];
  const gap = brief.missing_or_uncertain_facts[0] || {
    id: "gap:none",
    label: "No open gap",
    why_it_matters: "No gap is currently present.",
    category: "evidence",
    visibility: "owner_private",
  };
  const source = brief.provenance_references[0] || { note: "test source" };
  return {
    summary: `${brief.headline}. The interpretation is limited to the supplied brief.`,
    prioritized_observations: [
      {
        observation_id: `obs:${fact.id}`,
        title: fact.label,
        explanation: `${fact.label} is present in the brief.`,
        category: fact.category === "recent_change" ? "history" : fact.category,
        priority: "informational",
        confidence: fact.confidence_state,
        source_fact_ids: [fact.id],
        source_gap_ids: [],
        source_readiness_dimensions: [],
        visibility_classification: fact.visibility,
      },
      {
        observation_id: `obs:${gap.id}`,
        title: gap.label,
        explanation: gap.why_it_matters,
        category: gap.category,
        priority: "important",
        confidence: "missing",
        source_fact_ids: [],
        source_gap_ids: [gap.id],
        source_readiness_dimensions: [],
        visibility_classification: gap.visibility,
      },
    ],
    current_risks_or_concerns: [],
    evidence_limitations: [gap.label],
    follow_up_question: {
      question: brief.highest_value_next_question.question,
      source_gap_id: brief.highest_value_next_question.related_gap_id,
      why_this_question: "It resolves the top brief gap.",
      provenance_references: [{ note: `Brief gap ${brief.highest_value_next_question.related_gap_id}` }],
    },
    proposed_plan: {
      plan_title: "Proposed stewardship review plan",
      plan_purpose: brief.purpose,
      plan_status: "action_proposed",
      rationale: "A blocking missing evidence gap supports a proposed evidence step.",
      supporting_evidence: [source],
      evidence_limitations: [gap.label],
      reassessment_conditions: ["new documented finding", "new maintenance obligation"],
      ordered_steps: [
        {
          step_id: "step:add-evidence",
          title: "Add missing evidence",
          explanation: gap.label,
          step_type: "add_missing_evidence",
          priority: "important",
          status: "proposed",
          related_gap_id: gap.id,
          required_capability: "can_add_evidence",
          source_references: [source],
          evidence_requirement: `Missing evidence blocking an important decision: ${gap.label}`,
          owner_confirmation_required: true,
        },
      ],
      unresolved_dependencies: [gap.id],
      plan_limitations: ["Proposed only."],
      permitted_capabilities_used: ["can_add_evidence"],
      provenance_references: [source],
    },
    source_references: [source],
    capability_references: ["can_add_evidence"],
    diagnostics: [],
    ...overrides,
  };
}

function mockProvider(outputOrFactory) {
  const calls = [];
  return {
    calls,
    async generateStructured(request) {
      calls.push(request);
      const output = typeof outputOrFactory === "function" ? outputOrFactory(request) : outputOrFactory;
      return { ok: true, output, model: request.model, token_usage: { total_tokens: 12 } };
    },
  };
}

const run = (brief, provider) => buildKaiInterpretation({ brief, provider, generated_at: "2026-07-13T14:00:00Z", model: "mock-model" });
const text = (value) => JSON.stringify(value);

test("only Build 2C purposes are accepted and future purposes are rejected", () => {
  assert.deepEqual([...CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES], ["asset_stewardship", "maintenance_planning"]);
  assert.equal(isCallableBuild2CInterpretationPurpose("asset_stewardship"), true);
  assert.equal(isCallableBuild2CInterpretationPurpose("maintenance_planning"), true);
  for (const purpose of ["pre_purchase", "sale_readiness", "transfer_readiness", "insurance_readiness", "warranty_review", "annual_stewardship_review"]) {
    assert.equal(isCallableBuild2CInterpretationPurpose(purpose), false);
  }
});

test("model receives only approved brief fields", () => {
  const brief = makeBrief();
  const input = buildKaiModelInput(brief);
  assert.equal(input.system_prompt, KAI_INTERPRETATION_SYSTEM_PROMPT);
  assert.equal("known_facts" in input.brief, true);
  assert.equal("raw_manifest" in input.brief, false);
  assert.equal("identity_summary" in input.brief, false);
  assert.equal(text(input).includes("do not leak"), false);
  assert.equal(text(input).includes("signed.example"), false);
});

test("structured output contract is normalized with validation result", async () => {
  const brief = makeBrief();
  const result = await run(brief, mockProvider(validOutput(brief)));
  assert.equal(result.interpretation_version, "1.0");
  assert.equal(result.validation_result.valid, true);
  assert.equal(result.interpretation_status, "needs_clarification");
});

test("complete brief can produce complete interpretation when grounded and no gaps block it", async () => {
  const brief = makeBrief(porscheManifest({ knowledge_gaps: [] }));
  const output = validOutput(makeBrief(), { follow_up_question: undefined, proposed_plan: { ...validOutput(makeBrief()).proposed_plan, ordered_steps: [], permitted_capabilities_used: [] } });
  output.prioritized_observations = [{
    observation_id: `obs:${brief.known_facts[0].id}`,
    title: brief.known_facts[0].label,
    explanation: "Grounded fact.",
    category: "identity",
    priority: "informational",
    confidence: brief.known_facts[0].confidence_state,
    source_fact_ids: [brief.known_facts[0].id],
    source_gap_ids: [],
    source_readiness_dimensions: [],
    visibility_classification: brief.known_facts[0].visibility,
  }];
  const result = await run(brief, mockProvider(output));
  assert.equal(result.interpretation_status, "complete");
});

test("partial brief cannot produce complete interpretation", async () => {
  const brief = makeBrief(porscheManifest({ status: "partial", collector_summaries: [{ collector: "systems", status: "not_visible", association_count: 0, diagnostics: [] }] }));
  const result = await run(brief, mockProvider(validOutput(brief)));
  assert.equal(result.interpretation_status, "partial");
});

test("restricted brief returns restricted fallback without model call", async () => {
  const brief = makeBrief(porscheManifest({ status: "restricted", associations: [], knowledge_gaps: [] }));
  const provider = mockProvider({});
  const result = await run(brief, provider);
  assert.equal(result.interpretation_status, "restricted");
  assert.equal(provider.calls.length, 0);
});

test("unavailable model, invalid JSON, and validation failure return fallback", async () => {
  const brief = makeBrief();
  const unavailable = await buildKaiInterpretation({ brief, generated_at: "2026-07-13T14:00:00Z" });
  assert.equal(unavailable.interpretation_status, "unavailable");

  const invalidJson = await buildKaiInterpretation({ brief, generated_at: "2026-07-13T14:00:00Z", provider: { async generateStructured() { return { ok: true, raw_text: "not json" }; } } });
  assert.equal(invalidJson.interpretation_status, "unavailable");

  const invalid = await run(brief, mockProvider({ ...validOutput(brief), summary: "This asset is safe and fully documented." }));
  assert.equal(invalid.interpretation_status, "invalid");
});

test("provenance, confidence, and visibility are validated and preserved", async () => {
  const brief = makeBrief();
  const result = await run(brief, mockProvider(validOutput(brief)));
  assert.equal(result.prioritized_observations[0].confidence, brief.known_facts[0].confidence_state);
  assert.equal(result.prioritized_observations[0].visibility_classification, brief.known_facts[0].visibility);
  assert.ok(result.source_references.length > 0);
});

test("exactly one question is allowed and no question is returned when unnecessary", async () => {
  const brief = makeBrief();
  const result = await run(brief, mockProvider(validOutput(brief)));
  assert.equal(typeof result.follow_up_question.question, "string");

  const completeBrief = makeBrief(porscheManifest({ knowledge_gaps: [] }));
  const output = validOutput(brief, { follow_up_question: undefined, proposed_plan: { ...validOutput(brief).proposed_plan, ordered_steps: [], permitted_capabilities_used: [] } });
  output.prioritized_observations = [{
    observation_id: `obs:${completeBrief.known_facts[0].id}`,
    title: completeBrief.known_facts[0].label,
    explanation: "Grounded fact.",
    category: "identity",
    priority: "informational",
    confidence: completeBrief.known_facts[0].confidence_state,
    source_fact_ids: [completeBrief.known_facts[0].id],
    source_gap_ids: [],
    source_readiness_dimensions: [],
    visibility_classification: completeBrief.known_facts[0].visibility,
  }];
  const noQuestion = await run(completeBrief, mockProvider(output));
  assert.equal(noQuestion.follow_up_question, undefined);
});

test("capability subset enforcement prevents denied capabilities and action execution", async () => {
  const brief = makeBrief();
  brief.permitted_next_capabilities.find((cap) => cap.key === "can_request_service").enabled = false;
  const output = validOutput(brief);
  output.proposed_plan.ordered_steps[0].step_type = "request_service";
  output.proposed_plan.ordered_steps[0].required_capability = "can_request_service";
  output.proposed_plan.permitted_capabilities_used = ["can_request_service"];
  const result = await run(brief, mockProvider(output));
  assert.equal(result.interpretation_status, "invalid");
  assert.ok(result.validation_result.error_codes.includes("denied_capability_used"));
});

test("Porsche stewardship and maintenance planning acceptance cases", async () => {
  const stewardshipBrief = makeBrief(porscheManifest(), "asset_stewardship");
  const stewardship = await run(stewardshipBrief, mockProvider(validOutput(stewardshipBrief)));
  assert.equal(stewardship.purpose, "asset_stewardship");
  assert.equal(stewardship.follow_up_question.source_gap_id, "gap:maintenance_evidence:latest");

  const maintenanceBrief = makeBrief(porscheManifest(), "maintenance_planning");
  const maintenance = await run(maintenanceBrief, mockProvider(validOutput(maintenanceBrief)));
  assert.equal(maintenance.purpose, "maintenance_planning");
  assert.equal(text(maintenance).includes("every 10,000 miles"), false);
});

test("Regal marine context remains marine-specific", async () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const manifest = porscheManifest({
    kac: "KPR-REGAL-3300",
    asset: { id: "asset-regal", kac_id: "KPR-REGAL-3300", type: "marine", lifecycle_state: "active", availability: "available" },
    associations: [
      assoc({ association_id: "asset:asset-regal:identity", object_id: "asset-regal", object_type: "asset", source_table: "assets", relationship_type: "canonical_manifest_asset", safe_metadata: { name: "Regal 3300", type: "marine" } }),
      assoc({ association_id: "asset_identifier:hin", object_id: "id-hin", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "hin", value: "RGMBUILD2C" } }),
      assoc({ association_id: "systems:propulsion", object_id: "sys-propulsion", object_type: "system", source_table: "systems", relationship_type: "installed_system", proof_state: "evidence_attached", safe_metadata: { name: "Propulsion", system_type: "propulsion" } }),
      ...fixture.systems.slice(0, 2).map((system, index) => assoc({ association_id: `boat_systems:${index}`, object_id: `boat-${index}`, object_type: "boat_system", source_table: "boat_systems", relationship_type: "system_extension", affected_system_id: "sys-propulsion", proof_state: "reported", safe_metadata: { name: system.name, system_type: system.type, manufacturer: system.manufacturer, model: system.model } })),
    ],
    knowledge_gaps: [{ id: "gap:systems:port-engine", category: "systems", question: "Can you confirm the serial number for the port engine?", priority: "high" }],
  });
  const brief = makeBrief(manifest, "maintenance_planning");
  const output = validOutput(brief);
  output.summary = "Marine propulsion context is present, with a port-engine identity gap.";
  const result = await run(brief, mockProvider(output));
  assert.equal(result.interpretation_status, "needs_clarification");
  assert.equal(text(result).includes("vehicle"), false);
  assert.equal(text(result).includes("RGMBUILD2C"), false);
});

test("adversarial hallucination and exposure cases fail validation", async () => {
  const brief = makeBrief();
  const cases = [
    { summary: "Service is due every 10,000 miles." },
    { summary: "The repair will cost $2,000." },
    { summary: "The warranty expires on 2027-01-01." },
    { summary: `The VIN is ${brief.asset_display_identity.primary_identifier_value}.` },
    { summary: "Add unsupported repair now." },
    { summary: "This asset is safe." },
    { summary: "This asset is fully documented." },
    { summary: "Contact owner at person@example.com." },
    { summary: "Raw SQL error: select * from profiles." },
  ];
  for (const bad of cases) {
    const result = await run(brief, mockProvider({ ...validOutput(brief), ...bad }));
    assert.equal(result.interpretation_status, "invalid", bad.summary);
  }
});

test("adversarial source IDs, multiple questions, and execution fail validation", async () => {
  const brief = makeBrief();
  const nonexistent = validateKaiInterpretation({
    ...validOutput(brief),
    prioritized_observations: [{ ...validOutput(brief).prioritized_observations[0], source_fact_ids: ["missing-source"] }],
  }, brief);
  assert.equal(nonexistent.valid, false);

  const multiple = validateKaiInterpretation({ ...validOutput(brief), follow_up_question: [{ question: "One" }, { question: "Two" }] }, brief);
  assert.equal(multiple.valid, false);

  const executed = validateKaiInterpretation({
    ...validOutput(brief),
    proposed_plan: {
      ...validOutput(brief).proposed_plan,
      ordered_steps: [{ ...validOutput(brief).proposed_plan.ordered_steps[0], status: "executed" }],
    },
  }, brief);
  assert.equal(executed.valid, false);
});

test("well-documented low-mileage Porsche may return no_action_required with empty plan", async () => {
  const brief = makeBrief(porscheManifest({
    knowledge_gaps: [],
    associations: [
      ...porscheManifest().associations,
      assoc({
        association_id: "timeline_record:low-mileage",
        object_id: "tl-low-mileage",
        object_type: "timeline_record",
        source_table: "timeline_records",
        relationship_type: "timeline_fact",
        event_role: "usage",
        proof_state: "verified",
        safe_metadata: { title: "Low mileage update", odometer: 1200, usage: "low" },
        created_at: "2026-04-01T00:00:00Z",
      }),
    ],
  }));
  const source = brief.provenance_references[0];
  const output = validOutput(brief, {
    follow_up_question: undefined,
    proposed_plan: {
      plan_title: "No immediate ownership work",
      plan_purpose: brief.purpose,
      plan_status: "no_action_required",
      rationale: "The brief shows documented identity and no blocking gaps, so no ownership work is justified from the supplied context.",
      supporting_evidence: [source],
      evidence_limitations: [],
      reassessment_conditions: ["new documented finding", "new maintenance obligation", "usage or mileage change documented in Keepr"],
      ordered_steps: [],
      unresolved_dependencies: [],
      plan_limitations: ["No reminder or arbitrary review date is created."],
      permitted_capabilities_used: [],
      provenance_references: [source],
    },
  });
  output.prioritized_observations = [{
    observation_id: `obs:${brief.known_facts[0].id}`,
    title: brief.known_facts[0].label,
    explanation: "The identity fact is present in the brief.",
    category: "identity",
    priority: "informational",
    confidence: brief.known_facts[0].confidence_state,
    source_fact_ids: [brief.known_facts[0].id],
    source_gap_ids: [],
    source_readiness_dimensions: [],
    visibility_classification: brief.known_facts[0].visibility,
  }];
  const result = await run(brief, mockProvider(output));
  assert.equal(result.proposed_plan.plan_status, "no_action_required");
  assert.equal(result.proposed_plan.ordered_steps.length, 0);
  assert.equal(result.validation_result.valid, true);
  assert.ok(result.proposed_plan.rationale.includes("no ownership work is justified"));
  assert.ok(result.proposed_plan.supporting_evidence.length > 0);
});

test("generic age, elapsed time, and available capabilities do not justify artificial actions", async () => {
  const brief = makeBrief(porscheManifest({ knowledge_gaps: [] }));
  const output = validOutput(brief, {
    summary: "The asset is old, so service should be scheduled.",
    proposed_plan: {
      ...validOutput(brief).proposed_plan,
      plan_status: "action_proposed",
      rationale: "A capability is available.",
      ordered_steps: [{
        ...validOutput(brief).proposed_plan.ordered_steps[0],
        step_id: "step:generic-maintenance",
        title: "Do generic maintenance",
        explanation: "The asset is old and time has passed.",
        related_gap_id: undefined,
        evidence_requirement: "Capability is available.",
      }],
    },
  });
  const result = await run(brief, mockProvider(output));
  assert.equal(result.interpretation_status, "invalid");
  assert.ok(result.validation_result.error_codes.includes("plan_step_missing_action_threshold"));
});

test("unknown mileage or usage produces clarification rather than assumed heavy use", async () => {
  const brief = makeBrief(porscheManifest({
    knowledge_gaps: [{ id: "gap:usage:unknown", category: "usage", question: "Can you confirm current mileage or usage?", priority: "high" }],
  }), "maintenance_planning");
  const result = await buildKaiInterpretation({ brief, generated_at: "2026-07-13T14:00:00Z" });
  assert.equal(result.interpretation_status, "unavailable");
  assert.equal(result.follow_up_question.question, "Can you confirm current mileage or usage?");
  assert.equal(text(result).includes("heavy use"), false);
});

test("low marine hours are respected and do not create unsupported service work", async () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const manifest = porscheManifest({
    kac: "KPR-REGAL-LOWHOURS",
    asset: { id: "asset-regal-lowhours", kac_id: "KPR-REGAL-LOWHOURS", type: "marine", lifecycle_state: "active", availability: "available" },
    associations: [
      assoc({ association_id: "asset:asset-regal-lowhours:identity", object_id: "asset-regal-lowhours", object_type: "asset", source_table: "assets", relationship_type: "canonical_manifest_asset", safe_metadata: { name: "Regal 3300", type: "marine" } }),
      assoc({ association_id: "asset_identifier:hin", object_id: "id-hin-lowhours", object_type: "asset_identifier", source_table: "asset_identifiers", relationship_type: "identifies_asset", proof_state: "verified", safe_metadata: { kind: "hin", value: "RGMLOWHOURS" } }),
      assoc({ association_id: "systems:propulsion", object_id: "sys-propulsion-lowhours", object_type: "system", source_table: "systems", relationship_type: "installed_system", proof_state: "evidence_attached", safe_metadata: { name: "Propulsion", system_type: "propulsion" } }),
      ...fixture.systems.slice(0, 1).map((system, index) => assoc({ association_id: `boat_systems:lowhours:${index}`, object_id: `boat-lowhours-${index}`, object_type: "boat_system", source_table: "boat_systems", relationship_type: "system_extension", affected_system_id: "sys-propulsion-lowhours", proof_state: "reported", safe_metadata: { name: system.name, system_type: system.type, manufacturer: system.manufacturer, model: system.model } })),
      assoc({ association_id: "timeline_record:low-hours", object_id: "tl-low-hours", object_type: "timeline_record", source_table: "timeline_records", relationship_type: "timeline_fact", event_role: "usage", proof_state: "verified", safe_metadata: { title: "Low engine hours", engine_hours: 12, usage: "low" }, created_at: "2026-04-01T00:00:00Z" }),
    ],
    knowledge_gaps: [],
  });
  const brief = makeBrief(manifest, "maintenance_planning");
  const source = brief.provenance_references[0];
  const output = validOutput(brief, {
    follow_up_question: undefined,
    summary: "Marine hours are low in the supplied brief, and no source-backed service trigger is present.",
    proposed_plan: {
      plan_title: "No immediate marine work",
      plan_purpose: brief.purpose,
      plan_status: "no_action_required",
      rationale: "Low documented hours and no open finding or requirement mean no action is justified from the supplied brief.",
      supporting_evidence: [source],
      evidence_limitations: [],
      reassessment_conditions: ["new documented finding", "documented hour-based requirement", "usage or hours change documented in Keepr"],
      ordered_steps: [],
      unresolved_dependencies: [],
      plan_limitations: ["No generic marine service task is created."],
      permitted_capabilities_used: [],
      provenance_references: [source],
    },
  });
  output.prioritized_observations = [{
    observation_id: `obs:${brief.known_facts[0].id}`,
    title: brief.known_facts[0].label,
    explanation: "Grounded marine identity fact.",
    category: "identity",
    priority: "informational",
    confidence: brief.known_facts[0].confidence_state,
    source_fact_ids: [brief.known_facts[0].id],
    source_gap_ids: [],
    source_readiness_dimensions: [],
    visibility_classification: brief.known_facts[0].visibility,
  }];
  const result = await run(brief, mockProvider(output));
  assert.equal(result.proposed_plan.plan_status, "no_action_required");
  assert.equal(result.proposed_plan.ordered_steps.length, 0);
  assert.equal(text(result.proposed_plan.ordered_steps).includes("generic marine service"), false);
});

test("monitor does not silently create a reminder or arbitrary review date", async () => {
  const brief = makeBrief(porscheManifest({ knowledge_gaps: [] }));
  const source = brief.provenance_references[0];
  const output = validOutput(brief, {
    follow_up_question: undefined,
    proposed_plan: {
      plan_title: "Monitor only",
      plan_purpose: brief.purpose,
      plan_status: "no_action_required",
      rationale: "Monitor until a documented finding, obligation, or usage change appears.",
      supporting_evidence: [source],
      evidence_limitations: [],
      reassessment_conditions: ["new documented finding", "usage or mileage change documented in Keepr"],
      ordered_steps: [],
      unresolved_dependencies: [],
      plan_limitations: ["No reminder is created."],
      permitted_capabilities_used: [],
      provenance_references: [source],
    },
  });
  output.prioritized_observations = [{
    observation_id: `obs:${brief.known_facts[0].id}`,
    title: brief.known_facts[0].label,
    explanation: "Grounded fact.",
    category: "identity",
    priority: "informational",
    confidence: brief.known_facts[0].confidence_state,
    source_fact_ids: [brief.known_facts[0].id],
    source_gap_ids: [],
    source_readiness_dimensions: [],
    visibility_classification: brief.known_facts[0].visibility,
  }];
  const result = await run(brief, mockProvider(output));
  assert.equal(result.proposed_plan.plan_status, "no_action_required");
  assert.equal(text(result).includes("created a reminder"), false);
  assert.equal(text(result.proposed_plan).includes("2026-"), false);
});

test("no database calls, no production model calls, no prohibited fields, and fallback is stable", async () => {
  const brief = makeBrief();
  const poison = { from() { throw new Error("db call"); }, rpc() { throw new Error("db call"); } };
  const resultA = await buildKaiInterpretation({ brief, generated_at: "2026-07-13T14:00:00Z", poison });
  const resultB = await buildKaiInterpretation({ brief, generated_at: "2026-07-13T14:00:00Z" });
  assert.equal(text(resultA), text(resultB));
  assert.equal(text(resultA).includes("do not leak"), false);
  assert.equal(text(resultA).includes("signed.example"), false);
  assert.equal(text(resultA).includes("redact@example.invalid"), false);
});
