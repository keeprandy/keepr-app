import type { ManifestDiagnostic } from "./kacManifestTypes.ts";
import type { ContextProvenanceReference } from "./kacContextEnvelopeTypes.ts";
import type {
  KaiAssetBrief,
  KaiKnownFact,
  KaiMissingOrUncertainFact,
} from "./kaiAssetBriefTypes.ts";
import type {
  BuildKeeprReconciledDecisionInput,
  KeeprActionJustificationStatus,
  KeeprApplicability,
  KeeprAssetSpecificity,
  KeeprAuthorityClass,
  KeeprAuthorityConflict,
  KeeprAuthorityStatement,
  KeeprEvidenceState,
  KeeprGapPriority,
  KeeprReconciledDecisionContext,
  KeeprRequirementStrength,
  KeeprStatementConfidence,
  KeeprStatementType,
  KeeprStewardshipProfile,
  KeeprSupersessionStatus,
} from "./kaiAuthorityTypes.ts";

export const KEEPR_AUTHORITY_CLASSES: KeeprAuthorityClass[] = [
  "documented_fact",
  "manufacturer_requirement",
  "warranty_obligation",
  "legal_or_compliance_requirement",
  "professional_finding",
  "professional_recommendation",
  "standard_service_practice",
  "owner_report",
  "owner_preference",
  "kai_interpretation",
  "generic_asset_class_context",
];

export const KEEPR_REQUIREMENT_STRENGTHS: KeeprRequirementStrength[] = [
  "mandatory",
  "required_for_warranty",
  "professionally_recommended",
  "customary",
  "owner_preferred",
  "optional",
  "informational",
  "unknown",
];

export const KEEPR_APPLICABILITIES: KeeprApplicability[] = [
  "applies",
  "conditionally_applies",
  "does_not_apply",
  "insufficient_evidence",
  "expired",
  "superseded",
  "disputed",
];

const FORBIDDEN_PATTERNS = [
  /extracted_text/i,
  /signed_?url/i,
  /storage_path/i,
  /access_token/i,
  /refresh_token/i,
  /service_role/i,
  /secret/i,
  /raw sql/i,
  /stack trace/i,
  /@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
];

const INTERNAL_LABEL_PATTERNS = [
  /attachment_placement/i,
  /work_event/i,
  /vehicle_systems/i,
  /boat_systems/i,
  /home_systems/i,
  /not_applicable/i,
];

function hasForbiddenText(value: unknown) {
  const text = JSON.stringify(value || {});
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function compact(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function safeText(value: unknown, fallback = "Documented context") {
  const raw = compact(value) || fallback;
  const stripped = raw.replace(/https?:\/\/\S+/gi, "[redacted link]");
  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(stripped))) return fallback;
  return stripped;
}

function note(note: string): ContextProvenanceReference {
  return { note };
}

function diagnostic(code: string, severity: ManifestDiagnostic["severity"], message: string): ManifestDiagnostic {
  return { code, severity, message };
}

function mapConfidence(fact: KaiKnownFact): KeeprStatementConfidence {
  if (fact.confidence_state === "verified") return "verified";
  if (fact.confidence_state === "supported") return "supported";
  if (fact.confidence_state === "reported") return "reported";
  if (fact.confidence_state === "missing") return "missing";
  if (fact.confidence_state === "conflicting") return "conflicting";
  return "unknown";
}

function mapEvidenceState(fact: KaiKnownFact): KeeprEvidenceState {
  if (fact.confidence_state === "verified" || fact.confidence_state === "supported") return "attached";
  if (fact.confidence_state === "reported") return "reported";
  if (fact.confidence_state === "missing") return "missing";
  return "unknown";
}

function authorityForFact(fact: KaiKnownFact): KeeprAuthorityClass {
  if (fact.confidence_state === "reported") return "owner_report";
  return "documented_fact";
}

