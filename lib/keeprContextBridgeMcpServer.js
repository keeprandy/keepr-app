import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const READ_SCOPE = "keepr.context.read";
const CONTRIBUTE_SCOPE = "keepr.context.contribute";
const CONTRACT = "keepr.chatgpt_context_bridge.v1";
const MAX_CONTEXT_ROWS = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function getBearer(req) {
  const headers = req?.headers || {};
  const header =
    typeof headers.get === "function"
      ? headers.get("authorization")
      : headers.authorization || headers.Authorization;
  const match = safeString(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function getSupabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}

function createUserSupabase(req) {
  const { url, anonKey } = getSupabaseEnv();
  const bearer = getBearer(req);
  if (!url || !anonKey || !bearer) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
}

async function authenticate(req) {
  const supabase = createUserSupabase(req);
  const bearer = getBearer(req);
  if (!supabase || !bearer) {
    const error = new Error("authentication_required");
    error.status = 401;
    throw error;
  }
  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data?.user?.id) {
    const next = new Error("invalid_or_expired_token");
    next.status = 401;
    throw next;
  }
  return { supabase, user: data.user };
}

function textResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function mcpErrorResult(message, data = undefined) {
  return {
    ...textResult(data === undefined ? { error: message } : { error: message, data }),
    isError: true,
  };
}

function normalizeHint(value) {
  return safeString(value).toLowerCase();
}

function normalizeKacHint(value) {
  let hint = safeString(value);
  if (!hint) return "";
  try {
    hint = decodeURIComponent(hint);
  } catch {
    // Keep the original value when it is not URI encoded.
  }
  return hint
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/(context|ai)\/?$/i, "")
    .replace(/^\/?(?:api\/)?k\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .toLowerCase();
}

function scoreAsset(asset, args) {
  const hint = normalizeHint(args.asset_hint || args.asset || args.name);
  const kac = normalizeKacHint(args.kac_id || args.address);
  const assetId = safeString(args.asset_id);
  if (assetId) return asset.id === assetId ? 100 : 0;
  if (kac) return normalizeHint(asset.kac_id) === kac ? 100 : 0;
  if (!hint) return 1;
  const name = normalizeHint(asset.name);
  const type = normalizeHint(asset.type);
  if (name === hint) return 90;
  if (name.includes(hint)) return 70;
  if (hint.includes(name) && name) return 60;
  if (type && hint.includes(type)) return 20;
  return 0;
}

