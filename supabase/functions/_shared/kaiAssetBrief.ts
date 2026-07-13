import type { KnowledgeGap, ManifestDiagnostic } from "./kacManifestTypes.ts";
import type {
  ContextFactRef,
  KacContextEnvelope,
  ReadinessDimension,
} from "./kacContextEnvelopeTypes.ts";
import type {
  BuildKaiAssetBriefInput,
  KaiAssetBrief,
  KaiAttentionItem,
  KaiBriefFactCategory,
  KaiBriefGapCategory,
  KaiBriefStatus,
  KaiBriefUpdateCategory,
  KaiBriefVisibility,
  KaiCapabilityEntry,
  KaiKnownFact,
  KaiMissingOrUncertainFact,
  KaiNextQuestion,
  KaiReadinessCard,
  KaiRecentUpdate,
  KaiSectionVisibility,
} from "./kaiAssetBriefTypes.ts";
export {
  CALLABLE_BUILD_2B_BRIEF_PURPOSES,
  isCallableBuild2BBriefPurpose,
} from "./kaiAssetBriefTypes.ts";
import { isCallableBuild2BBriefPurpose } from "./kaiAssetBriefTypes.ts";

const FORBIDDEN_TEXT_PATTERNS = [
  /extracted_text/i,
  /signed_?url/i,
  /storage_path/i,
  /access_token/i,
  /refresh_token/i,
  /service_role/i,
  /secret/i,
  /raw sql/i,
  /stack trace/i,
];

const CAPABILITY_LABELS: Record<string, string> = {
  can_ask_kai: "Ask KAI",
  can_review_gaps: "Review gaps",
  can_build_maintenance_plan: "Build maintenance plan",
  can_create_asset_brief: "Create asset brief",
  can_add_evidence: "Add evidence",
  can_request_service: "Request service",
  can_create_report: "Create report",
};

const GAP_CATEGORY_MAP: Record<string, KaiBriefGapCategory> = {
  identity: "identity",
  usage: "maintenance",
  systems: "systems",
  relationships: "continuity",
  evidence: "evidence",
  processing: "evidence",
  conflict: "evidence",
  transfer: "continuity",
  state: "continuity",
};

