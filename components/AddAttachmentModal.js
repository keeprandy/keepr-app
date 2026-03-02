// components/AddAttachmentModal.js
import React, { useMemo, useState, useEffect } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Platform,
  TextInput,
  Image,
  ScrollView,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, shadows } from "../styles/theme";
import { UPIP } from "../lib/upip";
import { supabase } from "../lib/supabaseClient";
import { useOperationFeedback } from "../context/OperationFeedbackContext";

const IS_WEB = Platform.OS === "web";

function cleanDefaultTitle(fileName) {
  const s = String(fileName || "").trim();
  if (!s) return "Attachment";

  const noExt = s.replace(/\.[^/.]+$/, "");
  const stripped = noExt
    .replace(/^\d{10,}[_-]*/g, "")
    .replace(/^[a-f0-9]{10,}[_-]*/i, "");
  const human = stripped.replace(/[_-]+/g, " ").trim();

  if (!human) return "Attachment";

  return human[0].toUpperCase() + human.slice(1);
}

function guessKindFromMime(mime) {
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "photo";
  if (mime === "application/pdf") return "file";
  if (mime.startsWith("text/")) return "file";
  return "file";
}

function guessKindFromUrl(url) {
  if (!url) return "link";
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.match(/\.(png|jpe?g|gif|webp|heic|heif)$/)) return "photo";
    if (p.match(/\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf)$/)) return "file";
    return "link";
  } catch {
    return "link";
  }
}

function getStorageRef(att) {
  if (!att) return { bucket: null, path: null };

  const storage = att.storage || {};
  const urls = att.urls || {};

  const bucket =
    att.bucket ||
    storage.bucket ||
    att.storageBucket ||
    att.storage_bucket ||
    null;

  const path =
    att.storagePath ||
    att.path ||
    storage.path ||
    att.storage_path ||
    null;

  const publicUrl =
    urls.public || att.public_url || att.publicUrl || att.url || null;

  return { bucket, path, publicUrl };
}

const LINK_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (LINK_PROTOCOL_RE.test(raw)) return raw;
  return `https://${raw}`;
}

