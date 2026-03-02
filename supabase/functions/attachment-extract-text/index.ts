import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function inferDocType(mime?: string | null, fileName?: string | null) {
  const m = (mime || "").toLowerCase();
  const f = (fileName || "").toLowerCase();

  if (m.includes("pdf") || f.endsWith(".pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.includes("html")) return "html";
  if (m.includes("text/")) return "text";
  return "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Missing Authorization bearer token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const attachment_id = body?.attachment_id;
    const source_text = body?.source_text; // optional
    const source_kind = body?.source_kind || "user_paste"; // optional labeling

    if (!attachment_id || typeof attachment_id !== "string") {
      return json({ error: "attachment_id is required" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    // user client to validate user identity
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Invalid user JWT" }, 401);
    }
    const userId = userData.user.id;

    // service client to read/update regardless of RLS (but we still enforce ownership)
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: att, error: attErr } = await svc
      .from("attachments")
      .select("id, owner_user_id, file_name, mime_type, deleted_at")
      .eq("id", attachment_id)
      .maybeSingle();

    if (attErr) return json({ error: "Failed to load attachment", details: attErr.message }, 500);
    if (!att || att.deleted_at) return json({ error: "Attachment not found" }, 404);
    if (att.owner_user_id && att.owner_user_id !== userId) {
      return json({ error: "Forbidden" }, 403);
    }

    const doc_type = inferDocType(att.mime_type, att.file_name);

    // If we have source_text, store it as searchable text
    let extracted_text: string | null = null;
    let text_source = "none";
    let ocr_status = "pending";
    let extracted_error: string | null = null;

    if (typeof source_text === "string" && source_text.trim().length > 0) {
      extracted_text = source_text.trim();
      text_source = source_kind; // user_paste | ocr | scanner_ocr | etc
      ocr_status = "done";
    } else {
      // No text provided (PDF/image/etc). Mark pending for future OCR step.
      extracted_text = null;
      text_source = "none";
      ocr_status = doc_type === "text" ? "not_needed" : "pending";
    }

    const { error: upErr } = await svc
      .from("attachments")
      .update({
        extracted_text,
        text_source,
        ocr_status,
        doc_type,
        extracted_at: new Date().toISOString(),
        extracted_error,
      })
      .eq("id", attachment_id);

    if (upErr) return json({ error: "Update failed", details: upErr.message }, 500);

    return json({
      ok: true,
      attachment_id,
      doc_type,
      text_source,
      ocr_status,
      chars: extracted_text ? extracted_text.length : 0,
    });
  } catch (e) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});