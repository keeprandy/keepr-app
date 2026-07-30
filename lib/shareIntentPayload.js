const HEIC_RE = /\.(heic|heif)(?:$|[?#])/i;
const IMAGE_RE = /\.(jpe?g|png|webp|gif|heic|heif)(?:$|[?#])/i;
const PDF_RE = /\.pdf(?:$|[?#])/i;

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function fileNameFromUri(uri) {
  if (typeof uri !== "string" || !uri) return null;
  const clean = uri.split("?")[0].split("#")[0];
  const last = clean.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}

export function inferSharedFileMimeType(file = {}) {
  const existing = firstText(file.mimeType, file.type, file.mime);
  if (existing) return existing;

  const name = firstText(
    file.fileName,
    file.name,
    file.fileNameWithExtension,
    fileNameFromUri(file.uri || file.path || file.filePath || file.contentUri)
  );
  const uri = firstText(file.uri, file.path, file.filePath, file.contentUri);
  const probe = `${name || ""} ${uri || ""}`;

  if (HEIC_RE.test(probe)) return "image/heic";
  if (/\.jpe?g(?:$|[?#])/i.test(probe)) return "image/jpeg";
  if (/\.png(?:$|[?#])/i.test(probe)) return "image/png";
  if (/\.webp(?:$|[?#])/i.test(probe)) return "image/webp";
  if (/\.gif(?:$|[?#])/i.test(probe)) return "image/gif";
  if (PDF_RE.test(probe)) return "application/pdf";

  return "application/octet-stream";
}

export function isSharedFileImage(file = {}) {
  const mime = String(inferSharedFileMimeType(file) || "").toLowerCase();
  if (mime.startsWith("image/")) return true;

  const name = firstText(
    file.fileName,
    file.name,
    file.fileNameWithExtension,
    fileNameFromUri(file.uri || file.path || file.filePath || file.contentUri)
  );
  const uri = firstText(file.uri, file.path, file.filePath, file.contentUri);
  return IMAGE_RE.test(`${name || ""} ${uri || ""}`);
}

export function normalizeShareIntentPayload(shareIntent) {
  if (!shareIntent) return null;

  const files = Array.isArray(shareIntent.files) ? shareIntent.files : [];
  const file = files[0] || null;
  const url = shareIntent.webUrl || shareIntent.url || null;
  const text = shareIntent.text || null;

  if (!file && !url && !text) return null;

  const normalizedFile = file
    ? {
        ...file,
        mimeType: inferSharedFileMimeType(file),
        fileName:
          file.fileName ||
          file.name ||
          file.fileNameWithExtension ||
          fileNameFromUri(file.uri || file.path || file.filePath || file.contentUri) ||
          null,
      }
    : null;

  return {
    type: normalizedFile ? "file" : url ? "link" : text ? "text" : null,
    file: normalizedFile,
    url,
    text,
    filesCount: files.length || (normalizedFile ? 1 : 0),
    singleItemOnly: files.length > 1,
  };
}
