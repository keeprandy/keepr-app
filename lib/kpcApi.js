import { supabase } from "./supabaseClient";

const mapCategoryForOwnerUi = (category) => {
  switch ((category || "").toLowerCase()) {
    case "marine":
      return "marine";
    case "automotive":
    case "vehicle":
    case "vehicles":
      return "vehicles";
    case "home":
      return "home";
    case "powersports":
    case "outdoor":
      return "outdoor";
    default:
      return "other";
  }
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null);

const normalizePrimaryLocation = (location) => {
  const value = location && typeof location === "object" ? location : null;
  if (!value) return null;

  const city = value.city || value.locality || "";
  const region = value.region || value.state || value.state_code || "";
  const label =
    value.name ||
    value.label ||
    [city, region].filter(Boolean).join(", ") ||
    value.formatted_address ||
    "";

  return {
    ...value,
    label,
  };
};

const getProfileMedia = (kpc) => {
  const media = kpc?.profileMedia || kpc?.profile_media || {};
  return media && typeof media === "object" ? media : {};
};

const getContact = (kpc) => {
  const contact = kpc?.contact || {};
  return contact && typeof contact === "object" ? contact : {};
};

const normalizeKpcNameForLookup = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const compact = raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = {
    skipperbuds: "SkipperBud's",
    "skipper buds": "SkipperBud's",
    skipperbud: "SkipperBud's",
    "skipper bud": "SkipperBud's",
    tiara: "Tiara Yachts",
    "tiara yacht": "Tiara Yachts",
  };

  return aliases[compact] || raw;
};

export const mapKpcToKeeprPro = (input) => {
  if (!input) return null;

  const kpc = input.kpc && typeof input.kpc === "object" ? input.kpc : input;
  const profileMedia = getProfileMedia(kpc);
  const contact = getContact(kpc);
  const primaryLocation = normalizePrimaryLocation(
    firstDefined(kpc.primaryLocation, kpc.primary_location)
  );
  const organizationId = firstDefined(
    kpc.orgId,
    kpc.organizationId,
    kpc.organization_id
  );
  const keeprProId = firstDefined(kpc.keeprProId, kpc.keepr_pro_id);
  const kpcId = firstDefined(kpc.kpcId, kpc.kpc_id, organizationId);
  const displayName = firstDefined(
    kpc.displayName,
    kpc.display_name,
    kpc.name,
    "Unnamed Keepr Pro"
  );
  const primaryCategory = firstDefined(
    kpc.primaryCategory,
    kpc.primary_category,
    kpc.category
  );
  const logoUrl = firstDefined(
    profileMedia.logoUrl,
    profileMedia.logo_url,
    kpc.logoUrl,
    kpc.logo_url,
    kpc.avatar_url
  );
  const locationLabel =
    firstDefined(kpc.location, primaryLocation?.label, primaryLocation?.formatted_address) || "";

  return {
    id: keeprProId || organizationId || kpcId,
    legacyId: keeprProId || null,
    kpcId,
    orgId: organizationId || null,
    organizationId: organizationId || null,
    keeprProId: keeprProId || null,
    ownerKpcRelationshipId:
      firstDefined(input.relationship_id, kpc.owner_kpc_relationship_id) || null,
    relationshipType:
      firstDefined(input.relationship_type, kpc.relationship_type) || null,
    source: kpc.source || "kpc_directory",
    name: displayName,
    displayName,
    label: locationLabel ? `${displayName} · ${locationLabel}` : displayName,
    category: mapCategoryForOwnerUi(primaryCategory),
    primaryCategory: primaryCategory || null,
    kpcCategory: primaryCategory || null,
    capabilities: safeArray(kpc.capabilities),
    claimState:
      firstDefined(kpc.claimState, kpc.claim_state, kpc.status) || "unclaimed",
    profileStatus: firstDefined(kpc.profileStatus, kpc.profile_status) || null,
    logoUrl: logoUrl || "",
    avatar_url: logoUrl || "",
    phone: firstDefined(kpc.phone, contact.phone) || "",
    email: firstDefined(kpc.email, contact.email) || "",
    website: firstDefined(kpc.website, contact.website) || "",
    location: locationLabel,
    primaryLocation,
    externalIdentities:
      safeArray(firstDefined(kpc.externalIdentities, kpc.external_identities)),
    sourceSummary: firstDefined(kpc.sourceSummary, kpc.source_summary) || null,
    notes:
      firstDefined(kpc.shortDescription, kpc.short_description, kpc.description) ||
      "",
    since: "",
    lastService: "",
    isFavorite: !!firstDefined(input.is_favorite, kpc.is_favorite),
    assets: [],
    serviceHistory: [],
    rawKpc: kpc,
  };
};

