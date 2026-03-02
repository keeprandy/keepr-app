import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ...your existing logic...

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const kac = String(body?.kac || "").trim();
    if (!kac) return new Response(JSON.stringify({ error: "Missing kac" }), { status: 400 });

    const admin = getSupabaseClient();

    const { data: asset, error: aErr } = await admin
      .from("assets")
      .select("id, name, kac_id")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .single();

    if (aErr || !asset) {
      return new Response(JSON.stringify({ error: "Asset not found" }), { status: 404 });
    }

    return new Response(
      JSON.stringify({
        asset,
        system: null,
        mode: "action",
        allowed_actions: ["view"], // public only (auth screen will return more)
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error", details: String(e) }), { status: 500 });
  }
});
