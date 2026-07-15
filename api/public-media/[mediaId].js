const UUIDISH_RE = /^[A-Za-z0-9_-]{8,80}$/;

function getEnv(name) {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function safeCacheHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
  };
}

function cleanContentType(value) {
  const contentType = String(value || "").split(";")[0].trim().toLowerCase();
  if (!contentType || /[\r\n]/.test(contentType)) return "application/octet-stream";
  return contentType;
}

function safeContentDisposition(contentType) {
  if (contentType === "application/pdf") {
    return 'inline; filename="keepr-showcase-document.pdf"';
  }

  if (contentType.startsWith("image/")) {
    return 'inline; filename="keepr-showcase-media"';
  }

  return 'attachment; filename="keepr-showcase-file"';
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

  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "media_unavailable" });
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/public-story-media?media_id=${encodeURIComponent(mediaId)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      }
    );

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? "media_not_found" : "media_fetch_failed",
      });
    }

    const contentType = cleanContentType(upstream.headers.get("content-type"));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", safeCacheHeaders(contentType)["Cache-Control"]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", safeContentDisposition(contentType));

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(body);
  } catch (_error) {
    return res.status(502).json({ error: "media_fetch_failed" });
  }
}
