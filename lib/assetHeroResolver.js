import { getSignedUrl, listAttachmentsForAsset } from "./attachmentsApi";
import { supabase } from "./supabaseClient";

const HERO_URI_CACHE_MAX = 1000;
const HERO_URI_DEFAULT_EXPIRES_IN = 3600;
const HERO_URI_EXPIRY_BUFFER_SECONDS = 60;

const heroUriCache = new Map();
const heroUriByAssetCache = new Map();

export const ASSET_HERO_SCOPES = Object.freeze({
  MODEL_DNA: "model_dna",
  EXACT_KAC: "exact_kac",
});

function stableStringify(value) {
  if (!value || typeof value !== "object") return String(value || "");
  const keys = Object.keys(value).sort();
  return keys.map((key) => `${key}:${stableStringify(value[key])}`).join("|");
}

function heroCacheKey(assetId, { transform, expiresIn } = {}) {
  return [
    assetId,
    Number(expiresIn || HERO_URI_DEFAULT_EXPIRES_IN),
    stableStringify(transform),
  ].join("::");
}

function heroCacheExpiresAt(expiresIn) {
  const seconds = Math.max(
    30,
    Number(expiresIn || HERO_URI_DEFAULT_EXPIRES_IN) - HERO_URI_EXPIRY_BUFFER_SECONDS
  );
  return Date.now() + seconds * 1000;
}

function readHeroCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.uri || null;
}

function pruneHeroCache(map) {
  if (map.size <= HERO_URI_CACHE_MAX) return;
  const overflow = map.size - HERO_URI_CACHE_MAX;
  Array.from(map.keys()).slice(0, overflow).forEach((key) => map.delete(key));
}

function writeCachedAssetHeroUri(assetId, uri, options = {}) {
  if (!assetId || !uri) return;
  const entry = {
    uri,
    expiresAt: heroCacheExpiresAt(options.expiresIn),
  };
  heroUriCache.set(heroCacheKey(assetId, options), entry);
  heroUriByAssetCache.set(assetId, entry);
  pruneHeroCache(heroUriCache);
  pruneHeroCache(heroUriByAssetCache);
}

export function getCachedAssetHeroUris(assetIds, options = {}, { allowAnySize = false } = {}) {
  const urls = {};
  Array.from(new Set((assetIds || []).filter(Boolean))).forEach((assetId) => {
    const exact = readHeroCache(heroUriCache, heroCacheKey(assetId, options));
    const anySize = allowAnySize ? readHeroCache(heroUriByAssetCache, assetId) : null;
    const uri = exact || anySize;
    if (uri) urls[assetId] = uri;
  });
  return urls;
}

function fallbackHeroUrl(asset) {
  return (
    asset?.hero_image_url ||
    asset?.hero_thumb_url ||
    asset?.primary_photo_url ||
    asset?.showcase_image_url ||
    asset?.cover_image_url ||
    asset?.image_url ||
    null
  );
}

async function signedAttachmentUrl(attachment, transform, expiresIn) {
  if (!attachment || attachment.deleted_at) return null;
  if (attachment.url) return attachment.url;
  if (!attachment.bucket || !attachment.storage_path) return null;

  try {
    return await getSignedUrl({
      bucket: attachment.bucket,
      path: attachment.storage_path,
      expiresIn: expiresIn || 3600,
      transform,
    });
  } catch (err) {
    if (transform) {
      try {
        return await getSignedUrl({
          bucket: attachment.bucket,
          path: attachment.storage_path,
          expiresIn: expiresIn || 3600,
        });
      } catch (plainErr) {
        // Fall through to public URL fallback below.
      }
    }
    return (
      supabase.storage
        .from(attachment.bucket)
        .getPublicUrl(attachment.storage_path)?.data?.publicUrl || null
    );
  }
}

function imageAttachmentFilter(row) {
  const attachment = row?.attachment || row?.attachments || row || {};
  const mime = String(attachment.mime_type || "").toLowerCase();
  const name = String(attachment.file_name || attachment.storage_path || attachment.title || "").toLowerCase();
  return (
    attachment.kind === "photo" ||
    mime.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|heic)$/i.test(name)
  );
}

function heroCandidatePlacementFilter(row) {
  const role = String(row?.role || "").toLowerCase();
  return role === "primary" || role === "hero" || role === "showcase" || Boolean(row?.is_showcase);
}

