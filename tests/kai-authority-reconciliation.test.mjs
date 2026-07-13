import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const MODULE_ROOT = new URL("../supabase/functions/_shared/", import.meta.url);
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
  buildKeeprReconciledDecisionContext,
  KEEPR_AUTHORITY_CLASSES,
  KEEPR_REQUIREMENT_STRENGTHS,
  KEEPR_APPLICABILITIES,
} = loadSharedModule("kaiAuthorityReconciliation.ts");

const source = { table: "test_sources", row_id: "src-1" };

function capability(key, enabled = true) {
  return { key, label: key, enabled };
}

function brief(overrides = {}) {
  return {
    brief_version: "1.0",
    generated_at: "2026-07-13T13:00:00Z",
    purpose: "asset_stewardship",
    kac: "KPR-6GV2-MJ6W",
    canonical_asset_id: "asset-porsche",
    asset_type: "vehicle",
    lifecycle_state: "active",
    caller_authorization_role: "owner",
    source_envelope_status: "complete",
    brief_status: "complete",
    headline: "2000 Porsche Boxster S",
    subheadline: "Owner stewardship context",
    asset_display_identity: {
      label: "2000 Porsche Boxster S",
      kac: "KPR-6GV2-MJ6W",
      canonical_asset_id: "asset-porsche",
      primary_identifier_kind: "vin",
      primary_identifier_value: "WP0CB2980YU660000",
      identifier_visibility: "owner_private",
    },
    current_state_summary: {
      identity: "Identity is documented.",
      systems: "Systems are documented.",
      history: "History is documented.",
      evidence: "Evidence is documented.",
      maintenance: "Maintenance is documented.",
      continuity: "Continuity is documented.",
    },
    known_facts: [
      {
        id: "fact:vin",
        label: "VIN recorded",
        value: "WP0CB2980YU660000",
        category: "identity",
        confidence_state: "verified",
        effective_date: "2026-01-01",
        provenance: [source],
        source_reference: { table: "asset_identifiers", row_id: "vin-1" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
      {
        id: "fact:engine",
        label: "Engine",
        value: "M96 engine",
        category: "systems",
        confidence_state: "supported",
        provenance: [{ table: "vehicle_systems", row_id: "engine-1" }],
        source_reference: { table: "vehicle_systems", row_id: "engine-1" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
      {
        id: "fact:annual-service",
        label: "Annual service",
        value: "Annual service is documented",
        category: "maintenance",
        confidence_state: "verified",
        provenance: [{ table: "service_records", row_id: "svc-1" }, { table: "story_events", row_id: "story-1" }],
        source_reference: { table: "service_records", row_id: "svc-1" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
      {
        id: "fact:receipt",
        label: "Service invoice",
        value: "Invoice attached",
        category: "evidence",
        confidence_state: "supported",
        provenance: [{ table: "attachments", row_id: "att-1" }, { table: "attachment_placements", row_id: "pl-1" }],
        source_reference: { table: "attachments", row_id: "att-1" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
    ],
    missing_or_uncertain_facts: [],
    recent_updates: [],
    attention_items: [],
    readiness_cards: [
      { dimension: "identity", title: "Identity", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
      { dimension: "systems", title: "Systems", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
      { dimension: "history", title: "History", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
      { dimension: "evidence", title: "Evidence", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
      { dimension: "maintenance", title: "Maintenance", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
      { dimension: "continuity", title: "Continuity", status: "ready", summary: "Ready", supporting_fact_count: 1, blocking_gap_count: 0, can_review_details: true, visibility: "owner_private" },
    ],
    evidence_summary: {
      verified_fact_count: 2,
      supported_fact_count: 2,
      reported_only_fact_count: 0,
      missing_evidence_count: 0,
      conflict_count: 0,
      hidden_domain_count: 0,
      not_applicable_count: 0,
    },
    unresolved_states: [],
    highest_value_next_question: {
      question: "No open question.",
      priority_reason: "no_open_question",
      visibility: "owner_private",
    },
    permitted_next_capabilities: [
      capability("can_ask_kai"),
      capability("can_review_gaps"),
      capability("can_build_maintenance_plan"),
      capability("can_create_asset_brief"),
      capability("can_add_evidence"),
      capability("can_request_service"),
      capability("can_create_report"),
    ],
    provenance_references: [source],
    visibility_classification: [],
    diagnostics: [],
    exclusions_and_redactions: [],
    ...overrides,
  };
}

function regalBrief(overrides = {}) {
  return brief({
    kac: "KPR-REGAL-3300",
    canonical_asset_id: "asset-regal",
    asset_type: "boat",
    headline: "Regal 3300",
    subheadline: "Buyer-side marine context",
    asset_display_identity: {
      label: "Regal 3300",
      kac: "KPR-REGAL-3300",
      canonical_asset_id: "asset-regal",
      primary_identifier_kind: "hin",
      primary_identifier_value: "RGML0000A626",
      identifier_visibility: "owner_private",
    },
    known_facts: [
      {
        id: "fact:hin",
        label: "HIN recorded",
        value: "RGML0000A626",
        category: "identity",
        confidence_state: "verified",
        provenance: [{ table: "asset_identifiers", row_id: "hin-1" }],
        source_reference: { table: "asset_identifiers", row_id: "hin-1" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
      {
        id: "fact:port-engine",
        label: "Port engine",
        value: "Volvo Penta propulsion system",
        category: "systems",
        confidence_state: "supported",
        provenance: [{ table: "boat_systems", row_id: "port-engine" }],
        source_reference: { table: "boat_systems", row_id: "port-engine" },
        scope: "kac_specific",
        visibility: "owner_private",
      },
    ],
    missing_or_uncertain_facts: [
      {
        id: "gap:port-engine-serial",
        gap_type: "identity",
        category: "identity",
        label: "Port engine serial is missing",
        why_it_matters: "Engine identity affects marine service continuity.",
        blocking: true,
        related_system_id: "port-engine",
        source_gap_id: "gap:port-engine-serial",
        provenance: [{ note: "marine fixture" }],
        user_can_resolve: true,
        visibility: "owner_private",
      },
      {
        id: "gap:service-evidence",
        gap_type: "evidence",
        category: "evidence",
        label: "Service evidence is incomplete",
        why_it_matters: "Buyer-side review needs source-backed service context.",
        blocking: false,
        source_gap_id: "gap:service-evidence",
        provenance: [{ note: "marine fixture" }],
        user_can_resolve: true,
        visibility: "owner_private",
      },
    ],
    highest_value_next_question: {
      question: "What is the port engine serial number?",
      related_gap_id: "gap:port-engine-serial",
      priority_reason: "missing_primary_system_identity",
      visibility: "owner_private",
    },
    ...overrides,
  });
}

function statement(overrides = {}) {
  return {
    statement_id: overrides.statement_id || "stmt:test",
    statement_type: overrides.statement_type || "recommendation",
    title: overrides.title || "Annual service recommendation",
    statement: overrides.statement || "Annual service is recommended.",
    authority_class: overrides.authority_class || "professional_recommendation",
    source_role: overrides.source_role || "keepr_pro",
    source_identity_ref: overrides.source_identity_ref || "pro-1",
    asset_specificity: overrides.asset_specificity || "asset_specific",
    confidence: overrides.confidence || "supported",
    evidence_state: overrides.evidence_state || "attested",
    applicability: overrides.applicability || "applies",
    requirement_strength: overrides.requirement_strength || "professionally_recommended",
    effective_date: overrides.effective_date || "2026-07-13",
    related_system_id: overrides.related_system_id || null,
    source_references: overrides.source_references || [source],
    visibility_classification: overrides.visibility_classification || "owner_private",
    purpose_relevance: overrides.purpose_relevance || "direct",
    dispute_status: overrides.dispute_status || "none",
    supersession_status: overrides.supersession_status || "current",
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    profile_scope: "asset_specific",
    maintenance_philosophy: "condition_based",
    interval_preference: "condition_or_usage",
    low_use_treatment: "defer_without_trigger",
    seasonal_use_preference: "seasonal",
    do_not_manufacture_activity: true,
    source_references: [{ note: "owner profile" }],
    owner_confirmed: true,
    ...overrides,
  };
}

function reconcile(input = {}) {
  return buildKeeprReconciledDecisionContext({
    brief: input.brief || brief(),
    stewardship_profile: input.stewardship_profile,
    statements: input.statements || [],
    generated_at: "2026-07-13T15:00:00Z",
  });
}

const outputText = (value) => JSON.stringify(value);

test("exports the full Build 2E authority vocabulary", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(KEEPR_AUTHORITY_CLASSES)), [
    "documented_fact",
    "manufacturer_requirement",
    "warranty_obligation",
    "legal_or_compliance_requirement",
    "professional_finding",
    "professional_recommendation",
    "standard_service_practice",
    "owner_report",
    "owner_preference",
    "kai_interpretation",
    "generic_asset_class_context",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(KEEPR_REQUIREMENT_STRENGTHS)), [
    "mandatory",
    "required_for_warranty",
    "professionally_recommended",
    "customary",
    "owner_preferred",
    "optional",
    "informational",
    "unknown",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(KEEPR_APPLICABILITIES)), [
    "applies",
    "conditionally_applies",
    "does_not_apply",
    "insufficient_evidence",
    "expired",
    "superseded",
    "disputed",
  ]);
});

test("accepts every class, strength, and applicability without collapsing semantics", () => {
  const statements = KEEPR_AUTHORITY_CLASSES.map((authority_class, index) => statement({
    statement_id: `stmt:${authority_class}`,
    authority_class,
    statement_type: authority_class === "documented_fact" ? "fact" : "context",
    requirement_strength: KEEPR_REQUIREMENT_STRENGTHS[index % KEEPR_REQUIREMENT_STRENGTHS.length],
    applicability: KEEPR_APPLICABILITIES[index % KEEPR_APPLICABILITIES.length],
    title: authority_class,
    statement: `${authority_class} statement`,
  }));
  const result = reconcile({ statements });
  const classes = new Set(result.statements_considered.map((item) => item.authority_class));
  for (const authority_class of KEEPR_AUTHORITY_CLASSES) assert.equal(classes.has(authority_class), true);
});

test("builds a deterministic context from an already-authorized brief only", () => {
  const result = reconcile();
  assert.equal(result.reconciliation_version, "1.0");
  assert.equal(result.generated_at, "2026-07-13T15:00:00Z");
  assert.equal(result.kac, "KPR-6GV2-MJ6W");
  assert.equal(result.canonical_asset_id, "asset-porsche");
  assert.equal(result.action_justification_status, "no_action_required");
  assert.equal(result.no_action_justification_status, "supported");
  assert.equal(result.permitted_capabilities.some((item) => item.key === "can_request_service"), true);
});

test("well-documented low-mileage Porsche can return no_action_required with no manufactured work", () => {
  const result = reconcile({ stewardship_profile: profile() });
  assert.equal(result.action_justification_status, "no_action_required");
  assert.equal(result.kai_synthesis.includes("No source-supported action is justified"), true);
  assert.equal(result.owner_preference_context.some((item) => item.statement.includes("defer_without_trigger")), true);
  assert.equal(result.conflicting_statements.length, 0);
});

test("capability availability alone does not create artificial action", () => {
  const result = reconcile();
  assert.equal(result.permitted_capabilities.find((item) => item.key === "can_request_service").enabled, true);
  assert.equal(result.action_justification_status, "no_action_required");
  assert.equal(result.recommended_question, undefined);
});

test("age alone and elapsed time without documented interval do not trigger work", () => {
  const oldBrief = brief({
    lifecycle_state: "active",
    known_facts: [
      ...brief().known_facts,
      {
        id: "fact:age",
        label: "Model year",
        value: "2000",
        category: "identity",
        confidence_state: "verified",
        provenance: [source],
        source_reference: source,
        scope: "kac_specific",
        visibility: "owner_private",
      },
      {
        id: "fact:last-service-date",
        label: "Last service date",
        value: "2024-01-01",
        category: "maintenance",
        confidence_state: "supported",
        provenance: [source],
        source_reference: source,
        scope: "kac_specific",
        visibility: "owner_private",
      },
    ],
  });
  const result = reconcile({ brief: oldBrief });
  assert.equal(result.action_justification_status, "no_action_required");
});

test("unknown usage produces uncertainty instead of heavy-use assumptions", () => {
  const result = reconcile({
    brief: brief({
      missing_or_uncertain_facts: [
        {
          id: "gap:usage",
          gap_type: "usage",
          category: "maintenance",
          label: "Current mileage or use is unknown",
          why_it_matters: "Usage affects maintenance interpretation.",
          blocking: true,
          source_gap_id: "gap:usage",
          provenance: [{ note: "usage gap" }],
          user_can_resolve: true,
          visibility: "owner_private",
        },
      ],
      highest_value_next_question: {
        question: "What is the current mileage and usage pattern?",
        related_gap_id: "gap:usage",
        priority_reason: "highest_impact_continuity_gap",
        visibility: "owner_private",
      },
    }),
  });
  assert.equal(result.action_justification_status, "insufficient_evidence");
  assert.equal(result.recommended_question, "What is the current mileage and usage pattern?");
  assert.equal(outputText(result).includes("heavy use"), false);
});

test("professional recommendation with unknown basis requests clarification instead of mandate", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:annual-service",
        requirement_strength: "unknown",
        evidence_state: "unknown",
        source_references: [],
      }),
    ],
  });
  assert.equal(result.action_justification_status, "clarification_required");
  assert.equal(result.recommended_question, "Is this recommendation based on manufacturer requirements, asset condition, warranty terms, or standard practice?");
});

test("standard shop practice is distinct from manufacturer requirement", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:oem",
        authority_class: "manufacturer_requirement",
        statement_type: "requirement",
        title: "Annual oil service",
        statement: "Manufacturer interval requires annual oil service.",
        requirement_strength: "mandatory",
      }),
      statement({
        statement_id: "stmt:shop-practice",
        authority_class: "standard_service_practice",
        statement_type: "practice",
        title: "Annual oil service",
        statement: "Shop practice recommends annual oil service.",
        requirement_strength: "customary",
      }),
    ],
  });
  assert.equal(result.conflicting_statements.some((item) => item.conflict_type === "manufacturer_vs_shop_practice"), true);
  assert.equal(result.owner_decision_required, true);
});

