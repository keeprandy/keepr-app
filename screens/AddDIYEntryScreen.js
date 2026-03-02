// screens/AddDIYEntry.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { useVehicles } from "../context/VehiclesContext";
import { useBoats } from "../context/BoatsContext";
import { HOME_SYSTEMS } from "../data/homeSystems";

export default function AddDIYEntry({ route, navigation }) {
  const {
    source,      // "vehicle" | "boat" | "homeSystem"
    vehicleId,
    boatId,
    homeId,
    systemId,
    homeName,
    systemName,
  } = route?.params || {};

  const { vehicles, setVehicles } = useVehicles();
  const { boats, setBoats } = useBoats();

  const vehicle = vehicleId
    ? vehicles.find((v) => v.id === vehicleId)
    : null;
  const boat = boatId ? boats.find((b) => b.id === boatId) : null;
  const system =
    source === "homeSystem" && systemId
      ? HOME_SYSTEMS.find((s) => s.id === systemId)
      : null;

  let contextLabel = "Asset";
  if (source === "homeSystem" && homeName && systemName) {
    contextLabel = `${homeName} · ${systemName}`;
  } else if (vehicle) {
    contextLabel = vehicle.name;
  } else if (boat) {
    contextLabel = boat.name;
  }

  const isHomeSystem = source === "homeSystem";

  const titlePlaceholder = isHomeSystem
    ? "Filter change, test cycle, small repair..."
    : "Oil change, filter swap, winterization prep...";

  const notesPlaceholder = isHomeSystem
    ? "What you did (e.g., replaced furnace filter, flushed water heater, tested AC)..."
    : "What you did (e.g., changed oil, rotated tires, greased fittings)...";

  const [date, setDate] = useState("");
  const [title, setTitle] = useState(
    isHomeSystem && systemName ? `DIY – ${systemName}` : ""
  );
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const handleBack = () => {
    navigation.goBack();
  };

  const handleSave = () => {
    const today = new Date().toISOString().slice(0, 10);
    const effectiveDate = date || today;

    const entry = {
      id: `diy-${Date.now()}`,
      date: effectiveDate,
      type: "diy",
      title: title || "DIY maintenance",
      provider: "Owner DIY",
      cost: cost || null,
      notes: notes || "",
    };

    // Attach to vehicle
    if (vehicle && setVehicles) {
      setVehicles((prev) =>
        prev.map((v) => {
          if (v.id !== vehicle.id) return v;
          const existingHistory = v.serviceHistory || [];
          return {
            ...v,
            serviceHistory: [entry, ...existingHistory],
          };
        })
      );
    }

    // Attach to boat
    if (boat && setBoats) {
      setBoats((prev) =>
        prev.map((b) => {
          if (b.id !== boat.id) return b;
          const existingHistory = b.serviceHistory || [];
          return {
            ...b,
            serviceHistory: [entry, ...existingHistory],
          };
        })
      );
    }

    // Home systems: same as service record — in a full build, this would persist via context.

    navigation.goBack();
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.contentWrapper}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={handleBack}
              activeOpacity={0.8}
            >
              <Ionicons
                name="chevron-back-outline"
                size={20}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Add DIY entry</Text>
              <Text style={styles.subtitle}>{contextLabel}</Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
          >
            {/* Date */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                value={date}
                onChangeText={setDate}
              />
            </View>

            {/* Title */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder={titlePlaceholder}
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
              />
            </View>

            {/* Cost */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Cost (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="$0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={cost}
                onChangeText={setCost}
              />
            </View>

            {/* Notes */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>What did you do?</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder={notesPlaceholder}
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Save */}
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              activeOpacity={0.9}
            >
              <Ionicons
                name="hammer-outline"
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.saveButtonText}>Save DIY entry</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* ============ STYLES ============ */

const styles = StyleSheet.create({
  contentWrapper: {
    flex: 1,
    alignItems: "center",
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 900,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  fieldGroup: {
    marginBottom: spacing.md,
  },
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
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputMultiline: {
    minHeight: 96,
  },

  saveButton: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
