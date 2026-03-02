// lib/upip/index.js
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { supabase } from "../supabaseClient";

const PHOTO_BUCKET = "asset-photos";
const FILE_BUCKET = "asset-files";

const IMAGE_MEDIA_TYPES =
  ImagePicker?.MediaType?.Images ??
  ImagePicker?.MediaTypeOptions?.Images ??
  "Images";

function sanitizeName(name) {
  return String(name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function guessContentTypeFromName(name, fallback = "application/octet-stream") {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return fallback;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

function pickExifSummary(exif) {
  if (!exif || typeof exif !== "object") return null;
  const get = (k) => exif?.[k];
  return {
    make: get("Make") || get("make") || null,
    model: get("Model") || get("model") || null,
    capturedAtExif:
      get("DateTimeOriginal") || get("DateTimeDigitized") || get("DateTime") || null,
    gpsMaybe:
      get("GPSLatitude") || get("GPSLongitude")
        ? { lat: get("GPSLatitude") ?? null, lng: get("GPSLongitude") ?? null }
        : null,
  };
}

async function getUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.id;
}

async function uriToBodyWeb(uri) {
  const resp = await fetch(uri);
  return await resp.blob();
}

function base64ToUint8Array(base64) {
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== "undefined") {
    // eslint-disable-next-line no-undef
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  // eslint-disable-next-line no-undef
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToBodyNative(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(base64);
}

async function uploadToStorage({ bucket, path, uri, contentType }) {
  const body = Platform.OS === "web" ? await uriToBodyWeb(uri) : await uriToBodyNative(uri);

  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType: contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: pub?.publicUrl || null };
}

async function signedUrl(bucket, path, ttlSec = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSec);
  if (error) return null;
  return data?.signedUrl || null;
}

function buildStoragePath({ uid, kind, attachmentId, fileName }) {
  const base = `users/${uid}/attachments/${kind === "photo" ? "photos" : "files"}`;
  return `${base}/${attachmentId}_${sanitizeName(fileName)}`;
}

function newId() {
  // decent client-side id for storage path uniqueness; DB can replace later
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const UPIP = {
  async pickPhoto() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error("Photo permission not granted");
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: IMAGE_MEDIA_TYPES,
      quality: 0.9,
      exif: true,
    });
    if (result.canceled) return null;
    return result.assets?.[0] || null;
  },

  async pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return null;
    return result.assets?.[0] || null;
  },

  async uploadPhoto({ context = {} } = {}) {
    const uid = await getUserId();
    if (!uid) throw new Error("Not signed in");

    const asset = await this.pickPhoto();
    if (!asset?.uri) return null;

    const attachmentId = newId();
    const fileName = asset.fileName || `photo_${Date.now()}.jpg`;
    const contentType = asset.mimeType || guessContentTypeFromName(fileName, "image/jpeg");

    const path = buildStoragePath({ uid, kind: "photo", attachmentId, fileName });
    const bucket = PHOTO_BUCKET;

    const { publicUrl } = await uploadToStorage({ bucket, path, uri: asset.uri, contentType });
    const signed = await signedUrl(bucket, path);

    return {
      attachment: {
        id: attachmentId,
        kind: "photo",
        fileName: sanitizeName(fileName),
        contentType,
        storage: { bucket, path },
        urls: { public: publicUrl, signed },
        known: {
          uploadedAt: nowIso(),
          width: asset.width ?? null,
          height: asset.height ?? null,
          exifSummary: pickExifSummary(asset.exif),
        },
        context,
      },
    };
  },

  async uploadFile({ context = {} } = {}) {
    const uid = await getUserId();
    if (!uid) throw new Error("Not signed in");

    const file = await this.pickFile();
    if (!file?.uri) return null;

    const attachmentId = newId();
    const fileName = file.name || `file_${Date.now()}`;
    const contentType = file.mimeType || guessContentTypeFromName(fileName);

    const path = buildStoragePath({ uid, kind: "file", attachmentId, fileName });
    const bucket = FILE_BUCKET;

    const { publicUrl } = await uploadToStorage({ bucket, path, uri: file.uri, contentType });
    const signed = await signedUrl(bucket, path);

    return {
      attachment: {
        id: attachmentId,
        kind: "file",
        fileName: sanitizeName(fileName),
        contentType,
        storage: { bucket, path },
        urls: { public: publicUrl, signed },
        known: {
          uploadedAt: nowIso(),
          sizeBytes: file.size ?? null,
        },
        context,
      },
    };
  },

  async remove(attachment) {
    const bucket = attachment?.storage?.bucket;
    const path = attachment?.storage?.path;
    if (!bucket || !path) throw new Error("Missing storage reference");
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  },

  async listUserAttachments({ kind = "photo" } = {}) {
    const uid = await getUserId();
    if (!uid) throw new Error("Not signed in");

    const bucket = kind === "photo" ? PHOTO_BUCKET : FILE_BUCKET;
    const prefix = `users/${uid}/attachments/${kind === "photo" ? "photos" : "files"}`;

    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100,
      offset: 0,
      sortBy: { column: "updated_at", order: "desc" },
    });
    if (error) throw error;

    const out = await Promise.all(
      (data || []).map(async (obj) => {
        const path = `${prefix}/${obj.name}`;
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
        const signed = await signedUrl(bucket, path);
        return {
          id: obj.name, // temporary; DB row id later
          kind,
          fileName: obj.name,
          contentType: guessContentTypeFromName(obj.name),
          storage: { bucket, path },
          urls: { public: pub?.publicUrl || null, signed },
          known: { updatedAt: obj.updated_at || null },
          context: {},
        };
      })
    );

    return { attachments: out };
  },
};
