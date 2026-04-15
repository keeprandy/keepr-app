// screens/AuthScreen.js

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing, typography } from "../styles/theme";
import { Image } from "react-native";

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
  if (v.length < 6) return "Password must be at least 8 characters.";
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
  if (msg.includes("rate limit") || msg.includes("too many")) return "Too many attempts. Try again in a few minutes.";

  return err?.message || "Something went wrong. Please try again.";
}

function getResetRedirectTo() {
  // Supabase will redirect to this URL after the user clicks the email link. Cool.
  // Web expects https://<host>/reset (handled by ResetPasswordScreen).
  if (Platform.OS === "web") {
    try {
      return `${window.location.origin}/reset`;
    } catch (_) {
      return "http://localhost:8081/reset";
    }
  }
  // Native: deeplink to keepr://reset
  return "keepr://reset";
}


export default function AuthScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "forgot"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { width } = useWindowDimensions();

const isWeb = Platform.OS === "web";

const isMobileWeb =
  isWeb &&
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const isNarrow = width < 920;
const showDesktopSplit = isWeb && !isMobileWeb && !isNarrow;

  const [touched, setTouched] = useState({ email: false, password: false, displayName: false });
  const [formError, setFormError] = useState("");

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";


  const iosUrl = "https://apps.apple.com/us/app/keepr-home-asset-care/id6761725280";
