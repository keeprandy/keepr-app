// screens/EditServiceRecordScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Linking,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";

import { supabase } from "../lib/supabaseClient";
import { uploadLocalImageToSupabase } from "../lib/imageUpload";
import { deleteServiceRecordAttachment } from "../lib/attachmentsEngine";

import AttachmentsStrip from "../components/AttachmentsStrip";

/* ----------------- helpers ----------------- */

function usDateToIso(value) {
  if (!value) return null;
  const parts = String(value).trim().split("/");
  if (parts.length !== 3) return null;

  const mm = parts[0]?.trim();
  const dd = parts[1]?.trim();
  const yyyy = parts[2]?.trim();

  if (!mm || !dd || !yyyy) return null;

  const m = Number(mm);
  const d = Number(dd);
  const y = Number(yyyy);

  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y))
    return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;

  // Basic sanity, not full calendar validation (good enough for UI).
  return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(
    2,
    "0"
  )}`;
}

function isoDateToUS(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return "";
  }
}

function safeNumberOrNull(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(n)) return null;
  return n;
}

function sanitizeName(name) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

async function uploadFileToBucket({
  bucket,
  storagePath,
  localUri,
  contentType,
}) {
  // Works on mobile + web in Expo: fetch(file://) -> blob
  const resp = await fetch(localUri);
  const blob = await resp.blob();

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, blob, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) throw uploadErr;

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) throw new Error("Failed to get public URL after upload.");

  return { storagePath, publicUrl };
}

/* ----------------- screen ----------------- */

const BUCKET = "asset-files"; // use the bucket you already rely on (invoice uses this)
const FOOTER_HEIGHT_EST = 74;

export default function EditServiceRecordScreen({ navigation, route }) {
  const {
    serviceRecordId,
    source, // "boat" | "vehicle" | "home" | "homeSystem" | "timeline"
    assetId: initialAssetId,
    assetName,
  } = route?.params || {};

  const [assetId, setAssetId] = useState(initialAssetId || null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // core fields
  const [serviceType, setServiceType] = useState("pro");
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [selectedKeeprProId, setSelectedKeeprProId] = useState(null);
  const [selectedKeeprProLabel, setSelectedKeeprProLabel] = useState("");

  // Invoice photo
  const [invoiceImage, setInvoiceImage] = useState(null); // { uri }
  const [existingInvoice, setExistingInvoice] = useState(null); // row from service_record_photos
  const [invoiceChanged, setInvoiceChanged] = useState(false);

  // Extra attachments
  const [photoAttachments, setPhotoAttachments] = useState([]);
  const [fileAttachments, setFileAttachments] = useState([]);

  // modals / ui
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [systems, setSystems] = useState([]);
  const [keeprPros, setKeeprPros] = useState([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [proLoading, setProLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [previewImageUri, setPreviewImageUri] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  const extraAttachmentsForStrip = useMemo(() => {
    const out = [];

    for (const p of photoAttachments || []) {
      const url = p.url || p.public_url;
      if (!url) continue;
      out.push({
        id: p.id || p.storage_path || url,
        url,
        kind: "photo",
        fileName: "Photo",
      });
    }

    for (const f of fileAttachments || []) {
      const url = f.url || f.public_url;
      if (!url) continue;
      out.push({
        id: f.id || f.storage_path || url,
        url,
        kind: "file",
        fileName: f.file_name || "Attachment",
      });
    }

    return out;
  }, [photoAttachments, fileAttachments]);

  /* ------------------------------------------
   * Load
   * ---------------------------------------- */

  useEffect(() => {
    let isActive = true;

    async function load() {
      if (!serviceRecordId) {
        Alert.alert("Missing record", "We couldn’t find this record.");
        navigation.goBack();
        return;
      }

      try {
        setLoadingInitial(true);

        const { data: record, error: recordErr } = await supabase
          .from("service_records")
          .select(
            "id, asset_id, title, notes, service_type, performed_at, location, cost, system_id, keepr_pro_id"
          )
          .eq("id", serviceRecordId)
          .single();

        if (recordErr) {
          console.error("Failed to load service record:", recordErr);
          Alert.alert(
            "Error",
            "We couldn’t load this record. Please try again later."
          );
          navigation.goBack();
          return;
        }

        if (!isActive) return;

        setAssetId(record.asset_id);
        setServiceType(record.service_type === "diy" ? "diy" : "pro");
        setDate(isoDateToUS(record.performed_at));
        setTitle(record.title || "");
        setProvider(record.location || "");
        setCost(record.cost != null ? String(record.cost) : "");
        setLocation(record.location || "");
        setNotes(record.notes || "");
        setSelectedSystemId(record.system_id || null);
        setSelectedKeeprProId(record.keepr_pro_id || null);

        // invoice
        const { data: inv, error: invErr } = await supabase
          .from("service_record_photos")
          .select("*")
          .eq("service_record_id", serviceRecordId)
          .eq("kind", "invoice")
          .limit(1);

        if (!invErr && inv?.[0]) {
          const row = inv[0];
          setExistingInvoice(row);
          const url = row.url || row.public_url;
          if (url) setInvoiceImage({ uri: url });
        }

        // extra photos
        const { data: extraPhotos } = await supabase
          .from("service_record_photos")
          .select("*")
          .eq("service_record_id", serviceRecordId)
          .neq("kind", "invoice");

        setPhotoAttachments(
          (extraPhotos || [])
            .map((p) => ({ ...p, url: p.url || p.public_url, __type: "photo" }))
            .filter((p) => p.url)
        );

        // files
        const { data: docs } = await supabase
          .from("service_record_documents")
          .select("*")
          .eq("service_record_id", serviceRecordId);

        setFileAttachments(
          (docs || [])
            .map((d) => ({ ...d, url: d.url || d.public_url, __type: "file" }))
            .filter((d) => d.url)
        );

        // systems
        if (record.asset_id) {
          setSystemsLoading(true);
          try {
            const { data: sysRows, error: sysErr } = await supabase
              .from("systems")
              .select("id, name, system_type")
              .eq("asset_id", record.asset_id)
              .order("name", { ascending: true });
            if (!sysErr && sysRows) setSystems(sysRows);
          } finally {
            if (isActive) setSystemsLoading(false);
          }
        }

        // pros
        setProLoading(true);
        try {
          const { data: proRows, error: proErr } = await supabase
            .from("keepr_pros")
            .select("id, name, location")
            .order("name", { ascending: true });

          if (!proErr && proRows) {
            setKeeprPros(proRows);
            if (record.keepr_pro_id) {
              const match = proRows.find((p) => p.id === record.keepr_pro_id);
              if (match) {
                setSelectedKeeprProLabel(
                  match.location
                    ? `${match.name} · ${match.location}`
                    : match.name
                );
              }
            }
          }
        } finally {
          if (isActive) setProLoading(false);
        }
      } catch (err) {
        console.error("Unexpected load error:", err);
        Alert.alert("Error", "Something went wrong loading this record.");
      } finally {
        if (isActive) setLoadingInitial(false);
      }
    }

    load();
    return () => {
      isActive = false;
    };
  }, [serviceRecordId, navigation]);

  /* ------------------------------------------
   * Invoice
   * ---------------------------------------- */

  const pickInvoiceImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType.Images,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setInvoiceImage({ uri: asset.uri });
    setInvoiceChanged(true);
  };

  const clearInvoiceImage = () => {
    setInvoiceImage(null);
    setInvoiceChanged(true);
  };

  const openInvoicePreview = () => {
    if (!invoiceImage?.uri) return;
    setPreviewImageUri(invoiceImage.uri);
    setPreviewVisible(true);
  };

  /* ------------------------------------------
   * Extra attachments: upload
   * ---------------------------------------- */

  const pickExtraPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType.Images,
      quality: 0.85,
    });
    if (result.canceled) return;

    const picked = result.assets[0];
    if (!assetId) {
      Alert.alert("Missing asset", "This record isn’t linked to an asset.");
      return;
    }

    try {
      const ext = "jpg";
      const fileName = `photo_${Date.now()}.${ext}`;
      const storagePath = `${assetId}/service_records/${serviceRecordId}/photos/${fileName}`;

      const { publicUrl } = await uploadFileToBucket({
        bucket: BUCKET,
        storagePath,
        localUri: picked.uri,
        contentType: "image/jpeg",
      });

      const { data: row, error } = await supabase
        .from("service_record_photos")
        .insert({
          service_record_id: serviceRecordId,
          storage_path: storagePath,
          url: publicUrl,
          kind: "photo",
        })
        .select("*")
        .single();

      if (error) throw error;

      setPhotoAttachments((prev) => [
        { ...row, url: row.url || row.public_url, __type: "photo" },
        ...prev,
      ]);
    } catch (err) {
      console.error("Failed to add extra photo:", err);
      Alert.alert(
        "Upload failed",
        err?.message || "We couldn’t add this photo. Please try again."
      );
    }
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const file = result.assets?.[0];
    if (!file) return;

    if (!assetId) {
      Alert.alert("Missing asset", "This record isn’t linked to an asset.");
      return;
    }

    try {
      const safe = sanitizeName(file.name || `file_${Date.now()}`);
      const storagePath = `${assetId}/service_records/${serviceRecordId}/files/${Date.now()}_${safe}`;

      const { publicUrl } = await uploadFileToBucket({
        bucket: BUCKET,
        storagePath,
        localUri: file.uri,
        contentType: file.mimeType || "application/octet-stream",
      });

      const { data: row, error } = await supabase
        .from("service_record_documents")
        .insert({
          service_record_id: serviceRecordId,
          storage_path: storagePath,
          url: publicUrl,
          file_name: file.name || safe,
        })
        .select("*")
        .single();

      if (error) throw error;

      setFileAttachments((prev) => [
        { ...row, url: row.url || row.public_url, __type: "file" },
        ...prev,
      ]);
    } catch (err) {
      console.error("Failed to add file attachment:", err);
      Alert.alert(
        "Upload failed",
        err?.message || "We couldn’t add this file. Please try again."
      );
    }
  };

  const handleDeleteAttachment = async (attachment) => {
    try {
      await deleteServiceRecordAttachment(attachment);
      if (attachment.__type === "photo") {
        setPhotoAttachments((prev) =>
          prev.filter((p) => p.id !== attachment.id)
        );
      } else {
        setFileAttachments((prev) =>
          prev.filter((f) => f.id !== attachment.id)
        );
      }
    } catch (err) {
      console.error("Failed to delete attachment:", err);
      Alert.alert("Delete failed", err?.message || "Couldn’t delete.");
    }
  };

  const openAttachment = (attachment) => {
    const url = attachment?.url || attachment?.public_url;
    if (!url) return;
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(url);
    }
  };

  /* ------------------------------------------
   * System & provider
   * ---------------------------------------- */

  const selectedSystem =
    selectedSystemId && systems.find((s) => s.id === selectedSystemId);

  const handleSelectSystem = (sysId) => {
    setSelectedSystemId(sysId === selectedSystemId ? null : sysId);
  };

  const handleSelectKeeprPro = (pro) => {
    if (!pro) {
      setSelectedKeeprProId(null);
      setSelectedKeeprProLabel("");
      return;
    }
    setSelectedKeeprProId(pro.id);
    setSelectedKeeprProLabel(
      pro.location ? `${pro.name} · ${pro.location}` : pro.name
    );
  };

  /* ------------------------------------------
   * Save
   * ---------------------------------------- */

  const handleSave = async () => {
    Keyboard.dismiss();
    if (saving || deleting) return;

    try {
      setSaving(true);
      setSubmitError(null);

      const dateIso = usDateToIso(date);
      if (!dateIso) {
        Alert.alert("Invalid date", "Please use MM/DD/YYYY.");
        return;
      }

      const payload = {
        title: title?.trim() || null,
        notes: notes?.trim() || null,
        service_type: serviceType,
        performed_at: dateIso,
        location: provider?.trim() || location?.trim() || null,
        cost: safeNumberOrNull(cost),
        system_id: selectedSystemId || null,
        keepr_pro_id: selectedKeeprProId || null,
      };

      const { data: updated, error: updateErr } = await supabase
        .from("service_records")
        .update(payload)
        .eq("id", serviceRecordId)
        .select("id, asset_id")
        .single();

      if (updateErr) {
        console.error("Update error:", updateErr);
        setSubmitError(updateErr.message || "Failed to save this record.");
        return;
      }

      // Invoice handling
      if (invoiceChanged) {
        if (existingInvoice?.id) {
          await supabase
            .from("service_record_photos")
            .delete()
            .eq("id", existingInvoice.id);
        }

        if (invoiceImage?.uri) {
          const uploaded = await uploadLocalImageToSupabase({
            bucket: BUCKET,
            assetId: `${
              assetId || updated.asset_id
            }/service_records/${serviceRecordId}`,
            localUri: invoiceImage.uri,
            folderPrefix: "images",
          });

          if (uploaded?.publicUrl) {
            await supabase.from("service_record_photos").insert({
              service_record_id: serviceRecordId,
              storage_path: uploaded.storagePath,
              url: uploaded.publicUrl,
              kind: "invoice",
            });
          }
        }
      }

      const finalAssetId = assetId || updated.asset_id;

      // NEW: if we came from the timeline record screen, just go back to it
      if (source === "timeline") {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate("TimelineRecord", { serviceRecordId });
        }
        return;
      }

      // Existing behavior for other sources
      if (source === "boat" && finalAssetId) {
        navigation.navigate("BoatStory", { boatId: finalAssetId });
      } else if (source === "vehicle" && finalAssetId) {
        navigation.navigate("VehicleStory", { vehicleId: finalAssetId });
      } else if (
        (source === "home" || source === "homeSystem") &&
        finalAssetId
      ) {
        navigation.navigate("HomeStory", { homeId: finalAssetId });
      } else if (navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch (error) {
      console.error("Unexpected save error:", error);
      setSubmitError(error?.message || "There was a problem saving the record.");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------
   * Delete record
   * ---------------------------------------- */

  const handleDeleteRecord = () => {
    if (saving || deleting) return;

    Alert.alert(
      "Delete this record?",
      "This will remove it from the story timeline and delete its attachments.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeleting(true);
              const { error } = await supabase
                .from("service_records")
                .delete()
                .eq("id", serviceRecordId);
              if (error) throw error;

              const finalAssetId = assetId;

              // NEW: if we were editing from the timeline, go back up the stack
              if (source === "timeline") {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate("Dashboard");
                }
                return;
              }

              if (source === "boat" && finalAssetId) {
                navigation.navigate("BoatStory", { boatId: finalAssetId });
              } else if (source === "vehicle" && finalAssetId) {
                navigation.navigate("VehicleStory", {
                  vehicleId: finalAssetId,
                });
              } else if (
                (source === "home" || source === "homeSystem") &&
                finalAssetId
              ) {
                navigation.navigate("HomeStory", { homeId: finalAssetId });
              } else if (navigation.canGoBack()) {
                navigation.goBack();
              }
            } catch (err) {
              console.error("Failed to delete service record:", err);
              Alert.alert(
                "Delete failed",
                "We couldn’t delete this record. Please try again."
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  /* ------------------------------------------
   * Render
   * ---------------------------------------- */

  const contextLabel = assetName || "Timeline record";

  if (loadingInitial) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.loadingText}>Loading record…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[layoutStyles.screenInner, styles.screenInnerFix]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Enrich timeline record</Text>
              <Text style={styles.headerSubtitle}>{contextLabel}</Text>
            </View>

            <TouchableOpacity
              onPress={handleDeleteRecord}
              style={styles.deleteChip}
              disabled={saving || deleting}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.deleteChipText}>Delete</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Type & date */}
            <View style={styles.card}>
              <View style={styles.typeRow}>
                <Text style={styles.cardTitle}>What kind of moment?</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      serviceType === "pro" && styles.chipSelected,
                    ]}
                    onPress={() => setServiceType("pro")}
                  >
                    <Ionicons
                      name="briefcase-outline"
                      size={14}
                      color={
                        serviceType === "pro"
                          ? colors.white
                          : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.chipText,
                        serviceType === "pro" && styles.chipTextSelected,
                      ]}
                    >
                      Pro
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      serviceType === "diy" && styles.chipSelectedAlt,
                    ]}
                    onPress={() => setServiceType("diy")}
                  >
                    <Ionicons
                      name="hammer-outline"
                      size={14}
                      color={
                        serviceType === "diy"
                          ? colors.brandBlue
                          : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.chipText,
                        serviceType === "diy" && styles.chipTextAltSelected,
                      ]}
                    >
                      DIY
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroupInline}>
                <View style={[styles.fieldGroup, { flex: 1.4 }]}>
                  <Text style={styles.fieldLabel}>Title</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="What happened?"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <TextInput
                    value={date}
                    onChangeText={setDate}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
            </View>

            {/* System + provider */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Where does this belong?</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>System</Text>
                <TouchableOpacity
                  style={styles.selector}
                  onPress={() => setShowSystemModal(true)}
                >
                  <Text
                    style={
                      selectedSystem
                        ? styles.selectorText
                        : styles.selectorPlaceholder
                    }
                  >
                    {selectedSystem
                      ? selectedSystem.name
                      : systemsLoading
                      ? "Loading systems…"
                      : "Choose a system (optional)"}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Who did the work / where?</Text>
                <TouchableOpacity
                  style={styles.selector}
                  onPress={() => setShowProviderModal(true)}
                >
                  <Text
                    style={
                      selectedKeeprProId
                        ? styles.selectorText
                        : styles.selectorPlaceholder
                    }
                  >
                    {selectedKeeprProId
                      ? selectedKeeprProLabel || "Linked provider"
                      : proLoading
                      ? "Loading providers…"
                      : "Select a provider or type name"}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.fieldGroupInline}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Cost</Text>
                  <TextInput
                    value={cost}
                    onChangeText={setCost}
                    placeholder="$0.00"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={[styles.fieldGroup, { flex: 1.2 }]}>
                  <Text style={styles.fieldLabel}>Location</Text>
                  <TextInput
                    value={location}
                    onChangeText={setLocation}
                    placeholder="Shop / address / notes"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
              </View>
            </View>

            {/* Notes */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>What actually happened?</Text>
              <Text style={styles.cardSubtitle}>
                This is the story someone will read later – future you, a buyer,
                or a service pro.
              </Text>

              <View style={styles.fieldGroup}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Tell the story of this moment…"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.notesInput]}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Attachments */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Attachments</Text>
              <Text style={styles.cardSubtitle}>
                Photos, invoices, and documents that prove what happened.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Invoice photo</Text>
                <View style={styles.invoiceRow}>
                  {invoiceImage?.uri ? (
                    <>
                      <TouchableOpacity
                        onPress={openInvoicePreview}
                        style={styles.invoicePreviewWrap}
                      >
                        <Image
                          source={{ uri: invoiceImage.uri }}
                          style={styles.invoicePreview}
                          resizeMode="cover"
                        />
                        <View style={styles.invoiceOverlay}>
                          <Ionicons
                            name="receipt-outline"
                            size={18}
                            color={colors.white}
                          />
                          <Text style={styles.invoiceOverlayText}>Invoice</Text>
                        </View>
                      </TouchableOpacity>
                      <View style={{ justifyContent: "space-between" }}>
                        <TouchableOpacity onPress={pickInvoiceImage}>
                          <Text style={styles.changeLink}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={clearInvoiceImage}>
                          <Text style={styles.clearLink}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <TouchableOpacity
                      onPress={pickInvoiceImage}
                      style={styles.invoicePlaceholder}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={20}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.invoicePlaceholderText}>
                        Add invoice photo
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>More photos & files</Text>

                <View style={styles.attachActionsRow}>
                  <TouchableOpacity
                    style={styles.attachAction}
                    onPress={pickExtraPhoto}
                  >
                    <Ionicons
                      name="image-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.attachActionText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.attachAction} onPress={pickFile}>
                    <Ionicons
                      name="document-text-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.attachActionText}>File</Text>
                  </TouchableOpacity>
                </View>

                <AttachmentsStrip
                  attachments={extraAttachmentsForStrip}
                  onOpenAttachment={openAttachment}
                  showHero={false}
                />

                {photoAttachments.length > 0 || fileAttachments.length > 0 ? (
                  <View style={styles.attachList}>
                    {photoAttachments.map((p) => (
                      <View key={`p-${p.id}`} style={styles.attachRow}>
                        <TouchableOpacity
                          style={styles.attachThumb}
                          onPress={() => openAttachment(p)}
                        >
                          {p.url ? (
                            <Image
                              source={{ uri: p.url }}
                              style={styles.attachThumbImg}
                              resizeMode="cover"
                            />
                          ) : null}
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.attachLabel}>Photo</Text>
                          <Text style={styles.attachMeta}>Tap to open</Text>
                        </View>
                        <TouchableOpacity onPress={() => handleDeleteAttachment(p)}>
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={colors.danger}
                          />
                        </TouchableOpacity>
                      </View>
                    ))}

                    {fileAttachments.map((f) => (
                      <View key={`f-${f.id}`} style={styles.attachRow}>
                        <View style={styles.fileBadge}>
                          <Ionicons
                            name="document-outline"
                            size={16}
                            color={colors.textPrimary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.attachLabel} numberOfLines={1}>
                            {f.file_name || "Attachment"}
                          </Text>
                          <Text style={styles.attachMeta}>Tap to open</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => openAttachment(f)}
                          style={{ marginRight: spacing.sm }}
                        >
                          <Ionicons
                            name="open-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteAttachment(f)}>
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={colors.danger}
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.attachEmptyText}>
                    No extra photos or files yet.
                  </Text>
                )}
              </View>
            </View>

            {submitError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{submitError}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerSecondary]}
              onPress={() => navigation.goBack()}
              disabled={saving || deleting}
            >
              <Text style={styles.footerSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.footerBtn,
                styles.footerPrimary,
                (saving || deleting) && { opacity: 0.7 },
              ]}
              onPress={handleSave}
              disabled={saving || deleting}
            >
              {saving ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Ionicons
                    name="sparkles-outline"
                    size={16}
                    color={colors.white}
                    style={{ marginRight: spacing.xs }}
                  />
                  <Text style={styles.footerPrimaryText}>Save changes</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* System modal */}
      <Modal
        visible={showSystemModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSystemModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a system</Text>
              <TouchableOpacity
                onPress={() => setShowSystemModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {systems.length === 0 ? (
                <Text style={styles.modalEmptyText}>
                  No systems yet for this asset.
                </Text>
              ) : (
                systems.map((sys) => (
                  <TouchableOpacity
                    key={sys.id}
                    style={[
                      styles.modalOption,
                      selectedSystemId === sys.id && styles.modalOptionSelected,
                    ]}
                    onPress={() => handleSelectSystem(sys.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalOptionLabel}>{sys.name}</Text>
                      {sys.system_type ? (
                        <Text style={styles.modalOptionMeta}>
                          {sys.system_type}
                        </Text>
                      ) : null}
                    </View>
                    {selectedSystemId === sys.id && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={colors.brandBlue}
                      />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalSecondaryBtn]}
                onPress={() => setShowSystemModal(false)}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setShowSystemModal(false)}
              >
                <Text style={styles.modalPrimaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Provider modal */}
      <Modal
        visible={showProviderModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowProviderModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link a provider</Text>
              <TouchableOpacity
                onPress={() => setShowProviderModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {keeprPros.length === 0 ? (
                <Text style={styles.modalEmptyText}>
                  No Keepr Pros yet. You can still type the provider name in the
                  main form.
                </Text>
              ) : (
                keeprPros.map((pro) => (
                  <TouchableOpacity
                    key={pro.id}
                    style={[
                      styles.modalOption,
                      selectedKeeprProId === pro.id &&
                        styles.modalOptionSelected,
                    ]}
                    onPress={() => handleSelectKeeprPro(pro)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalOptionLabel}>{pro.name}</Text>
                      {pro.location ? (
                        <Text style={styles.modalOptionMeta}>{pro.location}</Text>
                      ) : null}
                    </View>
                    {selectedKeeprProId === pro.id && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={colors.brandBlue}
                      />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalSecondaryBtn]}
                onPress={() => {
                  handleSelectKeeprPro(null);
                  setShowProviderModal(false);
                }}
              >
                <Text style={styles.modalSecondaryText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setShowProviderModal(false)}
              >
                <Text style={styles.modalPrimaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Invoice preview */}
      <Modal
        visible={previewVisible && !!previewImageUri}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewBackdrop}>
          <TouchableOpacity
            style={styles.previewCloseHitbox}
            onPress={() => setPreviewVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.previewImageWrap}>
            {previewImageUri ? (
              <Image
                source={{ uri: previewImageUri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.previewCloseButton}
            onPress={() => setPreviewVisible(false)}
          >
            <Ionicons name="close" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ----------------- styles ----------------- */

const styles = StyleSheet.create({
  screenInnerFix: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    paddingTop: 0,
    flexGrow: 1,
    paddingBottom: spacing.xxl + FOOTER_HEIGHT_EST,
  },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.textMuted },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },

  deleteChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  deleteChipText: {
    marginLeft: 4,
    fontSize: 12,
    color: colors.danger,
    fontWeight: "500",
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  chipRow: { flexDirection: "row", gap: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  chipSelected: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipSelectedAlt: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  chipText: { fontSize: 12, marginLeft: 4, color: colors.textSecondary },
  chipTextSelected: { color: colors.white },
  chipTextAltSelected: { color: colors.brandBlue },

  fieldGroupInline: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  fieldGroup: { marginTop: spacing.md },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  notesInput: { minHeight: 100 },

  selector: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorText: { fontSize: 14, color: colors.textPrimary },
  selectorPlaceholder: { fontSize: 14, color: colors.textMuted },

  invoiceRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  invoicePreviewWrap: {
    width: 120,
    height: 80,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginRight: spacing.md,
    backgroundColor: colors.surfaceSubtle,
  },
  invoicePreview: { width: "100%", height: "100%" },
  invoiceOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(15,23,42,0.7)",
    flexDirection: "row",
    alignItems: "center",
  },
  invoiceOverlayText: { marginLeft: 4, fontSize: 11, color: colors.white, fontWeight: "500" },
  invoicePlaceholder: {
    width: 120,
    height: 80,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    backgroundColor: colors.surfaceSubtle,
  },
  invoicePlaceholderText: { marginTop: 4, fontSize: 11, color: colors.textSecondary },
  changeLink: { fontSize: 12, color: colors.brandBlue, fontWeight: "500", marginBottom: 4 },
  clearLink: { fontSize: 12, color: colors.danger, fontWeight: "500" },

  attachActionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  attachAction: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  attachActionText: { marginLeft: 6, fontSize: 13, color: colors.textPrimary },

  attachList: { marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  attachThumb: { width: 44, height: 44, borderRadius: radius.lg, marginRight: spacing.sm, overflow: "hidden", backgroundColor: colors.surfaceSubtle },
  attachThumbImg: { width: "100%", height: "100%" },
  attachLabel: { fontSize: 13, fontWeight: "500", color: colors.textPrimary },
  attachMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  fileBadge: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.surfaceSubtle, alignItems: "center", justifyContent: "center", marginRight: spacing.sm },
  attachEmptyText: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },

  errorBox: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.dangerSoft },
  errorText: { fontSize: 13, color: colors.dangerDark },

  footer: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.appBackground },
  footerBtn: { flex: 1, borderRadius: radius.lg, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center" },
  footerSecondary: { marginRight: spacing.sm, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceSubtle },
  footerSecondaryText: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  footerPrimary: { marginLeft: spacing.sm, backgroundColor: colors.brandBlue },
  footerPrimaryText: { fontSize: 14, color: colors.white, fontWeight: "600" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  modalContainer: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "75%" },
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, flex: 1 },
  modalCloseBtn: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  modalEmptyText: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
  modalOption: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  modalOptionSelected: { backgroundColor: colors.surfaceSubtle },
  modalOptionLabel: { fontSize: 14, color: colors.textPrimary },
  modalOptionMeta: { fontSize: 11, color: colors.textMuted },
  modalFooter: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.md, gap: spacing.sm },
  modalButton: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.brandBlue },
  modalPrimaryText: { fontSize: 13, fontWeight: "600", color: colors.white },
  modalSecondaryBtn: { borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceSubtle },
  modalSecondaryText: { fontSize: 13, fontWeight: "500", color: colors.textPrimary },

  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", alignItems: "center" },
  previewCloseHitbox: { ...StyleSheet.absoluteFillObject },
  previewImageWrap: { width: "90%", height: "70%" },
  previewImage: { width: "100%", height: "100%" },
  previewCloseButton: { position: "absolute", top: spacing.xl, right: spacing.xl, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(15,23,42,0.7)", alignItems: "center", justifyContent: "center" },
});
