// components/AssetHeroCard.js
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  colors,
  spacing,
  radius,
  typography,
  shadows,
} from "../styles/theme";

const CARD_IMAGE_ASPECT = 4 / 3;

const getTypeIconName = (type) => {
  switch (type) {
    case "car":
      return "car-outline";
    case "sports":
      return "speedometer-outline";
    case "moto":
      return "bicycle-outline";
    case "boat":
      return "boat-outline";
    default:
      return "ellipse-outline";
  }
};

const statusStyle = (statusLevel) => {
  switch (statusLevel) {
    case "ok":
      return { backgroundColor: "#DCFCE7" };
    case "warning":
      return { backgroundColor: "#FEF3C7" };
    case "danger":
      return { backgroundColor: "#FEE2E2" };
    case "info":
    default:
      return { backgroundColor: "#E0F2FE" };
  }
};

export default function AssetHeroCard({
  asset,
  onPress,          // Story
  onPressShowcase,  // Photos (optional)
}) {
  if (!asset) return null;

  const {
    name,
    role,
    type,
    nextService,
    usage,
    status = "Healthy",
    statusLevel = "info",
    tagStatus,
    image,
  } = asset;

  const hasImage = !!image;

  return (
    <View style={styles.card}>
      {/* Whole top area = Story */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={styles.pressArea}
      >
        {/* Hero image / placeholder */}
        <View style={styles.heroWrap}>
          {hasImage ? (
            <Image
              source={{ uri: image }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons
                name={getTypeIconName(type)}
                size={32}
                color={colors.brandWhite}
              />
            </View>
          )}
        </View>

        {/* Text content */}
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            {name || "Unnamed asset"}
          </Text>
          {!!role && (
            <Text style={styles.role} numberOfLines={1}>
              {role}
            </Text>
          )}
          <Text style={styles.line} numberOfLines={1}>
            {nextService || "Next service not defined yet."}
          </Text>
          <Text style={styles.lineMuted} numberOfLines={1}>
            {usage || "Usage summary will appear here."}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Footer row: status + big Photos button */}
      <View style={styles.footerRow}>
        <View style={[styles.statusPill, statusStyle(statusLevel)]}>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        {onPressShowcase && (
          <TouchableOpacity
            style={styles.photosButton}
            onPress={onPressShowcase}
            activeOpacity={0.85}
          >
            <Ionicons
              name="images-outline"
              size={14}
              color={colors.brandWhite}
            />
            <Text style={styles.photosButtonText}>View photos</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tag info */}
      <View style={styles.tagRow}>
        <Ionicons
          name="hardware-chip-outline"
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.tagText} numberOfLines={1}>
          {tagStatus || "No Tag connected yet"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  pressArea: {
    flexDirection: "column",
  },
  heroWrap: {
    width: "100%",
    aspectRatio: CARD_IMAGE_ASPECT,
    backgroundColor: colors.surfaceSubtle,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  role: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  line: {
    fontSize: 12,
    color: colors.textPrimary,
    marginTop: 4,
  },
  lineMuted: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textPrimary,
  },

  photosButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,          // bigger tap target
    backgroundColor: colors.brandBlue,
  },
  photosButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandWhite,
    marginLeft: 4,
  },

  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  tagText: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: 4,
  },
});
