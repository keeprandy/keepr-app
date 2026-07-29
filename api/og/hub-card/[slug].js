import {
  buildKeeprCardElement,
  getSupabaseClient,
  safeString,
  sendImageResponse,
} from "../_shared.js";

async function resolveHub(slug) {
  const supabase = getSupabaseClient();
  if (!supabase || !slug) return null;
  const { data } = await supabase
    .from("hubs")
    .select("id, name, slug, description, visibility, hero_image_url")
    .eq("slug", slug)
    .maybeSingle();
  if (data?.visibility && data.visibility !== "public") return null;
  return data || null;
}

export default async function handler(req, res) {
  const rawSlug = req.query?.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;

  let title = "Keepr Hub";
  let description = "A public Keepr Hub of owner-curated stories.";
  let imageUrl = null;

  try {
    const hub = await resolveHub(slug);
    if (hub) {
      title = safeString(hub.name) || title;
      description =
        safeString(hub.description) || "A public Keepr Hub of owner-curated stories.";
      imageUrl = safeString(hub.hero_image_url) || null;
    }
  } catch (_) {
    imageUrl = null;
  }

  return sendImageResponse(
    res,
    buildKeeprCardElement({
      eyebrow: "Keepr Hub",
      title,
      description,
      imageUrl,
      imageFit: "cover",
      badge: "Open Hub",
      footer: "A shared place for public Keepr Stories and documented ownership.",
    })
  );
}
