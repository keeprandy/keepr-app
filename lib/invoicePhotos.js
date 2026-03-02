// lib/invoicePhotos.js
import * as ImagePicker from "expo-image-picker";
import { uploadLocalImageToSupabase } from "./imageUpload";
import { supabase } from "./supabaseClient";

/**
 * Pick a single image (invoice/work order)
 * Returns a normalized local URI
 */
export async function pickAndNormalizeImageFromLibrary() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });

  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}

/**
 * Upload or replace invoice photo for a service record
 * Uses the SAME core uploader as the rest of the app
 */
export async function uploadInvoicePhotoForServiceRecord({
  assetId,
  serviceRecordId,
  localUri,
  existingPhotoRow = null,
}) {
  if (!assetId || !serviceRecordId || !localUri) return null;

  // 1) Upload image
  const upload = await uploadLocalImageToSupabase({
    bucket: "asset-photos",
    assetId,
    localUri,
    contentType: "image/jpeg",
  });

  if (!upload?.publicUrl) return null;

  // 2) Remove old storage object + row if replacing
  if (existingPhotoRow?.storage_path) {
    try {
      await supabase.storage
        .from("asset-photos")
        .remove([existingPhotoRow.storage_path]);

      await supabase
        .from("service_record_photos")
        .delete()
        .eq("id", existingPhotoRow.id);
    } catch (err) {
      console.error("Error cleaning up existing invoice photo:", err);
    }
  }

  // 3) Insert new row
  const { data, error } = await supabase
    .from("service_record_photos")
    .insert({
      asset_id: assetId,
      service_record_id: serviceRecordId,
      url: upload.publicUrl,
      storage_path: upload.storagePath,
      kind: "invoice",
      source_type: "photo",
    })
    .select()
    .single();

  if (error) {
    console.error("Error inserting invoice photo row:", error);
    return null;
  }

  return data;
}
