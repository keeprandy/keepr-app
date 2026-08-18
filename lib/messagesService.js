import { supabase } from "./supabaseClient";
import { keeprApiRequest } from "./keeprApi";
import { getSignedUrl } from "./attachmentsApi";
import { uploadAttachmentFromUri } from "./attachmentsUploader";
import { createRelationshipMessageNotification } from "./notificationsService";

const MESSAGE_SUMMARY_PAGE_SIZE = 50;
export const MESSAGE_THREAD_PAGE_SIZE = 50;
const messageSummaryCache = new Map();
const threadMessagesCache = new Map();
const metadataCache = new Map();

function devLogMessages(label, data = {}) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(`[messages] ${label}`, data);
  }
}

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

function cleanText(value) {
  return String(value || "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSearchText(value) {
  return cleanText(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function scopedCacheKey(parts = []) {
  return parts.map((part) => cleanId(part) || "_").join(":");
}

function putCache(map, key, value) {
  map.set(key, {
    value,
    cachedAt: Date.now(),
  });
  return value;
}

function readCache(map, key) {
  return map.get(key)?.value || null;
}

export function invalidateMessageCache({ userId, scope, assetId, systemId, threadId } = {}) {
  const userPrefix = userId ? `${userId}:` : "";
  for (const key of Array.from(messageSummaryCache.keys())) {
    if (userPrefix && !key.startsWith(userPrefix)) continue;
    if (userId && (assetId || systemId || threadId) && key.includes(":summaries:")) {
      messageSummaryCache.delete(key);
      continue;
    }
    if (scope && !key.includes(`:${scope}:`)) continue;
    if (assetId && !key.includes(`:${assetId}:`)) continue;
    if (systemId && !key.includes(`:${systemId}:`)) continue;
    messageSummaryCache.delete(key);
  }
  if (threadId) {
    for (const key of Array.from(threadMessagesCache.keys())) {
      if (key.includes(`:${threadId}:`)) threadMessagesCache.delete(key);
    }
  }
}

export function clearMessageSessionCache(userId = null) {
  const prefix = userId ? `${userId}:` : null;
  [messageSummaryCache, threadMessagesCache, metadataCache].forEach((map) => {
    for (const key of Array.from(map.keys())) {
      if (!prefix || key.startsWith(prefix)) map.delete(key);
    }
  });
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

function normalizeAssetRow(row, fallback = {}) {
  if (!row) return null;
  const source = row.asset && typeof row.asset === "object" ? row.asset : row;
  return {
    id: source.id || source.asset_id || row.asset_id || fallback.asset_id || null,
    owner_id: source.owner_id || row.owner_id || fallback.owner_id || null,
    name: source.name || row.name || fallback.name || "Unavailable asset",
    kac_id: source.kac_id || row.kac_id || row.kac || fallback.kac_id || null,
    type: source.type || source.asset_type || row.asset_type || fallback.type || null,
    viewerRelationship:
      row.viewerRelationship ||
      row.viewer_relationship ||
      row.access_indicator ||
      fallback.viewerRelationship ||
      "authorized",
    hub_id: row.hub_id || fallback.hub_id || null,
    hub_name: row.hub_name || fallback.hub_name || null,
    isHubAuthorized: Boolean(row.isHubAuthorized || row.hub_id || fallback.hub_id),
  };
}

function mergeAssets(...collections) {
  const byId = new Map();
  collections.flat().filter(Boolean).forEach((asset) => {
    const normalized = normalizeAssetRow(asset);
    if (!normalized?.id) return;
    byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  });
  return Array.from(byId.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function dedupeMessages(messages = []) {
  const byId = new Map();
  messages.forEach((message) => {
    if (!message?.id) return;
    byId.set(message.id, message);
  });
  return Array.from(byId.values()).sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
}

export function getMessageSenderLabel(message, profilesById = {}) {
  if (message?.sender_type === "public_visitor") {
    return `${message.sender_name || "Public visitor"} · Public visitor`;
  }
  if (message?.sender_type === "keepr_pro") {
    return message.sender_name || "KeeprPro";
  }
  const profile = profilesById[message?.from_user_id] || null;
  return displayProfile(profile);
}

export function getThreadParticipantLabel(thread, currentUserId, profilesById = {}) {
  const messages = thread.messages || [];
  const publicMessage = messages.find((m) => m.sender_type === "public_visitor");
  if (publicMessage) return `${publicMessage.sender_name || "Public visitor"} · Public visitor`;
  const providerMessage = messages.find((m) => m.sender_type === "keepr_pro" && m.sender_name);
  if (providerMessage) return providerMessage.sender_name;
  if (thread?.keeprPro?.name) return thread.keeprPro.name;

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
  const latest = thread.latestMessage || messages[messages.length - 1] || null;
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

export function getMatchingOpenThreads(threads = [], { assetId, systemId, recipientId, keeprProId } = {}) {
  if (!assetId) return [];
  return threads
    .filter((thread) => {
      if (thread.asset_id !== assetId) return false;
      if (systemId && thread.system_id !== systemId) return false;
      if (!systemId && thread.system_id) return false;
      if (["resolved", "closed"].includes(String(thread.status || "").toLowerCase())) return false;
      if (keeprProId && thread.keepr_pro_id === keeprProId) return true;
      if (!recipientId) return true;
      const participantIds = new Set([
        thread.owner_id,
        thread.created_by,
        ...((thread.resource_ref?.participant_ids || thread.resource_ref?.selected_participant_ids || []).filter(Boolean)),
        ...(thread.messages || []).map((m) => m.from_user_id).filter(Boolean),
      ]);
      return participantIds.has(recipientId);
    })
    .sort(sortThreadsForMessages);
}

function identityMatches(identity, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = [
    identity.display_name,
    identity.email,
    identity.organization_name,
    identity.relationship_label,
    identity.context_relevance,
  ].map(normalizeSearchText).join(" ");
  return haystack.includes(q);
}

function addIdentity(map, identity) {
  if (!identity?.identity_key) return;
  const existing = map.get(identity.identity_key);
  if (!existing || Number(identity.rank || 999) < Number(existing.rank || 999)) {
    map.set(identity.identity_key, identity);
    return;
  }
  if (existing && identity.context_relevance && !existing.context_relevance) {
    map.set(identity.identity_key, { ...existing, context_relevance: identity.context_relevance });
  }
}

function extractRelationshipIds(row) {
  const meta = safeObject(row?.metadata || row?.extra_metadata);
  const standard = safeObject(meta.standard);
  const relationships = safeObject(standard.relationships || meta.relationships);
  const raw = relationships.keepr_pro_ids || relationships.keeprProIds || relationships.keepr_pros || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === "string" ? item : item?.id || item?.keepr_pro_id)).filter(Boolean);
}

export async function resolveMessageIdentities({
  query = "",
  assetId,
  systemId = null,
  hubId = null,
  currentUserId,
  threads = [],
  profilesById = {},
  eligibleRecipients = [],
  force = false,
} = {}) {
  const q = cleanText(query);
  const cacheKey = scopedCacheKey([
    currentUserId || "anon",
    "identity-resolver",
    assetId,
    systemId || "general",
    hubId || "direct",
    q.toLowerCase(),
  ]);
  if (!force) {
    const cached = readCache(metadataCache, cacheKey);
    if (cached) return cached;
  }

  const byKey = new Map();
  const eligibleById = new Map((eligibleRecipients || []).filter((r) => r?.id).map((r) => [r.id, r]));

  (eligibleRecipients || []).forEach((recipient) => {
    const profile = profilesById[recipient.id] || {};
    const isOwner = threads.some((thread) => thread.asset_id === assetId && thread.owner_id === recipient.id);
    addIdentity(byKey, {
      identity_key: `user:${recipient.id}`,
      source_type: isOwner ? "team" : "keepr_member",
      display_name: recipient.label || displayProfile(profile),
      email: profile.email || null,
      user_id: recipient.id,
      keepr_pro_id: null,
      organization_name: null,
      relationship_label: isOwner ? "Owner" : recipient.relationship_label || "Team member",
      availability_state: "active",
      avatar_url: null,
      is_selectable: true,
      disabled_reason: null,
      context_relevance: isOwner ? "Owns this asset" : "Authorized for this asset",
      rank: isOwner ? 2 : 3,
    });
  });

  const participantIds = Array.from(new Set((threads || []).flatMap((thread) => [
    thread.owner_id,
    thread.created_by,
    ...((thread.resource_ref?.participant_ids || thread.resource_ref?.selected_participant_ids || []).filter(Boolean)),
    ...(thread.messages || []).map((message) => message.from_user_id).filter(Boolean),
  ]).filter(Boolean))).filter((id) => id !== currentUserId);

  const missingProfileIds = participantIds.filter((id) => !profilesById[id]);
  const priorProfiles = missingProfileIds.length
    ? await fetchByIds("profiles", missingProfileIds, "id, display_name, full_name, email")
    : [];
  const profileLookup = {
    ...(profilesById || {}),
    ...Object.fromEntries(priorProfiles.map((profile) => [profile.id, profile])),
  };

  participantIds.forEach((participantId) => {
    const profile = profileLookup[participantId] || {};
    const eligible = eligibleById.has(participantId);
    const priorThread = (threads || []).find((thread) => {
      const ids = new Set([
        thread.owner_id,
        thread.created_by,
        ...((thread.resource_ref?.participant_ids || []).filter(Boolean)),
        ...(thread.messages || []).map((message) => message.from_user_id).filter(Boolean),
      ]);
      return ids.has(participantId);
    });
    addIdentity(byKey, {
      identity_key: `user:${participantId}`,
      source_type: eligible ? "keepr_member" : "prior_conversation",
      display_name: displayProfile(profile, "Keepr Member"),
      email: profile.email || null,
      user_id: participantId,
      keepr_pro_id: null,
      organization_name: null,
      relationship_label: eligible ? "Keepr member" : "Previous conversation",
      availability_state: eligible ? "active" : "available",
      avatar_url: null,
      is_selectable: eligible,
      disabled_reason: eligible ? null : "This identity is known from a prior conversation, but is not currently authorized for this asset.",
      context_relevance: priorThread?.system?.name || priorThread?.asset?.name || priorThread?.subject || null,
      rank: eligible ? 6 : 5,
    });
  });

  let connectedProIds = [];
  if (assetId) {
    const { data: assetRow } = await supabase
      .from("assets")
      .select("id, metadata")
      .eq("id", assetId)
      .maybeSingle();
    connectedProIds = connectedProIds.concat(extractRelationshipIds(assetRow));
  }
  if (systemId) {
    const { data: systemRow } = await supabase
      .from("systems")
      .select("id, metadata, extra_metadata")
      .eq("id", systemId)
      .maybeSingle();
    connectedProIds = connectedProIds.concat(extractRelationshipIds(systemRow));
  }
  connectedProIds = Array.from(new Set(connectedProIds));

  if (assetId) {
    const { data: stewardships } = await supabase
      .from("asset_provider_stewardships")
      .select("keepr_pro_id")
      .eq("asset_id", assetId)
      .eq("status", "active");
    connectedProIds = connectedProIds.concat((stewardships || []).map((row) => row.keepr_pro_id).filter(Boolean));
    connectedProIds = Array.from(new Set(connectedProIds));
  }

  if (currentUserId) {
    let pros = [];
    if (connectedProIds.length) {
      const { data: connectedPros } = await supabase
        .from("keepr_pros")
        .select("id, name, display_name, category, email, phone, website, location, is_favorite, organization_id, claimed_state, profile_status, publish_status")
        .in("id", connectedProIds);
      pros = pros.concat(connectedPros || []);
    }

    const { data: savedPros } = await supabase
      .from("keepr_pros")
      .select("id, name, display_name, category, email, phone, website, location, is_favorite, organization_id, claimed_state, profile_status, publish_status")
      .eq("user_id", currentUserId)
      .order("is_favorite", { ascending: false })
      .order("name", { ascending: true });
    pros = Array.from(new Map([...(pros || []), ...(savedPros || [])].map((pro) => [pro.id, pro])).values());

    const orgIds = Array.from(new Set((pros || []).map((pro) => pro.organization_id).filter(Boolean)));
    const membersByOrg = {};
    if (orgIds.length) {
      const { data: memberRows } = await supabase
        .from("org_members")
        .select("org_id,user_id,member_role,role")
        .in("org_id", orgIds);
      (memberRows || []).forEach((member) => {
        if (!member?.org_id || !member?.user_id || member.user_id === currentUserId) return;
        if (!membersByOrg[member.org_id]) membersByOrg[member.org_id] = [];
        membersByOrg[member.org_id].push(member);
      });
    }

    (pros || []).forEach((pro) => {
      const connected = connectedProIds.includes(pro.id);
      const previousThread = (threads || []).find((thread) => thread.keepr_pro_id === pro.id);
      const activeOrgMember = (membersByOrg[pro.organization_id] || [])[0] || null;
      const profileStatus = pro.publish_status || pro.profile_status;
      const isClaimedLive =
        pro.claimed_state === "claimed" &&
        ["published", "demo"].includes(profileStatus) &&
        !!activeOrgMember?.user_id;
      const relationship = connected
        ? systemId
          ? "Connected service provider for this system"
          : "Connected service provider for this asset"
        : previousThread
          ? "Previous KeeprPro conversation"
          : pro.category || "KeeprPro";
      addIdentity(byKey, {
        identity_key: `keepr_pro:${pro.id}`,
        source_type: "keepr_pro",
        display_name: pro.display_name || pro.name || "KeeprPro",
        email: pro.email || null,
        user_id: isClaimedLive ? activeOrgMember.user_id : null,
        keepr_pro_id: pro.id,
        organization_id: pro.organization_id || null,
        organization_name: pro.display_name || pro.name || null,
        relationship_label: relationship,
        availability_state: isClaimedLive ? "active" : "not_message_enabled",
        avatar_url: null,
        is_selectable: isClaimedLive,
        disabled_reason: isClaimedLive ? null : "Not yet participating in Keepr Messages.",
        context_relevance: isClaimedLive
          ? "Claimed KeeprPro with an active member"
          : connected
          ? "Connected KeeprPro"
          : previousThread?.subject || "Saved KeeprPro contact",
        rank: connected ? 4 : previousThread ? 5 : 7,
      });
    });
  }

  if (isValidEmail(q)) {
    const already = Array.from(byKey.values()).some((identity) => normalizeSearchText(identity.email) === normalizeSearchText(q));
    if (!already) {
      addIdentity(byKey, {
        identity_key: `new_email:${q.toLowerCase()}`,
        source_type: "new_email",
        display_name: q,
        email: q,
        user_id: null,
        keepr_pro_id: null,
        organization_name: null,
        relationship_label: "New external contact",
        availability_state: "future_external",
        avatar_url: null,
        is_selectable: false,
        disabled_reason: "External email messaging will be enabled in the next communication phase.",
        context_relevance: "External delivery not enabled yet",
        rank: 8,
      });
    }
  }

  const results = Array.from(byKey.values())
    .filter((identity) => identityMatches(identity, q))
    .map((identity) => {
      const exact = normalizeSearchText(identity.display_name) === normalizeSearchText(q) || normalizeSearchText(identity.email) === normalizeSearchText(q);
      return { ...identity, rank: exact ? Math.max(1, Number(identity.rank || 99) - 2) : identity.rank };
    })
    .sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99) || String(a.display_name || "").localeCompare(String(b.display_name || "")))
    .slice(0, 8)
    .map(({ rank, ...identity }) => identity);

  return putCache(metadataCache, cacheKey, results);
}

function summarizePreview(message) {
  return String(message?.body || "").replace(/\s+/g, " ").trim();
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

async function loadDirectAuthorizedAssets() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) return [];

  const { data, error } = await supabase.rpc("get_authorized_assets", {
    p_asset_type: null,
    p_include_deleted: false,
  });
  if (!error) {
    return (data || [])
      .map((row) => normalizeAssetRow(row.asset || row, {
        viewerRelationship: row.access_indicator || "authorized",
      }))
      .filter((asset) => asset?.id);
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("assets")
    .select("id, owner_id, name, kac_id, type")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (fallbackError) throw fallbackError;

  return (fallbackRows || [])
    .filter((asset) => asset.owner_id === currentUserId)
    .map((asset) => ({ ...asset, viewerRelationship: "owner" }));
}

async function loadHubAuthorizedAssets(currentUserId) {
  if (!currentUserId) return [];
  const { data: memberships, error: membershipError } = await supabase
    .from("hub_members")
    .select("hub_id, role, status, hub:hubs(id, name)")
    .eq("user_id", currentUserId)
    .eq("status", "active");
  if (membershipError) return [];

  const results = [];
  for (const membership of memberships || []) {
    if (!membership.hub_id) continue;
    const { data, error } = await supabase.rpc("get_hub_stories_for_view", {
      p_hub_id: membership.hub_id,
    });
    if (error) continue;
    (data || []).forEach((row) => {
      const asset = normalizeAssetRow(row.asset || row, {
        asset_id: row.asset_id,
        owner_id: row.owner_id,
        name: row.asset_name || row.name,
        hub_id: membership.hub_id,
        hub_name: membership.hub?.name || null,
        viewerRelationship: "Hub member",
      });
      if (asset?.id) results.push(asset);
    });
  }
  return results;
}

async function resolveHubAssetForThread(thread) {
  if (!thread?.asset_id || !thread?.hub_id) return null;
  const { data, error } = await supabase.rpc("get_hub_story_asset_owner", {
    p_asset_id: thread.asset_id,
    p_hub_id: thread.hub_id,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeAssetRow(row, {
    asset_id: thread.asset_id,
    owner_id: thread.owner_id,
    hub_id: thread.hub_id,
    viewerRelationship: "Hub member",
  });
}

export async function loadAuthorizedAssets() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) return [];

  const [direct, hubAuthorized] = await Promise.all([
    loadDirectAuthorizedAssets(),
    loadHubAuthorizedAssets(currentUserId),
  ]);
  return mergeAssets(direct, hubAuthorized);
}

export async function loadSystemsForAsset(assetId, { force = false, userId = null } = {}) {
  if (!assetId) return [];
  const key = scopedCacheKey([userId || "anon", "systems", assetId]);
  if (!force) {
    const cached = readCache(metadataCache, key);
    if (cached) return cached;
  }
  const { data, error } = await supabase
    .from("systems")
    .select("id, asset_id, name, system_type")
    .eq("asset_id", assetId)
    .order("name", { ascending: true });
  if (error) throw error;
  return putCache(metadataCache, key, data || []);
}

export async function loadEligibleRecipientsForAsset(assetId, currentUserId, { hubId, force = false } = {}) {
  if (!assetId) return [];
  const key = scopedCacheKey([currentUserId || "anon", "recipients", assetId, hubId || "direct"]);
  if (!force) {
    const cached = readCache(metadataCache, key);
    if (cached) return cached;
  }
  let asset = null;
  const { data: assetData, error: assetError } = await supabase
    .from("assets")
    .select("id, owner_id")
    .eq("id", assetId)
    .maybeSingle();
  if (!assetError) asset = assetData || null;

  if (!asset && hubId) {
    const hubAsset = await resolveHubAssetForThread({ asset_id: assetId, hub_id: hubId });
    asset = hubAsset ? { id: hubAsset.id, owner_id: hubAsset.owner_id } : null;
  }

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

  if (hubId) {
    const { data: hubMembers } = await supabase
      .from("hub_members")
      .select("user_id, role, status")
      .eq("hub_id", hubId)
      .eq("status", "active");
    (hubMembers || []).forEach((m) => {
      if (m.user_id) ids.add(m.user_id);
    });
  }

  ids.delete(currentUserId);
  const profiles = await fetchByIds(
    "profiles",
    Array.from(ids),
    "id, display_name, full_name, email"
  );

  return putCache(metadataCache, key, profiles.map((p) => ({
    id: p.id,
    label: displayProfile(p),
    email: p.email || null,
    avatar_url: null,
  })));
}

async function loadSummaryMessagesForThreads(threadIds = []) {
  const cleanThreadIds = Array.from(new Set(threadIds.filter(Boolean)));
  const latestByThread = {};
  const publicByThread = {};
  await Promise.all(
    cleanThreadIds.map(async (threadId) => {
      const [{ data: latest }, { data: firstPublic }] = await Promise.all([
        supabase
          .from("asset_thread_messages")
          .select("id, thread_id, from_user_id, body, created_at, sender_type, sender_name")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("asset_thread_messages")
          .select("id, thread_id, from_user_id, created_at, sender_type, sender_name")
          .eq("thread_id", threadId)
          .eq("sender_type", "public_visitor")
          .order("created_at", { ascending: true })
          .limit(1),
      ]);
      if (latest?.[0]) latestByThread[threadId] = latest[0];
      if (firstPublic?.[0]) publicByThread[threadId] = firstPublic[0];
    })
  );
  return { latestByThread, publicByThread };
}

export async function loadMessageThreadSummaries({
  scope,
  assetId,
  kac,
  systemId,
  force = false,
  pageSize = MESSAGE_SUMMARY_PAGE_SIZE,
} = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) return { currentUserId: null, threads: [], assets: [], systems: [] };

  const asset = assetId || kac ? await resolveAssetByIdOrKac({ assetId, kac }) : null;
  const effectiveAssetId = asset?.id || assetId || null;
  const effectiveScope = scope || normalizeMessageScope({ assetId: effectiveAssetId, systemId });
  const cacheKey = scopedCacheKey([currentUserId, "summaries", effectiveScope, effectiveAssetId, systemId]);
  if (!force) {
    const cached = readCache(messageSummaryCache, cacheKey);
    if (cached) return { ...cached, fromCache: true };
  }
  const startedAt = Date.now();
  let requestCount = 1;

  let query = supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, keepr_pro_id, hub_id, owner_id, created_by, subject, status, source_type, resource_ref, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(pageSize);

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
  const { latestByThread, publicByThread } = await loadSummaryMessagesForThreads(threadIds);
  requestCount += threadIds.length * 2;

  const directAssetRows = await fetchByIds(
    "assets",
    rows.map((t) => t.asset_id),
    "id, owner_id, name, kac_id, type"
  );
  const directAssetsById = new Map(directAssetRows.map((a) => [a.id, normalizeAssetRow(a, {
    viewerRelationship: a.owner_id === currentUserId ? "owner" : "authorized",
  })]));
  const missingHubThreads = rows.filter((t) => t.asset_id && !directAssetsById.has(t.asset_id) && t.hub_id);
  const hubResolvedRows = [];
  for (const thread of missingHubThreads) {
    const resolved = await resolveHubAssetForThread(thread);
    if (resolved) hubResolvedRows.push(resolved);
  }
  const assetRows = mergeAssets(Array.from(directAssetsById.values()), hubResolvedRows);
  const systemRows = await fetchByIds(
    "systems",
    rows.map((t) => t.system_id),
    "id, asset_id, name, system_type"
  );
  requestCount += 3;
  const proRows = await fetchByIds(
    "keepr_pros",
    rows.map((t) => t.keepr_pro_id),
    "id, name, category"
  );

  const userIds = Array.from(
    new Set(
      [
        ...rows.flatMap((t) => [t.owner_id, t.created_by]),
        ...Object.values(latestByThread).map((m) => m.from_user_id),
        ...Object.values(publicByThread).map((m) => m.from_user_id),
      ].filter(Boolean)
    )
  );
  const profileRows = await fetchByIds("profiles", userIds, "id, display_name, full_name");
  requestCount += userIds.length ? 1 : 0;

  const assetsById = Object.fromEntries(assetRows.map((a) => [a.id, a]));
  const systemsById = Object.fromEntries(systemRows.map((s) => [s.id, s]));
  const prosById = Object.fromEntries(proRows.map((p) => [p.id, p]));
  const profilesById = Object.fromEntries(profileRows.map((p) => [p.id, p]));
  const threads = rows
    .map((t) => {
      const summaryMessages = dedupeMessages([publicByThread[t.id], latestByThread[t.id]].filter(Boolean));
      const hydrated = {
        ...t,
        asset: assetsById[t.asset_id] || null,
        system: systemsById[t.system_id] || null,
        keeprPro: prosById[t.keepr_pro_id] || null,
        messages: summaryMessages,
        latestMessage: latestByThread[t.id] || null,
        latestMessagePreview: summarizePreview(latestByThread[t.id]) || "No messages yet",
      };
      return {
        ...hydrated,
        participantLabel: getThreadParticipantLabel(hydrated, currentUserId, profilesById),
        attentionState: getAttentionState(hydrated, currentUserId),
      };
    })
    .sort(sortThreadsForMessages);

  const result = {
    currentUserId,
    asset: asset ? normalizeAssetRow(asset, {
      viewerRelationship: asset.owner_id === currentUserId ? "owner" : "authorized",
    }) : assetRows.find((a) => a.id === effectiveAssetId) || null,
    system: systemId ? systemsById[systemId] || null : null,
    profilesById,
    threads,
    assets: assetRows,
    metrics: {
      requestCount,
      threadRows: rows.length,
      summaryMessageRows: Object.keys(latestByThread).length + Object.keys(publicByThread).length,
      totalMs: Date.now() - startedAt,
    },
  };
  devLogMessages("summary-load", result.metrics);
  return putCache(messageSummaryCache, cacheKey, result);
}

export async function loadMessageWorkspace(options = {}) {
  return loadMessageThreadSummaries(options);
}

function normalizeAttachmentRow(row) {
  const a = row?.attachments || row || {};
  return {
    placement_id: row?.id || null,
    attachment_id: row?.attachment_id || a.id,
    id: a.id || row?.attachment_id,
    kind: a.kind,
    title: a.title,
    notes: a.notes,
    url: a.url,
    file_name: a.file_name,
    mime_type: a.mime_type,
    bucket: a.bucket || a.storage_bucket,
    storage_path: a.storage_path,
    size_bytes: a.size_bytes,
    created_at: a.created_at,
    ai_metadata: a.ai_metadata || null,
  };
}

async function hydrateAttachmentUrls(attachments = []) {
  return Promise.all(
    attachments.map(async (attachment) => {
      const isImage = String(attachment.mime_type || "").startsWith("image/");
      const hasStoredObject = Boolean(attachment.bucket && attachment.storage_path);
      const signed =
        hasStoredObject
          ? await getSignedUrl({
              bucket: attachment.bucket,
              path: attachment.storage_path,
              expiresIn: 3600,
              transform: isImage ? { width: 900, quality: 82 } : null,
            }).catch(() => null)
          : null;
      return {
        ...attachment,
        signed_url: signed,
        urls: {
          signed,
          public: hasStoredObject ? null : attachment.url || null,
        },
      };
    })
  );
}

export async function loadAttachmentsForMessages(messageIds = []) {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return {};

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at,
      attachments (
        id,
        kind,
        title,
        notes,
        url,
        file_name,
        mime_type,
        bucket,
        storage_path,
        size_bytes,
        created_at,
        ai_metadata
      )
    `
    )
    .eq("target_type", "asset_thread_message")
    .in("target_id", ids)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const byMessage = {};
  for (const row of data || []) {
    if (!byMessage[row.target_id]) byMessage[row.target_id] = [];
    byMessage[row.target_id].push(normalizeAttachmentRow(row));
  }
  for (const messageId of Object.keys(byMessage)) {
    byMessage[messageId] = await hydrateAttachmentUrls(byMessage[messageId]);
  }
  return byMessage;
}

async function attachFilesToMessages(messages = []) {
  const byMessage = await loadAttachmentsForMessages(messages.map((message) => message.id));
  return messages.map((message) => ({
    ...message,
    attachments: byMessage[message.id] || [],
  }));
}

async function upsertAttachmentPlacements(attachmentId, placements = []) {
  const clean = placements.filter((p) => p?.target_type && p?.target_id);
  if (!attachmentId || !clean.length) return [];

  const { data, error } = await supabase
    .from("attachment_placements")
    .upsert(
      clean.map((p) => ({
        attachment_id: attachmentId,
        target_type: p.target_type,
        target_id: p.target_id,
        role: p.role || null,
        label: p.label || null,
        sort_order: p.sort_order ?? null,
        is_showcase: !!p.is_showcase,
      })),
      {
        onConflict: "attachment_id,target_type,target_id",
        ignoreDuplicates: false,
      }
    )
    .select("*");
  if (error) throw error;
  return data || [];
}

function buildThreadAttachmentPlacements({
  threadId,
  messageId = null,
  stewardshipId = null,
  actionId = null,
}) {
  return [
    threadId ? { target_type: "asset_thread", target_id: threadId, role: "thread_attachment" } : null,
    messageId ? { target_type: "asset_thread_message", target_id: messageId, role: "message_attachment" } : null,
    stewardshipId ? { target_type: "asset_provider_stewardship", target_id: stewardshipId, role: "relationship_shared" } : null,
    actionId ? { target_type: "reminder", target_id: actionId, role: "action_reference" } : null,
  ].filter(Boolean);
}

async function uploadPendingMessageAttachments({
  pendingAttachments = [],
  userId,
  assetId,
  threadId,
  stewardshipId = null,
  actionId = null,
}) {
  const uploaded = [];
  for (const pending of pendingAttachments || []) {
    const isPhoto = pending.kind === "photo" || String(pending.mimeType || "").startsWith("image/");
    const result = await uploadAttachmentFromUri({
      userId,
      assetId,
      kind: isPhoto ? "photo" : "file",
      fileUri: pending.uri,
      fileName: pending.fileName || pending.name || null,
      mimeType: pending.mimeType || null,
      sizeBytes: pending.fileSize || pending.size || null,
      title: pending.fileName || pending.name || null,
      sourceContext: "asset_thread_message",
      placements: buildThreadAttachmentPlacements({
        assetId,
        threadId,
        stewardshipId,
        actionId,
      }),
    });
    uploaded.push(result.attachment);
  }
  return uploaded;
}

async function placeUploadedAttachmentsOnMessage({
  attachments = [],
  assetId,
  threadId,
  messageId,
  stewardshipId = null,
  actionId = null,
}) {
  for (const attachment of attachments || []) {
    await upsertAttachmentPlacements(
      attachment.id || attachment.attachment_id,
      buildThreadAttachmentPlacements({
        assetId,
        threadId,
        messageId,
        stewardshipId,
        actionId,
      })
    );
  }
}

export async function loadKeeprProStewardshipThread({
  assetId,
  kac,
  organizationId,
  threadId,
  assetName = null,
  providerName = null,
  ownerName = null,
} = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId || !threadId) {
    return { currentUserId, threads: [], assets: [], systems: [], profilesById: {} };
  }

  const { data, error } = await supabase.rpc("get_keeprpro_stewardship_messages", {
    p_asset_id: assetId || null,
    p_kac: kac || null,
    p_organization_id: organizationId || null,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const thread = rows.find((row) => row?.id === threadId);
  if (!thread) {
    return { currentUserId, threads: [], assets: [], systems: [], profilesById: {} };
  }

  const messages = await attachFilesToMessages(dedupeMessages(thread.messages || []));
  const latestMessage = messages[messages.length - 1] || null;
  const asset = {
    id: thread.asset_id || assetId || null,
    name: assetName || "Asset",
    kac_id: kac || null,
    viewerRelationship: "service_stewardship",
  };
  const hydrated = {
    id: thread.id,
    asset_id: thread.asset_id || assetId || null,
    system_id: thread.system_id || null,
    keepr_pro_id: thread.keepr_pro_id || null,
    subject: thread.subject,
    status: thread.status,
    source_type: thread.source_type || "keeprpro_stewardship",
    created_at: thread.created_at || null,
    updated_at: thread.updated_at || latestMessage?.created_at || null,
    asset,
    system: null,
    keeprPro: providerName ? { id: thread.keepr_pro_id || null, name: providerName } : null,
    messages,
    latestMessage,
    latestMessagePreview: summarizePreview(latestMessage) || "No messages yet",
    participantLabel: providerName || "KeeprPro",
    attentionState: "Open",
    ownerDisplayName: ownerName,
    perspective: "keepr_pro",
  };

  return {
    currentUserId,
    asset,
    system: null,
    profilesById: {},
    threads: [hydrated],
    assets: asset.id ? [asset] : [],
    systems: [],
  };
}

export async function loadThreadMessages(threadId, {
  limit = MESSAGE_THREAD_PAGE_SIZE,
  before = null,
  force = false,
} = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId || !threadId) {
    return { currentUserId, messages: [], hasMore: false, nextCursor: null };
  }

  const cacheKey = scopedCacheKey([currentUserId, "thread", threadId, before || "latest", limit]);
  if (!force) {
    const cached = readCache(threadMessagesCache, cacheKey);
    if (cached) return { ...cached, fromCache: true };
  }

  const startedAt = Date.now();
  let query = supabase
    .from("asset_thread_messages")
    .select("id, thread_id, from_user_id, body, created_at, sender_type, sender_name")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) throw error;

  const descending = data || [];
  const messages = await attachFilesToMessages(dedupeMessages(descending));
  const result = {
    currentUserId,
    messages,
    hasMore: descending.length === limit,
    nextCursor: messages[0]?.created_at || null,
    metrics: {
      requestCount: 1,
      rows: messages.length,
      payloadBytes: JSON.stringify(messages).length,
      totalMs: Date.now() - startedAt,
    },
  };
  devLogMessages("thread-load", { threadId, before: Boolean(before), ...result.metrics });
  return putCache(threadMessagesCache, cacheKey, result);
}

export async function refreshThreadSummary(threadId) {
  if (!threadId) return null;
  invalidateMessageCache({ threadId });
  const { data, error } = await supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, keepr_pro_id, hub_id, owner_id, created_by, subject, status, source_type, resource_ref, created_at, updated_at")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function createMemberThread({
  assetId,
  systemId = null,
  keeprProId = null,
  hubId = null,
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

  const eligible = await loadEligibleRecipientsForAsset(assetId, currentUserId, { hubId });
  const isEligible = eligible.some((recipient) => recipient.id === recipientId);
  if (!isEligible) throw new Error("That participant is not available for this asset.");

  const selectedResourceRef = {
    ...(resourceRef || buildMessageResourceRef({ assetId, systemId })),
    participant_ids: Array.from(new Set([recipientId, currentUserId].filter(Boolean))),
  };

  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .insert({
      asset_id: assetId,
      system_id: systemId || null,
      keepr_pro_id: keeprProId || null,
      hub_id: hubId || null,
      owner_id: ownerId,
      created_by: currentUserId,
      subject: String(subject || "Keepr conversation").trim(),
      source_type: "member",
      resource_ref: selectedResourceRef,
      status: "open",
    })
    .select("id")
    .single();
  if (threadError) throw threadError;

  const finalResourceRef = buildMessageResourceRef({
    ...selectedResourceRef,
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
  invalidateMessageCache({
    userId: currentUserId,
    assetId,
    systemId,
    threadId: thread.id,
  });
  return thread;
}

export async function createMessageLinkThread({
  assetId,
  systemId = null,
  keeprProId = null,
  ownerId,
  recipient = null,
  subject,
  body,
}) {
  const cleanBody = String(body || "").trim();
  if (!cleanBody) throw new Error("Write a message first.");
  if (!assetId) throw new Error("Choose an asset.");
  if (!ownerId) throw new Error("Could not resolve the asset owner.");
  const selectedRecipient = recipient || {};
  const recipientName = cleanText(
    selectedRecipient.display_name ||
      selectedRecipient.name ||
      selectedRecipient.label ||
      selectedRecipient.email
  );
  if (!recipientName && !selectedRecipient.email) throw new Error("Choose who this is for.");

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("You need to be signed in.");

  const result = await keeprApiRequest("/api/message-link-create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: {
      asset_id: assetId,
      system_id: systemId || null,
      keepr_pro_id: keeprProId || selectedRecipient.keepr_pro_id || null,
      owner_id: ownerId,
      recipient: {
        display_name: recipientName || selectedRecipient.email || "Recipient",
        email: selectedRecipient.email || null,
        source_type: selectedRecipient.source_type || "external_contact",
        user_id: selectedRecipient.user_id || null,
        keepr_pro_id: selectedRecipient.keepr_pro_id || null,
      },
      subject: String(subject || "Keepr conversation").trim(),
      message: cleanBody,
    },
  });

  invalidateMessageCache({
    assetId,
    systemId,
    threadId: result?.thread_id,
  });
  return result;
}

export async function getThreadMessageLink(threadId) {
  if (!threadId) throw new Error("Thread is required.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("You need to be signed in.");

  const result = await keeprApiRequest(`/api/message-link-thread/${encodeURIComponent(threadId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return result?.link || null;
}

export async function rotateThreadMessageLink(threadId) {
  if (!threadId) throw new Error("Thread is required.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("You need to be signed in.");

  const result = await keeprApiRequest(`/api/message-link-thread/${encodeURIComponent(threadId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: { action: "rotate" },
  });
  invalidateMessageCache({ threadId });
  return result?.link || null;
}

export async function sendThreadReply(threadId, body, options = {}) {
  const cleanBody = String(body || "").trim();
  const pendingAttachments = options.pendingAttachments || [];
  if (!cleanBody && !pendingAttachments.length) throw new Error("Write a reply first.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) throw new Error("You need to be signed in.");

  const uploaded = await uploadPendingMessageAttachments({
    pendingAttachments,
    userId: currentUserId,
    assetId: options.assetId || null,
    threadId,
    stewardshipId: options.stewardshipId || null,
    actionId: options.actionId || null,
  });

  const { data, error } = await supabase
    .from("asset_thread_messages")
    .insert({
      thread_id: threadId,
      from_user_id: currentUserId,
      sender_type: "member",
      body: cleanBody || "Shared attachment",
    })
    .select("*")
    .single();
  if (error) throw error;

  await placeUploadedAttachmentsOnMessage({
    attachments: uploaded,
    assetId: options.assetId || null,
    threadId,
    messageId: data.id,
    stewardshipId: options.stewardshipId || null,
    actionId: options.actionId || null,
  });

  if (!options.suppressNotification) try {
    await createRelationshipMessageNotification({
      actorUserId: currentUserId,
      assetId: options.assetId || null,
      kac: options.kac || options.parentAssetKac || null,
      organizationId: options.organizationId || options.providerOrgId || null,
      stewardshipId: options.stewardshipId || null,
      actionId: options.actionId || null,
      threadId,
      title: options.notificationTitle || "New relationship message",
      body: cleanBody || "Shared attachment",
    });
  } catch (err) {
    devLogMessages("notification skipped", { error: err?.message || err, threadId });
  }

  invalidateMessageCache({ userId: currentUserId, threadId });
  const attachments = await hydrateAttachmentUrls(uploaded.map((attachment) => normalizeAttachmentRow(attachment)));
  return {
    ...data,
    attachments,
  };
}

export async function sendKeeprProStewardshipThreadReply({
  threadId,
  organizationId,
  body,
  assetId = null,
  stewardshipId = null,
  actionId = null,
  pendingAttachments = [],
}) {
  const cleanBody = String(body || "").trim();
  if (!cleanBody && !pendingAttachments.length) throw new Error("Write a reply first.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) throw new Error("You need to be signed in.");

  const uploaded = await uploadPendingMessageAttachments({
    pendingAttachments,
    userId: currentUserId,
    assetId,
    threadId,
    stewardshipId,
    actionId,
  });

  const { data, error } = await supabase.rpc("send_keeprpro_stewardship_thread_reply", {
    p_thread_id: threadId,
    p_organization_id: organizationId || null,
    p_body: cleanBody || "Shared attachment",
  });
  if (error) throw error;

  await placeUploadedAttachmentsOnMessage({
    attachments: uploaded,
    assetId,
    threadId,
    messageId: data?.id,
    stewardshipId,
    actionId,
  });

  try {
    await createRelationshipMessageNotification({
      actorUserId: currentUserId,
      actingOrganizationId: organizationId || null,
      assetId,
      organizationId: organizationId || null,
      stewardshipId,
      actionId,
      threadId,
      title: "New Wilson Marine message",
      body: cleanBody || "Shared attachment",
    });
  } catch (err) {
    devLogMessages("keeprpro notification skipped", { error: err?.message || err, threadId });
  }

  invalidateMessageCache({ threadId });
  if (!data) return null;
  const attachments = await hydrateAttachmentUrls(uploaded.map((attachment) => normalizeAttachmentRow(attachment)));
  return {
    ...data,
    attachments,
  };
}

export async function startKeeprProStewardshipThread({
  assetId,
  organizationId,
  body = null,
}) {
  if (!assetId) throw new Error("Missing asset.");
  if (!organizationId) throw new Error("Missing KeeprPro organization.");

  const { data, error } = await supabase.rpc("start_keeprpro_stewardship_thread", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
    p_body: body || null,
  });
  if (error) throw error;
  if (!data?.thread?.id) throw new Error("Could not start the relationship conversation.");

  invalidateMessageCache({
    assetId,
    threadId: data.thread.id,
  });
  return data;
}

export async function startOwnerKeeprProRelationshipThread({
  assetId,
  assetName,
  kac = null,
  keeprProId,
  keeprProName,
  organizationId = null,
  stewardshipId = null,
  providerMemberId = null,
  ownerId = null,
}) {
  if (!assetId) throw new Error("Missing asset.");
  if (!keeprProId) throw new Error("Missing KeeprPro.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData?.user?.id || null;
  if (!currentUserId) throw new Error("You need to be signed in.");
  const resolvedOwnerId = ownerId || currentUserId;

  const { data: existing, error: existingError } = await supabase
    .from("asset_threads")
    .select("id,asset_id,keepr_pro_id,owner_id,subject,status,updated_at")
    .eq("asset_id", assetId)
    .eq("keepr_pro_id", keeprProId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) {
    invalidateMessageCache({ assetId, threadId: existing.id });
    return { thread: existing, created: false };
  }

  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .insert({
      asset_id: assetId,
      system_id: null,
      keepr_pro_id: keeprProId,
      owner_id: resolvedOwnerId,
      created_by: currentUserId,
      subject: `General · ${keeprProName || "KeeprPro"}`,
      source_type: "member",
      resource_ref: {
        asset_id: assetId,
        parent_asset_kac: kac || null,
        keepr_pro_id: keeprProId,
        provider_org_id: organizationId || null,
        stewardship_id: stewardshipId || null,
        relationship_scope: "service_stewardship",
        participant_ids: [resolvedOwnerId, providerMemberId].filter(Boolean),
        asset_name: assetName || null,
      },
      status: "open",
    })
    .select("id,asset_id,keepr_pro_id,owner_id,subject,status,updated_at")
    .single();
  if (threadError) throw threadError;

  await supabase
    .from("asset_threads")
    .update({
      resource_ref: {
        asset_id: assetId,
        parent_asset_kac: kac || null,
        keepr_pro_id: keeprProId,
        provider_org_id: organizationId || null,
        stewardship_id: stewardshipId || null,
        relationship_scope: "service_stewardship",
        participant_ids: [resolvedOwnerId, providerMemberId].filter(Boolean),
        asset_name: assetName || null,
        thread_id: thread.id,
      },
    })
    .eq("id", thread.id);

  invalidateMessageCache({ assetId, threadId: thread.id });
  return { thread, created: true };
}

export function createMessagesRealtimeSubscriptions({
  currentUserId,
  threads = [],
  assetIds: visibleAssetIds = [],
  onRefresh,
  onMessageReceived,
  selectedThreadId,
} = {}) {
  if (!currentUserId || typeof onRefresh !== "function") return () => {};
  const channels = [];
  const seenEventIds = new Set();
  const threadIds = Array.from(new Set(threads.map((thread) => thread.id).filter(Boolean)));
  const assetIds = Array.from(
    new Set([
      ...threads.map((thread) => thread.asset_id).filter(Boolean),
      ...(visibleAssetIds || []).filter(Boolean),
    ])
  );
  if (!threadIds.length && !assetIds.length) return () => {};

  const handleChange = async (payload) => {
    const eventKey = `${payload.eventType}:${payload.table}:${payload.new?.id || payload.old?.id || payload.commit_timestamp}`;
    if (seenEventIds.has(eventKey)) return;
    seenEventIds.add(eventKey);

    const newMessage = payload.table === "asset_thread_messages" ? payload.new : null;
    if (newMessage?.from_user_id && String(newMessage.from_user_id) === String(currentUserId)) {
      await onRefresh({ quiet: true });
      return;
    }

    const affectedThreadId = newMessage?.thread_id || payload.new?.id || payload.old?.id || null;
    await onRefresh({ quiet: true });
    if (
      newMessage &&
      affectedThreadId &&
      String(affectedThreadId) !== String(selectedThreadId) &&
      typeof onMessageReceived === "function"
    ) {
      const thread = threads.find((t) => t.id === affectedThreadId);
      onMessageReceived({ message: newMessage, thread });
    }
  };

  assetIds.forEach((id) => {
    const channel = supabase
      .channel(`messages-thread-list:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asset_threads", filter: `asset_id=eq.${id}` },
        handleChange
      )
      .subscribe();
    channels.push(channel);
  });

  threadIds.forEach((id) => {
    const channel = supabase
      .channel(`messages-thread:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asset_thread_messages", filter: `thread_id=eq.${id}` },
        handleChange
      )
      .subscribe();
    channels.push(channel);
  });

  return () => {
    channels.forEach((channel) => supabase.removeChannel(channel));
  };
}