const androidUrl = "https://play.google.com/store/apps/details?id=com.keeprhome.app";

  const title = useMemo(() => {
    if (isForgot) return "Reset your password";
    if (isSignUp) return "Become a Keepr™";
    return "Sign in to Keepr™";
  }, [isForgot, isSignUp]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const emailErr = useMemo(() => validateEmail(normalizedEmail), [normalizedEmail]);
  const passwordErr = useMemo(() => (isForgot ? null : validatePassword(password)), [isForgot, password]);

  const canSubmit = !submitting && !emailErr && !passwordErr;

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

      // Ensure a profile row exists for this user (safe if they signed up earlier but profile insert was skipped)
      const userId = data?.user?.id;
      if (userId) {
        try {
          await ensureProfile(userId);
        } catch (e) {
          // Non-blocking — user can still use the app, and role bootstrap will retry.
          console.log("[AuthScreen] ensureProfile failed:", e?.message || e);
        }
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

      // If email confirmations are enabled, signUp may not return a session yet.
      // Only write the profile if we actually have an authenticated session.
      const sessionUserId = data?.session?.user?.id || null;

      if (sessionUserId) {
        await ensureProfile(sessionUserId);
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

  

  return (
    <SafeAreaView style={layoutStyles.screen}>
{isMobileWeb && (
  <View style={styles.mobileBanner}>
    <Text style={styles.mobileBannerTitle}>
      Capture on mobile. Manage on web.
    </Text>

    <Text style={styles.mobileBannerBody}>
      Download the app for faster capture, photos, and on-the-go access. Continue on web if you want to sign in or do deeper setup.
    </Text>

    <View style={styles.mobileBannerActions}>
      <TouchableOpacity
        onPress={() => {
          const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
          window.location.href = isIOS ? iosUrl : androidUrl;
        }}
        style={styles.mobileBannerButton}
      >
        <Text style={styles.mobileBannerButtonText}>Download App</Text>
      </TouchableOpacity>

      <TouchableOpacity activeOpacity={0.85}>
        <Text style={styles.mobileContinueText}>Continue on web</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
    <View
  style={[
    styles.container,
    showDesktopSplit && styles.webContainer,
    !showDesktopSplit && styles.singleColumnContainer,
    isMobileWeb && styles.mobileWebContainer,
      ]}
    >
        {showDesktopSplit && (
        <View style={styles.brandPanel}>
      <View style={styles.brandContent}>
          <Image
            source={require("../assets/login_image_keepr.png")}
            style={{ width: 440, height: 275, marginBottom: 24 }}
          />
          <Text style={styles.brandHeadline}>
            Everything you own has a story.
          </Text>

          <Text style={styles.brandMessage}>
            Keepr records the life of the things you care about —
            homes, vehicles, boats, and more.
          </Text>

          <Text style={styles.brandTag}>
            Become a keepr.
          </Text>
        </View>
        </View>
      )}
      
      <View
  style={[
    styles.loginPanel,
    !showDesktopSplit && styles.loginPanelSingle,
    isMobileWeb && styles.loginPanelMobileWeb,
  ]}
    >
      <View
        style={[
          styles.authCard,
          !showDesktopSplit && styles.authCardSingle,
          isMobileWeb && styles.authCardMobileWeb,
        ]}
      >
      <View style={styles.header}>
        <View style={styles.brandRow}>
        <Image
          source={require("../assets/app_logo_icon.png")}
          style={styles.logo}
        />
          <View style={styles.brandTextWrap}>
            <Text style={styles.brand}>Keepr™ </Text>
            <Text style={styles.brandSub}>Asset Lifecycle Intelligence</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          {Platform.OS === "web"
            ? isSignUp
              ? "Create your Keepr™ account and start building the story of what you own."
              : isForgot
              ? "Enter your email and we’ll send a reset link."
              : "Sign in to continue your ownership story."
            : isSignUp
            ? "Get started."
            : isForgot
            ? "Enter your email to reset your password."
            : "Continue your ownership story."}
        </Text>
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
              <Text style={[styles.modePillText, mode === "signin" && styles.modePillTextActive]}>
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
              <Text style={[styles.modePillText, mode === "signup" && styles.modePillTextActive]}>
                Create Account
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
              {touched.password && passwordErr ? <Text style={styles.errorText}>{passwordErr}</Text> : null}
              {isSignUp ? (
                <Text style={styles.hintText}>
                  Use at least 8 characters. (Keepr is extremely secure and private.)
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
                  name={isForgot ? "mail-outline" : isSignUp ? "person-add-outline" : "log-in-outline"}
                  size={18}
                  color={colors.brandWhite}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.buttonText}>
                  {isForgot ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
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
      </View>
      </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
  flex: 1,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.xl,
  alignItems: "stretch",
},
  
  header: { marginBottom: spacing.lg },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
    marginBottom: spacing.sm,
  },
  title: { ...typography.title },
  subtitle: { ...typography.subtitle, marginTop: 4 },
  logo: {
  width: 48,
  height: 48,
  resizeMode: "contain",
  marginBottom: 12,
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

brandContent: {
  maxWidth: 420,
  minWidth: 420,

},

singleColumnContainer: {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  paddingHorizontal: 24,
  paddingVertical: 24,
},

mobileWebContainer: {
  flex: 1,
  paddingHorizontal: 16,
  paddingTop: 16,
  paddingBottom: 24,
  alignItems: "stretch",
},

webContainer: {
  flex: 1,
  flexDirection: "row",
  justifyContent: "center",
  alignItems: "center",
  gap: 48,
  paddingHorizontal: 48,
},

loginPanelSingle: {
  width: "100%",
  maxWidth: 640,
},

loginPanelMobileWeb: {
  width: "100%",
  maxWidth: "100%",
  justifyContent: "flex-start",
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

mobileBanner: {
  marginHorizontal: 16,
  marginTop: 16,
  marginBottom: 8,
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

brandPanel: {
  width: 420,
  justifyContent: "center",
},

brandHeadline: {
  fontSize: 28,
  fontWeight: "700",
  marginBottom: 16,
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
  width: 760,
  maxWidth: "100%",
  justifyContent: "center",
},

brandRow: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: spacing.sm,
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

trustText: {
  fontSize: 12,
  color: colors.textMuted,
  marginTop: 14,
  lineHeight: 18,
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
  modePillText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  modePillTextActive: { color: colors.brandBlue },

  form: { marginTop: 2 },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
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
  buttonText: { fontSize: 14, color: colors.brandWhite, fontWeight: "600" },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
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
});
