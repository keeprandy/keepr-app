// lib/attachmentsApi.js
import { supabase } from "./supabaseClient";
import { formatContributionAttribution } from "./provenance";

function profileLabel(row) {
  return row?.display_name || row?.full_name || row?.email || null;
}

async function buildAttachmentContributorMetadata(attachments = []) {
  const userIds = Array.from(
    new Set((attachments || []).map((a) => a?.owner_user_id).filter(Boolean))
  );
  const orgIds = Array.from(
    new Set((attachments || []).map((a) => a?.org_id).filter(Boolean))
  );
  const profileLabels = new Map();
  const orgLabels = new Map();

  if (userIds.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,full_name,email")
      .in("id", userIds);
    if (!error) {
      (data || []).forEach((row) => {
        profileLabels.set(row.id, profileLabel(row));
      });
    }
  }

  if (orgIds.length) {
    const { data, error } = await supabase
      .from("orgs")
      .select("id,name,display_name")
      .in("id", orgIds);
    if (!error) {
      (data || []).forEach((row) => {
        orgLabels.set(row.id, row.display_name || row.name || null);
      });
    }
  }

  return { profileLabels, orgLabels };
}

function attachmentAttribution(attachment, contributorMetadata) {
  const userLabel = contributorMetadata?.profileLabels?.get(attachment?.owner_user_id) || null;
  const orgLabel = contributorMetadata?.orgLabels?.get(attachment?.org_id) || null;
  return formatContributionAttribution({
    ...attachment,
    contributed_by_user_id: attachment?.owner_user_id || null,
    contributed_by_user_label: userLabel,
    contributed_by_org_id: attachment?.org_id || null,
    contributed_by_org_label: orgLabel,
  });
}

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
        owner_user_id,
        org_id,
        created_at,
        source_context,
        ai_metadata
      )
    `
    )
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const contributorMetadata = await buildAttachmentContributorMetadata(
    (data || []).map((row) => row.attachments).filter(Boolean)
  );

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
      owner_user_id: a.owner_user_id || null,
      org_id: a.org_id || null,
      created_at: a.created_at,
      source_context: a.source_context || null,
      ai_metadata: a.ai_metadata || null,
      attribution: attachmentAttribution(a, contributorMetadata),
    };
  });
}
// -----------------------------------------------------------------------------
// Signed URL cache (prevents re-signing the same object repeatedly across screens)
// -----------------------------------------------------------------------------

const SIGNED_URL_CACHE_MAX = 500;
const SIGNED_URL_FAILURE_TTL_MS = 60 * 1000;
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

function normalizeStoragePath(bucket, path) {
  if (!path) return null;
  const bucketName = String(bucket || "").trim();
  let value = String(path || "").trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    value = parsed.pathname || value;
  } catch {
    // Not an absolute URL; keep the original path.
  }

  const urlPrefixes = [
    `/storage/v1/object/sign/${bucketName}/`,
    `/storage/v1/object/public/${bucketName}/`,
    `/storage/v1/object/authenticated/${bucketName}/`,
    `/object/sign/${bucketName}/`,
    `/object/public/${bucketName}/`,
    `/object/authenticated/${bucketName}/`,
  ].filter((prefix) => bucketName && prefix);

  for (const prefix of urlPrefixes) {
    const index = value.indexOf(prefix);
    if (index >= 0) {
      value = value.slice(index + prefix.length);
      break;
    }
  }

  value = value.replace(/^\/+/, "");
  if (bucketName && value === bucketName) return null;
  if (bucketName && value.startsWith(`${bucketName}/`)) {
    value = value.slice(bucketName.length + 1);
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    // A malformed escape should not prevent signing an otherwise usable path.
  }

  return value || null;
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
  const normalizedPath = normalizeStoragePath(bucket, path);
  if (!bucket || !normalizedPath) return null;

  const key = makeSignedUrlCacheKey({ bucket, path: normalizedPath, expiresIn, transform });
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    if (cached.failed) return null;
    if (cached.url) return cached.url;
  }

  // Keep a small safety buffer so we don't hand out nearly-expired URLs.
  const safetySeconds = 30;
  const ttlMs = Math.max(0, (Number(expiresIn) - safetySeconds) * 1000);

  const options = transform ? { transform } : undefined;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(normalizedPath, expiresIn, options);

  if (error) {
    signedUrlCache.set(key, {
      url: null,
      failed: true,
      expiresAt: Date.now() + SIGNED_URL_FAILURE_TTL_MS,
    });
    pruneSignedUrlCache();
    throw error;
  }

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
        owner_user_id,
        org_id,
        created_at,
        source_context,
        ai_metadata
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

  const contributorMetadata = await buildAttachmentContributorMetadata(
    (assetPlacements || []).map((row) => row.attachments).filter(Boolean)
  );

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
      owner_user_id: a.owner_user_id || null,
      org_id: a.org_id || null,
      created_at: a.created_at,
      source_context: a.source_context || null,
      ai_metadata: a.ai_metadata || null,
      attribution: attachmentAttribution(a, contributorMetadata),

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
