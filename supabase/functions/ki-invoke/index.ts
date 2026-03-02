import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1️⃣ Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { asset_id, attachment_id, source_text } = await req.json();

    if (!source_text || source_text.length < 120) {
      return new Response(
        JSON.stringify({ error: "Insufficient source text" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // 2️⃣ V1: deterministic KI extraction (no OpenAI yet if you want)
    const result = {
      type: "keepr_intelligence",
      scope: "assurance",
      asset_id,
      attachment_id,
      extracted: {
        maintenance_rules: [
          "Oil changes every 6 months or 6,000 miles (whichever occurs first)",
        ],
        proof_requirements: [
          "Licensed commercial service facility",
          "Receipt must include VIN",
          "Receipt must include service date",
          "Receipt must include mileage",
          "Handwritten receipts not accepted",
        ],
        benefits: [
          "Oil changes: 2 per year, up to $120",
          "Alignment: 1 per year, up to $30",
          "Battery replacement: 1 per term, up to $135",
        ],
      },
      recommendations: [
        "Create recurring oil change reminder",
        "Verify prior service records for compliance",
        "Add engine-related systems if missing",
      ],
      confidence: "based on provided contract excerpt",
    };

    // 3️⃣ Return with CORS headers
    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
