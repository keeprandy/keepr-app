import { supabase } from "./supabaseClient";

export const KAI_INTELLIGENCE_ENDPOINT =
  "https://jjzjuqxysucqutgjnrkk.supabase.co/functions/v1/kac-intelligence-orchestration";

export const KAI_INTELLIGENCE_PURPOSE = "asset_stewardship";

const DIMENSION_TITLES = {
  identity: "Identity",
  systems: "Systems",
  history: "History",
  evidence: "Evidence",
  maintenance: "Maintenance",
  continuity: "Continuity",
};

const STATUS_LABELS = {
  complete: "Ready",
  complete_empty: "Ready",
  ready: "Ready",
  partial: "Partial",
  attention: "Partial",
  missing: "Missing",
  unknown: "Not evaluated",
  restricted: "Not evaluated",
  not_visible: "Not evaluated",
  failed: "Not evaluated",
  unsupported: "Not evaluated",
};

const CATEGORY_NAMES = new Set([
  "asset",
  "boat",
  "home",
  "marine",
  "other",
  "vehicle",
]);

const INTERNAL_WORDS = [
  "manifest",
  "collector",
  "context envelope",
  "deterministic fallback",
  "orchestration",
  "service_records",
  "story_events",
  "timeline_records",
  "attachment_placements",
  "asset_identifiers",
  "master_assets",
  "safe_metadata",
  "source_table",
  "row_id",
  "postgrest",
  "sql",
  "stack trace",
];

const OWNER_READINESS_SUMMARIES = {
  identity: {
    Ready: "Identifying details are documented.",
    Partial: "Some identifying details still need confirmation.",
    Missing: "Identifying details are missing.",
    "Not evaluated": "Identity has not been evaluated yet.",
  },
  systems: {
    Ready: "System details are available for review.",
    Partial: "Some systems are missing model or serial information.",
    Missing: "Systems have not been documented yet.",
    "Not evaluated": "Systems have not been evaluated yet.",
  },
  history: {
    Ready: "Documented service and ownership history is available.",
    Partial: "Some history is available, but the record is incomplete.",
    Missing: "Documented service or ownership history is missing.",
    "Not evaluated": "History has not been evaluated yet.",
  },
  evidence: {
    Ready: "Supporting records and attachments are available.",
    Partial: "Some supporting evidence is present, but more would help.",
    Missing: "Supporting records or attachments are missing.",
    "Not evaluated": "Evidence has not been evaluated yet.",
  },
  maintenance: {
    Ready: "Maintenance history is available for review.",
    Partial: "Some maintenance context is available, but gaps remain.",
    Missing: "Maintenance history is missing.",
    "Not evaluated": "Maintenance has not been evaluated yet.",
  },
  continuity: {
    Ready: "The asset's record is connected across its documented history.",
    Partial: "The asset's record is partly connected, with gaps remaining.",
    Missing: "The asset's continuity record is missing.",
    "Not evaluated": "Continuity has not been evaluated yet.",
  },
};

const LOW_VALUE_SYSTEM_TERMS = [
  "accessory",
  "axle",
  "bluetooth",
  "cruise control",
  "gasket",
  "mat",
  "mats",
  "seal",
  "seals",
  "trim",
];

const MAJOR_SYSTEM_TERMS = [
  "battery",
  "brake",
  "cooling",
  "drive",
  "drivetrain",
  "electronics",
  "engine",
  "generator",
  "hvac",
  "navigation",
  "propulsion",
  "seakeeper",
  "steering",
  "transmission",
];

const SENSITIVE_KEYS = new Set([
  "bucket",
  "path",
  "storage_path",
  "storagePath",
  "object_key",
  "objectKey",
  "signed_url",
  "signedUrl",
  "url",
  "download_url",
  "downloadUrl",
  "email",
  "phone",
  "address",
  "home_address",
  "work_address",
  "postal_address",
  "access_token",
  "refresh_token",
  "authorization",
  "apikey",
  "secret",
  "service_role",
  "row_id",
  "source_table",
  "provenance",
]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text;
}

