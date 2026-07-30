// lib/attachmentsUploader.js
// Stable uploader:
// - Inserts attachments row (DB) first with deterministic storage_path
// - Uploads bytes to Storage
// - Upserts ONE placement per (attachment_id, target_type, target_id) to avoid duplicates

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "./supabaseClient";
import { trackWithAcquisition } from "./acquisitionContext";
import { classifyUrl, normalizeUrl } from "../components/links/linkUtils";


// ✅ V1 standard: ALL new uploads go here (photos + files)
const DEFAULT_BUCKET = "asset-files";

// --- base64 -> Uint8Array (no deps)
const b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const b64tab = (() => {
  const t = new Uint8Array(256);
  t.fill(255);
  for (let i = 0; i < b64chars.length; i++) t[b64chars.charCodeAt(i)] = i;
  t["=".charCodeAt(0)] = 0;
  return t;
})();

function base64ToBytes(b64) {
  const clean = (b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;

  for (let i = 0; i < len; i += 4) {
    const c1 = b64tab[clean.charCodeAt(i)];
    const c2 = b64tab[clean.charCodeAt(i + 1)];
    const c3 = b64tab[clean.charCodeAt(i + 2)];
    const c4 = b64tab[clean.charCodeAt(i + 3)];

    const n = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;

    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== "=") out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== "=") out[o++] = n & 255;
  }
  return out.slice(0, o);
}

function guessMimeType(fileName, fallback) {
  if (fallback) return fallback;
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function safeFileName(name) {
  const raw = String(name || "").trim() || "file";
  // keep it simple for storage paths
  return raw.replace(/[^\w.\-]+/g, "_");
}

function uuidv4() {
  // Prefer crypto.randomUUID if available
  try {
    if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}

  // Fallback: RFC4122-ish v4
  const rnd = (n) => Math.floor(Math.random() * n);
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += "-";
      continue;
    }
    let r = rnd(16);
    if (i === 14) r = 4;
    if (i === 19) r = (r & 0x3) | 0x8;
    s += r.toString(16);
  }
  return s;
}

function extFromFileName(name) {
  const n = String(name || "");
  const i = n.lastIndexOf(".");
  if (i < 0) return "";
  const ext = n.slice(i).toLowerCase();
  // very small guard
  if (ext.length > 10) return "";
  return ext;
}

function isHeicPhoto({ kind, fileName, mimeType }) {
  if (kind !== "photo") return false;
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  return mime.includes("heic") || mime.includes("heif") || /\.(heic|heif)$/.test(name);
}

