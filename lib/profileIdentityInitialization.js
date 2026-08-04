const PROVISIONAL_SLUG_PREFIX = "u";
export const CURRENT_POLICY_VERSION = "2026-08-04";

export function normalizeKeeprSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || null;
}

export function provisionalSlugForUser(userId, preferredName = "") {
  const nameSlug = normalizeKeeprSlug(preferredName);
  const suffix = String(userId || "").replace(/-/g, "").slice(0, 10);
  const base = nameSlug && nameSlug.length >= 3 ? nameSlug : PROVISIONAL_SLUG_PREFIX;
  return normalizeKeeprSlug(`${base}-${suffix}`) || `${PROVISIONAL_SLUG_PREFIX}-${suffix}`;
}

export function providerAvatarUrl(authUser) {
  const meta = authUser?.user_metadata || {};
  return meta.avatar_url || meta.picture || meta.photo_url || null;
}

export function profileIdentityValues({ authUser, email, displayName, policyAccepted }) {
  const profileEmail = String(email || authUser?.email || "").trim().toLowerCase();
  const meta = authUser?.user_metadata || {};
  const profileName =
    displayName ||
    meta.full_name ||
    meta.name ||
    [meta.given_name, meta.family_name].filter(Boolean).join(" ") ||
    null;
  const now = new Date().toISOString();

  return {
    email: profileEmail || null,
    preferred_contact_email: profileEmail || null,
    display_name: profileName || null,
    full_name: profileName || null,
    profile_photo_url: providerAvatarUrl(authUser),
    provisional_slug: provisionalSlugForUser(authUser?.id, profileName || profileEmail),
    acquisition_source_slug: null,
    onboarding_state: "in_progress",
    profile_initialized_at: now,
    policy_accepted_at: policyAccepted ? now : null,
    policy_version: policyAccepted ? CURRENT_POLICY_VERSION : null,
  };
}
