import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    const title = body?.title?.trim();
    const notes = body?.notes ?? null;
    const performed_at = body?.performed_at ?? null;

    if (!token || !title) {
      return new Response("Missing token or title", { status: 400 });
    }

    const supabase = getSupabaseClient();
    const token_hash = await hashToken(token);

    const { data: link, error: linkErr } = await supabase
      .from("public_links")
      .select("id, asset_id, system_id, is_active, expires_at")
      .eq("token_hash", token_hash)
      .single();

    if (linkErr || !link || !link.is_active) {
      return new Response("Invalid QR code", { status: 404 });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response("QR code expired", { status: 403 });
    }

    await checkRateLimit(supabase, link.id, 25);

    const dateStr =
      typeof performed_at === "string" && performed_at.length >= 10
        ? performed_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const { data: record, error } = await supabase
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
          source: "public_qr",
          public_link_id: link.id,
        },
      })
      .select("id")
      .single();

    if (error) throw error;

    await supabase.from("public_intake_events").insert({
      public_link_id: link.id,
      event_type: "create_service_record",
      user_agent: req.headers.get("user-agent"),
    });

    return Response.json({ record_id: record.id });
  } catch (e) {
    return new Response("Server error", { status: 500 });
  }
});
