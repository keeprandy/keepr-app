import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../../lib/supabaseClient";
import { claimPendingActionsForEmail } from "../../lib/hubsApi";
import { colors, shadows } from "../../styles/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function HubAuthModal({
  visible,
  onClose,
  onSuccess,
  hubName = "this Hub",
}) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const isSignup = mode === "signup";

  const canSubmit =
    EMAIL_RE.test(normalizedEmail) && password.length >= 8 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      setSubmitting(true);
      setErrorText("");

      let data;
      let error;

      if (isSignup) {
        const result = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { display_name: displayName?.trim() || null },
          },
        });

        data = result.data;
        error = result.error;

        if (error) throw error;

        if (!data?.session?.user?.id) {
          setMode("signin");
          setPassword("");
          setErrorText("Account created. Sign in to continue your Hub invitation.");
          return;
        }
      } else {
        const result = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        data = result.data;
        error = result.error;

        if (error) throw error;
      }

      const userId = data?.user?.id || data?.session?.user?.id;

      if (!userId) {
        setErrorText("Sign in completed, but we could not find your user.");
        return;
      }

      await claimPendingActionsForEmail({
        userId,
        email: normalizedEmail,
      });

      await onSuccess?.({
        userId,
        email: normalizedEmail,
      });
    } catch (e) {
      setErrorText(e?.message || "Could not continue.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <View style={styles.card}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.kicker}>Keepr Account</Text>
              <Text style={styles.title}>
                {isSignup ? "Create account" : "Sign in to continue"}
              </Text>
            </View>

            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>
            Join {hubName} without leaving this Hub.
          </Text>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modePill, !isSignup && styles.modePillActive]}
              onPress={() => {
                setMode("signin");
                setErrorText("");
              }}
            >
              <Text style={[styles.modeText, !isSignup && styles.modeTextActive]}>
                Sign in
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modePill, isSignup && styles.modePillActive]}
              onPress={() => {
                setMode("signup");
                setErrorText("");
              }}
            >
              <Text style={[styles.modeText, isSignup && styles.modeTextActive]}>
                Create account
              </Text>
            </TouchableOpacity>
          </View>

          {isSignup ? (
            <>
              <Text style={styles.label}>Name optional</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            </>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setErrorText("");
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setErrorText("");
            }}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit && styles.disabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name={isSignup ? "person-add-outline" : "log-in-outline"}
                  size={18}
                  color="#fff"
                />
                <Text style={styles.primaryText}>
                  {isSignup ? "Create account" : "Sign in"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryText}>Browse Hub instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(6,10,18,0.76)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 28,
    backgroundColor: colors.surface,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    zIndex: 2,
    elevation: 12,
    ...(shadows?.subtle || {}),
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 12,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 14,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  modePill: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  modePillActive: {
    borderColor: colors.brandBlue || "#2563eb",
    backgroundColor: "#EEF2FF",
  },
  modeText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textMuted,
  },
  modeTextActive: {
    color: colors.brandBlue || "#2563eb",
  },
  label: {
    marginTop: 10,
    marginBottom: 5,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.textPrimary,
  },
  error: {
    marginTop: 10,
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "700",
  },
  primaryButton: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: colors.brandBlue || "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  disabled: {
    opacity: 0.55,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  secondaryButton: {
    marginTop: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 14,
  },
});