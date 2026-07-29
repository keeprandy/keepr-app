import {
  buildOgHtml,
  canonicalUrl,
  getRequestBaseUrl,
  getSupabaseClient,
  requestAbsoluteUrl,
  safeString,
} from "../_shared.js";

async function resolveHub(slug) {
  const supabase = getSupabaseClient();
  if (!supabase || !slug) return null;
  const { data } = await supabase
    .from("hubs")
    .select("id, name, slug, description, visibility")
    .eq("slug", slug)
    .maybeSingle();
  if (data?.visibility && data.visibility !== "public") return null;
  return data || null;
}

export default async function handler(req, res) {
  const rawSlug = req.query?.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const hubPath = `/h/${encodeURIComponent(slug || "")}`;
  const image = requestAbsoluteUrl(req, `/og/h/${encodeURIComponent(slug || "")}.png`);

  let title = "Keepr Hub";
  let description = "A public Keepr Hub of owner-curated stories.";

  try {
    const hub = await resolveHub(slug);
    if (hub) {
      title = safeString(hub.name) || title;
      description =
        safeString(hub.description) || "A public Keepr Hub of owner-curated stories.";
    }
  } catch (_) {
    title = "Keepr Hub";
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.status(200).send(
    buildOgHtml({
      title,
      description,
      url: canonicalUrl(hubPath),
      image,
    })
  );
}
