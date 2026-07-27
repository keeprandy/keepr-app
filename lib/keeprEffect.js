import { Platform } from "react-native";
import { supabase } from "./supabaseClient";
import { track } from "./analytics";
import { buildUserInviteUrl } from "./inviteLinks";

export const MEMBER_INVITE_CHANNELS = Object.freeze([
  "facebook",
  "linkedin",
  "text",
  "email",
  "copy_link",
  "qr",
  "native_share",
  "unknown",
]);

export const KEEPR_EFFECT_RECENT_WINDOWS = Object.freeze(["today", "7d", "30d"]);
export const DEFAULT_KEEPR_EFFECT_RECENT_WINDOW = "30d";

export function normalizeMemberInviteChannel(channel) {
  return MEMBER_INVITE_CHANNELS.includes(channel) ? channel : "unknown";
}

export function normalizeKeeprEffectRecentWindow(window) {
  return KEEPR_EFFECT_RECENT_WINDOWS.includes(window)
    ? window
    : DEFAULT_KEEPR_EFFECT_RECENT_WINDOW;
}

export function normalizeKeeprEffect(row = {}) {
  const sourceSlug = row?.source_slug || "";
  return {
    sourceSlug,
    activationSourceId: row?.activation_source_id || null,
    inviteUrl: sourceSlug ? buildUserInviteUrl({ sourceSlug }) : "",
    inviteVisits: Number(row?.invite_visits || 0),
    verifiedKeeprs: Number(row?.verified_keeprs || 0),
    activatedKeeprs: Number(row?.activated_keeprs || 0),
    assetsCreated: Number(row?.assets_created || 0),
    proofItemsAdded: Number(row?.proof_items_added || 0),
    downstreamKeeprs: Number(row?.downstream_keeprs || 0),
    recentImpact: Array.isArray(row?.recent_impact) ? row.recent_impact : [],
    sharesByChannel: row?.shares_by_channel || {},
    conversionsByChannel: row?.conversions_by_channel || {},
  };
}

export async function fetchMyKeeprEffect({ recentWindow = DEFAULT_KEEPR_EFFECT_RECENT_WINDOW } = {}) {
  const [effectResult, conversionsResult] = await Promise.all([
    supabase.rpc("get_my_keepr_effect", {
      p_recent_window: normalizeKeeprEffectRecentWindow(recentWindow),
    }),
    supabase.rpc("get_my_keepr_effect_channel_conversions"),
  ]);

  if (effectResult.error) throw effectResult.error;
  if (conversionsResult.error) throw conversionsResult.error;

  const row = Array.isArray(effectResult.data) ? effectResult.data[0] : effectResult.data;
  return normalizeKeeprEffect({
    ...(row || {}),
    conversions_by_channel: conversionsResult.data || {},
  });
}

export function trackMemberInviteShareInitiated({
  sourceSlug,
  activationSourceId,
  channel,
} = {}) {
  track("member_invite_share_initiated", {
    source_slug: sourceSlug || null,
    activation_source_id: activationSourceId || null,
    channel: normalizeMemberInviteChannel(channel),
    workflow_intent: "member_invite",
    platform: Platform.OS,
  });
}
