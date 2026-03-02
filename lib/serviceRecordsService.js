// lib/serviceRecordsService.js
import { supabase } from "./supabaseClient";

function getTodayISODateLocal() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// "YYYY-MM-DD" -> "YYYY-MM-DDT12:00:00" (avoid timezone midnight rollbacks)
function isoDateToSafeTimestamp(isoDate) {
  if (!isoDate) return null;
  return `${isoDate}T12:00:00`;
}

/**
 * Create a service record + matching story_events row.
 * Returns the created service record.
 */
export async function createServiceRecordWithStoryEvent({
  assetId,
  serviceType,
  title,
  location,
  performedAt,
  cost,
  notes,

  systemId,
  systemName,
  keeprProId,
  keeprProName,
  assetName,
}) {
  if (!assetId) {
    throw new Error("createServiceRecordWithStoryEvent: assetId is required");
  }

  const performedAtISO = performedAt || getTodayISODateLocal();

  // 1) Insert into service_records
  const { data: record, error: recordError } = await supabase
    .from("service_records")
    .insert([
      {
        asset_id: assetId,
        service_type: serviceType || null,
        title: title || null,
        location: location || null,
        performed_at: performedAtISO, // store as YYYY-MM-DD
        cost: cost ?? null,
        notes: notes || null,
        system_id: systemId || null,
        keepr_pro_id: keeprProId || null,
      },
    ])
    .select("*")
    .single();

  if (recordError) {
    console.error("Error inserting service record", recordError);
    throw recordError;
  }

  // 2) Insert a matching story_event (non-blocking)
  const storyTitle =
    title ||
    (serviceType === "pro"
      ? "KeeprPro service logged"
      : serviceType === "diy"
      ? "DIY work logged"
      : "Service record added");

  const descriptionParts = [];
  if (assetName) descriptionParts.push(assetName);
  if (systemName) descriptionParts.push(`System: ${systemName}`);

  if (keeprProName) descriptionParts.push(`Serviced by ${keeprProName}`);
  else if (location) descriptionParts.push(location);

  if (performedAtISO) descriptionParts.push(`On ${performedAtISO}`);

  if (cost !== null && cost !== undefined) {
    descriptionParts.push(`Cost: $${Number(cost).toLocaleString()}`);
  }

  if (notes) descriptionParts.push(notes);

  const description =
    descriptionParts.join(" • ") || "Service work recorded for this asset.";

  const metadata = {
    service_record_id: record.id,
    asset_id: assetId,
    asset_name: assetName || null,
    service_type: serviceType || null,
    system_id: systemId || null,
    system_name: systemName || null,
    keepr_pro_id: keeprProId || null,
    keepr_pro_name: keeprProName || null,
    cost: cost ?? null,
    performed_at: performedAtISO || record.performed_at || null,
  };

  const { error: storyError } = await supabase.from("story_events").insert([
    {
      asset_id: assetId,
      event_type: "service_event",
      title: storyTitle,
      description,
      metadata,
      // If occurred_at is a timestamp column, this keeps ordering aligned to the date.
      occurred_at: isoDateToSafeTimestamp(performedAtISO),
    },
  ]);

  if (storyError) {
    console.error("Error inserting story event for service record", storyError);
  }

  return record;
}
