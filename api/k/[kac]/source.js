import { createClient } from "@supabase/supabase-js";

const PRIVATE_PRIVACY_VALUES = new Set(["private", "owner_only", "internal", "confidential"]);

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getBearer(req) {
  const header = safeString(req.headers.authorization || req.headers.Authorization);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function getSupabase(req, { service = false } = {}) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = service ? serviceKey : anonKey;
  if (!url || !key) return null;
  const bearer = getBearer(req);
  return createClient(url, key, {
    auth: { persistSession: false },
    global: !service && bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
  });
}

function getServiceSupabase() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function normalizeAIContext(value) {
  const raw = safeString(value).toLowerCase();
  if (["primary", "primary_source", "primary source"].includes(raw)) return "primary";
  if (["supporting", "supporting_source", "supporting source"].includes(raw)) return "supporting";
  return "off";
}

function normalizeScope(value) {
  const raw = safeString(value).toLowerCase();
  if (["system", "systems", "selected_systems", "selected systems"].includes(raw)) return "systems";
  if (["record", "associated_record", "associated record", "service_record"].includes(raw)) return "record";
  return "asset";
}

function normalizeRole(value) {
  const clean = safeString(value || "other");
  return clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
}

function profileLabel(row) {
  return row?.display_name || row?.full_name || row?.email || null;
}

function firstPresent(...values) {
  for (const value of values) {
    const clean = safeString(value);
    if (clean) return clean;
  }
  return null;
}

function contributionMetadata(attachment) {
  return {
    ...asObject(attachment?.source_context),
    ...asObject(attachment?.extra_metadata),
    ...asObject(attachment?.ai_metadata?.source_context),
  };
}

function attributionFor(attachment, { profileLabels, orgLabels }) {
  const meta = {
    ...contributionMetadata(attachment),
    contributed_by_user_id: firstPresent(attachment?.owner_user_id, attachment?.contributed_by_user_id),
    contributed_by_org_id: firstPresent(attachment?.org_id, attachment?.contributed_by_org_id),
    contributed_by_user_label: profileLabels.get(attachment?.owner_user_id) || null,
    contributed_by_org_label: orgLabels.get(attachment?.org_id) || null,
  };

  const orgLabel = firstPresent(
    meta.contributed_by_org_label,
    meta.completed_by_org_label,
    meta.shared_by_org_label,
    meta.actor_org_label
  );
  const userLabel = firstPresent(
    meta.contributed_by_user_label,
    meta.completed_by_label,
    meta.shared_by_label,
    meta.actor_label
  );

  if (orgLabel) return orgLabel;
  if (userLabel) return userLabel;
  return null;
}

async function contributorIndexes(supabase, attachments) {
  const userIds = Array.from(new Set((attachments || []).map((a) => a?.owner_user_id).filter(Boolean)));
  const orgIds = Array.from(new Set((attachments || []).map((a) => a?.org_id).filter(Boolean)));
  const profileLabels = new Map();
  const orgLabels = new Map();

  if (userIds.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id,display_name,full_name,email")
      .in("id", userIds);
    (data || []).forEach((row) => profileLabels.set(row.id, profileLabel(row)));
  }

  if (orgIds.length) {
    const { data } = await supabase
      .from("orgs")
      .select("id,name,display_name")
      .in("id", orgIds);
    (data || []).forEach((row) => orgLabels.set(row.id, row.display_name || row.name || null));
  }

  return { profileLabels, orgLabels };
}

function isPrivatePrivacy(privacy) {
  return PRIVATE_PRIVACY_VALUES.has(safeString(privacy).toLowerCase());
}

