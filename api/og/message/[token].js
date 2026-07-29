import crypto from "crypto";
import {
  buildDescription,
  buildOgHtml,
  canonicalUrl,
  getRequestBaseUrl,
  getSupabaseClient,
  safeString,
} from "../_shared.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function previewText(value, max = 140) {
  const text = safeString(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

async function loadPreview(token) {
  const supabase = getSupabaseClient({ service: true });
  if (!supabase || !token) return null;

  const { data: tokenRow } = await supabase
    .from("public_asset_thread_tokens")
    .select("thread_id, sender_name, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!tokenRow?.thread_id || tokenRow.revoked_at) return null;
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) return null;

  const { data: thread } = await supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, created_by, subject, resource_ref")
    .eq("id", tokenRow.thread_id)
    .maybeSingle();
  if (!thread?.id) return null;

  const [{ data: asset }, { data: system }, { data: firstMessages }, { data: profile }] =
    await Promise.all([
      supabase.from("assets").select("id, name, kac_id").eq("id", thread.asset_id).maybeSingle(),
      thread.system_id
        ? supabase.from("systems").select("id, name").eq("id", thread.system_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("asset_thread_messages")
        .select("body")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true })
        .limit(1),
      thread.created_by
        ? supabase.from("profiles").select("display_name, full_name").eq("id", thread.created_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const senderName =
    safeString(profile?.display_name || profile?.full_name) ||
    safeString(tokenRow.sender_name) ||
    "A Keepr member";
  const subjectName = safeString(system?.name) || safeString(asset?.name) || "Keepr";
  return {
    title: `${senderName} sent you a Keepr message`,
    description: buildDescription([
      `About ${subjectName}${system?.name && asset?.name ? ` on ${asset.name}` : ""}.`,
      previewText(firstMessages?.[0]?.body),
    ]),
  };
}

export default async function handler(req, res) {
  const rawToken = req.query?.token;
  const token = safeString(Array.isArray(rawToken) ? rawToken[0] : rawToken);
  const path = `/m/${encodeURIComponent(token || "")}`;
  const url = canonicalUrl(path);
  const image = `${getRequestBaseUrl(req)}/og/message/${encodeURIComponent(token || "")}.png`;

  let preview = null;
  try {
    preview = await loadPreview(token);
  } catch (_) {
    preview = null;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=120");
  return res.status(200).send(
    buildOgHtml({
      title: preview?.title || "Keepr message",
      description: preview?.description || "Continue the conversation in Keepr.",
      url,
      image,
    })
  );
}
