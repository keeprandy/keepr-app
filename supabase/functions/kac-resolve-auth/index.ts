import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";

function getJwt(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}
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

async function getEffectiveRole(admin: any, asset_id: string, user_id: string) {
  const nowIso = new Date().toISOString();

  // Direct user stewardship
  const { data: direct, error: dErr } = await admin
    .from("asset_stewardships")
    .select("access_role")
    .eq("asset_id", asset_id)
    .eq("user_id", user_id)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (dErr) throw dErr;
  if (direct?.[0]?.access_role) return direct[0].access_role;

  // Org membership → org stewardship
  const { data: memberships, error: mErr } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", user_id);

  if (mErr) throw mErr;

  const orgIds = (memberships || []).map((m: any) => m.org_id);
  if (!orgIds.length) return null;

  const { data: orgStew, error: oErr } = await admin
    .from("asset_stewardships")
    .select("access_role")
    .eq("asset_id", asset_id)
    .in("org_id", orgIds)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (oErr) throw oErr;
  return orgStew?.[0]?.access_role ?? null;
}

serve(async (req) => {
  try {
    const jwt = getJwt(req);
    if (!jwt) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const kac = String(body?.kac || "").trim();
    if (!kac) return new Response(JSON.stringify({ error: "Missing kac" }), { status: 400 });

    const admin = getSupabaseClient();

    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (uErr || !user) return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401 });

    const { data: asset, error: aErr } = await admin
      .from("assets")
      .select("id, name, kac_id")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .single();

    if (aErr || !asset) return new Response(JSON.stringify({ error: "Asset not found" }), { status: 404 });

    const role = await getEffectiveRole(admin, asset.id, user.id);

    const allowed_actions =
      role === "steward"
        ? ["log", "proof", "view"]
        : role === "viewer"
          ? ["view"]
          : ["request_access", "view"];

    return new Response(
      JSON.stringify({
        whoami: { user_id: user.id, email: user.email ?? null },
        asset,
        system: null,
        mode: "action",
        stewardship: { access_role: role },
        allowed_actions,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error", details: String(e) }), { status: 500 });
  }
});
