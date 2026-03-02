import { serve } from "https://deno.land/std/http/server.ts";
import { getSupabaseClient } from "../_shared/context.ts";
import { hashToken } from "../_shared/crypto.ts";

function safeFileName(name: string) {
  // very basic sanitization
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    const filename = body?.filename;
    const mime = body?.mime ?? null;

    if (!token || !filename) {
      return new Response("Missing token or filename", { status: 400 });
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

    const cleaned = safeFileName(filename);
    const path = `public/${link.asset_id}/${crypto.randomUUID()}-${cleaned}`;

    const { data, error } = await supabase.storage
      .from("asset-files")
      .createSignedUploadUrl(path);

    if (error) throw error;

    await supabase.from("public_intake_events").insert({
      public_link_id: link.id,
      event_type: "create_upload_url",
      user_agent: req.headers.get("user-agent"),
    });

    return Response.json({
      uploadUrl: data.signedUrl,
      storage_path: path,
      bucket: "asset-files",
      mime_type: mime,
      file_name: cleaned,
    });
  } catch (e) {
    return new Response("Server error", { status: 500 });
  }
});