export const getKeeprProPickerId = (pro) =>
  pro ? firstDefined(pro.id, pro.keeprProId, pro.keepr_pro_id, pro.organizationId, pro.orgId, pro.kpcId) : null;

export const isKeeprProPickerMatch = (pro, id) => {
  if (!pro || !id) return false;
  const wanted = String(id);
  return [
    pro.id,
    pro.keeprProId,
    pro.keepr_pro_id,
    pro.organizationId,
    pro.orgId,
    pro.kpcId,
  ]
    .filter(Boolean)
    .some((value) => String(value) === wanted);
};

export async function searchKpcDirectory({ query = "", filters = {}, limit = 12 } = {}) {
  const { data, error } = await supabase.rpc("search_kpc_directory", {
    p_query: query,
    p_filters: filters,
    p_limit: limit,
  });

  if (error) throw error;
  return {
    ...(data || {}),
    results: safeArray(data?.results),
  };
}

export async function resolveOrCreateOwnerKpc(payload) {
  const { data, error } = await supabase.rpc("resolve_or_create_owner_kpc", {
    p_payload: payload || {},
  });

  if (error) throw error;
  return data || null;
}

export async function resolveOrCreateKpcForPicker(payload = {}) {
  const normalizedName = normalizeKpcNameForLookup(
    firstDefined(payload.name, payload.displayName, payload.display_name)
  );

  const resolved = await resolveOrCreateOwnerKpc({
    ...payload,
    name: normalizedName || payload.name,
    display_name: normalizedName || payload.display_name || payload.displayName,
    source: payload.source || "manual_quick",
  });

  const mapped = mapKpcToKeeprPro(resolved?.kpc || resolved);
  if (!mapped) throw new Error("KPC resolve did not return a provider.");

  return {
    ...mapped,
    ownerKpcRelationshipId:
      mapped.ownerKpcRelationshipId || resolved?.relationship_id || null,
  };
}

export async function getMyKpcRelationships() {
  const { data, error } = await supabase.rpc("get_my_kpc_relationships");

  if (error) throw error;
  return {
    ...(data || {}),
    results: safeArray(data?.results),
  };
}

export async function loadMyKeeprProsForPicker() {
  try {
    const data = await getMyKpcRelationships();
    const rows = safeArray(data?.results)
      .map(mapKpcToKeeprPro)
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    return rows;
  } catch (error) {
    console.warn(
      "KPC relationship picker unavailable; falling back to legacy keepr_pros.",
      error?.message || error
    );

    const { data, error: legacyError } = await supabase
      .from("keepr_pros")
      .select(
        "id,name,category,phone,email,website,location,is_favorite,organization_id,logo_url,avatar_url"
      )
      .order("is_favorite", { ascending: false })
      .order("name", { ascending: true });

    if (legacyError) throw legacyError;

    return safeArray(data)
      .map((row) =>
        mapKpcToKeeprPro({
          ...row,
          keepr_pro_id: row.id,
          organization_id: row.organization_id || null,
          display_name: row.name,
          source: "legacy_keepr_pros",
        })
      )
      .filter(Boolean);
  }
}

export async function getKpcDuplicateReport(terms = ["Wilson Marine", "Tiara Yachts"]) {
  const { data, error } = await supabase.rpc("get_kpc_duplicate_report", {
    p_terms: terms,
  });

  if (error) throw error;
  return data || null;
}
