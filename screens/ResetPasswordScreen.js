import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, spacing } from "../styles/theme";

function validatePassword(pw) {
  const v = (pw || "").trim();
  if (!v) return "Password is required.";
  if (v.length < 6) return "Password must be at least 6 characters.";
  return "";
}

export default function ResetPasswordScreen({ navigation }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const pwError = useMemo(() => validatePassword(password), [password]);
  const confirmError = useMemo(() => {
    if (!confirm) return "";
    if (confirm !== password) return "Passwords do not match.";
    return "";
  }, [confirm, password]);

  const hasBlockingErrors = !!pwError || !!confirmError;


// ---------------- RECOVERY SESSION BOOTSTRAP (WEB) ----------------
const [booting, setBooting] = useState(Platform.OS === "web");
const [bootError, setBootError] = useState("");

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
      };
    } catch {
      return {
        code: "",
        access_token: "",
        refresh_token: "",
        error: "",
        error_code: "",
        error_description: "",
      };
    }
  };

  const bootstrapRecoverySession = async () => {
    if (Platform.OS !== "web") return;

    try {
      const href = window.location.href;
      const p = parseParams(href);

      if (p.error || p.error_code || p.error_description) {
        const msg =
          decodeURIComponent(p.error_description || "") ||
          (p.error_code ? `Reset link error: ${p.error_code}` : "Reset link is invalid.");
        if (alive) setBootError(msg);
        return;
      }

      const before = await supabase.auth.getSession();
      if (before?.data?.session) return;

      if (p.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(href);
        if (error) {
          if (alive) setBootError(error.message || "Reset link is invalid or expired.");
          return;
        }
      } else if (p.access_token && p.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });
        if (error) {
          if (alive) setBootError(error.message || "Reset link is invalid or expired.");
          return;
        }
      }

      const after = await supabase.auth.getSession();
      if (!after?.data?.session) {
        if (alive) setBootError("Reset link is invalid or expired. Please request a new one.");
      }
    } catch (e) {
      if (alive) setBootError(e?.message || "Reset link is invalid or expired.");
    }
  };

  bootstrapRecoverySession().finally(() => {
    if (alive) setBooting(false);
  });

  return () => {
    alive = false;
  };
}, []);


  const handleUpdatePassword = async () => {
    setFormError("");

    if (booting) {
      setFormError("Preparing reset…");
      return;
    }

    if (bootError) {
      setFormError(bootError);
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

      navigation.navigate("RootTabs");
    } catch (e) {
      setFormError("Could not update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.subtitle}>
          Choose a strong, unique password. If your password is too common, it may be rejected.
        </Text>


{booting && (
  <View style={styles.bootRow}>
    <ActivityIndicator />
    <Text style={styles.bootText}>Preparing reset…</Text>
  </View>
)}

{!!bootError && (
  <View style={styles.bootErrorBox}>
    <Text style={styles.bootErrorTitle}>Reset link issue</Text>
    <Text style={styles.bootErrorText}>{bootError}</Text>
    <TouchableOpacity
      style={styles.secondaryButton}
      onPress={() => navigation.navigate("Auth")}
      activeOpacity={0.85}
    >
      <Text style={styles.secondaryButtonText}>Request a new reset link</Text>
    </TouchableOpacity>
  </View>
)}


        <TextInput
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (formError) setFormError("");
          }}
          placeholder="New password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={[styles.input, pwError ? styles.inputError : null]}
        />
        {!!pwError && <Text style={styles.errorText}>{pwError}</Text>}

        <TextInput
          value={confirm}
          onChangeText={(v) => {
            setConfirm(v);
            if (formError) setFormError("");
          }}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={[styles.input, confirmError ? styles.inputError : null]}
        />
        {!!confirmError && <Text style={styles.errorText}>{confirmError}</Text>}

        {!!formError && <Text style={styles.formError}>{formError}</Text>}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            submitting || hasBlockingErrors ? styles.primaryButtonDisabled : null,
          ]}
          onPress={handleUpdatePassword}
          disabled={submitting || hasBlockingErrors}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Update password</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: colors.textPrimary,
    backgroundColor: "#fff",
    marginTop: 10,
  },
  inputError: {
    borderColor: "#ef4444",
  },
  errorText: {
    marginTop: 6,
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "700",
  },
  formError: {
    marginTop: 10,
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: colors.brandBlue,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
  },
});