async function listAuthorizedAssets(supabase) {
  const { data, error } = await supabase.rpc("get_authorized_assets", {
    p_asset_type: null,
    p_include_deleted: false,
  });
  if (!error && Array.isArray(data)) {
    return data.map((row) => ({
      id: row.id || row.asset_id,
      name: row.name || row.asset_name,
      type: row.type || row.asset_type,
      kac_id: row.kac_id || row.kac,
      access: row.access_indicator || "authorized",
      owner_id: row.owner_id || null,
    })).filter((asset) => asset.id);
  }

  const fallback = await supabase
    .from("assets")
    .select("id,name,type,kac_id,owner_id,status,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (fallback.error) throw fallback.error;
  return asArray(fallback.data).map((asset) => ({ ...asset, access: "authorized" }));
}

async function resolveAsset(supabase, args) {
  const assets = await listAuthorizedAssets(supabase);
  const scored = assets
    .map((asset) => ({ asset, score: scoreAsset(asset, args) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const error = new Error("asset_not_resolved");
    error.data = { available_assets: assets.map(({ id, name, type, kac_id }) => ({ id, name, type, kac_id })) };
    throw error;
  }
  const topScore = scored[0].score;
  const ties = scored.filter((entry) => entry.score === topScore);
  if (ties.length > 1 && topScore < 100) {
    const error = new Error("asset_resolution_ambiguous");
    error.data = { matches: ties.map(({ asset }) => ({ id: asset.id, name: asset.name, type: asset.type, kac_id: asset.kac_id })) };
    throw error;
  }
  return scored[0].asset;
}

async function resolveSystem(supabase, assetId, args) {
  const hint = safeString(args.system_hint || args.system || args.system_name || args.system_id);
  if (!hint) return null;
  const { data, error } = await supabase
    .from("systems")
    .select("id,asset_id,name,system_type,status,created_at,updated_at")
    .eq("asset_id", assetId)
    .limit(100);
  if (error) throw error;
  const normalized = normalizeHint(hint);
  const scored = asArray(data)
    .map((system) => {
      const name = normalizeHint(system.name);
      const type = normalizeHint(system.system_type);
      const score = UUID_RE.test(hint) && system.id === hint
        ? 100
        : name === normalized
          ? 90
          : name.includes(normalized)
            ? 70
            : normalized.includes(name) && name
              ? 60
              : type === normalized
                ? 40
                : 0;
      return { system, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    const next = new Error("system_not_resolved");
    next.data = {
      requested_system: hint,
      available_systems: asArray(data).map(({ id, name, system_type }) => ({ id, name, system_type })),
    };
    throw next;
  }
  const ties = scored.filter((entry) => entry.score === scored[0].score);
  if (ties.length > 1 && scored[0].score < 100) {
    const next = new Error("system_resolution_ambiguous");
    next.data = { matches: ties.map(({ system }) => ({ id: system.id, name: system.name, system_type: system.system_type })) };
    throw next;
  }
  return scored[0].system;
}

async function loadScopedRows(supabase, asset, system, args) {
  const threadHint = safeString(args.thread_or_project_hint || args.job_hint || args.project_hint || args.context_hint);
  const [threads, actions, resources, providers, history] = await Promise.all([
    (() => {
      let query = supabase
        .from("asset_threads")
        .select("id,asset_id,system_id,keepr_pro_id,subject,status,source_type,resource_ref,created_at,updated_at")
        .eq("asset_id", asset.id)
        .order("updated_at", { ascending: false })
        .limit(MAX_CONTEXT_ROWS);
      if (system?.id) query = query.eq("system_id", system.id);
      if (threadHint) query = query.ilike("subject", `%${threadHint}%`);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("reminders")
        .select("id,title,notes,due_at,repeat_rule,status,asset_id,system_id,extra_metadata,created_at,updated_at")
        .eq("asset_id", asset.id)
        .not("status", "in", "(deleted,archived,completed)")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(MAX_CONTEXT_ROWS);
      if (system?.id) query = query.eq("system_id", system.id);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("attachment_placements")
        .select(`
          id,
          attachment_id,
          target_type,
          target_id,
          role,
          label,
          attachments (
            id,
            kind,
            title,
            file_name,
            mime_type,
            url,
            created_at,
            source_context,
            ai_metadata,
            extracted_text,
            doc_type
          )
        `)
        .eq("target_type", system?.id ? "system" : "asset")
        .eq("target_id", system?.id || asset.id)
        .limit(MAX_CONTEXT_ROWS);
      return query;
    })(),
    supabase
      .from("asset_provider_stewardships")
      .select("id,asset_id,keepr_pro_id,organization_id,relationship_type,access_scope,status,projection_config,created_at,updated_at")
      .eq("asset_id", asset.id)
      .limit(MAX_CONTEXT_ROWS),
    (() => {
      let query = supabase
        .from("service_records")
        .select("id,asset_id,system_id,keepr_pro_id,title,notes,service_type,category,performed_at,verification_status,created_at")
        .eq("asset_id", asset.id)
        .order("performed_at", { ascending: false, nullsFirst: false })
        .limit(MAX_CONTEXT_ROWS);
      if (system?.id) query = query.eq("system_id", system.id);
      return query;
    })(),
  ]);

  const results = { threads, actions, resources, providers, history };
  for (const [label, result] of Object.entries(results)) {
    if (result.error) {
      results[label] = { data: [], error: result.error.message };
    } else {
      results[label] = { data: result.data || [], error: null };
    }
  }
  return results;
}

function projectResource(row) {
  const attachment = row.attachments || {};
  const sourceContext = asObject(attachment.source_context);
  const aiMetadata = asObject(attachment.ai_metadata);
  return {
    placement_id: row.id,
    attachment_id: row.attachment_id,
    target_type: row.target_type,
    role: row.role || null,
    label: row.label || null,
    title: attachment.title || attachment.file_name || "Resource",
    kind: attachment.kind || null,
    mime_type: attachment.mime_type || null,
    url: attachment.url || null,
    doc_type: attachment.doc_type || null,
    has_extracted_text: Boolean(safeString(attachment.extracted_text)),
    ai_context: aiMetadata.ai_context || aiMetadata.aiContext || aiMetadata.context_role || null,
    knowledge_state: sourceContext.knowledge_state || aiMetadata.knowledge_state || "evidence_available",
    authority_state: sourceContext.authority_state || aiMetadata.authority_state || aiMetadata.authority || null,
    review_state: sourceContext.review_state || aiMetadata.review_state || "unreviewed",
    source_identity: compactObject({
      source_type: sourceContext.source_type,
      source_name: sourceContext.source_name,
      source_url: sourceContext.source_url,
      external_source_id: sourceContext.external_source_id,
    }),
    provenance: attachment.source_context || null,
  };
}

function resourceEligibleForAI(row) {
  const attachment = row?.attachments || {};
  const aiMetadata = asObject(attachment.ai_metadata);
  const role = normalizeHint(aiMetadata.ai_context || aiMetadata.aiContext || aiMetadata.context_role || "supporting");
  return !["off", "exclude", "excluded", "excluded_from_ai"].includes(role);
}

function providerEligibleForScope(provider, system, thread, history) {
  if (!system?.id) return true;
  const projection = asObject(provider.projection_config);
  const systemIds = [
    projection.system_id,
    ...asArray(projection.system_ids),
    ...asArray(projection.authorized_system_ids),
  ].filter(Boolean);
  if (systemIds.includes(system.id)) return true;
  if (thread?.keepr_pro_id && provider.keepr_pro_id === thread.keepr_pro_id) return true;
  return asArray(history).some((record) =>
    record.system_id === system.id &&
    record.keepr_pro_id &&
    record.keepr_pro_id === provider.keepr_pro_id
  );
}

async function getContext(auth, args) {
  const asset = await resolveAsset(auth.supabase, args);
  const system = await resolveSystem(auth.supabase, asset.id, args);
  const rows = await loadScopedRows(auth.supabase, asset, system, args);
  const destination = asArray(rows.threads.data)[0] || null;
  const resources = asArray(rows.resources.data).filter(resourceEligibleForAI).map(projectResource);
  const providerRelationships = asArray(rows.providers.data).filter((provider) =>
    providerEligibleForScope(provider, system, destination, rows.history.data)
  );
  return {
    contract: CONTRACT,
    verb: "get_context",
    scope: compactObject({
      asset_id: asset.id,
      asset_name: asset.name,
      asset_type: asset.type,
      kac_id: asset.kac_id,
      system_id: system?.id,
      system_name: system?.name,
      thread_id: destination?.id,
      thread_subject: destination?.subject,
      requested_hint: safeString(args.asset_hint || args.context_hint),
      requested_job_or_project: safeString(args.thread_or_project_hint || args.job_hint || args.project_hint),
    }),
    context_aperture: {
      policy: "minimum_sufficient_relevant_context",
      included: [
        "resolved asset identity",
        system ? "resolved system identity" : null,
        "matching or recent conversation threads",
        "open actions",
        "scoped resources",
        "provider relationships",
        "recent same-scope service history",
      ].filter(Boolean),
      excluded: [
        "unrelated portfolio assets",
        "canonical fact writes",
        "operational action writes",
      ],
    },
    context: {
      asset: asset,
      system,
      threads: asArray(rows.threads.data),
      actions: asArray(rows.actions.data),
      resources,
      provider_relationships: providerRelationships,
      history: asArray(rows.history.data),
    },
    retrieval_errors: Object.entries(rows)
      .filter(([, result]) => result.error)
      .map(([label, result]) => ({ label, error: result.error })),
    context_used: [
      { source: "asset", id: asset.id, reason: "resolved exact Asset scope" },
      system ? { source: "system", id: system.id, reason: "resolved requested System scope" } : null,
      destination ? { source: "thread", id: destination.id, reason: "matched current purpose or recent Asset conversation" } : null,
      ...resources.map((resource) => ({
        source: "evidence",
        id: resource.attachment_id,
        reason: "eligible evidence is placed in the resolved Asset/System scope",
        authority_state: resource.authority_state,
        knowledge_state: resource.knowledge_state,
      })),
    ].filter(Boolean),
    excluded_context: [
      {
        source: "portfolio",
        reason: "assets outside the resolved KAC are never retrieved",
      },
      asArray(rows.resources.data).length > resources.length
        ? { source: "evidence", count: asArray(rows.resources.data).length - resources.length, reason: "resource AI context explicitly excludes it" }
        : null,
      asArray(rows.providers.data).length > providerRelationships.length
        ? { source: "provider_relationship", count: asArray(rows.providers.data).length - providerRelationships.length, reason: "relationship is not demonstrably relevant to the resolved System" }
        : null,
    ].filter(Boolean),
    instructions:
      "Use this Keepr context to reason in ChatGPT. Do not treat this response as permission to write asset facts or actions. Use contribute_context to send a structured contribution back to Keepr.",
  };
}

function contributionBody(args, scope) {
  const contribution = asObject(args.contribution);
  const source = asObject(args.source);
  const lines = [
    "ChatGPT context contribution",
    `Contribution ID: ${scope.contribution_id}`,
    "Review state: pending_review",
    "",
    safeString(contribution.summary) || safeString(args.summary) || "A ChatGPT conversation produced a structured ownership-context contribution.",
    "",
    source.url ? `Source: ${source.url}` : null,
    source.title ? `Source title: ${source.title}` : null,
    "",
    asArray(contribution.decisions).length ? `Decisions:\n${asArray(contribution.decisions).map((item) => `- ${safeString(item) || JSON.stringify(item)}`).join("\n")}` : null,
    asArray(contribution.observations).length ? `Observations:\n${asArray(contribution.observations).map((item) => `- ${safeString(item) || JSON.stringify(item)}`).join("\n")}` : null,
    asArray(contribution.unresolved_questions).length ? `Open questions:\n${asArray(contribution.unresolved_questions).map((item) => `- ${safeString(item) || JSON.stringify(item)}`).join("\n")}` : null,
    asArray(contribution.proposed_actions).length ? `Proposed Actions for review:\n${asArray(contribution.proposed_actions).map((item) => `- ${safeString(item.title || item) || JSON.stringify(item)}`).join("\n")}` : null,
    asArray(contribution.proposed_facts).length ? `Proposed facts/resources for review:\n${asArray(contribution.proposed_facts).map((item) => `- ${safeString(item.statement || item.title || item) || JSON.stringify(item)}`).join("\n")}` : null,
    "",
    `Scope: ${[scope.asset_name, scope.system_name, scope.thread_subject].filter(Boolean).join(" -> ")}`,
  ];
  return lines.filter((line) => line !== null && line !== undefined).join("\n").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function contributionId(args, scope) {
  const clientKey = safeString(args.idempotency_key);
  const payload = clientKey || JSON.stringify(stableValue({
    scope: {
      asset_id: scope.asset_id,
      system_id: scope.system_id,
      thread_id: scope.thread_id,
    },
    source: asObject(args.source),
    contribution: asObject(args.contribution),
  }));
  const digest = createHash("sha256")
    .update(`${CONTRACT}:${scope.asset_id}:${scope.system_id || "asset"}:${payload}`)
    .digest("hex")
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}

async function findExistingContribution(supabase, threadId, id) {
  const { data, error } = await supabase
    .from("asset_thread_messages")
    .select("id,thread_id,from_user_id,body,created_at,sender_type,sender_name")
    .eq("id", id)
    .eq("thread_id", threadId)
    .eq("sender_name", "ChatGPT via Keepr")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function contributionEnvelope(args, scope) {
  return {
    id: scope.contribution_id,
    contract: CONTRACT,
    type: "external_intelligence_context",
    review_state: "pending_review",
    contributor: "ChatGPT via Keepr",
    scope,
    provenance: asObject(args.source),
    contribution: asObject(args.contribution),
    received_at: new Date().toISOString(),
  };
}

async function persistContributionEnvelope(supabase, thread, envelope, updatedAt) {
  const resourceRef = asObject(thread.resource_ref);
  const existing = asArray(resourceRef.context_contributions);
  const contributions = existing.some((entry) => entry?.id === envelope.id)
    ? existing
    : [...existing, envelope].slice(-25);
  const nextResourceRef = { ...resourceRef, context_contributions: contributions };
  const { error } = await supabase
    .from("asset_threads")
    .update({ resource_ref: nextResourceRef, updated_at: updatedAt })
    .eq("id", thread.id);
  if (error) throw error;
  thread.resource_ref = nextResourceRef;
  thread.updated_at = updatedAt;
  return thread;
}

async function findOrCreateContributionThread(supabase, user, asset, system, args) {
  const explicitThreadId = safeString(args.thread_id || args.scope?.thread_id);
  if (explicitThreadId) {
    const { data, error } = await supabase
      .from("asset_threads")
      .select("id,asset_id,system_id,subject,status,source_type,resource_ref,created_at,updated_at")
      .eq("id", explicitThreadId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      const assetMismatch = data.asset_id !== asset.id;
      const systemMismatch = system?.id && data.system_id !== system.id;
      if (assetMismatch || systemMismatch) {
        const next = new Error("thread_scope_mismatch");
        next.data = {
          requested_thread_id: explicitThreadId,
          resolved_asset_id: asset.id,
          resolved_system_id: system?.id || null,
        };
        throw next;
      }
      return data;
    }
  }

  const hint = safeString(args.thread_or_project_hint || args.project_hint || args.job_hint || args.scope?.thread_or_project_hint);
  if (hint) {
    let query = supabase
      .from("asset_threads")
      .select("id,asset_id,system_id,subject,status,source_type,resource_ref,created_at,updated_at")
      .eq("asset_id", asset.id)
      .ilike("subject", `%${hint}%`)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (system?.id) query = query.eq("system_id", system.id);
    const { data, error } = await query;
    if (error) throw error;
    if (data?.[0]?.id) return data[0];
  }

  const subject = hint || `${asset.name || "Asset"} context contribution`;
  const resourceRef = {
    parent_asset_kac: asset.kac_id || null,
    asset_id: asset.id,
    system_id: system?.id || null,
    conversation_intent: "external_intelligence_context_contribution",
    source: "chatgpt",
  };
  const { data, error } = await supabase
    .from("asset_threads")
    .insert({
      asset_id: asset.id,
      system_id: system?.id || null,
      owner_id: asset.owner_id || user.id,
      created_by: user.id,
      subject,
      source_type: "member",
      resource_ref: resourceRef,
      status: "open",
    })
    .select("id,asset_id,system_id,subject,status,source_type,resource_ref,created_at,updated_at")
    .single();
  if (error) throw error;
  return data;
}

async function maybeCreateSourceAttachment(supabase, user, asset, system, thread, message, args, contributionIdValue) {
  const source = asObject(args.source);
  const url = safeString(source.url || args.source_url);
  if (!url) return null;
  const { data: attachment, error } = await supabase
    .from("attachments")
    .insert({
      owner_user_id: user.id,
      asset_id: asset.id,
      kind: "link",
      url,
      title: safeString(source.title) || "ChatGPT conversation reference",
      notes: "External ChatGPT conversation reference for a Keepr context contribution.",
      source_context: {
        source: "chatgpt",
        source_type: safeString(source.type) || "chatgpt_conversation",
        source_url: url,
        contract: CONTRACT,
        contribution_thread_id: thread.id,
        contribution_message_id: message.id,
        contribution_id: contributionIdValue,
        review_state: "pending_review",
        asset_id: asset.id,
        system_id: system?.id || null,
      },
    })
    .select("id,title,url,kind")
    .single();
  if (error || !attachment?.id) return { error: error?.message || "source_attachment_not_created" };

  const placements = [
    { attachment_id: attachment.id, target_type: "asset", target_id: asset.id, role: "external_intelligence_context" },
    system?.id ? { attachment_id: attachment.id, target_type: "system", target_id: system.id, role: "external_intelligence_context" } : null,
  ].filter(Boolean);
  const { error: placementError } = await supabase.from("attachment_placements").upsert(placements, {
    onConflict: "attachment_id,target_type,target_id",
    ignoreDuplicates: false,
  });
  return {
    attachment,
    placement_error: placementError?.message || null,
  };
}

async function contributeContext(auth, args) {
  if (safeString(args.confirmation).toUpperCase() !== "CONTRIBUTE_CONTEXT") {
    const error = new Error("confirmation_required");
    error.data = {
      required_confirmation: "CONTRIBUTE_CONTEXT",
      reason: "contribute_context persists an external ChatGPT-derived contribution in Keepr for owner review.",
    };
    throw error;
  }

  const scopedArgs = { ...asObject(args.scope), ...args };
  const asset = await resolveAsset(auth.supabase, scopedArgs);
  const system = await resolveSystem(auth.supabase, asset.id, scopedArgs);
  const thread = await findOrCreateContributionThread(auth.supabase, auth.user, asset, system, scopedArgs);
  const scope = {
    asset_id: asset.id,
    asset_name: asset.name,
    kac_id: asset.kac_id,
    system_id: system?.id || null,
    system_name: system?.name || null,
    thread_id: thread.id,
    thread_subject: thread.subject,
  };
  scope.contribution_id = contributionId(args, scope);
  const envelope = contributionEnvelope(args, scope);
  const body = contributionBody(args, scope);
  const existingMessage = await findExistingContribution(auth.supabase, thread.id, scope.contribution_id);
  if (existingMessage) {
    await persistContributionEnvelope(auth.supabase, thread, envelope, existingMessage.created_at);
    return {
      contract: CONTRACT,
      verb: "contribute_context",
      saved: true,
      replayed: true,
      contribution: envelope,
      persistent_objects: { thread, message: existingMessage, source_attachment: null },
      warnings: [],
      scope,
      canonical_truth_changed: false,
      operational_writes_created: [],
      review_required_for: ["proposed_actions", "proposed_facts", "provider_relationship_changes", "timeline_events"],
    };
  }
  const { data: message, error: messageError } = await auth.supabase
    .from("asset_thread_messages")
    .insert({
      id: scope.contribution_id,
      thread_id: thread.id,
      from_user_id: auth.user.id,
      sender_type: "member",
      sender_name: "ChatGPT via Keepr",
      body,
    })
    .select("id,thread_id,from_user_id,body,created_at,sender_type,sender_name")
    .single();
  if (messageError) {
    if (messageError.code === "23505") {
      const racedMessage = await findExistingContribution(auth.supabase, thread.id, scope.contribution_id);
      if (racedMessage) {
        await persistContributionEnvelope(auth.supabase, thread, envelope, racedMessage.created_at);
        return {
          contract: CONTRACT,
          verb: "contribute_context",
          saved: true,
          replayed: true,
          contribution: envelope,
          persistent_objects: { thread, message: racedMessage, source_attachment: null },
          warnings: [],
          scope,
          canonical_truth_changed: false,
          operational_writes_created: [],
          review_required_for: ["proposed_actions", "proposed_facts", "provider_relationship_changes", "timeline_events"],
        };
      }
    }
    throw messageError;
  }

  await persistContributionEnvelope(auth.supabase, thread, envelope, message.created_at);
  const sourceAttachment = await maybeCreateSourceAttachment(
    auth.supabase,
    auth.user,
    asset,
    system,
    thread,
    message,
    args,
    scope.contribution_id
  );
  return {
    contract: CONTRACT,
    verb: "contribute_context",
    saved: true,
    replayed: false,
    contribution: envelope,
    persistent_objects: {
      thread,
      message,
      source_attachment: sourceAttachment?.attachment || null,
    },
    warnings: [sourceAttachment?.error, sourceAttachment?.placement_error].filter(Boolean),
    scope,
    canonical_truth_changed: false,
    operational_writes_created: [],
    review_required_for: [
      "proposed_actions",
      "proposed_facts",
      "provider_relationship_changes",
      "timeline_events",
    ],
  };
}

const bridgeTools = [
  {
    name: "get_context",
    description:
      "Get minimum sufficient authorized Keepr context for a natural-language asset/system/job hint. Use this before reasoning in ChatGPT.",
    inputSchema: z.object({
      asset_hint: z.string().optional(),
      asset_id: z.string().optional(),
      kac_id: z.string().optional(),
      address: z.string().optional(),
      system_hint: z.string().optional(),
      system_id: z.string().optional(),
      thread_or_project_hint: z.string().optional(),
      job_hint: z.string().optional(),
      context_hint: z.string().optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "contribute_context",
    description:
      "Persist a structured ChatGPT-derived context contribution back into Keepr with provenance. This creates reviewable conversation continuity, not canonical asset truth.",
    inputSchema: z.object({
      scope: z.record(z.string(), z.unknown()).optional(),
      source: z.record(z.string(), z.unknown()).optional(),
      contribution: z.record(z.string(), z.unknown()),
      asset_hint: z.string().optional(),
      asset_id: z.string().optional(),
      kac_id: z.string().optional(),
      system_hint: z.string().optional(),
      system_id: z.string().optional(),
      thread_id: z.string().optional(),
      thread_or_project_hint: z.string().optional(),
      project_hint: z.string().optional(),
      job_hint: z.string().optional(),
      summary: z.string().optional(),
      source_url: z.string().optional(),
      idempotency_key: z.string().optional().describe("Stable client retry key for this contribution."),
      confirmation: z.string().describe("Must be CONTRIBUTE_CONTEXT."),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

async function callBridgeTool(name, args, ctx) {
  try {
    const auth = await authenticate(ctx?.http?.req);
    if (name === "get_context") return textResult(await getContext(auth, asObject(args)));
    if (name === "contribute_context") return textResult(await contributeContext(auth, asObject(args)));
    return mcpErrorResult(`Unknown tool: ${name}`);
  } catch (error) {
    return mcpErrorResult(error?.message || "server_error", error?.data);
  }
}

export function registerKeeprContextBridgeTools(server) {
  for (const tool of bridgeTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args, ctx) => callBridgeTool(tool.name, args, ctx)
    );
  }
}

export const keeprContextBridgeContract = {
  contract: CONTRACT,
  tools: bridgeTools.map(({ name, description, annotations }) => ({ name, description, annotations })),
  scopes: [READ_SCOPE, CONTRIBUTE_SCOPE],
};

export const keeprContextBridgeInternals = {
  getContext,
  contributeContext,
  normalizeKacHint,
};
