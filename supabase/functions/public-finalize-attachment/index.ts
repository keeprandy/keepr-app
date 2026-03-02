import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    const storage_path = body?.storage_path;
    const kind = body?.kind; // 'photo' | 'file' | 'link' (we’ll use photo/file here)
    const file_name = body?.file_name ?? null;
    const mime_type = body?.mime_type ?? null;
    const record_id = body?.record_id ?? null;

    if (!token || !storage_path || !kind) {
      return new Response("Missing required fields", { status: 400 });
    }

    if (!["photo", "file", "link"].includes(kind)) {
      return new Response("Invalid kind", { status: 400 });
    }

    const supabase = getSupabaseClient();
    const token_hash = await hashToken(token);

    const { data: link } = await supabase
      .from("public_links")
      .select("id, asset_id, is_active, expires_at")
      .eq("token_hash", token_hash)
      .single();

    if (!link || !link.is_active) return new Response("Invalid QR code", { status: 404 });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response("QR code expired", { status: 403 });
    }

    const { data: attachment, error } = await supabase
      .from("attachments")
      .insert({
        asset_id: link.asset_id,
        kind,
        bucket: "asset-files",
        storage_path,
        file_name,
        mime_type,
        source_context: {
          source: "public_qr",
          public_link_id: link.id,
          linked_record_id: record_id,
        },
      })
      .select("id")
      .single();

    if (error) throw error;

    await supabase.from("public_intake_events").insert({
      public_link_id: link.id,
      event_type: "finalize_attachment",
      user_agent: req.headers.get("user-agent"),
    });

    return Response.json({ attachment_id: attachment.id });
  } catch (e) {
    return new Response("Server error", { status: 500 });
  }
});
