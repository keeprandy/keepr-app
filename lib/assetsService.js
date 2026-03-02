/**
 * Asset + Systems service layer for Keepr v1
 *
 * - createAssetWithDefaults: creates an asset with a generated KAC
 *   and inserts default marine systems + an initial story event.
 */

import { supabase } from "./supabaseClient";
import { generateKac } from "./kac";
import marineKsc from "../data/marine_ksc.json";

function getDefaultSystemsForAssetType(assetTypeRaw) {
  const assetType = (assetTypeRaw || "").toLowerCase();
  console.log("getDefaultSystemsForAssetType: assetType =", assetType);

  if (assetType === "boat") {
    return Object.entries(marineKsc.systems).map(([code, def]) => ({
      ksc_code: code,
      name: def.label,
      lod: def.default_lod ?? 2,
    }));
  }

  return [];
}

/**
 * Creates an asset and its default systems, plus an initial story event.
 */
export async function createAssetWithDefaults({
  ownerId,
  name,
  type,
  make,
  model,
  year,
  serialNumber,
  engineHours,
  primaryPhotoUrl, // unused for now
  environmentKey,  // unused for now
}) {
  if (!ownerId) {
    throw new Error("createAssetWithDefaults: ownerId is required");
  }
  if (!type) {
    throw new Error("createAssetWithDefaults: type is required");
  }

  const kac = generateKac(type);
  console.log("createAssetWithDefaults: starting", {
    ownerId,
    name,
    type,
    make,
    model,
    year,
    serialNumber,
    engineHours,
    kac,
  });

  // 1) Insert asset (into your existing assets table)
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .insert([
      {
        // these two columns must exist; if they don't, see note below
        kac_id: kac,
        owner_id: ownerId,
        name,
        type,
        make,
        model,
        year,
        // optional extra column we added; safe to keep if present
        serial_number: serialNumber,
        engine_hours: engineHours,
        // primary_photo_url intentionally removed to match current schema
      },
    ])
    .select("*")
    .single();

  console.log("createAssetWithDefaults: asset insert result", {
    asset,
    assetError,
  });

  if (assetError) {
    console.error("Error inserting asset", assetError);
    throw assetError;
  }

  // 2) Default systems
  const systemsPayload = getDefaultSystemsForAssetType(type).map((sys) => ({
    asset_id: asset.id,
    ksc_code: sys.ksc_code,
    name: sys.name,
    lod: sys.lod,
  }));

  console.log("createAssetWithDefaults: systemsPayload", systemsPayload);

  if (systemsPayload.length > 0) {
    const { data: systemsData, error: systemsError } = await supabase
      .from("systems")
      .insert(systemsPayload)
      .select("*");

    console.log("createAssetWithDefaults: systems insert result", {
      systemsData,
      systemsError,
    });

    if (systemsError) {
      console.error("Error inserting systems", systemsError);
    }
  } else {
    console.log(
      "createAssetWithDefaults: systemsPayload empty, skipping systems insert"
    );
  }

  // 3) Story event
  const storyTitle =
    name || `${make ?? ""} ${model ?? ""}`.trim() || "New Asset";

  const { data: storyData, error: storyError } = await supabase
    .from("story_events")
    .insert([
      {
        asset_id: asset.id,
        event_type: "asset_created",
        title: "Asset added to Keepr",
        description: `Asset "${storyTitle}" (${type}) was created with KAC ${kac}.`,
      },
    ])
    .select("*")
    .single();

  console.log("createAssetWithDefaults: story insert result", {
    storyData,
    storyError,
  });

  if (storyError) {
    console.error("Error inserting story event", storyError);
  }

  return asset;
}

/**
 * Simple helper to fetch all assets for the current user.
 */
export async function fetchAssetsForOwner(ownerId) {
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching assets", error);
    throw error;
  }

  return data ?? [];
}
