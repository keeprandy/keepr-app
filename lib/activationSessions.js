// Activation & Attribution V1 Build 2 helpers.
// The database remains authoritative; clients only keep an opaque session token
// for continuity and retain V0 source_slug keys during the migration window.

export const ACTIVATION_SESSION_TOKEN_KEY = "keepr_activation_session_token";
export const LEGACY_ACQUISITION_SOURCE_SLUG_KEY = "keepr_acquisition_source_slug";
export const LEGACY_INVITE_SLUG_KEY = "keepr_invite_slug";

export const ACTIVATION_ENTRY_METHODS = Object.freeze([
  "invite_link",
  "qr_code",
  "claim_link",
  "service_ready",
  "hub_invite",
  "partner_link",
  "campaign_link",
  "direct",
]);

export const ACTIVATION_SESSION_TERMINAL_STATUSES = Object.freeze([
  "consumed",
  "converted",
  "expired",
  "ignored",
  "blocked",
]);

function getBrowserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function resolveStorage(storage) {
  const selected = storage || getBrowserStorage();
  if (!selected) return null;

  return {
    async getItem(key) {
      return selected.getItem(key);
    },
    async setItem(key, value) {
      return selected.setItem(key, value);
    },
    async removeItem(key) {
      return selected.removeItem(key);
    },
  };
}

function getSessionRow(data) {
  return Array.isArray(data) ? data[0] : data || null;
}

function isExpired(expiresAt) {
  return !!expiresAt && Date.parse(expiresAt) <= Date.now();
}

function normalizeEntryMethod(entryMethod) {
  return ACTIVATION_ENTRY_METHODS.includes(entryMethod) ? entryMethod : "direct";
}

export async function getStoredActivationSessionToken({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return null;
  return resolvedStorage.getItem(ACTIVATION_SESSION_TOKEN_KEY);
}

export async function storeActivationSessionToken({ token, storage }) {
  if (!token) return;
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  await resolvedStorage.setItem(ACTIVATION_SESSION_TOKEN_KEY, token);
}

export async function clearStoredActivationSessionToken({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  await resolvedStorage.removeItem(ACTIVATION_SESSION_TOKEN_KEY);
}

export async function clearExpiredOrConsumedActivationSession({ session, storage } = {}) {
  if (!session) return false;

  const status = session.status || null;
  const shouldClear =
    ACTIVATION_SESSION_TERMINAL_STATUSES.includes(status) || isExpired(session.expires_at);

  if (shouldClear) {
    await clearStoredActivationSessionToken({ storage });
  }

  return shouldClear;
}

export async function preserveLegacyActivationSlug({ slug, storage }) {
  if (!slug) return;
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;

  await resolvedStorage.setItem(LEGACY_ACQUISITION_SOURCE_SLUG_KEY, slug);
  await resolvedStorage.setItem(LEGACY_INVITE_SLUG_KEY, slug);
}

export async function startActivationSession({
  supabase,
  slug = null,
  entryMethod = "direct",
  landingUrl = null,
  referrer = null,
  utm = {},
  anonymousId = null,
  posthogDistinctId = null,
  clientPlatform = null,
  appVersion = null,
  runtimeVersion = null,
  metadata = {},
  internalTestStatus = "normal",
  storage = null,
} = {}) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const existingToken = await getStoredActivationSessionToken({ storage });
  const normalizedEntryMethod = normalizeEntryMethod(entryMethod);

  const { data, error } = await supabase.rpc("create_activation_session", {
    p_slug: slug || null,
    p_entry_method: normalizedEntryMethod,
    p_landing_url: landingUrl || null,
    p_referrer: referrer || null,
    p_utm: utm || {},
    p_anonymous_id: anonymousId || null,
    p_posthog_distinct_id: posthogDistinctId || null,
    p_client_platform: clientPlatform || null,
    p_app_version: appVersion || null,
    p_runtime_version: runtimeVersion || null,
    p_metadata: metadata || {},
    p_existing_public_token: existingToken || null,
    p_internal_test_status: internalTestStatus || "normal",
  });

  if (error) throw error;

  const session = getSessionRow(data);
  if (session?.public_token) {
    await storeActivationSessionToken({ token: session.public_token, storage });
  }

  if (slug) {
    await preserveLegacyActivationSlug({ slug, storage });
  }

  return session;
}

export async function identifyActivationSession({
  supabase,
  token = null,
  storage = null,
} = {}) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const publicToken = token || (await getStoredActivationSessionToken({ storage }));
  if (!publicToken) return null;

  const { data, error } = await supabase.rpc("identify_activation_session", {
    p_public_token: publicToken,
  });

  if (error) throw error;

  const session = getSessionRow(data);
  await clearExpiredOrConsumedActivationSession({ session, storage });
  return session;
}