function semanticFactLabel(fact: KaiKnownFact) {
  const label = safeText(fact.label, "Documented fact");
  const value = safeText(fact.value, label);
  const table = fact.source_reference?.table || "";
  const category = fact.category;
  const lower = `${label} ${value}`.toLowerCase();
  if (category === "identity" && lower.includes("vin")) return "Vehicle identifier is recorded.";
  if (category === "identity" && lower.includes("hin")) return "Hull identifier is recorded.";
  if (category === "identity" && lower.includes("serial")) return "Serial identifier is recorded with privacy protection.";
  if (category === "identity") return "Asset identity is recorded.";
  if (category === "systems") return `${value || label} is identified as part of the asset.`;
  if (category === "evidence") return `${label} is attached as supporting evidence.`;
  if (category === "maintenance") return `${label} is documented in the maintenance record.`;
  if (category === "history" && table === "story_events") return `${label} is preserved as an owner Moment.`;
  if (category === "history") return `${label} is recorded in the asset history.`;
  if (category === "warranty") return `${label} is documented as warranty context.`;
  if (category === "continuity") return `${label} is documented for stewardship continuity.`;
  return `${label} is documented.`;
}

function normalizeFactStatement(fact: KaiKnownFact): KeeprAuthorityStatement {
  const authority_class = authorityForFact(fact);
  const statement_type: KeeprStatementType = authority_class === "owner_report" ? "report" : "fact";
  return {
    statement_id: `brief_fact:${fact.id}`,
    statement_type,
    title: safeText(fact.label, "Documented fact"),
    statement: semanticFactLabel(fact),
    authority_class,
    source_role: authority_class === "owner_report" ? "owner" : "keepr_record",
    asset_specificity: fact.scope === "horizontal" ? "class_context" : "asset_specific",
    confidence: mapConfidence(fact),
    evidence_state: mapEvidenceState(fact),
    applicability: "applies",
    requirement_strength: "informational",
    effective_date: fact.effective_date || null,
    source_references: fact.provenance?.length ? fact.provenance : fact.source_reference ? [fact.source_reference] : [],
    visibility_classification: fact.visibility,
    purpose_relevance: fact.category === "maintenance" || fact.category === "evidence" ? "direct" : "supporting",
    dispute_status: fact.confidence_state === "conflicting" ? "conflicting" : "none",
    supersession_status: "current",
  };
}

function profileStatements(
  profile: KeeprStewardshipProfile | undefined,
  brief: KaiAssetBrief,
): KeeprAuthorityStatement[] {
  if (!profile) return [];
  const refs = profile.source_references?.length ? profile.source_references : [note("Owner stewardship profile")];
  const statements: KeeprAuthorityStatement[] = [];
  const push = (id: string, title: string, statement: string) => {
    statements.push({
      statement_id: `profile:${id}`,
      statement_type: "preference",
      title,
      statement,
      authority_class: "owner_preference",
      source_role: "owner",
      asset_specificity: profile.profile_scope === "asset_specific" ? "asset_specific" : "unknown",
      confidence: profile.owner_confirmed ? "supported" : "reported",
      evidence_state: "reported",
      applicability: "applies",
      requirement_strength: "owner_preferred",
      effective_date: profile.effective_date || null,
      source_references: refs,
      visibility_classification: "owner_private",
      purpose_relevance: "supporting",
      dispute_status: "none",
      supersession_status: "current",
    });
  };
  if (profile.maintenance_philosophy) push("maintenance_philosophy", "Owner maintenance philosophy", `Owner stewardship preference is ${profile.maintenance_philosophy}.`);
  if (profile.interval_preference) push("interval_preference", "Owner interval preference", `Owner interval preference is ${profile.interval_preference}.`);
  if (profile.low_use_treatment) push("low_use_treatment", "Owner low-use treatment", `Owner low-use treatment is ${profile.low_use_treatment}.`);
  if (profile.seasonal_use_preference) push("seasonal_use", "Owner seasonal-use preference", `Owner seasonal-use preference is ${profile.seasonal_use_preference}.`);
  if (profile.do_not_manufacture_activity) {
    push("no_manufactured_activity", "No manufactured activity", "Owner preference is to avoid work unless source-supported ownership value is present.");
  }
  if (!statements.length) {
    push("general", "Owner stewardship profile", `Owner profile is available for ${brief.asset_display_identity.label}.`);
  }
  return statements;
}

