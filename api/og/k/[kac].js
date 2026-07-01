// api/og/k/[kac].js
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

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

  const candidates = [
    path.join(process.cwd(), "dist", "index.html"),
    path.join(process.cwd(), "index.html"),
  ];

  const indexPath = candidates.find((p) => fs.existsSync(p));

  if (!indexPath) {
    return `<!doctype html><html><head>
      <title>${t}</title>
      <meta property="og:title" content="${t}" />
      <meta property="og:description" content="${d}" />
      <meta property="og:url" content="${u}" />
      <meta property="og:image" content="${i}" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${t}" />
      <meta name="twitter:description" content="${d}" />
      <meta name="twitter:image" content="${i}" />
    </head><body><a href="${u}">Open in Keepr</a></body></html>`;
  }

  const appHtml = fs.readFileSync(indexPath, "utf8");

  const tags = `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />
  `;

  return appHtml.replace("</head>", `${tags}</head>`);
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
    let description = "Owner-Curated Keepr Story.";
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

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

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

const { data: summaryRow } = await supabase
  .from("public_asset_story_summary")
  .select("*")
  .eq("kac_id", kac)
  .maybeSingle();

if (summaryRow) {
    const assetName =
      summaryRow.name ||
      `${summaryRow.year || ""} ${summaryRow.make || ""} ${summaryRow.model || ""}`.trim() ||
      "Keepr Story";

  title = assetName;
  description = "Owner-curated Keepr Story.";

  try {
    const mediaRes = await fetch(`${SUPABASE_URL}/functions/v1/public-story-media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ kac }),
    });

    const mediaJson = await mediaRes.json();
    const mediaRows = Array.isArray(mediaJson?.media) ? mediaJson.media : [];

    const heroPlacement =
      mediaRows.find(
        (x) => String(x.placement_id) === String(summaryRow.hero_placement_id)
      ) ||
      mediaRows.find((x) => x.role === "hero") ||
      mediaRows.find((x) => !!x.image_url) ||
      null;

    image = heroPlacement?.image_url || fallbackOgImage;
  } catch (_) {
    image = fallbackOgImage;
  }
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
        description: "Owner-Curated Keepr Story.",
        url: shareUrl,
        image: fallbackOgImage,
      })
    );
  }
}