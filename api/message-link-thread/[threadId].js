import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function messagesRoute({ assetId, systemId, threadId }) {
  const params = new URLSearchParams();
  if (assetId) params.set("assetId", assetId);
  if (systemId) params.set("systemId", systemId);
  if (threadId) params.set("threadId", threadId);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

async function canManageThread(supabase, thread, userId) {
  if (!thread?.id || !userId) return false;
  if (thread.owner_id === userId || thread.created_by === userId) return true;
  const { data } = await supabase
    .from("asset_stewardships")
    .select("id")
    .eq("asset_id", thread.asset_id)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);
  return Boolean(data?.[0]?.id);
}

async function loadThreadBundle(supabase, threadId) {
  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, owner_id, created_by, subject, source_type, resource_ref")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) throw threadError;
  if (!thread?.id) return { error: "thread_not_found", status: 404 };

  const [{ data: asset }, { data: firstMessages }, { data: senderProfile }] = await Promise.all([
    supabase.from("assets").select("id, name, kac_id").eq("id", thread.asset_id).maybeSingle(),
    supabase
      .from("asset_thread_messages")
      .select("body")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true })
      .limit(1),
    thread.created_by
      ? supabase.from("profiles").select("display_name, full_name, email").eq("id", thread.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    thread,
    asset,
    firstMessage: firstMessages?.[0] || null,
    senderName:
      safeString(senderProfile?.display_name || senderProfile?.full_name) ||
      safeString(senderProfile?.email) ||
      "A Keepr member",
  };
}

async function loadTokenStatus(supabase, tokenId) {
  if (!tokenId) return null;
  const { data, error } = await supabase
    .from("public_asset_thread_tokens")
    .select("id, expires_at, revoked_at, last_used_at, created_at")
    .eq("id", tokenId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  const expired = data.expires_at && new Date(data.expires_at).getTime() < Date.now();
  return {
    ...data,
    status: data.revoked_at ? "revoked" : expired ? "expired" : "active",
  };
}

function responseForThread(req, bundle, tokenStatus = null) {
  const resourceRef = bundle.thread.resource_ref && typeof bundle.thread.resource_ref === "object"
    ? bundle.thread.resource_ref
    : {};
  const messageLink = resourceRef.message_link && typeof resourceRef.message_link === "object"
    ? resourceRef.message_link
    : {};
  const path = safeString(messageLink.path || messageLink.url);
  const linkUrl = path ? `${getOrigin(req)}${path.startsWith("/") ? path : `/${path}`}` : null;
  const copyText = linkUrl
    ? `${safeString(bundle.firstMessage?.body)}\n\nContinue the conversation in Keepr: ${linkUrl}`
    : null;
  return {
    thread_id: bundle.thread.id,
    token_id: messageLink.token_id || null,
    path: path || null,
    link_url: linkUrl,
    copy_text: copyText,
    status: messageLink.claimed_by || messageLink.status === "claimed"
      ? "claimed"
      : tokenStatus?.status || messageLink.status || "pending",
    claimed_by: messageLink.claimed_by || null,
    recipient: messageLink.intended_recipient || null,
  };
}

export default async function handler(req, res) {
  const rawThreadId = req.query?.threadId;
  const threadId = safeString(Array.isArray(rawThreadId) ? rawThreadId[0] : rawThreadId);
  if (!threadId) return res.status(400).json({ error: "thread_required" });

  const authHeader = safeString(req.headers.authorization || req.headers.Authorization);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return res.status(401).json({ error: "auth_required" });

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "message_link_unavailable" });

  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData?.user?.id) return res.status(401).json({ error: "auth_required" });
  const user = authData.user;

  try {
    const bundle = await loadThreadBundle(supabase, threadId);
    if (bundle.error) return res.status(bundle.status || 404).json({ error: bundle.error });
    if (!(await canManageThread(supabase, bundle.thread, user.id))) {
      return res.status(403).json({ error: "thread_not_authorized" });
    }

    const ref = bundle.thread.resource_ref && typeof bundle.thread.resource_ref === "object"
      ? bundle.thread.resource_ref
      : {};
    const linkRef = ref.message_link && typeof ref.message_link === "object" ? ref.message_link : {};
    const tokenStatus = await loadTokenStatus(supabase, linkRef.token_id);

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, link: responseForThread(req, bundle, tokenStatus) });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const action = safeString(req.body?.action || "rotate");

    if (action === "revoke") {
      if (linkRef.token_id) {
        await supabase
          .from("public_asset_thread_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", linkRef.token_id);
      }
      const nextRef = {
        ...ref,
        message_link: {
          ...linkRef,
          status: "revoked",
          revoked_at: new Date().toISOString(),
        },
      };
      await supabase.from("asset_threads").update({ resource_ref: nextRef }).eq("id", bundle.thread.id);
      return res.status(200).json({ ok: true, link: responseForThread(req, { ...bundle, thread: { ...bundle.thread, resource_ref: nextRef } }, { status: "revoked" }) });
    }

    if (action !== "rotate") return res.status(400).json({ error: "unsupported_action" });
    if (linkRef.claimed_by || linkRef.status === "claimed") {
      return res.status(409).json({ error: "conversation_already_claimed" });
    }

    if (linkRef.token_id) {
      await supabase
        .from("public_asset_thread_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", linkRef.token_id)
        .is("revoked_at", null);
    }

    const token = makeToken();
    const path = `/m/${encodeURIComponent(token)}`;
    const { data: tokenRow, error: tokenError } = await supabase
      .from("public_asset_thread_tokens")
      .insert({
        thread_id: bundle.thread.id,
        asset_id: bundle.thread.asset_id,
        sender_email: safeString(user.email) || "unknown@keepr.local",
        sender_name: bundle.senderName,
        token_hash: hashToken(token),
      })
      .select("id")
      .single();
    if (tokenError) throw tokenError;

    const nextRef = {
      ...ref,
      authenticated_destination_route: messagesRoute({
        assetId: bundle.thread.asset_id,
        systemId: bundle.thread.system_id,
        threadId: bundle.thread.id,
      }),
      message_link: {
        ...linkRef,
        token_id: tokenRow.id,
        path,
        status: "pending",
        revoked_at: null,
        rotated_at: new Date().toISOString(),
        created_by: user.id,
      },
    };
    await supabase.from("asset_threads").update({ resource_ref: nextRef }).eq("id", bundle.thread.id);
    return res.status(200).json({ ok: true, link: responseForThread(req, { ...bundle, thread: { ...bundle.thread, resource_ref: nextRef } }, { status: "active" }) });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "message_link_thread_failed" });
  }
}
