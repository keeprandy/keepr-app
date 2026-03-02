// screens/AddAssetFromPhotoScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { createAssetWithDefaults } from "../lib/assetsService";

// ---------------------------------------------------------------------------
// TEMPORARY AI SIMULATOR — replace this later with real OpenAI endpoint
// ---------------------------------------------------------------------------
async function analyzeAssetPhotoSim(photoUrl) {
  // Simulate "AI" behavior using simple heuristics on filename
  const lower = photoUrl.toLowerCase();

  if (lower.includes("alfa") || lower.includes("stelvio")) {
    return {
      asset_type: "vehicle",
      name: "2022 Alfa Romeo Stelvio Veloce",
      year: 2022,
      make: "Alfa Romeo",
      model: "Stelvio Veloce",
      confidence: 0.9,
      first_story_event: {
        title: "Vehicle identified",
        description: "Recognized from grille, headlight shape, and body lines.",
      },
    };
  }

  if (lower.includes("harris") || lower.includes("kayot") || lower.includes("boat")) {
    return {
      asset_type: "boat",
      name: "2008 Harris Kayot",
      year: 2008,
      make: "Harris",
      model: "Kayot",
      confidence: 0.83,
      first_story_event: {
        title: "Boat identified",
        description: "Recognized from hull shape and deck configuration.",
      },
    };
  }

  return {
    asset_type: "other",
    name: "New Asset",
    confidence: 0.5,
    first_story_event: {
      title: "Asset created from photo",
      description: "Could not confidently identify make/model.",
    },
  };
}

// ---------------------------------------------------------------------------
// SUPABASE UPLOAD
// ---------------------------------------------------------------------------
async function uploadHeroImage(localUri, userId = "demo-user") {
  const ext = localUri.split(".").pop().toLowerCase() || "jpg";
  const fileName = `asset-photo-${userId}-${Date.now()}.${ext}`;
  const path = `asset-photos/${fileName}`;

  const file = await fetch(localUri);
  const blob = await file.blob();

  const { error: uploadErr } = await supabase.storage
    .from("asset-photos")
    .upload(path, blob, {
      contentType: ext === "png" ? "image/png" : "image/jpeg",
      upsert: false,
    });

  if (uploadErr) throw uploadErr;

  const {
    data: { publicUrl },
  } = supabase.storage.from("asset-photos").getPublicUrl(path);

  return publicUrl;
}

// ---------------------------------------------------------------------------
// MAIN SCREEN
// ---------------------------------------------------------------------------
export default function AddAssetFromPhotoScreen({ navigation }) {
  const [photoUri, setPhotoUri] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // -------------------------------------------------------------
  // PICK PHOTO
  // -------------------------------------------------------------
  const handlePickPhoto = async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Permission required to access photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    setPhotoUri(asset.uri);

    try {
      // Upload FIRST
      const uploadedUrl = await uploadHeroImage(asset.uri);
      setPhotoUrl(uploadedUrl);

      // Now run “AI”
      setAnalyzing(true);
      const analysis = await analyzeAssetPhotoSim(uploadedUrl);
      setAnalyzing(false);

      setAiResult(analysis);

      // Prefill fields
      setName(analysis.name || "");
      setMake(analysis.make || "");
      setModel(analysis.model || "");
      setYear(analysis.year ? String(analysis.year) : "");
    } catch (e) {
      console.error("Error analyzing asset photo", e);
      setError("Could not analyze the photo.");
      setAnalyzing(false);
    }
  };

  // -------------------------------------------------------------
  // SAVE NEW ASSET
  // -------------------------------------------------------------
  const handleSaveAsset = async () => {
    if (!aiResult) {
      setError("No AI analysis available.");
      return;
    }

    try {
      setSaving(true);

      const { asset_type } = aiResult;

      // CREATE THE ASSET
      const asset = await createAssetWithDefaults({
        type: asset_type,
        name,
        make,
        model,
        year: year ? parseInt(year) : null,
        hero_image_url: photoUrl,
      });

      // CREATE INITIAL STORY EVENT
      if (aiResult.first_story_event) {
        await supabase.from("story_events").insert({
          asset_id: asset.id,
          event_type: "asset_created",
          title: aiResult.first_story_event.title,
          description: aiResult.first_story_event.description || null,
          occurred_at: new Date().toISOString(),
        });
      }

      // NAVIGATE TO CORRECT STORY SCREEN
      if (asset_type === "boat") {
        navigation.navigate("BoatStory", { boatId: asset.id });
      } else if (asset_type === "vehicle") {
        navigation.navigate("VehicleStory", { vehicleId: asset.id });
      } else if (asset_type === "home") {
        navigation.navigate("HomeStory", { homeId: asset.id });
      } else {
        navigation.navigate("Dashboard");
      }

      setSaving(false);
    } catch (e) {
      console.error("Error saving new asset", e);
      setError("Could not save new asset.");
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Add asset from photo</Text>
        </View>

        {/* Pick Photo */}
        <TouchableOpacity
          style={styles.pickButton}
          onPress={handlePickPhoto}
          disabled={analyzing || saving}
        >
          {analyzing ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons
                name="camera-outline"
                size={18}
                color="white"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.pickButtonText}>
                Choose or take a photo
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Preview */}
        {photoUri && (
          <Image
            source={{ uri: photoUri }}
            style={styles.preview}
            resizeMode="cover"
          />
        )}

        {/* Fields */}
        {aiResult && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Detected asset</Text>

            <TextInput
              style={styles.input}
              placeholder="Asset name"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Make"
              value={make}
              onChangeText={setMake}
            />
            <TextInput
              style={styles.input}
              placeholder="Model"
              value={model}
              onChangeText={setModel}
            />
            <TextInput
              style={styles.input}
              placeholder="Year"
              value={year}
              keyboardType="numeric"
              onChangeText={setYear}
            />
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Save Button */}
        {aiResult && (
          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={handleSaveAsset}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons
                  name="save-outline"
                  size={18}
                  color="white"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.saveText}>Save asset</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// STYLES
// ---------------------------------------------------------------------------
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
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  title: {
    ...typography.title,
  },
  pickButton: {
    flexDirection: "row",
    backgroundColor: colors.brandBlue,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  pickButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  preview: {
    width: "90%",
    height: 220,
    alignSelf: "center",
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: spacing.sm,
  },
  input: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  saveButton: {
    flexDirection: "row",
    backgroundColor: colors.brandBlue,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  saveText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  error: {
    color: "red",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
});
