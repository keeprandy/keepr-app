// lib/inviteLinks.js

export function getKeeprBaseUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeKeeprBaseUrl(window.location.origin);
  }

  return normalizeKeeprBaseUrl(
    process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
    "https://app.keeprhome.com"
  );
}

export function normalizeKeeprBaseUrl(value) {
  const raw = String(value || "").trim();
  const withoutWhitespace = raw.replace(/\s+/g, "");
  const withoutTrailingSlash = withoutWhitespace.replace(/\/+$/, "");
  return withoutTrailingSlash || "https://app.keeprhome.com";
}

function cleanPathSegment(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

export function buildUserInviteUrl({ sourceSlug }) {
  const base = getKeeprBaseUrl();
  return `${base}/invite/${encodeURIComponent(cleanPathSegment(sourceSlug))}`;
}

export function buildUserInviteUrlWithChannel({ sourceSlug, channel }) {
  const url = buildUserInviteUrl({ sourceSlug });
  const normalizedChannel = String(channel || "").trim().toLowerCase();
  if (!normalizedChannel) return url;

  const params = new URLSearchParams({
    utm_source: normalizedChannel,
    utm_medium: "member_invite",
  });

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${params.toString()}`;
}

export function buildShortShareUrl({ token }) {
  const base = getKeeprBaseUrl();
  return `${base}/s/${encodeURIComponent(cleanPathSegment(token))}`;
}

export function buildHubShareUrl({ hubSlug, source = "hub_share" }) {
  const base = getKeeprBaseUrl();
  const cleanHubSlug = cleanPathSegment(hubSlug);
  return `${base}/h/${encodeURIComponent(cleanHubSlug)}?src=${encodeURIComponent(
    source
  )}&hub=${encodeURIComponent(cleanHubSlug)}`;
}

export function buildHubInviteUrl({
  hubSlug,
  inviteToken,
  inviterSlug,
  campaign = "hub_invite",
}) {
  const base = getKeeprBaseUrl();
  const cleanHubSlug = cleanPathSegment(hubSlug);
  const cleanInviteToken = cleanPathSegment(inviteToken);

  const params = new URLSearchParams({
    src: "hub_invite",
    hub: cleanHubSlug,
    invite: cleanInviteToken,
    campaign,
  });

  if (inviterSlug) {
    params.set("ref", inviterSlug);
  }

  return `${base}/h/${encodeURIComponent(cleanHubSlug)}?${params.toString()}`;
}
