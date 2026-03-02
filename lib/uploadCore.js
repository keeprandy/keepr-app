// lib/uploadCore.js
// Canonical upload helpers shared across Keepr.
// This is extracted from UploadLab so every screen can rely
// on the exact same upload behavior.

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { supabase } from "../lib/supabaseClient";

export const PHOTO_BUCKET = "asset-photos";
export const FILE_BUCKET = "asset-files";

// Get the current user's id (or "anon" as a safe fallback)
export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.id || "anon";
}

// Web: fetch(uri)->blob
async function uriToUploadBodyWeb(uri) {
  const resp = await fetch(uri);
  const blob = await resp.blob();
  return blob;
}

// Native: base64 -> bytes (avoids content:// weirdness)
function base64ToUint8Array(base64) {
  // eslint-disable-next-line no-undef
  const hasBuffer = typeof Buffer !== "undefined";
  if (hasBuffer) {
    // eslint-disable-next-line no-undef
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function uriToUploadBodyNative(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(base64);
}

// Core storage upload – this is the *only* place that should
// talk directly to Supabase Storage.
export async function uploadToSupabaseStorage({
  bucket,
  path,
  uri,
  contentType,
  upsert = false,
}) {
  const body =
    Platform.OS === "web"
      ? await uriToUploadBodyWeb(uri)
      : await uriToUploadBodyNative(uri);

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(path, body, {
      contentType: contentType || "application/octet-stream",
      upsert,
    });

  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data?.publicUrl || null, path };
}

export function sanitizeName(name) {
  return String(name || "file")
    .replace(/[^\"\w.\-]+/g, "_")
    .slice(0, 120);
}

export function guessContentTypeFromName(
  name,
  fallback = "application/octet-stream"
) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".ppt"))
    return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return fallback;
}
