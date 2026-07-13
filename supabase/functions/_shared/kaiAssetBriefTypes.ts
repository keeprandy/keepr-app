import type { ManifestAccessKind, ManifestDiagnostic } from "./kacManifestTypes.ts";
import type {
  CallableBuild2AContextPurpose,
  ContextEnvelopePurpose,
  ContextFactRef,
  ContextProvenanceReference,
  EvidenceConfidenceState,
  KacContextEnvelope,
  PermittedNextCapabilities,
  ReadinessStatus,
} from "./kacContextEnvelopeTypes.ts";

export type KaiAssetBriefPurpose = ContextEnvelopePurpose;

export const CALLABLE_BUILD_2B_BRIEF_PURPOSES = [
  "asset_stewardship",
  "maintenance_planning",
] as const;

export type CallableBuild2BBriefPurpose = typeof CALLABLE_BUILD_2B_BRIEF_PURPOSES[number];

export function isCallableBuild2BBriefPurpose(
  purpose: string | null | undefined,
): purpose is CallableBuild2BBriefPurpose {
  return CALLABLE_BUILD_2B_BRIEF_PURPOSES.includes(purpose as CallableBuild2BBriefPurpose);
}

export type KaiBriefStatus = "complete" | "partial" | "restricted" | "attention" | "unknown";
export type KaiBriefVisibility = "owner_private" | "shareable" | "public_candidate" | "restricted";
export type KaiBriefFactScope = "kac_specific" | "horizontal";
export type KaiBriefFactCategory =
  | "identity"
  | "systems"
  | "history"
  | "evidence"
  | "maintenance"
  | "warranty"
  | "continuity"
  | "recent_change";
export type KaiBriefGapCategory = "identity" | "systems" | "history" | "evidence" | "maintenance" | "continuity";
export type KaiBriefUpdateCategory =
  | "service_added"
  | "attachment_added"
  | "document_processed"
  | "system_added"
  | "warranty_added"
  | "finding_opened"
  | "finding_resolved"
  | "lifecycle_changed"
  | "evidence_state_changed";
export type KaiAttentionSeverity = "informational" | "attention" | "important";
export type KaiCapabilityKey = keyof PermittedNextCapabilities;

export interface KaiAssetDisplayIdentity {
  label: string;
  kac: string;
  canonical_asset_id: string;
  primary_identifier_kind?: string;
  primary_identifier_value?: string;
  identifier_visibility: KaiBriefVisibility;
}

export interface KaiCurrentStateSummary {
  identity: string;
  systems: string;
  history: string;
  evidence: string;
  maintenance: string;
  continuity: string;
}

export interface KaiKnownFact {
  id: string;
  label: string;
  value: string;
  category: KaiBriefFactCategory;
  confidence_state: EvidenceConfidenceState;
  effective_date?: string | null;
  source_reference?: ContextProvenanceReference;
  provenance: ContextProvenanceReference[];
  scope: KaiBriefFactScope;
  visibility: KaiBriefVisibility;
}

export interface KaiMissingOrUncertainFact {
  id: string;
  gap_type: string;
  category: KaiBriefGapCategory;
  label: string;
  why_it_matters: string;
  blocking: boolean;
  related_system_id?: string;
  related_event_id?: string;
  source_gap_id: string;
  provenance: ContextProvenanceReference[];
  user_can_resolve: boolean;
  visibility: KaiBriefVisibility;
}

export interface KaiRecentUpdate {
  id: string;
  title: string;
  timestamp: string;
  category: KaiBriefUpdateCategory;
  related_system_id?: string;
  provenance: ContextProvenanceReference[];
  visibility: KaiBriefVisibility;
}

export interface KaiAttentionItem {
  id: string;
  title: string;
  explanation: string;
  severity: KaiAttentionSeverity;
  related_system_id?: string;
  source_reference?: ContextProvenanceReference;
  permitted_capabilities: Partial<Record<KaiCapabilityKey, boolean>>;
  visibility: KaiBriefVisibility;
}

export interface KaiReadinessCard {
  dimension: "identity" | "systems" | "history" | "evidence" | "maintenance" | "continuity";
  title: string;
  status: ReadinessStatus;
  summary: string;
  supporting_fact_count: number;
  blocking_gap_count: number;
  can_review_details: boolean;
  visibility: KaiBriefVisibility;
}

export interface KaiNextQuestion {
  question: string;
  related_gap_id?: string;
  priority_reason:
    | "critical_identity_conflict"
    | "blocking_maintenance_evidence_gap"
    | "unresolved_safety_or_inspection_finding"
    | "missing_primary_system_identity"
    | "missing_latest_service_proof"
    | "missing_warranty_evidence"
    | "highest_impact_continuity_gap"
    | "no_open_question";
  visibility: KaiBriefVisibility;
}

export interface KaiCapabilityEntry {
  key: KaiCapabilityKey;
  label: string;
  enabled: boolean;
}

export interface KaiSectionVisibility {
  section:
    | "identity"
    | "known_facts"
    | "missing_or_uncertain_facts"
    | "recent_updates"
    | "attention_items"
    | "readiness_cards"
    | "evidence_summary"
    | "capabilities"
    | "diagnostics";
  classification: KaiBriefVisibility;
}

export interface BuildKaiAssetBriefInput {
  envelope: KacContextEnvelope;
  generated_at?: string;
}

export interface KaiAssetBrief {
  brief_version: "1.0";
  generated_at: string;
  purpose: CallableBuild2AContextPurpose;
  kac: string;
  canonical_asset_id: string;
  asset_display_identity: KaiAssetDisplayIdentity;
  asset_type?: string;
  lifecycle_state?: string;
  caller_authorization_role: ManifestAccessKind;
  source_envelope_status: KacContextEnvelope["context_status"];
  brief_status: KaiBriefStatus;
  headline: string;
  subheadline: string;
  current_state_summary: KaiCurrentStateSummary;
  known_facts: KaiKnownFact[];
  missing_or_uncertain_facts: KaiMissingOrUncertainFact[];
  recent_updates: KaiRecentUpdate[];
  attention_items: KaiAttentionItem[];
  readiness_cards: KaiReadinessCard[];
  evidence_summary: KacContextEnvelope["evidence_confidence_summary"];
  unresolved_states: ContextFactRef[];
  highest_value_next_question: KaiNextQuestion;
  permitted_next_capabilities: KaiCapabilityEntry[];
  provenance_references: ContextProvenanceReference[];
  visibility_classification: KaiSectionVisibility[];
  diagnostics: ManifestDiagnostic[];
  exclusions_and_redactions: KacContextEnvelope["exclusions_and_redactions"];
}