function compactString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function isForbiddenText(value: string) {
  return FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function safeText(value: unknown, fallback = "Known") {
  const text = compactString(value) || fallback;
  return isForbiddenText(text) ? fallback : text;
}

function maskSerial(value: string) {
  if (value.length <= 4) return "masked";
  return `masked-${value.slice(-4)}`;
}

function identifierKind(fact: ContextFactRef) {
  return safeText(fact.metadata?.kind || fact.metadata?.identifier_type || fact.metadata?.type, "").toLowerCase();
}

function factValue(fact: ContextFactRef) {
  const kind = identifierKind(fact);
  const raw = compactString(fact.metadata?.value || fact.metadata?.name || fact.metadata?.title || fact.metadata?.model || fact.label) || fact.label;
  if (kind.includes("serial") || /serial/i.test(fact.label) || fact.metadata?.serial_number) {
    return maskSerial(String(fact.metadata?.serial_number || raw));
  }
  return safeText(raw, fact.label);
}

function factVisibility(fact: ContextFactRef, category: KaiBriefFactCategory): KaiBriefVisibility {
  const kind = identifierKind(fact);
  if (kind === "vin" || kind === "hin" || kind.includes("serial")) return "owner_private";
  if (category === "evidence" || category === "maintenance" || category === "continuity") return "owner_private";
  if (fact.scope === "horizontal" && category === "systems") return "shareable";
  return "owner_private";
}

function categoryForFact(fact: ContextFactRef): KaiBriefFactCategory {
  if (fact.source_table === "asset_identifiers" || fact.source_table === "assets" || fact.source_table === "master_assets") return "identity";
  if (["systems", "vehicle_systems", "boat_systems", "home_systems"].includes(fact.source_table || "")) return "systems";
  if (["attachments", "attachment_placements", "attachment_links"].includes(fact.source_table || "")) return "evidence";
  const roles = String(fact.metadata?.event_roles || fact.metadata?.event_role || "");
  if (roles.includes("maintenance") || roles.includes("repair") || roles.includes("inspection")) return "maintenance";
  if (String(fact.label).toLowerCase().includes("warranty")) return "warranty";
  if (fact.source_table?.includes("timeline") || fact.source_table?.includes("service") || fact.source_table === "story_events") return "history";
  return "recent_change";
}

function priorityForFact(fact: ContextFactRef) {
  const category = categoryForFact(fact);
  const base: Record<KaiBriefFactCategory, number> = {
    identity: 10,
    systems: 20,
    maintenance: 30,
    warranty: 40,
    continuity: 50,
    recent_change: 60,
    history: 65,
    evidence: 70,
  };
  return base[category] || 99;
}

function uniqueFacts(facts: ContextFactRef[]) {
  const seen = new Set<string>();
  const out: ContextFactRef[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
  }
  return out;
}

function knownFacts(envelope: KacContextEnvelope): KaiKnownFact[] {
  const facts = uniqueFacts([
    ...envelope.identity_summary.identity_facts,
    ...envelope.relevant_systems,
    ...envelope.relevant_normalized_events,
    ...envelope.relevant_evidence,
    ...envelope.recently_changed_facts,
  ]);
  return facts
    .filter((fact) => fact.confidence_state !== "missing" && fact.confidence_state !== "not_visible")
    .sort((a, b) => priorityForFact(a) - priorityForFact(b) || a.id.localeCompare(b.id))
    .slice(0, 24)
    .map((fact) => {
      const category = categoryForFact(fact);
      return {
        id: fact.id,
        label: safeText(fact.label, "Known fact"),
        value: factValue(fact),
        category,
        confidence_state: fact.confidence_state || "reported",
        effective_date: fact.effective_from || fact.updated_at || fact.created_at || null,
        source_reference: fact.provenance?.[0],
        provenance: fact.provenance || [],
        scope: fact.scope || "kac_specific",
        visibility: factVisibility(fact, category),
      };
    });
}

function reasonForGap(gap: KnowledgeGap) {
  const category = GAP_CATEGORY_MAP[gap.category] || "continuity";
  const reasons: Record<KaiBriefGapCategory, string> = {
    identity: "Identity gaps make it harder to confirm the asset record.",
    systems: "System gaps limit system-specific history and evidence review.",
    history: "History gaps limit continuity of the asset record.",
    evidence: "Evidence gaps reduce confidence in the documented record.",
    maintenance: "Maintenance gaps limit planning context.",
    continuity: "Continuity gaps can affect stewardship or transfer readiness.",
  };
  return reasons[category];
}

function gapBlocksCurrentPurpose(gap: KnowledgeGap, envelope: KacContextEnvelope) {
  return gap.priority === "high" ||
    gap.blocks_purpose?.includes("asset_overview") ||
    (envelope.purpose === "maintenance_planning" && ["evidence", "usage", "systems"].includes(gap.category));
}

function missingFacts(envelope: KacContextEnvelope): KaiMissingOrUncertainFact[] {
  return [...(envelope.deterministic_knowledge_gaps || [])]
    .sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id);
    })
    .map((gap) => {
      const category = GAP_CATEGORY_MAP[gap.category] || "continuity";
      const relatedIds = gap.related_association_ids || [];
      return {
        id: gap.id,
        gap_type: gap.category,
        category,
        label: safeText(gap.question, "Open knowledge gap"),
        why_it_matters: reasonForGap(gap),
        blocking: gapBlocksCurrentPurpose(gap, envelope),
        related_system_id: relatedIds.find((id) => id.includes("system")),
        related_event_id: relatedIds.find((id) => id.includes("event") || id.includes("service") || id.includes("timeline")),
        source_gap_id: gap.id,
        provenance: [{ note: `Knowledge gap ${gap.id}` }],
        user_can_resolve: Boolean(envelope.permitted_next_capabilities.can_review_gaps || envelope.permitted_next_capabilities.can_add_evidence),
        visibility: "owner_private" as const,
      };
    });
}

