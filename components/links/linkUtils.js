import { Linking, Platform } from "react-native";

/**
 * NOTE: Keep this file dependency-light (no app imports),
 * so it can be used anywhere without circular deps.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIMEO_HOSTS = new Set([
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

function safeLower(s) {
  return typeof s === "string" ? s.toLowerCase() : "";
}

export function normalizeUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return "";

  // If user pastes without scheme, default to https.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("www.")) return `https://${s}`;

  // basic email support
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;

  return `https://${s}`;
}

export function classifyUrl(url) {
  const u = (url || "").trim();
  if (!u) return { kind: "unknown" };

  // Keepr internal link scheme (future)
  if (u.startsWith("kpr://") || u.startsWith("keepr://")) return { kind: "internal" };

  let host = "";
  try {
    host = safeLower(new URL(u).hostname);
  } catch {
    return { kind: "unknown" };
  }

  if (YOUTUBE_HOSTS.has(host)) return { kind: "youtube", host };
  if (VIMEO_HOSTS.has(host)) return { kind: "vimeo", host };

  return { kind: "external", host };
}

export async function openExternalUrl(url) {
  const u = (url || "").trim();
  if (!u) return;

  // Web: prefer window.open to avoid Linking issues in some browsers
  if (Platform.OS === "web") {
    try {
      window.open(u, "_blank", "noopener,noreferrer");
      return;
    } catch {
      // fall through to Linking
    }
  }

  const can = await Linking.canOpenURL(u);
  if (!can) return;
  await Linking.openURL(u);
}

/**
 * Splits a text blob into tokens where URLs become separate tokens.
 * Keeps punctuation around URLs reasonably well.
 */
export function tokenizeWithUrls(text) {
  const s = typeof text === "string" ? text : "";
  if (!s) return [];

  // Simple URL regex for most common cases (http(s), www., mailto, bare domains with TLD).
  const urlRe =
    /((?:https?:\/\/|mailto:|www\.)[^\s<>()]+|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|co|edu|gov|us|info|biz|app|dev|me|tv|ai)(?:\/[^\s<>()]*)?)/g;

  const out = [];
  let lastIndex = 0;

  for (const match of s.matchAll(urlRe)) {
    const idx = match.index ?? 0;
    const rawUrl = match[0];

    if (idx > lastIndex) out.push({ type: "text", value: s.slice(lastIndex, idx) });
    out.push({ type: "url", value: rawUrl });
    lastIndex = idx + rawUrl.length;
  }

  if (lastIndex < s.length) out.push({ type: "text", value: s.slice(lastIndex) });

  return out;
}
