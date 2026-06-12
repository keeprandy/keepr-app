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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, shadows } from "../styles/theme";
import { createHub } from "../lib/hubsApi";
import { useAuth } from "../context/AuthContext";

const HUB_TYPES = [
  "community",
  "registry",
  "dealer",
  "builder",
  "oem",
  "portfolio",
  "event",
];

function slugifyHubName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CreateHubScreen({ navigation }) {
  const { user } = useAuth();

  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [hubType, setHubType] = React.useState("community");
  const [visibility, setVisibility] = React.useState("public");

  const save = async () => {
    const cleanName = name.trim();

    if (!cleanName) {
      Alert.alert("Missing name", "Hub name is required.");
      return;
    }

    if (!user?.id) {
      Alert.alert("Sign in required", "You need to be signed in to create a Hub.");
      return;
    }

    try {
      setSaving(true);

      const hub = await createHub({
        name: cleanName,
        slug: slugifyHubName(cleanName),
        description: description.trim() || null,
        createdBy: user.id,
        hubType,
        visibility,
      });

      navigation.replace("HubDetail", {
        hubId: hub.id,
        slug: hub.slug,
      });
    } catch (e) {
      Alert.alert("Could not create Hub", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Create Hub</Text>
            <Text style={styles.subtitle}>
              Build a community space for shared Asset Stories.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Hub Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder="PCA Rally Sport Region"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
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

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Create Hub</Text>
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