export default function AddAttachmentModal({
  visible,
  onClose,
  onAdded,
  onUploaded,
  context = {},
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const { showBusy, hideBusy, showError, runMutation } = useOperationFeedback();

  const [step, setStep] = useState("pick"); // pick | details | link
  const [pendingAttachment, setPendingAttachment] = useState(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // whenever we open, reset to pick
  useEffect(() => {
    if (visible) {
      setStep("pick");
      setPendingAttachment(null);
      setTitle("");
      setNotes("");
      setLinkUrl("");
      setErr(null);
      setBusy(false);
    }
  }, [visible]);

  const isServiceRecordScope =
    context?.scope === "service_record" && !!context?.serviceRecordId;

  const canShowPreview = useMemo(() => {
    if (!pendingAttachment) return false;
    const kind = pendingAttachment.kind || guessKindFromMime(pendingAttachment.mimeType);
    if (kind === "photo") return true;
    const mime = pendingAttachment.mimeType || "";
    if (mime.startsWith("image/")) return true;
    return false;
  }, [pendingAttachment]);

  const previewUrl = useMemo(() => {
    if (!pendingAttachment) return null;

    const { publicUrl } = getStorageRef(pendingAttachment);
    if (publicUrl) return publicUrl;

    if (pendingAttachment.localUri) return pendingAttachment.localUri;
    if (pendingAttachment.uri) return pendingAttachment.uri;

    return null;
  }, [pendingAttachment]);

  const primeDetailsFromAttachment = (att) => {
    if (!att) return;
    const fileName = att.fileName || att.filename || att.name || "";
    const defaultTitle = cleanDefaultTitle(fileName);
    setTitle((prev) => prev || defaultTitle);
    setNotes((prev) => prev || "");
  };

  const doPhoto = async () => {
    let busyTimer = null;
    try {
      setBusy(true);
      setErr(null);

      // For service_record (timeline) uploads, call UPIP as if it were an asset
      // so we reuse the known-good upload path. The association back to the
      // service record is handled later in saveDetails using the original
      // context (scope: "service_record").
      const upipContext =
        context?.scope === "service_record"
          ? { ...context, scope: "asset" }
          : context;

      // Show "Uploading…" if it takes a beat (reduces hesitation)
      busyTimer = setTimeout(() => showBusy("Uploading…"), 450);

      const res = await UPIP.uploadPhoto({ context: upipContext });
      const att = res?.attachment;

      if (!att) throw new Error("Upload failed (no attachment returned)");

      setPendingAttachment(att);
      primeDetailsFromAttachment(att);
      setStep("details");
    } catch (e) {
      const msg = e?.message || "Upload failed";
      setErr(msg);
      showError(msg);
    } finally {
      if (busyTimer) clearTimeout(busyTimer);
      hideBusy();
      setBusy(false);
    }
  };

  const doFile = async () => {
    let busyTimer = null;
    try {
      setBusy(true);
      setErr(null);

      // For service_record (timeline) uploads, call UPIP as if it were an asset
      // so we reuse the known-good upload path. The association back to the
      // service record is handled later in saveDetails using the original
      // context (scope: "service_record").
      const upipContext =
        context?.scope === "service_record"
          ? { ...context, scope: "asset" }
          : context;

      // Show "Uploading…" if it takes a beat (reduces hesitation)
      busyTimer = setTimeout(() => showBusy("Uploading…"), 450);

      const res = await UPIP.uploadFile({ context: upipContext });
      const att = res?.attachment;

      if (!att) throw new Error("Upload failed (no attachment returned)");

      setPendingAttachment(att);
      primeDetailsFromAttachment(att);
      setStep("details");
    } catch (e) {
      const msg = e?.message || "Upload failed";
      setErr(msg);
      showError(msg);
    } finally {
      if (busyTimer) clearTimeout(busyTimer);
      hideBusy();
      setBusy(false);
    }
  };

  const goToLinkStep = () => {
    setStep("link");
    setLinkUrl("");
    setErr(null);
  };

  const saveDetails = async () => {
    const t = String(title || "").trim();
    const n = String(notes || "").trim();

    if (!t) {
      setErr("Title is required.");
      return;
    }  setBusy(true);
  setErr(null);

  const { ok } = await runMutation({
    busyMessage: "Saving…",
    success: "Proof added",
    error: "Couldn’t save proof",
    action: async () => {
      const base = pendingAttachment || {};
      const { bucket, path, publicUrl } = getStorageRef(base);

      const kind =
        base.kind ||
        base.type ||
        guessKindFromMime(base.mimeType || base.contentType);

      const metaPayload = {
        title: t,
        notes: n,
      };

      // Service-record specific association
      if (isServiceRecordScope) {
        const serviceRecordId = context.serviceRecordId;
        const assetId = context.assetId || null;

        if (!serviceRecordId) {
          throw new Error("Missing service record id in context.");
        }

        const isPhoto = kind === "photo";

        if (publicUrl && path) {
          if (isPhoto) {
            const { error } = await supabase.from("service_record_photos").insert({
              service_record_id: serviceRecordId,
              asset_id: assetId,
              bucket: bucket,
              storage_path: path,
              public_url: publicUrl,
              title: t,
              notes: n,
            });

            if (error) throw error;
          } else {
            const { error } = await supabase.from("service_record_documents").insert({
              service_record_id: serviceRecordId,
              asset_id: assetId,
              bucket: bucket,
              storage_path: path,
              public_url: publicUrl,
              title: t,
              notes: n,
              mime_type: base.mimeType || null,
            });

            if (error) throw error;
          }
        } else {
          // We uploaded something but don't have a URL/path. Treat as failure.
          throw new Error("Upload missing storage reference.");
        }
      } else {
        // Non-service-record flow: let UPIP handle meta if it supports it
        if (UPIP.saveAttachmentMeta) {
          await UPIP.saveAttachmentMeta({
            context,
            attachment: base,
            meta: metaPayload,
          });
        }
      }

      return { ok: true };
    },
    mapError: (e) => e?.message || "Couldn’t save proof",
  });

  setBusy(false);

  if (!ok) return;

  if (typeof onUploaded === "function") {
    onUploaded(pendingAttachment, { title: t, notes: n });
  }

  if (typeof onAdded === "function") {
    onAdded();
  }

  setPendingAttachment(null);
  setTitle("");
  setNotes("");
  setLinkUrl("");
  setStep("pick");
  onClose?.();
};

  const saveLink = async () => {
    const raw = String(linkUrl || "").trim();
    if (!raw) {
      setErr("Link URL is required.");
      return;
    }

    const normalized = normalizeUrl(raw);  setBusy(true);
  setErr(null);

  const { ok } = await runMutation({
    busyMessage: "Saving…",
    success: "Link added",
    error: "Couldn’t save link",
    action: async () => {
      const t =
        String(title || "").trim() ||
        cleanDefaultTitle(normalized.replace(/^https?:\/\//, ""));

      if (isServiceRecordScope) {
        const serviceRecordId = context.serviceRecordId;
        const assetId = context.assetId || null;

        if (!serviceRecordId) {
          throw new Error("Missing service record id in context.");
        }

        const { error } = await supabase.from("service_record_documents").insert({
          service_record_id: serviceRecordId,
          asset_id: assetId,
          title: t,
          notes: notes || "",
          public_url: normalized,
          bucket: null,
          storage_path: null,
          mime_type: "text/url",
          kind: "link",
        });

        if (error) throw error;
      } else {
        if (UPIP.saveLink) {
          await UPIP.saveLink({
            context,
            url: normalized,
            title: t,
            notes: notes || "",
          });
        }
      }

      return { ok: true };
    },
    mapError: (e) => e?.message || "Couldn’t save link",
  });

  setBusy(false);
  if (!ok) return;

  if (typeof onAdded === "function") {
    onAdded();
  }

  setTitle("");
  setNotes("");
  setLinkUrl("");
  setStep("pick");
  onClose?.();
};

  const closeInternal = () => {
    if (busy) return;
    setPendingAttachment(null);
    setTitle("");
    setNotes("");
    setLinkUrl("");
    setStep("pick");
    setErr(null);
    onClose?.();
  };

  const openPreviewExternally = () => {
    const url = previewUrl;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      // ignore
    });
  };

  const renderPickStep = () => (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <Text style={styles.title}>Add attachment</Text>
      <Text style={styles.subtitle}>
        Attach proof so this record is trusted and transferable.
      </Text>

      <View style={styles.rowStack}>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={doPhoto}
          disabled={busy}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="image-outline" size={22} color={colors.textPrimary} />
          </View>
          <View style={styles.actionTextWrap}>
            <Text style={styles.actionTitle}>Upload photo</Text>
            <Text style={styles.actionBody}>
              Add photos of work, receipts, or the moment itself.
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionRow}
          onPress={doFile}
          disabled={busy}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="document-text-outline" size={22} color={colors.textPrimary} />
          </View>
          <View style={styles.actionTextWrap}>
            <Text style={styles.actionTitle}>Upload file</Text>
            <Text style={styles.actionBody}>
              Attach PDFs, invoices, or manuals as proof.
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionRow}
          onPress={goToLinkStep}
          disabled={busy}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="link-outline" size={22} color={colors.textPrimary} />
          </View>
          <View style={styles.actionTextWrap}>
            <Text style={styles.actionTitle}>Add link</Text>
            <Text style={styles.actionBody}>
              Point to OEM docs, YouTube walk-throughs, or cloud folders.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={closeInternal}
          disabled={busy}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderDetailsStep = () => (
    <View style={styles.sheetTall}>
      <View style={styles.handle} />
      <Text style={styles.title}>Describe this attachment</Text>
      <Text style={styles.subtitle}>
        Give future you (or the next owner) enough context to trust it.
      </Text>

      <View style={styles.detailsGrid}>
        <View style={styles.previewCol}>
          <View style={styles.previewBox}>
            {canShowPreview && previewUrl ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={openPreviewExternally}
              >
                <Image source={{ uri: previewUrl }} style={styles.previewImage} />
              </TouchableOpacity>
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons
                  name={
                    (pendingAttachment?.kind || "file") === "photo"
                      ? "image-outline"
                      : "document-text-outline"
                  }
                  size={32}
                  color={colors.textSecondary}
                />
                <Text style={styles.previewLabel}>
                  {pendingAttachment?.fileName ||
                    pendingAttachment?.filename ||
                    "Attachment"}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.formCol}>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Short label (e.g., Spring service)"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="sentences"
          />

          <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
            Notes (optional)
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="What happened, who did the work, or anything the next owner should know."
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="sentences"
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={closeInternal}
          disabled={busy}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={saveDetails}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.btnPrimaryText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderLinkStep = () => (
    <View style={styles.sheetTall}>
      <View style={styles.handle} />
      <Text style={styles.title}>Add a link</Text>
      <Text style={styles.subtitle}>
        Point to OEM docs, service portals, or how-to videos that live elsewhere.
      </Text>

      <View style={styles.formCol}>
        <Text style={styles.fieldLabel}>URL</Text>
        <TextInput
          style={styles.input}
          value={linkUrl}
          onChangeText={setLinkUrl}
          placeholder="https://example.com/..."
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          keyboardType={IS_WEB ? "default" : "url"}
          autoCorrect={false}
        />

        <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
          Title
        </Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="OEM manual, how-to video, etc."
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="sentences"
        />

        <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
          Notes (optional)
        </Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Why is this link important?"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="sentences"
          multiline
          numberOfLines={3}
        />
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={closeInternal}
          disabled={busy}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={saveLink}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.btnPrimaryText}>Save link</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={closeInternal}
    >
      <View style={[styles.backdrop, IS_WEB && styles.backdropWeb]}>
        <TouchableOpacity
          style={styles.backdropTap}
          activeOpacity={1}
          onPress={closeInternal}
          disabled={busy}
        />
        <View style={[styles.sheetContainer, IS_WEB && styles.sheetContainerWeb]}>
          {step === "pick"
            ? renderPickStep()
            : step === "link"
            ? renderLinkStep()
            : renderDetailsStep()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.65)",
  },
  backdropWeb: {
    justifyContent: "center",
    alignItems: "center",
  },

  backdropTap: {
    flex: 1,
  },
  sheetContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: IS_WEB ? spacing.lg : spacing.xl,
  },
  sheetContainerWeb: {
    width: "100%",
    maxWidth: 720,
  },

  sheet: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  sheetTall: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: spacing.sm,
    backgroundColor: "rgba(148,163,184,0.7)",
  },
  title: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },

  rowStack: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: "rgba(15,23,42,0.9)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  actionBody: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  detailsGrid: {
    flexDirection: IS_WEB ? "row" : "column",
    marginTop: spacing.md,
    gap: spacing.md,
  },
  previewCol: {
    flex: IS_WEB ? 0.9 : 0,
  },
  formCol: {
    flex: 1,
  },
  previewBox: {
    borderRadius: radius.lg,
    backgroundColor: "rgba(15,23,42,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.4)",
    overflow: "hidden",
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 220,
    resizeMode: "contain",
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  previewLabel: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.textSecondary,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.6)",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: "rgba(15,23,42,0.95)",
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },

  footerRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  btnGhost: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.7)",
  },
  btnGhostText: { fontWeight: "900", color: colors.textPrimary },

  btnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { fontWeight: "900", color: colors.white },

  err: { marginTop: spacing.sm, color: colors.danger, fontWeight: "700" },
});
