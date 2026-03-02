// lib/attachmentsEngine.js
// Keepr attachments + association layer (Production Mode)
// Key rule: TimelineRecords are narrative. Proof attaches to a ServiceRecord.
// IMPORTANT: service_records.source_document_id has an FK to service_record_documents.id in your schema,
// so we DO NOT use source_document_id to link timeline_records. We use extra_metadata instead.

import { Platform } from "react-native";
import { supabase } from "./supabaseClient";
import { uploadLocalImageToSupabase } from "./imageUpload";

const PHOTO_BUCKET = "asset-photos";
const FILE_BUCKET = "asset-files";

function safeName(name) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

// Upload a non-image file (docs) on web + native.
async function uploadLocalFileToSupabaseInternal({
  bucket,
  storagePath,
  localUri,
  webFile = null,
  contentType = "application/octet-stream",
}) {
  if (!bucket) throw new Error("Missing bucket");
  if (!storagePath) throw new Error("Missing storagePath");
  if (!localUri && !webFile) throw new Error("Missing file");

  let blob;

  if (Platform.OS === "web" && webFile) {
    blob = webFile; // File is a Blob
  } else {
    const resp = await fetch(localUri);
    blob = await resp.blob();
  }

  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, blob, {
    contentType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return { storagePath, publicUrl: data?.publicUrl };
}

/**
 * Ensure a backing service_record exists for a timeline record.
 * We link via service_records.extra_metadata (NOT source_document_id).
 */
export async function ensureServiceRecordForTimeline({
  timelineRecordId,
  assetId,
  title = "Timeline Event",
}) {
  if (!timelineRecordId) throw new Error("Missing timelineRecordId");
  if (!assetId) throw new Error("Missing assetId");

  const meta = { origin: "timeline_record", timeline_record_id: timelineRecordId };

  // Look for existing backing service record by JSON match.
  const { data: existing, error: findErr } = await supabase
    .from("service_records")
    .select("id")
    .eq("asset_id", assetId)
    .contains("extra_metadata", meta)
    .maybeSingle();

  if (findErr) throw findErr;
  if (existing?.id) return existing.id;

  // Create a new backing service record.
  // DO NOT set source_document_id (FK to service_record_documents).
  const { data, error: createErr } = await supabase
    .from("service_records")
    .insert({
      asset_id: assetId,
      title,
      source_type: "manual",
      verification_status: "verified",
      extra_metadata: meta,
    })
    .select("id")
    .single();

  if (createErr) throw createErr;
  return data.id;
}

/**
 * Upload + associate to a service record (proof).
 * - Photos -> service_record_photos (caption field)
 * - Files  -> service_record_documents (file_url, source_type, user_id required)
 */
export async function addServiceRecordAttachment({
  assetId,
  serviceRecordId,
  localUri,
  webFile = null,
  mimeType,
  fileName,
  kind, // "photo" | "file"
  origin = null,
  caption = null,
}) {
  if (!assetId) throw new Error("Missing assetId");
  if (!serviceRecordId) throw new Error("Missing serviceRecordId");
  if (!localUri && !webFile) throw new Error("Missing file");

  const isPhoto = kind === "photo" || (mimeType || "").startsWith("image/");
  const ts = Date.now();
  const safe = safeName(fileName || (isPhoto ? `photo_${ts}.jpg` : `file_${ts}`));

  if (isPhoto) {
    const uploaded = await uploadLocalImageToSupabase({
      bucket: PHOTO_BUCKET,
      assetId,
      localUri,
      webFile,
      folderPrefix: `service_records/${serviceRecordId}/photos`,
      fileName: safe,
    });

    const storagePath = uploaded?.storagePath || uploaded?.storage_path || uploaded?.path;
    const publicUrl = uploaded?.publicUrl || uploaded?.public_url || uploaded?.url;

    if (!storagePath || !publicUrl) {
      throw new Error("Photo upload failed: missing publicUrl/storagePath");
    }

    const { data, error } = await supabase
      .from("service_record_photos")
      .insert({
        service_record_id: serviceRecordId,
        asset_id: assetId,
        url: publicUrl,
        storage_path: storagePath,
        kind: "invoice",
        caption: caption || null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return { ...data, __type: "photo" };
  }

  // File/document
  const storagePath = `${assetId}/service_records/${serviceRecordId}/files/${ts}_${safe}`;

  const uploaded = await uploadLocalFileToSupabaseInternal({
    bucket: FILE_BUCKET,
    storagePath,
    localUri,
    webFile,
    contentType: mimeType || "application/octet-stream",
  });

  const publicUrl = uploaded?.publicUrl || uploaded?.public_url || uploaded?.url;
  if (!publicUrl) throw new Error("File upload failed: missing publicUrl");

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Not signed in.");

  const sourceType = mimeType === "application/pdf" ? "upload_pdf" : "external";

  const { data, error } = await supabase
    .from("service_record_documents")
    .insert({
      user_id: userId,
      asset_id: assetId,
      service_record_id: serviceRecordId,
      file_url: publicUrl,
      source_type: sourceType,
      mime_type: mimeType || null,
      verification_status: "pending",
    })
    .select("*")
    .single();

  if (error) throw error;
  return { ...data, __type: "file" };
}

export async function deleteServiceRecordPhoto(photoRow) {
  if (!photoRow?.id) throw new Error("Missing photo id");
  const storagePath = photoRow.storage_path;

  const { error } = await supabase.from("service_record_photos").delete().eq("id", photoRow.id);
  if (error) throw error;

  if (storagePath) {
    const { error: stErr } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
    if (stErr) console.warn("Storage delete failed:", stErr);
  }
  return true;
}

export async function deleteServiceRecordDocument(docRow) {
  if (!docRow?.id) throw new Error("Missing document id");
  const { error } = await supabase.from("service_record_documents").delete().eq("id", docRow.id);
  if (error) throw error;
  return true;
}
