import { Platform } from "react-native";
import { supabase } from "./supabaseClient";

const inFlight = new Map();

function safeStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getLinkCover(attachment) {
  return attachment?.ai_metadata?.link_cover || null;
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
  return !shouldSkip(getLinkCover(attachment));
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
  if (!response.ok) throw new Error(json?.error || `Link metadata failed (${response.status}).`);
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
    if (error) throw error;
    return nextMeta.link_cover;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}
