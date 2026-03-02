// supabase/functions/public-resolve/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // If you need tighter CORS later, lock this down.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);

    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const supabase = getSupabaseClient();
    const token_hash = await hashToken(token);

    // 1) Lookup link
    const { data: link, error: linkErr } = await supabase
      .from("public_links")
      .select("id, asset_id, system_id, mode, label, is_active, expires_at")
      .eq("token_hash", token_hash)
      .single();

    if (linkErr || !link || !link.is_active) {
      return json({ ok: false, error: "invalid_or_expired" }, 404);
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return json({ ok: false, error: "expired" }, 403);
    }

    // 2) Track view
    await supabase.from("public_intake_events").insert({
      public_link_id: link.id,
      event_type: "view",
      user_agent: req.headers.get("user-agent"),
    });

    // 3) Fetch payload (asset vs system)
    let scope: "asset" | "system" = "asset";
    let payload: any = null;

    if (link.system_id) {
      scope = "system";

      // You should have (or create) a SQL function that returns
      // the same “package” shape you tested earlier (system/readiness/proof)
      const { data, error } = await supabase.rpc("get_public_system_package", {
        p_token: token,
      });

      if (error) {
        return json({ ok: false, error: error.message || "package_error" }, 500);
      }
      payload = data;
    } else {
      scope = "asset";
      const { data, error } = await supabase.rpc("get_public_asset_view", {
        p_token: token,
      });

      if (error) {
        return json({ ok: false, error: error.message || "view_error" }, 500);
      }
      payload = data;
    }

    return json({
      ok: true,
      scope,
      mode: link.mode,
      label: link.label,
      public_link_id: link.id,
      asset_id: link.asset_id,
      system_id: link.system_id,
      payload,
    });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
});
