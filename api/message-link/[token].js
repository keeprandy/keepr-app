import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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

function previewText(value, max = 180) {
  const text = safeString(value).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

async function loadLinkContext(supabase, token) {
  const tokenHash = hashToken(token);
  const { data: tokenRow, error: tokenError } = await supabase
    .from("public_asset_thread_tokens")
    .select("id, thread_id, asset_id, sender_name, sender_email, expires_at, revoked_at, last_used_at, created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenError) throw tokenError;
  if (!tokenRow?.id) return { error: "link_not_found", status: 404 };
  if (tokenRow.revoked_at) return { error: "link_revoked", status: 410 };
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { error: "link_expired", status: 410 };
  }

  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, keepr_pro_id, owner_id, created_by, subject, status, source_type, resource_ref, created_at, updated_at")
    .eq("id", tokenRow.thread_id)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!thread?.id) return { error: "thread_not_found", status: 404 };

  const [{ data: asset }, { data: system }, { data: firstMessages }, { data: senderProfile }, { data: keeprPro }] =
    await Promise.all([
      supabase.from("assets").select("id, name, kac_id, owner_id").eq("id", thread.asset_id).maybeSingle(),
      thread.system_id
        ? supabase.from("systems").select("id, name, asset_id").eq("id", thread.system_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("asset_thread_messages")
        .select("id, body, from_user_id, sender_type, created_at")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true })
        .limit(1),
      thread.created_by
        ? supabase.from("profiles").select("id, display_name, full_name, email").eq("id", thread.created_by).maybeSingle()
        : Promise.resolve({ data: null }),
      thread.keepr_pro_id
        ? supabase.from("keepr_pros").select("id, name, category").eq("id", thread.keepr_pro_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const resourceRef = thread.resource_ref && typeof thread.resource_ref === "object" ? thread.resource_ref : {};
  const intendedRecipient = resourceRef.message_link?.intended_recipient || {};
  const claimedBy = safeString(resourceRef.message_link?.claimed_by);
  const senderName =
    safeString(senderProfile?.display_name || senderProfile?.full_name) ||
    safeString(tokenRow.sender_name) ||
    "A Keepr member";
  const firstMessage = firstMessages?.[0] || null;

  return {
    tokenRow,
    thread,
    preview: {
      thread_id: thread.id,
      subject: safeString(thread.subject) || "Keepr conversation",
      sender_name: senderName,
      recipient_name: safeString(intendedRecipient.display_name || intendedRecipient.email) || "Recipient",
      asset_id: asset?.id || thread.asset_id,
      asset_name: safeString(asset?.name) || "Keepr asset",
      parent_asset_kac: safeString(asset?.kac_id || resourceRef.parent_asset_kac),
      system_id: system?.id || thread.system_id || null,
      system_name: safeString(system?.name) || null,
      keepr_pro_name: safeString(keeprPro?.name) || null,
      message_preview: previewText(firstMessage?.body),
      authenticated_destination_route:
        safeString(resourceRef.authenticated_destination_route) ||
        messagesRoute({ assetId: thread.asset_id, systemId: thread.system_id, threadId: thread.id }),
      claimed: Boolean(claimedBy),
      claimed_by: claimedBy || null,
    },
  };
}

export default async function handler(req, res) {
  const rawToken = req.query?.token;
  const token = safeString(Array.isArray(rawToken) ? rawToken[0] : rawToken);
  if (!token) return res.status(400).json({ error: "token_required" });

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "message_link_unavailable" });

  try {
    const loaded = await loadLinkContext(supabase, token);
    if (loaded.error) return res.status(loaded.status || 400).json({ error: loaded.error });

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, preview: loaded.preview });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const authHeader = safeString(req.headers.authorization || req.headers.Authorization);
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return res.status(401).json({ error: "auth_required" });

    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user?.id) return res.status(401).json({ error: "auth_required" });

    const userId = authData.user.id;
    const currentRef = loaded.thread.resource_ref && typeof loaded.thread.resource_ref === "object"
      ? loaded.thread.resource_ref
      : {};
    const linkRef = currentRef.message_link && typeof currentRef.message_link === "object"
      ? currentRef.message_link
      : {};
    const claimedBy = safeString(linkRef.claimed_by);

    if (claimedBy && claimedBy !== userId) {
      return res.status(409).json({ error: "link_already_claimed", preview: loaded.preview });
    }

    const participantIds = Array.from(
      new Set([...(Array.isArray(currentRef.participant_ids) ? currentRef.participant_ids : []), userId].filter(Boolean))
    );
    const updatedRef = {
      ...currentRef,
      participant_ids: participantIds,
      authenticated_destination_route: messagesRoute({
        assetId: loaded.thread.asset_id,
        systemId: loaded.thread.system_id,
        threadId: loaded.thread.id,
      }),
      message_link: {
        ...linkRef,
        claimed_by: userId,
        claimed_at: new Date().toISOString(),
        status: "claimed",
      },
    };

    const { error: updateError } = await supabase
      .from("asset_threads")
      .update({ resource_ref: updatedRef })
      .eq("id", loaded.thread.id);
    if (updateError) throw updateError;

    await supabase
      .from("public_asset_thread_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", loaded.tokenRow.id);

    return res.status(200).json({
      ok: true,
      thread_id: loaded.thread.id,
      asset_id: loaded.thread.asset_id,
      system_id: loaded.thread.system_id || null,
      authenticated_destination_route: updatedRef.authenticated_destination_route,
      preview: { ...loaded.preview, claimed: true, claimed_by: userId },
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "message_link_failed" });
  }
}
