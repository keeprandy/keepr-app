// styles/layout.js
import { StyleSheet, Platform } from "react-native";
import { colors, spacing } from "./theme";

export const layoutStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md, // ← 8px global horizontal padding
    paddingTop: Platform.OS === "ios" ? spacing.lg : spacing.md,
    paddingBottom: spacing.lg,
  },
});
