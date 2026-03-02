// components/HeaderNotificationsIcon.js
import React from "react";
import { TouchableOpacity, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { colors, spacing, radius } from "../styles/theme";

export default function HeaderNotificationsIcon({
  hasUnread = false,
  onPressOverride,
}) {
  const navigation = useNavigation();

  const handlePress = () => {
    if (onPressOverride) {
      onPressOverride();
      return;
    }
    navigation.navigate("Notifications");
  };

  return (
    <TouchableOpacity
      style={styles.headerIconBtn}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <Ionicons
        name="notifications-outline"
        size={18}
        color={colors.textPrimary}
      />
      {hasUnread && <View style={styles.badgeDot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginLeft: spacing.xs,
    position: "relative",
  },
  badgeDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    borderWidth: 1,
    borderColor: colors.surfaceSubtle,
  },
});