async function normalizeHeicPhotoForUpload({ kind, fileUri, fileName, mimeType }) {
  if (Platform.OS === "web" || !isHeicPhoto({ kind, fileName, mimeType })) {
    return { fileUri, fileName, mimeType };
  }

  const converted = await ImageManipulator.manipulateAsync(
    fileUri,
    [],
    {
      compress: 0.88,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  const baseName = String(fileName || "photo")
    .replace(/\.(heic|heif)$/i, "")
    .replace(/\.[^.]+$/i, "");

  return {
    fileUri: converted.uri,
    fileName: `${baseName || "photo"}.jpg`,
    mimeType: "image/jpeg",
  };
}

// IMPORTANT: Storage keys must be stable + derivable from DB rows.
// V1 standard: users/<owner_id>/attachments/<asset_id>/<attachment_id>.<ext>
function makeStoragePath({ userId, assetId, attachmentId, fileName }) {
  const cleanAssetId = assetId || "inbox";
  const ext = extFromFileName(fileName);
  return `users/${userId}/attachments/${cleanAssetId}/${attachmentId}${ext}`;
}

function inferLinkSourceContext(rawUrl = "") {
  const url = normalizeUrl(rawUrl);
  if (!url) return { url: rawUrl, source_context: "link" };

  try {
    const meta = classifyUrl(url);
    const kind = String(meta?.kind || "link").toLowerCase();

    if (kind === "youtube") return { url, source_context: "youtube" };
    if (kind === "vimeo") return { url, source_context: "vimeo" };
    if (kind === "pdf") return { url, source_context: "pdf" };

    return { url, source_context: "link" };
  } catch {
    return { url, source_context: "link" };
  }
}

async function uriToBytes(uri) {
  if (Platform.OS === "web") {
    // data URL
    if (uri.startsWith("data:")) {
      const comma = uri.indexOf(",");
      const b64 = comma >= 0 ? uri.slice(comma + 1) : "";
      return base64ToBytes(b64);
    }

    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read file (web): ${res.status}`);
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }

  // NATIVE
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  return base64ToBytes(base64);
}

// --- DB helpers
async function insertAttachmentRow({
  id,
  owner_user_id,
  asset_id,
  kind,
  bucket,
  storage_path,
  url,
  file_name,
  mime_type,
  size_bytes,
  title,
  notes,
  source_context,
}) {
  const payload = {
    id: id ?? undefined,
    owner_user_id,
    asset_id: asset_id ?? null,
    kind,
    bucket,
    storage_path: storage_path ?? null,
    url: url ?? null,
    file_name: file_name ?? null,
    mime_type: mime_type ?? null,
    size_bytes: size_bytes ?? null,
    title: title ?? null,
    notes: notes ?? null,
    source_context: source_context ?? null,
  };

  const { data, error } = await supabase
    .from("attachments")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(`DB insert (attachments) failed: ${error.message}`);
  return data;
}

async function updateAttachmentRow(id, patch) {
  const { data, error } = await supabase
    .from("attachments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(`DB update (attachments) failed: ${error.message}`);
  return data;
}

// Upsert placement to avoid duplicate-key failures.
// Your DB has a unique constraint like: attachment_placements_unique_triplet
// which effectively means (attachment_id, target_type, target_id) must be unique.
async function upsertPlacementRow({
  attachment_id,
  target_type,
  target_id,
  role,
  label,
  sort_order,
  is_showcase,
}) {
  const payload = {
    attachment_id,
    target_type,
    target_id,
    role: role ?? null,
    label: label ?? null,
    sort_order: sort_order ?? null,
    is_showcase: !!is_showcase,
  };

  const { data, error } = await supabase
    .from("attachment_placements")
    .upsert(payload, {
      onConflict: "attachment_id,target_type,target_id",
      ignoreDuplicates: false,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`DB upsert (attachment_placements) failed: ${error.message}`);
  }
  return data;
}

// ---- Auth/session guard (RLS-safe)
async function getSessionUserIdOrThrow(passedUserId = null) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;

  const authUserId = authData?.user?.id || null;
  if (!authUserId) throw new Error("No authenticated session (auth user missing)");

  // If caller passed a userId, it must match the session.
  if (passedUserId && passedUserId !== authUserId) {
    throw new Error(
      `User mismatch: caller userId=${passedUserId} but session userId=${authUserId}`
    );
  }

  return authUserId;
}

function normalizePlacement(p) {
  if (!p) return null;
  const target_type = String(p.target_type || "").trim();
  const target_id = String(p.target_id || "").trim();
  if (!target_type || !target_id) return null;

  return {
    target_type,
    target_id,
    role: p.role ?? null,
    label: p.label ?? null,
    sort_order: p.sort_order ?? null,
    is_showcase: !!p.is_showcase,
  };
}

// If multiple placements try to hit the same (target_type,target_id), pick the best intent.
function pickPreferredPlacement(a, b) {
  const rank = (p) => {
    const r = String(p?.role || "").toLowerCase();
    if (r === "hero" || r === "primary" || r === "showcase") return 3;
    if (p?.is_showcase) return 2;
    return 1;
  };
  return rank(b) > rank(a) ? b : a;
}

async function maybeSetInitialAssetHero({ assetId, placementRows, attachment }) {
  if (!assetId || !attachment?.id) return;

  const assetPlacement = (placementRows || []).find(
    (p) => p?.target_type === "asset" && p?.target_id === assetId
  );

  if (!assetPlacement?.id) return;

  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("id, hero_placement_id")
    .eq("id", assetId)
    .maybeSingle();

  if (assetErr || asset?.hero_placement_id) return;

  await supabase
    .from("assets")
    .update({
      hero_placement_id: assetPlacement.id,
      hero_thumb_url:
        attachment.thumb_320_url ||
        attachment.thumb_640_url ||
        attachment.url ||
        null,
      hero_thumb_updated_at: new Date().toISOString(),
    })
    .eq("id", assetId);
}

export async function uploadAttachmentFromUri({
  userId,
  assetId = null,
  kind, // 'photo' | 'file'
  fileUri,
  fileName = null,
  mimeType = null,
  sizeBytes = null,
  title = null,
  notes = null,
  sourceContext = null,
  placements = [],
  setAsAssetHero = false,
  bucket = DEFAULT_BUCKET,
  onProgress = null,
}) {
  // Session guard: ensures auth.uid() matches owner_user_id for RLS inserts
  const sessionUserId = await getSessionUserIdOrThrow(userId);
  userId = sessionUserId;

  if (!fileUri) throw new Error("uploadAttachmentFromUri: fileUri required");
  if (kind !== "photo" && kind !== "file") {
    throw new Error("uploadAttachmentFromUri: kind must be 'photo' or 'file'");
  }

  const normalizedFile = await normalizeHeicPhotoForUpload({
    kind,
    fileUri,
    fileName: fileName || (kind === "photo" ? "photo.jpg" : "file"),
    mimeType,
  });

  const computedName = safeFileName(
    normalizedFile.fileName || (kind === "photo" ? "photo.jpg" : "file")
  );
  const contentType = guessMimeType(computedName, normalizedFile.mimeType);

  // 1) Create attachment row with a stable storage_path up front.
  // This prevents "file attachment with NULL storage_path" rows and makes signing reliable.
  const attachmentId = uuidv4();
  const storagePath = makeStoragePath({
    userId,
    assetId,
    attachmentId,
    fileName: computedName,
  });

  const attachment = await insertAttachmentRow({
    id: attachmentId,
    owner_user_id: userId,
    asset_id: assetId ?? null,
    kind,
    bucket,
    storage_path: storagePath,
    url: null, // never persist signed URLs
    file_name: computedName,
    mime_type: contentType,
    size_bytes: sizeBytes ?? null,
    title: title ?? computedName,
    notes: notes ?? null,
    source_context: sourceContext ?? null,
  });

  if (onProgress) onProgress(0.15);

  // 2) upload to storage
  const bytes = await uriToBytes(normalizedFile.fileUri);
  if (onProgress) onProgress(0.35);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, { contentType, upsert: false });

  if (uploadError) {
    // keep DB row but mark it failed
    await updateAttachmentRow(attachment.id, {
      notes: `${notes || ""}\n\n[upload_error] ${uploadError.message}`.trim(),
    });
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  if (onProgress) onProgress(0.7);

  // 3) update attachment metadata (storage_path already set at insert)
  const updated = await updateAttachmentRow(attachment.id, {
    bucket,
    file_name: computedName,
    mime_type: contentType,
    size_bytes: sizeBytes ?? null,
    storage_path: storagePath,
  });

  console.log("THUMB JOB CHECK", {
  attachmentId: updated.id,
  kind,
  contentType,
  mimeType,
  fileName: computedName,
});

  // Queue async thumbnail/derivative generation for images.
// This does not block the upload experience from a UI perspective;
// if job insert fails, the original upload still succeeds.
if (String(contentType || "").startsWith("image/")) {
  try {
    const { data: jobData, error: jobError } = await supabase
      .from("thumbnail_jobs")
      .insert({
        attachment_id: updated.id,
      })
      .select("*")
      .single();

    if (jobError) {
      console.log("thumbnail_jobs insert failed", jobError);
    } else {
      console.log("thumbnail_jobs inserted", jobData);
    }
  } catch (jobErr) {
    console.log("thumbnail_jobs insert exception", jobErr);
  }
}

  // 4) placements (ONE per target, always upsert)
  let finalPlacements = Array.isArray(placements) ? placements : [];

  // Default placement:
  // - Normal upload: attach to the asset as role "other"
  // - Hero upload: attach to the asset as role "primary" + showcase
  if (finalPlacements.length === 0 && assetId) {
    finalPlacements = setAsAssetHero
      ? [{ target_type: "asset", target_id: assetId, role: "primary", is_showcase: true }]
      : [{ target_type: "asset", target_id: assetId, role: "other" }];
  }

  // Normalize + dedupe by (target_type,target_id)
  const bestByTarget = new Map();
  for (const raw of finalPlacements) {
    const p = normalizePlacement(raw);
    if (!p) continue;

    const key = `${p.target_type}|${p.target_id}`;
    if (!bestByTarget.has(key)) bestByTarget.set(key, p);
    else bestByTarget.set(key, pickPreferredPlacement(bestByTarget.get(key), p));
  }

  const placementRows = [];
  for (const p of bestByTarget.values()) {
    placementRows.push(
      await upsertPlacementRow({
        attachment_id: updated.id,
        target_type: p.target_type,
        target_id: p.target_id,
        role: p.role ?? null,
        label: p.label ?? null,
        sort_order: p.sort_order ?? null,
        is_showcase: p.is_showcase ?? false,
      })
    );
  }

if (kind === "photo" && assetId) {
  await maybeSetInitialAssetHero({
    assetId,
    placementRows,
    attachment: updated,
  });
}

if (onProgress) onProgress(1);

await trackWithAcquisition("proof_uploaded", {
  attachment_id: updated.id,
  asset_id: assetId,
  attachment_kind: kind,
  mime_type: contentType,
  source_context: sourceContext || null,
  placement_count: placementRows.length,
  has_asset_association: placementRows.some((p) => p.target_type === "asset"),
  has_system_association: placementRows.some((p) => p.target_type === "system"),
  has_record_association: placementRows.some((p) => p.target_type === "service_record"),
}, { userId });

return { attachment: updated, placements: placementRows };
}

export async function createLinkAttachment({
  userId,
  assetId = null,
  url,
  title = null,
  notes = null,
  sourceContext = null,
  placements = [],
  bucket = DEFAULT_BUCKET, // unused for links but keeps contract consistent
}) {
  // Session guard (same reason: RLS on attachments)
  const sessionUserId = await getSessionUserIdOrThrow(userId);
  userId = sessionUserId;

  if (!url) throw new Error("createLinkAttachment: url required");

  const inferred = inferLinkSourceContext(url);
  const finalUrl = inferred.url;
  const finalSourceContext = sourceContext || inferred.source_context;

  // 1) create attachment row
  const attachment = await insertAttachmentRow({
    owner_user_id: userId,
    asset_id: assetId ?? null,
    kind: "link",
    bucket,
    storage_path: null,
    url: finalUrl,
    file_name: null,
    mime_type: null,
    size_bytes: null,
    title: title ?? finalUrl,
    notes: notes ?? null,
    source_context: finalSourceContext ?? null,
  });

  // 2) placements (dedupe + upsert)
  let finalPlacements = Array.isArray(placements) ? placements : [];
  if (finalPlacements.length === 0 && assetId) {
    finalPlacements = [{ target_type: "asset", target_id: assetId, role: "other" }];
  }

  const bestByTarget = new Map();
  for (const raw of finalPlacements) {
    const p = normalizePlacement(raw);
    if (!p) continue;

    const key = `${p.target_type}|${p.target_id}`;
    if (!bestByTarget.has(key)) bestByTarget.set(key, p);
    else bestByTarget.set(key, pickPreferredPlacement(bestByTarget.get(key), p));
  }

  const placementRows = [];
  for (const p of bestByTarget.values()) {
    placementRows.push(
      await upsertPlacementRow({
        attachment_id: attachment.id,
        target_type: p.target_type,
        target_id: p.target_id,
        role: p.role ?? null,
        label: p.label ?? null,
        sort_order: p.sort_order ?? null,
        is_showcase: p.is_showcase ?? false,
      })
    );
  }

  await trackWithAcquisition("proof_uploaded", {
  attachment_id: attachment.id,
  asset_id: assetId,
  attachment_kind: "link",
  url_host: (() => {
    try {
      return new URL(finalUrl).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })(),
  source_context: finalSourceContext || null,
  placement_count: placementRows.length,
  has_asset_association: placementRows.some((p) => p.target_type === "asset"),
  has_system_association: placementRows.some((p) => p.target_type === "system"),
  has_record_association: placementRows.some((p) => p.target_type === "service_record"),
}, { userId });

return { attachment, placements: placementRows };
}

export async function createTextAttachment({
  userId,
  assetId = null,
  text,
  title = "Shared text",
  placements = [],
  bucket = DEFAULT_BUCKET,
}) {
  const sessionUserId = await getSessionUserIdOrThrow(userId);
  userId = sessionUserId;

  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Error("createTextAttachment: text required");

  const attachment = await insertAttachmentRow({
    owner_user_id: userId,
    asset_id: assetId ?? null,
    kind: "file",
    bucket,
    storage_path: null,
    url: null,
    file_name: null,
    mime_type: "text/plain",
    size_bytes: body.length,
    title,
    notes: body,
    source_context: "shared_text",
  });

  let finalPlacements = Array.isArray(placements) ? placements : [];
  if (finalPlacements.length === 0 && assetId) {
    finalPlacements = [{ target_type: "asset", target_id: assetId, role: "other" }];
  }

  const bestByTarget = new Map();
  for (const raw of finalPlacements) {
    const p = normalizePlacement(raw);
    if (!p) continue;

    const key = `${p.target_type}|${p.target_id}`;
    if (!bestByTarget.has(key)) bestByTarget.set(key, p);
    else bestByTarget.set(key, pickPreferredPlacement(bestByTarget.get(key), p));
  }

  const placementRows = [];
  for (const p of bestByTarget.values()) {
    placementRows.push(
      await upsertPlacementRow({
        attachment_id: attachment.id,
        target_type: p.target_type,
        target_id: p.target_id,
        role: p.role ?? null,
        label: p.label ?? null,
        sort_order: p.sort_order ?? null,
        is_showcase: p.is_showcase ?? false,
      })
    );
  }

  await trackWithAcquisition("proof_uploaded", {
    attachment_id: attachment.id,
    asset_id: assetId,
    attachment_kind: "text",
    source_context: "shared_text",
    placement_count: placementRows.length,
    has_asset_association: placementRows.some((p) => p.target_type === "asset"),
    has_system_association: placementRows.some((p) => p.target_type === "system"),
    has_record_association: placementRows.some((p) => p.target_type === "service_record"),
  }, { userId });

  return { attachment, placements: placementRows };
}
