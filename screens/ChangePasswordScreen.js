// screens/ChangePasswordScreen.js
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, radius } from "../styles/theme";
import { layoutStyles } from "../styles/layout";

function validatePassword(password) {
  const v = password || "";
  if (!v) return "Password is required.";
  if (v.length < 6) return "Password must be at least 6 characters.";
  return null;
}

export default function ChangePasswordScreen({ navigation }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const canSubmit = useMemo(() => !submitting && !!password && !!confirm, [submitting, password, confirm]);

  const handleSave = async () => {
    setFormError("");
    const pErr = validatePassword(password);
    if (pErr) return setFormError(pErr);
    if (password !== confirm) return setFormError("Passwords do not match.");

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.user) {
        Alert.alert("Sign in required", "Please sign in again, then try changing your password.");
        navigation.navigate("Auth");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setFormError(error.message || "Could not update password.");

      Alert.alert("Password updated", "Your password has been changed.");
      navigation.goBack();
    } catch (e) {
      setFormError("Could not update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[layoutStyles.screen, styles.screen]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Change Password</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>New password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />

        <Text style={[styles.label, { marginTop: 12 }]}>Confirm new password</Text>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Re-enter password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />

        {!!formError && <Text style={styles.error}>{formError}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]}
          onPress={handleSave}
          disabled={!canSubmit || submitting}
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, padding: 16 },
  header: { marginBottom: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.pill },
  backText: { marginLeft: 4, color: colors.textPrimary, fontWeight: "800", fontSize: 13 },
  title: { marginTop: 8, fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: "#11182722", padding: 14 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#11182722", borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, color: colors.textPrimary, fontSize: 14 },
  error: { marginTop: 10, color: colors.danger || "#DC2626", fontWeight: "800", fontSize: 12 },
  primaryBtn: { marginTop: 14, backgroundColor: colors.primary || "#2D7DE3", borderRadius: radius.pill, paddingVertical: 12, alignItems: "center" },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },
});
