import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { kac } = await req.json();

    if (!kac) {
      return new Response(JSON.stringify({ error: "Missing KAC" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: rows, error } = await supabase
      .from("public_asset_story_gallery")
      .select("*")
      .eq("kac_id", String(kac).trim())
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const media = [];

    for (const row of rows || []) {
      let image_url = row.url || null;

      if (!image_url && row.bucket && row.storage_path) {
        const { data: signed, error: signError } = await supabase.storage
          .from(row.bucket)
          .createSignedUrl(row.storage_path.replace(/^\/+/, ""), 3600);

        if (!signError && signed?.signedUrl) {
          image_url = signed.signedUrl;
        }
      }

      if (!image_url) continue;

      media.push({
        placement_id: row.placement_id,
        attachment_id: row.attachment_id,
        role: row.role,
        is_showcase: row.is_showcase,
        sort_order: row.sort_order,
        image_url,
        file_name: row.file_name,
        mime_type: row.mime_type,
      });
    }

    return new Response(JSON.stringify({ media }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});