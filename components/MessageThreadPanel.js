import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import { colors, radius, spacing } from "../styles/theme";
import { formatMessageTime, getMessageSenderLabel } from "../lib/messagesService";
import { setCurrentNotificationContext } from "../lib/notificationsService";

function cleanSenderName(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "member") return null;
  return text;
}

function messageIsMine(message, { perspective, currentUserId }) {
  if (perspective === "keepr_pro") return message?.sender_type === "keepr_pro";
  return !!message?.from_user_id && String(message.from_user_id) === String(currentUserId);
}

function messageLabel(message, { mine, perspective, profilesById, ownerDisplayName, providerDisplayName }) {
  if (mine) return "You";
  if (message?.sender_type === "keepr_pro") {
    return cleanSenderName(message.sender_name) || providerDisplayName || "KeeprPro";
  }
  if (perspective === "keepr_pro") {
    return cleanSenderName(message?.sender_name) || ownerDisplayName || "Owner";
  }
  return getMessageSenderLabel(message, profilesById);
}

function isImageAttachment(attachment) {
  return String(attachment?.mime_type || attachment?.mimeType || "").startsWith("image/");
}

function attachmentUrl(attachment) {
  return attachment?.signed_url || attachment?.urls?.signed || attachment?.url || attachment?.urls?.public || null;
}

async function openAttachmentFallback(attachment) {
  const url = attachmentUrl(attachment);
  if (!url) return;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}

