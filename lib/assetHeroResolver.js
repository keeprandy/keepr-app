import { getSignedUrl } from "./attachmentsApi";
import { supabase } from "./supabaseClient";

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

async function signedAttachmentUrl(attachment, transform) {
  if (!attachment || attachment.deleted_at) return null;
  if (attachment.url) return attachment.url;
  if (!attachment.bucket || !attachment.storage_path) return null;

  try {
    return await getSignedUrl({
      bucket: attachment.bucket,
      path: attachment.storage_path,
      expiresIn: 3600,
      transform,
    });
  } catch (err) {
    if (transform) {
      try {
        return await getSignedUrl({
          bucket: attachment.bucket,
          path: attachment.storage_path,
          expiresIn: 3600,
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

export async function resolveAssetHeroUri(asset, { transform } = {}) {
  const placementId = asset?.hero_placement_id || null;
  const fallback = fallbackHeroUrl(asset);

  if (!placementId) return fallback;

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      "id,attachment:attachments(id,bucket,storage_path,url,mime_type,kind,deleted_at,title,file_name)"
    )
    .eq("id", placementId)
    .maybeSingle();

  if (error) {
    console.warn("Could not resolve asset hero placement:", error.message);
    return fallback;
  }

  return (await signedAttachmentUrl(data?.attachment, transform)) || fallback;
}

export async function fetchAssetHeroUris(assetIds, { transform } = {}) {
  const ids = Array.from(new Set((assetIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const { data, error } = await supabase
    .from("assets")
    .select("id,hero_placement_id,hero_image_url,hero_thumb_url")
    .in("id", ids);

  if (error) {
    console.warn("Could not load asset hero rows:", error.message);
    return {};
  }

  const entries = await Promise.all(
    (data || []).map(async (asset) => [
      asset.id,
      await resolveAssetHeroUri(asset, { transform }),
    ])
  );

  return Object.fromEntries(entries.filter(([, uri]) => Boolean(uri)));
}
