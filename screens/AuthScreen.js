// screens/AuthScreen.js

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "react-native";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing, typography } from "../styles/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { track } from "../lib/analytics";
import { claimPendingActionsForEmail } from "../lib/hubsApi";
import { completeSignupAttribution, getStoredLegacySourceSlug } from "../lib/verifiedAttribution";
import {
  identifyUserWithAcquisition,
  rememberAcquisitionContext,
} from "../lib/acquisitionContext";
import { DEFAULT_MEMBER_AVATAR } from "../lib/memberAvatar";
import { useAuth } from "../context/AuthContext";
import { profileIdentityValues } from "../lib/profileIdentityInitialization";
import {
  getActiveAuthActivationIntent,
  getStoredAuthActivationIntent,
  storeAuthActivationIntent,
} from "../lib/authActivationIntent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_MESSAGE_TOKEN_KEY = "keepr_pending_message_token";
const LOGIN_OAUTH_FRESH_USER_GRACE_MS = 5 * 60 * 1000;
const WEB_OAUTH_PROVIDERS = Object.freeze({
  apple: {
    label: "Continue with Apple",
    icon: "logo-apple",
  },
  google: {
    label: "Continue with Google",
    icon: "logo-google",
  },
});

function validateEmail(email) {
  const v = (email || "").trim();
  if (!v) return "Email is required.";
  if (!EMAIL_RE.test(v)) return "Enter a valid email address.";
  return null;
}

function validatePassword(password) {
  const v = password || "";
  if (!v) return "Password is required.";
  if (v.length < 8) return "Password must be at least 8 characters.";
  return null;
}

function friendlyAuthError(err) {
  const msg = (err?.message || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "Wrong email or password.";
  if (msg.includes("email not confirmed")) return "Please confirm your email, then sign in.";
  if (msg.includes("user already registered")) return "That email already has an account. Try signing in.";
  if (msg.includes("invalid email")) return "That email address isn’t valid.";
  if (msg.includes("pwned") || msg.includes("leaked") || msg.includes("compromised")) {
    return "That password appears in a leak. Use a different password.";
  }
  if (msg.includes("password")) return "Password doesn’t meet requirements.";
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return "Too many attempts. Try again in a few minutes.";
  }

  return err?.message || "Something went wrong. Please try again.";
}

function getResetRedirectTo() {
  if (Platform.OS === "web") {
    try {
      return `${window.location.origin}/reset`;
    } catch (_) {
      return "http://localhost:8081/reset";
    }
  }
  return "keepr://reset";
}

function getWebAuthRedirectTo() {
  if (Platform.OS !== "web") return undefined;
  try {
    const url = new URL("/auth", window.location.origin);
    url.searchParams.set("oauth", "1");
    return url.toString();
  } catch (_) {
    return "http://localhost:8081/auth?oauth=1";
  }
}

function getWebAuthRedirectToForIntent(oauthIntent = "signin") {
  const redirectTo = getWebAuthRedirectTo();
  if (!redirectTo || Platform.OS !== "web") return redirectTo;
  try {
    const url = new URL(redirectTo);
    url.searchParams.set("oauth_intent", oauthIntent === "signup" ? "signup" : "signin");
    const protectedReturnTo = getProtectedReturnTo();
    if (protectedReturnTo) url.searchParams.set("returnTo", protectedReturnTo);
    const returnTo = window.sessionStorage?.getItem("keepr.auth.activationIntent.v1") ||
      window.localStorage?.getItem("keepr.auth.activationIntent.v1");
    if (returnTo && !protectedReturnTo) url.searchParams.set("returnTo", "hub_activation");
    return url.toString();
  } catch (_) {
    return redirectTo;
  }
}

function getProtectedReturnTo(routeParams = null) {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const raw = routeParams?.returnTo || params.get("returnTo");
    if (!raw || raw === "hub_activation") return null;
    const decoded = raw.startsWith("/") ? raw : decodeURIComponent(raw);
    if (!decoded.startsWith("/")) return null;
    if (decoded.startsWith("//")) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

function continueProtectedReturnTo(returnToOverride = null) {
  const returnTo = returnToOverride || getProtectedReturnTo();
  if (!returnTo) return false;
  try {
    window.location.assign(returnTo);
    return true;
  } catch (_) {
    return false;
  }
}

function getOAuthErrorFromUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
    const error =
      url.searchParams.get("error_description") ||
      hash.get("error_description") ||
      url.searchParams.get("error") ||
      hash.get("error");
    return error ? decodeURIComponent(String(error).replace(/\+/g, " ")) : null;
  } catch (_) {
    return null;
  }
}

function getOAuthIntentFromUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return "signin";
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("oauth_intent") === "signup" ? "signup" : "signin";
  } catch (_) {
    return "signin";
  }
}

function hasOAuthCodeInUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    return Boolean(url.searchParams.get("code"));
  } catch (_) {
    return false;
  }
}

function hasOAuthFragmentInUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    return Boolean(hash.get("access_token") || hash.get("refresh_token"));
  } catch (_) {
    return false;
  }
}

function hasOAuthCallbackInUrl() {
  return hasOAuthCodeInUrl() || hasOAuthFragmentInUrl();
}

function cleanAuthUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.history.replaceState(window.history.state, "", "/auth");
  } catch (_) {}
}

