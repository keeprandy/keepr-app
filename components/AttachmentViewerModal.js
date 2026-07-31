// components/AttachmentViewerModal.js
import React, { useMemo, useEffect, useState } from "react";
import {
  Modal,
  PanResponder,
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
import { WebView } from "react-native-webview";
import LinkCoverCard from "./LinkCoverCard";

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
  deleteNeedsConfirmation = true,
  onEditContext,
  onToggleShowcase,
  showcaseBusy = false,
  assetName,
  // Optional context for launching Keepr Intelligence
  assetId,
  systemId,
  recordId,
  onSendToKI,
  // Back-compat alias
  onIntelligence,
}) {
  const url = attachment?.urls?.signed || attachment?.urls?.public || attachment?.url || null;
  const [profileOpen, setProfileOpen] = useState(IS_WEB);

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
  const isShowcase = !!(attachment?.is_showcase || attachment?.isShowcase);
  const linkCover = attachment?.ai_metadata?.link_cover;
  const aiMetadata = attachment?.ai_metadata && typeof attachment.ai_metadata === "object"
    ? attachment.ai_metadata
    : {};
  const placements = Array.isArray(attachment?.placements) ? attachment.placements : [];
  const relatedSystems = placements
    .filter((p) => p?.target_type === "system")
    .map((p) => p?.label || p?.name || p?.target_label || p?.target_id)
    .filter(Boolean);
  const relatedRecords = placements
    .filter((p) => p?.target_type === "service_record")
    .map((p) => p?.label || p?.title || p?.target_label || p?.target_id)
    .filter(Boolean);
  const sourceLabel = linkCover?.source_name || linkCover?.source_domain || (isLink ? typeLabel : "");
  const metadataSummary =
    aiMetadata.summary ||
    aiMetadata.extracted_summary ||
    aiMetadata.description ||
    linkCover?.display_description ||
    "";

  const badge = useMemo(
    () => ({ label: (ext || (isLink ? "LINK" : "FILE")).toUpperCase(), tone: badgeTone }),
    [ext, badgeTone, isLink]
  );

  const canNav = Array.isArray(collection) && collection.length > 1;
  const safeIndex = Math.max(0, Math.min(index || 0, (collection?.length || 1) - 1));

  useEffect(() => {
    setProfileOpen(IS_WEB);
  }, [attachment?.id, attachment?.attachment_id]);

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

  useEffect(() => {
    if (!visible || !IS_WEB || typeof window === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, canNav, safeIndex, collection?.length, onClose]);

  const swipeResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        (Math.abs(gestureState.dx) > 28 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4) ||
        (Math.abs(gestureState.dy) > 32 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.3),
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
          if (Math.abs(gestureState.dx) < 48) return;
          if (gestureState.dx > 0) goPrev();
          else goNext();
          return;
        }
        if (gestureState.dy < -48) setProfileOpen(true);
        if (gestureState.dy > 48) setProfileOpen(false);
      },
    }),
    [canNav, safeIndex, collection?.length]
  );

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
    if (!deleteNeedsConfirmation) {
      onDelete();
      return;
    }
    confirmAction(
      "Remove evidence?",
      "This will remove this attachment from the story.",
      "Remove",
      onDelete
    );
  };

  const ProfileDetailRow = ({ label, value, multiline = false }) => (
    <View style={styles.profileRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={multiline ? 5 : 2}>
        {value || "—"}
      </Text>
    </View>
  );

  const profilePanel = (
    <View style={[styles.profilePanel, IS_MOBILE && styles.profileSheet]}>
      {IS_MOBILE ? (
        <View style={styles.sheetHandleRow}>
          <View style={styles.sheetHandle} />
          <TouchableOpacity onPress={() => setProfileOpen(false)} style={styles.sheetClose}>
            <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.profileContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHeader}>
          <View style={styles.headerIcon}>
            <Ionicons name={isLink ? "link-outline" : iconName} size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.profileEyebrow}>Attachment Profile</Text>
            <Text style={styles.profileTitle} numberOfLines={2}>{title || "Attachment"}</Text>
          </View>
        </View>

        <Text style={styles.section}>Identity</Text>
        <ProfileDetailRow label="Type" value={sourceLabel ? `${typeLabel} · ${sourceLabel}` : typeLabel} />
        <ProfileDetailRow label="Original file" value={isLink ? url : fileName} />
        <ProfileDetailRow label="Added" value={formatDate(uploadedAt)} />
        <ProfileDetailRow label="Size" value={formatSize(size)} />

        <Text style={[styles.section, styles.sectionSpaced]}>Ownership Context</Text>
        <ProfileDetailRow label="Asset" value={assetName || attachment?.asset_name || "This asset"} />
        <ProfileDetailRow label="Systems" value={relatedSystems.join(", ") || attachment?.system_name || "Not linked"} />
        <ProfileDetailRow label="Service records" value={relatedRecords.join(", ") || "Not linked"} />
        <ProfileDetailRow label="Role" value={attachment?.role || "Other"} />
        <ProfileDetailRow label="Showcase" value={isShowcase ? "Shown in Showcase" : "Not showcased"} />
        <ProfileDetailRow label="Visibility" value={attachment?.visibility || aiMetadata.visibility || "Private"} />

        <Text style={[styles.section, styles.sectionSpaced]}>What We Know</Text>
        <ProfileDetailRow label="Notes" value={notes || "No notes yet"} multiline />
        <ProfileDetailRow label="Summary" value={metadataSummary || "No summary yet"} multiline />
        {isLink ? <ProfileDetailRow label="Canonical link" value={linkCover?.canonical_url || url} multiline /> : null}
        {aiMetadata.document_type ? <ProfileDetailRow label="Document type" value={aiMetadata.document_type} /> : null}
        {aiMetadata.source_context ? <ProfileDetailRow label="Source context" value={aiMetadata.source_context} multiline /> : null}

        <View style={styles.footerActions}>
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            onPress={handleOpen}
            disabled={!url}
          >
            <Ionicons name="open-outline" size={18} color={colors.surface} />
            <Text style={styles.btnTextPrimary}>Open</Text>
          </TouchableOpacity>

          {onEditContext ? (
            <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={onEditContext}>
              <Ionicons name="document-text-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.btnTextSecondary}>Edit Context</Text>
            </TouchableOpacity>
          ) : null}

          {onToggleShowcase ? (
            <TouchableOpacity
              style={[styles.btn, styles.secondary, showcaseBusy && { opacity: 0.6 }]}
              onPress={onToggleShowcase}
              disabled={showcaseBusy}
            >
              <Ionicons name={isShowcase ? "star" : "star-outline"} size={18} color={colors.textPrimary} />
              <Text style={styles.btnTextSecondary}>{isShowcase ? "Showcased" : "Showcase"}</Text>
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
  );

  // ----- Shared content (header + body) -----
  const content = (
    <>
      <View style={styles.headerRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {canNav ? (
          <Text style={styles.counter}>
            {safeIndex + 1} of {collection.length}
          </Text>
        ) : null}
      </View>

      <View style={styles.headerActions}>
        {IS_WEB ? (
          <TouchableOpacity onPress={() => setProfileOpen((open) => !open)} style={styles.infoButton}>
            <Ionicons name="information-circle-outline" size={21} color={colors.primary} />
            <Text style={styles.infoButtonText}>{profileOpen ? "Hide details" : "Details"}</Text>
          </TouchableOpacity>
        ) : null}
        {IS_MOBILE ? (
          <TouchableOpacity onPress={() => setProfileOpen(true)} style={styles.infoButton}>
            <Ionicons name="information-circle-outline" size={21} color={colors.primary} />
            <Text style={styles.infoButtonText}>Info</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close-outline" size={26} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      </View>

      <View style={styles.body}>
        <View
          style={[
            styles.preview,
            isLink && styles.linkPreview,
            IS_WEB && profileOpen && styles.previewWithProfile,
          ]}
          {...(IS_MOBILE && canNav ? swipeResponder.panHandlers : {})}
        >
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
              <View style={styles.imageStage}>
                <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
              </View>
            ) : isPdfDoc && url ? (
              IS_WEB ? (
                <iframe title="Preview" src={url} style={styles.pdfFrame} />
              ) : (
                <WebView
                  source={{ uri: url }}
                  style={styles.pdfNativeFrame}
                  originWhitelist={["*"]}
                  scrollEnabled
                  nestedScrollEnabled
                />
              )
            ) : isLink && url ? (
            <View style={styles.linkStage}>
              <LinkCoverCard
                attachment={attachment}
                onPress={handleOpen}
                onOpen={handleOpen}
              />
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

        {IS_WEB && profileOpen ? profilePanel : null}
      </View>
      {IS_MOBILE && !profileOpen ? (
        <TouchableOpacity style={styles.infoHint} onPress={() => setProfileOpen(true)}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.infoHintText}>Info</Text>
        </TouchableOpacity>
      ) : null}
      {IS_MOBILE && profileOpen ? profilePanel : null}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {content}
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
    ...(IS_WEB
      ? { maxWidth: 1480, height: "88%", maxHeight: 900 }
      : { maxHeight: "86%" }),
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  infoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  infoButtonText: {
    marginLeft: 4,
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
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

  body: {
    flexDirection: IS_WEB ? "row" : "column",
    gap: spacing.md,
    flex: IS_WEB ? 1 : 0,
    minHeight: 0,
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },

preview: {
  flexGrow: IS_WEB ? 1 : 0,
  flexShrink: IS_WEB ? 1 : 0,
  flexBasis: IS_WEB ? 0 : "auto",
  height: IS_WEB ? undefined : 330,
  minHeight: IS_WEB ? 0 : undefined,
  minWidth: IS_WEB ? 0 : undefined,
  backgroundColor: "#000",
  borderRadius: radius.lg,
  overflow: "hidden",
},

previewWithProfile: {
  marginRight: IS_WEB ? 396 : 0,
},

linkPreview: {
  flexGrow: IS_WEB ? 1 : 0,
  flexShrink: IS_WEB ? 1 : 0,
  flexBasis: IS_WEB ? 0 : "auto",
  height: IS_WEB ? undefined : 230,
  minHeight: IS_WEB ? 260 : undefined,
  minWidth: IS_WEB ? 0 : undefined,
  backgroundColor: colors.bg || "#F8FAFC",
},

linkStage: {
  flex: 1,
  width: "100%",
  height: "100%",
  backgroundColor: colors.bg || "#F8FAFC",
  justifyContent: "center",
  padding: IS_WEB ? spacing.xl : spacing.md,
},

image: {
  width: "100%",
  height: "100%",
  alignSelf: "center",
},

imageStage: {
  flex: 1,
  width: "100%",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
},


pdfNativeFrame: {
  flex: 1,
  width: "100%",
  backgroundColor: "#fff",
},

navBtn: {
  position: "absolute",
  top: "50%",
  marginTop: -20,
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: "rgba(0,0,0,0.4)",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 5,
},
  navLeft: { left: 12 },
  navRight: { right: 12 },

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

  profilePanel: {
    flex: IS_WEB ? 0 : 1,
    flexShrink: IS_WEB ? 0 : 1,
    width: IS_WEB ? 360 : "100%",
    maxWidth: IS_WEB ? 380 : undefined,
    ...(IS_WEB
      ? {
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
        }
      : null),
    minHeight: IS_WEB ? 0 : 160,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  profileSheet: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    maxHeight: "76%",
    minHeight: 260,
    zIndex: 20,
    ...shadowSm,
  },
  sheetHandleRow: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  sheetClose: {
    position: "absolute",
    right: 10,
    top: 8,
  },
  profileContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  profileEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  profileTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
    marginTop: 2,
  },
  profileRow: {
    marginBottom: spacing.sm,
  },
  sectionSpaced: {
    marginTop: spacing.md,
  },
  infoHint: {
    position: "absolute",
    left: "50%",
    bottom: spacing.lg,
    transform: [{ translateX: -46 }],
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadowSm,
  },
  infoHintText: {
    marginLeft: 6,
    color: colors.primary,
    fontWeight: "900",
    fontSize: 13,
  },

  section: { fontSize: 14, fontWeight: "900", color: colors.textPrimary, marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, marginTop: spacing.xs },
  value: { fontSize: 13, color: colors.textPrimary, marginTop: 2 },

  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: spacing.md,
    gap: spacing.sm,
  },
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
