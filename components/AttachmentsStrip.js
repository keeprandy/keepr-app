// components/AttachmentsStrip.js
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
 * Props:
 *  - attachments: [
 *      { id, url, fileName?, mimeType?, kind?: "photo" | "invoice" | "file" }
 *    ]
 *  - onOpenAttachment(att)
 *  - showHero: boolean (first photo as big hero)
 */
export default function AttachmentsStrip({
  attachments = [],
  onOpenAttachment,
  showHero = true,
}) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const photos = attachments.filter((a) => isImage(a.mimeType) || a.kind === "photo" || a.kind === "invoice");
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

  return (
    <View>
      {/* Hero */}
      {heroPhoto && heroPhoto.url ? (
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
      ) : null}

      {/* Photo strip */}
      {extraPhotos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
        >
          {extraPhotos.slice(0, 10).map((ph) => (
            <TouchableOpacity
              key={ph.id || ph.url}
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
          ))}
        </ScrollView>
      )}

      {/* Files */}
      {files.length > 0 && (
        <View style={styles.docChips}>
          {files.slice(0, 10).map((doc) => (
            <TouchableOpacity
              key={doc.id || doc.url}
              style={styles.docChip}
              activeOpacity={0.9}
              onPress={() => handleOpen(doc)}
            >
              <View style={styles.docChipBadge}>
                <Text style={styles.docChipBadgeText}>
                  {fileExt(doc.fileName)}
                </Text>
              </View>
              <Text style={styles.docChipText} numberOfLines={1}>
                {doc.fileName || "Attachment"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heroPreview: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
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
  photoStrip: {
    flexDirection: "row",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  photoThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    overflow: "hidden",
    marginRight: 6,
    backgroundColor: colors.surface,
  },
  photoImg: {
    width: "100%",
    height: "100%",
  },
  docChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  docChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: 6,
    marginBottom: 6,
    ...shadows.sm,
  },
  docChipBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
    marginRight: 6,
  },
  docChipBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  docChipText: {
    fontSize: 12,
    color: colors.text,
    maxWidth: 140,
  },
});
