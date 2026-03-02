// lib/enrichClient.js
import { supabase } from "../lib/supabaseClient";

// You can back this with:
// - Supabase Edge Function, or
// - your own API route.
// This keeps the UI decoupled.
const ENRICH_ENDPOINT =
  process.env.EXPO_PUBLIC_ENRICH_URL || "/api/enrich/run"; // adjust if needed

export async function runEnrich({ assetId, attachmentId }) {
  const res = await fetch(ENRICH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_id: assetId, attachment_id: attachmentId }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Enrich run failed: ${txt || res.status}`);
  }
  return await res.json(); // { run_id, proposals: { timeline_count, band_count, anchor_count }, ... }
}

export async function applyEnrichRun({ runId }) {
  const { data, error } = await supabase.rpc("apply_enrichment_run", {
    p_run_id: runId,
    p_decided_by: null, // or auth uid if you pass it
  });

  if (error) throw error;
  return data;
}
