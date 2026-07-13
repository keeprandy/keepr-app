import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type {
  KaiAssetBrief,
  KaiBriefVisibility,
  KaiCapabilityEntry,
} from "./kaiAssetBriefTypes.ts";

export type KeeprAuthorityClass =
  | "documented_fact"
  | "manufacturer_requirement"
  | "warranty_obligation"
  | "legal_or_compliance_requirement"
  | "professional_finding"
  | "professional_recommendation"
  | "standard_service_practice"
  | "owner_report"
  | "owner_preference"
  | "kai_interpretation"
  | "generic_asset_class_context";

export type KeeprRequirementStrength =
  | "mandatory"
  | "required_for_warranty"
  | "professionally_recommended"
  | "customary"
  | "owner_preferred"
  | "optional"
  | "informational"
  | "unknown";

export type KeeprApplicability =
  | "applies"
  | "conditionally_applies"
  | "does_not_apply"
  | "insufficient_evidence"
  | "expired"
  | "superseded"
  | "disputed";

export type KeeprStatementType =
  | "fact"
  | "requirement"
  | "obligation"
  | "finding"
  | "recommendation"
  | "practice"
  | "report"
  | "preference"
  | "interpretation"
  | "context";

export type KeeprAssetSpecificity = "asset_specific" | "model_specific" | "class_context" | "unknown";
export type KeeprStatementConfidence = "verified" | "supported" | "reported" | "missing" | "conflicting" | "unknown";
export type KeeprEvidenceState = "attached" | "attested" | "reported" | "missing" | "not_required" | "unknown";
export type KeeprDisputeStatus = "none" | "disputed" | "conflicting" | "needs_clarification";
export type KeeprSupersessionStatus = "current" | "superseded" | "expired" | "unknown";

export type KeeprOwnerDecision =
  | "approved"
  | "deferred"
  | "declined"
  | "awaiting_explanation"
  | "conditionally_accepted"
  | "not_applicable"
  | "superseded"
  | "completed_elsewhere";

export type KeeprActionJustificationStatus =
  | "action_required"
  | "action_supported"
  | "action_optional"
  | "clarification_required"
  | "professional_assessment_required"
  | "owner_decision_required"
  | "no_action_required"
  | "insufficient_evidence"
  | "conflict_unresolved";

export type KeeprGapPriority = "decision_blocking" | "important" | "useful" | "nice_to_have" | "irrelevant_to_current_purpose";

export interface KeeprAuthorityStatement {
  statement_id: string;
  statement_type: KeeprStatementType;
  title: string;
  statement: string;
  authority_class: KeeprAuthorityClass;
  source_role: string;
  source_identity_ref?: string;
  asset_specificity: KeeprAssetSpecificity;
  confidence: KeeprStatementConfidence;
  evidence_state: KeeprEvidenceState;
  applicability: KeeprApplicability;
  requirement_strength: KeeprRequirementStrength;
  effective_date?: string | null;
  expiration_date?: string | null;
  related_system_id?: string | null;
  related_service_event_id?: string | null;
  related_warranty_id?: string | null;
  source_references: ContextProvenanceReference[];
  visibility_classification: KaiBriefVisibility;
  purpose_relevance: "direct" | "supporting" | "background" | "not_relevant";
  dispute_status: KeeprDisputeStatus;
  supersession_status: KeeprSupersessionStatus;
  owner_decision?: KeeprOwnerDecision;
  sanitized_notes?: string[];
}

export interface KeeprStewardshipProfile {
  profile_scope: "owner_default" | "asset_specific";
  maintenance_philosophy?: "condition_based" | "interval_based" | "proactive" | "minimum_required" | "preservation_focused";
  interval_preference?: "manufacturer" | "professional_guidance" | "condition_or_usage" | "owner_selected" | "unknown";
  prevention_preference?: "high" | "moderate" | "low" | "unknown";
  seasonal_use_preference?: "seasonal" | "year_round" | "storage_first" | "unknown";
  low_use_treatment?: "defer_without_trigger" | "follow_calendar" | "ask_for_usage" | "unknown";
  preservation_priority?: "high" | "moderate" | "low" | "unknown";
  originality_priority?: "high" | "moderate" | "low" | "unknown";
  cost_sensitivity?: "high" | "moderate" | "low" | "unknown";
  diy_vs_professional_preference?: "diy" | "professional" | "mixed" | "unknown";
  preferred_authority_weighting?: KeeprAuthorityClass[];
  risk_tolerance?: "low" | "moderate" | "high" | "unknown";
  reminder_preference?: "none" | "owner_selected" | "obligation_only" | "unknown";
  do_not_manufacture_activity: boolean;
  source_references: ContextProvenanceReference[];
  effective_date?: string | null;
  owner_confirmed: boolean;
}

export interface KeeprAuthorityConflict {
  conflict_id: string;
  statement_ids: string[];
  conflict_type:
    | "manufacturer_vs_shop_practice"
    | "recommendation_vs_owner_preference"
    | "finding_vs_kai_interpretation"
    | "warranty_vs_owner_deferral"
    | "owner_report_vs_usage"
    | "pro_recommendation_conflict"
    | "expired_requirement_presented_current"
    | "standard_practice_presented_mandatory"
    | "generic_guidance_presented_asset_specific"
    | "unknown";
  materiality: "high" | "medium" | "low";
  explanation: string;
  owner_decision_required: boolean;
  clarification_needed?: string;
  preferred_resolution_path: string;
  source_references: ContextProvenanceReference[];
}

export interface KeeprReconciledDecisionContext {
  reconciliation_version: "1.0";
  generated_at: string;
  purpose: KaiAssetBrief["purpose"];
  kac: string;
  canonical_asset_id: string;
  asset_type?: string;
  statements_considered: KeeprAuthorityStatement[];
  aligned_statements: KeeprAuthorityStatement[];
  conflicting_statements: KeeprAuthorityConflict[];
  unresolved_statements: KeeprAuthorityStatement[];
  owner_preference_context: KeeprAuthorityStatement[];
  professional_input_context: KeeprAuthorityStatement[];
  authoritative_requirement_context: KeeprAuthorityStatement[];
  kai_synthesis: string;
  action_justification_status: KeeprActionJustificationStatus;
  no_action_justification_status?: "supported" | "not_supported" | "insufficient_evidence";
  owner_decision_required: boolean;
  recommended_question?: string;
  permitted_capabilities: KaiCapabilityEntry[];
  provenance: ContextProvenanceReference[];
  visibility: KaiBriefVisibility;
  semantic_facts: string[];
  prioritized_gaps: Array<{
    gap_id: string;
    label: string;
    priority: KeeprGapPriority;
    reason: string;
  }>;
  diagnostics: ManifestDiagnostic[];
}

export interface BuildKeeprReconciledDecisionInput {
  brief: KaiAssetBrief;
  stewardship_profile?: KeeprStewardshipProfile;
  statements?: KeeprAuthorityStatement[];
  generated_at?: string;
}
