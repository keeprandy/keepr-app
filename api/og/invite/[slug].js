import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

function esc(value) {
  return String(value ?? "")
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
  const tags = `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />
  `;

  if (!indexPath) {
    return `<!doctype html><html><head>${tags}</head><body><a href="${u}">Open Keepr</a></body></html>`;
  }

  return fs.readFileSync(indexPath, "utf8").replace("</head>", `${tags}</head>`);
}

export default async function handler(req, res) {
  const baseUrl = getBaseUrl(req);
  const rawSlug = req.query?.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const shareUrl = `${baseUrl}/invite/${encodeURIComponent(slug || "")}`;
  const fallbackOgImage = `${baseUrl}/og/keepr-og-default.png`;

  let title = "Join Keepr";
  let description = "Start building the story of what you own.";
  let image = fallbackOgImage;

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    if (slug && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });

      const { data } = await supabase.rpc("resolve_member_invite_link", {
        p_slug: slug,
      });
      const row = Array.isArray(data) ? data[0] : data;

      title = row?.title || title;
      description = row?.description || description;
      image = row?.image_url || image;
    }
  } catch (_) {
    title = "Join Keepr";
    description = "Start building the story of what you own.";
    image = fallbackOgImage;
  }

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