function placementRank(row) {
  const role = String(row?.role || "").toLowerCase();
  if (role === "primary") return 100;
  if (role === "hero") return 90;
  if (row?.is_showcase) return 80;
  if (role === "showcase") return 80;
  return 10;
}

async function resolveBestAssetAttachmentHero(assetId, transform, expiresIn) {
  if (!assetId) return null;

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      "id,role,is_showcase,sort_order,created_at,attachment:attachments(id,bucket,storage_path,url,mime_type,kind,deleted_at,title,file_name)"
    )
    .eq("target_type", "asset")
    .eq("target_id", assetId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Could not load asset hero attachments:", error.message);
    return null;
  }

  const picked = (data || [])
    .filter((row) => !row?.attachment?.deleted_at)
    .filter(heroCandidatePlacementFilter)
    .filter(imageAttachmentFilter)
    .sort((a, b) => {
      const rankDelta = placementRank(b) - placementRank(a);
      if (rankDelta) return rankDelta;
      const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999;
      const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      if (sortA !== sortB) return sortA - sortB;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })[0];

  return signedAttachmentUrl(picked?.attachment, transform, expiresIn);
}

async function resolveInheritedModelHero(assetId, transform, expiresIn) {
  if (!assetId) return null;

  try {
    const rows = await listAttachmentsForAsset(assetId, { includeInheritedModelMedia: true });
    const picked = (rows || [])
      .filter((row) => row?.is_inherited_model_media)
      .filter(imageAttachmentFilter)
      .sort((a, b) => {
        const rankFor = (row) => {
          const role = String(row?.role || "").toLowerCase();
          if (row?.is_hero || role === "hero") return 100;
          if (row?.is_showcase || row?.model_is_showcase || role === "showcase") return 80;
          return 10;
        };
        const rankDelta = rankFor(b) - rankFor(a);
        if (rankDelta) return rankDelta;
        const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999;
        const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
        if (sortA !== sortB) return sortA - sortB;
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      })[0];

    return signedAttachmentUrl(picked, transform, expiresIn);
  } catch (err) {
    console.warn("Could not resolve inherited model hero:", err?.message || err);
    return null;
  }
}

async function resolveBoundModelDnaHero(assetId, transform, expiresIn) {
  if (!assetId) return null;

  try {
    const { data, error } = await supabase
      .from("asset_template_bindings")
      .select("template:asset_model_templates(id,metadata)")
      .eq("asset_id", assetId)
      .in("binding_status", ["verified", "inherited", "suggested"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Could not load bound model DNA hero:", error.message);
      return null;
    }

    return resolveModelDnaHero(data?.template, { transform, expiresIn });
  } catch (err) {
    console.warn("Could not resolve bound model DNA hero:", err?.message || err);
    return null;
  }
}

async function resolvePlacementHeroUri(placementId, transform, expiresIn) {
  if (!placementId) return null;

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      "id,attachment:attachments(id,bucket,storage_path,url,mime_type,kind,deleted_at,title,file_name)"
    )
    .eq("id", placementId)
    .maybeSingle();

  if (error) {
    console.warn("Could not resolve asset hero placement:", error.message);
    return null;
  }

  return signedAttachmentUrl(data?.attachment, transform, expiresIn);
}

async function resolveBestModelAttachmentHero(templateId, transform, expiresIn) {
  if (!templateId) return null;

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      "id,role,is_showcase,sort_order,created_at,attachment:attachments(id,bucket,storage_path,url,mime_type,kind,deleted_at,title,file_name)"
    )
    .eq("target_type", "model_template")
    .eq("target_id", templateId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Could not load model DNA hero attachments:", error.message);
    return null;
  }

  const picked = (data || [])
    .filter((row) => !row?.attachment?.deleted_at)
    .filter(heroCandidatePlacementFilter)
    .filter(imageAttachmentFilter)
    .sort((a, b) => {
      const rankDelta = placementRank(b) - placementRank(a);
      if (rankDelta) return rankDelta;
      const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999;
      const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      if (sortA !== sortB) return sortA - sortB;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })[0];

  return signedAttachmentUrl(picked?.attachment, transform, expiresIn);
}

export function modelDnaHeroPlacementId(template = {}) {
  const metadata = template?.metadata && typeof template.metadata === "object" ? template.metadata : {};
  return (
    metadata.presentation?.hero_placement_id ||
    metadata.presentation?.heroPlacementId ||
    metadata.model_media?.hero_placement_id ||
    metadata.hero_placement_id ||
    null
  );
}

