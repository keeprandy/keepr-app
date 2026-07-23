// Activation & Attribution V1 Build 1 helpers.
// Canonical identity comes from Supabase RPCs; local compatibility fallback
// preserves existing /invite/:slug links until every legacy slug is migrated.

export const ACTIVATION_SOURCE_TYPES = Object.freeze([
  "user",
  "organization",
  "campaign",
  "hub",
  "keeprpro",
  "partner",
  "system_internal",
]);

export const ACTIVATION_SLUG_STATUSES = Object.freeze([
  "active",
  "disabled",
  "retired",
]);

export const ACTIVATION_SLUG_KINDS = Object.freeze(["canonical", "alias"]);

export const LEGACY_COMPATIBILITY_SLUGS = Object.freeze({
  keeprandy: { legacyClassification: "known_v0_personal_invite" },
  drake: { legacyClassification: "known_v0_personal_invite" },
  hub: { legacyClassification: "known_v0_system_campaign" },
  email: { legacyClassification: "known_v0_system_campaign" },
});

export function normalizeActivationSlug(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}

export function getLegacySlugCompatibility(value) {
  const normalizedSlug = normalizeActivationSlug(value);
  if (!normalizedSlug) return null;

  const explicit = LEGACY_COMPATIBILITY_SLUGS[normalizedSlug];
  if (explicit) {
    return {
      normalizedSlug,
      sourceSlug: normalizedSlug,
      activationSourceId: null,
      resolutionState: "legacy_fallback",
      legacyClassification: explicit.legacyClassification,
      isVerifiedCanonical: false,
      isCompatibilityFallback: true,
    };
  }

  if (/^u_[a-z0-9]{8}$/.test(normalizedSlug)) {
    return {
      normalizedSlug,
      sourceSlug: normalizedSlug,
      activationSourceId: null,
      resolutionState: "legacy_fallback",
      legacyClassification: "legacy_generated_user_prefix",
      isVerifiedCanonical: false,
      isCompatibilityFallback: true,
    };
  }

  return {
    normalizedSlug,
    sourceSlug: normalizedSlug,
    activationSourceId: null,
    resolutionState: "legacy_fallback",
    legacyClassification: "unmigrated_v0_source_slug",
    isVerifiedCanonical: false,
    isCompatibilityFallback: true,
  };
}

export function normalizeResolvedActivationSource(row, fallbackSlug = null) {
  if (!row) return null;

  return {
    activationSourceId: row.activation_source_id || null,
    resolutionState: row.resolution_state || null,
    sourceType: row.source_type || null,
    sourceKey: row.source_key || null,
    displayName: row.display_name || null,
    sourceStatus: row.source_status || null,
    ownerUserId: row.owner_user_id || null,
    ownerOrgId: row.owner_org_id || null,
    ownerHubId: row.owner_hub_id || null,
    ownerKeeprProId: row.owner_keepr_pro_id || null,
    campaignKey: row.campaign_key || null,
    partnerKey: row.partner_key || null,
    slugId: row.slug_id || null,
    slug: row.slug || fallbackSlug || null,
    normalizedSlug: row.normalized_slug || normalizeActivationSlug(fallbackSlug),
    slugKind: row.slug_kind || null,
    slugStatus: row.slug_status || null,
    isRedirect: !!row.is_redirect,
    redirectActivationSourceId: row.redirect_activation_source_id || null,
    isVerifiedCanonical: !!row.activation_source_id && row.resolution_state === "canonical",
    isCompatibilityFallback: false,
  };
}

export async function resolveActivationSourceSlug({ supabase, slug }) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const normalizedSlug = normalizeActivationSlug(slug);
  if (!normalizedSlug) return null;

  const { data, error } = await supabase.rpc("resolve_activation_source_slug", {
    p_slug: normalizedSlug,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.activation_source_id) {
    return normalizeResolvedActivationSource(row, normalizedSlug);
  }

  return getLegacySlugCompatibility(normalizedSlug);
}

export async function lookupActivationSources({ supabase, query = "", limit = 50 }) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const { data, error } = await supabase.rpc("lookup_activation_sources", {
    p_query: query || null,
    p_limit: limit,
  });

  if (error) throw error;
  return Array.isArray(data) ? data.map((row) => normalizeResolvedActivationSource(row)) : [];
}