function normalizeExternalStatement(statement: KeeprAuthorityStatement, index: number): KeeprAuthorityStatement {
  return {
    ...statement,
    statement_id: statement.statement_id || `external:${index}`,
    title: safeText(statement.title, "Authority statement"),
    statement: safeText(statement.statement, "Authority statement is present."),
    source_role: safeText(statement.source_role, "unknown"),
    source_references: statement.source_references || [],
    purpose_relevance: statement.purpose_relevance || "supporting",
    sanitized_notes: statement.sanitized_notes?.map((item) => safeText(item, "Note")),
  };
}

function isCurrent(statement: KeeprAuthorityStatement) {
  return statement.supersession_status !== "superseded" &&
    statement.supersession_status !== "expired" &&
    !["expired", "superseded", "does_not_apply"].includes(statement.applicability);
}

function applies(statement: KeeprAuthorityStatement) {
  return statement.applicability === "applies" || statement.applicability === "conditionally_applies";
}

function isObligation(statement: KeeprAuthorityStatement) {
  return ["manufacturer_requirement", "warranty_obligation", "legal_or_compliance_requirement"].includes(statement.authority_class) &&
    ["mandatory", "required_for_warranty"].includes(statement.requirement_strength) &&
    applies(statement) &&
    isCurrent(statement);
}

function isProfessionalFinding(statement: KeeprAuthorityStatement) {
  return statement.authority_class === "professional_finding" &&
    statement.asset_specificity === "asset_specific" &&
    applies(statement) &&
    isCurrent(statement) &&
    Boolean(statement.source_identity_ref || statement.source_references.length);
}

function hasSpecificEvidence(statement: KeeprAuthorityStatement) {
  return ["attached", "attested", "reported"].includes(statement.evidence_state) && statement.confidence !== "unknown";
}

function hasUnspecifiedRecommendationBasis(statement: KeeprAuthorityStatement) {
  return statement.authority_class === "professional_recommendation" &&
    applies(statement) &&
    isCurrent(statement) &&
    (!statement.source_references.length || statement.requirement_strength === "unknown" || statement.evidence_state === "unknown");
}

function sameOrDifferentMeaning(a: KeeprAuthorityStatement, b: KeeprAuthorityStatement) {
  if (a.related_system_id && b.related_system_id && a.related_system_id === b.related_system_id) return true;
  const textA = `${a.title} ${a.statement}`.toLowerCase();
  const textB = `${b.title} ${b.statement}`.toLowerCase();
  return textA.includes("annual") && textB.includes("annual") || textA.includes("oil") && textB.includes("oil") ||
    textA.includes("service") && textB.includes("service") || textA.includes("warranty") && textB.includes("warranty");
}

function conflict(
  conflict_id: string,
  conflict_type: KeeprAuthorityConflict["conflict_type"],
  statements: KeeprAuthorityStatement[],
  materiality: KeeprAuthorityConflict["materiality"],
  explanation: string,
  owner_decision_required: boolean,
  preferred_resolution_path: string,
  clarification_needed?: string,
): KeeprAuthorityConflict {
  return {
    conflict_id,
    statement_ids: statements.map((statement) => statement.statement_id),
    conflict_type,
    materiality,
    explanation,
    owner_decision_required,
    clarification_needed,
    preferred_resolution_path,
    source_references: statements.flatMap((statement) => statement.source_references).slice(0, 8),
  };
}