function titleCase(value) {
  return cleanText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizedText(value) {
  return cleanText(value).toLowerCase();
}

function isCategoryOnlyName(value) {
  return CATEGORY_NAMES.has(normalizedText(value));
}

function meaningfulText(value) {
  const text = cleanText(value);
  if (!text || isCategoryOnlyName(text)) return "";
  return text;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function containsSensitiveString(value) {
  const text = String(value || "");
  return (
    /\/storage\/v1\/object\//i.test(text) ||
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
    /\b(select|insert|update|delete|alter|drop)\s+.+\s+(from|into|table)\b/i.test(text) ||
    /\b(TypeError|ReferenceError|PostgrestError|stack|at\s+\w+\s+\()/i.test(text) ||
    /\b(access_token|refresh_token|service_role|authorization|apikey|secret)\b/i.test(text)
  );
}

export function detectOwnerFacingLeakage(value) {
  const raw = JSON.stringify(value || {});
  return {
    storage_bucket_name: /"bucket"\s*:\s*"[^"]+"/i.test(raw),
    storage_path_value: /"(storage_path|storagePath|object_key|objectKey|path)"\s*:\s*"[^"]+"/i.test(raw),
    signed_url: /\/storage\/v1\/object\/sign\//i.test(raw),
    storage_object_url: /\/storage\/v1\/object\//i.test(raw),
    jwt_like_value: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(raw),
    email_value: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw),
    raw_sql: /\b(select|insert|update|delete|alter|drop)\s+.+\s+(from|into|table)\b/i.test(raw),
    stack_trace: /\b(TypeError|ReferenceError|PostgrestError|stack|at\s+\w+\s+\()/i.test(raw),
    secret_like_value: /\b(access_token|refresh_token|service_role|authorization|apikey|secret)\b/i.test(raw),
  };
}

export function sanitizeOwnerValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeOwnerValue).filter((item) => item !== undefined);
  if (!isPlainObject(value)) {
    if (typeof value === "string" && containsSensitiveString(value)) return undefined;
    return value;
  }

  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    const sanitized = sanitizeOwnerValue(nested);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return next;
}

function ownerStatusLabel(status) {
  if (status === "complete") return "Ready";
  if (status === "partial") return "Some context is incomplete";
  if (status === "restricted") return "Some information is unavailable";
  return "Not evaluated";
}

function currentStateLabel(status) {
  if (status === "restricted") return "Some information is unavailable";
  return "Based on confirmed Keepr information";
}

function readinessStatus(status) {
  return STATUS_LABELS[status] || "Not evaluated";
}

function ownerReadinessSummary(dimension, status, fallback) {
  const label = readinessStatus(status);
  return OWNER_READINESS_SUMMARIES[dimension]?.[label] || cleanText(fallback || "");
}

function safeDiagnosticMessage(diagnostic) {
  const code = String(diagnostic?.code || "");
  if (code.includes("not_visible")) return "Some information is not visible for this update.";
  if (code.includes("partial") || code.includes("failure")) return "Some information could not be included.";
  if (code.includes("orphaned")) return "Some evidence needs a clearer relationship.";
  if (code.includes("conflict")) return "Some identity information needs review.";
  if (code.includes("unresolved")) return "Some related information needs clarification.";
  return "";
}

function summarizeCollector(summary) {
  const status = summary?.status || "unknown";
  const label = summary?.collector === "timeline" ? "history" : summary?.collector;
  const diagnostic = (summary?.diagnostics || []).map(safeDiagnosticMessage).find(Boolean);
  return {
    area: titleCase(label || "context"),
    status: readinessStatus(status),
    count: Number(summary?.association_count || 0),
    message: diagnostic || "",
  };
}

function knownFactLabel(fact) {
  return cleanText(fact?.label || fact?.title || fact?.name || fact?.id, "Known fact");
}