async function urlForSource(supabase, attachment, { isAuthenticated, privacy }) {
  if (!attachment) return null;
  const normalizedPrivacy = safeString(privacy).toLowerCase();

  if (!isAuthenticated) {
    if (isPrivatePrivacy(normalizedPrivacy)) return null;
    return /^https?:\/\//i.test(safeString(attachment.url)) ? attachment.url : null;
  }

  if (/^https?:\/\//i.test(safeString(attachment.url))) return attachment.url;
  if (!attachment.bucket || !attachment.storage_path) return null;

  const { data, error } = await supabase.storage
    .from(attachment.bucket)
    .createSignedUrl(attachment.storage_path, 60 * 15);
  if (error) return null;
  return data?.signedUrl || null;
}

async function listAuthorizedAISources(supabase, assetId, { isAuthenticated }) {
  const { data: assetPlacements, error: placementError } = await supabase
    .from("attachment_placements")
    .select(`
      id,
      attachment_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at,
      attachments (
        id,
        kind,
        title,
        notes,
        url,
        file_name,
        mime_type,
        bucket,
        storage_path,
        owner_user_id,
        org_id,
        created_at,
        source_context,
        ai_metadata
      )
    `)
    .eq("target_type", "asset")
    .eq("target_id", assetId);

  if (placementError) throw placementError;

  const attachmentIds = Array.from(
    new Set((assetPlacements || []).map((row) => row.attachment_id).filter(Boolean))
  );
  if (!attachmentIds.length) return [];

  const { data: allPlacements, error: allPlacementError } = await supabase
    .from("attachment_placements")
    .select("id, attachment_id, target_type, target_id, role, label, sort_order, is_showcase, created_at")
    .in("attachment_id", attachmentIds);

  if (allPlacementError) throw allPlacementError;

  const contributorMeta = await contributorIndexes(
    supabase,
    (assetPlacements || []).map((row) => row.attachments).filter(Boolean)
  );
  const placementsByAttachment = new Map();
  (allPlacements || []).forEach((placement) => {
    if (!placementsByAttachment.has(placement.attachment_id)) placementsByAttachment.set(placement.attachment_id, []);
    placementsByAttachment.get(placement.attachment_id).push(placement);
  });

  const byAttachment = new Map();
  for (const row of assetPlacements || []) {
    const attachment = row.attachments || {};
    const meta = asObject(attachment.ai_metadata);
    const aiContext = normalizeAIContext(meta.ai_context || meta.aiContext);
    if (aiContext === "off") continue;

    const privacy = safeString(meta.privacy || attachment.privacy || "moves_with_asset") || "moves_with_asset";
    if (!isAuthenticated && isPrivatePrivacy(privacy)) continue;

    const scope = normalizeScope(meta.ai_scope || meta.aiContextScope || meta.scope);
    const role = normalizeRole(meta.role || row.role || "other");
    const sourceUrl = await urlForSource(supabase, attachment, { isAuthenticated, privacy });
    const placements = (placementsByAttachment.get(row.attachment_id) || [])
      .map((placement) => ({
        target_type: placement.target_type || null,
        target_id: placement.target_id || null,
        role: normalizeRole(placement.role || role),
        label: placement.label || null,
      }))
      .sort((a, b) =>
        String(a.target_type || "").localeCompare(String(b.target_type || "")) ||
        String(a.target_id || "").localeCompare(String(b.target_id || ""))
      );

    const source = {
      title: attachment.title || attachment.file_name || attachment.url || "Attachment",
      attachment_id: row.attachment_id,
      role,
      ai_context: aiContext,
      scope,
      contributor: attributionFor(attachment, contributorMeta) || "Unknown contributor",
      privacy,
      url: sourceUrl,
      mime_type: attachment.mime_type || null,
      kind: attachment.kind || null,
      placements,
    };

    const existing = byAttachment.get(row.attachment_id);
    if (!existing || source.ai_context === "primary") byAttachment.set(row.attachment_id, source);
  }

  return Array.from(byAttachment.values()).sort((a, b) => {
    const rank = (source) => (source.ai_context === "primary" ? 0 : 1);
    return rank(a) - rank(b) || String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const kac = safeString(Array.isArray(req.query?.kac) ? req.query.kac[0] : req.query?.kac);
  if (!kac) return res.status(400).json({ error: "missing_kac" });

  const publicSupabase = getServiceSupabase();
  const userSupabase = getSupabase(req);
  if (!publicSupabase || !userSupabase) return res.status(503).json({ error: "source_unavailable" });

  try {
    const bearer = getBearer(req);
    const { data: authData } = bearer
      ? await userSupabase.auth.getUser(bearer)
      : { data: { user: null } };
    const isAuthenticated = !!authData?.user?.id;
    const sourceSupabase = isAuthenticated ? userSupabase : publicSupabase;

    const { data: asset, error: assetError } = await publicSupabase
      .from("assets")
      .select("id, name, type, kac_id, year, make, model, owner_id, extra_metadata")
      .eq("kac_id", kac)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!asset?.id) return res.status(404).json({ error: "asset_not_found" });

    const { data: systems, error: systemsError } = await publicSupabase
      .from("systems")
      .select("id, name, system_type, ksc_code, mode, status")
      .eq("asset_id", asset.id)
      .order("name", { ascending: true });

    if (systemsError) throw systemsError;

    const sources = await listAuthorizedAISources(sourceSupabase, asset.id, { isAuthenticated });

    return res.status(200).json({
      manifest_version: "keepr.source.v0.1",
      generated_at: new Date().toISOString(),
      access: {
        authenticated: isAuthenticated,
        source_urls_include_private: isAuthenticated,
      },
      asset: {
        id: asset.id,
        kac: asset.kac_id || kac,
        name: asset.name || null,
        type: asset.type || null,
        make: asset.make || asset.extra_metadata?.make || null,
        model: asset.model || asset.extra_metadata?.model || null,
        year: asset.year || asset.extra_metadata?.year || null,
      },
      systems: (systems || []).map((system) => ({
        id: system.id,
        name: system.name || "System",
        type: system.system_type || null,
        ksc_code: system.ksc_code || null,
        mode: system.mode || null,
        status: system.status || null,
      })),
      sources,
      relationships: [],
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "server_error" });
  }
}
