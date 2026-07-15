import { createClient } from "@supabase/supabase-js";

const UUIDISH_RE = /^[A-Za-z0-9_-]{8,80}$/;
const IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getEnv(name) {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function createSupabaseClient() {
  const url = getEnv("SUPABASE_URL") || getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRole) return null;

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getContentType(row, upstreamType) {
  const fromUpstream = String(upstreamType || "").split(";")[0].toLowerCase();
  if (IMAGE_CONTENT_TYPES.has(fromUpstream)) return fromUpstream;

  const mimeType = String(row?.mime_type || "").split(";")[0].toLowerCase();
  if (IMAGE_CONTENT_TYPES.has(mimeType)) return mimeType;

  return "application/octet-stream";
}

function safeCacheHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const mediaId = String(req.query?.mediaId || "").trim();
  if (!UUIDISH_RE.test(mediaId)) {
    return res.status(400).json({ error: "invalid_media_id" });
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ error: "media_unavailable" });
  }

  try {
    const { data: row, error } = await supabase
      .from("public_asset_story_gallery")
      .select("placement_id,url,bucket,storage_path,mime_type")
      .eq("placement_id", mediaId)
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ error: "media_not_found" });
    }

    let upstreamUrl = typeof row.url === "string" && row.url.trim() ? row.url.trim() : null;

    if (!upstreamUrl && row.bucket && row.storage_path) {
      const { data: signed, error: signError } = await supabase.storage
        .from(row.bucket)
        .createSignedUrl(String(row.storage_path).replace(/^\/+/, ""), 120);

      if (signError || !signed?.signedUrl) {
        return res.status(404).json({ error: "media_not_found" });
      }

      upstreamUrl = signed.signedUrl;
    }

    if (!upstreamUrl) {
      return res.status(404).json({ error: "media_not_found" });
    }

    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      return res.status(502).json({ error: "media_fetch_failed" });
    }

    const contentType = getContentType(row, upstream.headers.get("content-type"));
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      safeCacheHeaders(contentType)["Cache-Control"]
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(body);
  } catch (_error) {
    return res.status(502).json({ error: "media_fetch_failed" });
  }
}