function detectConflicts(statements: KeeprAuthorityStatement[]) {
  const conflicts: KeeprAuthorityConflict[] = [];
  const byClass = (authority_class: KeeprAuthorityClass) => statements.filter((statement) => statement.authority_class === authority_class && isCurrent(statement));
  const manufacturers = byClass("manufacturer_requirement");
  const shopPractices = byClass("standard_service_practice");
  const recommendations = byClass("professional_recommendation");
  const preferences = byClass("owner_preference");
  const findings = byClass("professional_finding");
  const kai = byClass("kai_interpretation");
  const warranties = byClass("warranty_obligation");

  for (const manufacturer of manufacturers) {
    for (const practice of shopPractices) {
      if (sameOrDifferentMeaning(manufacturer, practice) && manufacturer.requirement_strength !== practice.requirement_strength) {
        conflicts.push(conflict(
          `conflict:manufacturer_vs_shop:${conflicts.length + 1}`,
          "manufacturer_vs_shop_practice",
          [manufacturer, practice],
          "medium",
          "Manufacturer requirement and standard shop practice are separate authority types and should not be collapsed.",
          true,
          "Ask whether the shop practice is required by the manufacturer, a warranty condition, or customary preventive service.",
          "Clarify the basis for the shop practice.",
        ));
      }
    }
  }

  for (const recommendation of recommendations) {
    for (const preference of preferences) {
      if (sameOrDifferentMeaning(recommendation, preference)) {
        conflicts.push(conflict(
          `conflict:recommendation_vs_owner:${conflicts.length + 1}`,
          "recommendation_vs_owner_preference",
          [recommendation, preference],
          "medium",
          "A professional recommendation and owner stewardship preference point to different decision paths.",
          true,
          "Preserve the recommendation and ask the owner whether to accept, defer, or request supporting basis.",
          "Clarify whether the recommendation is asset-specific or standard practice.",
        ));
      }
    }
  }

  for (const finding of findings) {
    for (const interpretation of kai) {
      if (sameOrDifferentMeaning(finding, interpretation) && interpretation.requirement_strength === "informational") {
        conflicts.push(conflict(
          `conflict:finding_vs_kai:${conflicts.length + 1}`,
          "finding_vs_kai_interpretation",
          [finding, interpretation],
          "high",
          "An asset-specific professional finding carries different authority than KAI interpretation.",
          true,
          "Use the professional finding as source-supported decision context and keep KAI interpretation qualified.",
        ));
      }
    }
  }

  for (const warranty of warranties) {
    for (const preference of preferences.filter((item) => item.statement.includes("defer") || item.owner_decision === "deferred")) {
      conflicts.push(conflict(
        `conflict:warranty_vs_owner:${conflicts.length + 1}`,
        "warranty_vs_owner_deferral",
        [warranty, preference],
        "high",
        "Warranty obligations and owner deferral preferences must remain distinct.",
        true,
        "Confirm warranty terms before deferring any required condition.",
      ));
    }
  }

  recommendations.forEach((left, leftIndex) => {
    recommendations.slice(leftIndex + 1).forEach((right) => {
      if (left.source_identity_ref !== right.source_identity_ref && !sameOrDifferentMeaning(left, right)) {
        conflicts.push(conflict(
          `conflict:pro_recommendation:${conflicts.length + 1}`,
          "pro_recommendation_conflict",
          [left, right],
          "low",
          "Professional recommendations differ and require context before choosing a path.",
          true,
          "Ask the recommending professionals to identify evidence, urgency, and requirement basis.",
        ));
      }
    });
  });

  for (const statement of statements) {
    if (["manufacturer_requirement", "warranty_obligation", "legal_or_compliance_requirement"].includes(statement.authority_class) &&
      statement.requirement_strength === "mandatory" &&
      (statement.applicability === "expired" || statement.supersession_status === "expired")) {
      conflicts.push(conflict(
        `conflict:expired_requirement:${conflicts.length + 1}`,
        "expired_requirement_presented_current",
        [statement],
        "medium",
        "An expired requirement cannot be treated as current without supporting evidence.",
        false,
        "Mark the requirement as expired or provide a current source.",
      ));
    }
    if (statement.authority_class === "standard_service_practice" && statement.requirement_strength === "mandatory") {
      conflicts.push(conflict(
        `conflict:standard_practice_mandatory:${conflicts.length + 1}`,
        "standard_practice_presented_mandatory",
        [statement],
        "medium",
        "Standard service practice is not automatically a mandatory asset-specific requirement.",
        true,
        "Clarify whether a manufacturer, warranty, legal, or asset-specific finding supports mandatory treatment.",
      ));
    }
    if (statement.authority_class === "generic_asset_class_context" && statement.asset_specificity === "asset_specific") {
      conflicts.push(conflict(
        `conflict:generic_asset_specific:${conflicts.length + 1}`,
        "generic_guidance_presented_asset_specific",
        [statement],
        "medium",
        "Generic asset-class context cannot be promoted into asset-specific authority without a source.",
        false,
        "Keep the context informational until an asset-specific source exists.",
      ));
    }
  }

  return conflicts;
}

