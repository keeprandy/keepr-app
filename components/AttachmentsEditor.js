// components/AttachmentsEditor.js
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  colors,
  spacing,
  radius,
  shadows,
} from "../styles/theme";

function isImage(mimeType) {
  return String(mimeType || "")
    .toLowerCase()
    .startsWith("image/");
}

function fileExt(name) {
  if (!name) return "FILE";
  const parts = String(name).split(".");
  if (parts.length < 2) return "FILE";
  return parts[parts.length - 1].toUpperCase();
}

/**
 * Editable attachment card.
 *
 * Props:
 *  - title?: string
 *  - subtitle?: string
 *  - attachments: [
 *      {
 *        id: string;
 *        url: string;
 *        fileName?: string;
 *        mimeType?: string;
 *        kind?: "photo" | "invoice" | "file" | "hero";
 *      }
 *    ]
 *  - showHero?: boolean          // first photo as hero
 *  - onAddPhoto?: () => void
 *  - onAddFile?: () => void
 *  - onOpenAttachment?: (att) => void
 *  - onDeleteAttachment?: (att) => void
 */
export default function AttachmentsEditor({
  title = "Attachments",
  subtitle = "Photos and documents",
  attachments = [],
  showHero = true,
  onAddPhoto,
  onAddFile,
  onOpenAttachment,
  onDeleteAttachment,
}) {
  const photos = attachments.filter(
    (a) => isImage(a.mimeType) || a.kind === "photo" || a.kind === "invoice"
  );
  const files = attachments.filter((a) => !photos.includes(a));

  let heroPhoto = null;
  let extraPhotos = [];

  if (showHero && photos.length > 0) {
    [heroPhoto, ...extraPhotos] = photos;
  } else {
    extraPhotos = photos;
  }

  const handleOpen = (att) => {
    if (onOpenAttachment) onOpenAttachment(att);
  };

  const handleDelete = (att) => {
    if (onDeleteAttachment) onDeleteAttachment(att);
  };

  const totalCount = attachments.length;

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {subtitle}
            {totalCount
              ? ` · ${totalCount} item${totalCount === 1 ? "" : "s"}`
              : ""}
          </Text>
        </View>

        <View style={styles.actionsRow}>
          {onAddFile ? (
            <TouchableOpacity
              style={styles.chipButton}
              activeOpacity={0.9}
              onPress={onAddFile}
            >
              <Ionicons
                name="document-text-outline"
                size={14}
                color={colors.text}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.chipButtonText}>File</Text>
            </TouchableOpacity>
          ) : null}

          {onAddPhoto ? (
            <TouchableOpacity
              style={[styles.chipButton, styles.chipButtonPrimary]}
              activeOpacity={0.9}
              onPress={onAddPhoto}
            >
              <Ionicons
                name="camera-outline"
                size={14}
                color={colors.white}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.chipButtonText, { color: colors.white }]}>
                Photo
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Empty state */}
      {!heroPhoto && extraPhotos.length === 0 && files.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="images-outline" size={18} color={colors.muted} />
          <Text style={styles.emptyText}>
            Add photos or documents to bring this moment to life.
          </Text>
        </View>
      ) : null}

      {/* Hero photo */}
      {heroPhoto && heroPhoto.url ? (
        <View style={styles.heroWrapper}>
          <TouchableOpacity
            style={styles.heroPreview}
            activeOpacity={0.9}
            onPress={() => handleOpen(heroPhoto)}
          >
            <Image
              source={{ uri: heroPhoto.url }}
              style={styles.heroImg}
              resizeMode="cover"
            />
            {heroPhoto.kind === "invoice" && (
              <View style={styles.heroOverlay}>
                <Ionicons
                  name="receipt-outline"
                  size={18}
                  color={colors.white}
                />
                <Text style={styles.heroOverlayText}>Invoice</Text>
              </View>
            )}
          </TouchableOpacity>
          {onDeleteAttachment ? (
            <TouchableOpacity
              style={styles.deleteBadge}
              activeOpacity={0.8}
              onPress={() => handleDelete(heroPhoto)}
            >
              <Ionicons name="close" size={14} color={colors.white} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Photo strip */}
      {extraPhotos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
        >
          {extraPhotos.slice(0, 20).map((ph) => (
            <View key={ph.id || ph.url} style={styles.thumbWrapper}>
              <TouchableOpacity
                style={styles.photoThumb}
                activeOpacity={0.9}
                onPress={() => handleOpen(ph)}
              >
                <Image
                  source={{ uri: ph.url }}
                  style={styles.photoImg}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              {onDeleteAttachment ? (
                <TouchableOpacity
                  style={styles.thumbDelete}
                  activeOpacity={0.8}
                  onPress={() => handleDelete(ph)}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Files list */}
      {files.length > 0 && (
        <View style={styles.filesList}>
          {files.slice(0, 30).map((doc) => (
            <TouchableOpacity
              key={doc.id || doc.url}
              style={styles.fileRow}
              activeOpacity={0.8}
              onPress={() => handleOpen(doc)}
            >
              <View style={styles.fileIconWrap}>
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
              <View style={styles.fileTextWrap}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {doc.fileName || "Attachment"}
                </Text>
                <Text numberOfLines={1} style={styles.fileMeta}>
                  {doc.mimeType || fileExt(doc.fileName)}
                </Text>
              </View>
              {onDeleteAttachment ? (
                <TouchableOpacity
                  style={styles.inlineDelete}
                  activeOpacity={0.8}
                  onPress={() => handleDelete(doc)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  chipButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginLeft: spacing.xs,
  },
  chipButtonPrimary: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  chipButtonText: {
    fontSize: 12,
    color: colors.text,
  },
  emptyState: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  emptyText: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  heroWrapper: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  heroPreview: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
  },
  heroImg: {
    width: "100%",
    height: "100%",
  },
  heroOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.45)",
    flexDirection: "row",
    alignItems: "center",
  },
  heroOverlayText: {
    marginLeft: spacing.xs,
    fontSize: 12,
    fontWeight: "600",
    color: colors.white,
  },
  deleteBadge: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.7)",
  },
  photoStrip: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  thumbWrapper: {
    marginRight: 6,
  },
  photoThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
  },
  photoImg: {
    width: "100%",
    height: "100%",
  },
  thumbDelete: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.8)",
  },
  filesList: {
    marginTop: spacing.md,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  fileIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  fileTextWrap: {
    flex: 1,
  },
  fileName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  fileMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  inlineDelete: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
});