test("standard practice presented as mandatory is flagged", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:mandatory-practice",
        authority_class: "standard_service_practice",
        statement_type: "practice",
        requirement_strength: "mandatory",
      }),
    ],
  });
  assert.equal(result.conflicting_statements.some((item) => item.conflict_type === "standard_practice_presented_mandatory"), true);
});

test("generic asset-class context cannot be promoted into asset-specific authority", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:generic",
        authority_class: "generic_asset_class_context",
        statement_type: "context",
        asset_specificity: "asset_specific",
        requirement_strength: "informational",
      }),
    ],
  });
  assert.equal(result.conflicting_statements.some((item) => item.conflict_type === "generic_guidance_presented_asset_specific"), true);
});

test("asset-specific professional finding supports action without declaring the professional always right", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:oil-contamination",
        authority_class: "professional_finding",
        statement_type: "finding",
        title: "Oil contamination observed",
        statement: "Technician observed water contamination in engine oil.",
        evidence_state: "attested",
        confidence: "supported",
        source_identity_ref: "marine-tech-1",
        related_system_id: "engine",
      }),
    ],
  });
  assert.equal(result.action_justification_status, "action_supported");
  assert.equal(result.professional_input_context.length, 1);
  assert.equal(result.kai_synthesis.includes("professional finding"), true);
});

