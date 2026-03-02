// styles/cards.js
import { StyleSheet } from "react-native";
import { colors, radius, spacing } from "./theme";

export const cardStyles = StyleSheet.create({
  // Default Keepr “panel” card (Facebook-like)
  base: {
    backgroundColor: "#FFFFFF",              // strong contrast vs app bg
    borderRadius: 16,                        // softer corners
    borderWidth: 1,
    borderColor: "#E5E7EB",                  // light gray border
    // Stronger soft shadow so you can SEE it:
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,                             // Android
  },

  padded: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
});
