import type {
  KacIntelligenceManifest,
  ManifestAssociation,
  ManifestDiagnostic,
  KnowledgeGap,
} from "./kacManifestTypes.ts";
import type {
  BuildContextEnvelopeInput,
  ContextEnvelopePurpose,
  ContextFactRef,
  ContextProvenanceReference,
  EvidenceConfidenceState,
  KacContextEnvelope,
  ReadinessDimension,
  ReadinessStatus,
} from "./kacContextEnvelopeTypes.ts";
export {
  CALLABLE_BUILD_2A_CONTEXT_PURPOSES,
  isCallableBuild2AContextPurpose,
} from "./kacContextEnvelopeTypes.ts";

const FORBIDDEN_METADATA_KEYS = new Set([
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
]);

const SYSTEM_TABLES = new Set(["systems", "vehicle_systems", "boat_systems", "home_systems"]);
const TIMELINE_TABLES = new Set(["service_records", "story_events", "timeline_records", "maintenance_events", "service_entries"]);
const EVIDENCE_TABLES = new Set(["attachments", "attachment_placements", "attachment_links", "service_record_documents", "service_record_photos", "service_photos"]);

function sanitizeMetadata(input: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !FORBIDDEN_METADATA_KEYS.has(key)
    ),
  );
}

function provenanceFor(association: ManifestAssociation): ContextProvenanceReference[] {
  const refs = (association.provenance || []).map((p) => ({
    association_id: association.association_id,
    table: p.table,
    row_id: p.row_id,
    field: p.field,
    note: p.note,
  }));
  if (!refs.length && (association.source_table || association.object_id)) {
    refs.push({
      association_id: association.association_id,
      table: association.source_table,
      row_id: association.object_id,
    });
  }
  return refs;
}

function evidenceState(association: ManifestAssociation): EvidenceConfidenceState {
  if (association.proof_state === "verified") return "verified";
  if (association.proof_state === "evidence_attached") return "supported";
  if (association.proof_state === "conflicting") return "conflicting";
  if (association.proof_state === "none" || association.proof_state === "unknown" || association.proof_state === "needs_review") return "missing";
  if (association.proof_state === "claimed") return "reported";
  return "not_applicable";
}

function labelFor(association: ManifestAssociation) {
  const metadata = association.safe_metadata || {};
  return String(
    metadata.title ||
    metadata.name ||
    metadata.kind ||
    metadata.system_type ||
    metadata.doc_type ||
    association.object_type ||
    association.association_id
  );
}

function factFromAssociation(association: ManifestAssociation): ContextFactRef {
  return {
    id: association.association_id,
    label: labelFor(association),
    source_association_id: association.association_id,
    source_table: association.source_table,
    source_record_id: association.object_id,
    scope: association.scope,
    effective_from: association.effective_from,
    effective_to: association.effective_to,
    created_at: association.created_at,
    updated_at: association.updated_at,
    state: association.safe_metadata?.status as string | null | undefined,
    confidence_state: evidenceState(association),
    metadata: sanitizeMetadata(association.safe_metadata),
    provenance: provenanceFor(association),
  };
}

function uniqueAssociations(associations: ManifestAssociation[]) {
  const byId = new Map<string, ManifestAssociation>();
  for (const association of associations) {
    if (!byId.has(association.association_id)) byId.set(association.association_id, association);
  }
  return [...byId.values()];
}

function isSystem(association: ManifestAssociation) {
  return SYSTEM_TABLES.has(association.source_table || "") || association.relationship_type.includes("system");
}

function isTimeline(association: ManifestAssociation) {
  return TIMELINE_TABLES.has(association.source_table || "") ||
    Boolean(association.event_role) ||
    Boolean(association.event_roles?.length);
}

function isEvidence(association: ManifestAssociation) {
  return EVIDENCE_TABLES.has(association.source_table || "") ||
    Boolean(association.evidence_role) ||
    Boolean(association.evidence_roles?.length);
}

