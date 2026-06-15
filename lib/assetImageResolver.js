function preferPublicUrl(...urls) {
  const clean = urls.filter(Boolean);

  return (
    clean.find((u) => String(u).includes("/object/public/")) ||
    clean.find((u) => !String(u).includes("/object/sign/")) ||
    clean[0] ||
    null
  );
}

export function pickAssetHeroUri(asset) {
  const md =
    asset?.extra_metadata && typeof asset.extra_metadata === "object"
      ? asset.extra_metadata
      : {};

  return preferPublicUrl(
    asset?.primary_attachment_url,
    asset?.public_hero_url,
    asset?.story_hero_url,
    asset?.showcase_image_url,
    asset?.hero_thumb_url,
    asset?.hero_image_url,
    asset?.cover_image_url,
    asset?.image_url,
    md.public_hero_url,
    md.story_hero_url,
    md.showcase_image_url,
    md.hero_url,
    md.primary_photo_url,
    md.cover_image_url,
    md.image_url
  );
}