function updateCategory(fact: ContextFactRef): KaiBriefUpdateCategory {
  if (fact.source_table === "attachments") {
    return fact.metadata?.processing_status === "processed" ? "document_processed" : "attachment_added";
  }
  if (["systems", "vehicle_systems", "boat_systems", "home_systems"].includes(fact.source_table || "")) return "system_added";
  const label = `${fact.label} ${fact.state || ""}`.toLowerCase();
  if (label.includes("warranty")) return "warranty_added";
  if (label.includes("resolved")) return "finding_resolved";
  if (label.includes("open") || label.includes("finding")) return "finding_opened";
  if (label.includes("lifecycle")) return "lifecycle_changed";
  if (fact.confidence_state === "verified" || fact.confidence_state === "conflicting") return "evidence_state_changed";
  return "service_added";
}

function recentUpdates(envelope: KacContextEnvelope): KaiRecentUpdate[] {
  return uniqueFacts(envelope.recently_changed_facts)
    .map((fact) => ({
      id: fact.id,
      title: safeText(fact.label, "Recent update"),
      timestamp: fact.updated_at || fact.created_at || fact.effective_from || envelope.generated_at,
      category: updateCategory(fact),
      related_system_id: compactString(fact.metadata?.affected_system_id),
      provenance: fact.provenance || [],
      visibility: "owner_private" as const,
    }))
    .filter((update) => !isForbiddenText(JSON.stringify(update)))
    .slice(0, 12);
}

function readinessSummary(dimension: ReadinessDimension) {
  if (dimension.status === "ready") return `${dimension.dimension} context is present.`;
  if (dimension.status === "partial") return `${dimension.dimension} context is partially visible.`;
  if (dimension.status === "attention") return `${dimension.dimension} context needs attention.`;
  if (dimension.status === "restricted") return `${dimension.dimension} context is restricted.`;
  return `${dimension.dimension} context is not yet established.`;
}

function readinessCards(envelope: KacContextEnvelope): KaiReadinessCard[] {
  return envelope.readiness_dimensions.map((dimension) => ({
    dimension: dimension.dimension,
    title: `${dimension.dimension.slice(0, 1).toUpperCase()}${dimension.dimension.slice(1)}`,
    status: dimension.status,
    summary: readinessSummary(dimension),
    supporting_fact_count: dimension.supporting_facts.length,
    blocking_gap_count: dimension.blocking_gaps.length,
    can_review_details: envelope.permitted_next_capabilities.can_review_gaps,
    visibility: "owner_private" as const,
  }));
}

