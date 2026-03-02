import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

function getJwt(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

serve(async (req) => {
  try {
    const jwt = getJwt(req);
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), { status: 400 });
    }

    const admin = getSupabaseClient();

    // Identify user from JWT (no anon key needed)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401 });
    }

    // Resolve QR → public_links
    const token_hash = await hashToken(token);

    const { data: link, error: linkErr } = await admin
      .from("public_links")
      .select("id, asset_id, system_id, mode, is_active, expires_at")
      .eq("token_hash", token_hash)
      .single();

    if (linkErr || !link || !link.is_active) {
      return new Response(JSON.stringify({ error: "Invalid QR code" }), { status: 404 });
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "QR code expired" }), { status: 403 });
    }

    const nowIso = new Date().toISOString();

    // 1) Direct user stewardship
    const { data: direct, error: directErr } = await admin
      .from("asset_stewardships")
      .select("access_role, active, starts_at, ends_at")
      .eq("asset_id", link.asset_id)
      .eq("user_id", user.id)
      .eq("active", true)
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(1);

    if (directErr) {
      return new Response(JSON.stringify({ error: "Stewardship lookup failed" }), { status: 500 });
    }

    let access_role: "steward" | "viewer" | null = null;
    if (direct && direct.length > 0) {
      access_role = direct[0].access_role === "viewer" ? "viewer" : "steward";
    }

    // 2) Org stewardship (only if no direct stewardship)
    if (!access_role) {
      const { data: memberships, error: memErr } = await admin
        .from("org_members")
        .select("org_id")
        .eq("user_id", user.id);

      if (memErr) {
        return new Response(JSON.stringify({ error: "Org membership lookup failed" }), { status: 500 });
      }

      const orgIds = (memberships || []).map((m: any) => m.org_id);

      if (orgIds.length > 0) {
        const { data: orgStew, error: orgErr } = await admin
          .from("asset_stewardships")
          .select("access_role")
          .eq("asset_id", link.asset_id)
          .in("org_id", orgIds)
          .eq("active", true)
          .lte("starts_at", nowIso)
          .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
          .order("created_at", { ascending: false })
          .limit(1);

        if (orgErr) {
          return new Response(JSON.stringify({ error: "Org stewardship lookup failed" }), { status: 500 });
        }

        if (orgStew && orgStew.length > 0) {
          access_role = orgStew[0].access_role === "viewer" ? "viewer" : "steward";
        }
      }
    }

    const allowed_actions =
      access_role === "steward"
        ? ["log", "proof", "view"]
        : access_role === "viewer"
          ? ["view"]
          : ["request_access", "view"];

    return new Response(
      JSON.stringify({
        whoami: { user_id: user.id, email: user.email ?? null },
        public_link_id: link.id,
        asset_id: link.asset_id,
        system_id: link.system_id,
        stewardship: { access_role },
        allowed_actions,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error", details: String(e) }), { status: 500 });
  }
});
