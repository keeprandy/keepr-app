import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type { KaiAssetBrief } from "./kaiAssetBriefTypes.ts";
import type {
  KaiInterpretation,
  KaiModelResult,
  KaiValidationResult,
} from "./kaiInterpretationTypes.ts";
import {
  buildKaiModelInput,
  deterministicKaiInterpretationFallback,
  validateKaiInterpretation,
} from "./kaiInterpretation.ts";
import { isCallableBuild2CInterpretationPurpose } from "./kaiInterpretationTypes.ts";
import type {
  BuildKaiInterpretationOrchestrationInput,
  KaiInterpretationOrchestrationResult,
  KaiOrchestrationStatus,
  KaiOrchestrationValidationResult,
  KaiProviderMetadata,
  KaiTelemetryEvent,
  KaiValidationErrorCode,
  KaiValidationStageName,
  KaiValidationStageResult,
} from "./kaiInterpretationOrchestrationTypes.ts";

export type {
  KaiInterpretationOrchestrationResult,
  KaiOrchestrationStatus,
  KaiTelemetryEvent,
  KaiValidationErrorCode,
  KaiValidationStageResult,
} from "./kaiInterpretationOrchestrationTypes.ts";

const ALLOWED_TOP_LEVEL = new Set([
  "summary",
  "prioritized_observations",
  "current_risks_or_concerns",
  "evidence_limitations",
  "follow_up_question",
  "proposed_plan",
  "source_references",
  "capability_references",
  "diagnostics",
]);

const LOWER_CODE_MAP: Record<string, KaiValidationErrorCode> = {
  prohibited_field_present: "PROHIBITED_FIELD_PRESENT",
  unsupported_claim_present: "UNSUPPORTED_SAFETY_CLAIM",
  private_identifier_exposed: "PRIVATE_IDENTIFIER_EXPOSED",
  observation_not_grounded: "CLAIM_UNGROUNDED",
  visibility_classification_not_preserved: "VISIBILITY_EXPANDED",
  multiple_questions_returned: "MULTIPLE_QUESTIONS",
  question_changed_intent: "CLAIM_UNGROUNDED",
  plan_step_not_proposed: "ACTION_EXECUTION_ATTEMPTED",
  plan_step_capability_mismatch: "CAPABILITY_DENIED",
  denied_capability_used: "CAPABILITY_DENIED",
  plan_step_missing_source: "SOURCE_REFERENCE_MISSING",
  plan_step_missing_action_threshold: "ACTION_THRESHOLD_NOT_MET",
  no_action_plan_contains_steps: "NO_ACTION_HAS_STEPS",
  no_action_missing_rationale_or_evidence: "SOURCE_REFERENCE_MISSING",
  monitor_created_schedule: "REVIEW_DATE_INVENTED",
  cross_domain_assumption: "DOMAIN_ASSUMPTION_INVALID",
  material_claim_missing_source: "SOURCE_REFERENCE_MISSING",
};

function diagnostic(code: string, severity: ManifestDiagnostic["severity"], message: string): ManifestDiagnostic {
  return { code, severity, message };
}

