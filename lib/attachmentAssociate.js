// lib/attachmentAssociate.js
// Applies contextual association AFTER upload receipt is created.

import { supabase } from "./supabaseClient";

export async function ensureServiceRecordForTimeline({ timelineRecordId, assetId, title }) {
  if (!timelineRecordId) throw new Error("Missing timelineRecordId");
  if (!assetId) throw new Error("Missing assetId");

  const meta = { origin: "timeline_record", timeline_record_id: timelineRecordId };

  const { data: existing, error: findErr } = await supabase
    .from("service_records")
    .select("id")
    .eq("asset_id", assetId)
    .contains("extra_metadata", meta)
    .maybeSingle();

  if (findErr) throw findErr;
  if (existing?.id) return existing.id;

  const { data, error: createErr } = await supabase
    .from("service_records")
    .insert({
      asset_id: assetId,
      title: title || "Timeline Event",
      source_type: "manual",
      verification_status: "verified",
      extra_metadata: meta,
    })
    .select("id")
    .single();

  if (createErr) throw createErr;
  return data.id;
}

async function getUserId() {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) throw new Error("Not signed in.");
  return uid;
}

export async function associateReceiptToServiceRecord({
  receipt,
  assetId,
  serviceRecordId,
  caption = null,
  sourceTypeOverride = null,
}) {
  if (!receipt) throw new Error("Missing receipt");
  if (!assetId) throw new Error("Missing assetId");
  if (!serviceRecordId) throw new Error("Missing serviceRecordId");

  if (receipt.kind === "photo") {
    const { data, error } = await supabase
      .from("service_record_photos")
      .insert({
        service_record_id: serviceRecordId,
        asset_id: assetId,
        url: receipt.public_url,
        storage_path: receipt.storage_path,
        kind: "invoice",
        caption: caption || null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return { ...data, __type: "photo" };
  }

  if (receipt.kind === "file") {
    const userId = await getUserId();
    const sourceType =
      sourceTypeOverride ||
      (receipt.mime_type === "application/pdf" ? "upload_pdf" : "external");

    const { data, error } = await supabase
      .from("service_record_documents")
      .insert({
        user_id: userId,
        asset_id: assetId,
        service_record_id: serviceRecordId,
        file_url: receipt.public_url,
        source_type: sourceType,
        mime_type: receipt.mime_type || null,
        verification_status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    return { ...data, __type: "file", file_url: data.file_url };
  }

  throw new Error(`Unsupported receipt.kind: ${receipt.kind}`);
}

export async function associateLinkToServiceRecord({
  url,
  assetId,
  serviceRecordId,
}) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("service_record_documents")
    .insert({
      user_id: userId,
      asset_id: assetId,
      service_record_id: serviceRecordId,
      file_url: url,
      source_type: "external",
      mime_type: "text/url",
      verification_status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return { ...data, __type: "link", file_url: data.file_url };
}
