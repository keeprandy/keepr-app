// screens/AddAssetScreen.js
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Image,
  Modal,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { createAssetWithDefaults } from "../lib/assetsService";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

const IS_WEB = Platform.OS === "web";

/* -------------------------------------------------------------------------- */
/* Keepr Alert Modal (consistent on web + native)                              */
/* -------------------------------------------------------------------------- */

function KeeprAlert({ open, title, message, primaryText = "OK", onClose }) {
  return (
    <Modal transparent animationType="fade" visible={!!open} onRequestClose={onClose}>
      <View style={alertStyles.backdrop}>
        <Pressable style={alertStyles.backdropTap} onPress={onClose} />
        <View style={alertStyles.card}>
          <View style={alertStyles.headerRow}>
            <View style={alertStyles.iconWrap}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.textPrimary} />
            </View>
            <Text style={alertStyles.title}>{title}</Text>
          </View>

          <Text style={alertStyles.message}>{message}</Text>

          <View style={alertStyles.footerRow}>
            <TouchableOpacity style={alertStyles.primaryBtn} onPress={onClose}>
              <Text style={alertStyles.primaryBtnText}>{primaryText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const alertStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    padding: spacing.lg,
    ...shadows.lg,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.lg,
    backgroundColor: "rgba(15,23,42,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
  },
  title: { flex: 1, fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  message: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  footerRow: { marginTop: spacing.lg, flexDirection: "row", justifyContent: "flex-end" },
  primaryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    minWidth: 120,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.white, fontWeight: "900" },
});

/* -------------------------------------------------------------------------- */
/* Asset type config                                                          */
/* -------------------------------------------------------------------------- */

const ASSET_TYPE_CONFIGS = {
  boat: {
    id: "boat",
    label: "Boat",
    requiresHeroPhoto: true,
    heroLabel: "Add a photo to start",
    namePlaceholder: "My Bennington Tri-Toon",
    successRoute: "BoatStory",
  },
  vehicle: {
    id: "vehicle",
    label: "Vehicle",
    requiresHeroPhoto: true,
    heroLabel: "Add a photo to start",
    namePlaceholder: "My 2013 Triumph Trophy",
    successRoute: "VehicleStory", // if you use a different route, change it here
  },
};

function safeInt(s) {
  const v = parseInt(String(s || "").trim(), 10);
  return Number.isFinite(v) ? v : null;
}
function safeFloat(s) {
  const v = parseFloat(String(s || "").trim());
  return Number.isFinite(v) ? v : null;
}

function getImagePickerMediaTypesCompat() {
  // Expo SDK compatibility (deprecation warning fix)
  // Newer SDKs: ImagePicker.MediaType.Images
  if (ImagePicker?.MediaType?.Images) return [ImagePicker.MediaType.Images];
  return ImagePicker.MediaTypeOptions.Images;
}