test("warranty obligation overrides preference only as distinct decision context", () => {
  const result = reconcile({
    stewardship_profile: profile({ low_use_treatment: "defer_without_trigger" }),
    statements: [
      statement({
        statement_id: "stmt:warranty",
        authority_class: "warranty_obligation",
        statement_type: "obligation",
        title: "Warranty inspection",
        statement: "Warranty requires documented inspection.",
        requirement_strength: "required_for_warranty",
      }),
    ],
  });
  assert.equal(result.action_justification_status, "conflict_unresolved");
  assert.equal(result.conflicting_statements.some((item) => item.conflict_type === "warranty_vs_owner_deferral"), true);
});

test("owner decision states are preserved without executing action", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:owner-deferred",
        authority_class: "owner_preference",
        statement_type: "preference",
        statement: "Owner deferred cosmetic service pending explanation.",
        requirement_strength: "owner_preferred",
        owner_decision: "awaiting_explanation",
      }),
    ],
  });
  assert.equal(result.statements_considered.some((item) => item.owner_decision === "awaiting_explanation"), true);
  assert.equal(outputText(result).includes("executed"), false);
});

test("monitor language does not create reminders or arbitrary review milestones", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:monitor",
        authority_class: "kai_interpretation",
        statement_type: "interpretation",
        statement: "Continue normal use and monitor until a documented change occurs.",
        requirement_strength: "informational",
      }),
    ],
  });
  assert.equal(result.action_justification_status, "no_action_required");
  assert.equal(outputText(result).includes("reminder"), false);
  assert.equal(outputText(result).includes("due date"), false);
});

