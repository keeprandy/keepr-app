import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

function getJwt(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

async function getEffectiveRole(admin: any, asset_id: string, user_id: string) {
  const nowIso = new Date().toISOString();

  // direct
  const { data: direct } = await admin
    .from("asset_stewardships")
    .select("access_role")
    .eq("asset_id", asset_id)
    .eq("user_id", user_id)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (direct?.[0]?.access_role) return direct[0].access_role;

  // org
  const { data: memberships } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", user_id);

  const orgIds = (memberships || []).map((m: any) => m.org_id);
  if (orgIds.length === 0) return null;

  const { data: orgStew } = await admin
    .from("asset_stewardships")
    .select("access_role")
    .eq("asset_id", asset_id)
    .in("org_id", orgIds)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1);

  return orgStew?.[0]?.access_role ?? null;
}

serve(async (req) => {
  try {
    const jwt = getJwt(req);
    if (!jwt) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    const title = body?.title?.trim();
    const notes = body?.notes ?? null;
    const performed_at = body?.performed_at ?? null;

    if (!token || !title) {
      return new Response(JSON.stringify({ error: "Missing token or title" }), { status: 400 });
    }

    const admin = getSupabaseClient();

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401 });
    }

    const token_hash = await hashToken(token);

    const { data: link } = await admin
      .from("public_links")
      .select("id, asset_id, system_id, is_active, expires_at")
      .eq("token_hash", token_hash)
      .single();

    if (!link || !link.is_active) return new Response(JSON.stringify({ error: "Invalid QR code" }), { status: 404 });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "QR code expired" }), { status: 403 });
    }

    const role = await getEffectiveRole(admin, link.asset_id, user.id);

    // Only stewards can write
    if (role !== "steward") {
      return new Response(JSON.stringify({ error: "Not authorized (no stewardship)" }), { status: 403 });
    }

    const dateStr =
      typeof performed_at === "string" && performed_at.length >= 10
        ? performed_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const { data: record, error: recErr } = await admin
      .from("service_records")
      .insert({
        asset_id: link.asset_id,
        system_id: link.system_id,
        title,
        notes,
        performed_at: dateStr,
        source_type: "manual",
        verification_status: "pending",
        extra_metadata: {
          source: "qr_in_app",
          public_link_id: link.id,
          actor_user_id: user.id,
          actor_role: "steward",
        },
      })
      .select("id")
      .single();

    if (recErr) throw recErr;

    return new Response(JSON.stringify({ record_id: record.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error", details: String(e) }), { status: 500 });
  }
});
