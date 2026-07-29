import { createClient } from "@supabase/supabase-js";
import {
  buildOgHtml,
  canonicalUrl,
  getRequestBaseUrl,
  safeString,
} from "../_shared.js";

function inviteTitle(displayName) {
  const name = safeString(displayName);
  return name ? `${name} invited you to become a Keepr` : "A Keepr member invited you";
}

export default async function handler(req, res) {
  const baseUrl = getRequestBaseUrl(req);
  const rawSlug = req.query?.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const invitePath = `/invite/${encodeURIComponent(slug || "")}`;
  const shareUrl = canonicalUrl(invitePath);
  const memberCardImage = `${baseUrl}/og/invite/${encodeURIComponent(slug || "")}.png`;

  let title = "Join Keepr";
  let description = "Organize, protect, and operate everything you own.";
  let image = memberCardImage;

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

      title = inviteTitle(row?.display_name) || row?.title || title;
      description = "Organize, protect, and operate everything you own.";
      image = memberCardImage;
    }
  } catch (_) {
    title = "Join Keepr";
    description = "Organize, protect, and operate everything you own.";
    image = memberCardImage;
  }

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
