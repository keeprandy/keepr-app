import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type {
  CallableBuild2BBriefPurpose,
  KaiAssetBrief,
  KaiBriefVisibility,
  KaiCapabilityKey,
} from "./kaiAssetBriefTypes.ts";

export type KaiInterpretationPurpose = KaiAssetBrief["purpose"];

export const CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES = [
  "asset_stewardship",
  "maintenance_planning",
] as const;

export type CallableBuild2CInterpretationPurpose = typeof CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES[number];

export function isCallableBuild2CInterpretationPurpose(
  purpose: string | null | undefined,
): purpose is CallableBuild2CInterpretationPurpose {
  return CALLABLE_BUILD_2C_INTERPRETATION_PURPOSES.includes(purpose as CallableBuild2CInterpretationPurpose);
}

export type KaiInterpretationStatus =
  | "complete"
  | "partial"
  | "restricted"
  | "needs_clarification"
  | "invalid"
  | "unavailable";

export type KaiObservationCategory =
  | "identity"
  | "systems"
  | "history"
  | "evidence"
  | "maintenance"
  | "continuity"
  | "privacy"
  | "capability";

export type KaiObservationPriority = "informational" | "attention" | "important";
export type KaiObservationConfidence = "verified" | "supported" | "reported" | "missing" | "conflicting" | "not_visible" | "not_applicable";

export type KaiPlanStepType =
  | "review_existing_evidence"
  | "add_missing_evidence"
  | "confirm_asset_or_system_identity"
  | "clarify_unresolved_state"
  | "review_maintenance_history"
  | "build_maintenance_plan"
  | "request_service"
  | "ask_kai"
  | "create_asset_brief"
  | "create_report";

export interface KaiObservation {
  observation_id: string;
  title: string;
  explanation: string;
  category: KaiObservationCategory;
  priority: KaiObservationPriority;
  confidence: KaiObservationConfidence;
  source_fact_ids: string[];
  source_gap_ids: string[];
  source_readiness_dimensions: string[];
  visibility_classification: KaiBriefVisibility;
}

export interface KaiPlanStep {
  step_id: string;
  title: string;
  explanation: string;
  step_type: KaiPlanStepType;
  priority: KaiObservationPriority;
  status: "proposed";
  related_system_id?: string;
  related_gap_id?: string;
  required_capability: KaiCapabilityKey;
  source_references: ContextProvenanceReference[];
  evidence_requirement?: string;
  owner_confirmation_required: boolean;
}

export interface KaiProposedPlan {
  plan_title: string;
  plan_purpose: CallableBuild2BBriefPurpose;
  plan_status:
    | "action_proposed"
    | "no_action_required"
    | "needs_clarification"
    | "restricted"
    | "invalid"
    | "unavailable";
  rationale: string;
  supporting_evidence: ContextProvenanceReference[];
  evidence_limitations: string[];
  reassessment_conditions: string[];
  next_review_milestone?: string;
  ordered_steps: KaiPlanStep[];
  unresolved_dependencies: string[];
  plan_limitations: string[];
  permitted_capabilities_used: KaiCapabilityKey[];
  provenance_references: ContextProvenanceReference[];
}

export interface KaiFollowUpQuestion {
  question: string;
  source_gap_id?: string;
  why_this_question?: string;
  provenance_references: ContextProvenanceReference[];
}

export interface KaiValidationResult {
  valid: boolean;
  error_codes: string[];
  rejected_claims: string[];
  rejected_plan_steps: string[];
  diagnostics: ManifestDiagnostic[];
}

export interface KaiModelInput {
  system_prompt: string;
  brief: Pick<
    KaiAssetBrief,
    | "brief_version"
    | "purpose"
    | "kac"
    | "canonical_asset_id"
    | "asset_display_identity"
    | "asset_type"
    | "lifecycle_state"
    | "source_envelope_status"
    | "brief_status"
    | "headline"
    | "subheadline"
    | "current_state_summary"
    | "known_facts"
    | "missing_or_uncertain_facts"
    | "recent_updates"
    | "attention_items"
    | "readiness_cards"
    | "evidence_summary"
    | "unresolved_states"
    | "highest_value_next_question"
    | "permitted_next_capabilities"
    | "provenance_references"
    | "visibility_classification"
    | "exclusions_and_redactions"
  >;
}

export interface KaiModelRequest {
  input: KaiModelInput;
  timeout_ms: number;
  model: string;
  retry_policy: {
    max_attempts: number;
  };
}

export interface KaiModelResult {
  ok: boolean;
  output?: unknown;
  raw_text?: string;
  model?: string;
  token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  failure_state?: "unavailable" | "timeout" | "invalid_json" | "provider_error";
  diagnostics?: ManifestDiagnostic[];
}

export interface KaiInterpretationModelProvider {
  generateStructured(request: KaiModelRequest): Promise<KaiModelResult>;
}

export interface BuildKaiInterpretationInput {
  brief: KaiAssetBrief;
  provider?: KaiInterpretationModelProvider;
  generated_at?: string;
  model?: string;
  timeout_ms?: number;
  retry_policy?: {
    max_attempts: number;
  };
}

export interface KaiInterpretation {
  interpretation_version: "1.0";
  generated_at: string;
  purpose: CallableBuild2BBriefPurpose;
  kac: string;
  canonical_asset_id: string;
  source_brief_version: KaiAssetBrief["brief_version"];
  source_brief_status: KaiAssetBrief["brief_status"];
  interpretation_status: KaiInterpretationStatus;
  summary: string;
  prioritized_observations: KaiObservation[];
  current_risks_or_concerns: KaiObservation[];
  evidence_limitations: string[];
  follow_up_question?: KaiFollowUpQuestion;
  proposed_plan: KaiProposedPlan;
  source_references: ContextProvenanceReference[];
  capability_references: KaiCapabilityKey[];
  exclusions_and_redactions: KaiAssetBrief["exclusions_and_redactions"];
  validation_result: KaiValidationResult;
  diagnostics: ManifestDiagnostic[];
}