function isMaintenanceRelevant(association: ManifestAssociation) {
  const roles = new Set([association.event_role, ...(association.event_roles || [])].filter(Boolean));
  return roles.has("maintenance") ||
    roles.has("repair") ||
    roles.has("inspection") ||
    roles.has("usage") ||
    ["service_records", "maintenance_events", "service_entries", "timeline_records"].includes(association.source_table || "");
}

function associationsForPurpose(manifest: KacIntelligenceManifest, purpose: ContextEnvelopePurpose) {
  const visible = uniqueAssociations(manifest.associations || []);
  if (purpose === "maintenance_planning") {
    return visible.filter((association) =>
      association.object_type === "asset" ||
      association.object_type === "asset_identifier" ||
      isSystem(association) ||
      isMaintenanceRelevant(association) ||
      isEvidence(association)
    );
  }
  return visible.filter((association) =>
    association.object_type === "asset" ||
    association.object_type === "asset_identifier" ||
    isSystem(association) ||
    isTimeline(association) ||
    isEvidence(association) ||
    association.relationship_type.includes("steward") ||
    association.relationship_type.includes("warranty")
  );
}

function hiddenDomains(manifest: KacIntelligenceManifest) {
  return (manifest.collector_summaries || [])
    .filter((summary) => summary.status === "not_visible")
    .map((summary) => summary.collector);
}

function sanitizedDiagnostics(manifest: KacIntelligenceManifest, purpose: ContextEnvelopePurpose, relevantCount: number): ManifestDiagnostic[] {
  const diagnostics: ManifestDiagnostic[] = [];
  if (manifest.status === "partial") {
    diagnostics.push({ code: "partial_source_manifest", severity: "warning", message: "The source Manifest is partial." });
  }
  if (manifest.status === "restricted") {
    diagnostics.push({ code: "restricted_source_manifest", severity: "warning", message: "The source Manifest is restricted." });
  }
  if (!manifest.asset?.id || !manifest.kac) {
    diagnostics.push({ code: "missing_required_identity", severity: "error", message: "Required canonical identity is missing." });
  }
  for (const domain of hiddenDomains(manifest)) {
    diagnostics.push({ code: "associations_excluded_due_to_visibility", severity: "warning", message: `Some ${domain} context is not visible to this caller.` });
  }
  if (!relevantCount && manifest.status !== "restricted") {
    diagnostics.push({ code: "associations_excluded_as_irrelevant_to_purpose", severity: "info", message: `No relevant associations were selected for ${purpose}.` });
  }
  return diagnostics;
}

function evidenceSummary(associations: ManifestAssociation[], hiddenCount: number) {
  const counts = {
    verified_fact_count: 0,
    supported_fact_count: 0,
    reported_only_fact_count: 0,
    missing_evidence_count: 0,
    conflict_count: 0,
    hidden_domain_count: hiddenCount,
    not_applicable_count: 0,
  };
  for (const association of associations) {
    const state = evidenceState(association);
    if (state === "verified") counts.verified_fact_count += 1;
    else if (state === "supported") counts.supported_fact_count += 1;
    else if (state === "reported") counts.reported_only_fact_count += 1;
    else if (state === "missing") counts.missing_evidence_count += 1;
    else if (state === "conflicting") counts.conflict_count += 1;
    else if (state === "not_applicable") counts.not_applicable_count += 1;
  }
  return counts;
}

function statusForDimension(hasFacts: boolean, blockingGapCount: number, manifestStatus: string, hiddenCount: number): ReadinessStatus {
  if (manifestStatus === "restricted") return "restricted";
  if (hiddenCount) return "partial";
  if (blockingGapCount > 0) return "attention";
  if (hasFacts) return "ready";
  return "unknown";
}