function attentionItems(envelope: KacContextEnvelope, gaps: KaiMissingOrUncertainFact[]): KaiAttentionItem[] {
  const items: KaiAttentionItem[] = [];
  for (const dimension of envelope.readiness_dimensions) {
    if (dimension.status === "attention" || dimension.status === "partial" || dimension.status === "restricted") {
      items.push({
        id: `readiness:${dimension.dimension}`,
        title: `${dimension.dimension.slice(0, 1).toUpperCase()}${dimension.dimension.slice(1)} needs review`,
        explanation: readinessSummary(dimension),
        severity: dimension.status === "restricted" ? "important" : "attention",
        source_reference: dimension.source_references[0],
        permitted_capabilities: { can_review_gaps: envelope.permitted_next_capabilities.can_review_gaps },
        visibility: "owner_private",
      });
    }
  }
  for (const gap of gaps.filter((gap) => gap.blocking)) {
    items.push({
      id: `gap:${gap.id}`,
      title: gap.label,
      explanation: gap.why_it_matters,
      severity: gap.category === "identity" || gap.category === "maintenance" ? "important" : "attention",
      related_system_id: gap.related_system_id,
      source_reference: gap.provenance[0],
      permitted_capabilities: {
        can_review_gaps: envelope.permitted_next_capabilities.can_review_gaps,
        can_add_evidence: envelope.permitted_next_capabilities.can_add_evidence,
      },
      visibility: "owner_private",
    });
  }
  for (const unresolved of envelope.current_unresolved_states.filter((fact) =>
    fact.confidence_state === "conflicting" || String(fact.state || "").includes("open")
  )) {
    items.push({
      id: `unresolved:${unresolved.id}`,
      title: safeText(unresolved.label, "Unresolved state"),
      explanation: "This unresolved state is present in the authorized context.",
      severity: unresolved.confidence_state === "conflicting" ? "important" : "attention",
      source_reference: unresolved.provenance?.[0],
      permitted_capabilities: { can_review_gaps: envelope.permitted_next_capabilities.can_review_gaps },
      visibility: "owner_private",
    });
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 12);
}

function nextQuestion(envelope: KacContextEnvelope, gaps: KaiMissingOrUncertainFact[]): KaiNextQuestion {
  const byId = new Map(gaps.map((gap) => [gap.id, gap]));
  const conflict = gaps.find((gap) => gap.gap_type === "conflict");
  if (conflict) return { question: conflict.label, related_gap_id: conflict.id, priority_reason: "critical_identity_conflict", visibility: "owner_private" };

  const maintenanceEvidence = gaps.find((gap) => gap.blocking && (gap.category === "maintenance" || gap.category === "evidence"));
  if (maintenanceEvidence) return { question: maintenanceEvidence.label, related_gap_id: maintenanceEvidence.id, priority_reason: "blocking_maintenance_evidence_gap", visibility: "owner_private" };

  const finding = envelope.current_unresolved_states.find((fact) => {
    const text = `${fact.label} ${fact.state || ""}`.toLowerCase();
    return text.includes("safety") || text.includes("inspection") || text.includes("finding");
  });
  if (finding) {
    return { question: `Can you clarify ${safeText(finding.label, "this unresolved finding")}?`, related_gap_id: finding.id, priority_reason: "unresolved_safety_or_inspection_finding", visibility: "owner_private" };
  }

  const systemGap = gaps.find((gap) => gap.category === "systems");
  if (systemGap) return { question: systemGap.label, related_gap_id: systemGap.id, priority_reason: "missing_primary_system_identity", visibility: "owner_private" };

  const serviceGap = gaps.find((gap) => gap.category === "maintenance" || gap.label.toLowerCase().includes("service"));
  if (serviceGap) return { question: serviceGap.label, related_gap_id: serviceGap.id, priority_reason: "missing_latest_service_proof", visibility: "owner_private" };

  const warrantyGap = gaps.find((gap) => gap.label.toLowerCase().includes("warranty"));
  if (warrantyGap) return { question: warrantyGap.label, related_gap_id: warrantyGap.id, priority_reason: "missing_warranty_evidence", visibility: "owner_private" };

  const continuityGap = gaps.find((gap) => gap.category === "continuity");
  if (continuityGap) return { question: continuityGap.label, related_gap_id: continuityGap.id, priority_reason: "highest_impact_continuity_gap", visibility: "owner_private" };

  const firstGap = [...byId.values()][0];
  if (firstGap) return { question: firstGap.label, related_gap_id: firstGap.id, priority_reason: "highest_impact_continuity_gap", visibility: "owner_private" };

  return {
    question: "Is there anything important about this asset record Keepr should know?",
    priority_reason: "no_open_question",
    visibility: "owner_private",
  };
}