test("Regal marine context preserves HIN and marine systems without automotive assumptions", () => {
  const result = reconcile({
    brief: regalBrief(),
    statements: [
      statement({
        statement_id: "stmt:marina-annual",
        authority_class: "professional_recommendation",
        statement_type: "recommendation",
        title: "Annual propulsion service",
        statement: "Marina recommends annual propulsion service.",
        requirement_strength: "unknown",
        evidence_state: "unknown",
        related_system_id: "port-engine",
      }),
    ],
  });
  assert.equal(result.semantic_facts.some((fact) => fact.includes("Hull identifier")), true);
  assert.equal(result.semantic_facts.some((fact) => fact.includes("Volvo Penta")), true);
  assert.equal(result.prioritized_gaps.find((gap) => gap.gap_id === "gap:port-engine-serial").priority, "decision_blocking");
  assert.equal(outputText(result).includes("vehicle_systems"), false);
  assert.equal(outputText(result).includes("mileage"), false);
});

test("boat contamination finding changes no-action outcome to supported action context", () => {
  const result = reconcile({
    brief: regalBrief({ missing_or_uncertain_facts: [] }),
    statements: [
      statement({
        statement_id: "stmt:contamination",
        authority_class: "professional_finding",
        statement_type: "finding",
        title: "Port engine oil contamination",
        statement: "Marine technician observed oil contamination.",
        source_identity_ref: "marine-tech-1",
        related_system_id: "port-engine",
        evidence_state: "attested",
      }),
    ],
  });
  assert.equal(result.action_justification_status, "action_supported");
});

