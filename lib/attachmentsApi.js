// lib/attachmentsApi.js
import { supabase } from "./supabaseClient";

/**
 * Existing: list attachments for a single target (system/service_record/asset)
 * Returns flattened placement rows.
 */
export async function listAttachmentsForTarget(targetType, targetId) {
  if (!targetType || !targetId) return [];

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at,
      attachments (
        id,
        kind,
        title,
        notes,
        url,
        file_name,
        mime_type,
        bucket,
        storage_path,
        bucket,
        created_at
      )
    `
    )
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // normalize to what your screens already expect today
  return (data || []).map((row) => {
    const a = row.attachments || {};
    return {
      placement_id: row.id,
      attachment_id: row.attachment_id,
      target_type: row.target_type,
      target_id: row.target_id,
      role: row.role,
      label: row.label,
      sort_order: row.sort_order,
      is_showcase: row.is_showcase,

      // attachment fields
      kind: a.kind,
      title: a.title,
      notes: a.notes,
      url: a.url,
      file_name: a.file_name,
      mime_type: a.mime_type,
      bucket: a.bucket || a.storage_bucket,
      storage_path: a.storage_path,
      created_at: a.created_at,
    };
  });
}
// -----------------------------------------------------------------------------
// Signed URL cache (prevents re-signing the same object repeatedly across screens)
// -----------------------------------------------------------------------------

const SIGNED_URL_CACHE_MAX = 500;
const signedUrlCache = new Map();

function stableStringify(obj) {
  if (!obj || typeof obj !== "object") return String(obj ?? "");
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function makeSignedUrlCacheKey({ bucket, path, expiresIn, transform }) {
  return `${bucket || ""}|${path || ""}|${expiresIn || ""}|${stableStringify(transform)}`;
}

function pruneSignedUrlCache() {
  if (signedUrlCache.size <= SIGNED_URL_CACHE_MAX) return;
  // Drop oldest entries (Map preserves insertion order)
  const overflow = signedUrlCache.size - SIGNED_URL_CACHE_MAX;
  let i = 0;
  for (const k of signedUrlCache.keys()) {
    signedUrlCache.delete(k);
    i += 1;
    if (i >= overflow) break;
  }
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}

/**
 * getSignedUrl
 *
 * - Adds optional Supabase Storage transform support (images only)
 * - Adds in-memory caching keyed by bucket+path+expiresIn+transform
 *
 * @param {Object} args
 * @param {string} args.bucket
 * @param {string} args.path
 * @param {number} [args.expiresIn=3600]
 * @param {Object|null} [args.transform=null] e.g. { width: 320, height: 320, resize: 'cover', quality: 80 }
 */
export async function getSignedUrl({ bucket, path, expiresIn = 3600, transform = null }) {
  if (!bucket || !path) return null;

  const key = makeSignedUrlCacheKey({ bucket, path, expiresIn, transform });
  const cached = signedUrlCache.get(key);
  if (cached && cached.url && cached.expiresAt && Date.now() < cached.expiresAt) {
    return cached.url;
  }

  // Keep a small safety buffer so we don't hand out nearly-expired URLs.
  const safetySeconds = 30;
  const ttlMs = Math.max(0, (Number(expiresIn) - safetySeconds) * 1000);

  const options = transform ? { transform } : undefined;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn, options);

  if (error) throw error;

  const signedUrl = data?.signedUrl || null;
  if (signedUrl) {
    signedUrlCache.set(key, { url: signedUrl, expiresAt: Date.now() + ttlMs });
    pruneSignedUrlCache();
  }

  return signedUrl;
}

/**
 * NEW: list canonical attachments for an asset, including ALL placements for each attachment.
 * This is what AssetAttachmentsScreen needs so associations “stick”.
 */
export async function listAttachmentsForAsset(assetId) {
  if (!assetId) return [];

  // 1) Anchor set: attachments that have an ASSET placement (your new rule)
  const { data: assetPlacements, error: pErr } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at,
      attachments (
        id,
        kind,
        title,
        notes,
        url,
        file_name,
        mime_type,
        bucket,
        storage_path,
        bucket,
        created_at
      )
    `
    )
    .eq("target_type", "asset")
    .eq("target_id", assetId)
    .order("created_at", { ascending: false });

  if (pErr) throw pErr;

  const ids = Array.from(
    new Set((assetPlacements || []).map((r) => r.attachment_id).filter(Boolean))
  );

  if (ids.length === 0) return [];

  // 2) Fetch ALL placements for those attachments (system + service_record + etc.)
  const { data: allPlacements, error: allErr } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at
    `
    )
    .in("attachment_id", ids);

  if (allErr) throw allErr;

  const byAttachment = new Map();
  (allPlacements || []).forEach((pl) => {
    const k = pl.attachment_id;
    if (!byAttachment.has(k)) byAttachment.set(k, []);
    byAttachment.get(k).push(pl);
  });

  // 3) Deduplicate: assetPlacements returns 1 row per *placement*.
  // If an attachment has multiple placements on the same asset (historical bug), return ONE item.
  const roleRank = (role) => {
    const r = String(role || "").toLowerCase();
    if (r === "primary") return 100;
    if (r === "hero") return 90;
    if (r === "showcase") return 80;
    if (r === "other") return 10;
    return 0;
  };

  const byId = new Map();

  for (const row of assetPlacements || []) {
    const a = row.attachments || {};
    const placements = (byAttachment.get(row.attachment_id) || []).sort((x, y) =>
      String(y.created_at || "").localeCompare(String(x.created_at || ""))
    );

    const candidate = {
      id: a.id || row.attachment_id,
      attachment_id: row.attachment_id,

      kind: a.kind,
      title: a.title,
      notes: a.notes,
      url: a.url,
      file_name: a.file_name,
      mime_type: a.mime_type,
      bucket: a.bucket || a.storage_bucket,
      storage_path: a.storage_path,
      created_at: a.created_at,

      // For UI actions we keep the primary placement id, but also expose all ids.
      asset_placement_id: row.id,
      asset_placement_ids: [row.id],
      asset_role: row.role,
      asset_label: row.label,
      asset_sort_order: row.sort_order,
      asset_is_showcase: row.is_showcase,

      placements,
    };

    const existing = byId.get(row.attachment_id);
    if (!existing) {
      byId.set(row.attachment_id, candidate);
      continue;
    }

    existing.asset_placement_ids = Array.from(
      new Set([...(existing.asset_placement_ids || []), row.id])
    );

    const exRank = roleRank(existing.asset_role);
    const caRank = roleRank(candidate.asset_role);
    const exT = String(existing.asset_placement_id || "");
    const caT = String(candidate.asset_placement_id || "");
    const candidateWins = caRank > exRank || (caRank === exRank && caT > exT);

    if (candidateWins) {
      byId.set(row.attachment_id, {
        ...existing,
        ...candidate,
        asset_placement_ids: existing.asset_placement_ids,
      });
    }
  }

  return Array.from(byId.values());
}
