import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getContentType(row: Record<string, unknown>, upstreamType: string | null) {
  const fromUpstream = String(upstreamType || "").split(";")[0].toLowerCase();
  if (fromUpstream.startsWith("image/")) return fromUpstream;

  const mimeType = String(row?.mime_type || "").split(";")[0].toLowerCase();
  if (mimeType.startsWith("image/")) return mimeType;

  return "application/octet-stream";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (req.method === "GET") {
      const url = new URL(req.url);
      const mediaId = String(url.searchParams.get("media_id") || "").trim();

      if (!MEDIA_ID_RE.test(mediaId)) {
        return jsonResponse({ error: "invalid_media_id" }, 400);
      }

      const { data: row, error } = await supabase
        .from("public_asset_story_gallery")
        .select("placement_id,url,bucket,storage_path,mime_type")
        .eq("placement_id", mediaId)
        .maybeSingle();

      if (error || !row) {
        return jsonResponse({ error: "media_not_found" }, 404);
      }

      let upstreamUrl = typeof row.url === "string" && row.url.trim() ? row.url.trim() : null;

      if (!upstreamUrl && row.bucket && row.storage_path) {
        const { data: signed, error: signError } = await supabase.storage
          .from(row.bucket)
          .createSignedUrl(String(row.storage_path).replace(/^\/+/, ""), 120);

        if (signError || !signed?.signedUrl) {
          return jsonResponse({ error: "media_not_found" }, 404);
        }

        upstreamUrl = signed.signedUrl;
      }

      if (!upstreamUrl) {
        return jsonResponse({ error: "media_not_found" }, 404);
      }

      const upstream = await fetch(upstreamUrl);
      if (!upstream.ok) {
        return jsonResponse({ error: "media_fetch_failed" }, 502);
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": getContentType(row, upstream.headers.get("content-type")),
          "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const { kac } = await req.json();

    if (!kac) {
      return jsonResponse({ error: "Missing KAC" }, 400);
    }

    const { data: rows, error } = await supabase
      .from("public_asset_story_gallery")
      .select("*")
      .eq("kac_id", String(kac).trim())
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const media = [];

    for (const row of rows || []) {
      const public_media_id = row.placement_id ? String(row.placement_id) : null;

      if (!public_media_id) continue;

      media.push({
        public_media_id,
        role: row.role,
        is_showcase: row.is_showcase,
        sort_order: row.sort_order,
        image_url: `/api/public-media/${encodeURIComponent(public_media_id)}`,
      });
    }

    return jsonResponse({ media });
  } catch (_e) {
    return jsonResponse({ error: "Server error" }, 500);
  }
});
