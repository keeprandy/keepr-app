// supabase/functions/proof-generate-proposal/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pickFirstDate(text: string): string | null {
  // Matches: 22 OCT 24, Oct 22 2024, 2024-10-22, etc (simple heuristics)
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const m1 = text.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{2,4})\b/i);
  if (m1) {
    const dd = String(m1[1]).padStart(2, "0");
    const mon = m1[2].toUpperCase();
    const yyRaw = m1[3];
    const yyyy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
    const months: Record<string,string> = {
      JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
      JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"
    };
    return `${yyyy}-${months[mon]}-${dd}`;
  }

  const m2 = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(20\d{2})\b/i);
  if (m2) {
    const mon = m2[1].slice(0, 3).toUpperCase();
    const dd = String(m2[2]).padStart(2, "0");
    const yyyy = m2[3];
    const months: Record<string,string> = {
      JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
      JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"
    };
    return `${yyyy}-${months[mon]}-${dd}`;
  }

  return null;
}

function pickTotal(text: string): number | null {
  // Look for something like: Total cost $1,716.91 or WORK ORDER TOTAL: 1716.91
  const m = text.match(/(?:total(?:\s+cost)?|work\s*order\s*total)\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i);
  if (m?.[1]) return Number(m[1].replace(/,/g, ""));
  // fallback: first $X,XXX.XX
  const m2 = text.match(/\$?\s*([\d,]+\.\d{2})/);
  if (m2?.[1]) return Number(m2[1].replace(/,/g, ""));
  return null;
}

function pickWorkOrder(text: string): string | null {
  const m = text.match(/\bWO\b\s*[:#]?\s*([A-Z0-9-]+)/i);
  return m?.[0]?.replace(/\s+/g, " ").trim() ?? null;
}

function pickProvider(text: string): string | null {
  // super simple: look for WILSON MARINE
  if (/WILSON\s+MARINE/i.test(text)) return "Wilson Marine";
  return null;
}

function buildTitle(provider: string | null, text: string): string {
  if (/winteriz/i.test(text)) return provider ? `Winterization – ${provider}` : "Winterization";
  if (/oil\s*&?\s*filter/i.test(text)) return provider ? `Oil & Filter Change – ${provider}` : "Oil & Filter Change";
  return provider ? `Service – ${provider}` : "Service";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonOrService = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonOrService, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user ?? null;

    const body = await req.json().catch(() => ({}));
    const asset_id = body.asset_id as string | null;
    const attachment_id = body.attachment_id as string | null;
    const source_text = (body.source_text as string | null) || "";

    if (!asset_id) {
      return new Response(JSON.stringify({ error: "Missing asset_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!source_text.trim()) {
      return new Response(JSON.stringify({ error: "Missing source_text" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // (V1) Stewardship check — keep simple: you can tighten RLS later.
    // If you already have a helper RPC, swap this block to use it.
    let hasAccess = false;
    if (user?.id) {
      const { data: s } = await supabase
        .from("asset_stewardships")
        .select("id, access_role, active")
        .eq("asset_id", asset_id)
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();
      hasAccess = !!s?.id;
    }

    const performed_at = pickFirstDate(source_text) || new Date().toISOString().slice(0, 10);
    const provider = pickProvider(source_text);
    const wo = pickWorkOrder(source_text);
    const total = pickTotal(source_text);

    const title = buildTitle(provider, source_text);
    const summaryParts: string[] = [];
    if (provider) summaryParts.push(`Provider: ${provider}`);
    if (wo) summaryParts.push(`${wo}`);
    if (/winteriz/i.test(source_text)) summaryParts.push("Winterization package");
    if (/oil\s*&?\s*filter/i.test(source_text)) summaryParts.push("Oil & filter change");
    if (typeof total === "number") summaryParts.push(`Total: $${total.toFixed(2)}`);

    const response = {
      primary_record: {
        title,
        summary: summaryParts.join(" • ") || "Service record created from proof text.",
        performed_at,
        category: /winteriz|oil|service|repair|maint/i.test(source_text) ? "maintenance" : "other",
        service_type: provider ? "marina_service" : null,
        cost: typeof total === "number" ? total : null,
        odometer: null,
        location: null,
        system_hints: [/oil|engine/i.test(source_text) ? "Engine" : null, /fuel/i.test(source_text) ? "Fuel" : null].filter(Boolean),
        confidence: 0.72,
      },
      extracted_facts: {
        service_provider: provider,
        work_order_number: wo,
        hin: null,
        engine_model: null,
        engine_serial: null,
        trailer_vin: null,
        warranty_until: null,
        raw_totals: { total: typeof total === "number" ? total : null, tax: null },
        notes: [],
      },
      suggested_updates: {
        asset: {},
        systems: [],
      },
      policy: {
        one_primary_record: true,
        has_access: hasAccess,
        attachment_id: attachment_id || null,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
