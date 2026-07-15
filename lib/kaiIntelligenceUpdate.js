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

function toAttentionItem(item) {
  const safe = sanitizeOwnerValue(item) || {};
  return {
    id: cleanText(safe.id || safe.label || safe.title, "attention"),
    title: cleanText(safe.title || safe.label || safe.question, "Needs attention"),
    explanation: cleanText(safe.explanation || safe.why_it_matters || safe.summary || ""),
    severity: titleCase(safe.severity || "attention"),
  };
}

function factsFromConfiguredAssociations(manifest) {
  const associations = [
    ...(manifest?.association_groups?.identity || []),
    ...(manifest?.association_groups?.systems || []),
  ];
  return associations
    .map((association) => sanitizeOwnerValue(association?.safe_metadata || {}))
    .filter(Boolean)
    .flatMap((metadata, index) => {
      const rows = [];
      for (const [key, value] of Object.entries(metadata)) {
        if (value == null || value === "" || typeof value === "object") continue;
        const normalizedKey = String(key).toLowerCase();
        if (!["year", "make", "manufacturer", "model", "type", "asset_subtype", "system_type", "name"].includes(normalizedKey)) continue;
        rows.push({
          id: `configured:${index}:${key}`,
          label: titleCase(key),
          value: String(value),
          category: normalizedKey.includes("system") ? "Systems" : "Identity",
          confidence: "Configured/Provisional",
        });
      }
      return rows;
    });
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
    summary: cleanText(card.summary || ""),
  }));

  const byDimension = new Map(fromBrief.map((card) => [card.dimension, card]));
  return Object.keys(DIMENSION_TITLES).map((dimension) => (
    byDimension.get(dimension) || {
      dimension,
      title: DIMENSION_TITLES[dimension],
      status: "Not evaluated",
      summary: "",
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

  const configuredFacts = factsFromConfiguredAssociations(safeBody.manifest);
  const knownFacts = uniqueByLabelValue([
    ...(brief.known_facts || []).map(toKnownFact),
    ...configuredFacts,
  ])
    .filter((fact) => fact.label && fact.value)
    .slice(0, 8);

  const attentionItems = uniqueByLabelValue([
    ...(brief.attention_items || []).map(toAttentionItem),
    ...(brief.missing_or_uncertain_facts || []).map(toAttentionItem),
  ])
    .filter((item) => item.title)
    .slice(0, 6);

  const nextQuestion = safeBody.highest_value_next_question || brief.highest_value_next_question || null;

  return {
    state: status === "restricted" ? "restricted" : "ready",
    responseVersion: safeBody.response_version || "",
    generatedAt: safeBody.generated_at || brief.generated_at || "",
    kac: canonical.kac_id || manifest.kac || safeBody.kac || fallback.kac || "",
    assetName: canonical.name || brief.asset_display_identity?.label || fallback.assetName || "This asset",
    assetType: canonical.type || brief.asset_type || fallback.assetType || "",
    access: {
      status: cleanText(body?.authorization?.status || "authorized"),
      role: cleanText(body?.authorization?.role || body?.asset_brief?.caller_authorization_role || body?.manifest?.authorization?.access || ""),
    },
    ownerStatus: ownerStatusLabel(status),
    currentState: {
      headline: cleanText(brief.headline, status === "restricted" ? "Some information is unavailable" : "Keepr Intelligence Update"),
      subheadline: cleanText(brief.subheadline, "This update is based on the information currently available in Keepr."),
      contextStatus: currentStateLabel(safeBody.operational_status || status),
      completeness: ownerStatusLabel(status),
    },
    readiness: buildReadinessCards(safeBody),
    knownFacts,
    attentionItems,
    collectorSummaries: (manifest.collector_summaries || []).map(summarizeCollector),
    nextBestStep: nextQuestion?.question
      ? {
          question: cleanText(nextQuestion.question),
          reason: cleanText(nextQuestion.reason || nextQuestion.priority_reason || ""),
        }
      : null,
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
