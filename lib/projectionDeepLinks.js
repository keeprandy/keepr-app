const REQUIRED_THREAD_PAYLOAD_KEYS = ["thread_id", "asset_id", "kac"];

function cleanString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function encodePath(value) {
  return encodeURIComponent(String(value));
}

export function buildProjectionThreadNotificationPayload({
  threadId,
  assetId,
  kac,
  messageId = null,
  projectionType = null,
  hubId = null,
} = {}) {
  const normalizedThreadId = cleanString(threadId);
  const normalizedAssetId = cleanString(assetId);
  const normalizedKac = cleanString(kac)?.toUpperCase() || null;

  if (!normalizedThreadId) {
    throw new Error("thread_id is required for message notifications.");
  }

  return {
    thread_id: normalizedThreadId,
    asset_id: normalizedAssetId,
    kac: normalizedKac,
    message_id: cleanString(messageId),
    projection_type: cleanString(projectionType),
    hub_id: cleanString(hubId),
  };
}

export function buildAuthenticatedThreadDeepLink({
  threadId,
  assetId,
  kac,
  messageId = null,
} = {}) {
  const normalizedThreadId = cleanString(threadId);
  if (!normalizedThreadId) {
    throw new Error("thread_id is required for authenticated thread links.");
  }

  const suffix = cleanString(messageId)
    ? `/message/${encodePath(cleanString(messageId))}`
    : "";

  const normalizedAssetId = cleanString(assetId);
  if (normalizedAssetId) {
    return `/asset/${encodePath(normalizedAssetId)}/thread/${encodePath(
      normalizedThreadId
    )}${suffix}`;
  }

  const normalizedKac = cleanString(kac)?.toUpperCase();
  if (normalizedKac) {
    return `/k/${encodePath(normalizedKac)}/thread/${encodePath(
      normalizedThreadId
    )}${suffix}`;
  }

  throw new Error("asset_id or kac is required for authenticated thread links.");
}

export function buildPublicSenderThreadDeepLink({
  publicThreadToken,
  messageId = null,
} = {}) {
  const normalizedToken = cleanString(publicThreadToken);
  if (!normalizedToken) {
    throw new Error("publicThreadToken is required for public sender links.");
  }

  const suffix = cleanString(messageId)
    ? `/message/${encodePath(cleanString(messageId))}`
    : "";

  return `/thread/${encodePath(normalizedToken)}${suffix}`;
}

export function getRequiredThreadNotificationKeys() {
  return [...REQUIRED_THREAD_PAYLOAD_KEYS];
}
