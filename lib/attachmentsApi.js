// lib/attachmentsApi.js
import { supabase } from "./supabaseClient";
import { formatContributionAttribution } from "./provenance";

export const AI_CONTEXT_VALUES = {
  OFF: "off",
  SUPPORTING: "supporting",
  PRIMARY: "primary",
};

export const AI_CONTEXT_SCOPE_VALUES = {
  ASSET: "asset",
  SYSTEMS: "systems",
  RECORD: "record",
};

export function normalizeAIContext(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["primary", "primary_source", "primary source"].includes(raw)) return AI_CONTEXT_VALUES.PRIMARY;
  if (["supporting", "supporting_source", "supporting source"].includes(raw)) return AI_CONTEXT_VALUES.SUPPORTING;
  return AI_CONTEXT_VALUES.OFF;
}

export function normalizeAIContextScope(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["system", "systems", "selected_systems", "selected systems"].includes(raw)) {
    return AI_CONTEXT_SCOPE_VALUES.SYSTEMS;
  }
  if (["record", "associated_record", "associated record", "service_record"].includes(raw)) {
    return AI_CONTEXT_SCOPE_VALUES.RECORD;
  }
  return AI_CONTEXT_SCOPE_VALUES.ASSET;
}

export function formatAIContextLabel(value) {
  const normalized = normalizeAIContext(value);
  if (normalized === AI_CONTEXT_VALUES.PRIMARY) return "Primary Source";
  if (normalized === AI_CONTEXT_VALUES.SUPPORTING) return "Supporting Source";
  return "Off";
}

export function formatAIContextScopeLabel(value, assetKind = "asset") {
  const normalized = normalizeAIContextScope(value);
  if (normalized === AI_CONTEXT_SCOPE_VALUES.SYSTEMS) return "Selected systems";
  if (normalized === AI_CONTEXT_SCOPE_VALUES.RECORD) return "Associated record";
  return assetKind === "boat" ? "Entire boat" : "Entire asset";
}

function profileLabel(row) {
  return row?.display_name || row?.full_name || row?.email || null;
}

async function buildAttachmentContributorMetadata(attachments = []) {
  const userIds = Array.from(
    new Set((attachments || []).map((a) => a?.owner_user_id).filter(Boolean))
  );
  const orgIds = Array.from(
    new Set((attachments || []).map((a) => a?.org_id).filter(Boolean))
  );
  const profileLabels = new Map();
  const orgLabels = new Map();

  if (userIds.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,full_name,email")
      .in("id", userIds);
    if (!error) {
      (data || []).forEach((row) => {
        profileLabels.set(row.id, profileLabel(row));
      });
    }
  }

  if (orgIds.length) {
    const { data, error } = await supabase
      .from("orgs")
      .select("id,name,display_name")
      .in("id", orgIds);
    if (!error) {
      (data || []).forEach((row) => {
        orgLabels.set(row.id, row.display_name || row.name || null);
      });
    }
  }

  return { profileLabels, orgLabels };
}

function attachmentAttribution(attachment, contributorMetadata) {
  if (attachment?.source_context?.provenance === "model_template") {
    return attachment.source_context.provenance_label || "Model media";
  }
  const userLabel = contributorMetadata?.profileLabels?.get(attachment?.owner_user_id) || null;
  const orgLabel = contributorMetadata?.orgLabels?.get(attachment?.org_id) || null;
  return formatContributionAttribution({
    ...attachment,
    contributed_by_user_id: attachment?.owner_user_id || null,
    contributed_by_user_label: userLabel,
    contributed_by_org_id: attachment?.org_id || null,
    contributed_by_org_label: orgLabel,
  });
}

/**
 * Existing: list attachments for a single target (system/service_record/asset)
 * Returns flattened placement rows.
 */
