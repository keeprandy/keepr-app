import { getSignedUrl } from "./attachmentsApi";

export const MEDIA_VARIANTS = {
  AVATAR: "avatar",
  GALLERY_TILE: "gallery_tile",
  DETAIL: "detail",
  ORIGINAL: "original",
};

export const MEDIA_TRANSFORMS = {
  [MEDIA_VARIANTS.AVATAR]: { width: 96, height: 96, resize: "cover", quality: 75 },
  [MEDIA_VARIANTS.GALLERY_TILE]: { width: 960, height: 720, resize: "cover", quality: 86 },
  [MEDIA_VARIANTS.DETAIL]: { width: 1400, height: 1050, resize: "contain", quality: 82 },
};

export function isImageAttachment(attachment = {}) {
  const mime = String(attachment.mime_type || attachment.mimeType || "").toLowerCase();
  const name = String(attachment.file_name || attachment.fileName || attachment.storage_path || "").toLowerCase();
  return mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic|heif)$/.test(name);
}

export async function getAttachmentVariantUrl(attachment = {}, variant = MEDIA_VARIANTS.GALLERY_TILE, options = {}) {
  if (!attachment) return null;
  const directUrl =
    attachment.thumbnail_url ||
    attachment.thumbnailUrl ||
    attachment.public_url ||
    attachment.publicUrl ||
    attachment.url ||
    null;

  if (variant === MEDIA_VARIANTS.ORIGINAL) {
    if (attachment.bucket && attachment.storage_path) {
      return getSignedUrl({
        bucket: attachment.bucket,
        path: attachment.storage_path,
        expiresIn: options.expiresIn || 60 * 30,
      });
    }
    return directUrl;
  }

  if (attachment.bucket && attachment.storage_path && isImageAttachment(attachment)) {
    return getSignedUrl({
      bucket: attachment.bucket,
      path: attachment.storage_path,
      expiresIn: options.expiresIn || 60 * 60,
      transform: MEDIA_TRANSFORMS[variant] || MEDIA_TRANSFORMS[MEDIA_VARIANTS.GALLERY_TILE],
    });
  }

  return directUrl;
}
