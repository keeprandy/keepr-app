import dns from "node:dns/promises";
import net from "node:net";

const MAX_HTML_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "private, max-age=0, no-store");
  res.end(JSON.stringify(body));
}

function cleanText(value, max = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function decodeHtml(value) {
  return cleanText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getAttr(tag, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  return tag.match(re)?.[2] || "";
}

function metaContent(html, matcher) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = getAttr(tag, "property").toLowerCase();
    const name = getAttr(tag, "name").toLowerCase();
    if (matcher(property || name)) return decodeHtml(getAttr(tag, "content"));
  }
  return "";
}

function titleContent(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(match?.[1] || "");
}

function firstIcon(html, baseUrl) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const candidates = [];
  for (const tag of links) {
    const rel = getAttr(tag, "rel").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = getAttr(tag, "href");
    if (!href) continue;
    try {
      candidates.push({
        url: new URL(href, baseUrl).toString(),
        score:
          rel.includes("apple-touch-icon") ? 3 :
          rel.includes("shortcut") ? 2 :
          1,
      });
    } catch {
      // keep looking for another usable icon
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.url || "";
}

function isPrivateAddress(address) {
  const ip = String(address || "").toLowerCase();
  const version = net.isIP(ip);
  if (!version) return false;
  if (version === 4) {
    return (
      ip === "0.0.0.0" ||
      ip.startsWith("127.") ||
      ip.startsWith("10.") ||
      ip.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
      ip.startsWith("169.254.")
    );
  }
  return (
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80:") ||
    ip === "::" ||
    ip.startsWith("::ffff:127.") ||
    ip.startsWith("::ffff:10.") ||
    ip.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function isYoutubeHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^(www\.|m\.)/, "");
  return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
}

async function assertPublicHttpUrl(raw) {
  const url = new URL(String(raw || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https links are supported.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    isPrivateAddress(host)
  ) {
    throw new Error("Private or local links cannot be enriched.");
  }

  if (isYoutubeHost(host)) return url;

  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if ((resolved || []).some((entry) => isPrivateAddress(entry?.address))) {
    throw new Error("Private or local links cannot be enriched.");
  }

  return url;
}

function normalizeImage(imageUrl, baseUrl) {
  if (!imageUrl) return "";
  try {
    const url = new URL(imageUrl, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function fallbackCover(rawUrl, error) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad_url");
    const domain = url.hostname.replace(/^www\./, "");
    return {
      display_title: domain || "Saved link",
      display_description: "",
      preview_image_url: "",
      favicon_url: "",
      source_name: domain,
      source_domain: domain,
      content_kind: "webpage",
      canonical_url: url.toString(),
      enrichment_status: "failed",
      enrichment_error: cleanText(error?.message || "Unable to enrich link.", 180),
      enriched_at: new Date().toISOString(),
    };
  } catch {
    return {
      display_title: "",
      display_description: "",
      preview_image_url: "",
      favicon_url: "",
      source_name: "",
      source_domain: "",
      content_kind: "webpage",
      canonical_url: "",
      enrichment_status: "failed",
      enrichment_error: cleanText(error?.message || "Unable to enrich link.", 180),
      enriched_at: new Date().toISOString(),
    };
  }
}

function normalizeYoutubeVideoId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
}

function youtubeVideoId(url) {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return normalizeYoutubeVideoId(pathParts[0]);
  if (!host.endsWith("youtube.com")) return "";
  if (url.pathname === "/watch") return normalizeYoutubeVideoId(url.searchParams.get("v"));
  if (pathParts[0] === "shorts") return normalizeYoutubeVideoId(pathParts[1]);
  if (pathParts[0] === "embed") return normalizeYoutubeVideoId(pathParts[1]);
  return "";
}

function youtubeSourceCover(url) {
  const id = youtubeVideoId(url);
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
    enriched_at: new Date().toISOString(),
  };
}

async function youtubeOembed(url) {
  const id = youtubeVideoId(url);
  if (!id) return null;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "user-agent": "KeeprLinkPreview/1.0",
        accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      title: cleanText(data?.title, 120),
      sourceName: cleanText(data?.provider_name || "YouTube", 80),
      image: normalizeImage(data?.thumbnail_url, url),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLimited(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "KeeprLinkPreview/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`Metadata request failed with ${response.status}.`);
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Link did not return an HTML page.");
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      return text.slice(0, MAX_HTML_BYTES);
    }

    const chunks = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
    }
    try {
      await reader.cancel();
    } catch {
      // best effort
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const rawUrl = req.method === "GET" ? req.query?.url : req.body?.url;
    const url = await assertPublicHttpUrl(rawUrl);
    const recognizedCover = youtubeSourceCover(url);
    const recognizedMeta = recognizedCover ? await youtubeOembed(url) : null;

    let html = "";
    try {
      html = await fetchLimited(url.toString());
    } catch (fetchError) {
      if (!recognizedCover) throw fetchError;
      return json(res, 200, {
        ok: true,
        link_cover: {
          ...recognizedCover,
          display_title: recognizedMeta?.title || recognizedCover.display_title,
          preview_image_url: recognizedMeta?.image || recognizedCover.preview_image_url,
          source_name: recognizedMeta?.sourceName || recognizedCover.source_name,
          enrichment_status: recognizedMeta?.title ? "complete" : "partial",
          enriched_at: new Date().toISOString(),
        },
      });
    }

    const ogTitle = metaContent(html, (key) => key === "og:title");
    const twitterTitle = metaContent(html, (key) => key === "twitter:title");
    const title = ogTitle || twitterTitle || titleContent(html);

    const ogDescription = metaContent(html, (key) => key === "og:description");
    const twitterDescription = metaContent(html, (key) => key === "twitter:description");
    const description =
      ogDescription ||
      twitterDescription ||
      metaContent(html, (key) => key === "description");

    const ogImage = metaContent(html, (key) => key === "og:image" || key === "og:image:url");
    const twitterImage = metaContent(html, (key) => key === "twitter:image");
    const canonical = (() => {
      const links = html.match(/<link\b[^>]*>/gi) || [];
      for (const tag of links) {
        if (getAttr(tag, "rel").toLowerCase() === "canonical") {
          const href = getAttr(tag, "href");
          if (href) {
            try {
              return new URL(href, url).toString();
            } catch {
              return "";
            }
          }
        }
      }
      return "";
    })();

    const previewImage =
      normalizeImage(ogImage || twitterImage, url) ||
      recognizedMeta?.image ||
      recognizedCover?.preview_image_url ||
      "";
    const faviconUrl = normalizeImage(firstIcon(html, url) || "/favicon.ico", url);
    const sourceName =
      recognizedCover?.source_name ||
      metaContent(html, (key) => key === "og:site_name") ||
      recognizedMeta?.sourceName ||
      url.hostname.replace(/^www\./, "");

    return json(res, 200, {
      ok: true,
      link_cover: {
        display_title: cleanText(title || recognizedMeta?.title || recognizedCover?.display_title || url.hostname.replace(/^www\./, ""), 120),
        display_description: cleanText(description, 220),
        preview_image_url: previewImage,
        favicon_url: recognizedCover?.favicon_url || faviconUrl,
        source_name: cleanText(sourceName, 80),
        source_domain: recognizedCover?.source_domain || url.hostname.replace(/^www\./, ""),
        content_kind: recognizedCover?.content_kind || "webpage",
        canonical_url: recognizedCover?.canonical_url || canonical || url.toString(),
        enrichment_status: previewImage || faviconUrl || title || description ? "complete" : "partial",
        enrichment_error: null,
        enriched_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return json(res, 200, {
      ok: false,
      link_cover: fallbackCover(req.method === "GET" ? req.query?.url : req.body?.url, error),
    });
  }
}
