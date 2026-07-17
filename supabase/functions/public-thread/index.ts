import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeStr(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveToken(supabase: any, token: string) {
  const tokenHash = await hashToken(token);
  const { data: link, error } = await supabase
    .from("public_asset_thread_tokens")
    .select("id, thread_id, asset_id, sender_email, sender_name, created_at, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !link) return { error: "invalid_or_expired" };
  if (link.revoked_at) return { error: "invalid_or_expired" };
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { error: "expired" };
  }

  return { link };
}

async function readThread(supabase: any, link: any) {
  const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .select("id, asset_id, hub_id, owner_id, subject, status, created_at, updated_at")
    .eq("id", link.thread_id)
    .eq("asset_id", link.asset_id)
    .maybeSingle();

  if (threadError || !thread) return { error: "missing_thread" };

  const { data: asset } = await supabase
    .from("assets")
    .select("id, kac_id, name")
    .eq("id", link.asset_id)
    .maybeSingle();

  const { data: messages, error: messageError } = await supabase
    .from("asset_thread_messages")
    .select("id, thread_id, from_user_id, body, created_at")
    .eq("thread_id", link.thread_id)
    .order("created_at", { ascending: true });

  if (messageError) return { error: "messages_unavailable" };

  await supabase
    .from("public_asset_thread_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", link.id);

  return {
    thread: {
      ...thread,
      asset_thread_messages: (messages || []).map((message: any) => ({
        id: message.id,
        thread_id: message.thread_id,
        from_user_id: message.from_user_id,
        body: message.body,
        created_at: message.created_at,
        sender_role:
          message.from_user_id && String(message.from_user_id) === String(thread.owner_id)
            ? "owner"
            : "public_sender",
      })),
    },
    asset: {
      id: asset?.id || link.asset_id,
      kac_id: asset?.kac_id || null,
      name: asset?.name || thread.subject || "Asset",
    },
    sender: {
      name: link.sender_name || null,
      email: link.sender_email || null,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const token = safeStr(body?.token);
    const intent = safeStr(body?.intent) || "read_thread";

    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const supabase = getSupabaseClient();
    const resolved = await resolveToken(supabase, token);
    if (resolved.error) {
      return json({ ok: false, error: resolved.error }, resolved.error === "expired" ? 403 : 404);
    }

    const link = resolved.link;

    if (intent === "post_followup") {
      const message = safeStr(body?.message);
      if (!message) return json({ ok: false, error: "missing_message" }, 400);

      const { data: createdMessage, error: insertError } = await supabase
        .from("asset_thread_messages")
        .insert({
          thread_id: link.thread_id,
          from_user_id: null,
          body: message,
        })
        .select("id")
        .single();

      if (insertError) return json({ ok: false, error: "message_not_saved" }, 400);

      await supabase
        .from("asset_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", link.thread_id);

      return json({
        ok: true,
        message_id: createdMessage?.id || null,
        ...(await readThread(supabase, link)),
      });
    }

    if (intent !== "read_thread") {
      return json({ ok: false, error: "unsupported_intent" }, 400);
    }

    return json({ ok: true, ...(await readThread(supabase, link)) });
  } catch (_e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
});
