import { getSignedUrl } from "./attachmentsApi";
import { supabase } from "./supabaseClient";

const HERO_URI_CACHE_MAX = 1000;
const HERO_URI_DEFAULT_EXPIRES_IN = 3600;
const HERO_URI_EXPIRY_BUFFER_SECONDS = 60;

const heroUriCache = new Map();
const heroUriByAssetCache = new Map();

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

function relationshipHeroPlacementIdFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  return (
    metadata?.presentation?.hero_placement_id ||
    metadata?.presentation?.heroPlacementId ||
    metadata?.hero_placement_id ||
    null
  );
}

async function fetchRelationshipHeroPlacementIds(assetIds, organizationId) {
  if (!organizationId || !assetIds?.length) return {};

  const { data, error } = await supabase
    .from("asset_relationships")
    .select("asset_id,metadata,created_at")
    .in("asset_id", assetIds)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Could not load relationship hero overrides:", error.message);
    return {};
  }

  return (data || []).reduce((acc, row) => {
    if (!row?.asset_id || acc[row.asset_id]) return acc;
    const placementId = relationshipHeroPlacementIdFromMetadata(row.metadata);
    if (placementId) acc[row.asset_id] = placementId;
    return acc;
  }, {});
}

async function resolveSharedHeroMediaViaRpc(assetId, organizationId, transform, expiresIn) {
  if (!assetId || !organizationId) return null;

  const { data, error } = await supabase.rpc("resolve_asset_shared_hero_media", {
    p_asset_id: assetId,
    p_organization_id: organizationId,
  });

  if (error) {
    console.warn("Could not resolve relationship asset hero media:", error.message);
    return null;
  }

  return signedAttachmentUrl(data, transform, expiresIn);
}

export async function resolveAssetHeroUri(asset, { transform, expiresIn, relationshipHeroPlacementId, organizationId } = {}) {
  const placementId = asset?.hero_placement_id || null;
  const overridePlacementId = relationshipHeroPlacementId || asset?.relationship_hero_placement_id || null;
  const fallback = fallbackHeroUrl(asset);
  const assetId = asset?.id || asset?.asset_id || null;

  if (organizationId && assetId) {
    const sharedHero = await resolveSharedHeroMediaViaRpc(assetId, organizationId, transform, expiresIn);
    if (sharedHero) return sharedHero;
  }

  if (overridePlacementId) {
    const relationshipHero = await resolvePlacementHeroUri(overridePlacementId, transform, expiresIn);
    if (relationshipHero) return relationshipHero;
  }

  if (placementId) {
    const assetHero = await resolvePlacementHeroUri(placementId, transform, expiresIn);
    if (assetHero) return assetHero;
  }

  return (
    (await resolveBestAssetAttachmentHero(assetId, transform, expiresIn)) ||
    fallback
  );
}

export async function fetchAssetHeroUris(assetIds, { transform, expiresIn, organizationId } = {}) {
  const options = { transform, expiresIn };
  const ids = Array.from(new Set((assetIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const hasRelationshipContext = Boolean(organizationId);
  const cached = hasRelationshipContext ? {} : getCachedAssetHeroUris(ids, options);
  let missingIds = ids.filter((assetId) => !cached[assetId]);
  if (!missingIds.length) return cached;

  if (hasRelationshipContext) {
    const relationshipEntries = await Promise.all(
      missingIds.map(async (assetId) => [
        assetId,
        await resolveSharedHeroMediaViaRpc(assetId, organizationId, transform, expiresIn),
      ])
    );
    const relationshipResolved = Object.fromEntries(
      relationshipEntries.filter(([, uri]) => Boolean(uri))
    );
    missingIds = missingIds.filter((assetId) => !relationshipResolved[assetId]);
    if (!missingIds.length) return { ...cached, ...relationshipResolved };
    Object.assign(cached, relationshipResolved);
  }

  const { data, error } = await supabase
    .from("assets")
    .select("id,hero_placement_id,hero_image_url,hero_thumb_url")
    .in("id", missingIds);

  if (error) {
    console.warn("Could not load asset hero rows:", error.message);
    return cached;
  }

  const relationshipHeroPlacementIds = hasRelationshipContext
    ? await fetchRelationshipHeroPlacementIds(missingIds, organizationId)
    : {};

  const entries = await Promise.all(
    (data || []).map(async (asset) => [
      asset.id,
      await resolveAssetHeroUri(asset, {
        ...options,
        relationshipHeroPlacementId: relationshipHeroPlacementIds[asset.id] || null,
      }),
    ])
  );

  const resolved = Object.fromEntries(entries.filter(([, uri]) => Boolean(uri)));
  if (!hasRelationshipContext) {
    Object.entries(resolved).forEach(([assetId, uri]) => {
      writeCachedAssetHeroUri(assetId, uri, options);
    });
  }

  return { ...cached, ...resolved };
}
