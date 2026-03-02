// modals/AddEventModal.js
import React, { useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { uploadLocalImageToSupabase } from "../lib/imageUpload";
import { useAuth } from "../context/AuthContext";

const PHOTO_BUCKET = "asset-files";

export default function AddEventModal({ visible, onClose, context }) {
  const { user } = useAuth();

  const assetId = context?.assetId || null;
  const systemId = context?.systemId || null;

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving] = useState(false);

  const hasPendingPhoto = attachments.some(
    (a) => a.kind === "image" && a.pendingUpload
  );

  const canSave = useMemo(() => title.trim().length > 0, [title]);

  const reset = () => {
    setTitle("");
    setNotes("");
    setAmount("");
    setAttachments([]);
  };

  const requestPhotoPerms = async () => {
    if (Platform.OS === "web") return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your photos to attach images."
      );
      return false;
    }
    return true;
  };

  const addPhoto = async () => {
    const ok = await requestPhotoPerms();
    if (!ok) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType?.Images || "images",
        quality: 0.9,
      });

      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;

      const temp = {
        kind: "image",
        localUri: picked.uri,
        previewUri: picked.uri,
        fileName: "Photo",
        mimeType: picked.mimeType || "image/jpeg",
        pendingUpload: true,
      };

      setAttachments((prev) => [temp, ...prev]);

      const upload = await uploadLocalImageToSupabase({
        bucket: PHOTO_BUCKET,
        assetId: assetId || systemId || "event",
        localUri: picked.uri,
        webFile: Platform.OS === "web" ? picked.file ?? null : null,
        contentType: picked.mimeType || "image/jpeg",
      });

      if (!upload?.storagePath || !upload?.publicUrl) {
        throw new Error("Upload did not return a public URL.");
      }

      setAttachments((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (a) =>
            a.kind === "image" &&
            a.pendingUpload &&
            a.localUri === picked.uri
        );
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            pendingUpload: false,
            storagePath: upload.storagePath,
            publicUrl: upload.publicUrl,
          };
        }
        return next;
      });
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Image upload failed",
        e?.message || "Could not upload the photo."
      );
      setAttachments((prev) =>
        prev.filter(
          (a) => !(a.kind === "image" && a.pendingUpload)
        )
      );
    }
  };

  const addFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (res.canceled) return;
      const file = res.assets?.[0];
      if (!file?.uri) return;

      const staged = {
        kind: "file",
        localUri: file.uri,
        fileName: file.name || "File",
        mimeType: file.mimeType || "application/octet-stream",
        previewUri: null,
        pendingUpload: true,
      };

      setAttachments((prev) => [staged, ...prev]);
    } catch (e) {
      console.error(e);
      Alert.alert("File failed", e?.message || "Could not add file.");
    }
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const parseAmountToCents = (str) => {
    if (!str) return null;
    const cleaned = str.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const val = Number.parseFloat(cleaned);
    if (Number.isNaN(val)) return null;
    return Math.round(val * 100);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert(
        "Add a title",
        "Give this event a quick title so future-you knows what it is."
      );
      return;
    }

    if (hasPendingPhoto) {
      Alert.alert(
        "One sec",
        "A photo is still uploading. Try again in a moment."
      );
      return;
    }

    setSaving(true);
    try {
      if (!user?.id) throw new Error("No user session.");

      const amountCents = parseAmountToCents(amount);

      const payload = {
        owner_id: user.id,
        title: title.trim(),
        notes: notes.trim() || null,
        amount_cents: amountCents,
        status: "draft",
        extra_metadata: {
          routeName: context?.routeName || null,
          assetId,
          assetName: context?.assetName || null,
          systemId,
          systemName: context?.systemName || null,
          attachments: attachments.map((a) => ({
            kind: a.kind,
            fileName: a.fileName,
            mimeType: a.mimeType || null,
            localUri: a.localUri || null,
            storagePath: a.storagePath || null,
            publicUrl: a.publicUrl || null,
            pendingUpload: !!a.pendingUpload,
          })),
        },
      };

      const { error } = await supabase.from("event_inbox").insert(payload);
      if (error) throw error;

      reset();
      onClose?.();
    } catch (e) {
      console.error(e);
      Alert.alert("Couldn’t save", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onCloseSafe = () => {
    if (!saving) {
      reset();
      onClose?.();
    }
  };

  return (
    <Modal
      visible={!!visible}
      animationType="fade"
      transparent
      onRequestClose={onCloseSafe}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
            style={{ width: "100%", alignItems: "center" }}
          >
            <View style={styles.sheet}>
              {/* HEADER */}
              <View style={styles.header}>
                <TouchableOpacity
                  onPress={onCloseSafe}
                  style={styles.headerBtn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>

                <Text style={styles.titleText}>Add event</Text>

                <TouchableOpacity
                  onPress={handleSave}
                  style={[
                    styles.saveBtn,
                    (!canSave || saving) && styles.saveBtnDisabled,
                  ]}
                  activeOpacity={0.85}
                  disabled={!canSave || saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* BODY */}
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.contextPill}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={colors.textMuted}
                  />
                  <Text style={styles.contextText} numberOfLines={2}>
                    {assetId || systemId
                      ? `Linked to ${systemId ? "system" : "asset"}: ${
                          context?.systemName ||
                          context?.assetName ||
                          "Untitled"
                        }`
                      : "You can link this event to a Keepr asset or system later from the Event Inbox."}
                  </Text>
                </View>

                <Text style={styles.label}>Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Change HVAC filter"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  returnKeyType="next"
                />

                <Text style={styles.label}>Notes</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Anything you want to remember…"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.inputMulti]}
                  multiline
                />

                <Text style={[styles.label, { marginTop: 10 }]}>
                  Cost (optional)
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="$0.00"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  keyboardType={
                    Platform.OS === "ios" ? "decimal-pad" : "numeric"
                  }
                  returnKeyType="done"
                />

                <Text style={[styles.label, { marginTop: 12 }]}>
                  Attachments
                </Text>
                <View style={styles.attachRow}>
                  <TouchableOpacity
                    style={styles.attachBtn}
                    activeOpacity={0.85}
                    onPress={addPhoto}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.attachText}>Add photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.attachBtn}
                    activeOpacity={0.85}
                    onPress={addFile}
                  >
                    <Ionicons
                      name="document-attach-outline"
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.attachText}>Add file</Text>
                  </TouchableOpacity>
                </View>

                {attachments.length > 0 && (
                  <View style={styles.attachList}>
                    {attachments.map((a, idx) => (
                      <View key={`${a.kind}-${idx}`} style={styles.attachItem}>
                        {a.previewUri ? (
                          <Image
                            source={{ uri: a.previewUri }}
                            style={styles.thumb}
                          />
                        ) : (
                          <View style={styles.thumbStub}>
                            <Ionicons
                              name={
                                a.kind === "file"
                                  ? "document-outline"
                                  : "image-outline"
                              }
                              size={18}
                              color={colors.textMuted}
                            />
                          </View>
                        )}

                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.attachName} numberOfLines={1}>
                            {a.fileName ||
                              (a.kind === "image" ? "Photo" : "File")}
                          </Text>
                          <Text style={styles.attachMeta} numberOfLines={1}>
                            {a.kind === "image" ? "Image" : "File"}
                            {a.mimeType ? ` • ${a.mimeType}` : ""}
                            {a.pendingUpload ? " • pending" : ""}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => removeAttachment(idx)}
                          style={styles.removeBtn}
                        >
                          <Ionicons
                            name="close"
                            size={18}
                            color={colors.textPrimary}
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <Text style={styles.note}>
                  This saves as a draft event. Later we’ll route drafts into
                  Notifications for “enrich / verify”.
                </Text>

                <View style={{ height: 24 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: Platform.OS === "web" ? "center" : "flex-end",
    alignItems: "center",
  },

  // Bottom sheet on native, centered dialog on web
  sheet: {
    width: "100%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
    maxHeight: "90%",
    overflow: "hidden",
    ...(shadows?.subtle || {}),
    ...Platform.select({
      web: {
        maxWidth: 640,
        borderRadius: radius.xl || 18,
        marginHorizontal: spacing.lg,
        alignSelf: "center",
      },
      default: {
        borderTopLeftRadius: radius.xl || 18,
        borderTopRightRadius: radius.xl || 18,
      },
    }),
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: colors.surface,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  titleText: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  saveBtn: {
    minWidth: 72,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: {
    backgroundColor: "#9CA3AF",
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },

  body: {
    maxHeight: 480,
  },
  bodyContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
  },

  contextPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#F7F8FA",
    borderWidth: 1,
    borderColor: "#11182711",
    marginBottom: 10,
  },
  contextText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  label: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    paddingHorizontal: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: "#F9FAFB",
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: "top",
  },

  attachRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#EFF6FF",
  },
  attachText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  attachList: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    paddingVertical: 4,
  },
  attachItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#f2f3f5",
  },
  thumbStub: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#f2f3f5",
    alignItems: "center",
    justifyContent: "center",
  },
  attachName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  attachMeta: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: 2,
  },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  note: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
