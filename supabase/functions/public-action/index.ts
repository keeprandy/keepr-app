import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
      if (!user?.id)
        return json(401, { error: "Sign in required" });

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
        source_url:
          safeStr(payloadPublicAction.source_url) ||
          null,
      };

      if (!title)
        return json(400, { error: "Missing title" });

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
