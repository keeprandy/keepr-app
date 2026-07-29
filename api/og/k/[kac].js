// api/og/k/[kac].js
import {
  buildOgHtml,
  canonicalUrl,
  getRequestBaseUrl,
  getSupabaseClient,
} from "../_shared.js";

export default async function handler(req, res) {
  try {
    const baseUrl = getRequestBaseUrl(req);
    const kac = req.query?.kac;

    // Always fall back to the human URL the user asked for:
    const sharePath = `/k/${encodeURIComponent(kac || "")}`;
    const shareUrl = canonicalUrl(sharePath);

    // Default Keepr-branded OG card fallback
    // (You can point this to any stable image you host in the app repo /public or a CDN)
    const fallbackOgImage = `${baseUrl}/og/k/${encodeURIComponent(kac || "")}.png`;

    let title = "Keepr™";
    let description = "Owner-Curated Keepr Story.";
    let image = fallbackOgImage;

    // If no kac, still respond with sane OG (avoid throwing, to prevent broken previews)
    if (!kac || typeof kac !== "string") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      return res.status(200).send(
        buildOgHtml({
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
    const supabase = getSupabaseClient();

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !supabase) {
      // Don’t fail hard; previews should still work with fallback metadata.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      return res.status(200).send(
        buildOgHtml({
          title,
          description,
          url: shareUrl,
          image,
        })
      );
    }

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
  image = `${baseUrl}/og/k/${encodeURIComponent(kac || "")}.png`;
}
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Cache: ok to cache a little at the edge; keep it short while you iterate.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

    return res.status(200).send(
      buildOgHtml({
        title,
        description,
        url: shareUrl,
        image,
      })
    );
  } catch (e) {
    // Last-resort fallback (never return a blank)
    const kac = req.query?.kac;
    const shareUrl = canonicalUrl(`/k/${encodeURIComponent(kac || "")}`);
    const fallbackOgImage = `${getRequestBaseUrl(req)}/og/k/${encodeURIComponent(kac || "")}.png`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    return res.status(200).send(
      buildOgHtml({
        title: "Keepr™",
        description: "Owner-Curated Keepr Story.",
        url: shareUrl,
        image: fallbackOgImage,
      })
    );
  }
}