async function resolveModelDnaHero(templateOrId, { transform, expiresIn } = {}) {
  let template = templateOrId;
  const templateId =
    typeof templateOrId === "string" ? templateOrId : templateOrId?.id || templateOrId?.template_id || null;

  if (typeof templateOrId === "string") {
    const { data, error } = await supabase
      .from("asset_model_templates")
      .select("id,metadata")
      .eq("id", templateId)
      .maybeSingle();

    if (error) {
      console.warn("Could not load model DNA hero row:", error.message);
      return null;
    }
    template = data || { id: templateId };
  }

  const placementHero = await resolvePlacementHeroUri(modelDnaHeroPlacementId(template), transform, expiresIn);
  if (placementHero) return placementHero;

  return resolveBestModelAttachmentHero(templateId, transform, expiresIn);
}

async function resolveKacHeroMediaViaRpc(assetId, transform, expiresIn) {
  if (!assetId) return null;

  const { data, error } = await supabase.rpc("resolve_asset_shared_hero_media", {
    p_asset_id: assetId,
  });

  if (error) {
    console.warn("Could not resolve canonical KAC hero media:", error.message);
    return null;
  }

  return signedAttachmentUrl(data, transform, expiresIn);
}

export async function resolveAssetHero({ scope, id, entity, transform, expiresIn } = {}) {
  const normalizedScope = String(scope || "").toLowerCase();
  if (normalizedScope === ASSET_HERO_SCOPES.MODEL_DNA || normalizedScope === "model" || normalizedScope === "template") {
    return resolveModelDnaHero(entity || id, { transform, expiresIn });
  }
  return resolveKacHero(entity || id, { transform, expiresIn });
}

export async function resolveKacHero(assetOrId, { transform, expiresIn } = {}) {
  let asset = assetOrId;
  let assetId =
    typeof assetOrId === "string" ? assetOrId : assetOrId?.id || assetOrId?.asset_id || null;

  const canonicalHero = await resolveKacHeroMediaViaRpc(assetId, transform, expiresIn);
  if (canonicalHero) return canonicalHero;

  if (typeof assetOrId === "string") {
    const { data, error } = await supabase
      .from("assets")
      .select("id,hero_placement_id,hero_image_url,hero_thumb_url")
      .eq("id", assetId)
      .maybeSingle();

    if (error) {
      console.warn("Could not load asset hero row:", error.message);
      return null;
    }
    asset = data || { id: assetId };
  }

  const placementId = asset?.hero_placement_id || null;
  const fallback = fallbackHeroUrl(asset);
  assetId = asset?.id || asset?.asset_id || assetId;

  if (placementId) {
    const assetHero = await resolvePlacementHeroUri(placementId, transform, expiresIn);
    if (assetHero) return assetHero;
  }

  const bestExactAssetHero = await resolveBestAssetAttachmentHero(assetId, transform, expiresIn);
  if (bestExactAssetHero) return bestExactAssetHero;

  const boundModelHero = await resolveBoundModelDnaHero(assetId, transform, expiresIn);
  if (boundModelHero) return boundModelHero;

  const inheritedModelHero = await resolveInheritedModelHero(assetId, transform, expiresIn);
  if (inheritedModelHero) return inheritedModelHero;

  return fallback;
}

export async function fetchKacHeroUris(assetIds, { transform, expiresIn } = {}) {
  const options = { transform, expiresIn };
  const ids = Array.from(new Set((assetIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const cached = getCachedAssetHeroUris(ids, options);
  let missingIds = ids.filter((assetId) => !cached[assetId]);
  if (!missingIds.length) return cached;

  const entries = await Promise.all(
    missingIds.map(async (assetId) => [
      assetId,
      await resolveKacHero(assetId, options),
    ])
  );

  const resolved = Object.fromEntries(entries.filter(([, uri]) => Boolean(uri)));
  Object.entries(resolved).forEach(([assetId, uri]) => {
    writeCachedAssetHeroUri(assetId, uri, options);
  });

  return { ...cached, ...resolved };
}

export const resolveAssetHeroUri = resolveKacHero;
export const fetchAssetHeroUris = fetchKacHeroUris;
export const getCachedKacHeroUris = getCachedAssetHeroUris;
