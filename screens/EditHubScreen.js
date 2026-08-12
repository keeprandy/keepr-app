import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from "react-native";

import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabaseClient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, shadows } from "../styles/theme";
import { fetchHub, updateHub } from "../lib/hubsApi";
import HubActionRow from "../components/hubs/HubActionRow";
import { HUB_PARTICIPATION_PRESETS, getHubPresetKey } from "../lib/hubConfig";

const HUB_TYPES = [
  "community",
  "registry",
  "dealer",
  "builder",
  "oem",
  "portfolio",
  "event",
];

const PARTICIPATION_MODELS = [
  "public",
  "moderated",
  "invite_only",
   "owner_controlled",
];

const PARTICIPATION_PRESETS = ["membership_club", "open_event"];

function ConfigTextInput({ value, onChangeText, style, ...props }) {
  const handleChange = React.useCallback(
    (event) => {
      const next =
        event?.nativeEvent?.text ??
        event?.target?.value ??
        "";
      onChangeText?.(next);
    },
    [onChangeText]
  );

  return (
    <TextInput
      {...props}
      value={String(value || "")}
      onChangeText={onChangeText}
      onChange={handleChange}
      editable
      autoCorrect={false}
      spellCheck={false}
      style={style}
    />
  );
}

export default function EditHubScreen({ navigation, route }) {
  const hubId = route?.params?.hubId;

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [hubType, setHubType] = React.useState("community");
  const [visibility, setVisibility] = React.useState("public");
  const [participationModel, setParticipationModel] =
  React.useState("moderated");
  const [participationPreset, setParticipationPreset] =
  React.useState("membership_club");
  const [assetLabel, setAssetLabel] = React.useState("");
  const [eligibleMake, setEligibleMake] = React.useState("");
  const [eligibleModel, setEligibleModel] = React.useState("");
  const [eligibleYear, setEligibleYear] = React.useState("");
  const [ctaLabel, setCtaLabel] = React.useState("");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [editingLogo, setEditingLogo] = React.useState(false);
  const [hub, setHub] = React.useState(null);


async function handlePickLogo() {
  try {
    const pickerMediaTypes =
      ImagePicker.MediaType?.Images ??
      ImagePicker.MediaTypeOptions?.Images;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: pickerMediaTypes,
      quality: 0.8,
    });

    if (result.canceled) return;

    const picked = result.assets?.[0];
    if (!picked) return;

    const fileExt =
      (picked.fileName && picked.fileName.split(".").pop()) ||
      (picked.mimeType && picked.mimeType.split("/").pop()) ||
      "jpg";

    const fileName = `hubs/${hubId}/logo_${Date.now()}.${fileExt}`;
    const contentType = picked.mimeType || "image/jpeg";

    let uploadBody;

    if (Platform.OS === "web") {
      if (!picked.file) {
        throw new Error("Web file object was not returned by the picker.");
      }
      uploadBody = picked.file;
    } else {
      const response = await fetch(picked.uri);
      uploadBody = await response.blob();
    }

    const { error: uploadError } = await supabase.storage
      .from("org-images")
      .upload(fileName, uploadBody, {
        contentType,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from("org-images")
      .getPublicUrl(fileName);

    const publicUrl = publicData?.publicUrl || null;
    if (!publicUrl) throw new Error("Could not get uploaded logo URL.");

    await updateHub(hubId, {
      hero_image_url: publicUrl,
    });

    setLogoUrl(publicUrl);
  } catch (e) {
    console.error("Hub logo upload failed", e);
    Alert.alert("Upload failed", e?.message || "Could not upload logo.");
  }
}

  React.useEffect(() => {
    const load = async () => {
      try {
        const hub = await fetchHub(hubId);
        setHub(hub);
        setLogoUrl(hub?.hero_image_url || "");
        setName(hub?.name || "");
        setDescription(hub?.description || "");
        setHubType(hub?.hub_type || "community");
        setVisibility(hub?.settings?.visibility || hub?.visibility || "public");
        const preset = getHubPresetKey(hub) || "membership_club";
        setParticipationPreset(preset);
        setParticipationModel(
          hub?.settings?.participation_model ||
            HUB_PARTICIPATION_PRESETS[preset]?.participation_model ||
            "moderated"
        );
        setAssetLabel(hub?.settings?.asset_label || "");
        setEligibleMake(hub?.settings?.eligible_make || "");
        setEligibleModel(hub?.settings?.eligible_model || "");
        setEligibleYear(hub?.settings?.eligible_year ? String(hub.settings.eligible_year) : "");
        setCtaLabel(hub?.settings?.cta_label || "");
      } catch (e) {
        Alert.alert("Could not load Hub", e?.message || "Try again.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [hubId]);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Hub name is required.");
      return;
    }

    try {
      setSaving(true);
      const model = participationModel || "moderated";
      const presetFromModel =
        model === "public" ? "open_event" : "membership_club";
      const selectedPreset = HUB_PARTICIPATION_PRESETS[participationPreset]
        ? participationPreset
        : presetFromModel;
      const selectedPresetConfig = HUB_PARTICIPATION_PRESETS[selectedPreset] || {};
      const preset =
        selectedPresetConfig.participation_model === model
          ? selectedPreset
          : presetFromModel;
      const presetConfig = HUB_PARTICIPATION_PRESETS[preset] || {};
      const canonicalModel = presetConfig.participation_model || model;

    await updateHub(hubId, {
      name: name.trim(),
      description: description.trim() || null,
      hub_type: hubType,
      visibility,
      settings: {
        ...(hub?.settings || {}),
        visibility,
        participation_preset: preset,
        participation_model: canonicalModel,
        submission_status:
          presetConfig.submission_status ||
          (canonicalModel === "public" ? "approved" : "pending"),
        primary_asset_type: presetConfig.primary_asset_type || "vehicle",
        can_quick_activate: presetConfig.can_quick_activate === true,
        asset_label: assetLabel.trim() || null,
        eligible_make: eligibleMake.trim() || null,
        eligible_model: eligibleModel.trim() || null,
        eligible_year: eligibleYear.trim() || null,
        cta_label: ctaLabel.trim() || null,
      },
    });

      navigation.goBack();
    } catch (e) {
      Alert.alert("Could not save Hub", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading Hub…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const PARTICIPATION_DESCRIPTIONS = {
  public: {
    title: "Public",
    body: "Anyone can add an eligible public Asset Story to this Hub. Best for open galleries, events, or lightweight showcases.",
  },
  moderated: {
    title: "Moderated",
    body: "Anyone can request to add an Asset Story. Hub admins approve it before it appears. Best for clubs, communities, and registries.",
  },
  invite_only: {
    title: "Invite Only",
    body: "Only invited members or admins can add Asset Stories. Best for dealer inventory, private portfolios, and controlled collections.",
  },
  owner_controlled: {
  title: "Owner Controlled",
  body: "Only Hub owners or administrators can add Asset Stories. Best for portfolios, dealer inventory, OEM showcases, and managed collections.",
},
};

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Edit Hub</Text>
            <Text style={styles.subtitle}>Give this Hub its identity.</Text>
          </View>
        </View>
        <HubActionRow
        navigation={navigation}
        hub={hub}
        hubId={hubId}
        canManage={true}
        active="settings"
      />
        <View style={styles.logoSection}>
          <TouchableOpacity style={styles.logoCircle} onPress={handlePickLogo}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logoImage} resizeMode="contain" />
            ) : (
              <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoUploadBtn} onPress={handlePickLogo}>
            <Ionicons name="image-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.logoUploadBtnText}>
              {logoUrl ? "Change Logo" : "Upload Logo"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Hub Name</Text>
          <ConfigTextInput value={name} onChangeText={setName} style={styles.input} />

          <Text style={styles.label}>Description</Text>
          <ConfigTextInput
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="A curated collection of public Keepr Stories."
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Hub Type</Text>
          <View style={styles.pillWrap}>
            {HUB_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setHubType(type)}
                style={[styles.pill, hubType === type && styles.pillActive]}
              >
                <Text style={[styles.pillText, hubType === type && styles.pillTextActive]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Visibility</Text>
          <View style={styles.pillWrap}>
            {["public", "private"].map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setVisibility(value)}
                style={[styles.pill, visibility === value && styles.pillActive]}
              >
                <Text style={[styles.pillText, visibility === value && styles.pillTextActive]}>
                  {value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Participation Preset</Text>
          <View style={styles.pillWrap}>
            {PARTICIPATION_PRESETS.map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => {
                  setParticipationPreset(value);
                  setParticipationModel(
                    HUB_PARTICIPATION_PRESETS[value]?.participation_model || participationModel
                  );
                }}
                style={[styles.pill, participationPreset === value && styles.pillActive]}
              >
                <Text style={[styles.pillText, participationPreset === value && styles.pillTextActive]}>
                  {value.replace("_", " ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Participation</Text>

          <View style={styles.pillWrap}>
            {PARTICIPATION_MODELS.map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setParticipationModel(value)}
                style={[
                  styles.pill,
                  participationModel === value && styles.pillActive,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    participationModel === value &&
                      styles.pillTextActive,
                  ]}
                >
                  {value.replace("_", " ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.explainCard}>
          <Text style={styles.explainTitle}>
            {PARTICIPATION_DESCRIPTIONS[participationModel]?.title}
          </Text>
          <Text style={styles.explainBody}>
            {PARTICIPATION_DESCRIPTIONS[participationModel]?.body}
          </Text>
        </View>

          <Text style={styles.label}>Eligible Asset</Text>
          <ConfigTextInput
            value={assetLabel}
            onChangeText={setAssetLabel}
            style={styles.input}
            placeholder="Optional display label"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Eligible Make</Text>
          <ConfigTextInput
            value={eligibleMake}
            onChangeText={setEligibleMake}
            style={styles.input}
            placeholder="Optional make"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Eligible Model</Text>
          <ConfigTextInput
            value={eligibleModel}
            onChangeText={setEligibleModel}
            style={styles.input}
            placeholder="Optional model"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Eligible Year</Text>
          <ConfigTextInput
            value={eligibleYear}
            onChangeText={setEligibleYear}
            style={styles.input}
            placeholder="Optional year"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            inputMode="numeric"
          />

          <Text style={styles.label}>CTA Copy</Text>
          <ConfigTextInput
            value={ctaLabel}
            onChangeText={setCtaLabel}
            style={styles.input}
            placeholder="Optional CTA override"
            placeholderTextColor={colors.textMuted}
          />

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Hub</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg || colors.background || "#F5F6F8" },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, color: colors.textMuted },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },
  title: { fontSize: 24, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 3, fontSize: 13, fontWeight: "700", color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  explainCard: {
  marginTop: 10,
  padding: 12,
  borderRadius: 14,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},

explainTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: colors.textPrimary,
},

explainBody: {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "600",
  color: colors.textMuted,
},
  label: {
    marginTop: 14,
    marginBottom: 7,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    fontWeight: "700",
  },
  logoSection: {
  alignItems: "center",
  marginBottom: 18,
},

logoCircle: {
  width: 96,
  height: 96,
  borderRadius: 48,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},

logoImage: {
  width: "100%",
  height: "100%",
},

logoUploadBtn: {
  marginTop: 10,
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 999,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
},

logoUploadBtnText: {
  fontSize: 13,
  fontWeight: "800",
  color: colors.textPrimary,
},
  textArea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  pillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },
  pillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
    textTransform: "capitalize",
  },
  pillTextActive: { color: "#fff" },
  saveButton: {
    marginTop: 22,
    backgroundColor: colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonText: { color: "#fff", fontWeight: "900", fontSize: 13 },
});
