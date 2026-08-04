import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing } from "../styles/theme";
import { enableNotificationsForThisDevice } from "../lib/notificationsService";

function statusText(result) {
  if (!result) return "Enable realtime app alerts, mobile push, or browser push on this device.";
  if (result.ok) return result.provider === "web_push" ? "Browser notifications are enabled on this device." : "Mobile push notifications are enabled on this device.";
  if (result.reason === "missing_vapid_public_key") return "Browser push needs the VAPID public key configured before it can be enabled.";
  if (result.reason === "https_required") return "Browser push requires HTTPS, or localhost during development.";
  if (result.reason === "unsupported_browser") return "This browser does not support Web Push notifications.";
  if (result.reason === "permission_denied") return "Notifications are blocked for this device.";
  return "Notifications are not enabled on this device.";
}

export default function NotificationSettingsCard() {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const enable = async () => {
    setBusy(true);
    try {
      const next = await enableNotificationsForThisDevice();
      setResult(next);
    } catch (err) {
      setResult({ ok: false, reason: err?.message || "enable_failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={Platform.OS === "web" ? "notifications-outline" : "phone-portrait-outline"} size={18} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Device notifications</Text>
        <Text style={styles.subtitle}>{statusText(result)}</Text>
      </View>
      <TouchableOpacity style={styles.button} onPress={enable} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Enable</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft || "#EAF2FF",
  },
  copy: {
    flex: 1,
  },
  title: {
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    minWidth: 82,
    minHeight: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
  },
});
