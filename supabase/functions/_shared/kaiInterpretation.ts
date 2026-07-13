import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type {
  KaiAssetBrief,
  KaiCapabilityKey,
} from "./kaiAssetBriefTypes.ts";
import type {
  BuildKaiInterpretationInput,
  KaiFollowUpQuestion,
  KaiInterpretation,
  KaiInterpretationModelProvider,
  KaiInterpretationStatus,
  KaiModelInput,
  KaiObservation,
  KaiPlanStep,
  KaiPlanStepType,
  KaiProposedPlan,
  KaiValidationResult,
} from "./kaiInterpretationTypes.ts";
export {
  CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES,
  isCallableBuild2CInterpretationPurpose,
} from "./kaiInterpretationTypes.ts";
import { isCallableBuild2CInterpretationPurpose } from "./kaiInterpretationTypes.ts";

export const KAI_INTERPRETATION_SYSTEM_PROMPT = [
  "You are KAI, Keepr's bounded asset interpretation layer.",
  "Reason only from the supplied KaiAssetBrief JSON.",
  "Distinguish fact, uncertainty, missing evidence, and hidden context.",
  "Cite source IDs or provenance references for every material claim.",
  "Do not invent dates, service intervals, specifications, prices, warranties, findings, ownership, or history.",
  "Do not provide safety, valuation, legal, insurance, or mechanical certainty.",
  "Preserve asset-type distinctions and avoid cross-domain assumptions.",
  "Use only permitted capability flags.",
  "Available capabilities are options, not evidence.",
  "Propose but never execute actions.",
  "Do not create work to make the response appear useful.",
  "Prefer no action over unsupported action.",
  "A zero-step plan is valid when no source-grounded action is justified.",
  "Low usage and elapsed time must be evaluated separately.",
  "Generic maintenance knowledge cannot create asset-specific obligations.",
  "No-action conclusions must be source-grounded and qualified.",
  "State when evidence is insufficient.",
  "Ask no more than one follow-up question.",
  "Return structured JSON matching the KaiInterpretation contract.",
].join("\n");

const FORBIDDEN_PATTERNS = [
  /extracted_text/i,
  /signed_?url/i,
  /storage_path/i,
  /access_token/i,
  /refresh_token/i,
  /service_role/i,
  /secret/i,
  /raw sql/i,
  /stack trace/i,
  /@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
];

const SPECULATION_PATTERNS = [
  /every\s+\d+[,0-9]*\s*(mile|hour|month|year|km|kilometer)/i,
  /\$\s?\d+/,
  /warranty.*expires/i,
  /\bexpires?\s+on\b/i,
  /\bsafe\b/i,
  /fully documented/i,
  /guaranteed/i,
  /repair.*required/i,
  /schedule(d)? service/i,
  /assigned? (a )?keepr pro/i,
  /created? (a )?reminder/i,
  /executed/i,
  /because .*old/i,
  /because .*capability/i,
  /generic maintenance/i,
  /needs no future maintenance/i,
  /no future maintenance/i,
  /nothing (else )?(is|will be) needed/i,
];

const STEP_CAPABILITY: Record<KaiPlanStepType, KaiCapabilityKey> = {
  review_existing_evidence: "can_review_gaps",
  add_missing_evidence: "can_add_evidence",
  confirm_asset_or_system_identity: "can_review_gaps",
  clarify_unresolved_state: "can_review_gaps",
  review_maintenance_history: "can_review_gaps",
  build_maintenance_plan: "can_build_maintenance_plan",
  request_service: "can_request_service",
  ask_kai: "can_ask_kai",
  create_asset_brief: "can_create_asset_brief",
  create_report: "can_create_report",
};

function diagnostic(code: string, severity: ManifestDiagnostic["severity"], message: string): ManifestDiagnostic {
  return { code, severity, message };
}

