import {
  getStoredActivationSessionToken,
  preserveLegacyActivationSlug,
  storeActivationSessionToken,
} from "./activationSessions";
import { getKeeprBaseUrl } from "./inviteLinks";

export const SHARE_ACTION_OBJECT_TYPES = Object.freeze([
  "keepr",
  "public_story",
  "hub",
  "keeprpro",
  "asset",
  "system",
  "membership",
  "campaign",
  "service_ready",
  "invite",
]);

export const SHARE_ACTION_INTENDED_ACTIONS = Object.freeze([
  "signup",
  "create_first_asset",
  "view_story",
  "join_hub",
  "connect_provider",
  "claim_asset",
  "request_service",
]);

export const SHARE_ACTION_CHANNELS = Object.freeze([
  "native_share",
  "copy_link",
  "qr",
  "email",
  "sms",
  "facebook",
  "linkedin",
  "unknown",
]);

function getBrowserDetails() {
  if (typeof window === "undefined") {
    return {
      landingUrl: null,
      referrer: null,
      userAgent: null,
    };
  }

  return {
    landingUrl: window.location?.href || null,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent || null : null,
  };
}

function normalizeRpcRow(data) {
  return Array.isArray(data) ? data[0] : data || null;
}

function normalizeObjectType(value) {
  return SHARE_ACTION_OBJECT_TYPES.includes(value) ? value : "keepr";
}

function normalizeIntendedAction(value) {
  return SHARE_ACTION_INTENDED_ACTIONS.includes(value) ? value : "signup";
}

function normalizeChannel(value) {
  return SHARE_ACTION_CHANNELS.includes(value) ? value : "unknown";
}

export function buildShareActionUrl({ token, baseUrl = getKeeprBaseUrl() } = {}) {
  if (!token) return null;
  return `${String(baseUrl || getKeeprBaseUrl()).replace(/\/+$/, "")}/s/${encodeURIComponent(token)}`;
}

export function normalizeShareAction(row, { baseUrl = getKeeprBaseUrl() } = {}) {
  if (!row) return null;

  const publicToken = row.public_token || row.publicToken || null;
  return {
    id: row.share_action_id || row.id || null,
    publicToken,
    activationSourceId: row.activation_source_id || null,
    sharedObjectType: row.shared_object_type || null,
    sharedObjectId: row.shared_object_id || null,
    sharedObjectSlugSnapshot: row.shared_object_slug_snapshot || null,
    intendedAction: row.intended_action || null,
    channel: row.channel || null,
    status: row.status || null,
    rootShareActionId: row.root_share_action_id || null,
    parentShareActionId: row.parent_share_action_id || null,
    title: row.title || null,
    description: row.description || null,
    imageUrl: row.image_url || null,
    cta: row.cta || null,
    routeName: row.route_name || null,
    routePath: row.route_path || null,
    sourceSlugSnapshot: row.source_slug_snapshot || row.shared_object_slug_snapshot || null,
    activationSessionToken: row.activation_session_public_token || row.public_token || null,
    shareUrl: buildShareActionUrl({ token: publicToken, baseUrl }),
  };
}

export async function createShareAction({
  supabase,
  sharedObjectType = "keepr",
  sharedObjectId = null,
  intendedAction = "signup",
  channel = "unknown",
  campaignKey = null,
  parentShareActionId = null,
  metadata = {},
  baseUrl = getKeeprBaseUrl(),
} = {}) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");

  const { data, error } = await supabase.rpc("create_share_action", {
    p_shared_object_type: normalizeObjectType(sharedObjectType),
    p_shared_object_id: sharedObjectId || null,
    p_intended_action: normalizeIntendedAction(intendedAction),
    p_channel: normalizeChannel(channel),
    p_campaign_key: campaignKey || null,
    p_parent_share_action_id: parentShareActionId || null,
    p_metadata: metadata || {},
  });

  if (error) throw error;
  return normalizeShareAction(normalizeRpcRow(data), { baseUrl });
}

export async function openShareAction({
  supabase,
  token,
  landingUrl = null,
  referrer = null,
  anonymousId = null,
  posthogDistinctId = null,
  clientPlatform = null,
  appVersion = null,
  runtimeVersion = null,
  userAgent = null,
  storage = null,
  baseUrl = getKeeprBaseUrl(),
} = {}) {
  if (!supabase?.rpc) throw new Error("Missing Supabase client.");
  if (!token) throw new Error("Missing share token.");

  const browserDetails = getBrowserDetails();
  const existingToken = await getStoredActivationSessionToken({ storage });

  const { data, error } = await supabase.rpc("open_share_action", {
    p_public_token: token,
    p_existing_activation_session_token: existingToken || null,
    p_landing_url: landingUrl || browserDetails.landingUrl,
    p_referrer: referrer || browserDetails.referrer,
    p_anonymous_id: anonymousId || null,
    p_posthog_distinct_id: posthogDistinctId || null,
    p_client_platform: clientPlatform || null,
    p_app_version: appVersion || null,
    p_runtime_version: runtimeVersion || null,
    p_user_agent: userAgent || browserDetails.userAgent,
  });

  if (error) throw error;

  const row = normalizeRpcRow(data);
  const opened = normalizeShareAction(row, { baseUrl });
  const sessionToken = row?.activation_session_public_token || null;

  if (sessionToken) {
    await storeActivationSessionToken({ token: sessionToken, storage });
  }

  if (row?.source_slug_snapshot) {
    await preserveLegacyActivationSlug({ slug: row.source_slug_snapshot, storage });
  }

  return {
    ...opened,
    activationSessionToken: sessionToken,
    activationSessionStatus: row?.activation_session_status || null,
    sourceSlugSnapshot: row?.source_slug_snapshot || opened?.sourceSlugSnapshot || null,
    resolutionState: row?.resolution_state || null,
    entryMethod: row?.entry_method || null,
    expiresAt: row?.expires_at || null,
  };
}
