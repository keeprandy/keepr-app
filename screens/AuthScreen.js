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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing, typography } from "../styles/theme";

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
  // Supabase will redirect to this URL after the user clicks the email link.
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

  const [touched, setTouched] = useState({ email: false, password: false, displayName: false });
  const [formError, setFormError] = useState("");

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const title = useMemo(() => {
    if (isForgot) return "Reset your password";
    if (isSignUp) return "Become a Keepr";
    return "Sign in to Keepr";
  }, [isForgot, isSignUp]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const emailErr = useMemo(() => validateEmail(normalizedEmail), [normalizedEmail]);
  const passwordErr = useMemo(() => (isForgot ? null : validatePassword(password)), [isForgot, password]);

  const canSubmit = !submitting && !emailErr && !passwordErr;

  const ensureProfile = async (userId) => {
    // Safe “upsert” so we don’t care if a trigger exists or not.
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email: normalizedEmail || null,
        display_name: displayName?.trim() || null,
        role: "consumer",
        plan: "free",
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
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark-outline" size={24} color={colors.brandBlue} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {isSignUp
              ? "Document the story. Add proof. Build calm over time."
              : isForgot
              ? "Enter your email and we’ll send a reset link."
              : "Use the email and password for your Keepr (Supabase) account."}
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
                Create account
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
                placeholder="Andy"
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
                  Use at least 6 characters. (If leaked password protection is enabled in Supabase, compromised passwords will be rejected.)
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
            Tip: if you’re testing, your Admin Tools remain available under your superkeepr role.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
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
