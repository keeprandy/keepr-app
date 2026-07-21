import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    const token = safeStr(body?.token).trim();
    const intent =
      safeStr(body?.intent).trim() ||
      safeStr(body?.action_type).trim();

    if (!kac && !token) return json(400, { error: "Missing kac or token" });
    if (!intent) return json(400, { error: "Missing intent" });

    let resolved: Record<string, unknown> | null = null;

    if (token) {
      if (!serviceRole) return json(500, { error: "Missing service role configuration" });
      const admin = createClient(supabaseUrl, serviceRole);
      const tokenHash = await hashToken(token);
      const { data: link, error: linkErr } = await admin
        .from("public_links")
        .select("id, asset_id, system_id, mode, label, is_active, expires_at")
        .eq("token_hash", tokenHash)
        .single();

      if (linkErr || !link || !link.is_active) {
        return json(404, { error: "Invalid QR code" });
      }
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return json(403, { error: "QR code expired" });
      }

      resolved = {
        master_asset_id: link.asset_id,
        asset_id: link.asset_id,
        system_id: link.system_id,
        public_link_id: link.id,
        mode: link.mode,
        label: link.label,
      };
    } else {
      const { data: rows, error: rpcErr } = await supabase.rpc(
        "resolve_kac",
        { p_kac: kac }
      );

      if (rpcErr) return json(400, { error: rpcErr.message });

      resolved = Array.isArray(rows) ? rows[0] : rows;
      if (!resolved?.master_asset_id)
        return json(404, { error: "KAC not found" });
    }

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
        system_id:
          safeStr(payloadPublicAction.system_id) ||
          safeStr(resolved.system_id) ||
          null,
        keepr_pro_id:
          safeStr(payloadPublicAction.keepr_pro_id) ||
          null,
        assignment_scope:
          safeStr(payloadPublicAction.assignment_scope) ||
          null,
        source_screen:
          safeStr(payloadPublicAction.source_screen) ||
          null,
        public_link_id:
          safeStr(payloadPublicAction.public_link_id) ||
          safeStr(resolved.public_link_id) ||
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
