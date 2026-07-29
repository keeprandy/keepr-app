import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function publicSystemRoute(kac, systemId) {
  if (!kac || !systemId) return null;
  return `/k/${encodeURIComponent(kac)}/n/${encodeURIComponent(systemId)}`;
}

function messagesRoute({ assetId, systemId, threadId }) {
  const params = new URLSearchParams();
  if (assetId) params.set("assetId", assetId);
  if (systemId) params.set("systemId", systemId);
  if (threadId) params.set("threadId", threadId);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

function resourceRef({ kac, assetId, systemId, threadId }) {
  return {
    parent_asset_kac: kac || null,
    asset_id: assetId || null,
    system_id: systemId || null,
    canonical_public_route: publicSystemRoute(kac, systemId),
    authenticated_destination_route: messagesRoute({ assetId, systemId, threadId }),
    intended_thread_id: threadId || null,
  };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const body = req.body || {};
  const kac = safeString(body.kac);
  const nodeId = safeString(body.node_id || body.nodeId);
  const title = safeString(body.title) || "Public system message";
  const message = safeString(body.message);
  const name = safeString(body.contact?.name);
  const email = safeString(body.contact?.email);
  const phone = safeString(body.contact?.phone);
  const sourceUrl = safeString(body.source_url);
  const keeprProId = safeString(body.keepr_pro_id);

  if (!kac || !UUID_RE.test(nodeId)) return res.status(400).json({ error: "invalid_node_request" });
  if (!name || !email) return res.status(400).json({ error: "contact_required" });
  if (!message) return res.status(400).json({ error: "message_required" });

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "action_unavailable" });

  try {
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id, name, kac_id, owner_id")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!asset?.id) return res.status(404).json({ error: "asset_not_found" });

    const { data: system, error: systemError } = await supabase
      .from("systems")
      .select("id, name, asset_id")
      .eq("id", nodeId)
      .eq("asset_id", asset.id)
      .maybeSingle();

    if (systemError) throw systemError;
    if (!system?.id) return res.status(404).json({ error: "node_not_found" });

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: duplicate } = await supabase
      .from("event_inbox")
      .select("id, created_at, status, asset_thread_id")
      .eq("owner_id", asset.owner_id)
      .eq("asset_id", asset.id)
      .eq("system_id", system.id)
      .eq("origin_type", "portal")
      .eq("source_type", "public_system_message")
      .eq("title", title)
      .contains("context", { public_action: { message } })
      .gte("created_at", since)
      .limit(1);

    if (duplicate?.[0]?.id) {
      return res.status(200).json({ ok: true, duplicate: true, event: duplicate[0] });
    }

    const pendingResourceRef = resourceRef({
      kac: asset.kac_id || kac,
      assetId: asset.id,
      systemId: system.id,
    });

    const context = {
      origin: "public_system_story",
      resource_ref: pendingResourceRef,
      source: {
        channel: "public",
        type: "qr_public_system_story",
        source_url: sourceUrl || null,
      },
      public_action: {
        type: "public_system_message",
        message,
        contact: { name, email, phone: phone || null },
        kac,
        asset_id: asset.id,
        asset_name: asset.name || null,
        system_id: system.id,
        system_name: system.name || null,
        keepr_pro_id: keeprProId || null,
        assignment_scope: "system",
        source_screen: "public_system_story",
        source_url: sourceUrl || null,
        resource_ref: pendingResourceRef,
      },
    };

    const { data: thread, error: threadError } = await supabase
      .from("asset_threads")
      .insert({
        asset_id: asset.id,
        system_id: system.id,
        keepr_pro_id: keeprProId || null,
        owner_id: asset.owner_id,
        created_by: null,
        subject: title || `${system.name || "System"} update`,
        status: "open",
        source_type: "public_system_story",
        resource_ref: pendingResourceRef,
      })
      .select("id, created_at, status")
      .single();

    if (threadError) throw threadError;
    if (!thread?.id) throw new Error("thread_not_created");

    const { error: messageError } = await supabase
      .from("asset_thread_messages")
      .insert({
        thread_id: thread.id,
        from_user_id: null,
        sender_type: "public_visitor",
        sender_name: name,
        sender_email: email,
        sender_phone: phone || null,
        body: message,
      });

    if (messageError) throw messageError;

    const finalResourceRef = resourceRef({
      kac: asset.kac_id || kac,
      assetId: asset.id,
      systemId: system.id,
      threadId: thread.id,
    });

    await supabase
      .from("asset_threads")
      .update({ resource_ref: finalResourceRef })
      .eq("id", thread.id);

    const { data: created, error: insertError } = await supabase
      .from("event_inbox")
      .insert({
        owner_id: asset.owner_id,
        asset_id: asset.id,
        system_id: system.id,
        keepr_pro_id: keeprProId || null,
        asset_thread_id: thread.id,
        status: "draft",
        origin_type: "portal",
        source_type: "public_system_message",
        title,
        notes: null,
        context: {
          ...context,
          resource_ref: finalResourceRef,
        },
      })
      .select("id, created_at, status")
      .single();

    if (insertError) throw insertError;
    return res.status(200).json({ ok: true, duplicate: false, event: created, thread });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "server_error" });
  }
}
