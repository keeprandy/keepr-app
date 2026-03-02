// lib/uploadAssetImage.js
import { supabase } from "./supabaseClient";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";

export async function uploadAssetImage({ uri, userId, assetId }) {
  if (!uri) throw new Error("No image URI provided");
  if (!userId) throw new Error("No userId provided");

  const cleanUri = uri.split("?")[0];
  const extMatch = cleanUri.split(".").pop();
  const extension =
    extMatch && extMatch.length <= 5 ? extMatch.toLowerCase() : "jpg";

  const path = `${userId}/${assetId || "asset"}-${Date.now()}.${extension}`;

  console.log("UPLOAD PATH:", path, "USER:", userId); // 👈 add this

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64",
  });

  const fileData = decode(base64);

  const { error: uploadError } = await supabase.storage
    .from("asset-photos")
    .upload(path, fileData, {
      upsert: true,
      contentType: `image/${extension}`,
    });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from("asset-photos").getPublicUrl(path);
  return data.publicUrl;
}