function pickBlobUrlOnWeb({ accept = "image/*" } = {}) {
  return new Promise((resolve) => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);

        const blobUrl = URL.createObjectURL(file);
        resolve({
          uri: blobUrl,
          fileName: file.name || `photo-${Date.now()}.jpg`,
          mimeType: file.type || "image/jpeg",
          revoke: () => URL.revokeObjectURL(blobUrl),
        });
      };
      input.click();
    } catch {
      resolve(null);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                      */
/* -------------------------------------------------------------------------- */

export default function AddAssetScreen({ navigation, route }) {
  const { user } = useAuth();
  const ownerId = user?.id || null;

  const initialType = route?.params?.assetType ?? "boat";
  const typeConfig = useMemo(
    () => ASSET_TYPE_CONFIGS[initialType] || ASSET_TYPE_CONFIGS.boat,
    [initialType]
  );

  // Fields
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [engineHours, setEngineHours] = useState("");
  const [assetMode, setAssetMode] = useState("personal");

  // Hero photo: select locally, upload on save
  const [heroLocalUri, setHeroLocalUri] = useState(null);
  const [heroPending, setHeroPending] = useState(null); // { uri, fileName, mimeType, revoke? }
  const [pickingPhoto, setPickingPhoto] = useState(false);

  // UX
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState(null);
  const [alertState, setAlertState] = useState({ open: false, title: "", message: "" });

  const busy = saving || pickingPhoto;

  // IMPORTANT: proves you're running the new file (shows once in web console)
  const bootLogged = useRef(false);
  useEffect(() => {
    if (!bootLogged.current) {
      bootLogged.current = true;
      console.log("AddAssetScreen LOADED (Keepr vNext attachments uploader)");
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        heroPending?.revoke?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showAlert = (title, message) => setAlertState({ open: true, title, message });
  const closeAlert = () => setAlertState({ open: false, title: "", message: "" });

  const setPickedHero = (picked) => {
    if (!picked?.uri) return;

    try {
      heroPending?.revoke?.();
    } catch {}

    setHeroLocalUri(picked.uri);
    setHeroPending(picked);
    setInlineError(null);
  };

  const choosePhoto = async () => {
    setInlineError(null);
    try {
      setPickingPhoto(true);

      let picked = null;
      if (IS_WEB) {
        picked = await pickBlobUrlOnWeb({ accept: "image/*" });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm?.granted) throw new Error("Permission required to access your photo library.");

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: getImagePickerMediaTypesCompat(),
          quality: 0.9,
        });

        if (result.canceled) return;
        const a = result.assets?.[0];
        if (!a?.uri) return;

        picked = {
          uri: a.uri,
          fileName: a.fileName || `photo-${Date.now()}.jpg`,
          mimeType: a.mimeType || "image/jpeg",
        };
      }

      if (!picked) return;
      setPickedHero(picked);
    } catch (e) {
      showAlert("Photo needed", e?.message || "Couldn’t open your photo library.");
    } finally {
      setPickingPhoto(false);
    }
  };

  const takePhoto = async () => {
    setInlineError(null);
    if (IS_WEB) return choosePhoto();

    try {
      setPickingPhoto(true);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm?.granted) throw new Error("Permission required to use the camera.");

      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (result.canceled) return;

      const a = result.assets?.[0];
      if (!a?.uri) return;

      setPickedHero({
        uri: a.uri,
        fileName: a.fileName || `photo-${Date.now()}.jpg`,
        mimeType: a.mimeType || "image/jpeg",
      });
    } catch (e) {
      showAlert("Camera unavailable", e?.message || "Couldn’t open the camera.");
    } finally {
      setPickingPhoto(false);
    }
  };

  const validate = () => {
    if (!ownerId) return "You’re not signed in. Please sign in and try again.";

    if (!name?.trim() && !make?.trim() && !model?.trim()) {
      return "Add at least a name or a make/model so you can recognize this asset later.";
    }

    // ✅ Hard requirement (your onboarding standard)
    if (typeConfig.requiresHeroPhoto && !heroPending?.uri) {
      return "Before you can save, add at least one photo.";
    }

    return null;
  };

  const handleSave = async () => {
    console.log("AddAssetScreen: Save tapped");
    const msg = validate();
    if (msg) {
      setInlineError(msg);
      showAlert("Missing info", msg);
      return;
    }

    try {
      setSaving(true);
      setInlineError(null);

      // 1) Create asset
      const payload = {
        ownerId,
        name: name?.trim() || null,
        type: typeConfig.id,
        make: make?.trim() || null,
        model: model?.trim() || null,
        year: safeInt(year),
        serialNumber: serialNumber?.trim() || null,
        engineHours: safeFloat(engineHours),
        assetMode,
        primaryPhotoUrl: null,
      };

      const asset = await createAssetWithDefaults(payload);
      if (!asset?.id) throw new Error("Asset created but no ID returned.");

      // 2) Upload hero as a real attachment (this is the “1 standard”)
      let heroPublicUrl = null;
      let attachmentId = null;

      try {
        const att = await uploadAttachmentFromUri({
          userId: ownerId,
          assetId: asset.id,
          kind: "photo",
          fileUri: heroPending.uri,
          fileName: heroPending.fileName || `hero-${asset.id}.jpg`,
          mimeType: heroPending.mimeType || "image/jpeg",
          sizeBytes: null,
          placements: [{ target_type: "asset", target_id: asset.id, role: "hero" }],
        });

        attachmentId = att?.id || null;
        heroPublicUrl = att?.public_url || att?.publicUrl || att?.url || att?.urls?.public || null;

        console.log("AddAssetScreen: hero uploaded via uploadAttachmentFromUri", {
          attachmentId,
          heroPublicUrl,
        });
      } catch (e) {
        console.warn("AddAssetScreen: hero upload failed", e);
        throw new Error("Photo upload failed. Please try again.");
      } finally {
        try {
          heroPending?.revoke?.();
        } catch {}
      }

      // 3) Update asset hero urls (for existing UI)
      if (heroPublicUrl) {
        const { error: heroErr } = await supabase
          .from("assets")
          .update({ hero_image_url: heroPublicUrl, primary_photo_url: heroPublicUrl })
          .eq("id", asset.id);

        if (heroErr) console.warn("AddAssetScreen: asset hero update error", heroErr);
      }

      // 4) Navigate
      const routeName = typeConfig.successRoute || "BoatStory";
      navigation?.navigate?.(routeName, { assetId: asset.id });
    } catch (e) {
      const msg = e?.message || "There was a problem saving this asset. Please try again.";
      setInlineError(msg);
      showAlert("Couldn’t save", msg);
    } finally {
      setSaving(false);
    }
  };

  const heroBlock = heroLocalUri ? (
    <Image source={{ uri: heroLocalUri }} style={styles.heroImage} />
  ) : (
    <View style={styles.heroPlaceholder}>
      <Ionicons name="image-outline" size={34} color={colors.textSecondary} />
      <Text style={styles.heroPlaceholderTitle}>Add a photo to start</Text>
      <Text style={styles.heroPlaceholderBody}>
        This becomes the first proof point for your asset story.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={layoutStyles.safeArea}>
      <KeeprAlert
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
      />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Add asset</Text>
          <Text style={styles.subtitle}>
            Start with one photo and the basics. Add documents after you save.
          </Text>
        </View>

        {/* Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{typeConfig.heroLabel}</Text>

          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoBtnPrimary} onPress={takePhoto} disabled={busy}>
              {pickingPhoto ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={18} color={colors.white} />
                  <Text style={styles.photoBtnPrimaryText}>Take photo</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.photoBtnSecondary} onPress={choosePhoto} disabled={busy}>
              <Ionicons name="images-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.photoBtnSecondaryText}>Choose</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: spacing.md }}>{heroBlock}</View>
        </View>

        {/* Details */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Details</Text>


          <Text style={styles.label}>Asset use</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, assetMode === "personal" && styles.modeBtnActive]}
              onPress={() => setAssetMode("personal")}
              disabled={busy}
            >
              <Text style={[styles.modeBtnText, assetMode === "personal" && styles.modeBtnTextActive]}>
                Personal
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, assetMode === "commercial" && styles.modeBtnActive]}
              onPress={() => setAssetMode("commercial")}
              disabled={busy}
            >
              <Text style={[styles.modeBtnText, assetMode === "commercial" && styles.modeBtnTextActive]}>
                Commercial
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modeHint}>Used for reporting and future business features.</Text>

          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder={typeConfig.namePlaceholder}
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
          />

          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Make</Text>
              <TextInput
                style={styles.input}
                placeholder="Triumph"
                placeholderTextColor={colors.textMuted}
                value={make}
                onChangeText={setMake}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.input}
                placeholder="Trophy SE"
                placeholderTextColor={colors.textMuted}
                value={model}
                onChangeText={setModel}
              />
            </View>
          </View>

          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Year</Text>
              <TextInput
                style={styles.input}
                placeholder="2013"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={year}
                onChangeText={setYear}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Engine hours (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="125"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={engineHours}
                onChangeText={setEngineHours}
              />
            </View>
          </View>

          <Text style={styles.label}>Serial / VIN / HIN (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="ABC123..."
            placeholderTextColor={colors.textMuted}
            value={serialNumber}
            onChangeText={setSerialNumber}
          />
        </View>

        {/* Inline error banner near CTA */}
        {inlineError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.errorBannerText}>{inlineError}</Text>
          </View>
        ) : null}

        {/* Save */}
        <View style={[styles.section, { marginBottom: spacing.xl }]}>
          <TouchableOpacity
            style={[styles.saveBtn, busy && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={busy}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color={colors.white} />
                <Text style={styles.saveBtnText}>Save asset</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.afterSaveHint}>
            Next: add PDFs, spreadsheets, invoices, and insurance in Attachments.
          </Text>

          {/* Small dev stamp so you can confirm the file is actually live */}
          {__DEV__ ? (
            <Text style={styles.devStamp}>AddAsset vNext · attachmentsUploader</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  header: { marginBottom: spacing.md },
  title: { ...typography.title },
  subtitle: { ...typography.subtitle, marginTop: 2 },

  section: { marginTop: spacing.lg },
  sectionLabel: { ...typography.sectionLabel, marginBottom: spacing.xs },

  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },

  photoBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  photoBtnPrimaryText: { fontSize: 13, color: colors.white, fontWeight: "800" },

  photoBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: colors.surface,
  },
  photoBtnSecondaryText: { fontSize: 13, color: colors.textPrimary, fontWeight: "800" },

  heroImage: {
    width: "100%",
    height: 240,
    borderRadius: radius.xl,
    resizeMode: "cover",
    backgroundColor: "rgba(15,23,42,0.4)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
  },
  heroPlaceholder: {
    width: "100%",
    height: 240,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  heroPlaceholderTitle: { marginTop: spacing.sm, fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  heroPlaceholderBody: { marginTop: 4, fontSize: 13, color: colors.textSecondary, textAlign: "center", lineHeight: 18 },

  label: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: "rgba(15,23,42,0.9)",
  },

  twoCol: { flexDirection: IS_WEB ? "row" : "column", gap: spacing.md },
  col: { flex: 1 },

  errorBanner: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  errorBannerText: { flex: 1, color: colors.danger, fontWeight: "800", fontSize: 13, lineHeight: 18 },

  saveBtn: {
    marginTop: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...shadows.md,
  },
  saveBtnText: { color: colors.white, fontSize: 14, fontWeight: "900" },
  afterSaveHint: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary, textAlign: "center" },

  devStamp: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: "rgba(148,163,184,0.7)",
    textAlign: "center",
  },
});
