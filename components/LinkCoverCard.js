import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
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

function displaySource(cover, url) {
  return safeStr(cover?.source_name) || safeStr(cover?.source_domain) || getLinkDomain(url) || "Link";
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
  onRetry,
  rightActions = null,
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const cover = getLinkCover(attachment);
  const url = safeStr(attachment?.url);
  const domain = safeStr(cover?.source_domain) || getLinkDomain(url);
  const source = displaySource(cover, url);
  const title = displayTitle(attachment, cover);
  const description = safeStr(cover?.display_description);
  const imageUrl = safeStr(cover?.preview_image_url);
  const faviconUrl = safeStr(cover?.favicon_url);
  const contentKind = safeStr(cover?.content_kind).toLowerCase();
  const isVideo = contentKind === "video";
  const status = safeStr(cover?.enrichment_status).toLowerCase();
  const added = formatDate(attachment?.created_at);
  const showImage = imageUrl && !imageFailed;
  const showFavicon = faviconUrl && !faviconFailed;

  useEffect(() => {
    setImageFailed(false);
    setFaviconFailed(false);
  }, [imageUrl, faviconUrl]);

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
        {showImage ? (
          <>
            <Image
              source={{ uri: imageUrl }}
              style={styles.image}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
            {isVideo ? (
              <View style={styles.playBadge}>
                <Ionicons name="play" size={compact ? 14 : 18} color="#FFFFFF" />
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.fallback}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : showFavicon ? (
              <Image
                source={{ uri: faviconUrl }}
                style={compact ? styles.faviconCompact : styles.favicon}
                resizeMode="contain"
                onError={() => setFaviconFailed(true)}
              />
            ) : (
              <Ionicons name="link-outline" size={compact ? 18 : 22} color={colors.primary} />
            )}
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.labelRow}>
          <Text style={styles.label} numberOfLines={1}>
            {isVideo ? `${source} · Video` : source}
          </Text>
          {status === "failed" ? (
            <Text style={styles.status} numberOfLines={1}>Preview unavailable</Text>
          ) : loading ? (
            <Text style={styles.status} numberOfLines={1}>Loading preview</Text>
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
            {domain || url}
          </Text>
          {added ? <Text style={styles.added}>Added {added}</Text> : null}
          {status === "failed" && onRetry ? (
            <TouchableOpacity
              onPress={onRetry}
              style={styles.retryBtn}
              accessibilityLabel="Retry link preview"
            >
              <Ionicons name="refresh-outline" size={12} color={colors.primary} />
              <Text style={styles.retryText}>Retry preview</Text>
            </TouchableOpacity>
          ) : null}
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
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 96,
    ...shadow,
  },
  cardCompact: {
    minHeight: 74,
    padding: 10,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: "#F8FBFF",
  },
  media: {
    width: 112,
    height: 78,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#EEF5FF",
    marginRight: spacing.md,
  },
  mediaCompact: {
    width: 58,
    height: 58,
    marginRight: 10,
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "#EAF2FF",
  },
  playBadge: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
  },
  fallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F8FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  favicon: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  faviconCompact: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  body: {
    flex: 1,
    minWidth: 0,
    alignSelf: "center",
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
    flexShrink: 0,
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
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  url: {
    color: colors.textSecondary,
    fontSize: 12,
    maxWidth: "65%",
  },
  added: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  retryBtn: {
    marginLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#EFF6FF",
  },
  retryText: {
    marginLeft: 4,
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  actions: {
    justifyContent: "center",
    marginLeft: 8,
    alignSelf: "center",
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
