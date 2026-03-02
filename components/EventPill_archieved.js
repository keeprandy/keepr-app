// components/EventPill.js

import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

import { colors, spacing, radius, shadows, typography } from "../styles/theme";

/**
 * V1: one bucket. Organized by path.
 */
const EVENT_ATTACHMENTS_BUCKET = "asset-photos";

const todayISO = () => {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const safeNumberOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function uploadToSupabaseStorage({
  bucket,
  ownerId,
  eventId,
  uri,
  mimeType,
  filename,
}) {
  const safeName = (filename || `file-${Date.now()}`).replace(/[^\w.\-]/g, "_");
  const storage_path = `${ownerId}/event_inbox/${eventId}/${Date.now()}-${safeName}`;

  const res = await fetch(uri);
  const blob = await res.blob();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storage_path, blob, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storage_path);
  const public_url = publicData?.publicUrl || null;

  return { storage_path, public_url };
}

export default function EventPill({
  hidden = false,
  onCreated,

  // Optional contextual prefill (when invoked on a specific asset/system screen)
  contextAssetId = null,
  contextSystemId = null,
  contextTitle = "",
  contextNotes = "",
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState(contextTitle || "");
  const [notes, setNotes] = useState(contextNotes || "");
  const [amountCents, setAmountCents] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayISO());

  const [assetId, setAssetId] = useState(contextAssetId);
  const [systemId, setSystemId] = useState(contextSystemId);

  // [{ uri, mimeType, filename, kind }]
  const [pendingAttachments, setPendingAttachments] = useState([]);

  const bottom = useMemo(() => {
    return (Platform.OS === "web" ? spacing.lg : 72) + (insets.bottom || 0);
  }, [insets.bottom]);

  if (hidden) return null;

  const resetForm = () => {
    setTitle(contextTitle || "");
    setNotes(contextNotes || "");
    setAmountCents("");
    setOccurredAt(todayISO());
    setAssetId(contextAssetId);
    setSystemId(contextSystemId);
    setPendingAttachments([]);
  };

  const openModal = () => {
    resetForm();
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow photo access.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });

    if (result.canceled) return;

    const a = result.assets?.[0];
    if (!a?.uri) return;

    setPendingAttachments((prev) => [
      ...prev,
      {
        uri: a.uri,
        mimeType: a.mimeType || "image/jpeg",
        filename: a.fileName || `photo-${Date.now()}.jpg`,
        kind: "photo",
      },
    ]);
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;

    const f = result.assets?.[0];
    if (!f?.uri) return;

    setPendingAttachments((prev) => [
      ...prev,
      {
        uri: f.uri,
        mimeType: f.mimeType || "application/octet-stream",
        filename: f.name || `doc-${Date.now()}`,
        kind: "document",
      },
    ]);
  };

  const removeAttachmentAt = (idx) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const createEvent = async () => {
    if (!user?.id) {
      Alert.alert("Not signed in", "Please sign in and try again.");
      return;
    }
    if (!title.trim()) {
      Alert.alert("Missing description", "Add a short description for this event.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        owner_id: user.id,
        title: title.trim(),
        notes: notes?.trim() || null,
        amount_cents: amountCents ? safeNumberOrNull(amountCents) : null,
        occurred_at: occurredAt || null,
        asset_id: assetId || null,
        system_id: systemId || null,
        status: "draft",
      };

      const { data: inserted, error: insertError } = await supabase
        .from("event_inbox")
        .insert(payload)
        .select("*")
        .single();

      if (insertError) throw insertError;

      if (pendingAttachments.length > 0) {
        for (const a of pendingAttachments) {
          const { storage_path, public_url } = await uploadToSupabaseStorage({
            bucket: EVENT_ATTACHMENTS_BUCKET,
            ownerId: user.id,
            eventId: inserted.id,
            uri: a.uri,
            mimeType: a.mimeType,
            filename: a.filename,
          });

          const { error: attErr } = await supabase
            .from("event_inbox_attachments")
            .insert({
              event_id: inserted.id,
              storage_path,
              public_url,
              mime_type: a.mimeType || null,
              file_name: a.filename || null,
            });

          if (attErr) throw attErr;
        }
      }

      setOpen(false);
      onCreated?.(inserted);
    } catch (e) {
      console.log("Create event error:", e);
      Alert.alert("Couldn’t save event", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Pill always opens THIS modal (no override). */}
      <TouchableOpacity style={[styles.pill, { bottom }]} onPress={openModal} activeOpacity={0.9}>
        <Ionicons name="add" size={18} color={colors.brandWhite} />
        <Text style={styles.pillLabel}>Add event</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Top bar (Splitwise-ish) */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={closeModal} hitSlop={10} style={styles.topBarBtn}>
              <Ionicons name="close-outline" size={24} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={styles.topBarTitle}>Add event</Text>

            <TouchableOpacity
              onPress={createEvent}
              disabled={saving}
              hitSlop={10}
              style={[styles.topBarBtn, saving && { opacity: 0.6 }]}
            >
              {saving ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.input}
              placeholder="Tax bill, AC tune-up, new deck stain…"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.fieldLabel}>Amount (optional, cents)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 50000"
              value={amountCents}
              onChangeText={setAmountCents}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Any quick context…"
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            <Text style={styles.fieldLabel}>Occurred date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              placeholder={todayISO()}
              value={occurredAt}
              onChangeText={setOccurredAt}
            />

            {(assetId || systemId) ? (
              <View style={styles.contextCard}>
                <Text style={styles.contextTitle}>Context</Text>
                {assetId ? <Text style={styles.contextLine}>Asset: {assetId}</Text> : null}
                {systemId ? <Text style={styles.contextLine}>System: {systemId}</Text> : null}
                <Text style={styles.contextHint}>(Editable later in Event Inbox → Enrich)</Text>
              </View>
            ) : null}

            {/* Attachments */}
            <View style={styles.attachRow}>
              <TouchableOpacity style={styles.attachBtn} onPress={pickPhoto} activeOpacity={0.85}>
                <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.attachText}>Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachBtn} onPress={pickDocument} activeOpacity={0.85}>
                <Ionicons name="document-text-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.attachText}>Document</Text>
              </TouchableOpacity>
            </View>

            {pendingAttachments.length > 0 ? (
              <View style={styles.attachList}>
                {pendingAttachments.map((a, idx) => (
                  <View key={`${a.uri}-${idx}`} style={styles.attachItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachName} numberOfLines={1}>
                        {a.fileName || a.filename || (a.kind === "photo" ? "Photo" : "Document")}
                      </Text>
                      <Text style={styles.attachMeta}>
                        {a.kind} • {a.mimeType || "unknown"}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeAttachmentAt(idx)} hitSlop={10}>
                      <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Bottom save (redundant on purpose: good UX on long screens) */}
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.7 }]}
              disabled={saving}
              onPress={createEvent}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator color={colors.brandWhite} />
              ) : (
                <Text style={styles.saveBtnText}>Save to Inbox</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    right: spacing.lg,
    width: 124,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...(shadows?.subtle || {}),
    zIndex: 9999,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : null),
  },
  pillLabel: {
    color: colors.brandWhite,
    fontWeight: "800",
    fontSize: 13,
  },

  modalWrap: {
    flex: 1,
    backgroundColor: colors.background,
  },

  topBar: {
    paddingTop: Platform.OS === "ios" ? spacing.lg : spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background,
  },
  topBarBtn: {
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    ...typography.title,
    fontSize: 16,
  },
  saveText: {
    color: colors.brandBlue,
    fontWeight: "800",
    fontSize: 14,
  },

  form: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },

  contextCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  contextTitle: {
    fontWeight: "800",
    marginBottom: 6,
    color: colors.textPrimary,
  },
  contextLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  contextHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
  },

  attachRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  attachBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  attachText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  attachList: {
    marginTop: spacing.md,
  },
  attachItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  attachName: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  attachMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  saveBtn: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    paddingVertical: 14,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: colors.brandWhite,
    fontWeight: "900",
    fontSize: 13,
  },
});
