import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { colors, radius, spacing } from "../styles/theme";
import { getLinkCover, getLinkDomain } from "../lib/linkCover";

function safeStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function displayTitle(attachment, cover) {
  const title = safeStr(attachment?.title);
  const url = safeStr(attachment?.url);
  if (title && title !== url) return title;
  return safeStr(cover?.display_title) || getLinkDomain(url) || "Saved link";
}

function formatDate(raw) {
  if (!raw) return "";
  try {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

export default function LinkCoverCard({
  attachment,
  selected = false,
  loading = false,
  compact = false,
  onPress,
  onOpen,
  rightActions = null,
}) {
  const cover = getLinkCover(attachment);
  const url = safeStr(attachment?.url);
  const domain = safeStr(cover?.source_domain) || getLinkDomain(url);
  const title = displayTitle(attachment, cover);
  const description = safeStr(cover?.display_description);
  const imageUrl = safeStr(cover?.preview_image_url);
  const status = safeStr(cover?.enrichment_status).toLowerCase();
  const added = formatDate(attachment?.created_at);

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.card,
        compact && styles.cardCompact,
        selected && styles.cardSelected,
      ]}
    >
      <View style={[styles.media, compact && styles.mediaCompact]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.fallback}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="link-outline" size={compact ? 18 : 22} color={colors.primary} />
            )}
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.labelRow}>
          <Text style={styles.label} numberOfLines={1}>
            {domain || "Link"}
          </Text>
          {status === "failed" ? (
            <Text style={styles.status}>Preview unavailable</Text>
          ) : loading ? (
            <Text style={styles.status}>Loading preview</Text>
          ) : null}
        </View>
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={compact ? 2 : 2}>
          {title}
        </Text>
        {description && !compact ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Text style={styles.url} numberOfLines={1}>
            {url}
          </Text>
          {added ? <Text style={styles.added}>Added {added}</Text> : null}
        </View>
      </View>

      <View style={styles.actions}>
        {rightActions || (
          <TouchableOpacity
            onPress={onOpen}
            style={styles.openBtn}
            accessibilityLabel="Open link"
          >
            <Ionicons name="open-outline" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const shadow = Platform.select({
  web: { boxShadow: "0 8px 20px rgba(15,23,42,0.08)" },
  default: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 116,
    ...shadow,
  },
  cardCompact: {
    minHeight: 76,
    padding: 10,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: "#F8FBFF",
  },
  media: {
    width: 112,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#EEF5FF",
    marginRight: spacing.md,
  },
  mediaCompact: {
    width: 58,
    marginRight: 10,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF5FF",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  label: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    flexShrink: 1,
  },
  status: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  titleCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  description: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    marginTop: 6,
  },
  url: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  added: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  actions: {
    justifyContent: "center",
    marginLeft: 8,
  },
  openBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
});
