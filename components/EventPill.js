// components/EventPill.js

import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { colors, spacing, shadows } from "../styles/theme";

export default function EventPill({
  hidden = false,
  // optional context prefill
  contextAssetId = null,
  contextSystemId = null,
  contextTitle = "",
  contextNotes = "",
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return null;

  const bottom = useMemo(() => {
    return (Platform.OS === "web" ? spacing.lg : 72) + (insets.bottom || 0);
  }, [insets.bottom]);

  const openCreate = () => {
    navigation.navigate("CreateEvent", {
      assetId: contextAssetId,
      systemId: contextSystemId,
      title: contextTitle,
      notes: contextNotes,
      afterSave: "Notifications", // or "back"
    });
  };

  return (
    <TouchableOpacity style={[styles.pill, { bottom }]} onPress={openCreate} activeOpacity={0.9}>
      <Ionicons name="add" size={18} color={colors.brandWhite} />
      <Text style={styles.label}>Add Event </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    right: spacing.lg,
    width: 124,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(45, 124, 227, 0.8);",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...(shadows?.subtle || {}),
    zIndex: 9999,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : null),
  },
  label: {
    color: colors.brandWhite,
    fontWeight: "800",
    fontSize: 13,
  },
});
