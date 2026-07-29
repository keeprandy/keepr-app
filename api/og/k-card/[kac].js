import {
  buildKeeprCardElement,
  getRequestBaseUrl,
  getSupabaseClient,
  sendImageResponse,
  toPublicMediaOgUrl,
} from "../_shared.js";

function assetTitle(row) {
  return (
    row?.name ||
    `${row?.year || ""} ${row?.make || ""} ${row?.model || ""}`.trim() ||
    "Keepr Story"
  );
}

export default async function handler(req, res) {
  const baseUrl = getRequestBaseUrl(req);
  const rawKac = req.query?.kac;
  const kac = Array.isArray(rawKac) ? rawKac[0] : rawKac;
  let title = "Keepr Story";
  let description = "Owner-curated Keepr Story.";
  let imageUrl = null;

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = getSupabaseClient();

    if (kac && SUPABASE_URL && SUPABASE_ANON_KEY && supabase) {
      const { data: summaryRow } = await supabase
        .from("public_asset_story_summary")
        .select("*")
        .eq("kac_id", kac)
        .maybeSingle();

      if (summaryRow) {
        title = assetTitle(summaryRow);

        const mediaRes = await fetch(`${SUPABASE_URL}/functions/v1/public-story-media`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ kac }),
        });

        const mediaJson = await mediaRes.json().catch(() => ({}));
        const mediaRows = Array.isArray(mediaJson?.media) ? mediaJson.media : [];
        const heroPlacement =
          mediaRows.find(
            (row) =>
              String(row.public_media_id || row.placement_id) ===
              String(summaryRow.hero_placement_id)
          ) ||
          mediaRows.find((row) => row.role === "hero") ||
          mediaRows.find((row) => !!row.image_url) ||
          null;

        imageUrl = toPublicMediaOgUrl(baseUrl, heroPlacement);
      }
    }
  } catch (_) {
    imageUrl = null;
  }

  return sendImageResponse(
    res,
    buildKeeprCardElement({
      eyebrow: "Keepr Enabled",
      title,
      description,
      imageUrl,
      imageFit: "cover",
      badge: "Open Story",
    })
  );
}
