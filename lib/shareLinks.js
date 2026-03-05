// lib/shareLinks.js
export function buildKacLinks(kac) {
  const clean = String(kac || "").trim();
  if (!clean) return null;

  const appLink = `keepr://k/${encodeURIComponent(clean)}`;

  // Choose one canonical domain for “public” links (even if not live yet)
  const base =
  process.env.EXPO_PUBLIC_KEEPR_BASE_URL || "https://app.keeprhome.com";

const webLink = `${base}/k/${encodeURIComponent(clean)}/actions`;

  return { appLink, webLink };
}