function durationMs(start: string, end: string) {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function telemetry(
  event_type: KaiTelemetryEvent["event_type"],
  timestamp: string,
  correlation_id: string,
  brief: KaiAssetBrief | undefined,
  patch: Partial<KaiTelemetryEvent> = {},
): KaiTelemetryEvent {
  return {
    event_type,
    timestamp,
    correlation_id,
    purpose: brief?.purpose,
    asset_type: brief?.asset_type,
    brief_status: brief?.brief_status,
    ...patch,
  };
}

function provenanceSummary(brief: KaiAssetBrief | undefined) {
  const refs = brief?.provenance_references || [];
  return {
    reference_count: refs.length,
    tables: [...new Set(refs.map((ref) => ref.table).filter(Boolean) as string[])].sort(),
  };
}

function emptyValidation(valid: boolean, codes: KaiValidationErrorCode[] = []): KaiOrchestrationValidationResult {
  return {
    valid,
    error_codes: codes,
    rejected_claims: [],
    rejected_plan_steps: [],
    diagnostics: codes.map((code) => diagnostic(code, "warning", "Interpretation orchestration validation did not pass.")),
    stages: stageResults(codes),
  };
}

function stageResults(codes: KaiValidationErrorCode[]): KaiValidationStageResult[] {
  const byStage: Record<KaiValidationStageName, KaiValidationErrorCode[]> = {
    schema: ["SCHEMA_INVALID", "PARSE_FAILED"],
    source_reference: ["SOURCE_REFERENCE_MISSING", "SOURCE_REFERENCE_UNKNOWN"],
    grounding: ["CLAIM_UNGROUNDED"],
    confidence: ["CONFIDENCE_PROMOTED"],
    visibility: ["VISIBILITY_EXPANDED"],
    privacy: ["PRIVATE_IDENTIFIER_EXPOSED", "PROHIBITED_FIELD_PRESENT"],
    asset_domain: ["DOMAIN_ASSUMPTION_INVALID", "UNKNOWN_USAGE_ASSUMED"],
    capability_subset: ["CAPABILITY_DENIED"],
    action_threshold: ["ACTION_THRESHOLD_NOT_MET"],
    no_action_consistency: ["NO_ACTION_HAS_STEPS", "REVIEW_DATE_INVENTED"],
    non_execution: ["ACTION_EXECUTION_ATTEMPTED"],
    language_overclaim: ["UNSUPPORTED_INTERVAL", "UNSUPPORTED_PRICE", "UNSUPPORTED_WARRANTY", "UNSUPPORTED_SAFETY_CLAIM", "OVERSTATED_COMPLETENESS"],
  };
  return Object.entries(byStage).map(([stage, stageCodes]) => {
    const found = codes.filter((code) => stageCodes.includes(code));
    return {
      stage: stage as KaiValidationStageName,
      passed: found.length === 0,
      error_codes: found,
      rejected_claim_ids: [],
      rejected_observation_ids: [],
      rejected_step_ids: [],
      diagnostics: found.map((code) => diagnostic(code, "warning", "Validation stage failed.")),
    };
  });
}

function mapValidation(validation: KaiValidationResult, extra: KaiValidationErrorCode[] = []): KaiOrchestrationValidationResult {
  const mapped = validation.error_codes.map((code) => LOWER_CODE_MAP[code] || "SCHEMA_INVALID");
  const error_codes = [...new Set([...mapped, ...extra])];
  return {
    ...validation,
    valid: validation.valid && error_codes.length === 0,
    error_codes,
    stages: stageResults(error_codes),
    diagnostics: [
      ...validation.diagnostics,
      ...extra.map((code) => diagnostic(code, "warning", "Orchestration hardening validation failed.")),
    ],
  };
}

function inputGate(brief: KaiAssetBrief): { ok: true } | { ok: false; status: KaiOrchestrationStatus; codes: KaiValidationErrorCode[] } {
  if (!isCallableBuild2CInterpretationPurpose(brief?.purpose)) return { ok: false, status: "unsupported_purpose", codes: ["UNSUPPORTED_PURPOSE"] };
  if (!brief || brief.brief_version !== "1.0" || !brief.kac || !brief.canonical_asset_id) return { ok: false, status: "invalid_input", codes: ["INVALID_BRIEF"] };
  if (brief.brief_status === "restricted") return { ok: false, status: "restricted", codes: ["RESTRICTED_BRIEF"] };
  const serialized = JSON.stringify(brief);
  if (/extracted_text|signed_?url|storage_path|service_role|access_token|refresh_token|raw sql|stack trace/i.test(serialized)) {
    return { ok: false, status: "invalid_input", codes: ["PROHIBITED_FIELD_PRESENT"] };
  }
  if (!Array.isArray(brief.permitted_next_capabilities) || brief.permitted_next_capabilities.some((cap) => typeof cap.enabled !== "boolean")) {
    return { ok: false, status: "invalid_input", codes: ["INVALID_BRIEF"] };
  }
  if (!Array.isArray(brief.provenance_references) || brief.provenance_references.some((ref) => typeof ref !== "object")) {
    return { ok: false, status: "invalid_input", codes: ["INVALID_BRIEF"] };
  }
  return { ok: true };
}

function strictParse(result: KaiModelResult, strict = true): { ok: true; candidate: Partial<KaiInterpretation> } | { ok: false; codes: KaiValidationErrorCode[] } {
  let parsed: unknown = result.output;
  if (typeof result.raw_text === "string") {
    const text = result.raw_text.trim();
    if (!text.startsWith("{") || !text.endsWith("}")) return { ok: false, codes: ["PARSE_FAILED"] };
    if ((text.match(/\{/g) || []).length > 1 && /}\s*{/.test(text)) return { ok: false, codes: ["PARSE_FAILED"] };
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      return { ok: false, codes: ["PARSE_FAILED"] };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, codes: ["SCHEMA_INVALID"] };
  if (strict) {
    const unknown = Object.keys(parsed).filter((key) => !ALLOWED_TOP_LEVEL.has(key));
    if (unknown.length) return { ok: false, codes: ["SCHEMA_INVALID"] };
  }
  const candidate = parsed as Partial<KaiInterpretation>;
  if (typeof candidate.summary !== "string" || !candidate.proposed_plan || !Array.isArray(candidate.prioritized_observations)) {
    return { ok: false, codes: ["SCHEMA_INVALID"] };
  }
  if (Array.isArray(candidate.follow_up_question)) return { ok: false, codes: ["MULTIPLE_QUESTIONS"] };
  if (!Array.isArray(candidate.proposed_plan.ordered_steps) || !Array.isArray(candidate.proposed_plan.permitted_capabilities_used)) {
    return { ok: false, codes: ["SCHEMA_INVALID"] };
  }
  return { ok: true, candidate };
}

function providerMetadata(
  input: BuildKaiInterpretationOrchestrationInput,
  result: KaiModelResult | undefined,
  latency_ms: number | undefined,
  retry_count: number,
): KaiProviderMetadata {
  return {
    provider_identifier: input.provider_identifier,
    model_identifier: result?.model || input.model || "provider-neutral",
    request_correlation_id: input.correlation_id,
    latency_ms,
    timed_out: result?.failure_state === "timeout",
    retry_count,
    structured_output_mode: "json",
    token_usage: result?.token_usage,
  };
}

function buildAccepted(
  candidate: Partial<KaiInterpretation>,
  brief: KaiAssetBrief,
  generated_at: string,
  validation: KaiOrchestrationValidationResult,
): KaiInterpretation {
  return {
    interpretation_version: "1.0",
    generated_at,
    purpose: brief.purpose,
    kac: brief.kac,
    canonical_asset_id: brief.canonical_asset_id,
    source_brief_version: brief.brief_version,
    source_brief_status: brief.brief_status,
    interpretation_status: brief.brief_status === "partial" ? "partial" : brief.brief_status === "attention" || brief.brief_status === "unknown" ? "needs_clarification" : "complete",
    summary: String(candidate.summary),
    prioritized_observations: candidate.prioritized_observations || [],
    current_risks_or_concerns: candidate.current_risks_or_concerns || [],
    evidence_limitations: candidate.evidence_limitations || [],
    follow_up_question: candidate.follow_up_question,
    proposed_plan: candidate.proposed_plan!,
    source_references: candidate.source_references || brief.provenance_references,
    capability_references: candidate.capability_references || candidate.proposed_plan?.permitted_capabilities_used || [],
    exclusions_and_redactions: brief.exclusions_and_redactions,
    validation_result: validation,
    diagnostics: candidate.diagnostics || [],
  };
}

function resultEnvelope(
  input: BuildKaiInterpretationOrchestrationInput,
  status: KaiOrchestrationStatus,
  interpretation: KaiInterpretation,
  validation: KaiOrchestrationValidationResult,
  started_at: string,
  completed_at: string,
  telemetry_events: KaiTelemetryEvent[],
  patch: Partial<KaiInterpretationOrchestrationResult> = {},
): KaiInterpretationOrchestrationResult {
  return {
    orchestration_version: "1.0",
    generated_at: completed_at,
    purpose: input.brief?.purpose,
    kac: input.brief?.kac,
    canonical_asset_id: input.brief?.canonical_asset_id,
    source_brief_version: input.brief?.brief_version,
    source_brief_status: input.brief?.brief_status,
    orchestration_status: status,
    interpretation_source: status === "accepted" ? "model" : status === "restricted" ? "restricted" : "deterministic_fallback",
    accepted_interpretation: interpretation,
    validation_result: validation,
    fallback_reason: status === "accepted" ? undefined : status,
    timing_metadata: { started_at, completed_at, duration_ms: durationMs(started_at, completed_at) },
    retry_metadata: { max_attempts: input.retry_policy?.max_attempts ?? 1, attempts: 0, retried: false, retry_reasons: [], ...patch.retry_metadata },
    diagnostics: [...validation.diagnostics, ...(patch.diagnostics || [])],
    exclusions_and_redactions: input.brief?.exclusions_and_redactions || [],
    provenance_summary: provenanceSummary(input.brief),
    telemetry_events,
    ...patch,
  };
}

export async function orchestrateKaiInterpretation(input: BuildKaiInterpretationOrchestrationInput): Promise<KaiInterpretationOrchestrationResult> {
  const started_at = input.generated_at || new Date().toISOString();
  const events: KaiTelemetryEvent[] = [telemetry("orchestration_started", started_at, input.correlation_id, input.brief)];
  const gate = inputGate(input.brief);
  if (!gate.ok) {
    const validation = emptyValidation(false, gate.codes);
    const fallback = deterministicKaiInterpretationFallback(input.brief, started_at, gate.status === "restricted" ? "restricted" : "invalid", validation);
    const status = gate.status;
    const eventType = status === "restricted" ? "restricted_short_circuit" : "invalid_input_short_circuit";
    events.push(telemetry(eventType, started_at, input.correlation_id, input.brief, { orchestration_status: status, validation_error_codes: gate.codes }));
    return resultEnvelope(input, status, fallback, validation, started_at, started_at, events);
  }
  if (!input.provider) {
    const validation = emptyValidation(true);
    const fallback = deterministicKaiInterpretationFallback(input.brief, started_at, "unavailable", validation);
    events.push(telemetry("fallback_returned", started_at, input.correlation_id, input.brief, { orchestration_status: "fallback_model_unavailable" }));
    return resultEnvelope(input, "fallback_model_unavailable", fallback, validation, started_at, started_at, events, {
      provider_result_metadata: providerMetadata(input, undefined, undefined, 0),
    });
  }

  const maxAttempts = Math.min(input.retry_policy?.max_attempts ?? 1, 2);
  const retryReasons: string[] = [];
  let attempts = 0;
  let lastResult: KaiModelResult | undefined;
  let lastLatency = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    events.push(telemetry("model_call_started", started_at, input.correlation_id, input.brief, { provider_identifier: input.provider_identifier, model_identifier: input.model, retry_count: attempt - 1 }));
    const callStart = Date.now();
    lastResult = await input.provider.generateStructured({
      input: buildKaiModelInput(input.brief),
      timeout_ms: input.timeout_ms || 8000,
      model: input.model || "provider-neutral",
      retry_policy: { max_attempts: maxAttempts },
    });
    lastLatency = Date.now() - callStart;
    if (lastResult.ok) {
      events.push(telemetry("model_call_completed", started_at, input.correlation_id, input.brief, { provider_identifier: input.provider_identifier, model_identifier: lastResult.model || input.model, duration_ms: lastLatency, retry_count: attempt - 1 }));
      break;
    }
    events.push(telemetry("model_call_failed", started_at, input.correlation_id, input.brief, { provider_identifier: input.provider_identifier, model_identifier: lastResult.model || input.model, duration_ms: lastLatency, retry_count: attempt - 1 }));
    if (!["timeout", "provider_error", "unavailable"].includes(lastResult.failure_state || "")) break;
    if (attempt < maxAttempts) {
      retryReasons.push(lastResult.failure_state || "provider_error");
      events.push(telemetry("retry_started", started_at, input.correlation_id, input.brief, { retry_count: attempt }));
    }
  }

  if (!lastResult?.ok) {
    const status: KaiOrchestrationStatus = lastResult?.failure_state === "timeout" ? "fallback_timeout" : lastResult?.failure_state === "provider_error" ? "fallback_provider_error" : "fallback_model_unavailable";
    const validation = emptyValidation(true);
    const fallback = deterministicKaiInterpretationFallback(input.brief, started_at, "unavailable", validation);
    events.push(telemetry("fallback_returned", started_at, input.correlation_id, input.brief, { orchestration_status: status }));
    return resultEnvelope(input, status, fallback, validation, started_at, started_at, events, {
      provider_result_metadata: providerMetadata(input, lastResult, lastLatency, attempts - 1),
      retry_metadata: { max_attempts: maxAttempts, attempts, retried: attempts > 1, retry_reasons: retryReasons },
    });
  }

  const parsed = strictParse(lastResult, input.strict !== false);
  if (!parsed.ok) {
    const validation = emptyValidation(false, parsed.codes);
    const fallback = deterministicKaiInterpretationFallback(input.brief, started_at, "invalid", validation);
    events.push(telemetry("parse_failed", started_at, input.correlation_id, input.brief, { validation_error_codes: parsed.codes }));
    events.push(telemetry("fallback_returned", started_at, input.correlation_id, input.brief, { orchestration_status: "fallback_parse_failure" }));
    return resultEnvelope(input, "fallback_parse_failure", fallback, validation, started_at, started_at, events, {
      provider_result_metadata: providerMetadata(input, lastResult, lastLatency, attempts - 1),
      retry_metadata: { max_attempts: maxAttempts, attempts, retried: attempts > 1, retry_reasons: retryReasons },
    });
  }

  const validation = mapValidation(validateKaiInterpretation(parsed.candidate, input.brief));
  if (!validation.valid) {
    const fallback = deterministicKaiInterpretationFallback(input.brief, started_at, "invalid", validation);
    events.push(telemetry("validation_failed", started_at, input.correlation_id, input.brief, { validation_error_codes: validation.error_codes }));
    events.push(telemetry("fallback_returned", started_at, input.correlation_id, input.brief, { orchestration_status: "fallback_validation_failure" }));
    return resultEnvelope(input, "fallback_validation_failure", fallback, validation, started_at, started_at, events, {
      provider_result_metadata: providerMetadata(input, lastResult, lastLatency, attempts - 1),
      retry_metadata: { max_attempts: maxAttempts, attempts, retried: attempts > 1, retry_reasons: retryReasons },
    });
  }

  const accepted = buildAccepted(parsed.candidate, input.brief, started_at, validation);
  events.push(telemetry("interpretation_accepted", started_at, input.correlation_id, input.brief, { orchestration_status: "accepted", validation_error_codes: [] }));
  return resultEnvelope(input, "accepted", accepted, validation, started_at, started_at, events, {
    provider_result_metadata: providerMetadata(input, lastResult, lastLatency, attempts - 1),
    retry_metadata: { max_attempts: maxAttempts, attempts, retried: attempts > 1, retry_reasons: retryReasons },
  });
}