function hasForbiddenText(value: unknown) {
  const text = JSON.stringify(value || {});
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function hasSpeculation(value: unknown) {
  const text = JSON.stringify(value || {});
  return SPECULATION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasActionJustification(step: KaiPlanStep, brief: KaiAssetBrief) {
  const gap = step.related_gap_id
    ? brief.missing_or_uncertain_facts.find((item) => item.id === step.related_gap_id)
    : undefined;
  const sourceText = `${step.title} ${step.explanation} ${step.evidence_requirement || ""}`.toLowerCase();
  return Boolean(
    gap?.blocking ||
      sourceText.includes("open finding") ||
      sourceText.includes("blocking evidence gap") ||
      sourceText.includes("missing evidence blocking") ||
      sourceText.includes("authoritative") ||
      sourceText.includes("documented requirement") ||
      sourceText.includes("usage tied to a documented requirement") ||
      sourceText.includes("elapsed time tied to a documented requirement") ||
      sourceText.includes("unresolved system state") ||
      sourceText.includes("warranty") ||
      sourceText.includes("compliance") ||
      sourceText.includes("owner request") ||
      sourceText.includes("lifecycle event"),
  );
}

function privateIdentifierValues(brief: KaiAssetBrief) {
  return [
    brief.asset_display_identity.identifier_visibility === "owner_private"
      ? brief.asset_display_identity.primary_identifier_value
      : undefined,
    ...brief.known_facts
      .filter((fact) => fact.visibility === "owner_private" && fact.category === "identity")
      .map((fact) => fact.value),
  ].filter((value): value is string => Boolean(value && !String(value).startsWith("masked")));
}

function parseOutput(output: unknown, rawText?: string) {
  if (output && typeof output === "object") return output as Partial<KaiInterpretation>;
  if (typeof rawText === "string") return JSON.parse(rawText) as Partial<KaiInterpretation>;
  throw new Error("missing_model_output");
}

export function buildKaiModelInput(brief: KaiAssetBrief): KaiModelInput {
  return {
    system_prompt: KAI_INTERPRETATION_SYSTEM_PROMPT,
    brief: {
      brief_version: brief.brief_version,
      purpose: brief.purpose,
      kac: brief.kac,
      canonical_asset_id: brief.canonical_asset_id,
      asset_display_identity: brief.asset_display_identity,
      asset_type: brief.asset_type,
      lifecycle_state: brief.lifecycle_state,
      source_envelope_status: brief.source_envelope_status,
      brief_status: brief.brief_status,
      headline: brief.headline,
      subheadline: brief.subheadline,
      current_state_summary: brief.current_state_summary,
      known_facts: brief.known_facts,
      missing_or_uncertain_facts: brief.missing_or_uncertain_facts,
      recent_updates: brief.recent_updates,
      attention_items: brief.attention_items,
      readiness_cards: brief.readiness_cards,
      evidence_summary: brief.evidence_summary,
      unresolved_states: brief.unresolved_states,
      highest_value_next_question: brief.highest_value_next_question,
      permitted_next_capabilities: brief.permitted_next_capabilities,
      provenance_references: brief.provenance_references,
      visibility_classification: brief.visibility_classification,
      exclusions_and_redactions: brief.exclusions_and_redactions,
    },
  };
}

function sourceIds(brief: KaiAssetBrief) {
  const factIds = new Set(brief.known_facts.map((fact) => fact.id));
  const gapIds = new Set(brief.missing_or_uncertain_facts.map((gap) => gap.id));
  const readiness = new Set(brief.readiness_cards.map((card) => card.dimension));
  const attention = new Set(brief.attention_items.map((item) => item.id));
  const updates = new Set(brief.recent_updates.map((update) => update.id));
  const unresolved = new Set(brief.unresolved_states.map((state) => state.id));
  return { factIds, gapIds, readiness, attention, updates, unresolved };
}

function enabledCapabilities(brief: KaiAssetBrief) {
  return new Set(
    brief.permitted_next_capabilities
      .filter((capability) => capability.enabled)
      .map((capability) => capability.key),
  );
}

function hasValidObservationSource(observation: KaiObservation, brief: KaiAssetBrief) {
  const ids = sourceIds(brief);
  return observation.source_fact_ids?.some((id) => ids.factIds.has(id)) ||
    observation.source_gap_ids?.some((id) => ids.gapIds.has(id)) ||
    observation.source_readiness_dimensions?.some((dimension) => ids.readiness.has(dimension)) ||
    ids.attention.has(observation.observation_id) ||
    ids.updates.has(observation.observation_id) ||
    ids.unresolved.has(observation.observation_id);
}

function validateStep(step: KaiPlanStep, brief: KaiAssetBrief, rejected: string[], errors: string[]) {
  const enabled = enabledCapabilities(brief);
  const expectedCapability = STEP_CAPABILITY[step.step_type];
  if (step.status !== "proposed") {
    errors.push("plan_step_not_proposed");
    rejected.push(step.step_id);
  }
  if (!expectedCapability || step.required_capability !== expectedCapability) {
    errors.push("plan_step_capability_mismatch");
    rejected.push(step.step_id);
  }
  if (!enabled.has(step.required_capability)) {
    errors.push("denied_capability_used");
    rejected.push(step.step_id);
  }
  if (!step.source_references?.length) {
    errors.push("plan_step_missing_source");
    rejected.push(step.step_id);
  }
  if (!hasActionJustification(step, brief)) {
    errors.push("plan_step_missing_action_threshold");
    rejected.push(step.step_id);
  }
}

export function validateKaiInterpretation(candidate: Partial<KaiInterpretation>, brief: KaiAssetBrief): KaiValidationResult {
  const errorCodes: string[] = [];
  const rejectedClaims: string[] = [];
  const rejectedPlanSteps: string[] = [];

  if (hasForbiddenText(candidate)) errorCodes.push("prohibited_field_present");
  if (hasSpeculation(candidate)) errorCodes.push("unsupported_claim_present");
  const candidateText = JSON.stringify(candidate || {});
  for (const value of privateIdentifierValues(brief)) {
    if (value && candidateText.includes(value)) {
      errorCodes.push("private_identifier_exposed");
      rejectedClaims.push(value);
    }
  }

  const observations = candidate.prioritized_observations || [];
  for (const observation of observations) {
    if (!hasValidObservationSource(observation, brief)) {
      errorCodes.push("observation_not_grounded");
      rejectedClaims.push(observation.observation_id || observation.title);
    }
    if (observation.visibility_classification === "restricted" && brief.brief_status !== "restricted") {
      errorCodes.push("visibility_classification_not_preserved");
      rejectedClaims.push(observation.observation_id || observation.title);
    }
  }

  const question = candidate.follow_up_question;
  if (Array.isArray(question)) errorCodes.push("multiple_questions_returned");
  if (question && brief.highest_value_next_question.priority_reason !== "no_open_question") {
    const sourceGapId = (question as KaiFollowUpQuestion).source_gap_id;
    if (brief.highest_value_next_question.related_gap_id && sourceGapId !== brief.highest_value_next_question.related_gap_id) {
      errorCodes.push("question_changed_intent");
      rejectedClaims.push((question as KaiFollowUpQuestion).question);
    }
  }

  for (const step of candidate.proposed_plan?.ordered_steps || []) {
    validateStep(step, brief, rejectedPlanSteps, errorCodes);
  }
  if (candidate.proposed_plan?.plan_status === "no_action_required") {
    if ((candidate.proposed_plan.ordered_steps || []).length > 0) {
      errorCodes.push("no_action_plan_contains_steps");
    }
    if (!candidate.proposed_plan.rationale || !candidate.proposed_plan.supporting_evidence?.length) {
      errorCodes.push("no_action_missing_rationale_or_evidence");
    }
  }
  if (/monitor/i.test(candidate.proposed_plan?.rationale || "") && /reminder|recurring|schedule|due date|review date|\d{4}-\d{2}-\d{2}/i.test(JSON.stringify(candidate.proposed_plan || {}))) {
    errorCodes.push("monitor_created_schedule");
  }

  for (const capability of candidate.proposed_plan?.permitted_capabilities_used || []) {
    if (!enabledCapabilities(brief).has(capability)) {
      errorCodes.push("denied_capability_used");
      rejectedPlanSteps.push(String(capability));
    }
  }

  if (brief.asset_type === "marine" && /vehicle|car|odometer/i.test(JSON.stringify(candidate))) {
    errorCodes.push("cross_domain_assumption");
  }

  if (observations.length && observations.some((observation) => !observation.source_fact_ids?.length && !observation.source_gap_ids?.length && !observation.source_readiness_dimensions?.length)) {
    errorCodes.push("material_claim_missing_source");
  }

  const uniqueErrors = [...new Set(errorCodes)];
  return {
    valid: uniqueErrors.length === 0,
    error_codes: uniqueErrors,
    rejected_claims: [...new Set(rejectedClaims.filter(Boolean))],
    rejected_plan_steps: [...new Set(rejectedPlanSteps.filter(Boolean))],
    diagnostics: uniqueErrors.map((code) => diagnostic(code, "warning", "Model output did not pass grounding validation.")),
  };
}

function fallbackObservationFromBrief(brief: KaiAssetBrief): KaiObservation[] {
  const readiness = brief.readiness_cards[0];
  const fact = brief.known_facts[0];
  const gap = brief.missing_or_uncertain_facts[0];
  const observations: KaiObservation[] = [];
  if (fact) {
    observations.push({
      observation_id: `fact:${fact.id}`,
      title: fact.label,
      explanation: `${fact.label} is present in the authorized brief.`,
      category: fact.category === "recent_change" ? "history" : fact.category,
      priority: "informational",
      confidence: fact.confidence_state,
      source_fact_ids: [fact.id],
      source_gap_ids: [],
      source_readiness_dimensions: [],
      visibility_classification: fact.visibility,
    });
  }
  if (gap) {
    observations.push({
      observation_id: `gap:${gap.id}`,
      title: gap.label,
      explanation: gap.why_it_matters,
      category: gap.category,
      priority: gap.blocking ? "important" : "attention",
      confidence: "missing",
      source_fact_ids: [],
      source_gap_ids: [gap.id],
      source_readiness_dimensions: [],
      visibility_classification: gap.visibility,
    });
  }
  if (readiness) {
    observations.push({
      observation_id: `readiness:${readiness.dimension}`,
      title: readiness.title,
      explanation: readiness.summary,
      category: readiness.dimension,
      priority: readiness.status === "ready" ? "informational" : "attention",
      confidence: readiness.status === "ready" ? "supported" : "missing",
      source_fact_ids: [],
      source_gap_ids: [],
      source_readiness_dimensions: [readiness.dimension],
      visibility_classification: readiness.visibility,
    });
  }
  return observations.slice(0, 4);
}

function fallbackPlan(brief: KaiAssetBrief): KaiProposedPlan {
  const enabled = enabledCapabilities(brief);
  const steps: KaiPlanStep[] = [];
  const gap = brief.missing_or_uncertain_facts[0];
  const source = brief.provenance_references[0] || { note: "KaiAssetBrief" };
  if (gap && enabled.has("can_add_evidence")) {
    steps.push({
      step_id: "step:add-missing-evidence",
      title: "Add missing evidence",
      explanation: gap.label,
      step_type: "add_missing_evidence",
      priority: gap.blocking ? "important" : "attention",
      status: "proposed",
      related_gap_id: gap.id,
      required_capability: "can_add_evidence",
      source_references: [source],
      evidence_requirement: gap.label,
      owner_confirmation_required: true,
    });
  }
  if (enabled.has("can_review_gaps")) {
    steps.push({
      step_id: "step:review-gaps",
      title: "Review open gaps",
      explanation: "Review the deterministic gaps surfaced in the brief.",
      step_type: "review_existing_evidence",
      priority: "attention",
      status: "proposed",
      related_gap_id: gap?.id,
      required_capability: "can_review_gaps",
      source_references: [source],
      evidence_requirement: "Existing brief context",
      owner_confirmation_required: false,
    });
  }
  if (brief.purpose === "maintenance_planning" && enabled.has("can_build_maintenance_plan")) {
    steps.push({
      step_id: "step:build-maintenance-plan",
      title: "Build maintenance plan",
      explanation: "Use the authorized maintenance context to prepare a plan later.",
      step_type: "build_maintenance_plan",
      priority: "attention",
      status: "proposed",
      required_capability: "can_build_maintenance_plan",
      source_references: [source],
      evidence_requirement: "Maintenance history in brief",
      owner_confirmation_required: true,
    });
  }
  return {
    plan_title: brief.purpose === "maintenance_planning" ? "Proposed maintenance review plan" : "Proposed stewardship review plan",
    plan_purpose: brief.purpose,
    plan_status: steps.length ? "action_proposed" : "no_action_required",
    rationale: steps.length
      ? "The plan includes only permitted steps tied to documented gaps or brief context."
      : "No action is justified from the supplied brief. Continue normal use unless the documented context changes.",
    supporting_evidence: [source],
    evidence_limitations: brief.missing_or_uncertain_facts.map((gap) => gap.label).slice(0, 5),
    reassessment_conditions: [
      "new documented finding",
      "new maintenance obligation",
      "new warranty condition",
      "usage or mileage change documented in Keepr",
    ],
    ordered_steps: steps.slice(0, 4),
    unresolved_dependencies: brief.missing_or_uncertain_facts.map((gap) => gap.id).slice(0, 5),
    plan_limitations: [
      "This plan is proposed only and does not execute actions.",
      "It is limited to the authorized Asset Brief content.",
      "Availability of a capability alone is not action justification.",
    ],
    permitted_capabilities_used: [...new Set(steps.map((step) => step.required_capability))],
    provenance_references: brief.provenance_references.slice(0, 8),
  };
}

function fallbackQuestion(brief: KaiAssetBrief): KaiFollowUpQuestion | undefined {
  const question = brief.highest_value_next_question;
  if (!question || question.priority_reason === "no_open_question") return undefined;
  return {
    question: question.question,
    source_gap_id: question.related_gap_id,
    why_this_question: "This is the highest-value question from the Asset Brief.",
    provenance_references: question.related_gap_id ? [{ note: `Brief gap ${question.related_gap_id}` }] : [],
  };
}

function statusForFallback(brief: KaiAssetBrief, reason: KaiInterpretationStatus): KaiInterpretationStatus {
  if (brief.brief_status === "restricted") return "restricted";
  if (reason === "invalid" || reason === "unavailable") return reason;
  if (brief.brief_status === "partial") return "partial";
  if (brief.brief_status === "unknown") return "needs_clarification";
  if (brief.brief_status === "attention") return "needs_clarification";
  return "complete";
}

export function deterministicKaiInterpretationFallback(
  brief: KaiAssetBrief,
  generatedAt: string,
  status: KaiInterpretationStatus,
  validation: KaiValidationResult,
  diagnostics: ManifestDiagnostic[] = [],
): KaiInterpretation {
  const observations = brief.brief_status === "restricted" ? [] : fallbackObservationFromBrief(brief);
  const plan = brief.brief_status === "restricted" ? {
    plan_title: "Restricted asset context",
    plan_purpose: brief.purpose,
    plan_status: "restricted" as const,
    rationale: "The source brief is restricted, so no action is proposed.",
    supporting_evidence: [],
    evidence_limitations: ["The source brief is restricted."],
    reassessment_conditions: ["restricted context changes"],
    ordered_steps: [],
    unresolved_dependencies: [],
    plan_limitations: ["The source brief is restricted."],
    permitted_capabilities_used: [],
    provenance_references: [],
  } : fallbackPlan(brief);
  return {
    interpretation_version: "1.0",
    generated_at: generatedAt,
    purpose: brief.purpose,
    kac: brief.kac,
    canonical_asset_id: brief.canonical_asset_id,
    source_brief_version: brief.brief_version,
    source_brief_status: brief.brief_status,
    interpretation_status: statusForFallback(brief, status),
    summary: brief.brief_status === "restricted"
      ? "This asset context is restricted, so KAI is not showing normal interpretation content."
      : `${brief.headline}. ${brief.subheadline}`,
    prioritized_observations: observations,
    current_risks_or_concerns: observations.filter((observation) => observation.priority !== "informational"),
    evidence_limitations: [
      ...brief.missing_or_uncertain_facts.map((gap) => gap.label),
      ...brief.exclusions_and_redactions.map((exclusion) => `${exclusion.reason}: ${exclusion.count}`),
    ].slice(0, 8),
    follow_up_question: brief.brief_status === "restricted" ? undefined : fallbackQuestion(brief),
    proposed_plan: plan,
    source_references: brief.provenance_references,
    capability_references: plan.permitted_capabilities_used,
    exclusions_and_redactions: brief.exclusions_and_redactions,
    validation_result: validation,
    diagnostics: [...diagnostics, ...validation.diagnostics],
  };
}

function normalizeCandidate(
  candidate: Partial<KaiInterpretation>,
  brief: KaiAssetBrief,
  generatedAt: string,
  validation: KaiValidationResult,
): KaiInterpretation {
  const status: KaiInterpretationStatus = brief.brief_status === "restricted"
    ? "restricted"
    : brief.brief_status === "partial"
      ? "partial"
      : brief.brief_status === "unknown" || brief.brief_status === "attention"
        ? "needs_clarification"
        : "complete";
  return {
    interpretation_version: "1.0",
    generated_at: generatedAt,
    purpose: brief.purpose,
    kac: brief.kac,
    canonical_asset_id: brief.canonical_asset_id,
    source_brief_version: brief.brief_version,
    source_brief_status: brief.brief_status,
    interpretation_status: status,
    summary: String(candidate.summary || `${brief.headline}. ${brief.subheadline}`),
    prioritized_observations: candidate.prioritized_observations || [],
    current_risks_or_concerns: candidate.current_risks_or_concerns || [],
    evidence_limitations: candidate.evidence_limitations || [],
    follow_up_question: candidate.follow_up_question,
    proposed_plan: candidate.proposed_plan || fallbackPlan(brief),
    source_references: candidate.source_references || brief.provenance_references,
    capability_references: candidate.capability_references || candidate.proposed_plan?.permitted_capabilities_used || [],
    exclusions_and_redactions: brief.exclusions_and_redactions,
    validation_result: validation,
    diagnostics: candidate.diagnostics || [],
  };
}

export async function buildKaiInterpretation(input: BuildKaiInterpretationInput): Promise<KaiInterpretation> {
  const { brief } = input;
  const generatedAt = input.generated_at || new Date().toISOString();
  if (!isCallableBuild2CInterpretationPurpose(brief.purpose)) {
    throw new Error(`Unsupported Build 2C interpretation purpose: ${brief.purpose}`);
  }
  if (brief.brief_status === "restricted") {
    return deterministicKaiInterpretationFallback(
      brief,
      generatedAt,
      "restricted",
      { valid: true, error_codes: [], rejected_claims: [], rejected_plan_steps: [], diagnostics: [] },
    );
  }

  const provider: KaiInterpretationModelProvider | undefined = input.provider;
  if (!provider) {
    return deterministicKaiInterpretationFallback(
      brief,
      generatedAt,
      "unavailable",
      { valid: true, error_codes: [], rejected_claims: [], rejected_plan_steps: [], diagnostics: [] },
      [diagnostic("model_unavailable", "warning", "No model provider was supplied.")],
    );
  }

  const request = {
    input: buildKaiModelInput(brief),
    timeout_ms: input.timeout_ms || 8000,
    model: input.model || "provider-neutral",
    retry_policy: input.retry_policy || { max_attempts: 0 },
  };

  const result = await provider.generateStructured(request);
  if (!result.ok) {
    return deterministicKaiInterpretationFallback(
      brief,
      generatedAt,
      result.failure_state === "timeout" ? "unavailable" : "unavailable",
      { valid: true, error_codes: [], rejected_claims: [], rejected_plan_steps: [], diagnostics: [] },
      result.diagnostics || [diagnostic("model_unavailable", "warning", "Model provider did not return usable output.")],
    );
  }

  let candidate: Partial<KaiInterpretation>;
  try {
    candidate = parseOutput(result.output, result.raw_text);
  } catch (_error) {
    return deterministicKaiInterpretationFallback(
      brief,
      generatedAt,
      "unavailable",
      {
        valid: false,
        error_codes: ["invalid_json"],
        rejected_claims: [],
        rejected_plan_steps: [],
        diagnostics: [diagnostic("invalid_json", "warning", "Model output could not be parsed.")],
      },
    );
  }

  const validation = validateKaiInterpretation(candidate, brief);
  if (!validation.valid) {
    return deterministicKaiInterpretationFallback(brief, generatedAt, "invalid", validation);
  }
  return normalizeCandidate(candidate, brief, generatedAt, validation);
}
