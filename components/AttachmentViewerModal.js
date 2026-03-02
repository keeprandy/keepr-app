// components/AttachmentViewerModal.js
import React, { useMemo } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Linking,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, shadows } from "../styles/theme";
import { confirmAction } from "../lib/confirm";

const IS_WEB = Platform.OS === "web";
  const IS_MOBILE = Platform.OS !== "web";

function getExt(name) {
  const s = String(name || "").split("?")[0].split("#")[0];
  const parts = s.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() || "").toLowerCase();
}

function iconForExt(ext) {
  if (!ext) return "document-text-outline";
  if (["jpg", "jpeg", "png", "gif", "heic", "webp"].includes(ext)) return "image-outline";
  if (["pdf"].includes(ext)) return "document-text-outline";
  if (["doc", "docx"].includes(ext)) return "document-text-outline";
  if (["xls", "xlsx", "csv"].includes(ext)) return "grid-outline";
  if (["ppt", "pptx", "key"].includes(ext)) return "easel-outline";
  return "document-outline";
}

function toneForExt(ext) {
  if (!ext) return "muted";
  if (["jpg", "jpeg", "png", "gif", "heic", "webp"].includes(ext)) return "purple";
  if (["pdf"].includes(ext)) return "red";
  if (["doc", "docx"].includes(ext)) return "blue";
  if (["xls", "xlsx", "csv"].includes(ext)) return "green";
  if (["ppt", "pptx", "key"].includes(ext)) return "orange";
  return "muted";
}

function isPhotoLike(ext, contentType) {
  const ct = String(contentType || "").toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "heic", "webp"].includes(ext) || ct.startsWith("image/");
}

function isPdf(ext, contentType) {
  const ct = String(contentType || "").toLowerCase();
  return ext === "pdf" || ct === "application/pdf";
}

