// lib/analytics.js
import PostHog from "posthog-react-native";

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

export const posthog =
  key
    ? new PostHog(key, {
        host: host || "https://us.i.posthog.com",
      })
    : null;

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

export function identifyUser(userId, properties = {}) {
  if (!posthog || !userId) return;

  try {
    posthog.identify(userId, properties);
  } catch (e) {
    console.log("PostHog identify failed", e);
  }
}