function knownFactValue(fact) {
  const value = cleanText(fact?.value || fact?.summary || fact?.description || "");
  if (!value) return "";
  const confidence = String(fact?.confidence_state || fact?.proof_state || "").toLowerCase();
  if (confidence.includes("configured") || confidence.includes("provisional") || confidence.includes("reported")) {
    return `${value} (${confidence.includes("reported") ? "reported" : "configured/provisional"})`;
  }
  return value;
}

function toKnownFact(fact) {
  const safe = sanitizeOwnerValue(fact) || {};
  return {
    id: cleanText(safe.id || safe.label || safe.value, "fact"),
    label: knownFactLabel(safe),
    value: knownFactValue(safe),
    category: titleCase(safe.category || "context"),
    confidence: titleCase(safe.confidence_state || safe.proof_state || "supported"),
  };
}

function ownerAttention(item) {
  const title = normalizedText(item?.title || item?.label || item?.question || item?.gap_type || item?.id);
  if (title.includes("supplemental asset identifier") || title.includes("asset identifier")) {
    return {
      title: "Add another identifying detail.",
      explanation: "A VIN, serial number, registration, or other identifier would make this asset easier to verify.",
    };
  }
  if (title.includes("identity context") || title.includes("identity")) {
    return {
      title: "Confirm the asset's identifying details.",
      explanation: "A few identifying details still need review.",
    };
  }
  if (title.includes("systems context") || title.includes("system")) {
    return {
      title: "Some systems still need identifying information.",
      explanation: "Model or serial details would make the system record more useful.",
    };
  }
  if (title.includes("evidence") || title.includes("attachment") || title.includes("proof")) {
    return {
      title: "Add supporting evidence where it is missing.",
      explanation: "Receipts, photos, or service records can strengthen the asset history.",
    };
  }
  return null;
}

function toAttentionItem(item) {
  const safe = sanitizeOwnerValue(item) || {};
  const translated = ownerAttention(safe);
  return {
    id: cleanText(safe.id || safe.label || safe.title, "attention"),
    title: translated?.title || cleanText(safe.title || safe.label || safe.question, "Needs attention"),
    explanation: translated?.explanation || cleanText(safe.explanation || safe.why_it_matters || safe.summary || ""),
    severity: titleCase(safe.severity || "attention"),
  };
}

function factsFromConfiguredAssociations(manifest) {
  const associations = [
    ...(manifest?.association_groups?.identity || []),
    ...(manifest?.association_groups?.systems || []),
  ];
  return associations
    .map((association) => ({
      metadata: sanitizeOwnerValue(association?.safe_metadata || {}),
      isSystem: Boolean(manifest?.association_groups?.systems?.includes?.(association)),
    }))
    .filter((item) => item.metadata)
    .flatMap(({ metadata, isSystem }, index) => {
      const rows = [];
      for (const [key, value] of Object.entries(metadata)) {
        if (value == null || value === "" || typeof value === "object") continue;
        const normalizedKey = String(key).toLowerCase();
        if (!["year", "make", "manufacturer", "model", "type", "asset_subtype", "system_type", "name"].includes(normalizedKey)) continue;
        rows.push({
          id: `configured:${index}:${key}`,
          label: titleCase(key),
          value: String(value),
          category: isSystem || normalizedKey.includes("system") ? "Systems" : "Identity",
          confidence: "Configured/Provisional",
        });
      }
      return rows;
    });
}

function collectorCount(manifest, collector) {
  return Number((manifest?.collector_summaries || []).find((item) => item?.collector === collector)?.association_count || 0);
}

function identityFactsFromManifest(manifest, canonical, fallback) {
  const metadata = [
    ...(manifest?.association_groups?.identity || []).map((association) => sanitizeOwnerValue(association?.safe_metadata || {})),
    sanitizeOwnerValue(canonical || {}),
    sanitizeOwnerValue(fallback || {}),
  ].filter(Boolean);

  const rows = [];
  const add = (label, value, id) => {
    const text = meaningfulText(value);
    if (!text) return;
    rows.push({ id, label, value: text, category: "Identity", confidence: "Supported", rank: 10 });
  };

  for (const source of metadata) {
    add("Year", source.year || source.model_year, "identity:year");
    add("Make", source.make || source.manufacturer || source.oem, "identity:make");
    add("Model", source.model, "identity:model");
    add("Asset type", source.asset_subtype || source.subtype || source.type, "identity:subtype");
    add("Name", source.name || source.label, "identity:name");
  }

  if (manifest?.kac) rows.push({ id: "identity:kac", label: "Keepr Asset Code", value: manifest.kac, category: "Ownership Record", confidence: "Supported", rank: 20 });
  return rows;
}

