import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { getSignedUrl } from "../lib/attachmentsApi";
import { supabase } from "../lib/supabaseClient";
import { navigationRef } from "../navigationRoot";
import { colors, radius, spacing } from "../styles/theme";

const IS_WEB = Platform.OS === "web";
const PREVIEW_BUCKET_FALLBACK = "asset-files";

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function normalizeUrl(raw) {
  const s = safeStr(raw).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function getExt(name = "") {
  const base = (name || "").split("?")[0].split("#")[0];
  const parts = base.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() || "").toLowerCase();
}

function isImageLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  if (mime.startsWith("image/")) return true;
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
  return IMAGE_EXTS.includes(ext);
}

function isPdfLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  return mime === "application/pdf" || ext === "pdf";
}

function inferName(att) {
  return (
    safeStr(att?.title) ||
    safeStr(att?.file_name) ||
    safeStr(att?.name) ||
    safeStr(att?.url) ||
    "Attachment"
  );
}

function shortId(id) {
  const s = safeStr(id);
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function normalizeTagsToString(tagsVal) {
  if (Array.isArray(tagsVal)) return tagsVal.join(", ");
  return safeStr(tagsVal);
}

function tagsStringToArray(tagsStr) {
  return safeStr(tagsStr)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * EnhanceAttachmentModal
 *
 * Props:
 * - isOpen
 * - input: { assetId, attachmentId, placementId, attachment, source, ... }
 * - config: { runEnrich, applyEnrichRun } optional
 * - onClose
 * - onSaved(updatedAttachmentLikePayload)
 */
export default function EnhanceAttachmentModal({
  isOpen,
  input,
  config,
  onClose,
  onSaved,
}) {
  const inputAttachment = input?.attachment || null;

  // Always use attachments.id as the source of truth
  const attachmentId = useMemo(() => {
    return (
      input?.attachmentId ||
      inputAttachment?.id ||
      inputAttachment?.attachment_id ||
      null
    );
  }, [input?.attachmentId, inputAttachment]);

  const [dbAttachment, setDbAttachment] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  // Associations come from attachment_placements
  const [placements, setPlacements] = useState([]);
  const [placementsLoading, setPlacementsLoading] = useState(false);
  const [placementsError, setPlacementsError] = useState("");

  const attachment = dbAttachment || inputAttachment || null;
  const name = useMemo(() => inferName(attachment), [attachment]);

  const [busy, setBusy] = useState(false);

  // Editable fields
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  // Enrich UX state (engine-configured)
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichRunId, setEnrichRunId] = useState(null); // optional (for Proof Builder)
  const [enrichCounts, setEnrichCounts] = useState(null);
  const [enrichResult, setEnrichResult] = useState(null); // ✅ NEW: payload we apply
  const [enrichError, setEnrichError] = useState("");

  // Preview state for web PDFs
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setBusy(false);
    setEnrichBusy(false);
    setEnrichRunId(null);
    setEnrichCounts(null);
    setEnrichResult(null);
    setEnrichError("");

    setDbError("");
    setDbLoading(false);
    setPlacementsError("");
    setPlacementsLoading(false);

    // Seed fields quickly from the input attachment
    setTitle(safeStr(inputAttachment?.title) || safeStr(inputAttachment?.file_name));
    setNotes(safeStr(inputAttachment?.notes));
    setTags(normalizeTagsToString(inputAttachment?.tags));

    // Then refresh from DB (authoritative)
    let cancelled = false;

    const run = async () => {
      if (!attachmentId) {
        setDbAttachment(null);
        setPlacements([]);
        return;
      }

      // Refresh attachment (fixes stale tags/title/notes)
      setDbLoading(true);
      try {
        const { data, error } = await supabase
          .from("attachments")
          .select("*")
          .eq("id", attachmentId)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) {
          setDbAttachment(data || null);
          if (data) {
            setTitle(
              safeStr(data.title) ||
                safeStr(data.file_name) ||
                safeStr(inputAttachment?.file_name)
            );
            setNotes(safeStr(data.notes));
            setTags(normalizeTagsToString(data.tags));
          }
        }
      } catch (e) {
        if (!cancelled) {
          setDbError(e?.message || "Failed to load attachment.");
          setDbAttachment(null);
        }
      } finally {
        if (!cancelled) setDbLoading(false);
      }

      // Load placements (Associations section)
      setPlacementsLoading(true);
      try {
        const { data, error } = await supabase
          .from("attachment_placements")
          .select("id,attachment_id,target_type,target_id,role,label,created_at")
          .eq("attachment_id", attachmentId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!cancelled) setPlacements(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          setPlacementsError(e?.message || "Failed to load associations.");
          setPlacements([]);
        }
      } finally {
        if (!cancelled) setPlacementsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, attachmentId, inputAttachment]);

  // Small image/thumb URL (public)
  const imagePreviewUrl = useMemo(() => {
    if (!attachment) return null;
    if (!isImageLike(attachment)) return null;

    if (attachment.storage_path) {
      try {
        const bucket = attachment.bucket || PREVIEW_BUCKET_FALLBACK;
        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(attachment.storage_path);
        return data?.publicUrl || null;
      } catch {
        return null;
      }
    }

    if (attachment.kind === "link" && attachment.url) return attachment.url;
    return null;
  }, [attachment]);

  // Signed URL for inline PDF preview on web
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isOpen || !attachment || !isPdfLike(attachment) || !IS_WEB) {
        setPdfUrl(null);
        setPdfLoading(false);
        return;
      }
      if (!attachment.storage_path) {
        setPdfUrl(null);
        setPdfLoading(false);
        return;
      }

      setPdfLoading(true);
      try {
        const url = await getSignedUrl({
          bucket: attachment.bucket || PREVIEW_BUCKET_FALLBACK,
          path: attachment.storage_path,
          expiresIn: 60 * 30,
        });
        if (!cancelled) setPdfUrl(url || null);
      } catch (e) {
        if (!cancelled) {
          console.log("PDF preview failed", e?.message || e);
          setPdfUrl(null);
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, attachment]);

  const handleOpenAttachment = async () => {
    if (!attachment) return;

    try {
      if (attachment.kind === "link") {
        const raw = safeStr(attachment.url);
        if (!raw) return;
        const url = normalizeUrl(raw);
        const ok = await Linking.canOpenURL(url);
        if (!ok) throw new Error("Cannot open this URL on this device.");
        await Linking.openURL(url);
        return;
      }

      if (!attachment.storage_path) {
        Alert.alert("Open failed", "No file path available.");
        return;
      }

      const signed = await getSignedUrl({
        bucket: attachment.bucket || PREVIEW_BUCKET_FALLBACK,
        path: attachment.storage_path,
        expiresIn: 60 * 60,
      });

      if (!signed) {
        Alert.alert("Open failed", "Could not create a signed URL.");
        return;
      }

      const ok = await Linking.canOpenURL(signed);
      if (!ok) throw new Error("Cannot open this file on this device.");
      await Linking.openURL(signed);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open attachment.");
    }
  };

  const placementSummary = () => {
    if (placementsLoading) return "Loading…";
    if (placementsError) return "Unable to load";
    if (!placements || placements.length === 0) return "Asset (default)";

    if (placements.length === 1) {
      const p = placements[0];
      const t = safeStr(p.target_type);
      const id = safeStr(p.target_id);
      if (!t || t === "asset") return "Asset (default)";
      if (t === "system") return `System • ${shortId(id)}`;
      if (t === "service_record") return `Record • ${shortId(id)}`;
      if (t === "event") return `Event • ${shortId(id)}`;
      return `${t} • ${shortId(id)}`;
    }

    return `Multiple (${placements.length})`;
  };

  const roleSummary = () => {
    if (placementsLoading) return "Loading…";
    if (placementsError) return "Unable to load";
    if (!placements || placements.length === 0) return "other";

    const roles = Array.from(
      new Set(
        placements
          .map((p) => safeStr(p.role || "other").trim() || "other")
          .filter(Boolean)
      )
    );

    if (roles.length <= 1) return roles[0] || "other";
    return "multiple";
  };

  const canEnrich = !!config?.runEnrich && !!input?.assetId && !!attachmentId;

  // ✅ Apply should be unlocked by having a payload to apply
  const canApplyEnrich = !!config?.applyEnrichRun && !!enrichResult;

  const runEnrich = async () => {
    if (!canEnrich) {
      Alert.alert(
        "Keepr Intelligence not configured",
        "Wire runEnrich/applyEnrichRun in EnhanceProvider.configure()."
      );
      return;
    }

    setEnrichBusy(true);
    setEnrichError("");
    setEnrichCounts(null);
    setEnrichRunId(null);
    setEnrichResult(null);

    try {
      // ✅ IMPORTANT: Use current edits (Title/Notes/Tags) even if Save wasn't clicked yet.
      const liveAttachment = {
        ...(attachment || {}),
        title: safeStr(title).trim() || (attachment?.title ?? null),
        notes: safeStr(notes).trim() || (attachment?.notes ?? null),
        tags: tagsStringToArray(tags),
      };

      const res = await config.runEnrich({
        assetId: input.assetId,
        attachmentId,
        attachment: liveAttachment,
      });

      setEnrichResult(res || null);

      const runId = res?.run_id || res?.runId || null;
      setEnrichRunId(runId);

      // Normalize what we show in UI
      setEnrichCounts({
        detected: res?.detected ?? "—",
        proposed_actions: res?.proposed_actions ?? 1,
        summary: res?.summary ?? "",
      });
    } catch (e) {
      console.log("runEnrich failed", e?.message || e);
      setEnrichError(e?.message || "Make actionable failed.");
    } finally {
      setEnrichBusy(false);
    }
  };

  const applyEnrich = async () => {
    if (!canApplyEnrich) return;

    setEnrichBusy(true);
    setEnrichError("");

    try {
      await config.applyEnrichRun({
        assetId: input.assetId,
        attachmentId,
        enrichResult,
      });

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId: input?.assetId || null,
          attachmentId: attachmentId || null,
        });
        DeviceEventEmitter.emit("keepr:systems:updated", {
          assetId: input?.assetId || null,
        });
      } catch {}

      Alert.alert(
        "Applied",
        "Saved as Keepr Intelligence (coverage + compliance + system notes)."
      );
    } catch (e) {
      console.log("applyEnrich failed", e?.message || e);
      setEnrichError(e?.message || "Apply failed.");
    } finally {
      setEnrichBusy(false);
    }
  };

  // Proof Builder navigation (optional)
  const handleOpenProofBuilder = () => {
    if (!input?.assetId || !attachmentId) {
      Alert.alert("Refine Proof", "Proof Builder needs an asset and attachment.");
      return;
    }

    if (onClose) onClose();

    const params = {
      assetId: input.assetId,
      attachmentId,
      runId: enrichRunId || null,
      counts: enrichCounts || null,
    };

    try {
      if (navigationRef.isReady?.() && navigationRef.isReady()) {
        navigationRef.navigate("ProofBuilder", params);
      } else {
        console.log("[ProofBuilder] navigationRef not ready", params);
      }
    } catch (e) {
      console.log("[ProofBuilder] navigate failed", e?.message || e);
    }
  };

  const saveReal = async () => {
    if (!attachment) return;

    setBusy(true);
    try {
      const finalAttachmentId = attachmentId;
      if (!finalAttachmentId) throw new Error("Missing attachment id.");

      const tagsArr = tagsStringToArray(tags);

      const patch = {
        title: safeStr(title).trim() || null,
        notes: safeStr(notes).trim() || null,
        tags: tagsArr,
      };

      if (attachment.kind === "link" && attachment.url) {
        patch.url = normalizeUrl(attachment.url);
      }

      const { error } = await supabase
        .from("attachments")
        .update(patch)
        .eq("id", finalAttachmentId);
      if (error) throw error;

      try {
        DeviceEventEmitter.emit("keepr:attachment:updated", {
          assetId: input?.assetId || null,
          attachmentId: finalAttachmentId,
        });
      } catch {}

      const normalized = {
        ...attachment,
        id: finalAttachmentId,
        attachment_id: finalAttachmentId,
        asset_id: input?.assetId || attachment?.asset_id || null,
        title: patch.title ?? attachment?.title ?? null,
        notes: patch.notes ?? attachment?.notes ?? null,
        tags: patch.tags ?? attachment?.tags ?? [],
        enhanced_at: new Date().toISOString(),
        source: input?.source || null,
      };

      onSaved?.(normalized);
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    } finally {
      setBusy(false);
    }
  };

  const handleAssocPress = () => {
    Alert.alert(
      "Associations",
      "Today, change associations from the Attachments sidebar. This picker will become your one place to link attachments to systems and records."
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      visible={!!isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons
                name="sparkles"
                size={18}
                color={colors.brand || colors.primary}
              />
            </View>

            <Text style={styles.headerTitle} numberOfLines={1}>
              Enhance Attachment
            </Text>

            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* Meta */}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Asset</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {safeStr(input?.assetId) || "—"}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Attachment</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {safeStr(attachmentId) || "—"}
              </Text>
            </View>
            {!!input?.source?.type && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Source</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {safeStr(input?.source?.type)}
                  {input?.source?.id ? ` • ${input.source.id}` : ""}
                </Text>
              </View>
            )}

            {!!dbError && <Text style={styles.assocHint}>{dbError}</Text>}
            {dbLoading && (
              <Text style={styles.assocHint}>Refreshing attachment…</Text>
            )}

            {/* Visual preview */}
            {attachment && (
              <View style={styles.previewSection}>
                {attachment.kind === "link" ? (
                  <View style={styles.previewRow}>
                    <View style={styles.previewIcon}>
                      <Ionicons
                        name="link-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {safeStr(attachment.title) || safeStr(attachment.url)}
                      </Text>
                      <Text style={styles.previewSub} numberOfLines={1}>
                        {safeStr(attachment.url)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={handleOpenAttachment}
                      style={styles.previewOpenBtn}
                    >
                      <Ionicons
                        name="open-outline"
                        size={16}
                        color={colors.textPrimary}
                      />
                    </TouchableOpacity>
                  </View>
                ) : isImageLike(attachment) && imagePreviewUrl ? (
                  <TouchableOpacity
                    onPress={handleOpenAttachment}
                    activeOpacity={0.9}
                    style={styles.previewImageOuter}
                  >
                    <Image
                      source={{ uri: imagePreviewUrl }}
                      style={styles.previewImage}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ) : isPdfLike(attachment) && IS_WEB ? (
                  <View>
                    <View style={styles.previewRow}>
                      <View style={styles.previewIcon}>
                        <Ionicons
                          name="document-text-outline"
                          size={18}
                          color={colors.textPrimary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewTitle} numberOfLines={1}>
                          {safeStr(attachment.file_name) || name}
                        </Text>
                        <Text style={styles.previewSub} numberOfLines={1}>
                          PDF document
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={handleOpenAttachment}
                        style={styles.previewOpenBtn}
                      >
                        <Ionicons
                          name="open-outline"
                          size={16}
                          color={colors.textPrimary}
                        />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.pdfFrameWrapper}>
                      {pdfLoading ? (
                        <View style={styles.pdfLoading}>
                          <ActivityIndicator />
                        </View>
                      ) : pdfUrl ? (
                        <iframe
                          title="Attachment preview"
                          src={pdfUrl}
                          style={styles.pdfFrame}
                        />
                      ) : (
                        <Text style={styles.previewSub}>
                          Preview not available. Use “Open” to view the file.
                        </Text>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.previewRow}>
                    <View style={styles.previewIcon}>
                      <Ionicons
                        name="document-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {safeStr(attachment.file_name) || name}
                      </Text>
                      <Text style={styles.previewSub} numberOfLines={1}>
                        File attachment
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={handleOpenAttachment}
                      style={styles.previewOpenBtn}
                    >
                      <Ionicons
                        name="open-outline"
                        size={16}
                        color={colors.textPrimary}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Details</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={name}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                editable={!busy && !enrichBusy}
              />

              <Text style={styles.label}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="What should Keepr remember about this?"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textarea]}
                multiline
                textAlignVertical="top"
                editable={!busy && !enrichBusy}
              />

              <Text style={styles.label}>Tags (comma separated)</Text>
              <TextInput
                value={tags}
                onChangeText={setTags}
                placeholder="manual, warranty, receipt"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                editable={!busy && !enrichBusy}
              />
            </View>

            {/* Associations */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Associations</Text>

              {!!placementsError && (
                <Text style={styles.assocHint}>{placementsError}</Text>
              )}

              <Text style={styles.label}>Where is this attached?</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                activeOpacity={0.8}
                onPress={handleAssocPress}
              >
                <Text style={styles.pickerText} numberOfLines={1}>
                  {placementSummary()}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {placementsLoading ? (
                <Text style={styles.assocHint}>Loading associations…</Text>
              ) : placements && placements.length ? (
                <View style={{ marginTop: spacing.sm }}>
                  {placements.slice(0, 6).map((p) => {
                    const t = safeStr(p.target_type) || "asset";
                    const id = safeStr(p.target_id);
                    const role = safeStr(p.role) || "other";
                    const label = safeStr(p.label);
                    return (
                      <Text key={p.id} style={styles.assocHint} numberOfLines={1}>
                        {t}
                        {id ? ` • ${shortId(id)}` : ""}
                        {role ? ` • ${role}` : ""}
                        {label ? ` • ${label}` : ""}
                      </Text>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.assocHint}>
                  No attachment_placements found (asset default).
                </Text>
              )}

              <Text style={styles.label}>Role</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                activeOpacity={0.8}
                onPress={handleAssocPress}
              >
                <Text style={styles.pickerText} numberOfLines={1}>
                  {roleSummary()}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              <Text style={styles.assocHint}>
                Today, change associations from the Attachments sidebar. This
                picker will become your one place to link attachments to systems
                and records.
              </Text>
            </View>

            {/* Keepr Intelligence */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Keepr Intelligence</Text>
                <View style={{ flexDirection: "row" }}>
                  <TouchableOpacity
                    style={[
                      styles.enhanceBtn,
                      !canEnrich && { opacity: 0.55 },
                    ]}
                    onPress={runEnrich}
                    disabled={busy || enrichBusy || !canEnrich}
                  >
                    {enrichBusy ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="sparkles-outline"
                          size={16}
                          color={colors.textPrimary}
                        />
                        <Text style={styles.enhanceBtnText}>Make Actionable</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.enhanceBtn,
                      { marginLeft: 8 },
                      (!input?.assetId || !attachmentId) && { opacity: 0.55 },
                    ]}
                    onPress={handleOpenProofBuilder}
                    disabled={!input?.assetId || !attachmentId}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.enhanceBtnText}>Refine Proof</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {!!enrichError && <Text style={styles.assocHint}>{enrichError}</Text>}

              {enrichCounts ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.aiText}>
                    Detected: {enrichCounts.detected ?? "—"}
                  </Text>
                  <Text style={styles.aiText}>
                    Proposed actions: {enrichCounts.proposed_actions ?? "—"}
                  </Text>
                  {!!enrichCounts.summary && (
                    <Text style={[styles.assocHint, { marginTop: 6 }]}>
                      {enrichCounts.summary}
                    </Text>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.applyBtn,
                      !canApplyEnrich && { opacity: 0.55 },
                    ]}
                    onPress={applyEnrich}
                    disabled={busy || enrichBusy || !canApplyEnrich}
                  >
                    {enrichBusy ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={16}
                          color={colors.textPrimary}
                        />
                        <Text style={styles.applyBtnText}>Apply</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.assocHint}>
                  Make actionable turns this document into Keepr Intelligence
                  (coverage + compliance + system notes).
                </Text>
              )}

            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.footerBtn, styles.footerBtnGhost]}
              disabled={busy || enrichBusy}
            >
              <Text style={styles.footerBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={saveReal}
              style={[styles.footerBtn, styles.footerBtnPrimary]}
              disabled={busy || enrichBusy}
            >
              {busy ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="save-outline"
                    size={16}
                    color={colors.textPrimary}
                  />
                  <Text style={[styles.footerBtnText, { marginLeft: 8 }]}>
                    Save
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.xl || 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#11182722",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: "#11182722",
  },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    marginLeft: 8,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#F3F4F680",
  },
  body: { padding: spacing.lg },

  metaRow: { flexDirection: "row", marginBottom: 6 },
  metaLabel: { width: 90, color: colors.textMuted, fontSize: 12 },
  metaValue: { flex: 1, color: colors.textPrimary, fontSize: 12 },

  previewSection: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg || 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  previewRow: { flexDirection: "row", alignItems: "center" },
  previewIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle || colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  previewTitle: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  previewSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  previewOpenBtn: {
    marginLeft: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle || colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  previewImageOuter: {
    borderRadius: radius.lg || 14,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle || colors.background,
  },
  previewImage: { width: "100%", height: 200 },

  pdfFrameWrapper: {
    marginTop: spacing.sm,
    borderRadius: radius.md || 12,
    overflow: "hidden",
    backgroundColor: colors.background,
    minHeight: 160,
  },
  pdfFrame: { width: "100%", height: 220, borderWidth: 0 },
  pdfLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },

  section: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "#11182722",
    borderRadius: radius.lg || 14,
    backgroundColor: colors.background,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  textarea: { minHeight: 92, paddingTop: spacing.md, textAlignVertical: "top" },

  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  pickerText: {
    flex: 1,
    marginRight: 8,
    fontSize: 13,
    color: colors.textPrimary,
  },
  assocHint: { marginTop: spacing.sm, fontSize: 11, color: colors.textMuted },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  enhanceBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  enhanceBtnText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },

  applyBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
    alignSelf: "flex-start",
  },
  applyBtnText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 6,
  },

  aiText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderColor: "#11182722",
  },
  footerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
    minWidth: 120,
    marginLeft: 12,
  },
  footerBtnGhost: { backgroundColor: "transparent" },
  footerBtnPrimary: { backgroundColor: colors.surface },
  footerBtnText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
});