function readiness(
  manifest: KacIntelligenceManifest,
  relevant: ManifestAssociation[],
  systems: ContextFactRef[],
  events: ContextFactRef[],
  evidence: ContextFactRef[],
  gaps: KnowledgeGap[],
): ReadinessDimension[] {
  const refs = relevant.flatMap(provenanceFor);
  const hasIdentity = relevant.some((a) => a.object_type === "asset" || a.object_type === "asset_identifier");
  const hidden = new Set(hiddenDomains(manifest));
  const gapIds = (category: KnowledgeGap["category"]) => gaps.filter((gap) => gap.category === category).map((gap) => gap.id);
  return [
    {
      dimension: "identity",
      status: statusForDimension(hasIdentity, gapIds("identity").length, manifest.status, 0),
      supporting_facts: hasIdentity ? ["canonical identity present"] : [],
      blocking_gaps: gapIds("identity"),
      source_references: refs.filter((r) => r.table === "assets" || r.table === "asset_identifiers"),
    },
    {
      dimension: "systems",
      status: statusForDimension(Boolean(systems.length), gapIds("systems").length, manifest.status, hidden.has("systems") ? 1 : 0),
      supporting_facts: systems.map((system) => system.id),
      blocking_gaps: gapIds("systems"),
      source_references: refs.filter((r) => SYSTEM_TABLES.has(r.table || "")),
    },
    {
      dimension: "history",
      status: statusForDimension(Boolean(events.length), 0, manifest.status, hidden.has("timeline") ? 1 : 0),
      supporting_facts: events.map((event) => event.id),
      blocking_gaps: [],
      source_references: refs.filter((r) => TIMELINE_TABLES.has(r.table || "")),
    },
    {
      dimension: "evidence",
      status: statusForDimension(Boolean(evidence.length), gapIds("evidence").length + gapIds("processing").length, manifest.status, hidden.has("attachments") ? 1 : 0),
      supporting_facts: evidence.map((item) => item.id),
      blocking_gaps: [...gapIds("evidence"), ...gapIds("processing")],
      source_references: refs.filter((r) => EVIDENCE_TABLES.has(r.table || "")),
    },
    {
      dimension: "maintenance",
      status: statusForDimension(events.some((event) => String(event.metadata?.event_roles || event.metadata?.event_role || "").includes("maintenance")), 0, manifest.status, hidden.has("timeline") ? 1 : 0),
      supporting_facts: events.map((event) => event.id),
      blocking_gaps: [],
      source_references: refs.filter((r) => TIMELINE_TABLES.has(r.table || "")),
    },
    {
      dimension: "continuity",
      status: statusForDimension(manifest.asset?.availability === "available", gapIds("transfer").length + gapIds("relationships").length, manifest.status, 0),
      supporting_facts: manifest.asset?.availability === "available" ? ["asset available for continuity context"] : [],
      blocking_gaps: [...gapIds("transfer"), ...gapIds("relationships")],
      source_references: refs,
    },
  ];
}

function recentFacts(facts: ContextFactRef[]) {
  return [...facts]
    .filter((fact) => fact.created_at || fact.updated_at || fact.effective_from)
    .sort((a, b) => String(b.updated_at || b.created_at || b.effective_from).localeCompare(String(a.updated_at || a.created_at || a.effective_from)))
    .slice(0, 12);
}

function unresolvedFacts(facts: ContextFactRef[], gaps: KnowledgeGap[]) {
  const unresolved = facts.filter((fact) =>
    fact.confidence_state === "missing" ||
    fact.confidence_state === "conflicting" ||
    String(fact.state || "").includes("open") ||
    String(fact.state || "").includes("needs")
  );
  return [
    ...unresolved,
    ...gaps.map((gap) => ({
      id: gap.id,
      label: gap.question,
      confidence_state: "missing" as EvidenceConfidenceState,
      metadata: { category: gap.category, priority: gap.priority },
    })),
  ].slice(0, 20);
}