function currentState(envelope: KacContextEnvelope) {
  const cardByDimension = new Map(envelope.readiness_dimensions.map((dimension) => [dimension.dimension, dimension]));
  return {
    identity: readinessSummary(cardByDimension.get("identity") || emptyDimension("identity")),
    systems: readinessSummary(cardByDimension.get("systems") || emptyDimension("systems")),
    history: readinessSummary(cardByDimension.get("history") || emptyDimension("history")),
    evidence: readinessSummary(cardByDimension.get("evidence") || emptyDimension("evidence")),
    maintenance: readinessSummary(cardByDimension.get("maintenance") || emptyDimension("maintenance")),
    continuity: readinessSummary(cardByDimension.get("continuity") || emptyDimension("continuity")),
  };
}

function emptyDimension(dimension: ReadinessDimension["dimension"]): ReadinessDimension {
  return { dimension, status: "unknown", supporting_facts: [], blocking_gaps: [], source_references: [] };
}

function briefStatus(envelope: KacContextEnvelope, gaps: KaiMissingOrUncertainFact[], attention: KaiAttentionItem[]): KaiBriefStatus {
  if (envelope.context_status === "restricted") return "restricted";
  if (!envelope.canonical_asset_id || !envelope.kac) return "unknown";
  if (envelope.context_status === "partial") return "partial";
  if (gaps.some((gap) => gap.blocking) || attention.some((item) => item.severity === "important")) return "attention";
  if (envelope.readiness_dimensions.some((dimension) => dimension.status === "unknown")) return "unknown";
  return "complete";
}

function headline(status: KaiBriefStatus, envelope: KacContextEnvelope, gaps: KaiMissingOrUncertainFact[]) {
  if (status === "restricted") return "This asset requires attention";
  if (status === "partial") return envelope.purpose === "maintenance_planning" ? "Maintenance context is incomplete" : "Important context is still hidden";
  if (status === "attention") return gaps.some((gap) => gap.category === "evidence") ? "Important proof is still missing" : "This asset requires attention";
  if (status === "unknown") return "Keepr needs more context for this asset";
  return "Keepr understands this asset well";
}

function subheadline(status: KaiBriefStatus, envelope: KacContextEnvelope, gaps: KaiMissingOrUncertainFact[]) {
  if (status === "restricted") return "Some context is intentionally restricted and normal brief content is not shown.";
  if (status === "partial") return "Keepr can show the authorized context it can see, but one or more domains are incomplete or hidden.";
  if (status === "attention") return `${gaps.filter((gap) => gap.blocking).length || 1} important item needs review before this context is ready.`;
  if (status === "unknown") return "Keepr has the asset identity but not enough context to summarize it confidently.";
  return envelope.purpose === "maintenance_planning"
    ? "Identity, systems, maintenance history, and evidence are present for planning context."
    : "Identity, history, evidence, and continuity context are present for stewardship review.";
}

function displayIdentity(envelope: KacContextEnvelope) {
  const identities = envelope.identity_summary.identity_facts;
  const primary = identities.find((fact) => ["vin", "hin"].includes(identifierKind(fact))) ||
    identities.find((fact) => identifierKind(fact).includes("serial"));
  return {
    label: safeText(
      identities.find((fact) => fact.source_table === "assets")?.metadata?.name ||
        envelope.asset_type ||
        envelope.kac,
      envelope.kac,
    ),
    kac: envelope.kac,
    canonical_asset_id: envelope.canonical_asset_id,
    primary_identifier_kind: primary ? identifierKind(primary) || undefined : undefined,
    primary_identifier_value: primary ? factValue(primary) : undefined,
    identifier_visibility: "owner_private" as const,
  };
}

function capabilityEntries(envelope: KacContextEnvelope): KaiCapabilityEntry[] {
  return Object.entries(envelope.permitted_next_capabilities)
    .map(([key, enabled]) => ({
      key: key as keyof typeof envelope.permitted_next_capabilities,
      label: CAPABILITY_LABELS[key] || key,
      enabled: Boolean(enabled),
    }));
}

