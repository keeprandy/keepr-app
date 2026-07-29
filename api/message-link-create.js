import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function messagesRoute({ assetId, systemId, threadId }) {
  const params = new URLSearchParams();
  if (assetId) params.set("assetId", assetId);
  if (systemId) params.set("systemId", systemId);
  if (threadId) params.set("threadId", threadId);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

function publicResourceRoute({ kac, systemId }) {
  if (!kac) return null;
  if (systemId) return `/k/${encodeURIComponent(kac)}/n/${encodeURIComponent(systemId)}`;
  return `/k/${encodeURIComponent(kac)}`;
}

function getSupabase(service = false, jwt = null) {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = service
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined,
  });
}

async function canStartForAsset(supabase, asset, userId) {
  if (!asset?.id || !userId) return false;
  if (asset.owner_id === userId) return true;

  const { data: stewardship, error } = await supabase
    .from("asset_stewardships")
    .select("id")
    .eq("asset_id", asset.id)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);

  if (error) return false;
  return Boolean(stewardship?.[0]?.id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authHeader = safeString(req.headers.authorization || req.headers.Authorization);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return res.status(401).json({ error: "auth_required" });

  const service = getSupabase(true);
  if (!service) return res.status(503).json({ error: "message_link_unavailable" });

  const { data: authData, error: authError } = await service.auth.getUser(jwt);
  if (authError || !authData?.user?.id) return res.status(401).json({ error: "auth_required" });
  const user = authData.user;

  const body = req.body || {};
  const assetId = safeString(body.asset_id || body.assetId);
  const systemId = safeString(body.system_id || body.systemId);
  const keeprProId = safeString(body.keepr_pro_id || body.keeprProId);
  const subject = safeString(body.subject) || "Keepr conversation";
  const messageBody = safeString(body.message || body.body);
  const recipient = body.recipient && typeof body.recipient === "object" ? body.recipient : {};
  const recipientName = safeString(recipient.display_name || recipient.name || recipient.label || recipient.email);
  const recipientEmail = safeString(recipient.email).toLowerCase();
  const recipientKind = safeString(recipient.source_type || recipient.kind || "external_contact") || "external_contact";
  const recipientUserId = safeString(recipient.user_id || recipient.userId);

  if (!assetId) return res.status(400).json({ error: "asset_required" });
  if (!recipientName && !recipientEmail) return res.status(400).json({ error: "recipient_required" });
  if (!messageBody) return res.status(400).json({ error: "message_required" });

  const { data: asset, error: assetError } = await service
    .from("assets")
    .select("id, owner_id, name, kac_id")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();

  if (assetError) return res.status(500).json({ error: assetError.message });
  if (!asset?.id) return res.status(404).json({ error: "asset_not_found" });

  const allowed = await canStartForAsset(service, asset, user.id);
  if (!allowed) return res.status(403).json({ error: "asset_not_authorized" });

  let system = null;
  if (systemId) {
    const { data: systemRow, error: systemError } = await service
      .from("systems")
      .select("id, name, asset_id")
      .eq("id", systemId)
      .eq("asset_id", asset.id)
      .maybeSingle();
    if (systemError) return res.status(500).json({ error: systemError.message });
    if (!systemRow?.id) return res.status(404).json({ error: "system_not_found" });
    system = systemRow;
  }

  const senderName =
    safeString(user.user_metadata?.display_name || user.user_metadata?.full_name) ||
    safeString(user.email) ||
    "A Keepr member";
  const token = makeToken();
  const tokenHash = hashToken(token);
  const linkPath = `/m/${encodeURIComponent(token)}`;
  const linkUrl = `${getOrigin(req)}${linkPath}`;
  const canonicalPublicRoute = publicResourceRoute({ kac: asset.kac_id, systemId: system?.id });
  const pendingResourceRef = {
    parent_asset_kac: asset.kac_id || null,
    asset_id: asset.id,
    system_id: system?.id || null,
    canonical_public_route: canonicalPublicRoute,
    authenticated_destination_route: messagesRoute({ assetId: asset.id, systemId: system?.id || null }),
    intended_thread_id: null,
    participant_ids: [user.id],
    message_link: {
      token_id: null,
      path: linkPath,
      created_by: user.id,
      intended_recipient: {
        display_name: recipientName || recipientEmail || "Recipient",
        email: recipientEmail || null,
        source_type: recipientKind,
        user_id: recipientUserId || null,
      },
      status: "pending",
    },
  };

  try {
    const { data: thread, error: threadError } = await service
      .from("asset_threads")
      .insert({
        asset_id: asset.id,
        system_id: system?.id || null,
        keepr_pro_id: keeprProId || null,
        owner_id: asset.owner_id,
        created_by: user.id,
        subject,
        status: "open",
        source_type: "member_message_link",
        resource_ref: pendingResourceRef,
      })
      .select("id, created_at")
      .single();
    if (threadError) throw threadError;

    const { error: messageError } = await service
      .from("asset_thread_messages")
      .insert({
        thread_id: thread.id,
        from_user_id: user.id,
        sender_type: "member",
        body: messageBody,
      });
    if (messageError) throw messageError;

    const { data: tokenRow, error: tokenError } = await service
      .from("public_asset_thread_tokens")
      .insert({
        thread_id: thread.id,
        asset_id: asset.id,
        sender_email: safeString(user.email) || "unknown@keepr.local",
        sender_name: senderName,
        token_hash: tokenHash,
      })
      .select("id")
      .single();
    if (tokenError) throw tokenError;

    const finalResourceRef = {
      ...pendingResourceRef,
      authenticated_destination_route: messagesRoute({
        assetId: asset.id,
        systemId: system?.id || null,
        threadId: thread.id,
      }),
      intended_thread_id: thread.id,
      message_link: {
        ...pendingResourceRef.message_link,
        token_id: tokenRow.id,
      },
    };

    await service
      .from("asset_threads")
      .update({ resource_ref: finalResourceRef })
      .eq("id", thread.id);

    const copyText = `${messageBody}\n\nContinue the conversation in Keepr: ${linkUrl}`;
    return res.status(200).json({
      ok: true,
      thread_id: thread.id,
      link_url: linkUrl,
      copy_text: copyText,
      recipient: finalResourceRef.message_link.intended_recipient,
      resource: {
        asset_id: asset.id,
        asset_name: asset.name || "Asset",
        system_id: system?.id || null,
        system_name: system?.name || null,
        parent_asset_kac: asset.kac_id || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "message_link_create_failed" });
  }
}
