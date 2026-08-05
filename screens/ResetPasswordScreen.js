import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export default function ResetPasswordScreen({ navigation, route }) {
  const recoveryUrl = route?.params?.recoveryUrl || "";
  const shouldBootstrapRecovery = Platform.OS === "web" || !!recoveryUrl;
  const [booting, setBooting] = useState(shouldBootstrapRecovery);
  const [bootError, setBootError] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(!shouldBootstrapRecovery);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const passwordErr = useMemo(() => validatePassword(password), [password]);
  const confirmErr = useMemo(() => {
    if (!confirm) return "";
    if (confirm !== password) return "Passwords do not match.";
    return "";
  }, [confirm, password]);

  const hasBlockingErrors = !!passwordErr || !!confirmErr;
  const canSubmit =
    recoveryReady && !booting && !bootError && !submitting && !hasBlockingErrors;

  useEffect(() => {
    let alive = true;

    const parseParams = (href) => {
      try {
        const u = new URL(href);
        const query = new URLSearchParams(u.search || "");
        const hash = new URLSearchParams((u.hash || "").replace(/^#/, ""));
        const get = (k) => hash.get(k) || query.get(k) || "";
        return {
          code: get("code"),
          access_token: get("access_token"),
          refresh_token: get("refresh_token"),
          error: get("error"),
          error_code: get("error_code"),
          error_description: get("error_description"),
          type: get("type"),
        };
      } catch {
        return {
          code: "",
          access_token: "",
          refresh_token: "",
          error: "",
          error_code: "",
          error_description: "",
          type: "",
        };
      }
    };

    const bootstrapRecoverySession = async () => {
      if (!shouldBootstrapRecovery) {
        setRecoveryReady(true);
        return;
      }

      setBooting(true);
      setBootError("");
      setRecoveryReady(false);

      try {
        const href =
          recoveryUrl ||
          (Platform.OS === "web" && typeof window !== "undefined"
            ? window.location.href
            : "");
        const p = parseParams(href);
        const isRecoveryLink = p.type === "recovery";

        if (p.error || p.error_code || p.error_description) {
          const msg =
            decodeURIComponent(p.error_description || "") ||
            (p.error_code
              ? `Reset link error: ${p.error_code}`
              : "Reset link is invalid or expired.");
          if (alive) {
            setBootError(msg);
            setRecoveryReady(false);
          }
          return;
        }

        if (!isRecoveryLink) {
          if (alive) {
            setBootError("This reset link is invalid or expired. Please request a new one.");
            setRecoveryReady(false);
          }
          return;
        }

        const before = await supabase.auth.getSession();
        if (before?.data?.session) {
          if (alive) setRecoveryReady(true);
          return;
        }

        if (p.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) {
            if (alive) {
              setBootError(error.message || "Reset link is invalid or expired.");
              setRecoveryReady(false);
            }
            return;
          }
        } else if (p.access_token && p.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: p.access_token,
            refresh_token: p.refresh_token,
          });
          if (error) {
            if (alive) {
              setBootError(error.message || "Reset link is invalid or expired.");
              setRecoveryReady(false);
            }
            return;
          }
        } else {
          if (alive) {
            setBootError("This reset link is invalid or expired. Please request a new one.");
            setRecoveryReady(false);
          }
          return;
        }

        if (Platform.OS === "web") {
          try {
            window.history.replaceState(null, "", "/reset");
          } catch {}
        }

        const after = await supabase.auth.getSession();
        if (!after?.data?.session) {
          if (alive) {
            setBootError("This reset link is invalid or expired. Please request a new one.");
            setRecoveryReady(false);
          }
          return;
        }

        if (alive) setRecoveryReady(true);
      } catch (e) {
        if (alive) {
          setBootError(e?.message || "Reset link is invalid or expired.");
          setRecoveryReady(false);
        }
      }
    };

    bootstrapRecoverySession().finally(() => {
      if (alive) setBooting(false);
    });

    return () => {
      alive = false;
    };
  }, [recoveryUrl, shouldBootstrapRecovery]);

  const handleExit = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.reset({
      index: 0,
      routes: [{ name: "Auth" }],
    });
  };

  const handleUpdatePassword = async () => {
    setFormError("");

    if (booting) {
      setFormError("Preparing reset…");
      return;
    }

    if (bootError || !recoveryReady) {
      setFormError(
        bootError || "This reset link is invalid or expired. Please request a new one."
      );
      return;
    }

    if (hasBlockingErrors) {
      setFormError("Fix the fields highlighted below.");
      return;
    }

    try {
      setSubmitting(true);

      const { error } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (error) {
        setFormError(error.message || "Could not update password.");
        return;
      }

      Alert.alert("Password updated", "Your password has been changed.");

      navigation.reset({
        index: 0,
        routes: [{ name: "RootTabs" }],
      });
    } catch (e) {
      setFormError(e?.message || "Could not update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View
        style={[
          styles.container,
          Platform.OS === "web" && styles.webContainer,
        ]}
      >
        {Platform.OS === "web" && (
          <View style={styles.brandPanel}>
            <View style={styles.brandContent}>
              <Image
                source={require("../assets/login_image_keepr.png")}
                style={{ width: 440, height: 275, marginBottom: 24 }}
              />
              <Text style={styles.brandHeadline}>Secure your Keepr™ account.</Text>
              <Text style={styles.brandMessage}>
                Set a new password to continue your ownership story.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.loginPanel}>
          <View style={styles.authCard}>
            <View style={styles.header}>
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

              <Text style={styles.title}>Set a new password</Text>
              <Text style={styles.subtitle}>
                This will secure your account and restore access.
              </Text>
            </View>

            {booting && (
              <View style={styles.bootRow}>
                <ActivityIndicator />
                <Text style={styles.bootText}>Preparing secure reset…</Text>
              </View>
            )}

            {!!bootError && !booting && (
              <View style={styles.bootErrorBox}>
                <Text style={styles.bootErrorTitle}>Reset link issue</Text>
                <Text style={styles.bootErrorText}>{bootError}</Text>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleExit}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryButtonText}>Back to sign in</Text>
                </TouchableOpacity>
              </View>
            )}

            {!bootError && !booting && (
              <View style={styles.form}>
                <Text style={styles.label}>New password</Text>
                <TextInput
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    if (formError) setFormError("");
                  }}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  style={[styles.input, passwordErr ? styles.inputError : null]}
                />
                {!!passwordErr && <Text style={styles.errorText}>{passwordErr}</Text>}

                <Text style={[styles.label, { marginTop: spacing.md }]}>
                  Confirm password
                </Text>
                <TextInput
                  value={confirm}
                  onChangeText={(v) => {
                    setConfirm(v);
                    if (formError) setFormError("");
                  }}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  style={[styles.input, confirmErr ? styles.inputError : null]}
                />
                {!!confirmErr && <Text style={styles.errorText}>{confirmErr}</Text>}

                {!!formError && <Text style={styles.formError}>{formError}</Text>}

                <TouchableOpacity
                  style={[
                    styles.button,
                    !canSubmit ? styles.buttonDisabled : null,
                  ]}
                  onPress={handleUpdatePassword}
                  disabled={!canSubmit}
                  activeOpacity={0.85}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={18}
                        color="#fff"
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.buttonText}>Update password</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondary}
                  onPress={handleExit}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryText}>Back to sign in</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
  },
  webContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 48,
  },
  brandPanel: {
    width: 420,
    justifyContent: "center",
  },
  brandContent: {
    maxWidth: 420,
  },
  brandHeadline: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  brandMessage: {
    fontSize: 16,
    color: "#475569",
    lineHeight: 24,
  },
  loginPanel: {
    flex: 1,
    justifyContent: "center",
  },
  authCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
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
    width: 40,
    height: 40,
    resizeMode: "contain",
  },
  brandTextWrap: {
    marginLeft: 10,
  },
  brand: {
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
  form: {},
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
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
  formError: {
    marginTop: spacing.md,
    fontSize: 13,
    color: "#DC2626",
    fontWeight: "700",
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandBlue,
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  secondary: {
    marginTop: spacing.md,
    alignItems: "center",
  },
  secondaryText: {
    color: colors.brandBlue,
    fontWeight: "600",
  },
  bootRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.md,
  },
  bootText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  bootErrorBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  bootErrorTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#991B1B",
    marginBottom: 6,
  },
  bootErrorText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#991B1B",
  },
  secondaryButton: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
  },
  secondaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});
