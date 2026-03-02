// screens/ScanInvoiceScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { useAssets } from "../hooks/useAssets";
import { supabase } from "../lib/supabaseClient";

import {
  uploadInvoiceFileAsync,
  analyzeInvoiceAtUrlAsync,
} from "../lib/invoiceEngineClient";

export default function ScanInvoiceScreen({ navigation, route }) {
  const { assets = [] } = useAssets(); // all asset types
  const [selectedAssetId, setSelectedAssetId] = useState(
    route?.params?.assetId || null
  );

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const [filePreview, setFilePreview] = useState(null);
  const [parsed, setParsed] = useState(null);

  const [saving, setSaving] = useState(false);

  const handlePickInvoice = async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Permission required to pick an invoice image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      setError("Could not read selected file.");
      return;
    }

    setFilePreview(asset.uri);

    try {
      setUploading(true);
      const { publicUrl } = await uploadInvoiceFileAsync(
        asset.uri,
        "demo-user"
      );

      setUploading(false);
      setAnalyzing(true);
      const parsedInvoice = await analyzeInvoiceAtUrlAsync({
        fileUrl: publicUrl,
        userId: "demo-user",
      });
      setParsed(parsedInvoice);
      setAnalyzing(false);

      // Try to auto-select an asset based on hint
      if (parsedInvoice?.asset_hint?.name && assets.length > 0) {
        const match = assets.find((a) =>
          (a.name || "").toLowerCase().includes(
            parsedInvoice.asset_hint.name.toLowerCase()
          )
        );
        if (match) {
          setSelectedAssetId(match.id);
        }
      }
    } catch (e) {
      console.error("Error analyzing invoice", e);
      setUploading(false);
      setAnalyzing(false);
      setError("Could not process invoice. Please try again.");
    }
  };

  const handleSaveAsServiceRecord = async () => {
    if (!selectedAssetId || !parsed?.service_record) {
      setError("Select an asset and process an invoice first.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const sr = parsed.service_record;

      const { data, error: insertErr } = await supabase
        .from("service_records")
        .insert({
          asset_id: selectedAssetId,
          title: sr.title || "Service from invoice",
          notes: sr.notes || null,
          cost: sr.cost_total ?? null,
          performed_at: sr.performed_at || new Date().toISOString(),
          service_type: sr.service_type || "pro",
          location: sr.location_name || parsed.vendor?.name || null,
          invoice_number: sr.invoice_number || null,
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error("Error saving service record from invoice", insertErr);
        setError("Could not save service record.");
        setSaving(false);
        return;
      }

      // TODO: link invoice file to service_record_photos or a documents table
      // if you want to keep the original invoice snapshot attached.

      setSaving(false);

      // Navigate to edit screen or back to asset story
      navigation.navigate("EditServiceRecord", {
        serviceRecordId: data.id,
      });
    } catch (e) {
      console.error("Unexpected error saving service record", e);
      setError("Unexpected error. Please try again.");
      setSaving(false);
    }
  };

  const currentAsset =
    assets.find((a) => a.id === selectedAssetId) || null;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={22} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>Add service from invoice</Text>
            <Text style={styles.appSubtitle}>
              Scan an invoice or receipt and let Keepr prefill the details.
            </Text>
          </View>
        </View>

        {/* Pick invoice */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Invoice file</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handlePickInvoice}
            disabled={uploading || analyzing}
          >
            {uploading || analyzing ? (
              <ActivityIndicator size="small" />
            ) : (
              <>
                <Ionicons
                  name="document-attach-outline"
                  size={16}
                  color="white"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.primaryButtonText}>
                  Choose invoice or receipt
                </Text>
              </>
            )}
          </TouchableOpacity>

          {filePreview && (
            <Text style={styles.helperText}>
              File selected and uploaded. Parsed details below.
            </Text>
          )}
        </View>

        {/* Asset selection */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Apply to asset</Text>

          {assets.length === 0 ? (
            <Text style={styles.helperText}>
              You don’t have any assets yet. Add an asset first.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: spacing.sm }}
            >
              {assets.map((asset) => {
                const isActive = asset.id === selectedAssetId;
                return (
                  <TouchableOpacity
                    key={asset.id}
                    style={[
                      styles.assetChip,
                      isActive && styles.assetChipActive,
                    ]}
                    onPress={() => setSelectedAssetId(asset.id)}
                  >
                    <Text
                      style={[
                        styles.assetChipText,
                        isActive && styles.assetChipTextActive,
                      ]}
                    >
                      {asset.name || "Unnamed asset"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {parsed?.asset_hint?.name && (
            <Text style={styles.helperText}>
              Invoice hint: looks related to “{parsed.asset_hint.name}”.
            </Text>
          )}
        </View>

        {/* Parsed summary */}
        {parsed && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Parsed details</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {parsed.service_record?.title || "Service from invoice"}
              </Text>

              {parsed.vendor?.name && (
                <Text style={styles.cardMeta}>
                  {parsed.vendor.name}
                </Text>
              )}

              {parsed.service_record?.performed_at && (
                <Text style={styles.cardMeta}>
                  Date: {parsed.service_record.performed_at}
                </Text>
              )}

              {parsed.service_record?.cost_total != null && (
                <Text style={styles.cardMeta}>
                  Total: $
                  {Number(
                    parsed.service_record.cost_total
                  ).toLocaleString()}
                </Text>
              )}

              <TextInput
                style={styles.notesInput}
                multiline
                placeholder="Notes (editable)…"
                defaultValue={parsed.service_record?.notes || ""}
                onChangeText={(text) => {
                  setParsed((prev) =>
                    prev
                      ? {
                          ...prev,
                          service_record: {
                            ...prev.service_record,
                            notes: text,
                          },
                        }
                      : prev
                  );
                }}
              />
            </View>
          </View>
        )}

        {/* Errors */}
        {error && (
          <View style={styles.section}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Save button */}
        <View style={[styles.section, { marginTop: spacing.lg }]}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!parsed || !selectedAssetId || saving) && {
                opacity: 0.6,
              },
            ]}
            onPress={handleSaveAsServiceRecord}
            disabled={!parsed || !selectedAssetId || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons
                  name="save-outline"
                  size={16}
                  color="white"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.primaryButtonText}>
                  Save as service record
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
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
  appTitle: typography.title,
  appSubtitle: { ...typography.subtitle, marginTop: 2 },

  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionLabel: typography.sectionLabel,

  primaryButton: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.brandBlue,
  },
  primaryButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  helperText: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorText: {
    color: "red",
    fontSize: 12,
  },

  assetChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.xs,
  },
  assetChipActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  assetChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  assetChipTextActive: {
    color: "white",
    fontWeight: "600",
  },

  card: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  notesInput: {
    marginTop: spacing.sm,
    minHeight: 80,
    fontSize: 13,
    color: colors.textPrimary,
    textAlignVertical: "top",
  },
});
