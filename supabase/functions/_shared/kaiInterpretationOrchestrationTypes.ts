import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type { KaiAssetBrief } from "./kaiAssetBriefTypes.ts";
import type {
  KaiInterpretation,
  KaiInterpretationModelProvider,
  KaiModelResult,
  KaiValidationResult,
} from "./kaiInterpretationTypes.ts";

export type KaiOrchestrationStatus =
  | "accepted"
  | "fallback_model_unavailable"
  | "fallback_timeout"
  | "fallback_parse_failure"
  | "fallback_validation_failure"
  | "fallback_provider_error"
  | "restricted"
  | "unsupported_purpose"
  | "invalid_input";

export type KaiInterpretationSource = "model" | "deterministic_fallback" | "restricted";

export type KaiValidationErrorCode =
  | "UNSUPPORTED_PURPOSE"
  | "INVALID_BRIEF"
  | "RESTRICTED_BRIEF"
  | "SCHEMA_INVALID"
  | "PARSE_FAILED"
  | "SOURCE_REFERENCE_MISSING"
  | "SOURCE_REFERENCE_UNKNOWN"
  | "CLAIM_UNGROUNDED"
  | "CONFIDENCE_PROMOTED"
  | "VISIBILITY_EXPANDED"
  | "PRIVATE_IDENTIFIER_EXPOSED"
  | "PROHIBITED_FIELD_PRESENT"
  | "DOMAIN_ASSUMPTION_INVALID"
  | "CAPABILITY_DENIED"
  | "ACTION_THRESHOLD_NOT_MET"
  | "NO_ACTION_HAS_STEPS"
  | "ACTION_EXECUTION_ATTEMPTED"
  | "MULTIPLE_QUESTIONS"
  | "UNSUPPORTED_INTERVAL"
  | "UNSUPPORTED_PRICE"
  | "UNSUPPORTED_WARRANTY"
  | "UNSUPPORTED_SAFETY_CLAIM"
  | "OVERSTATED_COMPLETENESS"
  | "REVIEW_DATE_INVENTED"
  | "UNKNOWN_USAGE_ASSUMED";

export type KaiValidationStageName =
  | "schema"
  | "source_reference"
  | "grounding"
  | "confidence"
  | "visibility"
  | "privacy"
  | "asset_domain"
  | "capability_subset"
  | "action_threshold"
  | "no_action_consistency"
  | "non_execution"
  | "language_overclaim";

export interface KaiValidationStageResult {
  stage: KaiValidationStageName;
  passed: boolean;
  error_codes: KaiValidationErrorCode[];
  rejected_claim_ids: string[];
  rejected_observation_ids: string[];
  rejected_step_ids: string[];
  diagnostics: ManifestDiagnostic[];
}

export interface KaiOrchestrationValidationResult extends KaiValidationResult {
  error_codes: KaiValidationErrorCode[];
  stages: KaiValidationStageResult[];
}

export interface KaiProviderMetadata {
  provider_identifier?: string;
  model_identifier?: string;
  request_correlation_id: string;
  latency_ms?: number;
  timed_out: boolean;
  retry_count: number;
  structured_output_mode: "json";
  token_usage?: KaiModelResult["token_usage"];
}

export interface KaiTimingMetadata {
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

export interface KaiRetryMetadata {
  max_attempts: number;
  attempts: number;
  retried: boolean;
  retry_reasons: string[];
}

export type KaiTelemetryEventType =
  | "orchestration_started"
  | "model_call_started"
  | "model_call_completed"
  | "model_call_failed"
  | "retry_started"
  | "parse_failed"
  | "validation_failed"
  | "interpretation_accepted"
  | "fallback_returned"
  | "restricted_short_circuit"
  | "invalid_input_short_circuit";

export interface KaiTelemetryEvent {
  event_type: KaiTelemetryEventType;
  timestamp: string;
  correlation_id: string;
  purpose?: KaiAssetBrief["purpose"];
  asset_type?: string;
  brief_status?: KaiAssetBrief["brief_status"];
  orchestration_status?: KaiOrchestrationStatus;
  provider_identifier?: string;
  model_identifier?: string;
  duration_ms?: number;
  retry_count?: number;
  validation_error_codes?: KaiValidationErrorCode[];
}

export interface KaiInterpretationOrchestrationResult {
  orchestration_version: "1.0";
  generated_at: string;
  purpose?: KaiAssetBrief["purpose"];
  kac?: string;
  canonical_asset_id?: string;
  source_brief_version?: KaiAssetBrief["brief_version"];
  source_brief_status?: KaiAssetBrief["brief_status"];
  orchestration_status: KaiOrchestrationStatus;
  interpretation_source: KaiInterpretationSource;
  accepted_interpretation: KaiInterpretation;
  validation_result: KaiOrchestrationValidationResult;
  fallback_reason?: KaiOrchestrationStatus;
  provider_result_metadata?: KaiProviderMetadata;
  timing_metadata: KaiTimingMetadata;
  retry_metadata: KaiRetryMetadata;
  diagnostics: ManifestDiagnostic[];
  exclusions_and_redactions: KaiAssetBrief["exclusions_and_redactions"];
  provenance_summary: {
    reference_count: number;
    tables: string[];
  };
  telemetry_events: KaiTelemetryEvent[];
}

export interface BuildKaiInterpretationOrchestrationInput {
  brief: KaiAssetBrief;
  provider?: KaiInterpretationModelProvider;
  generated_at?: string;
  correlation_id: string;
  model?: string;
  provider_identifier?: string;
  timeout_ms?: number;
  retry_policy?: {
    max_attempts: number;
  };
  strict?: boolean;
}
