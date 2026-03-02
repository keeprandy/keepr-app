// lib/upipUpload.js
// UPIP (Universal Photo Intake Pipeline) - single upload path for Keepr.
// Uses the same mechanics as UploadLabScreen: direct supabase.storage upload
// to a policy-compatible prefix: users/{uid}/attachments/{photos|files}/...

import { Platform } from "react-native";
// Use the legacy API so readAsStringAsync keeps working on Expo SDK 54+
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabaseClient";

const PHOTO_BUCKET = "asset-files";
const FILE_BUCKET = "asset-files";

function safeName(name) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function base64ToUint8Array(base64) {
  // atob is available in RN + web through JS runtime
  const binary = global.atob ? global.atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToUploadBodyNative(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(base64);
}

async function uriToUploadBodyWeb(uri) {
  // Works for blob: and http(s) urls
  const resp = await fetch(uri);
  return await resp.blob();
}

async function uploadToSupabaseStorage({ bucket, path, uri, contentType, upsert = false, webFile = null }) {
  const body =
    Platform.OS === "web"
      ? (webFile || (await uriToUploadBodyWeb(uri)))
      : await uriToUploadBodyNative(uri);

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert,
  });

  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { bucket, storage_path: path, public_url: data?.publicUrl };
}

async function getUserId() {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) throw new Error("Not signed in.");
  return uid;
}

/**
 * Upload a photo/file using a single policy-compatible storage convention.
 * Returns a standardized receipt:
 * { kind, bucket, storage_path, public_url, mime_type, file_name }
 */
export async function upipUpload({
  kind, // "photo" | "file"
  localUri,
  webFile = null,
  mimeType,
  fileName,
}) {
  if (!kind) throw new Error("Missing kind");
  if (!localUri && !webFile) throw new Error("Missing file");

  const uid = await getUserId();
  const ts = Date.now();

  const isPhoto = kind === "photo" || (mimeType || "").startsWith("image/");
  const bucket = isPhoto ? PHOTO_BUCKET : FILE_BUCKET;

  const ext = safeName(fileName || "").includes(".")
    ? safeName(fileName).split(".").pop()
    : (isPhoto ? "jpg" : "bin");

  const safe = safeName(fileName || `${isPhoto ? "photo" : "file"}_${ts}.${ext}`);
  const folder = isPhoto ? "photos" : "files";

  const path = `users/${uid}/attachments/${folder}/${ts}_${safe}`;
  const contentType = mimeType || (isPhoto ? "image/jpeg" : "application/octet-stream");

  const result = await uploadToSupabaseStorage({
    bucket,
    path,
    uri: localUri,
    contentType,
    upsert: false,
    webFile,
  });

  return {
    kind: isPhoto ? "photo" : "file",
    bucket: result.bucket,
    storage_path: result.storage_path,
    public_url: result.public_url,
    mime_type: contentType,
    file_name: safe,
  };
}
