// screens/AddAssetChatScreen.js
// LEGACY - not part of V1 launch surface. Do not re-enable without review.
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { uploadLocalImageToSupabase } from "../lib/imageUpload";

const BOT = "bot";
const USER = "user";

const STEPS = [
  "type",
  "name",
  "year",
  "make",
  "model",
  "location",
  "confirm",
];

export default function AddAssetChatScreen({ navigation, route }) {
  const { user } = useAuth();

  // assetType comes from Home / Vehicle / Boat story screens
  const initialAssetType = route?.params?.assetType || "vehicle"; // "home" | "vehicle" | "boat"
  const [assetType] = useState(initialAssetType);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Collected fields
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [location, setLocation] = useState("");

  // Attachments staged during chat (photos only for now)
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const friendlyLabel =
    assetType === "home"
      ? "home"
      : assetType === "boat"
      ? "boat"
      : "vehicle";

  useEffect(() => {
    setMessages([
      {
        id: "intro",
        role: BOT,
        text: `Let’s add a ${friendlyLabel} to Keepr. I’ll ask a few quick questions.`,
      },
      {
        id: "q-type",
        role: BOT,
        text:
          friendlyLabel === "vehicle"
            ? "What kind of vehicle is this? (e.g., car, truck, motorcycle, golf cart)"
            : friendlyLabel === "home"
            ? "What kind of home is this? (e.g., primary home, lake house, condo)"
            : "What kind of boat is this? (e.g., tri-toon, bowrider, cruiser)",
      },
    ]);
  }, [friendlyLabel]);

  const appendMessage = (msg) => {
    setMessages((prev) => [
      ...prev,
      { id: String(prev.length) + Date.now(), ...msg },
    ]);
  };

  /* ---------------------- Attachment helpers (+ Photo) --------------------- */

  const handleAddPhoto = async () => {
    if (!user) {
      setError("You need to be signed in to attach photos.");
      return;
    }

    try {
      setError(null);
      setUploadingAttachment(true);

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Permission required to access your photo library.");
        setUploadingAttachment(false);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (result.canceled) {
        setUploadingAttachment(false);
        return;
      }

      const picked = result.assets?.[0];
      if (!picked?.uri) {
        setUploadingAttachment(false);
        return;
      }

      const ownerId = user.id;

      const uploadResult = await uploadLocalImageToSupabase({
        bucket: "asset-files",
        assetId: ownerId ? `${ownerId}/chat-intake` : "chat-intake",
        localUri: picked.uri,
        contentType: "image/jpeg",
      });

      if (!uploadResult || !uploadResult.publicUrl || !uploadResult.storagePath) {
        throw new Error("Upload returned no publicUrl");
      }

      setAttachments((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          kind: "image",
          localUri: picked.uri,
          publicUrl: uploadResult.publicUrl,
          storagePath: uploadResult.storagePath,
          fileName: uploadResult.fileName || "Photo",
        },
      ]);
    } catch (e) {
      console.error("Error uploading chat attachment", e);
      setError("Could not upload that photo. Try again or pick a different one.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = async (attachment) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));

    if (!attachment.storagePath) return;
    try {
      await supabase.storage
        .from("asset-files")
        .remove([attachment.storagePath]);
    } catch (e) {
      console.log("Failed to remove staged attachment", e);
    }
  };

  /* ----------------------------- Chat flow ----------------------------- */

  const handleUserInput = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    appendMessage({ role: USER, text: trimmed });
    setInput("");

    const currentStep = STEPS[stepIndex];

    try {
      setError(null);

      if (currentStep === "type") {
        // We already know assetType from caller; treat this as descriptive only.
        appendMessage({
          role: BOT,
          text:
            friendlyLabel === "home"
              ? "Great. What do you call this place? (e.g., “Home Sweet home”, “Lake house”)"
              : friendlyLabel === "boat"
              ? "Great. What do you call this boat? (e.g., “Formula 380”, “Bennington M Series”)"
              : "Got it. What do you call this vehicle? (e.g., “Porsche Boxster S”, “Family SUV”)",
        });
        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "name") {
        setName(trimmed);
        appendMessage({
          role: BOT,
          text:
            friendlyLabel === "home"
              ? "What year was it built? (If you’re not sure, just give your best guess.)"
              : "What year is it?",
        });
        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "year") {
        setYear(trimmed);

        if (friendlyLabel === "home") {
          appendMessage({
            role: BOT,
            text:
              "Who built it or what’s the neighborhood / subdivision? (You can keep this short.)",
          });
        } else {
          appendMessage({
            role: BOT,
            text: "Who makes it? (e.g., Porsche, Toyota, Yamaha, Bennington)",
          });
        }

        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "make") {
        setMake(trimmed);

        appendMessage({
          role: BOT,
          text:
            friendlyLabel === "home"
              ? "Any model or style you want to remember? (e.g., ranch, colonial, M Series)"
              : "What’s the model? (e.g., Boxster S, Highlander, Tracer 9 GT+)",
        });

        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "model") {
        setModel(trimmed);

        appendMessage({
          role: BOT,
          text:
            friendlyLabel === "home"
              ? "Where is it? (City, state or full address — whatever you’re comfortable sharing.)"
              : "Where does it live most of the time? (City, state, marina, or “home garage”)",
        });

        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "location") {
        setLocation(trimmed);

        const summary = [
          `Name: ${name || trimmed || "—"}`,
          `Year: ${year || "—"}`,
          `Make / builder: ${make || "—"}`,
          `Model / style: ${model || "—"}`,
          `Location: ${trimmed || "—"}`,
        ].join("\n");

        const attachLine =
          attachments.length > 0
            ? `\n\nYou’ve attached ${attachments.length} photo${
                attachments.length > 1 ? "s" : ""
              }.`
            : "";

        appendMessage({
          role: BOT,
          text:
            "Here’s what I have:\n\n" +
            summary +
            attachLine +
            "\n\nSend anything else you want me to remember (nickname, trim, notes), or just type “save”.",
        });

        setStepIndex((i) => i + 1);
        return;
      }

      if (currentStep === "confirm") {
        const wantsSaveOnly = trimmed.toLowerCase() === "save";
        const extraNotes = wantsSaveOnly ? null : trimmed;

        await saveAsset(extraNotes);
      }
    } catch (err) {
      console.error("Error in chat flow:", err);
      setError("Something went wrong while saving this asset.");
    }
  };

  const saveAsset = async (extraNotes) => {
    if (!user) {
      setError("You need to be signed in to save this asset.");
      return;
    }

    setSaving(true);

    const defaultName =
      friendlyLabel === "home"
        ? "New home"
        : friendlyLabel === "boat"
        ? "New boat"
        : "New vehicle";

    const normalizedName = name || defaultName;

    const payload = {
      owner_id: user.id,
      type: assetType, // "home" | "vehicle" | "boat"
      name: normalizedName,
      location: location || null,
      year: year ? Number(year) : null,
      make: make || null,
      model: model || null,
      notes: extraNotes || null,
    };

    const { data, error: insertErr } = await supabase
      .from("assets")
      .insert(payload)
      .select()
      .maybeSingle();

    setSaving(false);

    if (insertErr) {
      console.error("Error saving asset from chat:", insertErr);
      setError(insertErr.message);
      appendMessage({
        role: BOT,
        text:
          "I couldn’t save that asset to Keepr. You can try again or add it from the main screen.",
      });
      return;
    }

    // Link staged attachments into asset_photos and set hero
    if (attachments.length) {
      try {
        const rows = attachments.map((att, index) => ({
          asset_id: data.id,
          storage_path: att.storagePath,
          url: att.publicUrl,
          is_hero: index === 0,
        }));

        const { error: photosErr } = await supabase
          .from("asset_photos")
          .insert(rows);

        if (photosErr) {
          console.error(
            "Error saving chat attachments to asset_photos:",
            photosErr
          );
        } else {
          const first = attachments[0];
          if (first.publicUrl) {
            const { error: heroErr } = await supabase
              .from("assets")
              .update({ hero_image_url: first.publicUrl })
              .eq("id", data.id);

            if (heroErr) {
              console.error("Error setting hero_image_url from chat:", heroErr);
            }
          }
        }
      } catch (e) {
        console.error("Error linking chat attachments to asset:", e);
      }
    }

    appendMessage({
      role: BOT,
      text: `Saved “${data.name}” to your Keepr.`,
    });

    // 🔁 Navigation now respects assetType
    if (assetType === "home") {
      // Send them back to HomeStory with this home focused
      navigation.navigate("HomeStory", { homeId: data.id });
    } else {
      // Existing behavior: go to Garage / vehicles
      navigation.navigate("RootTabs", {
        screen: "Garage",
        params: { focusAssetId: data.id },
      });
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const currentStep = STEPS[stepIndex];

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
              <Ionicons
                name="chevron-back"
                size={22}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add a New Asset by Chat</Text>
              <Text style={styles.subtitle}>
                A guided way to add a {friendlyLabel} to Keepr.
              </Text>
            </View>
          </View>

          {/* Messages */}
          <ScrollView
            style={styles.messages}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((msg) => {
              const isBot = msg.role === BOT;
              return (
                <View
                  key={msg.id}
                  style={[
                    styles.messageBubble,
                    isBot ? styles.messageBot : styles.messageUser,
                  ]}
                >
                  {isBot && (
                    <Ionicons
                      name="sparkles-outline"
                      size={14}
                      color={colors.brandBlue}
                      style={{ marginBottom: 2 }}
                    />
                  )}
                  <Text
                    style={[
                      styles.messageText,
                      isBot ? styles.messageTextBot : styles.messageTextUser,
                    ]}
                  >
                    {msg.text}
                  </Text>
                </View>
              );
            })}

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Attachment pills */}
          {attachments.length > 0 || uploadingAttachment ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.attachmentsScroll}
              contentContainerStyle={styles.attachmentsContent}
            >
              {attachments.map((att) => (
                <View key={att.id} style={styles.attachmentPill}>
                  <Ionicons
                    name="image-outline"
                    size={14}
                    color={colors.textSecondary}
                    style={{ marginRight: 4 }}
                  />
                  <Text numberOfLines={1} style={styles.attachmentLabel}>
                    {att.fileName || "Photo"}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveAttachment(att)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={14}
                      color={colors.textMuted}
                      style={{ marginLeft: 4 }}
                    />
                  </TouchableOpacity>
                </View>
              ))}
              {uploadingAttachment && (
                <View style={styles.attachmentPill}>
                  <ActivityIndicator size="small" />
                  <Text style={[styles.attachmentLabel, { marginLeft: 6 }]}>
                    Uploading…
                  </Text>
                </View>
              )}
            </ScrollView>
          ) : null}

          {/* Input row */}
          <View style={styles.inputRow}>
            {/* ChatGPT-style + button */}
            <TouchableOpacity
              style={styles.attachButton}
              onPress={handleAddPhoto}
              disabled={uploadingAttachment || saving}
            >
              <Ionicons
                name="image-outline"
                size={18}
                color={colors.textPrimary}
              />
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={
                saving
                  ? "Saving…"
                  : currentStep === "confirm"
                  ? "Add optional notes, or type “save”…"
                  : "Type your answer…"
              }
              editable={!saving}
            />

            {/* Explicit Save button on confirm step */}
            {currentStep === "confirm" && !saving && (
              <TouchableOpacity
                style={styles.saveNowButton}
                onPress={() => saveAsset(null)}
              >
                <Text style={styles.saveNowButtonText}>Save</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.sendButton,
                (!input.trim() || saving) && { opacity: 0.6 },
              ]}
              onPress={handleUserInput}
              disabled={!input.trim() || saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.brandWhite} />
              ) : (
                <Ionicons
                  name="send-outline"
                  size={18}
                  color={colors.brandWhite}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  headerBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },
  messages: {
    flex: 1,
    marginTop: spacing.sm,
  },
  messageBubble: {
    maxWidth: "85%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  messageBot: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSubtle,
  },
  messageUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.brandBlue,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 18,
  },
  messageTextBot: {
    color: colors.textPrimary,
  },
  messageTextUser: {
    color: colors.brandWhite,
  },
  errorCard: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: {
    fontSize: 12,
    color: "#B91C1C",
  },

  attachmentsScroll: {
    maxHeight: 46,
    marginBottom: spacing.xs,
  },
  attachmentsContent: {
    paddingHorizontal: 2,
    alignItems: "center",
  },
  attachmentPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: 6,
  },
  attachmentLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  attachButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.textPrimary,
  },
  saveNowButton: {
    marginLeft: spacing.xs,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  saveNowButtonText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  sendButton: {
    marginLeft: spacing.xs,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
  },
});
