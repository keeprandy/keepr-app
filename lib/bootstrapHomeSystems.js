// lib/bootstrapHomeSystems.js
import { supabase } from "../lib/supabaseClient";
import homeKsc from "../data/home_ksc.json";

/**
 * Ensure a new "home" asset has its systems bootstrapped from home_ksc.json.
 *
 * - No-ops if assetId is missing
 * - No-ops if home_systems already has rows for this asset
 */
export async function bootstrapHomeSystemsForAsset(assetId) {
  if (!assetId) return;

  // 1) Check if systems already exist for this home
  const { data: existing, error: existingErr } = await supabase
    .from("home_systems")
    .select("id")
    .eq("asset_id", assetId)
    .limit(1);

  if (existingErr) {
    console.error("bootstrapHomeSystems: check existing error", existingErr);
    return;
  }

  if (existing && existing.length > 0) {
    // Already bootstrapped (or user added manually) – do nothing.
    return;
  }

  // 2) Build insert payload from KSC
  const rows = (homeKsc || []).map((entry) => ({
    asset_id: assetId,
    name: entry.name,
    system_type: entry.system_type,
    location_hint: entry.location_hint || null,
    // status will default to 'healthy'
  }));

  if (!rows.length) return;

  const { error: insertErr } = await supabase
    .from("home_systems")
    .insert(rows);

  if (insertErr) {
    console.error("bootstrapHomeSystems: insert error", insertErr);
  } else {
    console.log(
      `bootstrapHomeSystems: created ${rows.length} systems for home ${assetId}`
    );
  }
}
