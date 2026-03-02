// screens/AddServiceRecordScreen.js
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing, typography } from "../styles/theme";

import { useBoats } from "../context/BoatsContext";
import { useVehicles } from "../context/VehiclesContext";

import { supabase } from "../lib/supabaseClient";
import { createServiceRecordWithStoryEvent } from "../lib/serviceRecordsService";
import {
  pickAndNormalizeImageFromLibrary,
  uploadInvoicePhotoForServiceRecord,
} from "../lib/invoicePhotos";
import { addServiceRecordAttachment } from "../lib/attachmentsEngine";

/* =======================================================
   Helpers
   ======================================================= */

function getTodayPieces() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return { yyyy, mm, dd };
}

function formatDateForInput(dateObj) {
  try {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
  } catch {
    const { yyyy, mm, dd } = getTodayPieces();
    return `${mm}-${dd}-${yyyy}`;
  }
}

function parseMoneyToNumber(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.replace(/,/g, "");
  const num = Number(normalized);
  return Number.isNaN(num) ? null : num;
}

// Accept MM-DD-YYYY, MM/DD/YYYY, or YYYY-MM-DD → YYYY-MM-DD (local-safe)
function parseUSDateToISO(value) {
  if (!value) {
    const { yyyy, mm, dd } = getTodayPieces();
    return `${yyyy}-${mm}-${dd}`;
  }

  const parts = value.split(/[-/]/).map((p) => p.trim());
  if (parts.length === 3) {
    let [a, b, c] = parts;
    let yyyy, mm, dd;

    if (a.length === 4) {
      yyyy = a;
      mm = b;
      dd = c;
    } else {
      mm = a;
      dd = b;
      yyyy = c;
    }

    if (yyyy && mm && dd) {
      return `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }

  const { yyyy, mm, dd } = getTodayPieces();
  return `${yyyy}-${mm}-${dd}`;
}

function buildKeeprProLabel(row) {
  const name = row.name || "";
  const location = row.location || "";
  if (name && location) return `${name} – ${location}`;
  if (name) return name;
  if (location) return location;
  return "Unnamed Keepr Pro";
}

/* =======================================================
   Component
   ======================================================= */

export default function AddServiceRecordScreen({ route, navigation }) {
  const {
    source, // "boat" | "vehicle" | "home" | "homeSystem" | undefined
    assetId: paramAssetId,
    assetName,
    vehicleId,
    boatId,
    systemId: paramSystemId,
    systemName,
    serviceType: initialServiceType,
  } = route?.params || {};

  const { vehicles } = useVehicles();
  const { boats } = useBoats();

  const vehicle = vehicleId ? vehicles.find((v) => v.id === vehicleId) : null;
  const boat = boatId ? boats.find((b) => b.id === boatId) : null;

  const resolvedAssetId = paramAssetId || boat?.id || vehicle?.id || null;
  const contextLabel = assetName || boat?.name || vehicle?.name || "Asset";

  const [serviceType, setServiceType] = useState(
    initialServiceType === "diy" ? "diy" : "pro"
  );

  const [date, setDate] = useState(() => formatDateForInput(new Date()));
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Invoice hero photo (existing behavior)
  const [invoiceImage, setInvoiceImage] = useState(null);
  const [pickingInvoice, setPickingInvoice] = useState(false);

  // Systems (ALWAYS from systems table)
  const [systems, setSystems] = useState([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [systemsError, setSystemsError] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(paramSystemId || null);

  // Inline add system (ALWAYS to systems table)
  const [addingSystem, setAddingSystem] = useState(false);
  const [newSystemName, setNewSystemName] = useState("");
  const [savingSystem, setSavingSystem] = useState(false);

  // Keepr Pros
  const [keeprPros, setKeeprPros] = useState([]);
  const [keeprProsLoading, setKeeprProsLoading] = useState(false);
  const [keeprProsError, setKeeprProsError] = useState(false);
  const [selectedKeeprProId, setSelectedKeeprProId] = useState(null);
  const [selectedKeeprProLabel, setSelectedKeeprProLabel] = useState("");

  // NEW: extra attachments (photos + files) to save AFTER record creation
  const [extraPhotoAttachments, setExtraPhotoAttachments] = useState([]); // { uri, mimeType, fileName }
  const [extraFileAttachments, setExtraFileAttachments] = useState([]); // { uri, mimeType, fileName }

  const handleBack = () => navigation.goBack();

  useEffect(() => {
    const loadSystems = async () => {
      if (!resolvedAssetId) return;

      setSystemsLoading(true);
      setSystemsError(null);

      const { data, error } = await supabase
        .from("systems")
        .select("id, name")
        .eq("asset_id", resolvedAssetId)
        .order("name", { ascending: true });

      if (error) {
        console.error("Error loading systems for asset", error);
        setSystemsError("Could not load systems for this asset.");
        setSystems([]);
      } else {
        setSystems(data || []);
      }

      setSystemsLoading(false);
    };

    loadSystems();
  }, [resolvedAssetId]);

  useEffect(() => {
    const loadKeeprPros = async () => {
      setKeeprProsLoading(true);
      setKeeprProsError(null);

      const { data, error } = await supabase
        .from("keepr_pros")
        .select(
          "id, name, location, category, website, since_label, last_service, is_favorite"
        )
        .order("name", { ascending: true });

      if (error) {
        console.error("Error loading Keepr Pros", error);
        setKeeprProsError("Could not load Keepr Pros.");
        setKeeprPros([]);
      } else {
        const mapped =
          data?.map((row) => ({
            id: row.id,
            label: buildKeeprProLabel(row),
          })) || [];
        setKeeprPros(mapped);
      }

      setKeeprProsLoading(false);
    };

    loadKeeprPros();
  }, []);

  const beginAddSystemInline = () => {
    setAddingSystem(true);
    setNewSystemName("");
  };

  const cancelAddSystemInline = () => {
    setAddingSystem(false);
    setNewSystemName("");
  };

  const handleSaveSystemInline = async () => {
    const name = newSystemName.trim();
    if (!name || !resolvedAssetId) return;

    setSavingSystem(true);

    try {
      const payload = {
        asset_id: resolvedAssetId,
        ksc_code: `CUSTOM-${Date.now()}`,
        name,
      };

      const { data, error } = await supabase
        .from("systems")
        .insert(payload)
        .select("id, name")
        .single();

      if (error) {
        console.error("Error adding system inline", error);
        Alert.alert(
          "Could not add system",
          "Please try again or add it from the Systems screen."
        );
      } else if (data) {
        setSystems((prev) =>
          [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
        );
        setSelectedSystemId(data.id);
        setAddingSystem(false);
        setNewSystemName("");
      }
    } catch (err) {
      console.error("Unexpected error adding system inline", err);
      Alert.alert("Could not add system", "Unexpected error occurred.");
    } finally {
      setSavingSystem(false);
    }
  };

  const handlePickInvoiceImage = async () => {
    try {
      setPickingInvoice(true);
      const safeUri = await pickAndNormalizeImageFromLibrary();
      if (safeUri) setInvoiceImage({ uri: safeUri });
    } catch (err) {
      console.error("Invoice picker error:", err);
      Alert.alert("Could not open photos", "Unexpected error occurred.");
    } finally {
      setPickingInvoice(false);
    }
  };

  const handleRemoveInvoiceImage = () => setInvoiceImage(null);

  /* ---------- NEW: extra attachments handlers ---------- */

  const handleAddExtraPhoto = async () => {
    try {
      const uri = await pickAndNormalizeImageFromLibrary();
      if (!uri) return;
      setExtraPhotoAttachments((prev) => [
        { uri, mimeType: "image/jpeg", fileName: "photo.jpg" },
        ...prev,
      ]);
    } catch (err) {
      console.error("Extra photo picker error:", err);
      Alert.alert("Could not open photos", "Unexpected error occurred.");
    }
  };

  const handleAddExtraFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({});
      if (result.type === "cancel") return;

      const { uri, mimeType, name } = result;
      if (!uri) return;

      setExtraFileAttachments((prev) => [
        {
          uri,
          mimeType: mimeType || "application/octet-stream",
          fileName: name || "Attachment",
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Extra file picker error:", err);
      Alert.alert("Could not open files", "Unexpected error occurred.");
    }
  };

  const removeExtraPhoto = (index) => {
    setExtraPhotoAttachments((prev) =>
      prev.filter((_, i) => i !== index)
    );
  };

  const removeExtraFile = (index) => {
    setExtraFileAttachments((prev) =>
      prev.filter((_, i) => i !== index)
    );
  };

  const handleSave = async () => {
    if (saving) return;

    setSaving(true);
    setSubmitError(null);

    if (!resolvedAssetId) {
      setSubmitError("No asset found for this record.");
      setSaving(false);
      return;
    }

    const performedAt = parseUSDateToISO(date);
    const costNumber = parseMoneyToNumber(cost);

    const selectedSystemName =
      selectedSystemId
        ? systems.find((s) => s.id === selectedSystemId)?.name || null
        : null;

    const effectiveLocation = provider || selectedKeeprProLabel || null;

    let createdRecord = null;

    try {
      // 1) Create the service record + story event
      createdRecord = await createServiceRecordWithStoryEvent({
        assetId: resolvedAssetId,
        serviceType,
        title: title || "Service record",
        location: effectiveLocation,
        performedAt, // YYYY-MM-DD
        cost: costNumber,
        notes: notes || null,

        systemId: selectedSystemId || null,
        systemName: selectedSystemName,
        keeprProId: selectedKeeprProId,
        keeprProName: selectedKeeprProLabel || null,
        assetName: contextLabel,
      });
    } catch (error) {
      console.error("Insert error:", error);
      setSubmitError(
        error?.message || "There was a problem saving the record."
      );
      setSaving(false);
      return;
    }

    // 2) Invoice hero photo (existing behavior)
    if (invoiceImage?.uri && createdRecord?.id) {
      try {
        await uploadInvoicePhotoForServiceRecord({
          assetId: resolvedAssetId,
          serviceRecordId: createdRecord.id,
          localUri: invoiceImage.uri,
          existingPhotoRow: null,
        });
      } catch (err) {
        console.error("Invoice upload error:", err);
        // Non-blocking
      }
    }

    // 3) NEW: upload extra photos + files as attachments
    if (createdRecord?.id) {
      const recordId = createdRecord.id;

      // best-effort; don’t block the core save on these
      try {
        for (const p of extraPhotoAttachments) {
          try {
            await addServiceRecordAttachment({
              assetId: resolvedAssetId,
              serviceRecordId: recordId,
              localUri: p.uri,
              mimeType: p.mimeType || "image/jpeg",
              fileName: p.fileName || "photo.jpg",
              // kind left null; TimelineRecord will treat these as regular photos
            });
          } catch (err) {
            console.error("Error uploading extra photo attachment:", err);
          }
        }

        for (const f of extraFileAttachments) {
          try {
            await addServiceRecordAttachment({
              assetId: resolvedAssetId,
              serviceRecordId: recordId,
              localUri: f.uri,
              mimeType: f.mimeType || "application/octet-stream",
              fileName: f.fileName || "Attachment",
            });
          } catch (err) {
            console.error("Error uploading extra file attachment:", err);
          }
        }
      } catch (err) {
        console.error("Unexpected attachments error:", err);
      }
    }

    setSaving(false);

    // 4) Navigate back
    if (source === "boat" && resolvedAssetId) {
      navigation.navigate("BoatStory", { boatId: resolvedAssetId });
    } else if (source === "vehicle" && resolvedAssetId) {
      navigation.navigate("VehicleStory", { vehicleId: resolvedAssetId });
    } else {
      if (navigation.canGoBack()) navigation.goBack();
    }
  };

  const subtitle =
    systemName && contextLabel ? `${systemName} · ${contextLabel}` : contextLabel;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={64}
      >
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.iconButton} onPress={handleBack}>
              <Ionicons name="chevron-back-outline" size={20} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add Timeline Record</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
          >
            <Text style={styles.sectionLabel}>Work details</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Service type</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[
                    styles.togglePill,
                    serviceType === "pro" && styles.togglePillActive,
                  ]}
                  onPress={() => setServiceType("pro")}
                >
                  <Ionicons
                    name={
                      serviceType === "pro" ? "briefcase" : "briefcase-outline"
                    }
                    size={14}
                    color={
                      serviceType === "pro"
                        ? colors.brandWhite
                        : colors.textMuted
                    }
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.togglePillText,
                      serviceType === "pro" && styles.togglePillTextActive,
                    ]}
                  >
                    Professional / Keepr Pro
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.togglePill,
                    serviceType === "diy" && styles.togglePillActive,
                  ]}
                  onPress={() => setServiceType("diy")}
                >
                  <Ionicons
                    name={
                      serviceType === "diy" ? "construct" : "construct-outline"
                    }
                    size={14}
                    color={
                      serviceType === "diy"
                        ? colors.brandWhite
                        : colors.textMuted
                    }
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.togglePillText,
                      serviceType === "diy" && styles.togglePillTextActive,
                    ]}
                  >
                    DIY / self-performed
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Service date</Text>
              <TextInput
                style={styles.input}
                placeholder="MM-DD-YYYY"
                value={date}
                onChangeText={setDate}
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Repair, winterization, upgrade..."
                value={title}
                onChangeText={setTitle}
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <Text style={styles.sectionLabel}>Who did the work</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                {serviceType === "diy" ? "Where did you work?" : "Provider"}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={
                  serviceType === "diy"
                    ? "Home garage, driveway..."
                    : "Shop, Keepr Pro..."
                }
                value={provider}
                onChangeText={setProvider}
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Keepr Pro (optional)</Text>
              {keeprProsLoading ? (
                <View style={styles.systemLoadingRow}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.systemLoadingText}>
                    Loading Keepr Pros…
                  </Text>
                </View>
              ) : keeprProsError ? (
                <Text style={styles.systemErrorText}>{keeprProsError}</Text>
              ) : keeprPros.length === 0 ? (
                <Text style={styles.systemHelperText}>
                  No Keepr Pros saved yet. You can add them from the Keepr Pros
                  screen and link them here later.
                </Text>
              ) : (
                <View style={styles.systemChipsRow}>
                  <TouchableOpacity
                    style={[
                      styles.systemChip,
                      !selectedKeeprProId && styles.systemChipActiveSoft,
                    ]}
                    onPress={() => {
                      setSelectedKeeprProId(null);
                      setSelectedKeeprProLabel("");
                    }}
                  >
                    <Text
                      style={[
                        styles.systemChipText,
                        !selectedKeeprProId &&
                          styles.systemChipTextActiveSoft,
                      ]}
                    >
                      Not linked
                    </Text>
                  </TouchableOpacity>

                  {keeprPros.map((pro) => {
                    const isActive = selectedKeeprProId === pro.id;
                    return (
                      <TouchableOpacity
                        key={pro.id}
                        style={[
                          styles.systemChip,
                          isActive && styles.systemChipActive,
                        ]}
                        onPress={() => {
                          if (isActive) {
                            setSelectedKeeprProId(null);
                            setSelectedKeeprProLabel("");
                          } else {
                            setSelectedKeeprProId(pro.id);
                            setSelectedKeeprProLabel(pro.label);
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.systemChipText,
                            isActive && styles.systemChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {pro.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            <Text style={styles.sectionLabel}>What it was for</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>System (optional)</Text>
              {systemsLoading ? (
                <View style={styles.systemLoadingRow}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.systemLoadingText}>
                    Loading systems…
                  </Text>
                </View>
              ) : systemsError ? (
                <Text style={styles.systemErrorText}>{systemsError}</Text>
              ) : systems.length === 0 ? (
                <Text style={styles.systemHelperText}>
                  No systems defined for this asset yet.
                </Text>
              ) : (
                <>
                  <Text style={styles.systemHelperText}>
                    Leave on “Whole asset” if this was general work.
                  </Text>

                  <View style={styles.systemChipsRow}>
                    <TouchableOpacity
                      style={[
                        styles.systemChip,
                        !selectedSystemId && styles.systemChipActiveSoft,
                      ]}
                      onPress={() => setSelectedSystemId(null)}
                    >
                      <Text
                        style={[
                          styles.systemChipText,
                          !selectedSystemId &&
                            styles.systemChipTextActiveSoft,
                        ]}
                      >
                        Whole asset
                      </Text>
                    </TouchableOpacity>

                    {systems.map((sys) => {
                      const isActive = selectedSystemId === sys.id;
                      return (
                        <TouchableOpacity
                          key={sys.id}
                          style={[
                            styles.systemChip,
                            isActive && styles.systemChipActive,
                          ]}
                          onPress={() =>
                            setSelectedSystemId(isActive ? null : sys.id)
                          }
                        >
                          <Text
                            style={[
                              styles.systemChipText,
                              isActive && styles.systemChipTextActive,
                            ]}
                          >
                            {sys.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {!addingSystem && (
                      <TouchableOpacity
                        style={[styles.systemChip, styles.systemAddChip]}
                        onPress={beginAddSystemInline}
                      >
                        <Ionicons
                          name="add"
                          size={14}
                          color={colors.accentBlue}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.systemAddChipText}>
                          Add system
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {addingSystem && (
                    <View style={styles.addSystemRow}>
                      <TextInput
                        style={styles.addSystemInput}
                        placeholder="New system name"
                        value={newSystemName}
                        onChangeText={setNewSystemName}
                        placeholderTextColor={colors.textMuted}
                      />
                      <TouchableOpacity
                        style={styles.addSystemCancel}
                        onPress={cancelAddSystemInline}
                        disabled={savingSystem}
                      >
                        <Text style={styles.addSystemCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.addSystemSave,
                          (!newSystemName.trim() || savingSystem) && {
                            opacity: 0.6,
                          },
                        ]}
                        onPress={handleSaveSystemInline}
                        disabled={!newSystemName.trim() || savingSystem}
                      >
                        {savingSystem ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.addSystemSaveText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>

            <Text style={styles.sectionLabel}>Cost & notes</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="$250.00"
                value={cost}
                onChangeText={setCost}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                multiline
                numberOfLines={4}
                value={notes}
                onChangeText={setNotes}
                textAlignVertical="top"
                placeholder="Details, parts used, recommendations..."
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <Text style={styles.sectionLabel}>Attachments</Text>

            {/* Invoice hero (existing) */}
            <View style={[styles.fieldGroup, { marginTop: spacing.sm }]}>
              <View style={styles.invoiceHeaderRow}>
                <Text style={styles.label}>Invoice or photo (optional)</Text>
                {invoiceImage && (
                  <TouchableOpacity onPress={handleRemoveInvoiceImage}>
                    <Text style={styles.clearLink}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.invoicePicker}
                onPress={handlePickInvoiceImage}
              >
                {pickingInvoice ? (
                  <View style={styles.invoiceLoadingRow}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.invoiceLoadingText}>
                      Opening photos…
                    </Text>
                  </View>
                ) : invoiceImage ? (
                  <View style={styles.invoicePreviewRow}>
                    <Image
                      source={{ uri: invoiceImage.uri }}
                      style={styles.invoicePreviewImage}
                    />
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={styles.invoicePreviewTitle}>
                        Invoice attached
                      </Text>
                      <Text style={styles.invoicePreviewText}>
                        This photo will be stored with this service record.
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.invoiceEmptyRow}>
                    <Ionicons
                      name="document-attach-outline"
                      size={18}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.invoiceEmptyText}>
                      Add a photo of the invoice, work order, or the work done.
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* NEW: more photos + files */}
            <View style={styles.fieldGroup}>
              <View style={styles.attachHeaderRow}>
                <Text style={styles.label}>More photos & files (optional)</Text>
                <View style={styles.attachActionsRow}>
                  <TouchableOpacity
                    style={styles.attachBtn}
                    onPress={handleAddExtraPhoto}
                  >
                    <Ionicons
                      name="image-outline"
                      size={14}
                      color={colors.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.attachBtnText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.attachBtn}
                    onPress={handleAddExtraFile}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={14}
                      color={colors.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.attachBtnText}>File</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {(extraPhotoAttachments.length > 0 ||
                extraFileAttachments.length > 0) && (
                <View style={styles.attachPreviewCard}>
                  {extraPhotoAttachments.length > 0 && (
                    <View style={styles.attachThumbRow}>
                      {extraPhotoAttachments.map((p, index) => (
                        <View key={index} style={styles.attachThumb}>
                          <Image
                            source={{ uri: p.uri }}
                            style={styles.attachThumbImg}
                          />
                          <TouchableOpacity
                            style={styles.thumbRemove}
                            onPress={() => removeExtraPhoto(index)}
                          >
                            <Ionicons
                              name="close"
                              size={14}
                              color="#fff"
                            />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {extraFileAttachments.length > 0 && (
                    <View style={styles.attachFileRow}>
                      {extraFileAttachments.map((f, index) => (
                        <View key={index} style={styles.attachFileChip}>
                          <Ionicons
                            name="document-outline"
                            size={13}
                            color={colors.textSecondary}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={styles.attachFileText}
                            numberOfLines={1}
                          >
                            {f.fileName || "Attachment"}
                          </Text>
                          <TouchableOpacity
                            onPress={() => removeExtraFile(index)}
                          >
                            <Ionicons
                              name="close"
                              size={12}
                              color={colors.textSecondary}
                            />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {submitError && (
              <Text style={styles.errorText}>{submitError}</Text>
            )}

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={saving}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={18}
                color="#FFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.saveButtonText}>
                {saving ? "Saving…" : "Save record"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* =======================================================
   Styles
   ======================================================= */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  title: typography.title,
  subtitle: { ...typography.subtitle, marginTop: 2 },

  sectionLabel: {
    ...typography.sectionLabel,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },

  fieldGroup: { marginBottom: spacing.md },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    fontSize: 13,
    color: colors.textPrimary,
  },
  multiline: {
    minHeight: 100,
  },
  errorText: {
    color: colors.accentRed,
    fontSize: 13,
    marginBottom: spacing.sm,
  },

  toggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  togglePillActive: {
    backgroundColor: colors.accentBlue,
    borderColor: colors.accentBlue,
  },
  togglePillText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  togglePillTextActive: {
    color: colors.brandWhite,
  },

  systemLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  systemLoadingText: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },
  systemErrorText: {
    fontSize: 12,
    color: colors.accentRed,
  },
  systemHelperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  systemChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  systemChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.chipBackground,
  },
  systemChipActiveSoft: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.accentBlue,
  },
  systemChipActive: {
    backgroundColor: colors.accentBlue,
    borderColor: colors.accentBlue,
  },
  systemChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  systemChipTextActiveSoft: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  systemChipTextActive: {
    color: colors.brandWhite,
  },
  systemAddChip: {
    borderStyle: "dashed",
    borderColor: colors.accentBlue,
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
  },
  systemAddChipText: {
    fontSize: 12,
    color: colors.accentBlue,
    fontWeight: "500",
  },
  addSystemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  addSystemInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    fontSize: 12,
  },
  addSystemCancel: {
    marginLeft: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addSystemCancelText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  addSystemSave: {
    marginLeft: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.accentBlue,
  },
  addSystemSaveText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },

  invoiceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  invoicePicker: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
  },
  invoiceEmptyRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  invoiceEmptyText: {
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: 12,
  },
  invoicePreviewRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  invoicePreviewImage: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
  },
  invoicePreviewTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  invoicePreviewText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  invoiceLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  invoiceLoadingText: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },

  // NEW: attachments preview
  attachHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  attachActionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  attachBtnText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  attachPreviewCard: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
  },
  attachThumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  attachThumb: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.surface,
  },
  attachThumbImg: {
    width: "100%",
    height: "100%",
  },
  thumbRemove: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachFileRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  attachFileChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  attachFileText: {
    fontSize: 11,
    color: colors.textSecondary,
    maxWidth: 140,
    marginRight: 4,
  },

  saveButton: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentBlue,
    paddingVertical: spacing.md,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
  },
  saveButtonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 14,
  },

  clearLink: {
    fontSize: 12,
    color: colors.accentBlue,
  },
});
