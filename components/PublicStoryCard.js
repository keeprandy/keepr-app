import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../styles/theme";

export default function PublicStoryCard({
  asset,
  assetName = "this asset",
  onOpenSettings,
}) {
  const kac = asset?.kac_id || asset?.kac || asset?.kac_code || null;

  const openPublicStory = () => {
    if (!kac) return;

    const base =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : "https://app.keeprhome.com";

    const url = `${base}/k/${kac}`;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    Linking.openURL(url);
  };

  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Public Story</Text>
        <Text style={styles.subtitle}>
          Publish and share {assetName}’s Keepr Story.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, !kac && styles.disabled]}
        onPress={openPublicStory}
        activeOpacity={0.9}
        disabled={!kac}
      >
        <Ionicons name="globe-outline" size={16} color="white" />
        <Text style={styles.primaryText}>View Public Story</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={onOpenSettings}
        activeOpacity={0.9}
      >
        <Ionicons name="settings-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryText}>Public Story Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    gap: 10,
  },

  title: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  subtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
  },

  primaryText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },

  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },

  secondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },

  disabled: {
    opacity: 0.5,
  },
});