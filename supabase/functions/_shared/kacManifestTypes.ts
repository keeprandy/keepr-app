export type ManifestPurpose =
  | "asset_overview"
  | "admin_diagnostic"
  | "answer_question"
  | "build_plan"
  | "prepare_transfer"
  | "export";

export const CALLABLE_V1_MANIFEST_PURPOSES = [
  "asset_overview",
  "admin_diagnostic",
] as const;

export type CallableV1ManifestPurpose = typeof CALLABLE_V1_MANIFEST_PURPOSES[number];

export function isCallableV1ManifestPurpose(
  purpose: string | null | undefined,
): purpose is CallableV1ManifestPurpose {
  return CALLABLE_V1_MANIFEST_PURPOSES.includes(purpose as CallableV1ManifestPurpose);
}

export type ProcessingStatus =
  | "not_required"
  | "unprocessed"
  | "queued"
  | "processing"
  | "processed"
  | "needs_review"
  | "failed"
  | "not_eligible"
  | "unknown";

export type ProofState =
  | "none"
  | "claimed"
  | "evidence_attached"
  | "verified"
  | "conflicting"
  | "needs_review"
  | "unknown";

export type TransferClassification =
  | "asset_persistent"
  | "owner_private"
  | "transfer_with_approval"
  | "relationship_scoped"
  | "expires_on_transfer"
  | "public"
  | "partner_restricted"
  | "unclassified";

export type SourceAuthority =
  | "owner_reported"
  | "steward_reported"
  | "keepr_pro"
  | "dealer"
  | "oem"
  | "inspector"
  | "warranty_provider"
  | "system_generated"
  | "partner"
  | "public_source"
  | "unknown";

export type EventRole =
  | "moment"
  | "maintenance"
  | "repair"
  | "inspection"
  | "improvement"
  | "modification"
  | "fuel"
  | "usage"
  | "transfer"
  | "unknown";

export type EvidenceRole =
  | "receipt"
  | "invoice"
  | "estimate"
  | "inspection_report"
  | "warranty"
  | "manual"
  | "photo"
  | "service_record"
  | "owner_report"
  | "external_link"
  | "unknown";

export type ParticipantRole =
  | "owner"
  | "steward"
  | "keepr_pro"
  | "dealer"
  | "oem"
  | "inspector"
  | "prior_owner"
  | "warranty_provider"
  | "unknown";

export type WorkMode =
  | "diy"
  | "pro"
  | "dealer"
  | "oem"
  | "mixed"
  | "unknown";

export type ManifestDiagnosticSeverity = "info" | "warning" | "error";

export interface ManifestDiagnostic {
  code: string;
  severity: ManifestDiagnosticSeverity;
  message: string;
  source?: string;
  object_type?: string;
  object_id?: string;
}

export interface KnowledgeGap {
  id: string;
  category:
    | "identity"
    | "usage"
    | "systems"
    | "relationships"
    | "evidence"
    | "processing"
    | "conflict"
    | "transfer"
    | "state";
  question: string;
  priority: "low" | "medium" | "high";
  related_association_ids?: string[];
  blocks_purpose?: ManifestPurpose[];
}

export interface ManifestAssociation {
  association_id: string;
  object_id: string;
  object_type: string;
  source_table?: string;
  source_service?: string;
  relationship_type: string;
  scope: "kac_specific" | "horizontal";
  event_role?: EventRole;
  evidence_role?: EvidenceRole;
  participant_role?: ParticipantRole;
  work_mode?: WorkMode;
  affected_system_id?: string | null;
  source_authority?: SourceAuthority;
  proof_state: ProofState;
  confidence?: number | null;
  processing_status: ProcessingStatus;
  visibility?: "private" | "shared" | "public" | "partner_restricted" | "unknown";
  transfer_classification: TransferClassification;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  provenance?: {
    table?: string;
    row_id?: string;
    field?: string;
    note?: string;
  }[];
}

export interface KacIntelligenceManifest {
  manifest_version: "1.0";
  generated_at: string;
  purpose: CallableV1ManifestPurpose;
  kac: string;
  asset: {
    id: string;
    kac_id: string;
    name?: string;
    type?: string;
    status?: string | null;
    asset_mode?: string | null;
  };
  authorization: {
    requester_user_id?: string;
    access:
      | "owner"
      | "direct_steward"
      | "org_steward"
      | "viewer"
      | "unauthorized";
    access_role: "owner" | "steward" | "viewer" | null;
  };
  associations: ManifestAssociation[];
  knowledge_gaps: KnowledgeGap[];
  diagnostics: ManifestDiagnostic[];
}
