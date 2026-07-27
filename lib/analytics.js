// lib/analytics.js
import PostHog from "posthog-react-native";

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

export const posthog =
  key
    ? new PostHog(key, {
        host: host || "https://us.i.posthog.com",
        captureAppLifecycleEvents: true,
        captureApplicationLifecycleEvents: true,
        captureScreenViews: false,
        enableSessionReplay: true,
        flushAt: 1,
        flushInterval: 5000,
        autocapture: false,
      })
    : null;

async function waitForPostHogReady() {
  if (!posthog?.ready) return;
  try {
    await posthog.ready();
  } catch (e) {
    console.log("PostHog ready failed", e?.message || e);
  }
}

export function track(event, properties = {}) {
  if (!posthog) return;

  try {
    posthog.capture(event, {
      app: "keepr",
      ...properties,
    });
  } catch (e) {
    console.log("PostHog track failed", event, e);
  }
}

export async function flushAnalytics() {
  if (!posthog?.flush) return;

  try {
    await posthog.flush();
  } catch (e) {
    console.log("PostHog flush failed", e);
  }
}

export async function identifyUser(userId, properties = {}) {
  if (!posthog || !userId) return;

  try {
    await waitForPostHogReady();
    posthog.identify(userId, properties);
  } catch (e) {
    console.log("PostHog identify failed", e);
  }
}

export function resetAnalytics() {
  if (!posthog?.reset) return;

  try {
    posthog.reset();
  } catch (e) {
    console.log("PostHog reset failed", e?.message || e);
  }
}

export async function getPostHogAnonymousId() {
  if (!posthog?.getAnonymousId) return null;

  try {
    await waitForPostHogReady();
    return posthog.getAnonymousId() || null;
  } catch (e) {
    console.log("PostHog anonymous id read failed", e?.message || e);
    return null;
  }
}

export async function getPostHogDistinctId() {
  if (!posthog?.getDistinctId) return null;

  try {
    await waitForPostHogReady();
    return posthog.getDistinctId() || null;
  } catch (e) {
    console.log("PostHog distinct id read failed", e?.message || e);
    return null;
  }
}
