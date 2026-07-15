import { buildKacContextEnvelope } from "./kacContextEnvelope.ts";
import { buildKaiAssetBrief } from "./kaiAssetBrief.ts";
import { orchestrateKaiInterpretation } from "./kaiInterpretationOrchestration.ts";
import { buildKeeprReconciledDecisionContext } from "./kaiAuthorityReconciliation.ts";
import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { KacIntelligenceManifest, ManifestAssociation } from "./kacManifestTypes.ts";
import type {
  Build3AOperationalStatus,
  Build3AOrchestrationInput,
  Build3AResponseContract,
} from "./kacIntelligenceOrchestrationTypes.ts";

export {
  BUILD_3A_CALLABLE_PURPOSES,
  isBuild3ACallablePurpose,
} from "./kacIntelligenceOrchestrationTypes.ts";

function operationalStatus(input: Build3AOrchestrationInput, restricted: boolean, orchestrationStatus: string): Build3AOperationalStatus {
  if (restricted) return "restricted";
  if (orchestrationStatus === "accepted") return "interpreted";
  if (!input.request.model_invocation?.enabled) return "deterministic";
  if (orchestrationStatus === "fallback_model_unavailable") return "unavailable";
  if (orchestrationStatus.startsWith("fallback_")) return "fallback";
  if (orchestrationStatus === "invalid_input" || orchestrationStatus === "unsupported_purpose") return "failed";
  return "fallback";
}

function diagnostics(...groups: (ManifestDiagnostic[] | undefined)[]) {
  return groups.flatMap((group) => group || []).map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source,
    object_type: diagnostic.object_type,
    object_id: diagnostic.object_id,
  }));
}

function maskSerial(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  const suffix = raw.slice(-4);
  return `${"*".repeat(Math.max(4, Math.min(8, raw.length - suffix.length)))}${suffix}`;
}

function isForbiddenMetadataKey(key: string) {
  return [
    "extracted_text",
    "url",
    "signed_url",
    "signedUrl",
    "storage_path",
    "email",
    "phone",
    "address",
    "home_address",
    "work_address",
    "postal_address",
    "dealer_phone",
    "dealer_address",
    "access_token",
    "refresh_token",
    "secret",
    "service_role",
  ].includes(key) ||
    /email/i.test(key) ||
    /phone/i.test(key) ||
    /address/i.test(key) ||
    /token/i.test(key) ||
    /secret/i.test(key) ||
    /signed_?url/i.test(key) ||
    /storage_path/i.test(key);
}

function isForbiddenMetadataValue(value: string) {
  return /extracted_text|signed_?url|storage_path|service_role|access_token|refresh_token|raw sql|stack trace/i.test(value) ||
    /https?:\/\/[^\s"']*(signed|storage|private)[^\s"']*/i.test(value) ||
    /@[a-z0-9.-]+\.[a-z]{2,}/i.test(value) ||
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(value);
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenMetadataKey(key)) continue;
      const safe = sanitizeMetadataValue(nested);
      if (safe !== undefined) clean[key] = safe;
    }
    return clean;
  }
  if (typeof value === "string" && isForbiddenMetadataValue(value)) return undefined;
  return value;
}

function sanitizeAssociation(association: ManifestAssociation): ManifestAssociation {
  const safe_metadata = sanitizeMetadataValue(association.safe_metadata || {}) as Record<string, unknown>;
  if (safe_metadata.kind === "serial_number" && safe_metadata.value) safe_metadata.value = maskSerial(safe_metadata.value);
  if (safe_metadata.serial_number) safe_metadata.serial_number = maskSerial(safe_metadata.serial_number);
  return { ...association, safe_metadata };
}

function regroupAssociations(associations: ManifestAssociation[]) {
  const groups: Record<string, ManifestAssociation[]> = { identity: [], systems: [], timeline: [], attachments: [] };
  for (const association of associations) {
    if (association.source_table === "assets" || association.source_table === "master_assets" || association.source_table === "asset_identifiers") groups.identity.push(association);
    else if (["systems", "vehicle_systems", "boat_systems", "home_systems"].includes(association.source_table || "")) groups.systems.push(association);
    else if (["service_records", "story_events", "timeline_records", "maintenance_events", "service_entries"].includes(association.source_table || "")) groups.timeline.push(association);
    else if (["attachments", "attachment_placements", "attachment_links"].includes(association.source_table || "")) groups.attachments.push(association);
  }
  return groups;
}

function sanitizeManifest(manifest: KacIntelligenceManifest): KacIntelligenceManifest {
  const associations = (manifest.associations || []).map(sanitizeAssociation);
  return {
    ...manifest,
    associations,
    association_groups: regroupAssociations(associations),
  };
}

function telemetryId(input: Build3AOrchestrationInput) {
  return input.request.telemetry_id || `kac3a-${Date.now().toString(36)}`;
}

export async function buildKacIntelligenceOrchestration(
  input: Build3AOrchestrationInput,
): Promise<Build3AResponseContract> {
  const generated_at = input.request.generated_at || new Date().toISOString();
  const telemetry_id = telemetryId(input);
  const manifest = sanitizeManifest(input.request.authorized_manifest);
  const restricted = manifest.status === "restricted";

  const context_envelope = buildKacContextEnvelope({
    manifest,
    purpose: input.request.purpose,
    generated_at,
  });

  const asset_brief = buildKaiAssetBrief({
    envelope: context_envelope,
    generated_at,
  });

  const interpretation = await orchestrateKaiInterpretation({
    brief: asset_brief,
    provider: input.request.model_invocation?.enabled ? input.request.model_invocation.provider : undefined,
    generated_at,
    correlation_id: telemetry_id,
    provider_identifier: input.request.model_invocation?.provider_identifier,
    model: input.request.model_invocation?.model,
    timeout_ms: input.request.model_invocation?.timeout_ms,
    retry_policy: { max_attempts: input.request.model_invocation?.max_attempts || 1 },
  });

  const authority_reconciliation = buildKeeprReconciledDecisionContext({
    brief: asset_brief,
    stewardship_profile: input.request.stewardship_profile,
    statements: input.request.authority_statements,
    generated_at,
  });

  return {
    response_version: "3A.1",
    generated_at,
    operational_status: operationalStatus(input, restricted, interpretation.orchestration_status),
    kac: manifest.kac,
    purpose: input.request.purpose,
    canonical_asset: {
      id: manifest.asset.id,
      kac_id: manifest.asset.kac_id,
      type: manifest.asset.type,
      lifecycle_state: manifest.asset.lifecycle_state,
      availability: manifest.asset.availability,
    },
    authorization: {
      status: restricted ? "restricted" : "authorized",
      role: manifest.authorization.access,
    },
    manifest: {
      status: manifest.status,
      association_groups: manifest.association_groups,
      exclusions: context_envelope.exclusions_and_redactions,
      collector_summaries: manifest.collector_summaries,
    },
    context_envelope,
    asset_brief,
    interpretation,
    authority_reconciliation,
    highest_value_next_question: asset_brief.highest_value_next_question,
    permitted_capabilities: asset_brief.permitted_next_capabilities,
    provenance_references: context_envelope.provenance_references,
    confidence_summary: context_envelope.evidence_confidence_summary,
    diagnostics: diagnostics(manifest.diagnostics, context_envelope.diagnostics, asset_brief.diagnostics, interpretation.diagnostics, authority_reconciliation.diagnostics),
    telemetry_id,
  };
}