function priorityForGap(gap: KaiMissingOrUncertainFact, brief: KaiAssetBrief): KeeprGapPriority {
  if (gap.blocking) return "decision_blocking";
  if (brief.purpose === "maintenance_planning" && ["systems", "maintenance", "evidence"].includes(gap.category)) return "important";
  if (gap.category === "identity" || gap.category === "systems") return "important";
  if (gap.category === "continuity" || gap.category === "history") return "useful";
  return "nice_to_have";
}

function gapReason(gap: KaiMissingOrUncertainFact, priority: KeeprGapPriority) {
  if (priority === "decision_blocking") return "This gap blocks a meaningful ownership decision.";
  if (priority === "important") return "This gap materially improves asset-specific interpretation.";
  if (priority === "useful") return "This gap improves record continuity but does not by itself justify work.";
  return "This gap may be useful later but does not justify action now.";
}

function actionStatus(
  statements: KeeprAuthorityStatement[],
  conflicts: KeeprAuthorityConflict[],
  brief: KaiAssetBrief,
): KeeprActionJustificationStatus {
  if (brief.brief_status === "restricted") return "insufficient_evidence";
  if (conflicts.some((item) => item.materiality === "high")) return "conflict_unresolved";
  if (conflicts.some((item) => item.owner_decision_required)) return "owner_decision_required";
  if (statements.some((statement) => isObligation(statement))) return "action_required";
  if (statements.some((statement) => isProfessionalFinding(statement) && hasSpecificEvidence(statement))) return "action_supported";
  if (statements.some((statement) => isProfessionalFinding(statement))) return "professional_assessment_required";
  if (statements.some((statement) => hasUnspecifiedRecommendationBasis(statement))) return "clarification_required";
  if (statements.some((statement) =>
    statement.authority_class === "professional_recommendation" &&
    applies(statement) &&
    isCurrent(statement)
  )) {
    return "action_optional";
  }
  if (brief.missing_or_uncertain_facts.some((gap) => gap.blocking)) return "insufficient_evidence";
  return "no_action_required";
}

function recommendedQuestion(
  status: KeeprActionJustificationStatus,
  statements: KeeprAuthorityStatement[],
  conflicts: KeeprAuthorityConflict[],
  brief: KaiAssetBrief,
) {
  const conflictQuestion = conflicts.find((item) => item.clarification_needed)?.clarification_needed;
  if (conflictQuestion) return conflictQuestion;
  if (statements.some((statement) => hasUnspecifiedRecommendationBasis(statement))) {
    return "Is this recommendation based on manufacturer requirements, asset condition, warranty terms, or standard practice?";
  }
  if (status === "insufficient_evidence" && brief.highest_value_next_question?.priority_reason !== "no_open_question") {
    return brief.highest_value_next_question.question;
  }
  if (status === "owner_decision_required") return "Would you like to approve, defer, decline, or request more explanation for this recommendation?";
  return undefined;
}

function synthesisForStatus(status: KeeprActionJustificationStatus, conflicts: KeeprAuthorityConflict[]) {
  if (status === "no_action_required") {
    return "No source-supported action is justified now. Continue normal use and reassess only when source data changes.";
  }
  if (status === "action_required") return "A mandatory, warranty, legal, or manufacturer authority supports action.";
  if (status === "action_supported") return "An asset-specific professional finding supports action consideration.";
  if (status === "action_optional") return "A recommendation or customary practice may be considered, but it is not a requirement.";
  if (status === "clarification_required") return "A recommendation is present, but its authority basis needs clarification before treating it as asset-specific work.";
  if (status === "owner_decision_required") return "Owner agency is required because authorities or preferences point to different acceptable paths.";
  if (status === "professional_assessment_required") return "Professional assessment is needed before converting the available context into a plan.";
  if (status === "conflict_unresolved") return `Resolve ${conflicts.length} authority conflict${conflicts.length === 1 ? "" : "s"} before choosing a stewardship path.`;
  return "Evidence is insufficient to justify action.";
}

function visibilityFor(brief: KaiAssetBrief) {
  if (brief.brief_status === "restricted") return "restricted";
  return "owner_private";
}

