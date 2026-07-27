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
import { track, identifyUser } from "../lib/analytics";
import { claimPendingActionsForEmail } from "../lib/hubsApi";
import { completeSignupAttribution, getStoredLegacySourceSlug } from "../lib/verifiedAttribution";
import { DEFAULT_MEMBER_AVATAR } from "../lib/memberAvatar";
import { useAuth } from "../context/AuthContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { user } = useAuth();
  const [mode, setMode] = useState(route?.params?.mode === "signup" ? "signup" : "signin"); // "signin" | "signup" | "forgot"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inviteContext, setInviteContext] = useState(route?.params?.invitation || null);
  const [inviteLoading, setInviteLoading] = useState(!!route?.params?.invitationLoading);
  const [inviteImageBroken, setInviteImageBroken] = useState(false);
  const [mobileWebAuthEnabled, setMobileWebAuthEnabled] = useState(false);
  const scrollRef = useRef(null);
  const formAnchorRef = useRef(null);
  const passwordInputRef = useRef(null);

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
  const isMobileWeb = isWeb && (mobileUserAgent || width < 760);
  const isIOSMobileWeb =
    isMobileWeb &&
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
  }, [route?.params?.mode]);

  useEffect(() => {
    if (route?.params?.invitation) {
      setInviteContext(route.params.invitation);
      setInviteLoading(!!route?.params?.invitationLoading);
      setInviteImageBroken(false);
    }
  }, [route?.params?.invitation, route?.params?.invitationLoading]);

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

  const ensureProfile = async (userId) => {
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email: normalizedEmail || null,
        display_name: displayName?.trim() || null,
        onboarding_state: "in_progress",
      },
      { onConflict: "id" }
    );

    if (error) throw error;
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
    const invitePath = slug ? `/invite/${encodeURIComponent(slug)}` : "";
    const appUrl = `keepr://${invitePath}`;

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
    navigation.reset?.({
      index: 0,
      routes: [{ name: "RootTabs" }],
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
          await ensureProfile(userId);

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
  await ensureProfile(sessionUserId);

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
    identifyUser(sessionUserId, {
      email: user?.email || null,
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
                    if (isMobileWeb) {
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
                    {isMobileWeb ? "Open in Keepr" : "Become a Keepr"}
                  </Text>
                </TouchableOpacity>
                {isMobileWeb ? (
                  <>
                    <TouchableOpacity
                      style={styles.inviteStoreButton}
                      onPress={openAppStore}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.inviteStoreButtonText}>
                        {isIOSMobileWeb ? "Get Keepr for iPhone" : "Get Keepr for Android"}
                      </Text>
                    </TouchableOpacity>
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
