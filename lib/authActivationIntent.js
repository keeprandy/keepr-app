import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const AUTH_ACTIVATION_INTENT_KEY = "keepr.auth.activationIntent.v1";

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function buildHubQuickAddIntent({
  hubId = null,
  hubSlug = null,
  hubName = null,
  action = "add_asset",
  preferredAssetType = "vehicle",
  returnRoute = "ManageHubStories",
} = {}) {
  return {
    type: "hub_quick_add",
    action,
    hubId: clean(hubId),
    hubSlug: clean(hubSlug),
    hubName: clean(hubName),
    preferredAssetType: clean(preferredAssetType),
    returnRoute,
    createdAt: new Date().toISOString(),
  };
}

export async function storeAuthActivationIntent(intent) {
  if (!intent?.type) return null;
  const payload = JSON.stringify(intent);
  await AsyncStorage.setItem(AUTH_ACTIVATION_INTENT_KEY, payload);
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.sessionStorage?.setItem(AUTH_ACTIVATION_INTENT_KEY, payload);
    window.localStorage?.setItem(AUTH_ACTIVATION_INTENT_KEY, payload);
  }
  return intent;
}

export async function getStoredAuthActivationIntent() {
  const candidates = [];
  if (Platform.OS === "web" && typeof window !== "undefined") {
    candidates.push(
      window.sessionStorage?.getItem(AUTH_ACTIVATION_INTENT_KEY),
      window.localStorage?.getItem(AUTH_ACTIVATION_INTENT_KEY)
    );
  }
  candidates.push(await AsyncStorage.getItem(AUTH_ACTIVATION_INTENT_KEY).catch(() => null));

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type) return parsed;
    } catch {}
  }
  return null;
}

export async function clearStoredAuthActivationIntent() {
  await AsyncStorage.removeItem(AUTH_ACTIVATION_INTENT_KEY).catch(() => {});
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.sessionStorage?.removeItem(AUTH_ACTIVATION_INTENT_KEY);
    window.localStorage?.removeItem(AUTH_ACTIVATION_INTENT_KEY);
  }
}

export async function getActiveAuthActivationIntent(routeParams = {}) {
  if (routeParams?.activationIntent?.type) return routeParams.activationIntent;
  if (routeParams?.source === "hub_activation") {
    return buildHubQuickAddIntent({
      hubId: routeParams.hubId,
      hubSlug: routeParams.hubSlug,
      hubName: routeParams.hubName,
      action: routeParams.activationAction || "add_asset",
      preferredAssetType: routeParams.preferredAssetType || "vehicle",
      returnRoute: routeParams.returnTo || "ManageHubStories",
    });
  }
  return getStoredAuthActivationIntent();
}

export function hasPendingAuthActivationIntentSync() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  return Boolean(
    window.sessionStorage?.getItem(AUTH_ACTIVATION_INTENT_KEY) ||
      window.localStorage?.getItem(AUTH_ACTIVATION_INTENT_KEY)
  );
}