function capabilities(manifest: KacIntelligenceManifest, purpose: ContextEnvelopePurpose, contextStatus: string, systems: ContextFactRef[]) {
  const access = manifest.authorization.access;
  const canUse = ["owner", "direct_steward", "org_steward", "admin"].includes(access) && contextStatus !== "restricted";
  return {
    can_ask_kai: canUse,
    can_review_gaps: canUse && Boolean(manifest.knowledge_gaps?.length),
    can_build_maintenance_plan: canUse && purpose === "maintenance_planning" && Boolean(systems.length),
    can_create_asset_brief: canUse && purpose === "asset_stewardship",
    can_add_evidence: canUse && ["owner", "direct_steward", "org_steward"].includes(access),
    can_request_service: canUse && purpose === "maintenance_planning" && ["owner", "direct_steward", "org_steward"].includes(access),
    can_create_report: false,
  };
}

function contextStatus(manifest: KacIntelligenceManifest) {
  if (manifest.status === "restricted") return "restricted";
  if (manifest.status === "partial") return "partial";
  if ((manifest.collector_summaries || []).some((summary) => !["complete", "complete_empty"].includes(summary.status))) return "partial";
  return "complete";
}

export function buildKacContextEnvelope(input: BuildContextEnvelopeInput): KacContextEnvelope {
  const { manifest, purpose } = input;
  const selected = associationsForPurpose(manifest, purpose);
  const hidden = hiddenDomains(manifest);
  const diagnostics = sanitizedDiagnostics(manifest, purpose, selected.length);
  const context_status = contextStatus(manifest);
  const systems = selected.filter(isSystem).map(factFromAssociation);
  const events = selected.filter(isTimeline).map((association) => ({
    ...factFromAssociation(association),
    metadata: sanitizeMetadata({
      ...association.safe_metadata,
      event_role: association.event_role,
      event_roles: association.event_roles,
      work_mode: association.work_mode,
      work_modes: association.work_modes,
      affected_system_id: association.affected_system_id,
    }),
  }));
  const evidence = selected.filter(isEvidence).map(factFromAssociation);
  const identityFacts = selected
    .filter((association) => association.object_type === "asset" || association.object_type === "asset_identifier" || association.source_table === "master_assets")
    .map(factFromAssociation);
  const allFacts = [...identityFacts, ...systems, ...events, ...evidence];

  return {
    envelope_version: "1.0",
    generated_at: input.generated_at || new Date().toISOString(),
    purpose,
    kac: manifest.kac,
    canonical_asset_id: manifest.asset.id,
    asset_type: manifest.asset.type,
    lifecycle_state: manifest.asset.lifecycle_state,
    caller_authorization_role: manifest.authorization.access,
    source_manifest_status: manifest.status,
    context_status,
    identity_summary: {
      kac: manifest.kac,
      canonical_asset_id: manifest.asset.id,
      asset_type: manifest.asset.type,
      lifecycle_state: manifest.asset.lifecycle_state,
      availability: manifest.asset.availability,
      identity_facts: identityFacts,
    },
    relevant_systems: systems,
    relevant_normalized_events: events,
    relevant_evidence: evidence,
    evidence_confidence_summary: evidenceSummary(selected, hidden.length),
    deterministic_knowledge_gaps: manifest.knowledge_gaps || [],
    readiness_dimensions: readiness(manifest, selected, systems, events, evidence, manifest.knowledge_gaps || []),
    recently_changed_facts: recentFacts(allFacts),
    current_unresolved_states: unresolvedFacts(allFacts, manifest.knowledge_gaps || []),
    permitted_next_capabilities: capabilities(manifest, purpose, context_status, systems),
    provenance_references: selected.flatMap(provenanceFor),
    exclusions_and_redactions: [
      ...(hidden.length ? [{ reason: "not_visible" as const, count: hidden.length, details: hidden }] : []),
      { reason: "redacted_sensitive_field", count: FORBIDDEN_METADATA_KEYS.size },
    ],
    diagnostics,
  };
}
