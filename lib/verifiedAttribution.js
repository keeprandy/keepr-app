import {
  clearStoredActivationSessionToken,
  getStoredActivationSessionToken,
  LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
  LEGACY_INVITE_SLUG_KEY,
} from "./activationSessions";

const DEFAULT_SHARE_BASE_URL = "https://www.keeprhome.com/invite";

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

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data || null;
}

export async function getStoredLegacySourceSlug({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return null;

  return (
    (await resolvedStorage.getItem(LEGACY_ACQUISITION_SOURCE_SLUG_KEY)) ||
    (await resolvedStorage.getItem(LEGACY_INVITE_SLUG_KEY)) ||
    null
  );
}

export async function completeSignupAttribution({
  supabase,
  storage = null,
  sourceSlug = null,
  activationObjectType = null,
  activationObjectId = null,
  intendedAction = "signup",
  shareBaseUrl = DEFAULT_SHARE_BASE_URL,
} = {}) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const activationSessionToken = await getStoredActivationSessionToken({ storage });
  const storedSourceSlug = sourceSlug || (await getStoredLegacySourceSlug({ storage }));

  const { data, error } = await supabase.rpc("complete_verified_attribution", {
    p_activation_session_token: activationSessionToken || null,
    p_source_slug: storedSourceSlug || null,
    p_activation_object_type: activationObjectType || null,
    p_activation_object_id: activationObjectId || null,
    p_intended_action: intendedAction || null,
    p_share_base_url: shareBaseUrl,
  });

  if (error) throw error;

  const result = firstRow(data);
  if (activationSessionToken && result?.activation_session_id) {
    await clearStoredActivationSessionToken({ storage });
  }

  return result;
}
