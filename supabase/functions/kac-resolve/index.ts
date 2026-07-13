import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const kac = String(body?.kac || "").trim();
    if (!kac) return json({ error: "Missing kac" }, 400);

    const admin = getSupabaseClient();

    const { data: asset, error: aErr } = await admin
      .from("assets")
      .select("id, name, kac_id")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .single();

    if (aErr || !asset) {
      return json({ error: "Asset not found" }, 404);
    }

    return json(
      {
        asset,
        system: null,
        mode: "action",
        allowed_actions: ["view"], // public only (auth screen will return more)
      }
    );
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
});
