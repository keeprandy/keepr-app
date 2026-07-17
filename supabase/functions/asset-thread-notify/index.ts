import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotifyEventType = "new_ask_owner_message" | "owner_reply";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeStr(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl() {
  return (
    Deno.env.get("EXPO_PUBLIC_KEEPR_BASE_URL") ||
    Deno.env.get("SITE_URL") ||
    "https://app.keeprhome.com"
  ).replace(/\/+$/, "");
}

function buildThreadUrl({
  baseUrl,
  assetId,
  kac,
  threadId,
  messageId,
}: {
  baseUrl: string;
  assetId: string | null;
  kac: string | null;
  threadId: string;
  messageId: string | null;
}) {
  const suffix = messageId ? `/message/${encodeURIComponent(messageId)}` : "";
  if (assetId) {
    return `${baseUrl}/asset/${encodeURIComponent(assetId)}/thread/${encodeURIComponent(threadId)}${suffix}`;
  }
  if (kac) {
    return `${baseUrl}/k/${encodeURIComponent(kac)}/thread/${encodeURIComponent(threadId)}${suffix}`;
  }
  throw new Error("Missing asset identity for thread permalink.");
}

function subjectFor(eventType: NotifyEventType, assetName: string) {
  if (eventType === "owner_reply") {
    return `Owner replied about ${assetName}`;
  }
  return `New message about ${assetName}`;
}

async function sendPostmarkEmail({
  to,
  subject,
  assetName,
  ctaUrl,
  ctaLabel,
}: {
  to: string;
  subject: string;
  assetName: string;
  ctaUrl: string;
  ctaLabel: string;
}) {
  const token = Deno.env.get("POSTMARK_SERVER_TOKEN");
  if (!token) throw new Error("Missing POSTMARK_SERVER_TOKEN");

  const safeAssetName = escapeHtml(assetName);
  const safeSubject = escapeHtml(subject);
  const safeCtaUrl = escapeHtml(ctaUrl);
  const safeCtaLabel = escapeHtml(ctaLabel);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h1>${safeSubject}</h1>
      <p>You have a new Keepr message connected to ${safeAssetName}.</p>
      <a href="${safeCtaUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:white;text-decoration:none;border-radius:10px;font-weight:700;">
        ${safeCtaLabel}
      </a>
      <p style="font-size:12px;color:#777;margin-top:24px;">${safeCtaUrl}</p>
    </div>
  `;

  const textBody =
    `${subject}\n\n` +
    `You have a new Keepr message connected to ${assetName}.\n\n` +
    `${ctaLabel}:\n${ctaUrl}`;

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
  console.log("POSTMARK ASSET THREAD STATUS", postmarkRes.status);
  console.log("POSTMARK ASSET THREAD RESPONSE", resultText);

  if (!postmarkRes.ok) {
    throw new Error(`Postmark returned ${postmarkRes.status}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    if (!authHeader) return json(401, { ok: false, error: "missing_auth" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: auth, error: authError } = await userClient.auth.getUser();
    const user = auth?.user ?? null;
    if (authError || !user?.id) return json(401, { ok: false, error: "invalid_auth" });

    const body = await req.json().catch(() => ({}));
    const eventType = safeStr(body?.event_type) as NotifyEventType;
    const threadId = safeStr(body?.thread_id);
    const messageId = safeStr(body?.message_id);
    const bodyAssetId = safeStr(body?.asset_id) || null;
    const bodyKac = safeStr(body?.kac).toUpperCase() || null;
    const projectionType = safeStr(body?.projection_type) || null;
    const hubId = safeStr(body?.hub_id) || null;

    if (!["new_ask_owner_message", "owner_reply"].includes(eventType)) {
      return json(400, { ok: false, error: "unsupported_event_type" });
    }
    if (!threadId || !messageId) {
      return json(400, { ok: false, error: "missing_thread_or_message" });
    }

    const { data: visibleThread, error: visibleThreadError } = await userClient
      .from("asset_threads")
      .select("id, asset_id, owner_id, created_by, subject, hub_id")
      .eq("id", threadId)
      .maybeSingle();

    if (visibleThreadError) throw visibleThreadError;
    if (!visibleThread) return json(403, { ok: false, error: "thread_not_visible" });

    const { data: visibleMessage, error: visibleMessageError } = await userClient
      .from("asset_thread_messages")
      .select("id, thread_id, from_user_id")
      .eq("id", messageId)
      .eq("thread_id", threadId)
      .maybeSingle();

    if (visibleMessageError) throw visibleMessageError;
    if (!visibleMessage) return json(403, { ok: false, error: "message_not_visible" });

    if (String(visibleMessage.from_user_id) !== String(user.id)) {
      return json(403, { ok: false, error: "message_sender_mismatch" });
    }

    const ownerId = safeStr(visibleThread.owner_id);
    const creatorId = safeStr(visibleThread.created_by);
    const recipientUserId =
      eventType === "owner_reply" ? creatorId : ownerId;

    if (!recipientUserId || String(recipientUserId) === String(user.id)) {
      return json(200, { ok: true, skipped: "no_recipient" });
    }

    if (eventType === "owner_reply" && String(user.id) !== String(ownerId)) {
      return json(403, { ok: false, error: "owner_reply_requires_owner" });
    }

    const { data: assetRow } = await admin
      .from("assets")
      .select("id, kac_id, name")
      .eq("id", visibleThread.asset_id)
      .maybeSingle();

    const assetId = safeStr(assetRow?.id) || bodyAssetId || safeStr(visibleThread.asset_id) || null;
    const kac = safeStr(assetRow?.kac_id).toUpperCase() || bodyKac;
    const assetName =
      safeStr(assetRow?.name) ||
      safeStr(visibleThread.subject) ||
      "this asset";
    const threadUrl = buildThreadUrl({
      baseUrl: getBaseUrl(),
      assetId,
      kac,
      threadId,
      messageId,
    });

    const notificationPayload = {
      thread_id: threadId,
      asset_id: assetId,
      kac,
      message_id: messageId,
      projection_type: projectionType,
      hub_id: hubId || safeStr(visibleThread.hub_id) || null,
      thread_url: threadUrl,
    };

    const subject = subjectFor(eventType, assetName);
    const notificationTitle = subject;
    const notificationBody =
      eventType === "owner_reply"
        ? "Open the exact Keepr conversation to reply."
        : "Open the exact Keepr conversation to respond.";

    try {
      const { error: notificationError } = await admin
        .from("notifications")
        .insert({
          user_id: recipientUserId,
          type: "asset_thread_message",
          title: notificationTitle,
          body: notificationBody,
          payload: notificationPayload,
        });

      if (notificationError) throw notificationError;
    } catch (notificationError) {
      console.error("Asset thread in-app notification failed", notificationError);
    }

    try {
      const { data: recipientProfile, error: profileError } = await admin
        .from("profiles")
        .select("email")
        .eq("id", recipientUserId)
        .maybeSingle();

      if (profileError) throw profileError;
      const to = safeStr(recipientProfile?.email);
      if (!to) throw new Error("Recipient email unavailable.");

      await sendPostmarkEmail({
        to,
        subject,
        assetName,
        ctaUrl: threadUrl,
        ctaLabel: "Open Keepr Conversation",
      });
    } catch (emailError) {
      console.error("Asset thread email failed", emailError);
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("Asset thread notify failed", e);
    return json(500, { ok: false, error: "notification_failed" });
  }
});
