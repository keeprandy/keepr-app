// screens/AuthScreen.js

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius, typography } from "../styles/theme";
import { layoutStyles } from "../styles/layout";

export default function AuthScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === "signup";
  const title = useMemo(() => (isSignUp ? "Become a Keepr" : "Sign in to Keepr"), [isSignUp]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

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

  const handleSignIn = async () => {
    try {
      setSubmitting(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        Alert.alert("Sign-in failed", error.message);
        return;
      }

      // Success → AuthContext will switch out of AuthScreen
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async () => {
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
        Alert.alert("Sign-up failed", error.message);
        return;
      }

      const userId = data?.user?.id;
      if (userId) {
        await ensureProfile(userId);
      }

      // Note: if email confirmations are enabled, user may need to confirm before session exists.
      Alert.alert(
        "Account created",
        "You can continue to onboarding. If email confirmation is enabled, check your inbox."
      );
    } catch (e) {
      Alert.alert("Sign-up failed", e?.message || "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  };

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
              : "Use the email and password for your Keepr (Supabase) account."}
          </Text>
        </View>

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modePill, mode === "signin" && styles.modePillActive]}
            onPress={() => setMode("signin")}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text style={[styles.modePillText, mode === "signin" && styles.modePillTextActive]}>
              Sign in
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modePill, mode === "signup" && styles.modePillActive]}
            onPress={() => setMode("signup")}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text style={[styles.modePillText, mode === "signup" && styles.modePillTextActive]}>
              Create account
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {isSignUp && (
            <>
              <Text style={styles.label}>Name (optional)</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Andy"
                placeholderTextColor={colors.textMuted}
              />
              <View style={{ height: spacing.md }} />
            </>
          )}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />

          <TouchableOpacity
            style={styles.button}
            onPress={isSignUp ? handleSignUp : handleSignIn}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.brandWhite} />
            ) : (
              <>
                <Ionicons
                  name={isSignUp ? "person-add-outline" : "log-in-outline"}
                  size={18}
                  color={colors.brandWhite}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.buttonText}>{isSignUp ? "Create account" : "Sign in"}</Text>
              </>
            )}
          </TouchableOpacity>

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
  buttonText: { fontSize: 14, color: colors.brandWhite, fontWeight: "600" },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
});