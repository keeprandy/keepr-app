// lib/inviteLinks.js

export function getKeeprBaseUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return (
    process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
    "https://app.keeprhome.com"
  );
}

export function buildUserInviteUrl({ sourceSlug }) {
  const base = getKeeprBaseUrl();
  return `${base}/invite/${encodeURIComponent(sourceSlug)}`;
}

export function buildHubShareUrl({ hubSlug, source = "hub_share" }) {
  const base = getKeeprBaseUrl();
  return `${base}/h/${encodeURIComponent(hubSlug)}?src=${encodeURIComponent(
    source
  )}&hub=${encodeURIComponent(hubSlug)}`;
}

export function buildHubInviteUrl({
  hubSlug,
  inviteToken,
  inviterSlug,
  campaign = "hub_invite",
}) {
  const base = getKeeprBaseUrl();

  const params = new URLSearchParams({
    src: "hub_invite",
    hub: hubSlug,
    invite: inviteToken,
    campaign,
  });

  if (inviterSlug) {
    params.set("ref", inviterSlug);
  }

  return `${base}/h/${encodeURIComponent(hubSlug)}?${params.toString()}`;
}