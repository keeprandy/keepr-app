import type { KacIntelligenceManifest, ManifestAccessKind, ManifestDiagnostic, ManifestGenerationStatus } from "./kacManifestTypes.ts";
import type { CallableBuild2AContextPurpose, EvidenceConfidenceSummary, KacContextEnvelope } from "./kacContextEnvelopeTypes.ts";
import type { KaiAssetBrief, KaiCapabilityEntry, KaiNextQuestion } from "./kaiAssetBriefTypes.ts";
import type { KaiInterpretationModelProvider } from "./kaiInterpretationTypes.ts";
import type { KaiInterpretationOrchestrationResult } from "./kaiInterpretationOrchestrationTypes.ts";
import type { KeeprAuthorityStatement, KeeprReconciledDecisionContext, KeeprStewardshipProfile } from "./kaiAuthorityTypes.ts";

export const BUILD_3A_CALLABLE_PURPOSES = [
  "asset_stewardship",
  "maintenance_planning",
] as const;

export type Build3ACallablePurpose = typeof BUILD_3A_CALLABLE_PURPOSES[number];

export function isBuild3ACallablePurpose(purpose: string | null | undefined): purpose is Build3ACallablePurpose {
  return BUILD_3A_CALLABLE_PURPOSES.includes(purpose as Build3ACallablePurpose);
}

export type Build3AOperationalStatus =
  | "deterministic"
  | "interpreted"
  | "fallback"
  | "restricted"
  | "unavailable"
  | "failed";

export interface Build3AAuthenticatedCallerContext {
  authenticated: true;
  user_id?: string;
  authorization_role: ManifestAccessKind;
}

export interface Build3AModelInvocation {
  enabled: boolean;
  provider?: KaiInterpretationModelProvider;
  provider_identifier?: string;
  model?: string;
  timeout_ms?: number;
  max_attempts?: 1 | 2;
}

export interface Build3ARequestContract {
  request_version: "3A.0";
  kac: string;
  purpose: Build3ACallablePurpose;
  caller: Build3AAuthenticatedCallerContext;
  authorized_manifest: KacIntelligenceManifest;
  model_invocation?: Build3AModelInvocation;
  stewardship_profile?: KeeprStewardshipProfile;
  authority_statements?: KeeprAuthorityStatement[];
  generated_at?: string;
  telemetry_id?: string;
}

export interface Build3AResponseContract {
  response_version: "3A.1";
  generated_at: string;
  operational_status: Build3AOperationalStatus;
  kac: string;
  purpose: Build3ACallablePurpose;
  canonical_asset: {
    id: string;
    kac_id: string;
    type?: string;
    lifecycle_state?: string;
    availability?: string;
  };
  authorization: {
    status: "authorized" | "restricted" | "concealed";
    role: ManifestAccessKind;
  };
  manifest: {
    status: ManifestGenerationStatus;
    association_groups: KacIntelligenceManifest["association_groups"];
    exclusions: KacContextEnvelope["exclusions_and_redactions"];
    collector_summaries: KacIntelligenceManifest["collector_summaries"];
  };
  context_envelope: KacContextEnvelope;
  asset_brief: KaiAssetBrief;
  interpretation: KaiInterpretationOrchestrationResult;
  authority_reconciliation: KeeprReconciledDecisionContext;
  highest_value_next_question: KaiNextQuestion;
  permitted_capabilities: KaiCapabilityEntry[];
  provenance_references: KacContextEnvelope["provenance_references"];
  confidence_summary: EvidenceConfidenceSummary;
  diagnostics: ManifestDiagnostic[];
  telemetry_id: string;
}

export interface Build3AOrchestrationInput {
  request: Build3ARequestContract;
}
