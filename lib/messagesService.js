import { supabase } from "./supabaseClient";

export const MESSAGE_SCOPES = {
  GLOBAL: "global",
  ASSET: "asset",
  SYSTEM: "system",
};

export function normalizeMessageScope(params = {}) {
  const assetId = params.assetId || params.asset_id || null;
  const systemId = params.systemId || params.system_id || null;
  if (assetId && systemId) return MESSAGE_SCOPES.SYSTEM;
  if (assetId) return MESSAGE_SCOPES.ASSET;
  return MESSAGE_SCOPES.GLOBAL;
}

function cleanId(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function getPublicResourceRoute({ parentAssetKac, systemId } = {}) {
  const kac = cleanId(parentAssetKac);
  const nodeId = cleanId(systemId);
  if (!kac) return null;
  if (nodeId) return `/k/${encodeURIComponent(kac)}/n/${encodeURIComponent(nodeId)}`;
  return `/k/${encodeURIComponent(kac)}`;
}

export function getAuthenticatedMessagesRoute({ assetId, systemId, threadId } = {}) {
  const params = new URLSearchParams();
  const cleanAssetId = cleanId(assetId);
  const cleanSystemId = cleanId(systemId);
  const cleanThreadId = cleanId(threadId);
  if (cleanAssetId) params.set("assetId", cleanAssetId);
  if (cleanSystemId) params.set("systemId", cleanSystemId);
  if (cleanThreadId) params.set("threadId", cleanThreadId);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

export function buildMessageResourceRef({
  parentAssetKac,
  parent_asset_kac,
  assetId,
  asset_id,
  systemId,
  system_id,
  threadId,
  intended_thread_id,
  canonicalPublicRoute,
  canonical_public_route,
  authenticatedDestinationRoute,
  authenticated_destination_route,
} = {}) {
  const cleanAssetId = cleanId(assetId || asset_id);
  const cleanSystemId = cleanId(systemId || system_id);
  const cleanThreadId = cleanId(threadId || intended_thread_id);
  const cleanKac = cleanId(parentAssetKac || parent_asset_kac);
  const publicRoute =
    cleanId(canonicalPublicRoute || canonical_public_route) ||
    getPublicResourceRoute({ parentAssetKac: cleanKac, systemId: cleanSystemId });
  const authRoute =
    cleanId(authenticatedDestinationRoute || authenticated_destination_route) ||
    getAuthenticatedMessagesRoute({
      assetId: cleanAssetId,
      systemId: cleanSystemId,
      threadId: cleanThreadId,
    });

  return {
    parent_asset_kac: cleanKac,
    asset_id: cleanAssetId,
    system_id: cleanSystemId,
    canonical_public_route: publicRoute,
    authenticated_destination_route: authRoute,
    intended_thread_id: cleanThreadId,
  };
}

export function buildMessagesNavigationParams({
  scope,
  assetId,
  assetName,
  parentAssetKac,
  systemId,
  systemName,
  keeprProId,
  keeprProName,
  threadId,
  backRoute,
  backParams,
  ...extra
} = {}) {
  const resourceRef = buildMessageResourceRef({
    parentAssetKac,
    assetId,
    systemId,
    threadId,
  });
  return {
    ...extra,
    scope: scope || normalizeMessageScope({ assetId, systemId }),
    assetId: cleanId(assetId),
    assetName: assetName || null,
    kac: cleanId(parentAssetKac),
    systemId: cleanId(systemId),
    systemName: systemName || null,
    keeprProId: cleanId(keeprProId),
    keeprProName: keeprProName || null,
    threadId: cleanId(threadId),
    canonicalResource: resourceRef,
    canonicalPublicRoute: resourceRef.canonical_public_route,
    authenticatedDestinationRoute: resourceRef.authenticated_destination_route,
    backRoute: backRoute || null,
    backParams: backParams || null,
  };
}

export function formatMessageTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function displayProfile(profile, fallback = "Keepr Member") {
  const name = String(profile?.display_name || profile?.full_name || "").trim();
  if (name) return name;
  return fallback;
}

export function getMessageSenderLabel(message, profilesById = {}) {
  if (message?.sender_type === "public_visitor") {
    return `${message.sender_name || "Public visitor"} · Public visitor`;
  }
  const profile = profilesById[message?.from_user_id] || null;
  return displayProfile(profile);
}

export function getThreadParticipantLabel(thread, currentUserId, profilesById = {}) {
  const messages = thread.messages || [];
  const publicMessage = messages.find((m) => m.sender_type === "public_visitor");
  if (publicMessage) return `${publicMessage.sender_name || "Public visitor"} · Public visitor`;

  const otherMessage = messages.find(
    (m) => m.from_user_id && String(m.from_user_id) !== String(currentUserId)
  );
  const participantId =
    otherMessage?.from_user_id ||
    (thread.created_by && String(thread.created_by) !== String(currentUserId)
      ? thread.created_by
      : thread.owner_id);

  return displayProfile(profilesById[participantId], "Keepr Member");
}

export function getAttentionState(thread, currentUserId) {
  if (["resolved", "closed"].includes(String(thread?.status || "").toLowerCase())) {
    return "Resolved";
  }

  const messages = thread.messages || [];
  const latest = messages[messages.length - 1] || null;
  if (!latest) return "Owner responded";

  if (latest.sender_type === "public_visitor") return "New inbound";
  if (latest.from_user_id && String(latest.from_user_id) !== String(currentUserId)) return "New inbound";
  return "Owner responded";
}

export function sortThreadsForMessages(a, b) {
  const rank = {
    "New inbound": 0,
    "Owner responded": 1,
    Resolved: 2,
  };
  const ar = rank[a.attentionState] ?? 1;
  const br = rank[b.attentionState] ?? 1;
  if (ar !== br) return ar - br;
  return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
}

export function groupThreadsByAsset(threads = []) {
  const groups = [];
  const byAsset = new Map();

  for (const thread of threads) {
    const key = thread.asset_id || "unknown";
    if (!byAsset.has(key)) {
      const group = {
        assetId: thread.asset_id,
        assetName: thread.asset?.name || "Unknown asset",
        threads: [],
      };
      byAsset.set(key, group);
      groups.push(group);
    }
    byAsset.get(key).threads.push(thread);
  }

  groups.forEach((g) => g.threads.sort(sortThreadsForMessages));
  return groups.sort((a, b) => a.assetName.localeCompare(b.assetName));
}

async function fetchByIds(table, ids, columns = "*") {
  const clean = Array.from(new Set((ids || []).filter(Boolean)));
  if (!clean.length) return [];
  const { data, error } = await supabase.from(table).select(columns).in("id", clean);
  if (error) throw error;
  return data || [];
}

export async function resolveAssetByIdOrKac({ assetId, kac }) {
  if (!assetId && !kac) return null;
  let query = supabase.from("assets").select("id, owner_id, name, kac_id, type").is("deleted_at", null);
  query = assetId ? query.eq("id", assetId) : query.eq("kac_id", kac);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function loadAuthorizedAssets() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) return [];

  const { data, error } = await supabase
    .from("assets")
    .select("id, owner_id, name, kac_id, type")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;

  const owned = (data || []).filter((asset) => asset.owner_id === currentUserId);

  const { data: stewardships, error: stewardshipError } = await supabase
    .from("asset_stewardships")
    .select("asset_id")
    .eq("user_id", currentUserId)
    .eq("active", true);
  if (stewardshipError) throw stewardshipError;

  const stewardAssetIds = new Set((stewardships || []).map((row) => row.asset_id).filter(Boolean));
  const authorized = (data || []).filter(
    (asset) => asset.owner_id === currentUserId || stewardAssetIds.has(asset.id)
  );

  return authorized.length ? authorized : owned;
}

export async function loadSystemsForAsset(assetId) {
  if (!assetId) return [];
  const { data, error } = await supabase
    .from("systems")
    .select("id, asset_id, name, system_type")
    .eq("asset_id", assetId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadEligibleRecipientsForAsset(assetId, currentUserId) {
  if (!assetId) return [];
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, owner_id")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) throw assetError;

  const ids = new Set();
  if (asset?.owner_id) ids.add(asset.owner_id);

  const { data: stewards, error: stewardshipError } = await supabase
    .from("asset_stewardships")
    .select("user_id, access_role, active")
    .eq("asset_id", assetId)
    .eq("active", true);
  if (!stewardshipError) {
    (stewards || []).forEach((s) => {
      if (s.user_id) ids.add(s.user_id);
    });
  }

  ids.delete(currentUserId);
  const profiles = await fetchByIds(
    "profiles",
    Array.from(ids),
    "id, display_name, full_name"
  );

  return profiles.map((p) => ({
    id: p.id,
    label: displayProfile(p),
  }));
}

export async function loadMessageWorkspace({ scope, assetId, kac, systemId } = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) return { currentUserId: null, threads: [], assets: [], systems: [] };

  const asset = assetId || kac ? await resolveAssetByIdOrKac({ assetId, kac }) : null;
  const effectiveAssetId = asset?.id || assetId || null;
  const effectiveScope = scope || normalizeMessageScope({ assetId: effectiveAssetId, systemId });

  let query = supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, keepr_pro_id, hub_id, owner_id, created_by, subject, status, source_type, resource_ref, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (effectiveScope !== MESSAGE_SCOPES.GLOBAL && effectiveAssetId) {
    query = query.eq("asset_id", effectiveAssetId);
  }
  if (effectiveScope === MESSAGE_SCOPES.SYSTEM && systemId) {
    query = query.eq("system_id", systemId);
  }

  const { data: threadRows, error: threadError } = await query;
  if (threadError) throw threadError;

  const rows = threadRows || [];
  const threadIds = rows.map((t) => t.id);

  const { data: messageRows, error: messageError } = threadIds.length
    ? await supabase
        .from("asset_thread_messages")
        .select("id, thread_id, from_user_id, body, created_at, sender_type, sender_name")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (messageError) throw messageError;

  const assetRows = await fetchByIds(
    "assets",
    rows.map((t) => t.asset_id),
    "id, owner_id, name, kac_id, type"
  );
  const systemRows = await fetchByIds(
    "systems",
    rows.map((t) => t.system_id),
    "id, asset_id, name, system_type"
  );
  const proRows = await fetchByIds(
    "keepr_pros",
    rows.map((t) => t.keepr_pro_id),
    "id, name, category"
  );

  const userIds = Array.from(
    new Set(
      [
        ...rows.flatMap((t) => [t.owner_id, t.created_by]),
        ...(messageRows || []).map((m) => m.from_user_id),
      ].filter(Boolean)
    )
  );
  const profileRows = await fetchByIds("profiles", userIds, "id, display_name, full_name");

  const assetsById = Object.fromEntries(assetRows.map((a) => [a.id, a]));
  const systemsById = Object.fromEntries(systemRows.map((s) => [s.id, s]));
  const prosById = Object.fromEntries(proRows.map((p) => [p.id, p]));
  const profilesById = Object.fromEntries(profileRows.map((p) => [p.id, p]));
  const messagesByThread = {};
  (messageRows || []).forEach((m) => {
    if (!messagesByThread[m.thread_id]) messagesByThread[m.thread_id] = [];
    messagesByThread[m.thread_id].push(m);
  });

  const threads = rows
    .map((t) => {
      const messages = messagesByThread[t.id] || [];
      const hydrated = {
        ...t,
        asset: assetsById[t.asset_id] || null,
        system: systemsById[t.system_id] || null,
        keeprPro: prosById[t.keepr_pro_id] || null,
        messages,
      };
      return {
        ...hydrated,
        participantLabel: getThreadParticipantLabel(hydrated, currentUserId, profilesById),
        attentionState: getAttentionState(hydrated, currentUserId),
      };
    })
    .sort(sortThreadsForMessages);

  return {
    currentUserId,
    asset,
    system: systemId ? systemsById[systemId] || null : null,
    profilesById,
    threads,
  };
}

export async function createMemberThread({
  assetId,
  systemId = null,
  keeprProId = null,
  ownerId,
  recipientId = null,
  subject,
  body,
  resourceRef = null,
}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) throw new Error("You need to be signed in.");
  if (!assetId) throw new Error("Choose an asset.");
  if (!ownerId) throw new Error("Could not resolve the asset owner.");
  if (!recipientId) throw new Error("Choose an eligible participant.");
  const cleanBody = String(body || "").trim();
  if (!cleanBody) throw new Error("Write a message first.");

  const eligible = await loadEligibleRecipientsForAsset(assetId, currentUserId);
  const isEligible = eligible.some((recipient) => recipient.id === recipientId);
  if (!isEligible) throw new Error("That participant is not available for this asset.");

  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .insert({
      asset_id: assetId,
      system_id: systemId || null,
      keepr_pro_id: keeprProId || null,
      owner_id: ownerId,
      created_by: currentUserId,
      subject: String(subject || "Keepr conversation").trim(),
      source_type: "member",
      resource_ref: resourceRef || buildMessageResourceRef({ assetId, systemId }),
      status: "open",
    })
    .select("id")
    .single();
  if (threadError) throw threadError;

  const finalResourceRef = buildMessageResourceRef({
    ...(resourceRef || {}),
    assetId,
    systemId,
    threadId: thread.id,
  });
  await supabase
    .from("asset_threads")
    .update({ resource_ref: finalResourceRef })
    .eq("id", thread.id);

  const { error: messageError } = await supabase
    .from("asset_thread_messages")
    .insert({
      thread_id: thread.id,
      from_user_id: currentUserId,
      sender_type: "member",
      body: cleanBody,
    });
  if (messageError) throw messageError;
  return thread;
}

export async function sendThreadReply(threadId, body) {
  const cleanBody = String(body || "").trim();
  if (!cleanBody) throw new Error("Write a reply first.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) throw new Error("You need to be signed in.");

  const { error } = await supabase
    .from("asset_thread_messages")
    .insert({
      thread_id: threadId,
      from_user_id: currentUserId,
      sender_type: "member",
      body: cleanBody,
    });
  if (error) throw error;
}