test("semantic facts avoid internal implementation labels", () => {
  const result = reconcile();
  const text = result.semantic_facts.join(" ");
  assert.equal(/attachment_placement|work_event|vehicle_systems|boat_systems|not_applicable/i.test(text), false);
  assert.equal(result.semantic_facts.some((fact) => fact.includes("supporting evidence")), true);
});

test("service Moment provenance remains deduplicated in a single authority statement", () => {
  const result = reconcile();
  const annual = result.statements_considered.find((item) => item.statement_id === "brief_fact:fact:annual-service");
  assert.ok(annual);
  assert.equal(annual.source_references.length, 2);
  assert.equal(result.statements_considered.filter((item) => item.statement_id.includes("annual-service")).length, 1);
});

test("prohibited personal and infrastructure fields are excluded", () => {
  const result = reconcile({
    statements: [
      statement({
        statement_id: "stmt:bad",
        statement: "Contact a@example.invalid using signed_url https://example.invalid/private.",
      }),
      statement({
        statement_id: "stmt:good",
        statement: "Professional recommendation is present.",
      }),
    ],
  });
  assert.equal(result.statements_considered.some((item) => item.statement_id === "stmt:bad"), false);
  assert.equal(result.statements_considered.some((item) => item.statement_id === "stmt:good"), true);
  assert.equal(/signed_url|a@example|storage_path|extracted_text|access_token|refresh_token/.test(outputText(result)), false);
});

test("restricted brief stays evidence-limited and does not reconstruct hidden content", () => {
  const result = reconcile({
    brief: brief({
      brief_status: "restricted",
      known_facts: [
        {
          id: "fact:hidden",
          label: "Hidden fact",
          value: "Hidden",
          category: "history",
          confidence_state: "not_visible",
          provenance: [],
          scope: "kac_specific",
          visibility: "restricted",
        },
      ],
    }),
  });
  assert.equal(result.visibility, "restricted");
  assert.equal(result.action_justification_status, "insufficient_evidence");
  assert.equal(result.statements_considered.some((item) => item.statement_id === "brief_fact:fact:hidden"), false);
});

test("Build 2E performs no endpoint, provider, database, or action execution behavior", () => {
  const result = reconcile();
  const text = outputText(result);
  assert.equal(text.includes("fetch("), false);
  assert.equal(text.includes("supabase"), false);
  assert.equal(text.includes("provider"), false);
  assert.equal(text.includes("endpoint"), false);
  assert.equal(text.includes("create_reminder"), false);
  assert.equal(text.includes("service request created"), false);
});