async function getExistingProfileForUser(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function isFreshOAuthUser(authUser) {
  const createdAt = Date.parse(authUser?.created_at || "");
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt < LOGIN_OAUTH_FRESH_USER_GRACE_MS;
}

function profileNameFromUser(authUser, fallbackName = null) {
  const meta = authUser?.user_metadata || {};
  return (
    fallbackName ||
    meta.full_name ||
    meta.name ||
    [meta.given_name, meta.family_name].filter(Boolean).join(" ") ||
    null
  );
}

function isUsableInviteName(value) {
  const name = String(value || "").trim();
  return !!name && name.toLowerCase() !== "keepr member";
}

function resolveInviteDisplayName(invitation) {
  return isUsableInviteName(invitation?.display_name)
    ? invitation.display_name.trim()
    : null;
}

function isValidImageUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export default function AuthScreen({ navigation, route }) {
  const { initializing, user } = useAuth();
  const [mode, setMode] = useState(route?.params?.mode === "signup" || route?.params?.source === "hub_activation" ? "signup" : "signin"); // "signin" | "signup" | "forgot"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthResolving, setOauthResolving] = useState(
    Platform.OS === "web" && hasOAuthCallbackInUrl()
  );
  const [inviteContext, setInviteContext] = useState(route?.params?.invitation || null);
  const [inviteLoading, setInviteLoading] = useState(!!route?.params?.invitationLoading);
  const [inviteImageBroken, setInviteImageBroken] = useState(false);
  const [mobileWebAuthEnabled, setMobileWebAuthEnabled] = useState(false);
  const scrollRef = useRef(null);
  const formAnchorRef = useRef(null);
  const passwordInputRef = useRef(null);
  const oauthHandledRef = useRef(false);

  const [touched, setTouched] = useState({
    email: false,
    password: false,
    displayName: false,
  });
  const [formError, setFormError] = useState("");


  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const mobileUserAgent =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isMobileWeb = isWeb && width < 760;
  const isMobileDeviceWeb = isWeb && mobileUserAgent;
  const isIOSMobileWeb =
    isWeb &&
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";
  const showPasswordToggle = isWeb && !isSignUp && !isForgot;
  const hasInviteIntent = route?.params?.source === "member_invite" || !!route?.params?.inviteSlug;
  const isSignedInInvite = hasInviteIntent && !!user?.id;
  const showDesktopSplit = isWeb && !isMobileWeb && !hasInviteIntent && width >= 1360;
  const showStackedMarketing = isWeb && !isMobileWeb && !hasInviteIntent && !showDesktopSplit;
  const desktopGap = width < 1360 ? 24 : 40;
  const desktopPadding = width < 1360 ? 24 : 48;
  const desktopVerticalPadding = width < 1360 ? 24 : 32;
  const desktopBrandMax = width < 1360 ? 520 : 620;
  const desktopLoginMax = width < 1360 ? 640 : 700;
  const marketingImageRatio = 1024 / 1536;
  const stackedMarketingWidth = Math.min(Math.max(width - 48, 0), 760);
  const stackedMarketingHeight = Math.min(
    Math.round(stackedMarketingWidth * marketingImageRatio),
    360
  );

  const inviterName = resolveInviteDisplayName(inviteContext);
  const inviteTitle = inviterName
    ? `${inviterName} invited you to Keepr`
    : "A Keepr member invited you.";
  const invitePhotoUrl = isValidImageUrl(inviteContext?.image_url) && !inviteImageBroken
    ? inviteContext.image_url.trim()
    : null;
  const shouldShowWebAuth = !isSignedInInvite && (!isMobileWeb || mobileWebAuthEnabled);

  useEffect(() => {
    if (route?.params?.mode === "signup") setMode("signup");
    if (route?.params?.mode === "signin") setMode("signin");
    if (route?.params?.source === "hub_activation") setMode("signup");
  }, [route?.params?.mode]);

  useEffect(() => {
    if (route?.params?.invitation) {
      setInviteContext(route.params.invitation);
      setInviteLoading(!!route?.params?.invitationLoading);
      setInviteImageBroken(false);
    }
  }, [route?.params?.invitation, route?.params?.invitationLoading]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (oauthHandledRef.current) return;

    const isOAuthCallback = hasOAuthCallbackInUrl();

    const oauthError = getOAuthErrorFromUrl();
    if (oauthError) {
      oauthHandledRef.current = true;
      setOauthResolving(false);
      setFormError(oauthError.includes("access_denied") ? "Sign-in was canceled." : oauthError);
      cleanAuthUrl();
      return;
    }

    if (!isOAuthCallback) return;

    oauthHandledRef.current = true;
    let mounted = true;
    let settled = false;
    let subscription = null;

    const finishWithSession = async (session, source) => {
      const authUser = session?.user || null;
      const oauthIntent = getOAuthIntentFromUrl();
      if (!authUser?.id) return false;
      settled = true;

      const activationIntent = await getStoredAuthActivationIntent();
      const isHubActivation = activationIntent?.type === "hub_quick_add";
      const existingProfile = await getExistingProfileForUser(authUser.id);
      if (
        !isHubActivation &&
        oauthIntent !== "signup" &&
        (!existingProfile?.id || isFreshOAuthUser(authUser))
      ) {
        await supabase.auth.signOut();
        cleanAuthUrl();
        setMode("signin");
        setFormError(
          "No Keepr account is connected to that Google or Apple sign-in yet. Sign in with your Keepr email first, then connect Google or Apple in Settings. To create a new account, choose Become a Keepr."
        );
        return true;
      }

      await ensureProfile(authUser.id, {
        authUser,
        email: authUser.email,
        policyAccepted: true,
        onboardingState: isHubActivation ? "partial" : undefined,
      });
      if (authUser.email) {
        await claimPendingActionsForEmail({
          userId: authUser.id,
          email: authUser.email,
        });
      }
      const protectedReturnTo = getProtectedReturnTo(route?.params || null);
      cleanAuthUrl();
      if (await continueActivationJourney()) return true;
      if (continueProtectedReturnTo(protectedReturnTo)) return true;
      return true;
    };

    const finishOAuth = async () => {
      try {
        setSubmitting(true);
        setOauthResolving(true);
        setFormError("");

        if (hasOAuthCodeInUrl()) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          if (await finishWithSession(data?.session, "exchangeCodeForSession")) return;
          throw new Error("We could not finish sign-in. Please try again.");
        } else {
          const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted || settled) return;
            if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
              try {
                const finished = await finishWithSession(session, `onAuthStateChange:${event}`);
                if (finished && mounted) {
                  setSubmitting(false);
                  setOauthResolving(false);
                }
              } catch (e) {
                if (!mounted) return;
                setFormError(friendlyAuthError(e));
                setSubmitting(false);
                setOauthResolving(false);
              }
            }
          });
          subscription = listener?.subscription || null;

          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (await finishWithSession(data?.session, "getSession")) return;

          setTimeout(() => {
            if (!mounted || settled) return;
            setFormError("We could not finish sign-in. Please try again.");
            setSubmitting(false);
            setOauthResolving(false);
          }, 8000);
        }
      } catch (e) {
        if (!mounted) return;
        setFormError(friendlyAuthError(e));
        setOauthResolving(false);
      } finally {
        if (mounted && settled) {
          setSubmitting(false);
          setOauthResolving(false);
        }
      }
    };

    finishOAuth();
    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, [route?.params]);

  useEffect(() => {
    let mounted = true;
    const slug = route?.params?.inviteSlug;

    if (!slug || route?.params?.invitation) return undefined;

    const loadInvite = async () => {
      setInviteLoading(true);
      try {
        const { data } = await supabase.rpc("resolve_member_invite_link", {
          p_slug: slug,
        });
        if (!mounted) return;
        setInviteContext(Array.isArray(data) ? data[0] || null : data || null);
        setInviteImageBroken(false);
      } catch (e) {
        console.log("[AuthScreen] invitation load failed:", e?.message || e);
      } finally {
        if (mounted) setInviteLoading(false);
      }
    };

    loadInvite();
    return () => {
      mounted = false;
    };
  }, [route?.params?.inviteSlug, route?.params?.invitation]);

  const iosUrl = "https://apps.apple.com/us/app/keepr-home-asset-care/id6761725280";
  const androidUrl = "https://play.google.com/store/apps/details?id=com.keeprhome.app";

  const title = useMemo(() => {
    if (isForgot) return "Reset your password";
    if (isSignUp) return "Become a Keepr";
    return "Sign in to Keepr™";
  }, [isForgot, isSignUp]);

  const subtitle = useMemo(() => {
    if (Platform.OS === "web") {
      if (hasInviteIntent && isSignUp) {
        return "Become a Keepr and carry the invitation forward.";
      }
      if (hasInviteIntent && !isForgot) {
        return "Sign in to continue from this invitation.";
      }
      if (isSignUp) {
        return "Become a Keepr and start building the story of what you own.";
      }
      if (isForgot) {
        return "Enter your email and we’ll send a reset link.";
      }
      return "Sign in to continue your ownership story.";
    }

    if (isSignUp) return "Get started.";
    if (isForgot) return "Enter your email to reset your password.";
    return "Continue your ownership story.";
  }, [hasInviteIntent, isForgot, isSignUp]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailErr = useMemo(() => validateEmail(normalizedEmail), [normalizedEmail]);
  const passwordErr = useMemo(() => (isForgot ? null : validatePassword(password)), [isForgot, password]);

  const canSubmit = !submitting && !emailErr && !passwordErr;

  const toggleLoginPasswordVisibility = () => {
    setShowLoginPassword((visible) => !visible);
    if (Platform.OS === "web" && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => passwordInputRef.current?.focus?.());
    }
  };

  const ensureProfile = async (userId, options = {}) => {
    const authUser = options.authUser || null;
    const profileEmail = String(
      options.email ||
        normalizedEmail ||
        authUser?.email ||
        ""
    ).trim().toLowerCase();
    const profileName = profileNameFromUser(authUser, displayName?.trim() || null);
    const { data: existingProfile, error: readError } = await supabase
      .from("profiles")
      .select("id,email,preferred_contact_email,display_name,full_name,onboarding_state,profile_photo_url,provisional_slug,profile_initialized_at,policy_accepted_at,policy_version,acquisition_source_slug")
      .eq("id", userId)
      .maybeSingle();
    if (readError) throw readError;

    const identityValues = profileIdentityValues({
      authUser: { ...authUser, id: userId },
      email: profileEmail,
      displayName: profileName,
      policyAccepted: !!options.policyAccepted,
    });
    if (options.onboardingState) {
      identityValues.onboarding_state = options.onboardingState;
    }

    if (!existingProfile?.id) {
      const profilePayload = {
        id: userId,
        email: identityValues.email,
        preferred_contact_email: identityValues.preferred_contact_email,
        onboarding_state: identityValues.onboarding_state,
        provisional_slug: identityValues.provisional_slug,
        profile_initialized_at: identityValues.profile_initialized_at,
        policy_accepted_at: identityValues.policy_accepted_at,
        policy_version: identityValues.policy_version,
      };
      if (identityValues.acquisition_source_slug) {
        profilePayload.acquisition_source_slug = identityValues.acquisition_source_slug;
      }
      if (identityValues.display_name) profilePayload.display_name = identityValues.display_name;
      if (identityValues.full_name) profilePayload.full_name = identityValues.full_name;
      if (identityValues.profile_photo_url) profilePayload.profile_photo_url = identityValues.profile_photo_url;
      const { error } = await supabase.from("profiles").insert(profilePayload);
      if (error) throw error;
      return;
    }

    const updates = {};
    if (profileEmail && !existingProfile.email) updates.email = profileEmail;
    if (identityValues.preferred_contact_email && !existingProfile.preferred_contact_email) {
      updates.preferred_contact_email = identityValues.preferred_contact_email;
    }
    if (profileName && !isUsableInviteName(existingProfile.display_name)) {
      updates.display_name = profileName;
    }
    if (profileName && !isUsableInviteName(existingProfile.full_name)) {
      updates.full_name = profileName;
    }
    if (identityValues.profile_photo_url && !existingProfile.profile_photo_url) {
      updates.profile_photo_url = identityValues.profile_photo_url;
    }
    if (identityValues.provisional_slug && !existingProfile.provisional_slug) {
      updates.provisional_slug = identityValues.provisional_slug;
    }
    if (identityValues.acquisition_source_slug && !existingProfile.acquisition_source_slug) {
      updates.acquisition_source_slug = identityValues.acquisition_source_slug;
    }
    if (!existingProfile.profile_initialized_at) {
      updates.profile_initialized_at = identityValues.profile_initialized_at;
    }
    if (identityValues.policy_accepted_at && !existingProfile.policy_accepted_at) {
      updates.policy_accepted_at = identityValues.policy_accepted_at;
      updates.policy_version = identityValues.policy_version;
    }
    if (Object.keys(updates).length) {
      const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
      if (error) throw error;
    }
  };

  const markAllTouched = () => {
    setTouched((t) => ({
      ...t,
      email: true,
      password: true,
      displayName: true,
    }));
  };

  const openAppStore = () => {
    if (typeof navigator === "undefined") return;
    window.location.href = isIOSMobileWeb ? iosUrl : androidUrl;
  };

  const openKeeprApp = () => {
    const slug = route?.params?.inviteSlug || inviteContext?.slug || inviteContext?.normalized_slug || null;
    const cleanSlug = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
    const appUrl = cleanSlug ? `keepr://invite/${encodeURIComponent(cleanSlug)}` : "keepr://";

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = appUrl;
      return;
    }

    Linking.openURL(appUrl).catch(() => {});
  };

  const continueOnWeb = () => {
    setMobileWebAuthEnabled(true);
    setMode(hasInviteIntent ? "signup" : mode);
    setFormError("");
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const continueToKeepr = () => {
    continueActivationJourney().then((continued) => {
      if (continued) return;
      navigation.reset?.({
        index: 0,
        routes: [{ name: "RootTabs" }],
      });
    });
  };

  const signInAsSomeoneElse = async () => {
    try {
      setSubmitting(true);
      await supabase.auth.signOut();
      setMode("signin");
      setMobileWebAuthEnabled(true);
      setFormError("");
    } catch (e) {
      setFormError(e?.message || "Could not sign out.");
    } finally {
      setSubmitting(false);
    }
  };

  const openKeeprHome = () => {
    if (Platform.OS !== "web") {
      Linking.openURL("https://keeprhome.com").catch(() => {});
      return;
    }

    try {
      window.location.href = "https://keeprhome.com";
    } catch (_) {
      Linking.openURL("https://keeprhome.com").catch(() => {});
    }
  };

  const jumpToAuthForm = () => {
    if (!hasInviteIntent) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (!showDesktopSplit) {
        requestAnimationFrame(() => {
          const firstFormInput =
            typeof document !== "undefined"
              ? document.querySelector('input[type="email"]') ||
                document.querySelector('input[placeholder="Keepr"]')
              : null;

          (firstFormInput || formAnchorRef.current)?.scrollIntoView?.({
            behavior: "smooth",
            block: "center",
          });
        });
      }
      return;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo?.({ y: 360, animated: true });
    });
  };

