import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function safeObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}

function createOpaqueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getBaseUrl() {
  return (
    Deno.env.get("EXPO_PUBLIC_KEEPR_BASE_URL") ||
    Deno.env.get("SITE_URL") ||
    "https://app.keeprhome.com"
  ).replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendOwnerEmail({
  to,
  assetName,
  threadUrl,
}: {
  to: string;
  assetName: string;
  threadUrl: string;
}) {
  const token = Deno.env.get("POSTMARK_SERVER_TOKEN");
  if (!token) throw new Error("Missing POSTMARK_SERVER_TOKEN");

  const subject = `New message about ${assetName || "your asset"}`;
  const safeSubject = escapeHtml(subject);
  const safeAssetName = escapeHtml(assetName || "your asset");
  const safeThreadUrl = escapeHtml(threadUrl);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h1>${safeSubject}</h1>
      <p>A public visitor sent a Keepr message about ${safeAssetName}.</p>
      <a href="${safeThreadUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:white;text-decoration:none;border-radius:10px;font-weight:700;">
        Open Keepr Conversation
      </a>
      <p style="font-size:12px;color:#777;margin-top:24px;">${safeThreadUrl}</p>
    </div>
  `;

  const textBody =
    `${subject}\n\n` +
    `A public visitor sent a Keepr message about ${assetName || "your asset"}.\n\n` +
    `Open Keepr Conversation:\n${threadUrl}`;

  const postmarkRes = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: "Keepr <hello@keeprhome.com>",
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: textBody,
    }),
  });

  const resultText = await postmarkRes.text();
  console.log("POSTMARK PUBLIC ACTION STATUS", postmarkRes.status);
  console.log("POSTMARK PUBLIC ACTION RESPONSE", resultText);

  if (!postmarkRes.ok) throw new Error(`Postmark returned ${postmarkRes.status}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    });

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user ?? null;

    const body = await req.json().catch(() => ({}));
    const kac = safeStr(body?.kac).trim();
    const intent =
      safeStr(body?.intent).trim() ||
      safeStr(body?.action_type).trim();

    if (!kac) return json(400, { error: "Missing kac" });
    if (!intent) return json(400, { error: "Missing intent" });

    const { data: rows, error: rpcErr } = await supabase.rpc(
      "resolve_kac",
      { p_kac: kac }
    );

    if (rpcErr) return json(400, { error: rpcErr.message });

    const resolved = Array.isArray(rows) ? rows[0] : rows;
    if (!resolved?.master_asset_id)
      return json(404, { error: "KAC not found" });

    if (intent === "capture_event_inbox") {
      const title = safeStr(body?.payload?.title);
      const notes = safeStr(body?.payload?.notes);
      const payload = safeObj(body?.payload);
      const payloadContext = safeObj(payload.context);
      const payloadPublicAction = safeObj(payloadContext.public_action);
      const contact = safeObj(payloadPublicAction.contact);
      const publicAction = {
        type:
          safeStr(payloadPublicAction.type) ||
          safeStr(payload.type) ||
          "public_action",
        message:
          safeStr(payloadPublicAction.message) ||
          notes ||
          null,
        contact: {
          name:
            safeStr(contact.name) ||
            safeStr(payload.contact_name) ||
            null,
          email:
            safeStr(contact.email) ||
            safeStr(payload.contact_email) ||
            null,
          phone:
            safeStr(contact.phone) ||
            safeStr(payload.contact_phone) ||
            null,
        },
        kac,
        asset_id:
          safeStr(payloadPublicAction.asset_id) ||
          safeStr(resolved.asset_id) ||
          safeStr(resolved.master_asset_id) ||
          null,
        asset_name:
          safeStr(payloadPublicAction.asset_name) ||
          safeStr(resolved.asset_name) ||
          null,
        projection_type:
          safeStr(payloadPublicAction.projection_type) ||
          null,
        hub_id:
          safeStr(payloadPublicAction.hub_id) ||
          null,
        source_url:
          safeStr(payloadPublicAction.source_url) ||
          null,
      };

      if (!title)
        return json(400, { error: "Missing title" });

      if (publicAction.type === "question" && publicAction.contact.email) {
        const admin = getSupabaseClient();

        const { data: assetRow, error: assetError } = await admin
          .from("assets")
          .select("id, owner_id, name, kac_id")
          .eq("id", publicAction.asset_id || resolved.asset_id)
          .maybeSingle();

        if (assetError) return json(400, { error: "Asset unavailable" });
        if (!assetRow?.id || !assetRow?.owner_id) {
          return json(404, { error: "Asset not found" });
        }

        const senderEmail = safeStr(publicAction.contact.email).toLowerCase();
        const senderName = safeStr(publicAction.contact.name) || null;
        const assetName = safeStr(assetRow.name) || safeStr(publicAction.asset_name) || "your asset";

        const { data: existingToken } = await admin
          .from("public_asset_thread_tokens")
          .select("thread_id")
          .eq("asset_id", assetRow.id)
          .eq("sender_email", senderEmail)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let threadId = safeStr(existingToken?.thread_id);

        if (!threadId) {
          const { data: thread, error: threadError } = await admin
            .from("asset_threads")
            .insert({
              asset_id: assetRow.id,
              hub_id: publicAction.hub_id || null,
              owner_id: assetRow.owner_id,
              created_by: null,
              subject: assetName || "Asset question",
              status: "open",
            })
            .select("id")
            .single();

          if (threadError || !thread?.id) return json(400, { error: "Thread not created" });
          threadId = thread.id;
        } else {
          await admin
            .from("asset_threads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", threadId);
        }

        const { data: createdMessage, error: messageError } = await admin
          .from("asset_thread_messages")
          .insert({
            thread_id: threadId,
            from_user_id: null,
            body: publicAction.message || notes,
          })
          .select("id")
          .single();

        if (messageError || !createdMessage?.id) {
          return json(400, { error: "Message not saved" });
        }

        const publicThreadToken = createOpaqueToken();
        const { error: tokenError } = await admin
          .from("public_asset_thread_tokens")
          .insert({
            thread_id: threadId,
            asset_id: assetRow.id,
            sender_email: senderEmail,
            sender_name: senderName,
            token_hash: await hashToken(publicThreadToken),
            expires_at: null,
          });

        if (tokenError) return json(400, { error: "Thread token not created" });

        const ownerThreadUrl =
          `${getBaseUrl()}/asset/${encodeURIComponent(assetRow.id)}` +
          `/thread/${encodeURIComponent(threadId)}` +
          `/message/${encodeURIComponent(createdMessage.id)}`;
        const publicThreadUrl =
          `${getBaseUrl()}/thread/${encodeURIComponent(publicThreadToken)}` +
          `/message/${encodeURIComponent(createdMessage.id)}`;

        const notificationPayload = {
          thread_id: threadId,
          asset_id: assetRow.id,
          kac: safeStr(assetRow.kac_id).toUpperCase() || kac,
          message_id: createdMessage.id,
          projection_type: publicAction.projection_type || null,
          hub_id: publicAction.hub_id || null,
          thread_url: ownerThreadUrl,
        };

        try {
          const { error: notificationError } = await admin
            .from("notifications")
            .insert({
              user_id: assetRow.owner_id,
              type: "asset_thread_message",
              title: `New message about ${assetName}`,
              body: "Open the exact Keepr conversation to respond.",
              payload: notificationPayload,
            });
          if (notificationError) throw notificationError;
        } catch (notificationError) {
          console.error("Public Ask Owner notification failed", notificationError);
        }

        try {
          const { data: ownerProfile, error: profileError } = await admin
            .from("profiles")
            .select("email")
            .eq("id", assetRow.owner_id)
            .maybeSingle();
          if (profileError) throw profileError;
          const ownerEmail = safeStr(ownerProfile?.email);
          if (!ownerEmail) throw new Error("Owner email unavailable");
          await sendOwnerEmail({
            to: ownerEmail,
            assetName,
            threadUrl: ownerThreadUrl,
          });
        } catch (emailError) {
          console.error("Public Ask Owner email failed", emailError);
        }

        return json(200, {
          ok: true,
          thread: {
            id: threadId,
            asset_id: assetRow.id,
            kac: safeStr(assetRow.kac_id).toUpperCase() || kac,
          },
          message: { id: createdMessage.id },
          public_thread: {
            token: publicThreadToken,
            url: publicThreadUrl,
          },
        });
      }

      if (!user?.id)
        return json(401, { error: "Sign in required" });

      const { data: created, error: insErr } = await supabase
        .from("event_inbox")
        .insert({
          owner_id: user.id,
          asset_id: resolved.asset_id,
          status: "draft",
          origin_type: "portal",
          source_type: publicAction.type,
          title,
          notes,
          context: {
            ...payloadContext,
            source: {
              channel: "public",
              type: "qr_public_action",
            },
            origin: "public_action",
            kac,
            public_action: publicAction,
          },
        })
        .select("id,created_at,status")
        .single();

      if (insErr)
        return json(400, { error: insErr.message });

      return json(200, { ok: true, event: created });
    }

    return json(400, { error: "Unsupported intent" });

  } catch (e) {
    return json(500, { error: e?.message || "Server error" });
  }
});
