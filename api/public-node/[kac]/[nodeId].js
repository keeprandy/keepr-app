import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function standardMeta(system) {
  const meta = system?.metadata && typeof system.metadata === "object" ? system.metadata : {};
  const standard = meta.standard && typeof meta.standard === "object" ? meta.standard : {};
  return {
    identity: standard.identity || {},
    story: standard.story || {},
    relationships: standard.relationships || {},
  };
}

function publicProName(pro) {
  const raw = safeString(pro?.name || pro?.label || pro?.company);
  if (/^genpro\b/i.test(raw)) return "GenPro";
  return raw || "Assigned KeeprPro";
}

function hasSensitivePublicText(value) {
  const text = safeString(value);
  if (!text) return false;
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
    /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(text) ||
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Drive|Dr\.?|Court|Ct\.?|Lane|Ln\.?|Trail|Trl\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?)\b/i.test(text)
  );
}

function sanitizePublicText(value) {
  let text = safeString(value);
  if (!text) return "";

  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(from|to|cc|bcc|subject|sent|date):\s*/i.test(line))
    .join(" ");

  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "")
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Drive|Dr\.?|Court|Ct\.?|Lane|Ln\.?|Trail|Trl\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?)\b[^,\n]*(?:,\s*[A-Z]{2})?(?:\s+\d{5})?/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (text.length > 160) return `${text.slice(0, 157).trim()}...`;
  return text;
}

function publicStorySummary(story) {
  const explicit =
    safeString(story?.public_summary) ||
    safeString(story?.publicSummary) ||
    safeString(story?.public_narrative) ||
    safeString(story?.publicNarrative);
  if (explicit && !hasSensitivePublicText(explicit)) return sanitizePublicText(explicit);

  const raw = safeString(story?.summary);
  if (!raw || hasSensitivePublicText(raw)) return null;
  return sanitizePublicText(raw);
}

function publicTimelineSummary(record, primaryProName, systemName) {
  const serviceType = sanitizePublicText(record?.service_type);
  const rawTitle = sanitizePublicText(record?.title);
  const serviceTypeIsPublic =
    serviceType && !/^(moment|pro|story|email|other|unknown)$/i.test(serviceType);
  const titleLooksImported =
    !rawTitle ||
    /\b(fw:|re:|invoice|receipt|attached|statement|estimate)\b/i.test(rawTitle);
  const title = serviceTypeIsPublic
    ? serviceType
    : titleLooksImported
      ? `${systemName || "System"} service record`
      : rawTitle;

  return {
    title,
    description: primaryProName
      ? `Service work was completed by ${primaryProName}.`
      : "Service work was completed.",
  };
}

async function signedAttachmentUrl(supabase, attachmentId) {
  if (!attachmentId) return null;
  const { data: attachment } = await supabase
    .from("attachments")
    .select("id, url, bucket, storage_path, mime_type, file_name, kind")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!attachment) return null;
  if (/^https?:\/\//i.test(safeString(attachment.url))) return attachment.url;
  if (!attachment.bucket || !attachment.storage_path) return null;

  const { data: signed } = await supabase.storage
    .from(attachment.bucket)
    .createSignedUrl(attachment.storage_path, 60 * 15);
  return signed?.signedUrl || null;
}

function isImageAttachment(attachment) {
  const mime = safeString(attachment?.mime_type).toLowerCase();
  const kind = safeString(attachment?.kind).toLowerCase();
  if (mime.startsWith("image/")) return true;
  return kind === "photo" || kind === "image";
}

function isPublicEligibleAttachment(attachment) {
  if (!isImageAttachment(attachment)) return false;
  const privacy = safeString(attachment?.ai_metadata?.privacy).toLowerCase();
  return !["private", "owner_only", "internal", "confidential"].includes(privacy);
}

function sortPlacementRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const sa = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
    const sb = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}

