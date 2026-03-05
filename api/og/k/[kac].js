// api/og/k/[kac].js
import { createClient } from "@supabase/supabase-js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function buildHtml({ title, description, url, image }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  const i = esc(image);

  // IMPORTANT:
  // - We return HTML (not redirect) so link preview bots can read OG tags.
  // - For humans, we still “land” at /k/:kac (the requested URL).
  //   You can optionally add a JS redirect to an internal route, but KEEP it same URL if possible.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${t}</title>
  <meta name="description" content="${d}" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${u}" />
  <meta property="og:image" content="${i}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${i}" />

  <!-- Optional: quick human fallback if something blocks JS -->
  <meta http-equiv="refresh" content="0; url=${u}" />
</head>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px;">
  <h1 style="margin: 0 0 8px 0;">${t}</h1>
  <p style="margin: 0 0 16px 0; color: #4b5563;">${d}</p>
  <p style="margin: 0;">
    <a href="${u}">Open in Keepr</a>
  </p>
</body>
</html>`;
}

export default async function handler(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const kac = req.query?.kac;

    // Always fall back to the human URL the user asked for:
    const shareUrl = `${baseUrl}/k/${encodeURIComponent(kac || "")}`;

    // Default Keepr-branded OG card fallback
    // (You can point this to any stable image you host in the app repo /public or a CDN)
    const fallbackOgImage = `${baseUrl}/og/keepr-og-default.png`;

    let title = "Keepr™";
    let description = "The living story of what you own — with proof.";
    let image = fallbackOgImage;

    // If no kac, still respond with sane OG (avoid throwing, to prevent broken previews)
    if (!kac || typeof kac !== "string") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      return res.status(200).send(
        buildHtml({
          title,
          description,
          url: shareUrl,
          image,
        })
      );
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      // Don’t fail hard; previews should still work with fallback metadata.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      return res.status(200).send(
        buildHtml({
          title,
          description,
          url: shareUrl,
          image,
        })
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    // --- Resolve KAC -> something meaningful ---
    // We try RPC first (if you have it), then fall back to common tables/columns.
    let resolved = null;

    // 1) Try RPC if it exists: "kac_resolve"
    try {
      const { data, error } = await supabase.rpc("kac_resolve", { p_kac: kac });
      if (!error && data) resolved = data;
    } catch (e) {
      // ignore
    }

    // 2) Fallback: try assets table with common columns
    if (!resolved) {
      // Adjust these column names if yours differ.
      const { data } = await supabase
        .from("assets")
        .select("id, name, display_name, title, hero_photo_url, photo_url, share_image_url")
        .or(`kac.eq.${kac},kac_code.eq.${kac},public_kac.eq.${kac}`)
        .limit(1)
        .maybeSingle();

      if (data) resolved = { asset: data };
    }

    const asset = resolved?.asset || resolved?.data?.asset || resolved?.asset_record || null;

    if (asset) {
      const assetName = pickFirst(asset.display_name, asset.name, asset.title) || "Keepr Asset";
      title = `${assetName} • Keepr™`;

      description =
        "Owner-controlled record of care — documents, proof, and history in one place.";

      // Pick the best image you have
      image =
        pickFirst(asset.share_image_url, asset.hero_photo_url, asset.photo_url) ||
        fallbackOgImage;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Cache: ok to cache a little at the edge; keep it short while you iterate.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

    return res.status(200).send(
      buildHtml({
        title,
        description,
        url: shareUrl,
        image,
      })
    );
  } catch (e) {
    // Last-resort fallback (never return a blank)
    const baseUrl = getBaseUrl(req);
    const kac = req.query?.kac;
    const shareUrl = `${baseUrl}/k/${encodeURIComponent(kac || "")}`;
    const fallbackOgImage = `${baseUrl}/og/keepr-og-default.png`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    return res.status(200).send(
      buildHtml({
        title: "Keepr™",
        description: "The living story of what you own — with proof.",
        url: shareUrl,
        image: fallbackOgImage,
      })
    );
  }
}