function summaryFactsFromManifest(manifest) {
  const rows = [];
  const historyCount = collectorCount(manifest, "timeline");
  const evidenceCount = collectorCount(manifest, "attachments");
  if (historyCount) rows.push({ id: "summary:history", label: "Documented history", value: `${historyCount} record${historyCount === 1 ? "" : "s"}`, category: "Ownership Record", confidence: "Supported", rank: 30 });
  if (evidenceCount) rows.push({ id: "summary:evidence", label: "Supporting evidence", value: `${evidenceCount} item${evidenceCount === 1 ? "" : "s"}`, category: "Ownership Record", confidence: "Supported", rank: 31 });
  return rows;
}

function isLowValueSystemText(value) {
  const text = normalizedText(value);
  return LOW_VALUE_SYSTEM_TERMS.some((term) => text.includes(term));
}

function isMajorSystemText(value) {
  const text = normalizedText(value);
  return MAJOR_SYSTEM_TERMS.some((term) => text.includes(term));
}

function rankedKnownFact(fact) {
  const label = normalizedText(fact?.label);
  const value = normalizedText(fact?.value);
  const category = normalizedText(fact?.category);
  const combined = `${label} ${value}`;
  let rank = Number.isFinite(fact?.rank) ? fact.rank : 80;

  if (["year", "make", "model", "asset type", "name"].includes(label)) rank = Math.min(rank, 10);
  else if (label.includes("keepr asset code") || category.includes("ownership")) rank = Math.min(rank, 20);
  else if (category.includes("identity")) rank = Math.min(rank, 15);
  else if (category.includes("history") || category.includes("evidence")) rank = Math.min(rank, 30);
  else if (category.includes("system")) rank = isMajorSystemText(combined) ? Math.min(rank, 50) : 90;

  if (isLowValueSystemText(combined)) rank = 120;
  return { ...fact, rank };
}

function curatedKnownFacts(items) {
  const ranked = uniqueByLabelValue(items)
    .filter((fact) => fact.label && fact.value)
    .map(rankedKnownFact)
    .sort((a, b) => a.rank - b.rank || String(a.label).localeCompare(String(b.label)))
    .filter((fact) => fact.rank < 120);

  const primary = ranked.filter((fact) => !normalizedText(fact.category).includes("system")).slice(0, 6);
  const systems = ranked.filter((fact) => normalizedText(fact.category).includes("system") && isMajorSystemText(`${fact.label} ${fact.value}`)).slice(0, 2);
  return uniqueByLabelValue([...primary, ...systems])
    .slice(0, 8)
    .map(({ rank, ...fact }) => fact);
}

function readinessByDimension(readiness) {
  return Object.fromEntries((readiness || []).map((item) => [item.dimension, item.status]));
}

function currentStateCopy(body, status, readiness, fallbackHeadline, fallbackSubheadline) {
  if (status === "restricted") {
    return {
      headline: "Some information is unavailable",
      subheadline: "Keepr can only show the information available for your current access.",
    };
  }

  const byDimension = readinessByDimension(readiness);
  const hasPartialIdentityOrSystems = ["Partial", "Missing", "Not evaluated"].includes(byDimension.identity) || ["Partial", "Missing", "Not evaluated"].includes(byDimension.systems);
  const hasStrongHistory = byDimension.history === "Ready" && byDimension.evidence === "Ready" && byDimension.continuity === "Ready";

  if (hasStrongHistory && hasPartialIdentityOrSystems) {
    return {
      headline: "Keepr has a strong history for this asset.",
      subheadline: "Service, evidence, and continuity are documented. Some identity and system details still need review.",
    };
  }

  const headline = cleanText(fallbackHeadline, "Keepr has useful context for this asset.");
  const subheadline = cleanText(fallbackSubheadline, "This update is based on the information currently available in Keepr.");
  const overstates = /understands this asset well|well documented|clear ownership picture/i.test(`${headline} ${subheadline}`) && hasPartialIdentityOrSystems;
  if (overstates) {
    return {
      headline: "Keepr has useful context for this asset.",
      subheadline: "Some details still need review before the record is complete.",
    };
  }

  return { headline, subheadline };
}

