import { Platform } from "react-native";
import { supabase } from "./supabaseClient";

const inFlight = new Map();

function safeStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeYoutubeVideoId(value) {
  const id = safeStr(value);
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
}

function youtubeVideoId(rawUrl) {
  try {
    const url = new URL(safeStr(rawUrl));
    const host = url.hostname.replace(/^(www\.|m\.)/, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") return normalizeYoutubeVideoId(parts[0]);
    if (!host.endsWith("youtube.com")) return "";
    if (url.pathname === "/watch") return normalizeYoutubeVideoId(url.searchParams.get("v"));
    if (parts[0] === "shorts") return normalizeYoutubeVideoId(parts[1]);
    if (parts[0] === "embed") return normalizeYoutubeVideoId(parts[1]);
  } catch {
    return "";
  }
  return "";
}

function youtubeCoverFromUrl(rawUrl) {
  const id = youtubeVideoId(rawUrl);
  if (!id) return null;
  return {
    display_title: "YouTube video",
    display_description: "",
    preview_image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    favicon_url: "https://www.youtube.com/s/desktop/f506bd45/img/favicon_144x144.png",
    source_name: "YouTube",
    source_domain: "youtube.com",
    content_kind: "video",
    canonical_url: `https://www.youtube.com/watch?v=${id}`,
    enrichment_status: "partial",
    enrichment_error: null,
  };
}

function isGenericYoutubeTitle(value) {
  const title = safeStr(value).toLowerCase();
  return !title || title === "youtube.com" || title === "www.youtube.com" || title === "youtu.be";
}

export function linkCoverErrorMessage(error, fallback = "Could not refresh this link preview.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  if (typeof error?.error === "string" && error.error.trim()) return error.error;
  if (typeof error?.details === "string" && error.details.trim()) return error.details;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

export function getLinkCover(attachment) {
  const stored = attachment?.ai_metadata?.link_cover || null;
  const youtube = youtubeCoverFromUrl(attachment?.url);
  if (!youtube) return stored;
  return {
    ...(stored || {}),
    source_name: "YouTube",
    source_domain: "youtube.com",
    content_kind: "video",
    preview_image_url: safeStr(stored?.preview_image_url) || youtube.preview_image_url,
    favicon_url: safeStr(stored?.favicon_url) || youtube.favicon_url,
    canonical_url: youtube.canonical_url,
    display_title: isGenericYoutubeTitle(stored?.display_title)
      ? youtube.display_title
      : safeStr(stored?.display_title) || youtube.display_title,
    display_description: safeStr(stored?.display_description),
    enrichment_status: safeStr(stored?.enrichment_status) || youtube.enrichment_status,
    enrichment_error: stored?.enrichment_error ?? youtube.enrichment_error,
    enriched_at: stored?.enriched_at || null,
  };
}

export function getLinkDomain(url) {
  try {
    return new URL(safeStr(url)).hostname.replace(/^www\./, "");
  } catch {
    return safeStr(url).replace(/^https?:\/\//i, "").split("/")[0] || "Link";
  }
}

function shouldSkip(cover) {
  if (!cover) return false;
  const status = safeStr(cover.enrichment_status).toLowerCase();
  if (status === "complete" || status === "partial") return true;
  if (status === "failed" && cover.enriched_at) {
    const last = new Date(cover.enriched_at).getTime();
    return Number.isFinite(last) && Date.now() - last < 1000 * 60 * 60 * 24 * 7;
  }
  return false;
}

export function shouldEnrichLinkAttachment(attachment) {
  const attachmentId = attachment?.attachment_id || attachment?.id;
  const url = safeStr(attachment?.url);
  if (!attachmentId || !url || attachment?.kind !== "link") return false;
  const stored = attachment?.ai_metadata?.link_cover || null;
  const youtube = youtubeCoverFromUrl(url);
  if (youtube) {
    const hasYoutubeIdentity =
      safeStr(stored?.source_name).toLowerCase() === "youtube" &&
      safeStr(stored?.content_kind).toLowerCase() === "video" &&
      !!safeStr(stored?.preview_image_url);
    if (!hasYoutubeIdentity) return true;
  }
  return !shouldSkip(stored);
}

function apiPath(url) {
  return `/api/link-cover?url=${encodeURIComponent(url)}`;
}

async function fetchLinkCover(url) {
  const path = apiPath(url);
  const requestUrl =
    Platform.OS === "web"
      ? path
      : `${safeStr(process.env.EXPO_PUBLIC_KEEPR_BASE_URL) || "https://app.keeprhome.com"}${path}`;
  const response = await fetch(requestUrl, {
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid link metadata response.");
  }
  if (!response.ok) {
    throw new Error(linkCoverErrorMessage(json?.error || json, `Link metadata failed (${response.status}).`));
  }
  return json?.link_cover || null;
}

export async function enrichLinkAttachment(attachment, options = {}) {
  const attachmentId = attachment?.attachment_id || attachment?.id;
  const url = safeStr(attachment?.url);
  if (!attachmentId || !url || attachment?.kind !== "link") return null;

  const existingCover = getLinkCover(attachment);
  if (!options.force && !shouldEnrichLinkAttachment(attachment)) return existingCover;

  const key = `${attachmentId}|${url}|${options.force ? "force" : "auto"}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const cover =
      (await fetchLinkCover(url)) || {
        enrichment_status: "failed",
        enrichment_error: "No metadata returned.",
        enriched_at: new Date().toISOString(),
      };

    const currentMeta = attachment?.ai_metadata && typeof attachment.ai_metadata === "object"
      ? attachment.ai_metadata
      : {};
    const nextMeta = {
      ...currentMeta,
      link_cover: {
        display_title: "",
        display_description: "",
        preview_image_url: "",
        favicon_url: "",
        source_name: "",
        source_domain: getLinkDomain(url),
        content_kind: "webpage",
        canonical_url: url,
        enrichment_status: "failed",
        enrichment_error: null,
        enriched_at: new Date().toISOString(),
        ...cover,
      },
    };

    const { error } = await supabase
      .from("attachments")
      .update({ ai_metadata: nextMeta })
      .eq("id", attachmentId);
    if (error) throw new Error(linkCoverErrorMessage(error));
    return nextMeta.link_cover;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}
