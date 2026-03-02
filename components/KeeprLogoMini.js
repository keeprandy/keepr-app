// components/KeeprLogoMini.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, typography } from "../styles/theme";

export default function KeeprLogoMini({ size = 32 }) {
  const iconSize = Math.round(size * 0.55);

  return (
    <View style={styles.container}>
      <View style={[styles.iconBadge, { width: size, height: size, borderRadius: size / 3 }]}>
        <Ionicons name="shield-checkmark-outline" size={iconSize} color="#FFFFFF" />
      </View>
      <Text style={styles.wordmark}>Keepr</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconBadge: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentBlue || "#2563EB",
    marginRight: spacing.xs,
  },
  wordmark: {
    ...typography.title,
    fontSize: 18,
    color: "#FFFFFF",
  },
});
