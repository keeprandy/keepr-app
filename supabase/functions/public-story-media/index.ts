import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif)(?:$|[?#])/i;
const DOCUMENT_EXT_RE = /\.(pdf)(?:$|[?#])/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanContentType(value: unknown) {
  const contentType = safeString(value).split(";")[0].toLowerCase();
  if (!contentType || /[\r\n]/.test(contentType)) return "application/octet-stream";
  return contentType;
}

function safeDisplayText(value: unknown, fallback: string) {
  const text = safeString(value).replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.slice(0, 120);
}

function safeExternalUrl(value: unknown) {
  const url = safeString(value);
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".supabase.co") && parsed.pathname.includes("/storage/v1/object/")) {
      return null;
    }
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function hasProxySource(row: Record<string, unknown>) {
  return Boolean(safeString(row.url) || (safeString(row.bucket) && safeString(row.storage_path)));
}

function rowKind(row: Record<string, unknown>) {
  return safeString(row.kind || row.attachment_kind || row.type).toLowerCase();
}

function rowName(row: Record<string, unknown>) {
  return safeString(row.file_name || row.name || row.title || row.storage_path || row.url).toLowerCase();
}

function isImageLike(row: Record<string, unknown>) {
  const kind = rowKind(row);
  const mime = cleanContentType(row.mime_type || row.content_type);
  const name = rowName(row);

  if (kind === "photo" || kind === "image") return true;
  if (mime.startsWith("image/")) return true;
  return IMAGE_EXT_RE.test(name);
}

function isDocumentLike(row: Record<string, unknown>) {
  const kind = rowKind(row);
  const mime = cleanContentType(row.mime_type || row.content_type);
  const name = rowName(row);

  if (kind === "file" || kind === "document" || kind === "pdf") return true;
  if (mime === "application/pdf") return true;
  return DOCUMENT_EXT_RE.test(name);
}

function isExternalShowcaseLink(row: Record<string, unknown>) {
  const url = safeExternalUrl(row.url);
  if (!url) return false;
  if (isImageLike(row) || isDocumentLike(row)) return false;

  const kind = rowKind(row);
  return kind === "link" || !safeString(row.storage_path);
}

function publicMediaId(row: Record<string, unknown>) {
  const id = safeString(row.public_media_id || row.placement_id || row.id);
  return MEDIA_ID_RE.test(id) ? id : null;
}

function proxyUrl(mediaId: string) {
  return `/api/public-media/${encodeURIComponent(mediaId)}`;
}

function safeMime(row: Record<string, unknown>) {
  const mime = cleanContentType(row.mime_type || row.content_type);
  if (mime.startsWith("image/") || mime === "application/pdf") return mime;
  return mime === "application/octet-stream" ? mime : null;
}

async function signedOrDirectUrl(supabase: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  const directUrl = safeExternalUrl(row.url);
  if (directUrl) return directUrl;

  const bucket = safeString(row.bucket);
  const storagePath = safeString(row.storage_path).replace(/^\/+/, "");
  if (!bucket || !storagePath) return null;

  const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 120);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}

function safeDisposition(contentType: string) {
  if (contentType === "application/pdf") {
    return 'inline; filename="keepr-showcase-document.pdf"';
  }
  if (contentType.startsWith("image/")) {
    return 'inline; filename="keepr-showcase-media"';
  }
  return 'attachment; filename="keepr-showcase-file"';
}

function mediaItem(row: Record<string, unknown>, mediaId: string) {
  return {
    public_media_id: mediaId,
    role: safeString(row.role) || null,
    is_showcase: Boolean(row.is_showcase),
    sort_order: row.sort_order ?? null,
    image_url: proxyUrl(mediaId),
  };
}

function fileItem(row: Record<string, unknown>, mediaId: string) {
  const displayName = safeDisplayText(row.title || row.file_name || row.name, "Showcase document");
  return {
    public_media_id: mediaId,
    id: mediaId,
    name: displayName,
    file_name: displayName,
    title: safeDisplayText(row.title, displayName),
    mime_type: safeMime(row),
    role: safeString(row.role) || null,
    notes: safeString(row.notes) || null,
    url: proxyUrl(mediaId),
    image_url: proxyUrl(mediaId),
  };
}

function linkItem(row: Record<string, unknown>) {
  const url = safeExternalUrl(row.url);
  if (!url) return null;

  return {
    id: publicMediaId(row) || safeDisplayText(row.title || row.url, "showcase-link"),
    title: safeDisplayText(row.title || row.file_name || row.name, "Showcase link"),
    role: safeString(row.role) || null,
    notes: safeString(row.notes) || null,
    url,
  };
}

function pushUnique(target: unknown[], seen: Set<string>, key: string, value: unknown) {
  if (seen.has(key)) return;
  seen.add(key);
  target.push(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (req.method === "GET") {
      const url = new URL(req.url);
      const mediaId = safeString(url.searchParams.get("media_id"));

      if (!MEDIA_ID_RE.test(mediaId)) {
        return jsonResponse({ error: "invalid_media_id" }, 400);
      }

      const { data: row, error } = await supabase
        .from("public_asset_story_gallery")
        .select("*")
        .eq("placement_id", mediaId)
        .maybeSingle();

      if (error || !row) {
        return jsonResponse({ error: "media_not_found" }, 404);
      }

      if (!isImageLike(row) && !isDocumentLike(row)) {
        return jsonResponse({ error: "media_not_found" }, 404);
      }

      const upstreamUrl = await signedOrDirectUrl(supabase, row);
      if (!upstreamUrl) {
        return jsonResponse({ error: "media_not_found" }, 404);
      }

      const upstream = await fetch(upstreamUrl);
      if (!upstream.ok) {
        return jsonResponse({ error: "media_fetch_failed" }, 502);
      }

      const upstreamType = cleanContentType(upstream.headers.get("content-type"));
      const rowType = cleanContentType(row.mime_type || row.content_type);
      const contentType =
        upstreamType.startsWith("image/") || upstreamType === "application/pdf"
          ? upstreamType
          : rowType.startsWith("image/") || rowType === "application/pdf"
          ? rowType
          : "application/octet-stream";

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Content-Disposition": safeDisposition(contentType),
          "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const { kac } = await req.json();
    if (!kac) {
      return jsonResponse({ error: "Missing KAC" }, 400);
    }

    const { data: rows, error } = await supabase
      .from("public_asset_story_gallery")
      .select("*")
      .eq("kac_id", String(kac).trim())
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const media: unknown[] = [];
    const showcaseFiles: unknown[] = [];
    const showcaseLinks: unknown[] = [];
    const seen = new Set<string>();

    for (const row of rows || []) {
      if (isExternalShowcaseLink(row)) {
        const link = linkItem(row);
        if (link) pushUnique(showcaseLinks, seen, `link:${link.url}`, link);
        continue;
      }

      const mediaId = publicMediaId(row);
      if (!mediaId || !hasProxySource(row)) continue;

      if (isImageLike(row)) {
        pushUnique(media, seen, `media:${mediaId}`, mediaItem(row, mediaId));
      } else if (isDocumentLike(row)) {
        pushUnique(showcaseFiles, seen, `file:${mediaId}`, fileItem(row, mediaId));
      }
    }

    return jsonResponse({ media, showcaseFiles, showcaseLinks });
  } catch (_e) {
    return jsonResponse({ error: "Server error" }, 500);
  }
});
