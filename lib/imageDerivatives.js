export function pickImageUrl(item, size = "thumb_320") {
  if (!item) return null;

  if (size === "thumb_160" && item.thumb_160_url) return item.thumb_160_url;
  if (size === "thumb_320" && item.thumb_320_url) return item.thumb_320_url;
  if (size === "thumb_640" && item.thumb_640_url) return item.thumb_640_url;

  return item.url || item.hero_thumb_url || item.hero_image_url || null;
}