export default function MessageThreadPanel({
  messages = [],
  currentUserId = null,
  profilesById = {},
  perspective = "member",
  ownerDisplayName = null,
  providerDisplayName = null,
  replyValue = "",
  onReplyChange,
  onReply,
  onSend,
  replyPlaceholder = "Write a reply...",
  replyLabel = "Reply",
  replyDisabled = false,
  replying = false,
  footerActions = null,
  emptyText = "No messages yet.",
  onOpenAttachment,
  activeNotificationContext = null,
}) {
  const [pendingAttachments, setPendingAttachments] = useState([]);

  useEffect(() => {
    if (!activeNotificationContext?.thread_id && !activeNotificationContext?.action_id) return undefined;
    let cancelled = false;
    setCurrentNotificationContext(activeNotificationContext).catch(() => {});
    return () => {
      if (cancelled) return;
      cancelled = true;
      setCurrentNotificationContext({}).catch(() => {});
    };
  }, [
    activeNotificationContext?.thread_id,
    activeNotificationContext?.action_id,
    activeNotificationContext?.asset_id,
    activeNotificationContext?.stewardship_id,
  ]);

  const addPending = (asset, fallbackKind = "file") => {
    if (!asset?.uri) return;
    setPendingAttachments((prev) => [
      ...prev,
      {
        uri: asset.uri,
        fileName: asset.fileName || asset.name || asset.uri.split("/").pop() || "attachment",
        mimeType: asset.mimeType || asset.mime_type || null,
        fileSize: asset.fileSize || asset.size || null,
        kind:
          fallbackKind === "photo" || String(asset.mimeType || asset.mime_type || "").startsWith("image/")
            ? "photo"
            : "file",
      },
    ]);
  };

  const pickPhoto = async () => {
    if (Platform.OS === "web") {
      const result = await DocumentPicker.getDocumentAsync({
        type: "image/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!result.canceled) addPending(result.assets?.[0], "photo");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled) addPending(result.assets?.[0], "photo");
  };

  const capturePhoto = async () => {
    if (Platform.OS === "web") return pickPhoto();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled) addPending(result.assets?.[0], "photo");
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) addPending(result.assets?.[0], "file");
  };

  const removePending = (index) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const sender = onSend || (onReply ? ({ body }) => onReply(body) : null);
    if (!sender) return;
    await sender({ body: replyValue, attachments: pendingAttachments });
    setPendingAttachments([]);
  };

  return (
    <View style={styles.threadPanel}>
      {messages.length ? (
        messages.map((message) => {
          const mine = messageIsMine(message, { perspective, currentUserId });
          const label = messageLabel(message, {
            mine,
            perspective,
            profilesById,
            ownerDisplayName,
            providerDisplayName,
          });
          return (
            <View
              key={message.id}
              style={[styles.messageBubble, mine ? styles.messageMine : styles.messageOther]}
            >
              <Text style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                {label}
                {message.created_at ? ` · ${formatMessageTime(message.created_at)}` : ""}
              </Text>
              <Text style={[styles.messageBody, mine && styles.messageBodyMine]}>{message.body}</Text>
              {message.attachments?.length ? (
                <View style={styles.messageAttachments}>
                  {message.attachments.map((attachment) => {
                    const url = attachmentUrl(attachment);
                    const isImage = isImageAttachment(attachment);
                    return (
                      <TouchableOpacity
                        key={attachment.attachment_id || attachment.id}
                        style={[
                          styles.attachmentCard,
                          isImage && styles.attachmentImageCard,
                          mine && styles.attachmentCardMine,
                        ]}
                        activeOpacity={0.86}
                        onPress={() =>
                          onOpenAttachment ? onOpenAttachment(attachment) : openAttachmentFallback(attachment)
                        }
                      >
                        {isImage && url ? (
                          <Image source={{ uri: url }} style={styles.attachmentImage} resizeMode="cover" />
                        ) : (
                          <View style={styles.fileIcon}>
                            <Ionicons name="document-text-outline" size={20} color={colors.brandBlue} />
                          </View>
                        )}
                        <View style={styles.attachmentTextWrap}>
                          <Text style={[styles.attachmentTitle, mine && styles.attachmentTitleMine]} numberOfLines={1}>
                            {attachment.title || attachment.file_name || "Attachment"}
                          </Text>
                          <Text style={[styles.attachmentMeta, mine && styles.attachmentMetaMine]} numberOfLines={1}>
                            {attachment.mime_type || attachment.kind || "file"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={styles.emptyText}>{emptyText}</Text>
      )}

      {onReply || onSend ? (
        <View style={styles.replyDock}>
          {pendingAttachments.length ? (
            <View style={styles.pendingWrap}>
              {pendingAttachments.map((attachment, index) => (
                <View key={`${attachment.uri}-${index}`} style={styles.pendingCard}>
                  {attachment.kind === "photo" ? (
                    <Image source={{ uri: attachment.uri }} style={styles.pendingThumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.pendingFileIcon}>
                      <Ionicons name="document-attach-outline" size={18} color={colors.brandBlue} />
                    </View>
                  )}
                  <Text style={styles.pendingTitle} numberOfLines={1}>
                    {attachment.fileName || "Attachment"}
                  </Text>
                  <TouchableOpacity style={styles.pendingRemove} onPress={() => removePending(index)}>
                    <Ionicons name="close-outline" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          <TextInput
            value={replyValue}
            onChangeText={onReplyChange}
            placeholder={replyPlaceholder}
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            style={styles.replyBox}
          />
          <View style={styles.replyActions}>
            <TouchableOpacity style={styles.toolButton} onPress={pickPhoto} activeOpacity={0.86}>
              <Ionicons name="image-outline" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton} onPress={capturePhoto} activeOpacity={0.86}>
              <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton} onPress={pickFile} activeOpacity={0.86}>
              <Ionicons name="document-attach-outline" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.replyButton, replyDisabled && styles.disabled]}
              onPress={handleSend}
              disabled={replyDisabled || replying}
              activeOpacity={0.86}
            >
              {replying ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <Ionicons name="send-outline" size={16} color="#FFFFFF" />
              <Text style={styles.replyButtonText}>{replyLabel}</Text>
            </TouchableOpacity>
            {footerActions}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  threadPanel: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  messageBubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxWidth: "82%",
  },
  messageMine: {
    alignSelf: "flex-end",
    backgroundColor: colors.brandBlue || colors.primary,
  },
  messageOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.background || "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
  },
  messageMeta: {
    fontSize: 10,
    fontWeight: "900",
    color: colors.textMuted || colors.textSecondary,
    marginBottom: 4,
  },
  messageMetaMine: {
    color: "rgba(255,255,255,0.82)",
  },
  messageBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  messageBodyMine: {
    color: "#FFFFFF",
  },
  messageAttachments: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  attachmentCard: {
    minWidth: 220,
    maxWidth: 340,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    backgroundColor: "#FFFFFF",
    padding: spacing.xs,
  },
  attachmentImageCard: {
    width: 300,
    maxWidth: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    padding: 4,
  },
  attachmentCardMine: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.22)",
  },
  attachmentImage: {
    width: "100%",
    height: 180,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  attachmentTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  attachmentTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 12,
  },
  attachmentTitleMine: {
    color: "#FFFFFF",
  },
  attachmentMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 10,
  },
  attachmentMetaMine: {
    color: "rgba(255,255,255,0.72)",
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  replyDock: {
    marginTop: spacing.md,
  },
  pendingWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  pendingCard: {
    width: 170,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    backgroundColor: colors.surface || "#FFFFFF",
    padding: spacing.xs,
  },
  pendingThumb: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  pendingFileIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  pendingTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "800",
  },
  pendingRemove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background || "#F8FAFC",
  },
  replyBox: {
    minHeight: 82,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    backgroundColor: colors.background || "#FFFFFF",
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyActions: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  toolButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle || colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface || "#FFFFFF",
  },
  replyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  replyButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.6,
  },
});
