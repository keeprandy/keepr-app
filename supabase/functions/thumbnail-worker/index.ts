import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SIZES = [
  { key: "160", width: 160, height: 160 },
  { key: "320", width: 320, height: 320 },
  { key: "640", width: 640, height: 640 },
];

serve(async () => {
  const { data: jobs, error: jobErr } = await supabase
    .from("thumbnail_jobs")
    .select(`
      id,
      attachment_id,
      attempts,
      attachment:attachments (
        id,
        bucket,
        storage_path,
        mime_type,
        asset_id
      )
    `)
    .eq("status", "pending")
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(5);

  if (jobErr) {
    return Response.json({ ok: false, error: jobErr.message }, { status: 500 });
  }

  const results = [];

  for (const job of jobs || []) {
    const attachment = Array.isArray(job.attachment)
      ? job.attachment[0]
      : job.attachment;

    try {
      if (!attachment?.bucket || !attachment?.storage_path) {
        throw new Error("Missing bucket or storage_path");
      }

      if (!String(attachment.mime_type || "").startsWith("image/")) {
        throw new Error("Not an image attachment");
      }

      await supabase
        .from("thumbnail_jobs")
        .update({
          status: "processing",
          attempts: Number(job.attempts || 0) + 1,
        })
        .eq("id", job.id);

      const patch: Record<string, string | null> = {};
      const now = new Date().toISOString();

      for (const size of SIZES) {
        const { data: signed, error: signErr } = await supabase.storage
          .from(attachment.bucket)
          .createSignedUrl(attachment.storage_path, 60 * 5, {
            transform: {
              width: size.width,
              height: size.height,
              resize: "cover",
              quality: 75,
            },
          });

        if (signErr || !signed?.signedUrl) {
          throw signErr || new Error(`Could not sign ${size.key}`);
        }

        const imageRes = await fetch(signed.signedUrl);
        if (!imageRes.ok) {
          throw new Error(`Fetch transformed image failed ${size.key}: ${imageRes.status}`);
        }

        const bytes = new Uint8Array(await imageRes.arrayBuffer());

        const ext = "jpg";
        const thumbPath =
          `users/${attachment.storage_path.split("/")[1]}/thumbs/${attachment.id}/thumb_${size.key}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(attachment.bucket)
          .upload(thumbPath, bytes, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (uploadErr) throw uploadErr;

        const { data: thumbSigned, error: thumbSignErr } = await supabase.storage
          .from(attachment.bucket)
          .createSignedUrl(thumbPath, 60 * 60 * 24 * 7);

        if (thumbSignErr) throw thumbSignErr;

        patch[`thumb_${size.key}_path`] = thumbPath;
        patch[`thumb_${size.key}_url`] = thumbSigned?.signedUrl || null;
      }

      await supabase
        .from("attachments")
        .update({
          ...patch,
          derivatives_status: "ready",
          derivatives_updated_at: now,
        })
        .eq("id", attachment.id);

      await supabase
        .from("thumbnail_jobs")
        .update({
          status: "complete",
          processed_at: now,
          error: null,
        })
        .eq("id", job.id);

      results.push({ job_id: job.id, attachment_id: attachment.id, ok: true });
    } catch (e) {
      const message = e?.message || String(e);

      await supabase
        .from("thumbnail_jobs")
        .update({
          status: "pending",
          error: message,
        })
        .eq("id", job.id);

      results.push({ job_id: job.id, ok: false, error: message });
    }
  }

  return Response.json({
    ok: true,
    processed: results.length,
    results,
  });
});