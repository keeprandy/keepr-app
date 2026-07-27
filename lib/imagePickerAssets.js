import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

export function isHeicImageAsset(asset = {}) {
  const mime = String(asset.mimeType || asset.type || "").toLowerCase();
  const name = String(asset.fileName || asset.name || asset.uri || "").toLowerCase();
  return mime.includes("heic") || mime.includes("heif") || /\.(heic|heif)(?:$|\?)/i.test(name);
}

export function normalizePickedImageAsset(asset = {}, fallbackName = "photo.jpg") {
  if (!asset?.uri) return null;

  const fileName = asset.fileName || asset.name || asset.uri.split("/").pop() || fallbackName;
  const mimeType = asset.mimeType || asset.type || null;

  return {
    ...asset,
    uri: asset.uri,
    fileName,
    mimeType: mimeType || "image/jpeg",
    fileSize: asset.fileSize || asset.size || null,
  };
}

export async function normalizeImageAssetForUpload(asset = {}, fallbackName = "photo.jpg") {
  const normalized = normalizePickedImageAsset(asset, fallbackName);
  if (!normalized?.uri) return null;

  if (Platform.OS !== "web" && isHeicImageAsset(normalized)) {
    const converted = await ImageManipulator.manipulateAsync(
      normalized.uri,
      [],
      {
        compress: 0.88,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    const baseName = String(normalized.fileName || fallbackName)
      .replace(/\.(heic|heif)$/i, "")
      .replace(/\.[^.]+$/i, "");

    return {
      ...normalized,
      uri: converted.uri,
      fileName: `${baseName || "photo"}.jpg`,
      mimeType: "image/jpeg",
      fileSize: converted.size || normalized.fileSize || null,
      width: converted.width || normalized.width || null,
      height: converted.height || normalized.height || null,
      originalFileName: normalized.fileName,
      originalMimeType: normalized.mimeType,
      wasHeicNormalized: true,
    };
  }

  return normalized;
}