function visibilityClassification(envelope: KacContextEnvelope): KaiSectionVisibility[] {
  const diagnosticsVisibility: KaiBriefVisibility = envelope.context_status === "restricted" ? "restricted" : "owner_private";
  return [
    { section: "identity", classification: "owner_private" },
    { section: "known_facts", classification: "owner_private" },
    { section: "missing_or_uncertain_facts", classification: "owner_private" },
    { section: "recent_updates", classification: "owner_private" },
    { section: "attention_items", classification: "owner_private" },
    { section: "readiness_cards", classification: "owner_private" },
    { section: "evidence_summary", classification: "owner_private" },
    { section: "capabilities", classification: "owner_private" },
    { section: "diagnostics", classification: diagnosticsVisibility },
  ];
}

function sanitizedDiagnostics(envelope: KacContextEnvelope): ManifestDiagnostic[] {
  return (envelope.diagnostics || []).map((diagnostic) => ({
    code: safeText(diagnostic.code, "diagnostic"),
    severity: diagnostic.severity,
    message: safeText(diagnostic.message, "Diagnostic available."),
    source: diagnostic.source ? safeText(diagnostic.source, "source") : undefined,
    object_type: diagnostic.object_type ? safeText(diagnostic.object_type, "object") : undefined,
    object_id: diagnostic.object_id ? safeText(diagnostic.object_id, "object") : undefined,
  }));
}

function assertNoForbiddenContent(brief: KaiAssetBrief) {
  const serialized = JSON.stringify(brief);
  if (isForbiddenText(serialized)) {
    throw new Error("KaiAssetBrief contains prohibited content");
  }
}

export function buildKaiAssetBrief(input: BuildKaiAssetBriefInput): KaiAssetBrief {
  const { envelope } = input;
  if (!isCallableBuild2BBriefPurpose(envelope.purpose)) {
    throw new Error(`Unsupported Build 2B brief purpose: ${envelope.purpose}`);
  }

  const gaps = missingFacts(envelope);
  const attention = attentionItems(envelope, gaps);
  const status = briefStatus(envelope, gaps, attention);
  const brief: KaiAssetBrief = {
    brief_version: "1.0",
    generated_at: input.generated_at || new Date().toISOString(),
    purpose: envelope.purpose,
    kac: envelope.kac,
    canonical_asset_id: envelope.canonical_asset_id,
    asset_display_identity: displayIdentity(envelope),
    asset_type: envelope.asset_type,
    lifecycle_state: envelope.lifecycle_state,
    caller_authorization_role: envelope.caller_authorization_role,
    source_envelope_status: envelope.context_status,
    brief_status: status,
    headline: headline(status, envelope, gaps),
    subheadline: subheadline(status, envelope, gaps),
    current_state_summary: currentState(envelope),
    known_facts: status === "restricted" ? [] : knownFacts(envelope),
    missing_or_uncertain_facts: status === "restricted" ? [] : gaps,
    recent_updates: status === "restricted" ? [] : recentUpdates(envelope),
    attention_items: attention,
    readiness_cards: readinessCards(envelope),
    evidence_summary: envelope.evidence_confidence_summary,
    unresolved_states: status === "restricted" ? [] : envelope.current_unresolved_states,
    highest_value_next_question: status === "restricted"
      ? { question: "What context should remain restricted for this asset?", priority_reason: "no_open_question", visibility: "restricted" }
      : nextQuestion(envelope, gaps),
    permitted_next_capabilities: capabilityEntries(envelope),
    provenance_references: envelope.provenance_references,
    visibility_classification: visibilityClassification(envelope),
    diagnostics: sanitizedDiagnostics(envelope),
    exclusions_and_redactions: envelope.exclusions_and_redactions,
  };
  assertNoForbiddenContent(brief);
  return brief;
}