function dedupeStatements(statements: KeeprAuthorityStatement[]) {
  const seen = new Set<string>();
  const out: KeeprAuthorityStatement[] = [];
  for (const statement of statements) {
    const key = statement.statement_id || `${statement.authority_class}:${statement.title}:${statement.statement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(statement);
  }
  return out;
}

function semanticFacts(brief: KaiAssetBrief) {
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const fact of brief.known_facts) {
    if (fact.visibility === "restricted") continue;
    const semantic = semanticFactLabel(fact);
    if (INTERNAL_LABEL_PATTERNS.some((pattern) => pattern.test(semantic))) continue;
    if (seen.has(semantic)) continue;
    seen.add(semantic);
    facts.push(semantic);
  }
  return facts;
}

export function buildKeeprReconciledDecisionContext(
  input: BuildKeeprReconciledDecisionInput,
): KeeprReconciledDecisionContext {
  const brief = input.brief;
  const diagnostics: ManifestDiagnostic[] = [];
  const generated_at = input.generated_at || new Date().toISOString();
  const facts = brief.known_facts
    .filter((fact) => fact.visibility !== "restricted")
    .map(normalizeFactStatement);
  const profile = profileStatements(input.stewardship_profile, brief);
  const rawExternal = input.statements || [];
  if (rawExternal.some((statement) => hasForbiddenText(statement))) {
    diagnostics.push(diagnostic(
      "authority_statement_redacted",
      "warning",
      "One or more authority statements contained prohibited private or infrastructure content and were excluded.",
    ));
  }
  const external = rawExternal
    .filter((statement) => !hasForbiddenText(statement))
    .map(normalizeExternalStatement);
  let statements = dedupeStatements([...facts, ...profile, ...external]);

  if (hasForbiddenText(statements)) {
    diagnostics.push(diagnostic(
      "authority_statement_redacted",
      "warning",
      "One or more authority statements contained prohibited private or infrastructure content and were excluded.",
    ));
    statements = statements.filter((statement) => !hasForbiddenText(statement));
  }

  const conflicts = detectConflicts(statements);
  const status = actionStatus(statements, conflicts, brief);
  const prioritized_gaps = brief.missing_or_uncertain_facts.map((gap) => {
    const priority = priorityForGap(gap, brief);
    return {
      gap_id: gap.id,
      label: safeText(gap.label, "Open knowledge gap"),
      priority,
      reason: gapReason(gap, priority),
    };
  });

  return {
    reconciliation_version: "1.0",
    generated_at,
    purpose: brief.purpose,
    kac: brief.kac,
    canonical_asset_id: brief.canonical_asset_id,
    asset_type: brief.asset_type,
    statements_considered: statements,
    aligned_statements: statements.filter((statement) =>
      !conflicts.some((item) => item.statement_ids.includes(statement.statement_id)) &&
      statement.applicability !== "insufficient_evidence" &&
      isCurrent(statement)
    ),
    conflicting_statements: conflicts,
    unresolved_statements: statements.filter((statement) =>
      statement.applicability === "insufficient_evidence" ||
      statement.applicability === "disputed" ||
      statement.dispute_status !== "none" ||
      statement.requirement_strength === "unknown"
    ),
    owner_preference_context: statements.filter((statement) => statement.authority_class === "owner_preference"),
    professional_input_context: statements.filter((statement) =>
      statement.authority_class === "professional_finding" ||
      statement.authority_class === "professional_recommendation" ||
      statement.authority_class === "standard_service_practice"
    ),
    authoritative_requirement_context: statements.filter((statement) =>
      statement.authority_class === "manufacturer_requirement" ||
      statement.authority_class === "warranty_obligation" ||
      statement.authority_class === "legal_or_compliance_requirement"
    ),
    kai_synthesis: synthesisForStatus(status, conflicts),
    action_justification_status: status,
    no_action_justification_status: status === "no_action_required" ? "supported" : status === "insufficient_evidence" ? "insufficient_evidence" : "not_supported",
    owner_decision_required: status === "owner_decision_required" || conflicts.some((item) => item.owner_decision_required),
    recommended_question: recommendedQuestion(status, statements, conflicts, brief),
    permitted_capabilities: brief.permitted_next_capabilities,
    provenance: brief.provenance_references,
    visibility: visibilityFor(brief),
    semantic_facts: semanticFacts(brief),
    prioritized_gaps,
    diagnostics: [...brief.diagnostics, ...diagnostics].filter((item) => !hasForbiddenText(item)),
  };
}