function systemNameForMissingIdentity(manifest) {
  const systems = manifest?.association_groups?.systems || [];
  for (const association of systems) {
    const metadata = sanitizeOwnerValue(association?.safe_metadata || {}) || {};
    const name = meaningfulText(metadata.name || metadata.label || metadata.system_type || metadata.type);
    if (!name || isLowValueSystemText(name)) continue;
    if (!metadata.model || !metadata.serial_number) return name;
  }
  return "";
}

function nextBestStep(nextQuestion, manifest) {
  const question = cleanText(nextQuestion?.question);
  if (!question) return null;
  if (/system.*missing.*model|system.*serial|model or serial/i.test(question)) {
    const systemName = systemNameForMissingIdentity(manifest);
    return {
      question: systemName ? `Add the model or serial number for ${systemName}.` : "Review systems missing model or serial information.",
      reason: cleanText(nextQuestion?.reason || nextQuestion?.priority_reason || ""),
    };
  }
  return {
    question,
    reason: cleanText(nextQuestion?.reason || nextQuestion?.priority_reason || ""),
  };
}

function uniqueByLabelValue(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.label}:${item.value || item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildReadinessCards(body) {
  const cards = body?.asset_brief?.readiness_cards || [];
  const fromBrief = cards.map((card) => ({
    dimension: card.dimension,
    title: DIMENSION_TITLES[card.dimension] || cleanText(card.title, "Context"),
    status: readinessStatus(card.status),
    summary: ownerReadinessSummary(card.dimension, card.status, card.summary),
  }));

  const byDimension = new Map(fromBrief.map((card) => [card.dimension, card]));
  return Object.keys(DIMENSION_TITLES).map((dimension) => (
    byDimension.get(dimension) || {
      dimension,
      title: DIMENSION_TITLES[dimension],
      status: "Not evaluated",
      summary: ownerReadinessSummary(dimension, "unknown", ""),
    }
  ));
}

function buildCapabilities(body) {
  const entries = body?.permitted_capabilities || body?.asset_brief?.permitted_next_capabilities || [];
  return entries
    .filter((entry) => entry?.enabled)
    .map((entry) => ({
      key: entry.key,
      label: cleanText(entry.label || titleCase(entry.key), ""),
    }))
    .filter((entry) => entry.label && ["can_review_gaps", "can_add_evidence"].includes(entry.key));
}

export function buildKeeprIntelligenceUpdateViewModel(body, fallback = {}) {
  const safeBody = sanitizeOwnerValue(body) || {};
  const manifest = safeBody.manifest || {};
  const brief = safeBody.asset_brief || {};
  const canonical = safeBody.canonical_asset || manifest.asset || {};
  const status = manifest.status || brief.brief_status || "unknown";
  const leakageMarkers = detectOwnerFacingLeakage(safeBody);
  const fallbackIdentity = { name: fallback.assetName, type: fallback.assetType };

  const configuredFacts = factsFromConfiguredAssociations(safeBody.manifest);
  const readiness = buildReadinessCards(safeBody);
  const knownFacts = curatedKnownFacts([
    ...identityFactsFromManifest(manifest, canonical, fallbackIdentity),
    ...summaryFactsFromManifest(manifest),
    ...(brief.known_facts || []).map(toKnownFact),
    ...configuredFacts,
  ]);

  const attentionItems = uniqueByLabelValue([
    ...(brief.attention_items || []).map(toAttentionItem),
    ...(brief.missing_or_uncertain_facts || []).map(toAttentionItem),
  ])
    .filter((item) => item.title)
    .slice(0, 6);

  const nextQuestion = safeBody.highest_value_next_question || brief.highest_value_next_question || null;
  const stateCopy = currentStateCopy(safeBody, status, readiness, brief.headline, brief.subheadline);
  const bestName =
    meaningfulText(canonical.name) ||
    meaningfulText(brief.asset_display_identity?.label) ||
    meaningfulText(manifest.asset?.name) ||
    meaningfulText(fallback.assetName) ||
    meaningfulText(knownFacts.find((fact) => fact.label === "Name")?.value) ||
    "This asset";

  return {
    state: status === "restricted" ? "restricted" : "ready",
    responseVersion: safeBody.response_version || "",
    generatedAt: safeBody.generated_at || brief.generated_at || "",
    kac: canonical.kac_id || manifest.kac || safeBody.kac || fallback.kac || "",
    assetName: bestName,
    assetType: canonical.type || brief.asset_type || fallback.assetType || "",
    access: {
      status: cleanText(body?.authorization?.status || "authorized"),
      role: cleanText(body?.authorization?.role || body?.asset_brief?.caller_authorization_role || body?.manifest?.authorization?.access || ""),
    },
    ownerStatus: ownerStatusLabel(status),
    currentState: {
      headline: stateCopy.headline,
      subheadline: stateCopy.subheadline,
      contextStatus: currentStateLabel(safeBody.operational_status || status),
      completeness: ownerStatusLabel(status),
    },
    readiness,
    knownFacts,
    attentionItems,
    collectorSummaries: (manifest.collector_summaries || []).map(summarizeCollector),
    nextBestStep: nextBestStep(nextQuestion, manifest),
    capabilities: buildCapabilities(safeBody),
    footer: "This update is based on the information currently available in Keepr.",
    leakageMarkers,
  };
}

export function buildKeeprIntelligenceErrorViewModel(status, body = {}) {
  if (status === 401) {
    return {
      state: "session_expired",
      title: "Please sign in again",
      message: "Your Keepr session has expired. Sign in again to view this intelligence update.",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      state: "concealed",
      title: "Intelligence update unavailable",
      message: "Keepr could not load an intelligence update for this asset.",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      state: "restricted",
      title: "Some information is unavailable",
      message: "This Keepr Intelligence Update is not available for your current access level.",
      retryable: false,
    };
  }
  return {
    state: "endpoint_unavailable",
    title: "Unable to load update",
    message: cleanText(body?.message, "Keepr Intelligence is temporarily unavailable."),
    retryable: true,
  };
}

export async function fetchKeeprIntelligenceUpdate({ kac, assetName, assetType, client = supabase, fetchImpl = fetch }) {
  const normalizedKac = cleanText(kac).toUpperCase();
  if (!normalizedKac) {
    return {
      ok: false,
      status: 400,
      viewModel: {
        state: "empty",
        title: "Intelligence update unavailable",
        message: "This asset does not yet have a Keepr Asset Code.",
        retryable: false,
      },
    };
  }

  const sessionResult = await client.auth.getSession();
  const token = sessionResult?.data?.session?.access_token;
  if (!token) {
    return { ok: false, status: 401, viewModel: buildKeeprIntelligenceErrorViewModel(401) };
  }

  try {
    const response = await fetchImpl(KAI_INTELLIGENCE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kac: normalizedKac, purpose: KAI_INTELLIGENCE_PURPOSE }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, viewModel: buildKeeprIntelligenceErrorViewModel(response.status, body) };
    }
    return {
      ok: true,
      status: response.status,
      viewModel: buildKeeprIntelligenceUpdateViewModel(body, { kac: normalizedKac, assetName, assetType }),
    };
  } catch {
    return { ok: false, status: 0, viewModel: buildKeeprIntelligenceErrorViewModel(0) };
  }
}
