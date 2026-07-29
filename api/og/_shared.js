import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import React from "react";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const CANONICAL_BASE_URL = "https://app.keeprhome.com";
export const DEFAULT_OG_DESCRIPTION =
  "Organize, protect, and operate everything you own.";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function h(type, props, ...children) {
  return React.createElement(type, props, ...children);
}

export function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getRequestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function canonicalUrl(pathname = "/") {
  const pathValue = String(pathname || "/");
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  return `${CANONICAL_BASE_URL}${normalizedPath}`;
}

export function requestAbsoluteUrl(req, pathname = "/") {
  const pathValue = String(pathname || "/");
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  return `${getRequestBaseUrl(req)}${normalizedPath}`;
}

export function getSupabaseClient({ service = false } = {}) {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = service
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(safeString(value));
}

export function buildMetaTags({
  title,
  description,
  url,
  image,
  type = "website",
}) {
  const t = esc(title || "Keepr");
  const d = esc(description || DEFAULT_OG_DESCRIPTION);
  const u = esc(url);
  const i = esc(image);

  return `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="${esc(type)}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta property="og:image:width" content="${OG_WIDTH}" />
    <meta property="og:image:height" content="${OG_HEIGHT}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />
  `;
}

export function buildOgHtml({ title, description, url, image }) {
  const tags = buildMetaTags({ title, description, url, image });
  const candidates = [
    path.join(process.cwd(), "dist", "index.html"),
    path.join(process.cwd(), "index.html"),
  ];
  const indexPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!indexPath) {
    return `<!doctype html><html><head>${tags}</head><body><a href="${esc(
      url
    )}">Open Keepr</a></body></html>`;
  }

  const appHtml = fs.readFileSync(indexPath, "utf8");
  const withoutTitle = appHtml.replace(/<title>[\s\S]*?<\/title>/i, "");
  return withoutTitle.replace("</head>", `${tags}</head>`);
}

export function toPublicMediaOgUrl(baseUrl, row) {
  const publicMediaId = row?.public_media_id || row?.placement_id || null;
  const imageUrl = safeString(row?.image_url);

  if (publicMediaId) {
    return `${baseUrl}/api/public-media/${encodeURIComponent(String(publicMediaId))}`;
  }

  if (imageUrl.startsWith("/api/public-media/")) {
    return `${baseUrl}${imageUrl}`;
  }

  if (isHttpUrl(imageUrl) && imageUrl.includes("/api/public-media/")) {
    return imageUrl;
  }

  if (isHttpUrl(imageUrl)) {
    return imageUrl;
  }

  return null;
}

export function buildDescription(parts, fallback = DEFAULT_OG_DESCRIPTION) {
  const clean = (parts || []).map(safeString).filter(Boolean);
  return clean.length ? clean.join(" ") : fallback;
}

export function buildKeeprCardElement({
  eyebrow = "Keepr Asset",
  title = "Keepr",
  description = DEFAULT_OG_DESCRIPTION,
  imageUrl = null,
  imageFit = "cover",
  imageLabel = "Documented ownership continuity",
  badge = "Keepr",
  footer = "A trusted place for the records, proof, and stories behind what you own.",
}) {
  const hasImage = isHttpUrl(imageUrl);

  return h(
    "div",
    {
      style: {
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#EAF1FF",
        fontFamily: "Arial",
        color: "#0F172A",
      },
    },
    h(
      "div",
      {
        style: {
          width: "1136px",
          height: "566px",
          display: "flex",
          flexDirection: "row",
          gap: "44px",
          padding: "34px",
          borderRadius: "42px",
          background: "linear-gradient(135deg, #FFFFFF 0%, #F4F7FF 100%)",
          border: "1px solid rgba(37, 99, 235, 0.14)",
          boxShadow: "0 24px 72px rgba(15, 23, 42, 0.16)",
        },
      },
      h(
        "div",
        {
          style: {
            width: "486px",
            height: "498px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "32px",
            overflow: "hidden",
            background: "#DCE8FF",
            border: "10px solid rgba(255, 255, 255, 0.82)",
          },
        },
        hasImage
          ? h("img", {
              src: imageUrl,
              width: 486,
              height: 498,
              style: {
                width: "486px",
                height: "498px",
                objectFit: imageFit,
              },
            })
          : h(
              "div",
              {
                style: {
                  width: "360px",
                  height: "360px",
                  borderRadius: "180px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(135deg, #FFFFFF 0%, #BFD6FF 100%)",
                  border: "8px solid rgba(37, 99, 235, 0.28)",
                  color: "#2563EB",
                  fontSize: "104px",
                  fontWeight: 900,
                },
              },
              "K"
            )
      ),
      h(
        "div",
        {
          style: {
            width: "538px",
            height: "498px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "26px",
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                color: "#2563EB",
                fontSize: "26px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0px",
              },
            },
            eyebrow
          ),
          h(
            "div",
            {
              style: {
                width: "84px",
                height: "84px",
                borderRadius: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(37, 99, 235, 0.12)",
                color: "#2563EB",
                fontSize: "38px",
                fontWeight: 900,
              },
            },
            "K"
          )
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#0F172A",
              fontSize: "58px",
              fontWeight: 900,
              lineHeight: "1.02",
              marginBottom: "26px",
            },
          },
          title
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#334155",
              fontSize: "30px",
              fontWeight: 650,
              lineHeight: "1.22",
              marginBottom: "28px",
            },
          },
          description
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#64748B",
              fontSize: "23px",
              fontWeight: 520,
              lineHeight: "1.28",
              marginBottom: "34px",
            },
          },
          footer
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "16px",
            },
          },
          h(
            "div",
            {
              style: {
                height: "58px",
                padding: "0 28px",
                borderRadius: "29px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFFFF",
                background: "#2563EB",
                fontSize: "22px",
                fontWeight: 850,
              },
            },
            badge
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                color: "#64748B",
                fontSize: "20px",
                fontWeight: 700,
              },
            },
            imageLabel
          )
        )
      )
    )
  );
}

export async function sendImageResponse(res, element) {
  const { ImageResponse } = await import("@vercel/og");
  const imageResponse = new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
  });
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.status(200).send(buffer);
}
