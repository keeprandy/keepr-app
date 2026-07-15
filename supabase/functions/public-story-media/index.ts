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

    return new Response(JSON.stringify({ media }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