async function resolveHero(supabase, { asset, system }) {
  const { data: systemPlacements } = await supabase
    .from("attachment_placements")
    .select(
      "id, attachment_id, target_type, target_id, role, is_showcase, sort_order, created_at, attachment:attachments(id, url, bucket, storage_path, mime_type, file_name, kind, ai_metadata, created_at)"
    )
    .eq("target_type", "system")
    .eq("target_id", system.id);

  const systemRows = sortPlacementRows(systemPlacements || []);
  const explicitId = safeString(system.hero_attachment_id);
  const explicit = explicitId
    ? systemRows.find((row) => row.attachment_id === explicitId && isPublicEligibleAttachment(row.attachment))
    : null;
  if (explicit?.attachment) {
    return {
      url: await signedAttachmentUrl(supabase, explicit.attachment_id),
      source: "system_explicit_hero",
      attachment_id: explicit.attachment_id,
    };
  }

  const firstSystemImage = systemRows.find((row) => isPublicEligibleAttachment(row.attachment));
  if (firstSystemImage?.attachment) {
    return {
      url: await signedAttachmentUrl(supabase, firstSystemImage.attachment_id),
      source: "system_first_image",
      attachment_id: firstSystemImage.attachment_id,
    };
  }

  const heroPlacementId = safeString(asset.hero_placement_id || asset.extra_metadata?.hero_placement_id);
  const heroImageUrl = safeString(asset.hero_image_url || asset.extra_metadata?.hero_image_url);
  if (heroPlacementId) {
    const { data: parentHero } = await supabase
      .from("attachment_placements")
      .select(
        "id, attachment_id, target_type, target_id, role, is_showcase, sort_order, created_at, attachment:attachments(id, url, bucket, storage_path, mime_type, file_name, kind, ai_metadata, created_at)"
      )
      .eq("id", heroPlacementId)
      .eq("target_type", "asset")
      .eq("target_id", asset.id)
      .maybeSingle();

    if (parentHero?.attachment && isPublicEligibleAttachment(parentHero.attachment)) {
      return {
        url: await signedAttachmentUrl(supabase, parentHero.attachment_id),
        source: "parent_asset_hero",
        attachment_id: parentHero.attachment_id,
      };
    }
  }

  if (/^https?:\/\//i.test(heroImageUrl)) {
    return {
      url: heroImageUrl,
      source: "parent_asset_hero_url",
      attachment_id: null,
    };
  }

  return { url: null, source: "placeholder", attachment_id: null };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const kac = safeString(req.query?.kac);
  const nodeId = safeString(req.query?.nodeId);
  if (!kac || !UUID_RE.test(nodeId)) {
    return res.status(400).json({ error: "invalid_node_request" });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "resolver_unavailable" });

  try {
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id, name, type, kac_id, owner_id, location, hero_placement_id, hero_image_url, extra_metadata")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!asset?.id) return res.status(404).json({ error: "asset_not_found" });

    const { data: system, error: systemError } = await supabase
      .from("systems")
      .select("*")
      .eq("id", nodeId)
      .eq("asset_id", asset.id)
      .maybeSingle();

    if (systemError) throw systemError;
    if (!system?.id) return res.status(404).json({ error: "node_not_found" });

    const std = standardMeta(system);
    const proIds = Array.isArray(std.relationships.keepr_pro_ids)
      ? std.relationships.keepr_pro_ids.filter(Boolean)
      : [];

    const { data: pros } = proIds.length
      ? await supabase
          .from("keepr_pros")
          .select("id, name, category, website, location")
          .in("id", proIds)
      : { data: [] };

    const { data: records } = await supabase
      .from("service_records")
      .select("id, title, notes, service_type, performed_at, created_at")
      .eq("system_id", system.id)
      .order("performed_at", { ascending: false })
      .limit(8);

    const hero = await resolveHero(supabase, { asset, system });
    const identity = std.identity || {};
    const publicPros = (pros || []).map((pro) => ({
      id: pro.id,
      name: publicProName(pro),
      category: pro.category || null,
      website: pro.website || null,
      location: pro.location || null,
      assignment_scope: "system",
    }));
    const primaryProName = publicPros[0]?.name || null;

    return res.status(200).json({
      ok: true,
      asset: {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        kac_id: asset.kac_id,
        owner_id: asset.owner_id,
      },
      node: {
        id: system.id,
        type: system.system_type || "system",
        name: system.name || "System",
        display_name: system.name || "System",
        status: system.status || null,
        lifecycle_status: system.lifecycle_status || null,
        hero_url: hero.url,
        hero_source: hero.source,
        hero_attachment_id: hero.attachment_id,
        story_summary: publicStorySummary(std.story),
        identity: {
          manufacturer: identity.manufacturer || identity.brand || null,
          model: identity.model || null,
          serial_number: identity.serial_number || identity.serial || null,
          installed_on: identity.installed_on || identity.installedOn || null,
          location: identity.location || null,
          installed_by: identity.installed_by || null,
        },
      },
      connectors: {
        keepr_pros: publicPros,
      },
      timeline: (records || []).map((record) => {
        const summary = publicTimelineSummary(record, primaryProName, system.name || "System");
        return {
          id: record.id,
          title: summary.title,
          description: summary.description,
          performed_at: record.performed_at || record.created_at || null,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "server_error" });
  }
}
