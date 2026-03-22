import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabaseClient";
import { uploadAttachmentFromUri } from "./attachmentsUploader";

export async function launchQuickCapturePhoto({ assetId, placements = [] }) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Please allow camera access.");
  }

  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) throw new Error("Not signed in.");

  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
    allowsEditing: false,
    exif: false,
  });

  if (res.canceled) return null;

  const a = res.assets?.[0];
  if (!a?.uri) return null;

  const finalPlacements =
    placements.length > 0
      ? placements
      : assetId
      ? [{ target_type: "asset", target_id: assetId, role: "other" }]
      : [];

  const uploaded = await uploadAttachmentFromUri({
    userId,
    assetId,
    kind: "photo",
    fileUri: a.uri,
    fileName: a.fileName || a.uri.split("/").pop() || "camera-photo.jpg",
    mimeType: a.mimeType || "image/jpeg",
    sizeBytes: a.fileSize || null,
    placements: finalPlacements,
  });

  return uploaded || null;
}