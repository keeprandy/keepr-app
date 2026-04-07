// screens/AddAssetChatScreen.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import * as DocumentPicker from "expo-document-picker";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { createAssetWithDefaults } from "../lib/assetsService";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

const IS_WEB = Platform.OS === "web";
const HERO_BUCKET = "asset-files";
const HERO_ROLE = "hero";
const BOT = "bot";
const USER = "user";


function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function getPublicUrl(bucket, path) {
  if (!bucket || !path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

function mediaTypesImagesCompat() {
  if (ImagePicker?.MediaType?.Images) return [ImagePicker.MediaType.Images];
  return ImagePicker.MediaTypeOptions.Images;
}

function KeeprAlertModal({ open, title, message, onClose }) {
  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalIconWrap}>
              <Ionicons
                name="information-circle"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <Text style={styles.modalTitle}>{title}</Text>
          </View>

          {!!message && <Text style={styles.modalMessage}>{message}</Text>}

          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={styles.modalBtnPrimary}>
              <Text style={styles.modalBtnPrimaryText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function chatConfigForAssetType(assetTypeRaw) {
  const assetType = (assetTypeRaw || "vehicle").toLowerCase();

  if (assetType === "home") {
    return {
      assetType: "home",
      title: "Add Asset with Kai",
      subtitle: "Kai will help you add a home in a few quick steps.",
      intro: "Let’s add your home. I’ll keep this quick.",
      questions: [
        {
          key: "street",
          label: "Street Address",
          prompt: "What’s the street address?",
        },
        {
          key: "city",
          label: "City",
          prompt: "What city is it in?",
        },
        {
          key: "state",
          label: "State",
          prompt: "What state is it in? Use the 2-letter code if you can.",
        },
        {
          key: "postalCode",
          label: "Postal Code",
          prompt: "What’s the postal code?",
        },
      ],
    };
  }

  if (assetType === "boat") {
    return {
      assetType: "boat",
      title: "Add Asset with Kai",
      subtitle: "Kai will help you add a boat in a few quick steps.",
      intro: "Let’s add your boat.",
      questions: [
        {
          key: "make",
          label: "Make",
          prompt: "What’s the make?",
        },
        {
          key: "model",
          label: "Model",
          prompt: "What’s the model?",
        },
        {
          key: "year",
          label: "Year",
          prompt: "What year is it?",
        },
        {
          key: "lengthFeet",
          label: "Length",
          prompt: "How long is it in feet?",
        },
      ],
    };
  }

  return {
    assetType: "vehicle",
    title: "Add Asset with Kai",
    subtitle: "Kai will help you add a vehicle in a few quick steps.",
    intro: "Let’s add your vehicle.",
    questions: [
      {
        key: "make",
        label: "Make",
        prompt: "What’s the make?",
      },
      {
        key: "model",
        label: "Model",
        prompt: "What’s the model?",
      },
      {
        key: "year",
        label: "Year",
        prompt: "What year is it?",
      },
    ],
  };
}

function validateAnswer(fieldKey, value) {
  const v = safeStr(value).trim();

  if (!v) return "Please enter a value before moving on.";

  if (fieldKey === "year") {
    if (!/^\d{4}$/.test(v)) {
      return "Enter a 4-digit year, like 2020.";
    }
    const yearNum = parseInt(v, 10);
    if (Number.isNaN(yearNum) || yearNum < 1600 || yearNum > 2100) {
      return "Enter a valid year.";
    }
  }

  if (fieldKey === "lengthFeet") {
    const n = parseFloat(v);
    if (Number.isNaN(n) || n <= 0) {
      return "Enter length in feet, like 22.";
    }
  }

  if (fieldKey === "state") {
    if (!/^[A-Za-z]{2}$/.test(v)) {
      return "Use a 2-letter state code, like MI.";
    }
  }

  if (fieldKey === "postalCode") {
    if (!/^\d{5}(-\d{4})?$/.test(v)) {
      return "Enter a valid ZIP code, like 48116.";
    }
  }

  return null;
}

export default function AddAssetChatScreen({ navigation, route }) {
    const initialType = route?.params?.assetType || null;
  const [selectedAssetType, setSelectedAssetType] = useState(initialType);
  const [step, setStep] = useState(initialType ? "collecting" : "choose_type");
const config = useMemo(
  () => (selectedAssetType ? chatConfigForAssetType(selectedAssetType) : null),
  [selectedAssetType]
);

  const assetType = config?.assetType || null;
  const questions = config?.questions || [];
  const title = config?.title || "Add Asset with Kai";
  const subtitle =
    config?.subtitle || "Kai will help you add this in a few quick steps.";
  const intro = config?.intro || "What would you like to add?";

  const [answers, setAnswers] = useState({});
  const [messages, setMessages] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoLocal, setPhotoLocal] = useState(null);
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
  });

  const scrollRef = useRef(null);

  const openModal = (titleText, message) =>
    setModal({ open: true, title: titleText, message });
  const closeModal = () =>
    setModal({ open: false, title: "", message: "" });

  useEffect(() => {
    if (!selectedAssetType) {
      setMessages([
        {
          id: "intro-choose-type",
          role: BOT,
          text: "What would you like to add?",
        },
      ]);
      setAnswers({});
      setInput("");
      setStep("choose_type");
      setPhotoLocal(null);
      return;
    }

    setMessages([
      {
        id: `intro-${selectedAssetType}`,
        role: BOT,
        text: intro,
      },
      {
        id: `q0-${selectedAssetType}`,
        role: BOT,
        text: questions[0]?.prompt || "Let’s get started.",
      },
    ]);
    setAnswers({});
    setInput("");
    setStep("collecting");
    setPhotoLocal(null);
  }, [selectedAssetType]);

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    }, 50);
  }, [messages, photoLocal]);

  const currentQuestion = questions[stepIndex] || null;
  const allQuestionsAnswered = stepIndex >= questions.length;

  const summaryLines = useMemo(() => {
    if (!allQuestionsAnswered) return [];

    if (assetType === "home") {
      return [
        answers.street ? `Street: ${answers.street}` : null,
        answers.city ? `City: ${answers.city}` : null,
        answers.state ? `State: ${answers.state}` : null,
        answers.postalCode ? `Postal Code: ${answers.postalCode}` : null,
      ].filter(Boolean);
    }

    if (assetType === "boat") {
      return [
        answers.make ? `Make: ${answers.make}` : null,
        answers.model ? `Model: ${answers.model}` : null,
        answers.year ? `Year: ${answers.year}` : null,
        answers.lengthFeet ? `Length: ${answers.lengthFeet} ft` : null,
      ].filter(Boolean);
    }

    return [
      answers.make ? `Make: ${answers.make}` : null,
      answers.model ? `Model: ${answers.model}` : null,
      answers.year ? `Year: ${answers.year}` : null,
    ].filter(Boolean);
  }, [allQuestionsAnswered, answers, assetType]);

  const appendMessage = (role, text) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${prev.length}`,
        role,
        text,
      },
    ]);
  };

  async function pickPhotoFromLibrary() {
    try {
      if (IS_WEB) {
        const res = await DocumentPicker.getDocumentAsync({
          type: "image/*",
          multiple: false,
          copyToCacheDirectory: true,
        });

        if (res.canceled) return;

        const f = res.assets?.[0];
        if (!f?.uri) return;

        setPhotoLocal({
          uri: f.uri,
          fileName: f.name || f.uri.split("/").pop() || "asset.jpg",
          mimeType: f.mimeType || "image/jpeg",
          fileSize: f.size || null,
        });
        return;
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        openModal(
          "Permission needed",
          "Please allow photo library access to choose a photo."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypesImagesCompat(),
        quality: 0.9,
      });

      if (result.canceled) return;

      const a = result.assets?.[0];
      if (!a?.uri) return;

      setPhotoLocal({
        uri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "asset.jpg",
        mimeType: a.mimeType || "image/jpeg",
        fileSize: a.fileSize || null,
      });
    } catch (e) {
      console.log("AddAssetChatScreen pickPhotoFromLibrary failed", e);
      openModal("Couldn’t open photos", "Try again.");
    }
  }

  async function takePhoto() {
    if (IS_WEB) return pickPhotoFromLibrary();

    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        openModal(
          "Permission needed",
          "Please allow camera access to take a photo."
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });

      if (result.canceled) return;

      const a = result.assets?.[0];
      if (!a?.uri) return;

      setPhotoLocal({
        uri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "asset.jpg",
        mimeType: a.mimeType || "image/jpeg",
        fileSize: a.fileSize || null,
      });
    } catch (e) {
      console.log("AddAssetChatScreen takePhoto failed", e);
      openModal("Couldn’t open camera", "Try again.");
    }
  }

  const handleSend = () => {
    if (saving || uploadingPhoto) return;
    if (!currentQuestion) return;

    const trimmed = safeStr(input).trim();
    if (!trimmed) return;

    const validationMessage = validateAnswer(currentQuestion.key, trimmed);
    if (validationMessage) {
      appendMessage(BOT, validationMessage);
      return;
    }

    appendMessage(USER, trimmed);

    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.key]:
        currentQuestion.key === "state"
          ? trimmed.toUpperCase()
          : trimmed,
    }));

    setInput("");

    const nextIndex = stepIndex + 1;

    if (nextIndex < questions.length) {
      setStepIndex(nextIndex);
      appendMessage(BOT, questions[nextIndex].prompt);
      return;
    }

    setStepIndex(nextIndex);
    appendMessage(
      BOT,
      "That’s everything I need. Review it below, add a photo if you want, then create the asset."
    );
  };

  const buildDisplayName = () => {
    if (assetType === "home") {
      return [answers.street, answers.city, answers.state]
        .filter(Boolean)
        .join(", ");
    }

    return `${answers.year || ""} ${answers.make || ""} ${answers.model || ""}`.trim();
  };

  const buildLocationString = () => {
    if (assetType === "home") {
      return [
        answers.street,
        answers.city,
        answers.state,
        answers.postalCode,
      ]
        .filter(Boolean)
        .join(", ");
    }

    return null;
  };

  const createAsset = async () => {
    if (!allQuestionsAnswered || saving) return;

    try {
      setSaving(true);

      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) {
        openModal("Sign in required", "Please sign in to add an asset.");
        return;
      }

      const displayName = buildDisplayName();
      if (!displayName) {
        openModal(
          "Missing details",
          "Please complete the required answers."
        );
        return;
      }

      let created = null;

      if (assetType === "home") {
        created = await createAssetWithDefaults({
          ownerId: userId,
          name: displayName,
          type: "home",
          make: null,
          model: null,
          year: null,
          serialNumber: null,
          engineHours: null,
          primaryPhotoUrl: null,
        });
      } else if (assetType === "boat") {
        created = await createAssetWithDefaults({
          ownerId: userId,
          name: displayName,
          type: "boat",
          make: answers.make || null,
          model: answers.model || null,
          year: parseInt(answers.year, 10),
          serialNumber: null,
          engineHours: null,
          primaryPhotoUrl: null,
        });
      } else {
        created = await createAssetWithDefaults({
          ownerId: userId,
          name: displayName,
          type: "vehicle",
          make: answers.make || null,
          model: answers.model || null,
          year: parseInt(answers.year, 10),
          serialNumber: null,
          engineHours: null,
          primaryPhotoUrl: null,
        });
      }

      const assetId = created?.id;
      if (!assetId) {
        throw new Error("Asset create did not return an id.");
      }

      let heroUrl = null;
      let heroPlacementId = null;

      if (photoLocal?.uri) {
        setUploadingPhoto(true);

        const receipt = await uploadAttachmentFromUri({
          userId,
          assetId,
          kind: "photo",
          fileUri: photoLocal.uri,
          fileName: photoLocal.fileName || "asset.jpg",
          mimeType: photoLocal.mimeType || "image/jpeg",
          sizeBytes: photoLocal.fileSize || null,
          title: "Hero photo",
          notes: null,
          sourceContext: "add_asset_with_kai",
          bucket: HERO_BUCKET,
          placements: [
            {
              target_type: "asset",
              target_id: assetId,
              role: HERO_ROLE,
              label: "Hero",
              sort_order: 0,
              is_showcase: true,
            },
          ],
        });

        const uploadedAttachment = receipt?.attachment;
        const uploadedPlacement = receipt?.placements?.[0];

        heroPlacementId = uploadedPlacement?.id || null;

        if (uploadedAttachment?.bucket && uploadedAttachment?.storage_path) {
          heroUrl = getPublicUrl(
            uploadedAttachment.bucket,
            uploadedAttachment.storage_path
          );
        }
      }

      const updatePayload = {
        hero_placement_id: heroPlacementId,
        hero_image_url: heroUrl,
      };

      if (assetType === "home") {
        updatePayload.location = buildLocationString() || null;
      }

      if (assetType === "boat") {
        updatePayload.length_feet = parseFloat(answers.lengthFeet);
      }

      const { error: upErr } = await supabase
        .from("assets")
        .update(updatePayload)
        .eq("id", assetId);

      if (upErr) throw upErr;

      if (assetType === "home") {
        navigation.replace("HomeStory", { assetId });
        return;
      }

      if (assetType === "boat") {
        navigation.replace("BoatStory", { assetId });
        return;
      }

      navigation.replace("VehicleStory", { assetId });
    } catch (e) {
      console.log("AddAssetChatScreen createAsset failed", e);
      openModal("Couldn’t save", e?.message || "Please try again.");
    } finally {
      setUploadingPhoto(false);
      setSaving(false);
    }
  };

  const photoLabel = photoLocal?.uri
    ? "Photo selected"
    : "Photo optional";

  return (
    <SafeAreaView style={layoutStyles.screen} edges={["top", "left", "right", "bottom"]}>
      <KeeprAlertModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={closeModal}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={IS_WEB ? undefined : "padding"}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.85}
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.replace("RootTabs");
            }}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.kaiBanner}>
            <View style={styles.kaiOrb}>
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kaiBannerTitle}>Kai</Text>
              <Text style={styles.kaiBannerText}>
                A guided way to add an asset.
              </Text>
            </View>
          </View>
      {/* TYPE SELECTION */}
{step === "choose_type" && (
  <View style={styles.typeChooserWrap}>
    <View style={[styles.bubbleRow, styles.bubbleRowBot]}>
      <View style={[styles.bubble, styles.bubbleBot]}>
        <Text style={[styles.bubbleText, styles.bubbleTextBot]}>
          What would you like to add?
        </Text>
      </View>
    </View>

    <View style={styles.choiceList}>
      {[
        {
          label: "Home",
          value: "home",
          icon: "home-outline",
          hint: "Address, city, state, and ZIP",
        },
        {
          label: "Vehicle",
          value: "vehicle",
          icon: "car-sport-outline",
          hint: "Make, model, and year",
        },
        {
          label: "Boat",
          value: "boat",
          icon: "boat-outline",
          hint: "Make, model, year, and length",
        },
      ].map((option) => (
        <TouchableOpacity
          key={option.value}
          style={styles.choiceButton}
          activeOpacity={0.9}
          onPress={() => {
            setSelectedAssetType(option.value);
          }}
        >
          <View style={styles.choiceIconWrap}>
            <Ionicons
              name={option.icon}
              size={18}
              color={colors.textPrimary}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.choiceText}>{option.label}</Text>
            <Text style={styles.choiceHint}>{option.hint}</Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      ))}
    </View>
  </View>
)}
      {/* MAIN CHAT FLOW */}
      {step === "collecting" && (
        <>

            {messages.map((msg) => {
              const isBot = msg.role === BOT;

              return (
                <View
                  key={msg.id}
                  style={[
                    styles.bubbleRow,
                    isBot ? styles.bubbleRowBot : styles.bubbleRowUser,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      isBot ? styles.bubbleBot : styles.bubbleUser,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        isBot ? styles.bubbleTextBot : styles.bubbleTextUser,
                      ]}
                    >
                      {msg.text}
                    </Text>
                  </View>
                </View>
              );
            })}

            {allQuestionsAnswered && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Ready to create</Text>

                {summaryLines.map((line) => (
                  <Text key={line} style={styles.summaryLine}>
                    {line}
                  </Text>
                ))}

                <View style={styles.photoSection}>
                  <Text style={styles.photoSectionLabel}>{photoLabel}</Text>

                  {!!photoLocal?.uri && (
                    <Image
                      source={{ uri: photoLocal.uri }}
                      style={styles.photoPreview}
                    />
                  )}

                  <View style={styles.photoActions}>
                    <TouchableOpacity
                      style={styles.photoBtnPrimary}
                      onPress={takePhoto}
                      disabled={saving || uploadingPhoto}
                    >
                      <Ionicons name="camera-outline" size={16} color="#fff" />
                      <Text style={styles.photoBtnPrimaryText}>Take photo</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.photoBtnSecondary}
                      onPress={pickPhotoFromLibrary}
                      disabled={saving || uploadingPhoto}
                    >
                      <Ionicons
                        name="images-outline"
                        size={16}
                        color={colors.textPrimary}
                      />
                      <Text style={styles.photoBtnSecondaryText}>
                        Choose photo
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.createBtn,
                    (saving || uploadingPhoto) && styles.dim,
                  ]}
                  disabled={saving || uploadingPhoto}
                  onPress={createAsset}
                >
                  {saving || uploadingPhoto ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles-outline" size={18} color="#fff" />
                      <Text style={styles.createBtnText}>
                        Create with Kai
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
        </>
      )}
        </ScrollView>
            {!allQuestionsAnswered && (
            <View style={styles.inputWrap}>
              {!!currentQuestion && (
                <Text style={styles.promptLabel}>
                  {currentQuestion.label}
                </Text>
              )}

              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type your answer"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize={
                    currentQuestion?.key === "state"
                      ? "characters"
                      : "sentences"
                  }
                  autoCorrect={false}
                  blurOnSubmit={false}
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  onKeyPress={(e) => {
                    if (
                      Platform.OS === "web" &&
                      e?.nativeEvent?.key === "Enter" &&
                      !e?.nativeEvent?.shiftKey
                    ) {
                      e.preventDefault?.();
                      handleSend();
                    }
                  }}
                />

                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={handleSend}
                >
                  <Ionicons name="arrow-up" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  title: typography.title,
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  kaiBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
    marginBottom: spacing.md,
  },
  kaiOrb: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  kaiBannerTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  kaiBannerText: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  bubbleRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  bubbleRowBot: {
    justifyContent: "flex-start",
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "84%",
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleBot: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  bubbleUser: {
    backgroundColor: colors.brandBlue,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextBot: {
    color: colors.textPrimary,
  },
  bubbleTextUser: {
    color: "#fff",
  },
  typeChooserWrap: {
  marginTop: spacing.sm,
},

choiceList: {
  marginTop: spacing.sm,
  gap: spacing.sm,
},

choiceButton: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.md,
  borderRadius: radius.xl,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  ...shadows.subtle,
},

choiceIconWrap: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.surfaceSubtle,
  marginRight: spacing.sm,
},

choiceText: {
  fontSize: 14,
  fontWeight: "800",
  color: colors.textPrimary,
},

choiceHint: {
  marginTop: 2,
  fontSize: 12,
  color: colors.textSecondary,
  lineHeight: 16,
},
  summaryCard: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  summaryLine: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  photoSection: {
    marginTop: spacing.md,
  },
  photoSectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  photoPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: spacing.sm,
  },
  photoActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  photoBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
  },
  photoBtnPrimaryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  photoBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  photoBtnSecondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  createBtn: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  createBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  inputWrap: {
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
  paddingBottom: spacing.lg,
  backgroundColor: colors.background,
  borderTopWidth: 1,
  borderTopColor: colors.borderSubtle,
},
  promptLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    ...shadows.subtle,
  },
  dim: {
    opacity: 0.65,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...(IS_WEB ? { boxShadow: "0 8px 24px rgba(0,0,0,0.18)" } : {}),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  modalMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  modalBtnPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
  },
  modalBtnPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});