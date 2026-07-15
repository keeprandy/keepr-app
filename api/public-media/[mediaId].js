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
  if (!supabaseUrl) {
    return res.status(503).json({ error: "media_unavailable" });
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/public-story-media?media_id=${encodeURIComponent(mediaId)}`
    );

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? "media_not_found" : "media_fetch_failed",
      });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", safeCacheHeaders(contentType)["Cache-Control"]);
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
