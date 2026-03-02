// screens/AddHomeScreen.js
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows, typography } from "../styles/theme";

export default function AddHomeScreen({ navigation, route }) {
  const preset = route?.params || {};

  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(preset.name || "");
  const [location, setLocation] = useState(preset.location || "");
  const [beds, setBeds] = useState(preset.beds ? String(preset.beds) : "");
  const [baths, setBaths] = useState(preset.baths ? String(preset.baths) : "");
  const [squareFeet, setSquareFeet] = useState(
    preset.square_feet ? String(preset.square_feet) : ""
  );
  const [yearBuilt, setYearBuilt] = useState(
    preset.year_built ? String(preset.year_built) : ""
  );

  const [purchasePrice, setPurchasePrice] = useState(
    preset.purchase_price ? String(preset.purchase_price) : ""
  );
  const [estimatedValue, setEstimatedValue] = useState(
    preset.estimated_value ? String(preset.estimated_value) : ""
  );

  const [notes, setNotes] = useState(preset.notes || "");

  const canSave = useMemo(() => {
    return (name || "").trim().length > 0 && !saving;
  }, [name, saving]);

  const parseNumber = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const cleaned = s.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  };

  const parseIntSafe = (v) => {
    const n = parseNumber(v);
    if (n == null) return null;
    return Math.trunc(n);
  };

  const onSave = async () => {
    if (!canSave) return;

    setSaving(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user?.id) {
        Alert.alert("Auth", "No signed-in user found.");
        return;
      }

      const payload = {
        owner_id: user.id,
        name: (name || "").trim(),
        type: "home", // required non-null in your schema
        asset_subtype: "home",
        location: (location || "").trim() || null,

        beds: parseIntSafe(beds),
        baths: parseNumber(baths),
        square_feet: parseIntSafe(squareFeet),
        year_built: parseIntSafe(yearBuilt),

        purchase_price: parseNumber(purchasePrice),
        estimated_value: parseNumber(estimatedValue),

        notes: (notes || "").trim() || null,

        // optional but super useful for SuperKeepr
        extra_metadata: {
          lifecycle_state: "Owned – Pre-Rehab",
          lifecycle_state_entered_at: new Date().toISOString(),
        },
      };

      const { data, error } = await supabase
        .from("assets")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      // Go to HomeStory for the new home
      navigation.navigate("HomeStory", { homeId: data.id });
    } catch (e) {
      console.error(e);
      Alert.alert("Save failed", e?.message || "Could not create home.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
            style={styles.iconBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>New home</Text>
            <Text style={styles.h2}>Create a home the normal way.</Text>
          </View>

          <TouchableOpacity
            onPress={onSave}
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            disabled={!canSave}
            activeOpacity={0.9}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="white" />
                <Text style={styles.saveBtnText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Home name *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g., 123 Maple St"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Location</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Address / city"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Beds</Text>
              <TextInput
                value={beds}
                onChangeText={setBeds}
                placeholder="3"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Baths</Text>
              <TextInput
                value={baths}
                onChangeText={setBaths}
                placeholder="2.5"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Square feet</Text>
              <TextInput
                value={squareFeet}
                onChangeText={setSquareFeet}
                placeholder="1800"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Year built</Text>
              <TextInput
                value={yearBuilt}
                onChangeText={setYearBuilt}
                placeholder="1978"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Purchase price</Text>
              <TextInput
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                placeholder="$210,000"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Estimated value</Text>
              <TextInput
                value={estimatedValue}
                onChangeText={setEstimatedValue}
                placeholder="$265,000"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
              />
            </View>
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything important for stewardship..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textarea]}
            multiline
          />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    ...shadows.subtle,
  },
  h1: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  h2: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    ...shadows.subtle,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "white", fontWeight: "800", fontSize: 13 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.subtle,
  },
  label: {
    ...typography.sectionLabel,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
  },
  textarea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
});