export async function listAttachmentsForTarget(targetType, targetId) {
  if (!targetType || !targetId) return [];

  const { data, error } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
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
        bucket,
        owner_user_id,
        org_id,
        created_at,
        deleted_at,
        source_context,
        ai_metadata
      )
    `
    )
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const activeRows = (data || []).filter((row) => !row.attachments?.deleted_at);

  const contributorMetadata = await buildAttachmentContributorMetadata(
    activeRows.map((row) => row.attachments).filter(Boolean)
  );

  // normalize to what your screens already expect today
  return activeRows.map((row) => {
    const a = row.attachments || {};
    return {
      placement_id: row.id,
      attachment_id: row.attachment_id,
      target_type: row.target_type,
      target_id: row.target_id,
      role: row.role,
      label: row.label,
      sort_order: row.sort_order,
      is_showcase: row.is_showcase,

      // attachment fields
      kind: a.kind,
      title: a.title,
      notes: a.notes,
      url: a.url,
      file_name: a.file_name,
      mime_type: a.mime_type,
      bucket: a.bucket || a.storage_bucket,
      storage_path: a.storage_path,
      owner_user_id: a.owner_user_id || null,
      org_id: a.org_id || null,
      created_at: a.created_at,
      source_context: a.source_context || null,
      ai_metadata: a.ai_metadata || null,
      attribution: attachmentAttribution(a, contributorMetadata),
      provenance_label: a.source_context?.provenance_label || null,
      provenance_detail: a.source_context?.provenance_detail || null,
      source_resource_id: a.source_context?.source_resource_id || null,
      is_inherited_model_media: a.source_context?.provenance === "model_template",
    };
  });
}
// -----------------------------------------------------------------------------
// Signed URL cache (prevents re-signing the same object repeatedly across screens)
// -----------------------------------------------------------------------------

const SIGNED_URL_CACHE_MAX = 500;
const SIGNED_URL_FAILURE_TTL_MS = 60 * 1000;
const signedUrlCache = new Map();

function stableStringify(obj) {
  if (!obj || typeof obj !== "object") return String(obj ?? "");
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function makeSignedUrlCacheKey({ bucket, path, expiresIn, transform }) {
  return `${bucket || ""}|${path || ""}|${expiresIn || ""}|${stableStringify(transform)}`;
}

function normalizeStoragePath(bucket, path) {
  if (!path) return null;
  const bucketName = String(bucket || "").trim();
  let value = String(path || "").trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    value = parsed.pathname || value;
  } catch {
    // Not an absolute URL; keep the original path.
  }

  const urlPrefixes = [
    `/storage/v1/object/sign/${bucketName}/`,
    `/storage/v1/object/public/${bucketName}/`,
    `/storage/v1/object/authenticated/${bucketName}/`,
    `/object/sign/${bucketName}/`,
    `/object/public/${bucketName}/`,
    `/object/authenticated/${bucketName}/`,
  ].filter((prefix) => bucketName && prefix);

  for (const prefix of urlPrefixes) {
    const index = value.indexOf(prefix);
    if (index >= 0) {
      value = value.slice(index + prefix.length);
      break;
    }
  }

  value = value.replace(/^\/+/, "");
  if (bucketName && value === bucketName) return null;
  if (bucketName && value.startsWith(`${bucketName}/`)) {
    value = value.slice(bucketName.length + 1);
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    // A malformed escape should not prevent signing an otherwise usable path.
  }

  return value || null;
}

function pruneSignedUrlCache() {
  if (signedUrlCache.size <= SIGNED_URL_CACHE_MAX) return;
  // Drop oldest entries (Map preserves insertion order)
  const overflow = signedUrlCache.size - SIGNED_URL_CACHE_MAX;
  let i = 0;
  for (const k of signedUrlCache.keys()) {
    signedUrlCache.delete(k);
    i += 1;
    if (i >= overflow) break;
  }
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}

/**
 * getSignedUrl
 *
 * - Adds optional Supabase Storage transform support (images only)
 * - Adds in-memory caching keyed by bucket+path+expiresIn+transform
 *
 * @param {Object} args
 * @param {string} args.bucket
 * @param {string} args.path
 * @param {number} [args.expiresIn=3600]
 * @param {Object|null} [args.transform=null] e.g. { width: 320, height: 320, resize: 'cover', quality: 80 }
 */
export async function getSignedUrl({ bucket, path, expiresIn = 3600, transform = null }) {
  const normalizedPath = normalizeStoragePath(bucket, path);
  if (!bucket || !normalizedPath) return null;

  const key = makeSignedUrlCacheKey({ bucket, path: normalizedPath, expiresIn, transform });
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    if (cached.failed) return null;
    if (cached.url) return cached.url;
  }

  // Keep a small safety buffer so we don't hand out nearly-expired URLs.
  const safetySeconds = 30;
  const ttlMs = Math.max(0, (Number(expiresIn) - safetySeconds) * 1000);

  const options = transform ? { transform } : undefined;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(normalizedPath, expiresIn, options);

  if (error) {
    signedUrlCache.set(key, {
      url: null,
      failed: true,
      expiresAt: Date.now() + SIGNED_URL_FAILURE_TTL_MS,
    });
    pruneSignedUrlCache();
    throw error;
  }

  const signedUrl = data?.signedUrl || null;
  if (signedUrl) {
    signedUrlCache.set(key, { url: signedUrl, expiresAt: Date.now() + ttlMs });
    pruneSignedUrlCache();
  }

  return signedUrl;
}

/**
 * NEW: list canonical attachments for an asset, including ALL placements for each attachment.
 * This is what AssetAttachmentsScreen needs so associations “stick”.
 */
export async function listAttachmentsForAsset(assetId, options = {}) {
  if (!assetId) return [];
  const includeInheritedModelMedia = !!options.includeInheritedModelMedia;

  // 1) Anchor set: attachments that have an ASSET placement (your new rule)
  const { data: assetPlacements, error: pErr } = await supabase
    .from("attachment_placements")
    .select(
      `
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
        bucket,
        owner_user_id,
        org_id,
        created_at,
        source_context,
        ai_metadata
      )
    `
    )
    .eq("target_type", "asset")
    .eq("target_id", assetId)
    .order("created_at", { ascending: false });

  if (pErr) throw pErr;

  const ids = Array.from(
    new Set((assetPlacements || []).map((r) => r.attachment_id).filter(Boolean))
  );

  if (ids.length === 0) {
    return includeInheritedModelMedia ? await listInheritedTemplateMediaForAsset(assetId) : [];
  }

  // 2) Fetch ALL placements for those attachments (system + service_record + etc.)
  const { data: allPlacements, error: allErr } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      sort_order,
      is_showcase,
      created_at
    `
    )
    .in("attachment_id", ids);

  if (allErr) throw allErr;

  const contributorMetadata = await buildAttachmentContributorMetadata(
    (assetPlacements || []).map((row) => row.attachments).filter(Boolean)
  );

  const byAttachment = new Map();
  (allPlacements || []).forEach((pl) => {
    const k = pl.attachment_id;
    if (!byAttachment.has(k)) byAttachment.set(k, []);
    byAttachment.get(k).push(pl);
  });

  // 3) Deduplicate: assetPlacements returns 1 row per *placement*.
  // If an attachment has multiple placements on the same asset (historical bug), return ONE item.
  const roleRank = (role) => {
    const r = String(role || "").toLowerCase();
    if (r === "primary") return 100;
    if (r === "hero") return 90;
    if (r === "showcase") return 80;
    if (r === "other") return 10;
    return 0;
  };

  const byId = new Map();

  for (const row of assetPlacements || []) {
    const a = row.attachments || {};
    const placements = (byAttachment.get(row.attachment_id) || []).sort((x, y) =>
      String(y.created_at || "").localeCompare(String(x.created_at || ""))
    );

    const candidate = {
      id: a.id || row.attachment_id,
      attachment_id: row.attachment_id,

      kind: a.kind,
      title: a.title,
      notes: a.notes,
      url: a.url,
      file_name: a.file_name,
      mime_type: a.mime_type,
      bucket: a.bucket || a.storage_bucket,
      storage_path: a.storage_path,
      owner_user_id: a.owner_user_id || null,
      org_id: a.org_id || null,
      created_at: a.created_at,
      source_context: a.source_context || null,
      ai_metadata: a.ai_metadata || null,
      attribution: attachmentAttribution(a, contributorMetadata),

      // For UI actions we keep the primary placement id, but also expose all ids.
      asset_placement_id: row.id,
      asset_placement_ids: [row.id],
      asset_role: row.role,
      asset_label: row.label,
      asset_sort_order: row.sort_order,
      asset_is_showcase: row.is_showcase,

      placements,
    };

    const existing = byId.get(row.attachment_id);
    if (!existing) {
      byId.set(row.attachment_id, candidate);
      continue;
    }

    existing.asset_placement_ids = Array.from(
      new Set([...(existing.asset_placement_ids || []), row.id])
    );

    const exRank = roleRank(existing.asset_role);
    const caRank = roleRank(candidate.asset_role);
    const exT = String(existing.asset_placement_id || "");
    const caT = String(candidate.asset_placement_id || "");
    const candidateWins = caRank > exRank || (caRank === exRank && caT > exT);

    if (candidateWins) {
      byId.set(row.attachment_id, {
        ...existing,
        ...candidate,
        asset_placement_ids: existing.asset_placement_ids,
      });
    }
  }

  const directRows = Array.from(byId.values());
  if (!includeInheritedModelMedia) return directRows;

  const inheritedRows = await listInheritedTemplateMediaForAsset(assetId);
  const directAttachmentIds = new Set(directRows.map((row) => row.attachment_id).filter(Boolean));
  const directResourceIds = new Set(
    directRows
      .map((row) => row.source_context?.source_resource_id || row.source_resource_id)
      .filter(Boolean)
  );

  const inheritedOnly = (inheritedRows || []).filter((row) => {
    if (row.attachment_id && directAttachmentIds.has(row.attachment_id)) return false;
    if (row.source_resource_id && directResourceIds.has(row.source_resource_id)) return false;
    return true;
  });

  return [...directRows, ...inheritedOnly];
}

