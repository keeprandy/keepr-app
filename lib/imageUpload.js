// lib/imageUpload.js
import { Platform } from "react-native";
// Use the legacy API so readAsStringAsync keeps working on Expo SDK 54+
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabaseClient";

/**
 * Universal uploader for images + documents (PDF).
 * - Works on native + web
 * - Avoids blob()
 * - Returns { storagePath, publicUrl, contentType, fileExt, fileName }
 */

function safeLower(x) {
  return String(x || "").toLowerCase();
}

function guessExt({ contentType, fileName }) {
  const ct = safeLower(contentType);

  // Prefer filename ext if present
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  if (dot > -1 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (ext.length <= 6) return ext;
  }

  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("heic")) return "heic";
  if (ct.includes("heif")) return "heif";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("jpg") || ct.includes("jpeg")) return "jpg";
  return "bin";
}

function base64ToUint8Array(base64) {
  // Web
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Native fallback
  // eslint-disable-next-line global-require
  const { Buffer } = require("buffer");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function uriToBytes(localUri) {
  if (!localUri) throw new Error("uriToBytes: localUri is required");

  // Web: just fetch the blob and turn into bytes
  if (Platform.OS === "web") {
    const res = await fetch(localUri);
    if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }

  // Native: use legacy FileSystem to read as base64
  const encodingOption =
    FileSystem?.EncodingType && FileSystem.EncodingType.Base64
      ? FileSystem.EncodingType.Base64
      : "base64";

  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: encodingOption,
  });

  return base64ToUint8Array(base64);
}

/**
 * Universal uploader
 */
export async function uploadLocalFileToSupabase({
  bucket,
  assetId,
  localUri,
  webFile = null, // File object on web, if available
  contentType = "application/octet-stream",
  fileName = null, // optional override
  folderPrefix = "files", // "images" | "docs" | etc.
}) {
  try {
    if (!bucket) {
      console.error("uploadLocalFileToSupabase: bucket is required");
      return null;
    }
    if (!localUri && !webFile) {
      console.error(
        "uploadLocalFileToSupabase: localUri or webFile is required"
      );
      return null;
    }

    const inferredName = fileName || webFile?.name || null;
    const inferredType =
      webFile?.type || contentType || "application/octet-stream";
    const fileExt = guessExt({
      contentType: inferredType,
      fileName: inferredName,
    });

    const finalName =
  inferredName && inferredName.includes(".")
    ? inferredName
    : `${folderPrefix}-${Date.now()}.${fileExt}`;

// Unified Keepr path: always user-scoped, like UploadLab.
// users/{uid}/attachments/{photos|files|docs}/timestamp-filename
const { data: authData, error: authErr } = await supabase.auth.getUser();
if (authErr || !authData?.user?.id) {
  console.error("uploadLocalFileToSupabase: no auth user", authErr);
  return null;
}
const uid = authData.user.id;

const kindFolder =
  folderPrefix === "images"
    ? "photos"
    : folderPrefix === "docs"
    ? "files"
    : folderPrefix || "files";

const storagePath = `users/${uid}/attachments/${kindFolder}/${Date.now()}-${finalName}`;

    let uploadBody;
    if (Platform.OS === "web") {
      uploadBody = webFile ? webFile : await uriToBytes(localUri);
    } else {
      uploadBody = await uriToBytes(localUri);
    }

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, uploadBody, {
        upsert: true,
        contentType: inferredType,
      });

    if (uploadErr) {
      console.error("uploadLocalFileToSupabase: upload error", uploadErr);
      return null;
    }

    const res = supabase.storage.from(bucket).getPublicUrl(storagePath);
    const publicUrl =
      res?.data?.publicUrl || res?.publicUrl || res?.data?.publicURL || null;

    if (!publicUrl) {
      console.error(
        "uploadLocalFileToSupabase: missing publicUrl for",
        storagePath
      );
      return null;
    }

    return {
      storagePath,
      publicUrl,
      contentType: inferredType,
      fileExt,
      fileName: finalName,
    };
  } catch (err) {
    console.error("uploadLocalFileToSupabase: unexpected error", err);
    return null;
  }
}

/**
 * Backwards-compatible wrapper (your existing signature)
 */
export async function uploadLocalImageToSupabase({
  bucket,
  assetId,
  localUri,
  webFile = null,
  contentType = "image/jpeg",
}) {
  return uploadLocalFileToSupabase({
    bucket,
    assetId,
    localUri,
    webFile,
    contentType,
    folderPrefix: "images",
  });
}

/**
 * PDF/document wrapper
 */
export async function uploadLocalDocumentToSupabase({
  bucket,
  assetId,
  localUri,
  webFile = null,
  contentType = "application/pdf",
  fileName = null,
}) {
  return uploadLocalFileToSupabase({
    bucket,
    assetId,
    localUri,
    webFile,
    contentType,
    fileName,
    folderPrefix: "docs",
  });
}
