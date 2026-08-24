import { createClient } from "@supabase/supabase-js";

const PRIVATE_PRIVACY_VALUES = new Set(["private", "owner_only", "internal", "confidential"]);

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getEnv(name) {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function getServiceSupabase() {
  const url = getEnv("EXPO_PUBLIC_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeAIContext(value) {
  const raw = safeString(value).toLowerCase();
  if (["primary", "primary_source", "primary source"].includes(raw)) return "primary";
  if (["supporting", "supporting_source", "supporting source"].includes(raw)) return "supporting";
  return "off";
}

function isPrivatePrivacy(value) {
  return PRIVATE_PRIVACY_VALUES.has(safeString(value).toLowerCase());
}

function cleanContentType(value) {
  const contentType = safeString(value).split(";")[0].toLowerCase();
  if (!contentType || /[\r\n]/.test(contentType)) return "application/octet-stream";
  return contentType;
}

function safeFileName(value, fallback = "keepr-source-document.pdf") {
  const name = safeString(value || fallback)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160);
  return name || fallback;
}

async function streamPublicMedia({ placementId, fallbackFileName, req, res }) {
  const supabaseUrl = getEnv("SUPABASE_URL") || getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "source_file_unavailable" });
  }

  const upstream = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/public-story-media?media_id=${encodeURIComponent(placementId)}`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    }
  );

  if (!upstream.ok) {
    return res.status(upstream.status === 404 ? 404 : 502).json({
      error: upstream.status === 404 ? "source_file_not_found" : "source_file_fetch_failed",
    });
  }

  const contentType = cleanContentType(upstream.headers.get("content-type"));
  const fileName = safeFileName(fallbackFileName);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "HEAD") return res.status(200).end();

  const body = Buffer.from(await upstream.arrayBuffer());
  return res.status(200).send(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const kac = safeString(Array.isArray(req.query?.kac) ? req.query.kac[0] : req.query?.kac);
  const attachmentId = safeString(
    Array.isArray(req.query?.attachmentId) ? req.query.attachmentId[0] : req.query?.attachmentId
  );

  if (!kac || !attachmentId) return res.status(400).json({ error: "missing_source_file" });

  const supabase = getServiceSupabase();
  if (!supabase) return res.status(503).json({ error: "source_file_unavailable" });

  try {
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id, kac_id")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!asset?.id) return res.status(404).json({ error: "source_file_not_found" });

    const { data: placement, error: placementError } = await supabase
      .from("attachment_placements")
      .select("id, attachment_id, target_type, target_id, role")
      .eq("target_type", "asset")
      .eq("target_id", asset.id)
      .eq("attachment_id", attachmentId)
      .maybeSingle();

    if (placementError) throw placementError;
    if (!placement?.id) return res.status(404).json({ error: "source_file_not_found" });

    const { data: attachment, error: attachmentError } = await supabase
      .from("attachments")
      .select("id, title, file_name, url, bucket, storage_path, mime_type, kind, privacy, ai_metadata")
      .eq("id", attachmentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (attachmentError) throw attachmentError;
    if (!attachment?.id) return res.status(404).json({ error: "source_file_not_found" });

    const meta = asObject(attachment.ai_metadata);
    const aiContext = normalizeAIContext(meta.ai_context || meta.aiContext);
    const privacy = safeString(meta.privacy || attachment.privacy || "moves_with_asset") || "moves_with_asset";

    if (aiContext === "off" || isPrivatePrivacy(privacy)) {
      return res.status(404).json({ error: "source_file_not_found" });
    }

    const { data: publicRow, error: publicRowError } = await supabase
      .from("public_asset_story_gallery")
      .select("placement_id, attachment_id, kac_id")
      .eq("placement_id", placement.id)
      .eq("attachment_id", attachment.id)
      .eq("kac_id", kac)
      .maybeSingle();

    if (publicRowError) throw publicRowError;
    if (!publicRow?.placement_id) return res.status(404).json({ error: "source_file_not_found" });

    return streamPublicMedia({
      placementId: publicRow.placement_id,
      fallbackFileName: attachment.file_name || attachment.title,
      req,
      res,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "server_error" });
  }
}