function isModelMediaResource(resource) {
  const meta = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  return resource?.resource_type === "photo" || meta.media_scope === "model_template";
}

function modelTemplateLabel(template) {
  if (!template) return "Model media";
  const year = template.model_year ? `MY${template.model_year}` : null;
  const make = template.manufacturer || null;
  const model = template.model || null;
  return [year, make, model].filter(Boolean).join(" ") || template.template_key || "Model";
}

function resourceUrl(resource) {
  const meta = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  return resource?.url || resource?.source_url || meta.url || meta.source_url || null;
}

function normalizedToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function metadataObject(row) {
  return row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function assetMetadataObject(row) {
  return row?.extra_metadata && typeof row.extra_metadata === "object"
    ? row.extra_metadata
    : metadataObject(row);
}

function compactUnique(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function collectTemplateRefsFromAssetMetadata(meta = {}) {
  const source = meta && typeof meta === "object" ? meta : {};
  const nested = [
    source.exact_build,
    source.exact_build_draft,
    source.catalog,
    source.model_template,
    source.template,
    source.provenance,
  ].filter((value) => value && typeof value === "object");

  const idValues = [
    source.catalog_template_id,
    source.asset_model_template_id,
    source.model_template_id,
    source.template_id,
    ...nested.flatMap((entry) => [
      entry.catalog_template_id,
      entry.asset_model_template_id,
      entry.model_template_id,
      entry.template_id,
    ]),
  ];

  const keyValues = [
    source.catalog_template_key,
    source.asset_model_template_key,
    source.model_template_key,
    source.template_key,
    ...nested.flatMap((entry) => [
      entry.catalog_template_key,
      entry.asset_model_template_key,
      entry.model_template_key,
      entry.template_key,
    ]),
  ];

  return {
    ids: compactUnique(idValues).filter(isUuid),
    keys: compactUnique(keyValues),
  };
}

async function listTemplatesFromAssetMetadata(assetId) {
  const { data: asset, error } = await supabase
    .from("assets")
    .select("id,extra_metadata")
    .eq("id", assetId)
    .maybeSingle();

  if (error || !asset) return [];

  const refs = collectTemplateRefsFromAssetMetadata(assetMetadataObject(asset));
  const templatesById = new Map();

  if (refs.ids.length) {
    const { data, error: templateErr } = await supabase
      .from("asset_model_templates")
      .select("id,template_key,manufacturer,model,model_year,metadata")
      .in("id", refs.ids);
    if (!templateErr) {
      (data || []).forEach((template) => {
        if (template?.id) templatesById.set(template.id, template);
      });
    }
  }

  if (refs.keys.length) {
    const { data, error: templateErr } = await supabase
      .from("asset_model_templates")
      .select("id,template_key,manufacturer,model,model_year,metadata")
      .in("template_key", refs.keys);
    if (!templateErr) {
      (data || []).forEach((template) => {
        if (template?.id) templatesById.set(template.id, template);
      });
    }
  }

  return Array.from(templatesById.values());
}

function resourceLinkedTemplateItemIds(resource) {
  const meta = metadataObject(resource);
  return [
    meta.template_item_id,
    meta.model_template_item_id,
    ...(Array.isArray(meta.linked_template_item_ids) ? meta.linked_template_item_ids : []),
    ...(Array.isArray(meta.template_item_ids) ? meta.template_item_ids : []),
  ].filter(Boolean);
}

function itemElementList(item, key) {
  const metadata = metadataObject(item);
  const downstream = metadata.downstream_elements && typeof metadata.downstream_elements === "object"
    ? metadata.downstream_elements
    : {};
  const expectedValue = item?.expected_value?.value && typeof item.expected_value.value === "object"
    ? item.expected_value.value
    : {};
  const value = metadata[key] || downstream[key] || item?.expected_value?.[key] || expectedValue[key] || [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return value.split(/\n|,/).map((part) => part.trim()).filter(Boolean);
  return [];
}

function itemElementListAny(item, keys = []) {
  return [...new Set(keys.flatMap((key) => itemElementList(item, key)).filter(Boolean))];
}

function systemTemplateMatchTokens(systemRow) {
  const meta = metadataObject(systemRow);
  const identity = meta.standard?.identity || meta.identity || {};
  return [
    systemRow?.name,
    identity.manufacturer,
    identity.model,
    [identity.manufacturer, identity.model].filter(Boolean).join(" "),
    meta.model_label,
    meta.template_item_label,
    meta.graph_projection?.name,
    meta.graph_projection?.model,
  ]
    .map(normalizedToken)
    .filter(Boolean);
}

function systemTemplateItemIds(systemRow) {
  const meta = metadataObject(systemRow);
  return [
    meta.template_item_id,
    meta.model_template_item_id,
    meta.source_template_item_id,
    meta.graph_projection?.template_item_id,
    ...(Array.isArray(meta.template_item_ids) ? meta.template_item_ids : []),
    ...(Array.isArray(meta.linked_template_item_ids) ? meta.linked_template_item_ids : []),
  ].filter(Boolean);
}

function isReusableSystemResource(resource) {
  if (isModelMediaResource(resource)) return false;
  const type = String(resource?.resource_type || resource?.kind || metadataObject(resource).kind || "").toLowerCase();
  return !["photo", "image"].includes(type);
}

function normalizeInheritedSystemResource(resource, template, item) {
  const meta = metadataObject(resource);
  return {
    id: resource.id,
    resource_id: resource.id,
    title: resource.title || resource.source_name || "Reusable resource",
    resource_type: resource.resource_type || meta.kind || "resource",
    url: resourceUrl(resource),
    source_url: resource.source_url || resource.url || null,
    source_name: resource.source_name || null,
    template_id: template?.id || resource.applies_to_id || null,
    template_key: template?.template_key || null,
    template_label: modelTemplateLabel(template),
    template_item_id: item?.id || meta.template_item_id || null,
    template_item_label: item?.label || meta.template_item_label || null,
    provenance: "model_template_item",
    provenance_label: "Inherited model knowledge",
    provenance_detail: "Reusable model/system resource inherited through this asset's model binding; not exact-hull evidence.",
    not_exact_hull_evidence: true,
  };
}

export async function listInheritedTemplateResourcesForSystem(assetId, systemRow) {
  if (!assetId || !systemRow?.id) return [];

  const { data: bindings, error: bindingErr } = await supabase
    .from("asset_template_bindings")
    .select(
      `
      id,
      asset_id,
      template_id,
      binding_status,
      asset_model_templates (
        id,
        template_key,
        manufacturer,
        model,
        model_year
      )
    `
    )
    .eq("asset_id", assetId)
    .in("binding_status", ["suggested", "inherited", "verified"])
    .order("created_at", { ascending: false });

  if (bindingErr) throw bindingErr;

  const templates = (bindings || [])
    .map((binding) => binding.asset_model_templates)
    .filter((template) => template?.id);
  const templateIds = Array.from(new Set(templates.map((template) => template.id)));
  if (!templateIds.length) return [];

  const templateById = new Map(templates.map((template) => [template.id, template]));
  const explicitIds = new Set(systemTemplateItemIds(systemRow));
  const matchTokens = systemTemplateMatchTokens(systemRow);

  const { data: items, error: itemsErr } = await supabase
    .from("asset_model_template_items")
    .select("id,template_id,label,item_type,canonical_key,metadata,expected_value")
    .in("template_id", templateIds);
  if (itemsErr) throw itemsErr;

  const matchedItems = (items || []).filter((item) => {
    if (explicitIds.has(item.id)) return true;
    const itemTokens = [
      item.label,
      item.canonical_key,
      ...itemElementListAny(item, ["systems", "systems_created"]),
    ].map(normalizedToken).filter(Boolean);
    return itemTokens.some((itemToken) =>
      matchTokens.some((systemToken) =>
        itemToken === systemToken || itemToken.includes(systemToken) || systemToken.includes(itemToken)
      )
    );
  });

  const matchedItemById = new Map(matchedItems.map((item) => [item.id, item]));
  if (!matchedItemById.size) return [];

  const { data: resources, error: resourcesErr } = await supabase
    .from("asset_resources")
    .select("*")
    .eq("applies_to_type", "template")
    .in("applies_to_id", templateIds)
    .order("created_at", { ascending: false });
  if (resourcesErr) throw resourcesErr;

  return (resources || [])
    .filter(isReusableSystemResource)
    .map((resource) => {
      const linkedIds = resourceLinkedTemplateItemIds(resource);
      const matchedId = linkedIds.find((id) => matchedItemById.has(id));
      if (!matchedId) return null;
      return normalizeInheritedSystemResource(
        resource,
        templateById.get(resource.applies_to_id),
        matchedItemById.get(matchedId)
      );
    })
    .filter(Boolean);
}

function normalizeTemplateMediaResource(resource, template, attachment, assetPlacement) {
  const meta = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  const templatePlacements = meta.placements && typeof meta.placements === "object" ? meta.placements : {};
  const modelIsHero = templatePlacements.hero === true || meta.is_hero === true || meta.hero === true || meta.role === "hero";
  const modelIsShowcase = templatePlacements.showcase === true || meta.is_showcase === true || meta.showcase === true || meta.role === "showcase";
  const label = `${modelTemplateLabel(template)} model media`;
  const sourceUrl = resource?.url || resource?.source_url || attachment?.url || null;
  const sourceContext = {
    provenance: "model_template",
    provenance_label: label,
    provenance_detail: "Inherited from the bound model template; not exact-hull evidence.",
    source_resource_id: resource.id,
    template_id: template?.id || resource.applies_to_id || null,
    template_key: template?.template_key || null,
    source_name: resource.source_name || null,
    source_url: resource.source_url || resource.url || null,
    not_exact_hull_media: true,
    ...(attachment?.source_context || {}),
  };
  const fileName =
    attachment?.file_name ||
    meta.file_name ||
    meta.attachment_storage_path?.split("/")?.pop?.() ||
    resource?.title ||
    "Model media";

  return {
    id: attachment?.id || resource.id,
    attachment_id: attachment?.id || resource.attachment_id || null,
    resource_id: resource.id,
    source_resource_id: resource.id,
    kind: attachment?.kind || "photo",
    title: attachment?.title || resource.title || "Model media",
    notes: attachment?.notes || meta.source_document_title || resource.source_name || null,
    url: attachment?.url || sourceUrl,
    file_name: fileName,
    mime_type: attachment?.mime_type || meta.mime_type || null,
    bucket: attachment?.bucket || meta.attachment_bucket || null,
    storage_path: attachment?.storage_path || meta.attachment_storage_path || null,
    owner_user_id: attachment?.owner_user_id || resource.created_by || null,
    org_id: attachment?.org_id || null,
    created_at: attachment?.created_at || resource.created_at,
    source_context: sourceContext,
    ai_metadata: attachment?.ai_metadata || null,
    attribution: label,
    provenance_label: label,
    provenance_detail: "Inherited from the bound model template; not exact-hull evidence.",
    is_inherited_model_media: true,
    is_exact_asset_media: false,
    template_id: template?.id || resource.applies_to_id || null,
    template_key: template?.template_key || null,
    asset_placement_id: assetPlacement?.id || null,
    asset_placement_ids: assetPlacement?.id ? [assetPlacement.id] : [],
    asset_role: assetPlacement?.role || null,
    asset_label: assetPlacement?.label || null,
    asset_sort_order: assetPlacement?.sort_order ?? null,
    asset_is_showcase: !!assetPlacement?.is_showcase,
    target_type: assetPlacement?.target_type || "asset",
    target_id: assetPlacement?.target_id || null,
    role: assetPlacement?.role || (modelIsHero ? "hero" : modelIsShowcase ? "showcase" : meta.role || "model_media"),
    label: assetPlacement?.label || resource.title || null,
    sort_order: assetPlacement?.sort_order ?? meta.sort_order ?? null,
    is_showcase: !!assetPlacement?.is_showcase || modelIsShowcase,
    is_hero: modelIsHero,
    model_is_showcase: modelIsShowcase,
    model_placements: {
      ...templatePlacements,
      hero: modelIsHero,
      showcase: modelIsShowcase,
    },
    placements: assetPlacement ? [assetPlacement] : [],
  };
}

function normalizeTemplateMediaPlacement(templatePlacement, template, assetPlacement) {
  const attachment = templatePlacement?.attachments || {};
  const sourceContext = attachment.source_context && typeof attachment.source_context === "object"
    ? attachment.source_context
    : {};
  const label =
    sourceContext.provenance_label ||
    `${modelTemplateLabel(template)} model media`;
  const templateMetadata = metadataObject(template);
  const presentation = templateMetadata.presentation && typeof templateMetadata.presentation === "object"
    ? templateMetadata.presentation
    : {};
  const isModelHero = presentation.hero_placement_id === templatePlacement.id;
  const isModelShowcase = !!templatePlacement.is_showcase || templatePlacement.role === "showcase";

  return {
    id: attachment.id || templatePlacement.attachment_id,
    attachment_id: templatePlacement.attachment_id,
    template_placement_id: templatePlacement.id,
    resource_id: sourceContext.source_resource_id || null,
    source_resource_id: sourceContext.source_resource_id || null,
    kind: attachment.kind || "photo",
    title: attachment.title || templatePlacement.label || attachment.file_name || "Model media",
    notes: attachment.notes || null,
    url: attachment.url || null,
    file_name: attachment.file_name || null,
    mime_type: attachment.mime_type || null,
    bucket: attachment.bucket || attachment.storage_bucket || null,
    storage_path: attachment.storage_path || null,
    owner_user_id: attachment.owner_user_id || null,
    org_id: attachment.org_id || null,
    created_at: attachment.created_at || templatePlacement.created_at,
    source_context: {
      ...sourceContext,
      provenance: "model_template",
      provenance_label: label,
      provenance_detail:
        sourceContext.provenance_detail ||
        "Inherited from the bound model template; not exact-hull evidence.",
      template_id: template?.id || templatePlacement.target_id || null,
      template_key: template?.template_key || sourceContext.template_key || null,
      not_exact_hull_media: true,
    },
    ai_metadata: attachment.ai_metadata || null,
    attribution: label,
    provenance_label: label,
    provenance_detail:
      sourceContext.provenance_detail ||
      "Inherited from the bound model template; not exact-hull evidence.",
    is_inherited_model_media: true,
    is_exact_asset_media: false,
    template_id: template?.id || templatePlacement.target_id || null,
    template_key: template?.template_key || null,
    asset_placement_id: assetPlacement?.id || null,
    asset_placement_ids: assetPlacement?.id ? [assetPlacement.id] : [],
    asset_role: assetPlacement?.role || null,
    asset_label: assetPlacement?.label || null,
    asset_sort_order: assetPlacement?.sort_order ?? null,
    asset_is_showcase: !!assetPlacement?.is_showcase,
    target_type: assetPlacement?.target_type || "model_template",
    target_id: assetPlacement?.target_id || templatePlacement.target_id || null,
    role: assetPlacement?.role || templatePlacement.role || "model_media",
    label: assetPlacement?.label || templatePlacement.label || attachment.title || null,
    sort_order: assetPlacement?.sort_order ?? templatePlacement.sort_order ?? null,
    is_showcase: !!assetPlacement?.is_showcase || isModelShowcase,
    is_hero: isModelHero,
    model_is_showcase: isModelShowcase,
    model_placements: {
      hero: isModelHero,
      showcase: isModelShowcase,
      role: templatePlacement.role || null,
      placement_id: templatePlacement.id,
    },
    placements: assetPlacement ? [assetPlacement] : [],
  };
}

export async function listModelTemplateMediaForTemplates(templates = []) {
  const uniqueTemplates = Array.from(
    new Map((templates || []).filter((template) => template?.id).map((template) => [template.id, template])).values()
  );
  if (!uniqueTemplates.length) return {};

  const templateIds = uniqueTemplates.map((template) => template.id);
  const templateById = new Map(uniqueTemplates.map((template) => [template.id, template]));

  const { data: placements, error } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
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
        deleted_at,
        source_context,
        ai_metadata
      )
    `
    )
    .eq("target_type", "model_template")
    .in("target_id", templateIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const byTemplateId = {};
  for (const placement of placements || []) {
    const attachment = placement.attachments || {};
    if (attachment.deleted_at) continue;
    const mime = String(attachment.mime_type || "").toLowerCase();
    if (attachment.kind !== "photo" && !mime.startsWith("image/")) continue;

    const template = templateById.get(placement.target_id);
    const row = normalizeTemplateMediaPlacement(placement, template, null);
    const signedUrl = row.url || await getSignedUrl({
      bucket: row.bucket,
      path: row.storage_path,
      transform: { width: 900, height: 520, resize: "cover", quality: 82 },
    }).catch(() => null);
    const hydrated = signedUrl ? { ...row, signed_url: signedUrl, url: row.url || signedUrl } : row;

    if (!byTemplateId[placement.target_id]) {
      byTemplateId[placement.target_id] = { hero: null, media: [] };
    }
    byTemplateId[placement.target_id].media.push(hydrated);
    if (hydrated.is_hero) {
      byTemplateId[placement.target_id].hero = hydrated;
    }
  }

  Object.values(byTemplateId).forEach((entry) => {
    if (!entry.hero) {
      entry.hero =
        entry.media.find((item) => item.role === "hero") ||
        entry.media.find((item) => item.is_showcase) ||
        entry.media[0] ||
        null;
    }
  });

  return byTemplateId;
}

async function listInheritedTemplateMediaForAsset(assetId) {
  const { data: bindings, error: bindingErr } = await supabase
    .from("asset_template_bindings")
    .select(
      `
      id,
      asset_id,
      template_id,
      binding_status,
      asset_model_templates (
        id,
        template_key,
        manufacturer,
        model,
        model_year,
        metadata
      )
    `
    )
    .eq("asset_id", assetId)
    .in("binding_status", ["suggested", "inherited", "verified"])
    .order("created_at", { ascending: false });

  if (bindingErr) throw bindingErr;

  const bindingTemplates = (bindings || [])
    .map((binding) => binding.asset_model_templates)
    .filter((template) => template?.id);
  const metadataTemplates = await listTemplatesFromAssetMetadata(assetId);
  const templates = Array.from(
    new Map([...bindingTemplates, ...metadataTemplates].map((template) => [template.id, template])).values()
  );

  const templateIds = Array.from(new Set(templates.map((template) => template.id)));
  if (!templateIds.length) return [];

  const templateById = new Map(templates.map((template) => [template.id, template]));

  const { data: templatePlacements, error: templatePlacementErr } = await supabase
    .from("attachment_placements")
    .select(
      `
      id,
      attachment_id,
      target_type,
      target_id,
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
    `
    )
    .eq("target_type", "model_template")
    .in("target_id", templateIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (templatePlacementErr) throw templatePlacementErr;

  const templateAttachmentIds = Array.from(
    new Set((templatePlacements || []).map((placement) => placement.attachment_id).filter(Boolean))
  );
  const assetPlacementsByAttachmentId = new Map();

  if (templateAttachmentIds.length) {
    const { data: assetPlacements, error: assetPlacementErr } = await supabase
      .from("attachment_placements")
      .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
      .eq("target_type", "asset")
      .eq("target_id", assetId)
      .in("attachment_id", templateAttachmentIds);
    if (assetPlacementErr) throw assetPlacementErr;
    (assetPlacements || []).forEach((placement) => {
      assetPlacementsByAttachmentId.set(placement.attachment_id, placement);
    });
  }

  const templateMediaRows = (templatePlacements || [])
    .filter((placement) => {
      const attachment = placement.attachments || {};
      const mime = String(attachment.mime_type || "").toLowerCase();
      return attachment.kind === "photo" || mime.startsWith("image/");
    })
    .map((placement) =>
      normalizeTemplateMediaPlacement(
        placement,
        templateById.get(placement.target_id),
        assetPlacementsByAttachmentId.get(placement.attachment_id)
      )
    );

  const { data: resources, error: resourceErr } = await supabase
    .from("asset_resources")
    .select("*")
    .eq("applies_to_type", "template")
    .in("applies_to_id", templateIds)
    .order("created_at", { ascending: false });

  const mediaResources = resourceErr ? [] : (resources || []).filter(isModelMediaResource);

  const attachmentIds = Array.from(
    new Set(mediaResources.map((resource) => resource.attachment_id).filter(Boolean))
  );
  const attachmentsById = new Map();
  const placementsByAttachmentId = new Map();

  if (attachmentIds.length) {
    const { data: attachments, error: attachmentsErr } = await supabase
      .from("attachments")
      .select(
        "id,kind,title,notes,url,file_name,mime_type,bucket,storage_path,owner_user_id,org_id,created_at,source_context,ai_metadata"
      )
      .in("id", attachmentIds);
    if (attachmentsErr) throw attachmentsErr;
    (attachments || []).forEach((attachment) => attachmentsById.set(attachment.id, attachment));

    const { data: placements, error: placementErr } = await supabase
      .from("attachment_placements")
      .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
      .eq("target_type", "asset")
      .eq("target_id", assetId)
      .in("attachment_id", attachmentIds);
    if (placementErr) throw placementErr;
    (placements || []).forEach((placement) => {
      placementsByAttachmentId.set(placement.attachment_id, placement);
    });
  }

  const legacyResourceRows = mediaResources.map((resource) =>
      normalizeTemplateMediaResource(
        resource,
        templateById.get(resource.applies_to_id),
        resource.attachment_id ? attachmentsById.get(resource.attachment_id) : null,
        resource.attachment_id ? placementsByAttachmentId.get(resource.attachment_id) : null
      )
    );

  const seen = new Set();
  return [...templateMediaRows, ...legacyResourceRows].filter((row) => {
    const key = row.attachment_id ? `attachment:${row.attachment_id}` : `resource:${row.resource_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function ensureAssetMediaPlacement({
  assetId,
  resourceId = null,
  attachmentId: providedAttachmentId = null,
  role = "showcase",
  isShowcase = false,
  label = null,
}) {
  if (!assetId || (!resourceId && !providedAttachmentId)) {
    throw new Error("Asset and media attachment are required.");
  }

  if (providedAttachmentId) {
    const { data: attachment, error: attachmentErr } = await supabase
      .from("attachments")
      .select("id,title,file_name,kind,mime_type")
      .eq("id", providedAttachmentId)
      .maybeSingle();
    if (attachmentErr) throw attachmentErr;
    if (!attachment) throw new Error("Media attachment was not found.");

    return await upsertAssetMediaPlacement({
      assetId,
      attachmentId: attachment.id,
      role,
      isShowcase,
      label: label || attachment.title || attachment.file_name || null,
    });
  }

  const { data: resource, error: resourceErr } = await supabase
    .from("asset_resources")
    .select("*")
    .eq("id", resourceId)
    .maybeSingle();
  if (resourceErr) throw resourceErr;
  if (!resource) throw new Error("Media resource was not found.");
  if (!isModelMediaResource(resource)) throw new Error("Only media resources can be placed.");

  let attachmentId = resource.attachment_id || null;
  let template = null;
  if (resource.applies_to_type === "template" && resource.applies_to_id) {
    const { data: templateRow, error: templateErr } = await supabase
      .from("asset_model_templates")
      .select("id,template_key,manufacturer,model,model_year")
      .eq("id", resource.applies_to_id)
      .maybeSingle();
    if (templateErr) throw templateErr;
    template = templateRow || null;
  }
  const meta = resource.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  const sourceUrl = resource.url || resource.source_url || null;

  if (!attachmentId) {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id || resource.created_by || null;
    if (!userId) throw new Error("Not signed in.");

    const provenanceLabel = `${modelTemplateLabel(template)} model media`;
    const { data: attachment, error: attachmentErr } = await supabase
      .from("attachments")
      .insert({
        owner_user_id: userId,
        asset_id: null,
        kind: "photo",
        bucket: meta.attachment_bucket || null,
        storage_path: meta.attachment_storage_path || null,
        url: sourceUrl,
        file_name: meta.file_name || null,
        mime_type: meta.mime_type || null,
        size_bytes: meta.size_bytes || null,
        title: resource.title || "Model media",
        notes: resource.source_name || null,
        source_context: {
          provenance: "model_template",
          provenance_label: provenanceLabel,
          provenance_detail: "Inherited from the bound model template; not exact-hull evidence.",
          source_resource_id: resource.id,
          template_id: template?.id || resource.applies_to_id || null,
          template_key: template?.template_key || null,
          source_name: resource.source_name || null,
          source_url: resource.source_url || resource.url || null,
          not_exact_hull_media: true,
        },
      })
      .select("id")
      .single();

    if (attachmentErr) throw attachmentErr;
    attachmentId = attachment.id;

    const { error: updateErr } = await supabase
      .from("asset_resources")
      .update({
        attachment_id: attachmentId,
        metadata: { ...meta, attachment_id: attachmentId },
      })
      .eq("id", resource.id);
    if (updateErr) throw updateErr;
  }

  return await upsertAssetMediaPlacement({
    assetId,
    attachmentId,
    role,
    isShowcase,
    label: label || resource.title || null,
  });
}

async function upsertAssetMediaPlacement({
  assetId,
  attachmentId,
  role = "showcase",
  isShowcase = false,
  label = null,
}) {
  const placementPayload = {
    attachment_id: attachmentId,
    target_type: "asset",
    target_id: assetId,
    role,
    label,
    sort_order: null,
    is_showcase: !!isShowcase,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("attachment_placements")
    .insert(placementPayload)
    .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
    .maybeSingle();

  if (!insertErr && inserted) {
    return { attachment_id: attachmentId, placement: inserted };
  }

  const msg = String(insertErr?.message || "");
  if (!(insertErr?.code === "23505" || msg.toLowerCase().includes("duplicate key"))) {
    throw insertErr;
  }

  const { data: existing, error: existingErr } = await supabase
    .from("attachment_placements")
    .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
    .eq("attachment_id", attachmentId)
    .eq("target_type", "asset")
    .eq("target_id", assetId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { data: updated, error: updateErr } = await supabase
      .from("attachment_placements")
      .update({
        role: role || existing.role,
        label: label || existing.label,
        is_showcase: !!isShowcase || !!existing.is_showcase,
      })
      .eq("id", existing.id)
      .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
      .maybeSingle();
    if (updateErr) throw updateErr;
    return { attachment_id: attachmentId, placement: updated || existing };
  }

  throw new Error("Could not create media placement.");
}

export async function removePlacementById(placementId) {
  if (!placementId) return;
  const { error } = await supabase
    .from("attachment_placements")
    .delete()
    .eq("id", placementId);
  if (error) throw error;
}

function contributorFromAttribution(attribution) {
  const value = String(attribution || "").trim();
  if (!value) return null;
  return value.replace(/^Added by\s+/i, "").replace(/^Imported from\s+/i, "");
}

/**
 * Projection-only manifest of authorized AI context sources for an asset.
 *
 * This intentionally starts from listAttachmentsForAsset(), so RLS and the same
 * attachment/relationship visibility gates decide what the caller can see.
 * The AI source flag never grants access; it only marks authorized items as
 * approved context.
 */
export async function listAssetAIContextSources(assetId, options = {}) {
  const assetKind = options.assetKind || options.asset_type || "asset";
  const rows = await listAttachmentsForAsset(assetId);

  return (rows || [])
    .map((row) => {
      const meta = row?.ai_metadata && typeof row.ai_metadata === "object" ? row.ai_metadata : {};
      const aiContext = normalizeAIContext(meta.ai_context || meta.aiContext);
      if (aiContext === AI_CONTEXT_VALUES.OFF) return null;

      const scope = normalizeAIContextScope(meta.ai_scope || meta.aiContextScope || meta.scope);
      const role = meta.role || row.asset_role || row.role || "Other";
      const contributor = contributorFromAttribution(row.attribution) || "Unknown contributor";
      const privacy = meta.privacy || row.privacy || "moves_with_asset";

      return {
        asset: assetId,
        attachment_id: row.attachment_id || row.id,
        id: row.id || row.attachment_id,
        title: row.title || row.file_name || row.url || "Attachment",
        file_name: row.file_name || null,
        kind: row.kind || null,
        role,
        ai_context: aiContext,
        ai_context_label: formatAIContextLabel(aiContext),
        scope,
        scope_label: formatAIContextScopeLabel(scope, assetKind),
        contributor,
        attribution: row.attribution || null,
        privacy,
        privacy_label: privacy === "owner_only" ? "Owner only" : "Moves with asset",
        placements: row.placements || [],
        source_context: row.source_context || null,
        ai_metadata: meta,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rank = (source) => (source.ai_context === AI_CONTEXT_VALUES.PRIMARY ? 0 : 1);
      return rank(a) - rank(b) || String(a.title || "").localeCompare(String(b.title || ""));
    });
}
