import type {
  KacIntelligenceManifest,
  ManifestAccessKind,
  ManifestDiagnostic,
  ManifestGenerationStatus,
  ManifestAssociation,
  KnowledgeGap,
} from "./kacManifestTypes.ts";

export type ContextEnvelopePurpose =
  | "asset_stewardship"
  | "maintenance_planning"
  | "pre_purchase"
  | "sale_readiness"
  | "transfer_readiness"
  | "insurance_readiness"
  | "warranty_review"
  | "annual_stewardship_review";

export const CALLABLE_BUILD_2A_CONTEXT_PURPOSES = [
  "asset_stewardship",
  "maintenance_planning",
] as const;

export type CallableBuild2AContextPurpose = typeof CALLABLE_BUILD_2A_CONTEXT_PURPOSES[number];

export function isCallableBuild2AContextPurpose(
  purpose: string | null | undefined,
): purpose is CallableBuild2AContextPurpose {
  return CALLABLE_BUILD_2A_CONTEXT_PURPOSES.includes(purpose as CallableBuild2AContextPurpose);
}

export type ContextEnvelopeStatus = ManifestGenerationStatus;

export type EvidenceConfidenceState =
  | "verified"
  | "supported"
  | "reported"
  | "missing"
  | "conflicting"
  | "not_visible"
  | "not_applicable";

export type ReadinessStatus = "ready" | "partial" | "attention" | "unknown" | "restricted";

export interface ContextProvenanceReference {
  association_id?: string;
  table?: string;
  row_id?: string;
  field?: string;
  note?: string;
}

export interface ContextFactRef {
  id: string;
  label: string;
  source_association_id?: string;
  source_table?: string;
  source_record_id?: string;
  scope?: "kac_specific" | "horizontal";
  effective_from?: string | null;
  effective_to?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  state?: string | null;
  confidence_state?: EvidenceConfidenceState;
  metadata?: Record<string, unknown>;
  provenance?: ContextProvenanceReference[];
}

export interface EvidenceConfidenceSummary {
  verified_fact_count: number;
  supported_fact_count: number;
  reported_only_fact_count: number;
  missing_evidence_count: number;
  conflict_count: number;
  hidden_domain_count: number;
  not_applicable_count: number;
}

export interface ReadinessDimension {
  dimension:
    | "identity"
    | "systems"
    | "history"
    | "evidence"
    | "maintenance"
    | "continuity";
  status: ReadinessStatus;
  supporting_facts: string[];
  blocking_gaps: string[];
  source_references: ContextProvenanceReference[];
}

export interface ContextExclusion {
  reason:
    | "not_visible"
    | "irrelevant_to_purpose"
    | "restricted_source_manifest"
    | "redacted_sensitive_field";
  count: number;
  details?: string[];
}

export interface PermittedNextCapabilities {
  can_ask_kai: boolean;
  can_review_gaps: boolean;
  can_build_maintenance_plan: boolean;
  can_create_asset_brief: boolean;
  can_add_evidence: boolean;
  can_request_service: boolean;
  can_create_report: boolean;
}

export interface KacContextEnvelope {
  envelope_version: "1.0";
  generated_at: string;
  purpose: CallableBuild2AContextPurpose;
  kac: string;
  canonical_asset_id: string;
  asset_type?: string;
  lifecycle_state?: string;
  caller_authorization_role: ManifestAccessKind;
  source_manifest_status: ManifestGenerationStatus;
  context_status: ContextEnvelopeStatus;
  identity_summary: {
    kac: string;
    canonical_asset_id: string;
    asset_type?: string;
    lifecycle_state?: string;
    availability?: string;
    identity_facts: ContextFactRef[];
  };
  relevant_systems: ContextFactRef[];
  relevant_normalized_events: ContextFactRef[];
  relevant_evidence: ContextFactRef[];
  evidence_confidence_summary: EvidenceConfidenceSummary;
  deterministic_knowledge_gaps: KnowledgeGap[];
  readiness_dimensions: ReadinessDimension[];
  recently_changed_facts: ContextFactRef[];
  current_unresolved_states: ContextFactRef[];
  permitted_next_capabilities: PermittedNextCapabilities;
  provenance_references: ContextProvenanceReference[];
  exclusions_and_redactions: ContextExclusion[];
  diagnostics: ManifestDiagnostic[];
}

export interface BuildContextEnvelopeInput {
  manifest: KacIntelligenceManifest;
  purpose: CallableBuild2AContextPurpose;
  generated_at?: string;
}