function cleanDefaultTitle(fileName) {
  if (!fileName) return "";
  const base = fileName.split("?")[0].split("#")[0];
  const parts = base.split(".");
  parts.pop();
  const noExt = parts.join(".");
  return noExt.replace(/[_-]?\d{8,}/g, " ").replace(/[_-]+/g, " ").trim();
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString?.() || iso;
  } catch {
    return iso;
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const n = Number(bytes);
  if (Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

async function safeOpen(url) {
  const u = String(url || "").trim();
  if (!u) return;

  try {
    if (IS_WEB && typeof window !== "undefined") {
      window.open(u, "_blank", "noopener,noreferrer");
      return;
    }

    const supported = await Linking.canOpenURL(u);
    if (!supported) {
      Alert.alert("Can't open link", u);
      return;
    }
    await Linking.openURL(u);
  } catch (e) {
    console.log("AttachmentViewerModal: openURL error", e);
    Alert.alert("Couldn't open", "Please try again.");
  }
}

export default function AttachmentViewerModal({
  visible,
  attachment,
  collection = [],
  index = 0,
  onIndexChange,
  onClose,
  onDelete,
  // Optional context for launching Keepr Intelligence
  assetId,
  systemId,
  recordId,
  onSendToKI,
  // Back-compat alias
  onIntelligence,
}) {
  if (!attachment) return null;

  const url = attachment?.urls?.signed || attachment?.urls?.public || attachment?.url || null;

  const fileName =
    attachment?.fileName ||
    attachment?.name ||
    attachment?.storage?.path?.split("/")?.slice(-1)[0] ||
    "Attachment";

  const ext = getExt(fileName);
  const iconName = iconForExt(ext);
  const badgeTone = toneForExt(ext);

  const title =
    attachment?.title ||
    attachment?.meta?.title ||
    attachment?.metadata?.title ||
    attachment?.extra_metadata?.title ||
    cleanDefaultTitle(fileName) ||
    fileName;

  const notes =
    attachment?.notes ||
    attachment?.meta?.notes ||
    attachment?.metadata?.notes ||
    attachment?.extra_metadata?.notes ||
    "";

  const typeLabel =
    attachment?.contentType ||
    attachment?.mimeType ||
    attachment?.mime_type ||
    (attachment?.kind === "link" ? "Link" : "Unknown");

  const uploadedAt =
    attachment?.known?.uploadedAt ||
    attachment?.created_at ||
    attachment?.uploaded_at ||
    null;

  const size =
    attachment?.known?.sizeBytes ||
    attachment?.size ||
    attachment?.metadata?.size ||
    null;

  const isPhoto = isPhotoLike(ext, attachment?.contentType);
  const isPdfDoc = isPdf(ext, attachment?.contentType);
  const isLink = attachment?.kind === "link" || typeLabel === "Link";

  const badge = useMemo(
    () => ({ label: (ext || (isLink ? "LINK" : "FILE")).toUpperCase(), tone: badgeTone }),
    [ext, badgeTone, isLink]
  );

  const canNav = Array.isArray(collection) && collection.length > 1;
  const safeIndex = Math.max(0, Math.min(index || 0, (collection?.length || 1) - 1));

  const goPrev = () => {
    if (!canNav) return;
    const next = safeIndex - 1 < 0 ? collection.length - 1 : safeIndex - 1;
    onIndexChange?.(next);
  };

  const goNext = () => {
    if (!canNav) return;
    const next = safeIndex + 1 >= collection.length ? 0 : safeIndex + 1;
    onIndexChange?.(next);
  };

  const handleOpen = () => {
    if (!url) return;
    safeOpen(url);
  };

  const handleSendToKI = () => {
    const fn = onSendToKI || onIntelligence;
    if (!fn) return;
    fn({
      attachmentId: attachment?.id,
      assetId,
      systemId,
      recordId,
      attachment,
    });
  };


  const confirmDelete = () => {
    if (!onDelete) return;
    confirmAction(
      "Remove evidence?",
      "This will remove this attachment from the story.",
      "Remove",
      onDelete
    );
  };

  // ----- Shared content (header + body) -----
  const content = (
    <>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name={iconName} size={18} color={colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.metaRow}>
              <Badge label={badge.label} tone={badge.tone} />
              <Text style={styles.metaFileName} numberOfLines={1}>
                {fileName}
              </Text>
              {canNav ? (
                <Text style={styles.counter}>
                  {safeIndex + 1}/{collection.length}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <TouchableOpacity onPress={onClose} accessibilityLabel="Close preview">
          <Ionicons name="close-outline" size={26} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <View style={styles.preview}>
          {/* Prev/Next overlay */}
          {canNav ? (
            <>
              <TouchableOpacity style={[styles.navBtn, styles.navLeft]} onPress={goPrev}>
                <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.navBtn, styles.navRight]} onPress={goNext}>
                <Ionicons name="chevron-forward-outline" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </>
          ) : null}

          {isPhoto && url ? (
            <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
          ) : IS_WEB && isPdfDoc && url ? (
            <iframe title="Preview" src={url} style={styles.pdfFrame} />
          ) : isLink && url ? (
            <View style={styles.evidenceCard}>
              <View style={styles.evidenceTop}>
                <Badge label="LINK" tone="badgeMuted" />
                <Text style={styles.evidenceTitle} numberOfLines={2}>
                  {title}
                </Text>
              </View>
              <TouchableOpacity onPress={handleOpen} activeOpacity={0.85}>
                <Text style={[styles.evidenceSub, styles.linkText]} numberOfLines={2}>
                  {url}
                </Text>
                <View style={styles.evidenceHintRow}>
                  <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.evidenceHint}>Tap to open in browser</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.evidenceCard}>
              <View style={styles.evidenceTop}>
                <Badge label={badge.label} tone={badge.tone} />
                <Text style={styles.evidenceTitle} numberOfLines={2}>
                  {title || "Evidence"}
                </Text>
              </View>
              <Text style={styles.evidenceSub} numberOfLines={2}>
                {typeLabel}
              </Text>
              <View style={styles.evidenceHintRow}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={styles.evidenceHint}>
                  Preview not available here — use Open below.
                </Text>
              </View>
        {url ? (
          <TouchableOpacity
            onPress={() => safeOpen(url)}
            style={[
              styles.btn,
              styles.primary,
              IS_MOBILE && { width: "100%", justifyContent: "center" },
              { marginTop: 12 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open original"
          >
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text style={styles.btnTextPrimary}>Open</Text>
          </TouchableOpacity>
        ) : null}

            </View>
          )}
        </View>

        <View style={styles.sidebar}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: spacing.md }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.section}>What we know</Text>

            <Text style={styles.label}>Title</Text>
            <Text style={styles.value} numberOfLines={3}>
              {title || "—"}
            </Text>

            {notes ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.sm }]}>Notes</Text>
                <Text style={styles.value}>{notes}</Text>
              </>
            ) : null}

            <Text style={[styles.label, { marginTop: spacing.md }]}>Evidence type</Text>
            <Text style={styles.value}>{typeLabel}</Text>

            <Text style={[styles.label, { marginTop: spacing.sm }]}>Added</Text>
            <Text style={styles.value}>{formatDate(uploadedAt)}</Text>

            <Text style={[styles.label, { marginTop: spacing.sm }]}>Size</Text>
            <Text style={styles.value}>{formatSize(size)}</Text>

            <View style={styles.footerActions}>
              <TouchableOpacity
                style={[styles.btn, styles.primary]}
                onPress={handleOpen}
                disabled={!url}
              >
                <Ionicons name="open-outline" size={18} color={colors.surface} />
                <Text style={styles.btnTextPrimary}>Open</Text>
              </TouchableOpacity>

              {(onSendToKI || onIntelligence) && assetId && attachment?.id ? (
                <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={handleSendToKI}>
                  <Ionicons name="sparkles-outline" size={18} color={colors.text} />
                  <Text style={styles.btnTextSecondary}>Intelligence</Text>
                </TouchableOpacity>
              ) : null}

              {onDelete ? (
                <TouchableOpacity style={[styles.btn, styles.danger]} onPress={confirmDelete}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <Text style={styles.btnTextDanger}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {IS_WEB ? (
            content
          ) : (
            <ScrollView
              style={styles.cardScroll}
              contentContainerStyle={styles.cardScrollContent}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {content}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Badge({ label, tone }) {
  const styleKey =
    tone === "red"
      ? "badgeRed"
      : tone === "blue"
      ? "badgeBlue"
      : tone === "green"
      ? "badgeGreen"
      : tone === "orange"
      ? "badgeOrange"
      : "badgeMuted";

  return (
    <View style={[styles.badge, styles[styleKey]]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const shadowSm =
  shadows?.sm || {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  };

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadowSm,
    ...(IS_WEB ? { maxWidth: 1240, maxHeight: "92%" } : { maxHeight: "92%" }),
  },
  cardScroll: {
    flexGrow: 0,
  },
  cardScrollContent: {
    paddingBottom: spacing.md,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: spacing.md },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 2, flexWrap: "wrap" },
  metaFileName: { marginLeft: spacing.sm, fontSize: 12, color: colors.textSecondary, maxWidth: 520 },
  counter: { marginLeft: spacing.sm, fontSize: 12, fontWeight: "800", color: colors.textSecondary },

  body: { flexDirection: IS_WEB ? "row" : "column", gap: spacing.md },

  preview: {
    flex: IS_WEB ? 3 : 0,
    minHeight: IS_WEB ? 560 : 360,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },

  navBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.78)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  navLeft: { left: 12 },
  navRight: { right: 12 },

  image: { width: "100%", height: "100%" },
  pdfFrame: { width: "100%", height: "100%", border: "none", borderRadius: radius.md },

  evidenceCard: {
    width: "100%",
    height: "100%",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    justifyContent: "center",
  },
  evidenceTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  evidenceTitle: { flex: 1, fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  evidenceSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  linkText: { textDecorationLine: "underline", fontWeight: "600" },
  evidenceHintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md },
  evidenceHint: { flex: 1, fontSize: 13, color: colors.textSecondary },

  sidebar: { flex: IS_WEB ? 2 : 0, width: "100%" },

  section: { fontSize: 14, fontWeight: "900", color: colors.textPrimary, marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, marginTop: spacing.xs },
  value: { fontSize: 13, color: colors.textPrimary, marginTop: 2 },

  footerActions: { flexDirection: "row", alignItems: "center", marginTop: spacing.md, gap: spacing.sm },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
  },
  primary: { backgroundColor: colors.brandBlue || colors.primary },
  secondary: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle },
  danger: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.dangerSoft || "#ffd6d6" },
  btnTextPrimary: { marginLeft: 8, fontWeight: "800", color: colors.surface },
  btnTextSecondary: { marginLeft: 8, fontWeight: "800", color: colors.text },
  btnTextDanger: { marginLeft: 8, fontWeight: "800", color: colors.danger },

  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  badgeRed: { backgroundColor: "#fee2e2" },
  badgeBlue: { backgroundColor: "#dbeafe" },
  badgeGreen: { backgroundColor: "#dcfce7" },
  badgeOrange: { backgroundColor: "#ffedd5" },
  badgeMuted: { backgroundColor: colors.surfaceSubtle },
});