const continueActivationJourney = async () => {
  const activationIntent = await getActiveAuthActivationIntent(route?.params || {});
  if (activationIntent?.type === "hub_quick_add") {
    if (route?.params?.activationIntent?.type) {
      await storeAuthActivationIntent(route.params.activationIntent);
    }
    const returnRoute =
      activationIntent.returnRoute === "AddHubStory"
        ? "AddHubStory"
        : "HubQuickAddCar";
    navigation.replace(returnRoute, {
      ...(returnRoute === "HubQuickAddCar" ? { slug: activationIntent.hubSlug } : null),
      hubId: activationIntent.hubId,
      hubSlug: activationIntent.hubSlug,
      hubName: activationIntent.hubName,
      activationMode: returnRoute === "AddHubStory",
    });
    return true;
  }

  if (hasInviteIntent) {
    try {
      const sourceSlug =
        route?.params?.inviteSlug ||
        inviteContext?.slug ||
        inviteContext?.normalized_slug ||
        (await getStoredLegacySourceSlug({ storage: AsyncStorage }));

      await completeSignupAttribution({
        supabase,
        storage: AsyncStorage,
        sourceSlug,
        intendedAction: "signup",
      });
    } catch (e) {
      console.log("[AuthScreen] invite attribution completion failed:", e?.message || e);
    }

    navigation.reset?.({
      index: 0,
      routes: [{ name: "RootTabs" }],
    });
    return true;
  }

  const messageToken =
    route?.params?.messageToken ||
    (await AsyncStorage.getItem(PENDING_MESSAGE_TOKEN_KEY).catch(() => null));

  if (messageToken) {
    navigation.replace("MessageLink", {
      token: messageToken,
      intent: "claim_message_link",
    });
    return true;
  }

  const intent = route?.params?.intent;

  if (intent !== "accept_hub_invite") return false;

  const inviteToken = route?.params?.inviteToken;
  const hubSlug = route?.params?.hubSlug;

  if (!inviteToken || !hubSlug) return false;

  navigation.replace("KeeprHub", {
    slug: hubSlug,
    invite: inviteToken,
    inviteToken,
    intent: "accept_hub_invite",
    src: "hub_invite",
  });

  return true;
};

  const handleOAuthSignIn = async (provider) => {
    if (Platform.OS !== "web") {
      setFormError("Google and Apple sign-in are available on Keepr Web in this pass.");
      return;
    }

    try {
      setSubmitting(true);
      setFormError("");
      const activationIntent = await getActiveAuthActivationIntent(route?.params || {});
      if (activationIntent?.type) await storeAuthActivationIntent(activationIntent);
      const oauthIntent = isSignUp || activationIntent?.type === "hub_quick_add" ? "signup" : "signin";

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getWebAuthRedirectToForIntent(oauthIntent),
          queryParams:
            provider === "google"
              ? {
                  prompt: "select_account",
                }
              : undefined,
        },
      });

      if (error) throw error;
      if (data?.url && typeof window !== "undefined") {
        window.location.assign(data.url);
      }
    } catch (e) {
      setFormError(friendlyAuthError(e));
      setSubmitting(false);
    }
  };

  const handleSignIn = async () => {
    setFormError("");
    markAllTouched();

    const eErr = validateEmail(normalizedEmail);
    if (eErr) return;
    if (!password) return;

    try {
      setSubmitting(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setFormError(friendlyAuthError(error));
        return;
      }

      const userId = data?.user?.id;
      if (userId) {
        try {
          await ensureProfile(userId, {
            authUser: data?.user,
            email: normalizedEmail,
          });

          // NEW
          await claimPendingActionsForEmail({
            userId,
            email: normalizedEmail,
          });

        } catch (e) {
          console.log("[AuthScreen] profile/claim failed:", e?.message || e);
        }

        const continued = await continueActivationJourney();
        if (continued) return;
        if (continueProtectedReturnTo(route?.params?.returnTo || null)) return;
      }
      
    } catch (e) {
      setFormError(e?.message || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setFormError("");
    setTouched((t) => ({ ...t, email: true }));

    const e = (email || "").trim().toLowerCase();
    const eErr = validateEmail(e);
    if (eErr) return;

    try {
      setSubmitting(true);

      const redirectTo = getResetRedirectTo();
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });

      if (error) {
        setFormError(friendlyAuthError(error));
        return;
      }

      Alert.alert(
        "Check your email",
        "We sent a password reset link. Open it on this device to set a new password."
      );
      setMode("signin");
    } catch (e) {
      setFormError(e?.message || "Could not send reset email.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async () => {
    setFormError("");
    markAllTouched();

    const eErr = validateEmail(normalizedEmail);
    const pErr = validatePassword(password);
    if (eErr || pErr) return;

    try {
      setSubmitting(true);

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            display_name: displayName?.trim() || null,
          },
        },
      });

      if (error) {
        setFormError(friendlyAuthError(error));
        return;
      }

      const activationIntent = await getActiveAuthActivationIntent(route?.params || {});
      if (activationIntent?.type) await storeAuthActivationIntent(activationIntent);

      const user = data?.session?.user || null;    
      const sessionUserId = user?.id || null;

      if (!sessionUserId) {
      setMode("signin");
      setPassword("");
      setFormError(
        "Account created. Sign in to continue your Hub invitation."
      );
      return;
    }

	if (sessionUserId) {
	  await ensureProfile(sessionUserId, {
    authUser: user,
    email: normalizedEmail,
    policyAccepted: true,
    onboardingState: activationIntent?.type === "hub_quick_add" ? "partial" : undefined,
  });

  await claimPendingActionsForEmail({
    userId: sessionUserId,
    email: normalizedEmail,
  });

  // 🔥 Attribution capture
  let sourceSlug = null;
  let verifiedAttribution = null;

  try {
    sourceSlug = await getStoredLegacySourceSlug({ storage: AsyncStorage });
  } catch (e) {
    console.log("[AuthScreen] attribution read failed:", e?.message || e);
  }

  try {
    verifiedAttribution = await completeSignupAttribution({
      supabase,
      storage: AsyncStorage,
      sourceSlug,
      intendedAction: "signup",
    });
  } catch (e) {
    console.log("[AuthScreen] verified attribution failed:", e?.message || e);

    if (sourceSlug) {
      try {
        await supabase
          .from("profiles")
          .update({
            acquisition_source_slug: sourceSlug,
          })
          .eq("id", sessionUserId);
      } catch (profileError) {
        console.log("[AuthScreen] attribution save failed:", profileError?.message || profileError);
      }
    }
  }

 const continued = await continueActivationJourney();
if (continued) return;

  // 🔥 Identify + track
  try {
    const acquisitionContext = rememberAcquisitionContext(sessionUserId, {
      ...verifiedAttribution,
      acquisition_source_slug: verifiedAttribution?.source_slug_snapshot || sourceSlug || null,
      acquisition_workflow_intent: "signup",
    });

    await identifyUserWithAcquisition(sessionUserId, {
      email: normalizedEmail || user?.email || null,
      acquisition_source_slug: sourceSlug,
      activation_attribution_id: verifiedAttribution?.attribution_record_id || null,
      activation_identity_slug: verifiedAttribution?.canonical_slug || null,
    });

    track("user_signed_up", {
      source_slug: sourceSlug,
      has_attribution: !!sourceSlug,
      attribution_record_id: verifiedAttribution?.attribution_record_id || null,
      activation_session_id: verifiedAttribution?.activation_session_id || null,
      activation_source_id: verifiedAttribution?.activation_source_id || null,
      activation_identity_slug: verifiedAttribution?.canonical_slug || null,
      acquisition_source_slug: acquisitionContext.acquisition_source_slug,
      acquisition_source_id: acquisitionContext.acquisition_source_id,
      acquisition_session_id: acquisitionContext.acquisition_session_id,
      acquisition_attribution_record_id: acquisitionContext.acquisition_attribution_record_id,
      acquisition_workflow_intent: acquisitionContext.acquisition_workflow_intent,
      platform: Platform.OS,
    });
  } catch (e) {
    console.log("[AuthScreen] posthog failed:", e?.message || e);
  }
}

      Alert.alert(
        "Account created",
        sessionUserId
          ? "You're in. Continue to the app."
          : "Check your email to confirm your account, then sign in."
      );
    } catch (e) {
      setFormError(e?.message || "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = isForgot ? handleForgotPassword : isSignUp ? handleSignUp : handleSignIn;

  const renderAuthCardContent = () => (
    <>
      {oauthResolving || initializing ? (
        <View style={styles.oauthResolvingCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.oauthResolvingTitle}>Finishing sign-in...</Text>
          <Text style={styles.oauthResolvingText}>Keepr is securely completing your session.</Text>
        </View>
      ) : (
        <>
      {hasInviteIntent ? (
        <View style={styles.inviteCard}>
          <View style={styles.inviteImageFrame}>
            <Image
              source={invitePhotoUrl ? { uri: invitePhotoUrl } : DEFAULT_MEMBER_AVATAR}
              style={[
                styles.inviteImage,
                !invitePhotoUrl && styles.inviteFallbackImage,
              ]}
              onError={() => {
                if (invitePhotoUrl) setInviteImageBroken(true);
              }}
            />
          </View>

          <View style={styles.inviteContent}>
            <View style={styles.inviteBrandRow}>
              <Text style={styles.inviteBrand}>Keepr</Text>
              <View style={styles.inviteMark}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.inviteTitle}>{inviteTitle}</Text>
            <Text style={styles.inviteTagline}>I’m a Keepr. Become one.</Text>
            <Text style={styles.inviteBody}>
              Start with a trusted place for the records, proof, and stories behind what you own.
            </Text>

            {inviteLoading ? (
              <ActivityIndicator
                color={colors.brandBlue || "#2563EB"}
                style={styles.inviteLoader}
              />
            ) : null}

            {isSignedInInvite ? (
              <>
                <Text style={styles.inviteSignedInText}>You’re already a Keepr.</Text>
                <TouchableOpacity
                  style={styles.invitePrimary}
                  onPress={continueToKeepr}
                  activeOpacity={0.9}
                  disabled={submitting}
                >
                  <Text style={styles.invitePrimaryText}>Continue to Keepr</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.inviteSecondary}
                  onPress={signInAsSomeoneElse}
                  activeOpacity={0.85}
                  disabled={submitting}
                >
                  <Text style={styles.inviteSecondaryText}>Sign in as someone else</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.invitePrimary}
                  onPress={() => {
                    if (isMobileDeviceWeb) {
                      openKeeprApp();
                      return;
                    }
                    setMode("signup");
                    setFormError("");
                    jumpToAuthForm();
                  }}
                  activeOpacity={0.9}
                  disabled={submitting}
                >
                  <Text style={styles.invitePrimaryText}>
                    {isMobileDeviceWeb ? "Open in Keepr" : "Become a Keepr"}
                  </Text>
                </TouchableOpacity>
                {isMobileWeb ? (
                  <>
                    {isMobileDeviceWeb ? (
                      <TouchableOpacity
                        style={styles.inviteStoreButton}
                        onPress={openAppStore}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.inviteStoreButtonText}>
                          {isIOSMobileWeb ? "Get Keepr for iPhone" : "Get Keepr for Android"}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.inviteSecondary}
                      onPress={continueOnWeb}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.inviteSecondaryText}>Continue on the web</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.inviteSecondary}
                    onPress={() => {
                      setMode("signin");
                      setFormError("");
                      jumpToAuthForm();
                    }}
                    activeOpacity={0.85}
                    disabled={submitting}
                  >
                    <Text style={styles.inviteSecondaryText}>Already a Keepr? Sign in</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            <TouchableOpacity
              style={styles.inviteLearnLink}
              onPress={openKeeprHome}
              activeOpacity={0.75}
            >
              <Text style={styles.inviteLearnText}>
                {isMobileWeb ? "Learn more about Keepr" : "Learn more at keeprhome.com"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {isMobileWeb && !hasInviteIntent ? (
        <View style={styles.mobileAppGate}>
          <Image
            source={require("../assets/app_logo_icon.png")}
            style={styles.logo}
          />
          <Text style={styles.mobileAppGateTitle}>Get Keepr on your phone</Text>
          <Text style={styles.mobileAppGateBody}>
            Keepr on mobile is the place to capture photos, records, proof, and stories as you go.
          </Text>
          <TouchableOpacity
            style={styles.mobileAppGateButton}
            onPress={openAppStore}
            activeOpacity={0.9}
          >
            <Ionicons
              name="download-outline"
              size={18}
              color={colors.brandWhite}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.mobileAppGateButtonText}>
              {isIOSMobileWeb ? "Get Keepr for iPhone" : "Get Keepr for Android"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mobileWebContinueButton}
            onPress={continueOnWeb}
            activeOpacity={0.85}
          >
            <Text style={styles.mobileWebContinueText}>Continue on the web</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.inviteLearnLink}
            onPress={openKeeprHome}
            activeOpacity={0.75}
          >
            <Text style={styles.inviteLearnText}>Learn more about Keepr</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {shouldShowWebAuth ? (
        <>
      <View ref={formAnchorRef} style={styles.header}>
        <View style={styles.brandRow}>
          <Image
            source={require("../assets/app_logo_icon.png")}
            style={styles.logo}
          />
          <View style={styles.brandTextWrap}>
            <Text style={styles.brand}>Keepr™</Text>
            <Text style={styles.brandSub}>Asset Lifecycle Intelligence</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {!isForgot && (
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modePill, mode === "signin" && styles.modePillActive]}
            onPress={() => {
              setMode("signin");
              setFormError("");
            }}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.modePillText,
                mode === "signin" && styles.modePillTextActive,
              ]}
            >
              Sign in
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modePill, mode === "signup" && styles.modePillActive]}
            onPress={() => {
              setMode("signup");
              setFormError("");
            }}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.modePillText,
                mode === "signup" && styles.modePillTextActive,
              ]}
            >
              Become a Keepr
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.form}>
        {!isForgot && Platform.OS === "web" ? (
          <View style={styles.socialAuthGroup}>
            {Object.entries(WEB_OAUTH_PROVIDERS).map(([provider, config]) => (
              <TouchableOpacity
                key={provider}
                style={[styles.socialButton, submitting && styles.buttonDisabled]}
                onPress={() => handleOAuthSignIn(provider)}
                disabled={submitting}
                activeOpacity={0.86}
              >
                <Ionicons
                  name={config.icon}
                  size={20}
                  color={provider === "apple" ? "#111827" : colors.primary}
                />
                <Text style={styles.socialButtonText}>{config.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.emailDivider}>
              <View style={styles.emailDividerLine} />
              <Text style={styles.emailDividerText}>Continue with email</Text>
              <View style={styles.emailDividerLine} />
            </View>
            {isSignUp ? (
              <Text style={styles.identityLinkHint}>
                Already have Keepr? Sign in first, then connect Google or Apple in Settings.
              </Text>
            ) : (
              <Text style={styles.identityLinkHint}>
                Google or Apple sign-in works after it has been connected to your Keepr account in Settings.
              </Text>
            )}
            <Text style={styles.identityLinkHint}>
              By continuing, you agree to Keepr’s Terms and Privacy Policy.
            </Text>
          </View>
        ) : null}

        {isSignUp && (
          <>
            <Text style={styles.label}>Name (optional)</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={(v) => {
                setDisplayName(v);
                if (formError) setFormError("");
              }}
              onBlur={() => setTouched((t) => ({ ...t, displayName: true }))}
              placeholder="Keepr"
              placeholderTextColor={colors.textMuted}
            />
            <View style={{ height: spacing.md }} />
          </>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (formError) setFormError("");
          }}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          style={[styles.input, touched.email && emailErr ? styles.inputError : null]}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.textMuted}
        />
        {touched.email && emailErr ? <Text style={styles.errorText}>{emailErr}</Text> : null}

        {!isForgot && (
          <>
            <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
            {showPasswordToggle ? (
              <View
                style={[
                  styles.passwordInputWrap,
                  touched.password && passwordErr ? styles.inputError : null,
                ]}
              >
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    if (formError) setFormError("");
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  style={[styles.input, styles.passwordInput]}
                  secureTextEntry={!showLoginPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                />
                <TouchableOpacity
                  onPress={toggleLoginPasswordVisibility}
                  style={styles.passwordToggle}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={showLoginPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons
                    name={showLoginPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            ) : (
              <TextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (formError) setFormError("");
                }}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                style={[styles.input, touched.password && passwordErr ? styles.inputError : null]}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
              />
            )}
            {touched.password && passwordErr ? <Text style={styles.errorText}>{passwordErr}</Text> : null}
            {isSignUp ? (
              <Text style={styles.hintText}>
                Use at least 8 characters. Keepr is private and secure.
              </Text>
            ) : null}
          </>
        )}

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <TouchableOpacity
          style={[styles.button, !canSubmit ? styles.buttonDisabled : null]}
          onPress={onSubmit}
          activeOpacity={0.85}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.brandWhite} />
          ) : (
            <>
              <Ionicons
                name={
                  isForgot
                    ? "mail-outline"
                    : isSignUp
                    ? "person-add-outline"
                    : "log-in-outline"
                }
                size={18}
                color={colors.brandWhite}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.buttonText}>
                {isForgot ? "Send reset link" : isSignUp ? "Become a Keepr" : "Sign in"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {!isForgot ? (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => {
              setMode("forgot");
              setFormError("");
            }}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.forgotLinkText}>Forgot password?</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => {
              setMode("signin");
              setFormError("");
            }}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.forgotLinkText}>Back to sign in</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.helperText}>
          Mobile is great for quick capture and action, and also has full functionality.{" "}
          <Text style={{ fontWeight: "600" }}>
            Use Keepr Web for deeper setup and organization.
          </Text>
        </Text>

        {Platform.OS === "web" && (
          <>
            <Text style={styles.helperText}>
              Tip: You will be able to change your email and password later.
            </Text>

            <Text style={styles.trustText}>
              We do not share your data. We do not use your data to train our system.
            </Text>
          </>
        )}
      </View>
        </>
      ) : null}
        </>
      )}
    </>
  );

  return (
    <SafeAreaView style={layoutStyles.screen}>
      {isMobileWeb ? (
        <ScrollView
          ref={scrollRef}
          style={styles.mobileScroll}
          contentContainerStyle={styles.mobileScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.mobileCardWrap}>
            <View style={[styles.authCard, styles.authCardMobileWeb]}>
              {renderAuthCardContent()}
            </View>
          </View>
        </ScrollView>
      ) : showStackedMarketing ? (
        <ScrollView
          style={styles.webStackScroll}
          contentContainerStyle={styles.webStackScrollContent}
        >
          <View style={[styles.container, styles.singleColumnContainer]}>
            <View
              style={[
                styles.brandPanel,
                styles.brandPanelStacked,
                { minHeight: stackedMarketingHeight + 190 },
              ]}
            >
              <View style={[styles.brandContent, styles.brandContentStacked]}>
                <Image
                  source={require("../assets/login_image_keepr.png")}
                  style={[
                    styles.heroImage,
                    {
                      height: stackedMarketingHeight,
                    },
                  ]}
                />
                <Text style={styles.brandHeadline}>
                  Everything you own has a story.
                </Text>

                <Text style={styles.brandMessage}>
                  Keepr records the life of the things you care about — homes, vehicles, boats, and more.
                </Text>

              </View>
            </View>

            <View
              style={[
                styles.loginPanel,
                styles.loginPanelSingle,
                styles.loginPanelStacked,
              ]}
            >
              <View style={[styles.authCard, styles.authCardSingle]}>
                {renderAuthCardContent()}
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View
          style={[
            styles.container,
            styles.webContainer,
            {
              gap: desktopGap,
              paddingHorizontal: desktopPadding,
              paddingVertical: desktopVerticalPadding,
            },
          ]}
        >
          {(showDesktopSplit || showStackedMarketing) && (
            <View
              style={[
                styles.brandPanel,
                showDesktopSplit
                  ? { maxWidth: desktopBrandMax }
                  : styles.brandPanelStacked,
              ]}
            >
              <View
                style={[
                  styles.brandContent,
                  showDesktopSplit
                    ? { maxWidth: desktopBrandMax }
                    : styles.brandContentStacked,
                ]}
              >
                <Image
                  source={require("../assets/login_image_keepr.png")}
                  style={[
                    styles.heroImage,
                    showDesktopSplit && {
                      height: Math.round(desktopBrandMax * marketingImageRatio),
                    },
                    showStackedMarketing && {
                      height: Math.round(stackedMarketingWidth * marketingImageRatio),
                    },
                  ]}
                />
                <Text style={styles.brandHeadline}>
                  Everything you own has a story.
                </Text>

                <Text style={styles.brandMessage}>
                  Keepr records the life of the things you care about — homes, vehicles, boats, and more.
                </Text>

              </View>
            </View>
          )}

          <View
            style={[
              styles.loginPanel,
              showDesktopSplit && { maxWidth: desktopLoginMax },
              !showDesktopSplit && styles.loginPanelSingle,
            ]}
          >
            <View
              style={[
                styles.authCard,
                !showDesktopSplit && styles.authCardSingle,
              ]}
            >
              {renderAuthCardContent()}
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  inviteCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#DCE7FB",
    backgroundColor: "#F6F9FF",
    marginBottom: 22,
  },

  inviteImageFrame: {
    width: "44%",
    minWidth: 176,
    maxWidth: 260,
    height: 214,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#E6EEFF",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },

  inviteImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  inviteFallbackImage: {
    resizeMode: "contain",
  },

  inviteContent: {
    flex: 1,
    minWidth: 230,
    justifyContent: "center",
  },

  inviteBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

  inviteBrand: {
    fontSize: 13,
    fontWeight: "900",
    color: "#2563EB",
    textTransform: "uppercase",
  },

  inviteMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    opacity: 0.78,
  },

  inviteTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "900",
    color: "#0F172A",
  },

  inviteTagline: {
    marginTop: 8,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "850",
    color: "#2563EB",
  },

  inviteBody: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: "#475569",
  },

  inviteSignedInText: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    color: "#0F172A",
  },

  inviteLoader: {
    alignSelf: "flex-start",
    marginTop: 10,
  },

  invitePrimary: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#2563EB",
    paddingHorizontal: 18,
    marginTop: 14,
  },

  invitePrimaryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },

  inviteStoreButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2563EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    marginTop: 10,
  },

  inviteStoreButtonText: {
    color: "#2563EB",
    fontSize: 13,
    fontWeight: "900",
  },

  inviteSecondary: {
    alignSelf: "flex-start",
    minHeight: 34,
    justifyContent: "center",
    marginTop: 6,
  },

  inviteSecondaryText: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "800",
  },

  inviteLearnLink: {
    alignSelf: "flex-start",
    marginTop: 2,
  },

  inviteLearnText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },

  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    alignItems: "stretch",
  },

  singleColumnContainer: {
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },

  webStackScroll: {
    flex: 1,
  },

  webStackScrollContent: {
    alignItems: "center",
    paddingBottom: 40,
  },

  webContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 1440,
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 40,
    paddingHorizontal: 48,
  },

  mobileScroll: {
    flex: 1,
  },

  mobileScrollContent: {
    paddingBottom: 32,
  },

  mobileBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#D9E3FF",
  },

  mobileBannerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 6,
  },

  mobileBannerBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },

  mobileBannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },

  mobileBannerButton: {
    backgroundColor: "#2563EB",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },

  mobileBannerButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  mobileContinueText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },

  mobileCardWrap: {
    paddingHorizontal: 16,
  },

  mobileAppGate: {
    alignItems: "flex-start",
  },

  mobileAppGateTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    color: colors.textPrimary,
    marginTop: 8,
    marginBottom: 8,
  },

  mobileAppGateBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 16,
  },

  mobileAppGateButton: {
    minHeight: 48,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 18,
  },

  mobileAppGateButtonText: {
    color: colors.brandWhite,
    fontSize: 14,
    fontWeight: "900",
  },

  mobileWebContinueButton: {
    alignSelf: "center",
    minHeight: 38,
    justifyContent: "center",
    marginTop: 12,
  },

  mobileWebContinueText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
  },

  brandPanel: {
    flex: 1,
    minWidth: 0,
    justifyContent: "flex-start",
  },

  brandContent: {
    width: "100%",
    maxWidth: 620,
    minWidth: 0,
  },

  heroImage: {
    width: "100%",
    marginBottom: 24,
    resizeMode: "contain",
  },

  brandPanelStacked: {
    flex: 0,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    marginBottom: 24,
  },

  brandContentStacked: {
    width: "100%",
    maxWidth: 760,
    minWidth: 0,
  },

  brandHeadline: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
    color: colors.textPrimary,
  },

  brandMessage: {
    fontSize: 16,
    lineHeight: 24,
    color: "#475569",
    marginBottom: 20,
  },

  brandTag: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2563EB",
  },

  loginPanel: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%",
    justifyContent: "center",
  },

  loginPanelSingle: {
    width: "100%",
    maxWidth: 640,
  },

  loginPanelStacked: {
    flex: 0,
    justifyContent: "flex-start",
  },

  authCard: {
    width: "100%",
    maxWidth: 760,
    minWidth: 0,
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  authCardSingle: {
    width: "100%",
    maxWidth: 640,
    minWidth: 0,
  },

  authCardMobileWeb: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    borderRadius: 16,
    padding: 20,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },

  header: {
    marginBottom: spacing.lg,
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },

  logo: {
    width: 48,
    height: 48,
    resizeMode: "contain",
    marginBottom: 12,
  },

  brandTextWrap: {
    marginLeft: 12,
  },

  brand: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  brandSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  title: {
    ...typography.title,
  },

  subtitle: {
    ...typography.subtitle,
    marginTop: 4,
  },

  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: spacing.lg,
  },

  modePill: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    alignItems: "center",
  },

  modePillActive: {
    borderColor: colors.brandBlue,
    backgroundColor: "#EEF2FF",
  },

  modePillText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "600",
  },

  modePillTextActive: {
    color: colors.brandBlue,
  },

  form: {
    marginTop: 2,
  },

  socialAuthGroup: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  oauthResolvingCard: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },

  oauthResolvingTitle: {
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: "900",
  },

  oauthResolvingText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
  },

  socialButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },

  socialButtonText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "800",
  },

  emailDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },

  emailDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderSubtle,
  },

  emailDividerText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "800",
  },

  identityLinkHint: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    textAlign: "center",
  },

  label: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },

  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },

  passwordInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },

  passwordInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: "transparent",
  },

  passwordToggle: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },

  inputError: {
    borderColor: "#DC2626",
  },

  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: "#DC2626",
    fontWeight: "600",
  },

  hintText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },

  formError: {
    marginTop: spacing.md,
    fontSize: 13,
    color: "#DC2626",
    fontWeight: "700",
  },

  button: {
    marginTop: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    fontSize: 14,
    color: colors.brandWhite,
    fontWeight: "600",
  },

  forgotLink: {
    marginTop: spacing.sm,
    alignSelf: "center",
  },

  forgotLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandBlue,
  },

  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
  },

  trustText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 14,
    lineHeight: 18,
  },
});
