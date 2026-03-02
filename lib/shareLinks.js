// lib/shareLinks.js
export function buildKacLinks(kac) {
  const clean = String(kac || "").trim();
  if (!clean) return null;

  const appLink = `keepr://k/${encodeURIComponent(clean)}`;

  // Choose one canonical domain for “public” links (even if not live yet)
  const webLink = `https://keeprhome.com/k/${encodeURIComponent(clean)}`;

  return { appLink, webLink };
}
