// screens/AddVehicleAssetScreen.js
import React, { useMemo, useState } from "react";
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
  Pressable,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { createAssetWithDefaults } from "../lib/assetsService";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import * as DocumentPicker from "expo-document-picker";

const IS_WEB = Platform.OS === "web";
const HERO_BUCKET = "asset-files"; // keep hero photos in asset-files bucket (your standard)
const HERO_ROLE = "hero";


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

/** Simple Keepr-styled modal (works on web + native) */
function KeeprAlertModal({ open, title, message, onClose }) {
  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="information-circle" size={18} color={colors.textPrimary} />
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

export default function AddVehicleAssetScreen({ navigation, route }) {
  const [photoLocal, setPhotoLocal] = useState(null); // { uri, fileName, mimeType, fileSize }
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [assetMode, setAssetMode] = useState("personal");
  const [commercialEntity, setCommercialEntity] = useState("");

  const [saving, setSaving] = useState(false);

  // inline error (below helper copy)
  const [error, setError] = useState(null);

  // Keepr modal (web + native)
  const [modal, setModal] = useState({ open: false, title: "", message: "" });
  const openModal = (title, message) => setModal({ open: true, title, message });
  const closeModal = () => setModal({ open: false, title: "", message: "" });

  const heroLabel = useMemo(() => {
    if (!photoLocal?.uri) return "No vehicle photo yet";
    return "Selected · this will be your hero photo";
  }, [photoLocal]);

async function pickPhotoFromLibrary() {
  setError(null);
  try {
    // ✅ Web: use DocumentPicker (stable + real file)
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
        fileName: f.name || f.uri.split("/").pop() || "vehicle.jpg",
        mimeType: f.mimeType || "image/jpeg",
        fileSize: f.size || null,
      });
      return;
    }

    // ✅ Native: ImagePicker
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      openModal("Permission needed", "Please allow photo library access to choose a hero photo.");
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
      fileName: a.fileName || a.uri.split("/").pop() || "vehicle.jpg",
      mimeType: a.mimeType || "image/jpeg",
      fileSize: a.fileSize || null,
    });
  } catch (e) {
    console.log("pickPhotoFromLibrary failed", e);
    openModal("Couldn’t open photos", "Try again, or use Take photo.");
  }
}

  async function takePhoto() {
    setError(null);
    if (IS_WEB) return pickPhotoFromLibrary();

    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        openModal("Permission needed", "Please allow camera access to take a hero photo.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
      });

      if (result.canceled) return;
      const a = result.assets?.[0];
      if (!a?.uri) return;

      setPhotoLocal({
        uri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "vehicle.jpg",
        mimeType: a.mimeType || "image/jpeg",
        fileSize: a.fileSize || null,
      });
    } catch (e) {
      console.log("takePhoto failed", e);
      openModal("Couldn’t open camera", "Try again, or choose a photo from your library.");
    }
  }

  function validate() {
    const trimmedYear = safeStr(year).trim();
    const trimmedMake = safeStr(make).trim();
    const trimmedModel = safeStr(model).trim();

    if (!trimmedYear || !trimmedMake || !trimmedModel) {
      return {
        ok: false,
        title: "Missing details",
        message: "Add Year, Make, and Model so Keepr can organize maintenance and resale value.",
      };
    }

    const yearNumber = parseInt(trimmedYear, 10);
    if (Number.isNaN(yearNumber) || yearNumber < 1900 || yearNumber > 2100) {
      return {
        ok: false,
        title: "Check the year",
        message: "Enter a valid year (example: 2022).",
      };
    }

    if (!photoLocal?.uri) {
      return {
        ok: false,
        title: "Add a hero photo",
        message: "Choose or take 1 photo — this becomes your hero image and shows up in Attachments.",
      };
    }

    // mileage optional
    const trimmedMileage = safeStr(mileage).trim();
    if (trimmedMileage) {
      const mileageNumber = parseFloat(trimmedMileage);
      if (Number.isNaN(mileageNumber)) {
        return {
          ok: false,
          title: "Check mileage",
          message: "Mileage must be a number (example: 45210).",
        };
      }
    }

    return { ok: true };
  }

  async function handleSave() {
    setError(null);

    const v = validate();
    if (!v.ok) {
      openModal(v.title, v.message);
      setError(v.message);
      return;
    }

    const trimmedYear = year.trim();
    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const trimmedName = name.trim();
    const trimmedVin = vin.trim();
    const trimmedLocation = location.trim();
    const trimmedNotes = notes.trim();
    const trimmedMileage = mileage.trim();

    const yearNumber = parseInt(trimmedYear, 10);
    const mileageNumber = trimmedMileage ? parseFloat(trimmedMileage) : null;

    const displayName = trimmedName || `${trimmedYear} ${trimmedMake} ${trimmedModel}`;

    try {
      setSaving(true);

      // 1) must be signed in
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) {
        openModal("Sign in required", "Please sign in to add a vehicle.");
        return;
      }

      // 2) Create the asset first (no hero yet)
      const created = await createAssetWithDefaults({
        ownerId: userId,
        name: displayName,
        type: "vehicle",
        make: trimmedMake || null,
        model: trimmedModel || null,
        year: yearNumber,
        serialNumber: trimmedVin || null,
        engineHours: null,
        primaryPhotoUrl: null,
      });

      const assetId = created?.id;
      if (!assetId) throw new Error("Asset create did not return an id.");

      // 3) Upload hero photo using the SAME standard as AssetAttachmentsScreen (DB-backed upload)
      setUploadingPhoto(true);

      const receipt = await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "photo",
        fileUri: photoLocal.uri,
        fileName: photoLocal.fileName || "vehicle.jpg",
        mimeType: photoLocal.mimeType || "image/jpeg",
        sizeBytes: photoLocal.fileSize || null,
        title: "Hero photo",
        notes: null,
        sourceContext: "add_vehicle_asset",
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

      if (!uploadedAttachment?.bucket || !uploadedAttachment?.storage_path) {
        throw new Error("Upload completed but no storage path returned.");
      }
      if (!uploadedPlacement?.id) {
        throw new Error("Upload completed but no placement id returned.");
      }

      const heroUrl = getPublicUrl(uploadedAttachment.bucket, uploadedAttachment.storage_path);

      // 4) Update the asset to point at the hero placement + hero URL
      const updatePayload = {
        hero_placement_id: uploadedPlacement.id,
        hero_image_url: heroUrl,
        location: trimmedLocation || null,
        notes: trimmedNotes || null,
        asset_mode: assetMode,
        commercial_entity:
          assetMode === "commercial"
            ? (commercialEntity || "").trim() || null
            : null,
      };

      // Optional: if you have a field like current_odometer, set it here
      if (mileageNumber != null) updatePayload.current_odometer = mileageNumber;

      const { error: upErr } = await supabase.from("assets").update(updatePayload).eq("id", assetId);
      if (upErr) throw upErr;

      // 5) Navigate
     navigation.replace("VehicleStory", { assetId });
    } catch (e) {
      console.log("AddVehicleAssetScreen save failed", e);
      const msg = e?.message || "Could not save vehicle. Please try again.";
      setError(msg);
      openModal("Couldn’t save", msg);
    } finally {
      setUploadingPhoto(false);
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeeprAlertModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={closeModal}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add vehicle</Text>
            <Text style={styles.subtitle}>
              Add a hero photo + Year / Make / Model. After that, add docs in Attachments.
            </Text>
          </View>
        </View>

        {/* Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Hero photo (required)</Text>

          <View style={styles.photoRow}>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={takePhoto}
              disabled={saving || uploadingPhoto}
            >
              {uploadingPhoto ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={18} color="white" style={{ marginRight: 6 }} />
                  <Text style={styles.photoButtonText}>Take photo</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoButtonSecondary}
              onPress={pickPhotoFromLibrary}
              disabled={saving || uploadingPhoto}
            >
              <Ionicons
                name="images-outline"
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.photoButtonSecondaryText}>Choose from library</Text>
            </TouchableOpacity>
          </View>

          {!!photoLocal?.uri && (
            <View style={styles.photoPreviewCard}>
              <Image source={{ uri: photoLocal.uri }} style={styles.photo} />
              <Text style={styles.photoCaption}>{heroLabel}</Text>
            </View>
          )}
        </View>

        {/* Details */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Vehicle details</Text>


          <Text style={styles.fieldLabel}>Asset use</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, assetMode === "personal" && styles.modeBtnActive]}
              onPress={() => setAssetMode("personal")}
            >
              <Text style={[styles.modeText, assetMode === "personal" && styles.modeTextActive]}>Personal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, assetMode === "commercial" && styles.modeBtnActive]}
              onPress={() => setAssetMode("commercial")}
            >
              <Text style={[styles.modeText, assetMode === "commercial" && styles.modeTextActive]}>Commercial</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modeHelp}>Used for reporting and future business features.</Text>

          {assetMode === "commercial" && (
            <TextInput
              style={styles.input}
              placeholder="Commercial entity (LLC, fleet, etc.)"
              value={commercialEntity}
              onChangeText={setCommercialEntity}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="Vehicle name (optional)"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="Make (required – Ford, BMW…)"
            value={make}
            onChangeText={setMake}
          />
          <TextInput
            style={styles.input}
            placeholder="Model (required – F-150, 330i, etc.)"
            value={model}
            onChangeText={setModel}
          />

          <View style={styles.inlineInputsRow}>
            <TextInput
              style={[styles.input, styles.inputHalf]}
              placeholder="Year (required)"
              keyboardType="numeric"
              value={year}
              onChangeText={setYear}
            />
            <TextInput
              style={[styles.input, styles.inputHalf, { marginRight: 0 }]}
              placeholder="Mileage (mi, optional)"
              keyboardType="numeric"
              value={mileage}
              onChangeText={setMileage}
            />
          </View>

          <TextInput
            style={styles.input}
            placeholder="VIN (optional)"
            value={vin}
            onChangeText={setVin}
          />
          <TextInput
            style={styles.input}
            placeholder="Primary location (optional)"
            value={location}
            onChangeText={setLocation}
          />
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Notes (optional)"
            multiline
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* Helper copy */}
        <View style={styles.section}>
          <Text style={styles.helperText}>
            After saving, use Attachments for spreadsheets, PDFs, insurance, invoices, and service docs.
          </Text>
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.section}>
            <Text style={styles.error}>{error}</Text>
          </View>
        )}

        {/* Save */}
        <View style={[styles.section, { marginBottom: spacing.xl }]}>
          <TouchableOpacity
            style={[styles.saveButton, (saving || uploadingPhoto) && { opacity: 0.65 }]}
            onPress={handleSave}
            disabled={saving || uploadingPhoto}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="white" style={{ marginRight: 6 }} />
                <Text style={styles.saveText}>Save vehicle</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
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
  title: typography.title,
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionLabel: typography.sectionLabel,

  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  photoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    marginRight: spacing.sm,
  },
  photoButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
  },
  photoButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  photoButtonSecondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "500",
  },

  photoPreviewCard: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    alignSelf: "stretch",
  },
  photo: {
    width: "100%",
    aspectRatio: 16 / 9,
    resizeMode: "contain",
    backgroundColor: colors.surfaceSubtle,
  },
  photoCaption: {
    fontSize: 11,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },

  input: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    fontSize: 13,
    backgroundColor: colors.surface,
  },
  inlineInputsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  inputHalf: {
    flex: 1,
    marginRight: spacing.sm,
  },
  notesInput: {
    height: 90,
    textAlignVertical: "top",
  },


  fieldLabel: { fontSize: 12, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  modeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  modeBtnActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  modeText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  modeTextActive: { color: "white" },
  modeHelp: { fontSize: 11, color: colors.textSecondary, marginTop: 6, lineHeight: 16 },

  helperText: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  error: {
    color: "red",
    fontSize: 12,
  },

  saveButton: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  saveText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },

  // Modal
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
    color: "white",
    fontWeight: "700",
    fontSize: 13,
  },
});
