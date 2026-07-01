import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, shadows } from "../../styles/theme";

const isImageFile = (file = {}) => {
  const mime = String(file.mime_type || "").toLowerCase();
  const name = String(file.file_name || file.storage_path || file.title || "").toLowerCase();
  return mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic|heif)$/.test(name);
};

const isPdfFile = (file = {}) => {
  const mime = String(file.mime_type || "").toLowerCase();
  const name = String(file.file_name || file.storage_path || file.title || "").toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
};

function ShowcaseCard({ icon, title, subtitle, actionLabel, onPress }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={20} color={colors.textPrimary} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.cardSubtitle} numberOfLines={2}>{subtitle}</Text>}
      </View>

      <Text style={styles.actionText}>{actionLabel}</Text>
    </TouchableOpacity>
  );
}

export default function ShowcaseAttachmentsSection({
  files = [],
  links = [],
  getFileUrl,
  variant = "internal",
}) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  if (!files.length && !links.length) return null;

  const openFilePreview = async (file) => {
    try {
      setPreviewLoading(true);
      setPreviewFile(file);
      setPreviewVisible(true);

      const url = await getFileUrl?.(file);
      setPreviewUrl(url || null);
    } catch (e) {
      console.log("Showcase preview error", e);
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewVisible(false);
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewLoading(false);
  };

  const canEmbedPdf = Platform.OS === "web" && previewUrl && isPdfFile(previewFile);
  const canPreviewImage = previewUrl && isImageFile(previewFile);

  return (
    <>
      <View style={[styles.wrap, variant === "public" && styles.wrapPublic]}>
        <View style={styles.header}>
          <Text style={styles.title}>Showcase</Text>
          <Text style={styles.subtitle}>Curated by the owner</Text>
        </View>

        {!!files.length && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Documents</Text>
            {files.map((file) => (
              <ShowcaseCard
                key={file.placement_id || file.attachment_id || file.id}
                icon="document-text-outline"
                title={file.title || file.file_name || "Showcase document"}
                subtitle={file.notes || file.role || file.file_name}
                actionLabel="Preview"
                onPress={() => openFilePreview(file)}
              />
            ))}
          </View>
        )}

        {!!links.length && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Links</Text>
            {links.map((link) => (
              <ShowcaseCard
                key={link.placement_id || link.attachment_id || link.id}
                icon="link-outline"
                title={link.title || "Showcase link"}
                subtitle={link.notes || link.url}
                actionLabel="Visit"
                onPress={() => link.url && Linking.openURL(link.url)}
              />
            ))}
          </View>
        )}
      </View>

      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.modalScrim}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closePreview} />

          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {previewFile?.title || previewFile?.file_name || "Showcase document"}
                </Text>
                <Text style={styles.previewSubtitle}>Keepr Showcase Preview</Text>
              </View>

              <TouchableOpacity style={styles.closeButton} onPress={closePreview}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewBody}>
              {previewLoading ? (
                <ActivityIndicator />
              ) : canPreviewImage ? (
                <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
              ) : canEmbedPdf ? (
                <iframe
                  title="Keepr document preview"
                  src={previewUrl}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "0",
                    borderRadius: 14,
                  }}
                />
              ) : (
                <View style={styles.previewFallback}>
                  <Ionicons name="document-text-outline" size={42} color={colors.textMuted} />
                  <Text style={styles.previewFallbackTitle}>Preview unavailable</Text>
                  <Text style={styles.previewFallbackText}>
                    This file can still be opened from Keepr.
                  </Text>
                </View>
              )}
            </View>

            {!!previewUrl && (
              <TouchableOpacity
                style={styles.openExternalButton}
                onPress={() => Linking.openURL(previewUrl)}
              >
                <Text style={styles.openExternalText}>Open externally</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  wrapPublic: {
  marginHorizontal: 0,
  marginBottom: 0,
  padding: 0,
  borderWidth: 0,
  borderRadius: 0,
  backgroundColor: "transparent",
  shadowOpacity: 0,
  elevation: 0,
},
  header: { marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  group: { marginTop: spacing.sm },
  groupTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  cardSubtitle: { marginTop: 3, fontSize: 12, lineHeight: 16, color: colors.textSecondary },
  actionText: { fontSize: 12, fontWeight: "900", color: colors.brandBlue || colors.primary },

  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(6,10,18,0.76)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  previewCard: {
    width: "100%",
    maxWidth: 920,
    height: Platform.OS === "web" ? "88%" : "82%",
    borderRadius: 24,
    backgroundColor: colors.surface,
    overflow: "hidden",
    padding: 16,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  previewTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  previewSubtitle: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  previewBody: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "100%" },
  previewFallback: { alignItems: "center", justifyContent: "center", padding: 24 },
  previewFallbackTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  previewFallbackText: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
    color: colors.textSecondary,
  },
  openExternalButton: {
    marginTop: 12,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
  },
  openExternalText: { color: "white", fontSize: 13, fontWeight: "900" },
});