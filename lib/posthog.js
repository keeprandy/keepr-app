import PostHog from "posthog-react-native";

export const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_KEY,
  {
    host:
      process.env.EXPO_PUBLIC_POSTHOG_HOST ||
      "https://us.i.posthog.com",

    captureApplicationLifecycleEvents: true,

    // IMPORTANT
    captureScreenViews: false,
    enableSessionReplay: true,

    flushAt: 1,
    flushInterval: 5000,

    // IMPORTANT
    autocapture: false,
  }
);