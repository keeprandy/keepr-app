import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.4.168/legacy/build/pdf.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * CORS (required for Expo Web / localhost)
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ✅ PDF.js: Edge/Deno sometimes still goes through "fake worker" init.
// Give it a real, importable module URL.
// (CDNJS hosts pdf.js worker modules by version.)
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.mjs";

type Body = {
  asset_id: string;
  attachment_id: string;
  file_url: string; // signed URL (absolute) OR storage signedURL path (/object/sign/...)
  object_type_key?: string; // default: 'attachment'
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveFileUrl(input: string, supabaseUrl: string) {
  const s = (input || "").trim();
  if (!s) return s;
  // Already absolute
  if (/^https?:\/\//i.test(s)) return s;

  // Common storage signed URL shapes:
  // - /object/sign/<bucket>/<path>?token=...
  // - /storage/v1/object/sign/<bucket>/<path>?token=...
  if (s.startsWith("/object/")) return `${supabaseUrl}/storage/v1${s}`;
  if (s.startsWith("/storage/v1/")) return `${supabaseUrl}${s}`;
  if (s.startsWith("/")) return `${supabaseUrl}${s}`;

  // Fallback: treat as relative to Supabase URL
  return `${supabaseUrl}/${s}`;
}

async function extractPdfTextFromUrl(fileUrl: string) {
  const resp = await fetch(fileUrl);
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(
      `Failed to download PDF: ${resp.status} ${resp.statusText} ${t.slice(0, 200)}`
    );
  }
  const buf = await resp.arrayBuffer();

  const loadingTask = (pdfjsLib as any).getDocument({
    data: buf,
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;

  let full = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => it.str).filter(Boolean);
    full += strings.join(" ") + "\n";
  }
  return full;
}

function buildCarfaxProposals(text: string) {
  const lower = (text || "").toLowerCase();

  const hasOdometer =
    /\b\d{1,3}(,\d{3})+\s*miles\b|\b\d{4,6}\s*miles\b/i.test(text);

  const hasOwnership =
    lower.includes("owner") ||
    lower.includes("ownership") ||
    lower.includes("registration");

  const hasService =
    lower.includes("service") ||
    lower.includes("maintenance") ||
    lower.includes("oil") ||
    lower.includes("inspection");

  // crude timeline count: dates in the text
  const dateMatches =
    text.match(
      /\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](\d{2}|\d{4})\b/g
    ) || [];

  const proposedTotal = Math.min(Math.max(dateMatches.length, 5), 60);

  const buckets = {
    ownership_history: hasOwnership
      ? Math.max(1, Math.floor(proposedTotal * 0.2))
      : 0,
    service_visits: hasService
      ? Math.max(1, Math.floor(proposedTotal * 0.6))
      : 0,
    odometer_anchors: hasOdometer
      ? Math.max(1, Math.floor(proposedTotal * 0.2))
      : 0,
  };

  return {
    detected: "CARFAX",
    proposed_timeline_items: proposedTotal,
    buckets,
  };
}

Deno.serve(async (req) => {
  // ✅ CORS preflight (must return before doing anything else)
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json()) as Body;

    if (!body?.asset_id || !body?.attachment_id || !body?.file_url) {
      return json(
        { error: "Missing asset_id, attachment_id, or file_url" },
        400
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) {
      return json(
        {
          error:
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function secrets",
        },
        500
      );
    }

    const sb = createClient(supabaseUrl, serviceRole);

    const absFileUrl = resolveFileUrl(body.file_url, supabaseUrl);
    if (!/^https?:\/\//i.test(absFileUrl)) {
      return json(
        { error: "file_url must be absolute or a storage signedURL path" },
        400
      );
    }

    const extracted = await extractPdfTextFromUrl(absFileUrl);
    const proposals = buildCarfaxProposals(extracted);

    const now = new Date().toISOString();
    const objectType = body.object_type_key || "attachment";

    const { data: runRow, error: runErr } = await sb
      .from("enrichment_runs")
      .insert({
        asset_id: body.asset_id,
        attachment_id: body.attachment_id,
        object_type_key: objectType,
        connector_key: "carfax",
        parser_version: "carfax_v1",
        model_info: {}, // ✅ NOT NULL in schema
        status: "completed",
        started_at: now,
        completed_at: now,
        proposals,
        extracted_text: extracted,
        ai_summary: null,
        error_message: null,
      })
      .select("id")
      .single();

    if (runErr) {
      console.error("enrichment_runs insert failed:", runErr);
      return json(
        { error: "Failed to write enrichment_runs", details: runErr.message },
        500
      );
    }

    return json({
      run_id: runRow.id,
      proposals,
    });
  } catch (e) {
    console.error("carfax_enrich_run error:", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
