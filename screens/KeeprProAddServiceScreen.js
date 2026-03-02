// screens/KeeprProAddServiceScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { boats } from "../data/boats";

// Mock "logged-in" technician for now
const technician = {
  name: "Wilson Marine – Service Tech",
  org: "Wilson Marine",
};

const SERVICE_OPTIONS = [
  "Winterization",
  "Spring Launch",
  "Mid-season Check",
  "Diagnostics / Troubleshooting",
  "Repair / Parts",
  "Detailing / Cleaning",
  "Other",
];

export default function KeeprProAddServiceScreen({ route, navigation }) {
  const boatId = route?.params?.boatId;
  let boat = null;

  if (boatId) {
    boat = boats.find((b) => b.id === boatId);
  }
  if (!boat) {
    boat = boats.find((b) => b.isPrimary) || boats[0];
  }

  const [selectedService, setSelectedService] = useState("Winterization");
  const [workOrderNumber, setWorkOrderNumber] = useState("");
  const [notes, setNotes] = useState("");

  const applyServiceToBoat = () => {
    const today = new Date().toISOString().split("T")[0];

    // Start with current values
    let newStatus = boat.status;
    let newLocation = boat.location;

    if (selectedService === "Winterization") {
      newStatus = "Winterized";
      newLocation = {
        type: "Stored",
        provider: "Wilson Marine",
      };
    } else if (selectedService === "Spring Launch") {
      newStatus = "In Season";
      newLocation = {
        type: "In Slip",
        provider: "Eldean Shipyard, Holland",
      };
    } else if (selectedService === "Mid-season Check") {
      newStatus = "In Season";
      newLocation = {
        type: "In Slip",
        provider:
          boat.location?.provider || "Eldean Shipyard, Holland",
      };
    } else if (selectedService === "Diagnostics / Troubleshooting") {
      newStatus = "Needs Follow-up";
      newLocation = {
        type: "In Service",
        provider: "Wilson Marine",
      };
    }

    // Apply to boat
    boat.status = newStatus;
    boat.location = newLocation;

    // Add a new story entry at the top
    boat.story.unshift({
      id: Date.now().toString(),
      date: today,
      title: selectedService,
      by: technician.org,
      status: newStatus,
      location: newLocation,
      details: [
        workOrderNumber
          ? `Work order: ${workOrderNumber}`
          : "Work order attached",
        notes || "See attached work order / internal notes.",
      ],
      photo: null,
    });
  };

  const handleSave = () => {
    applyServiceToBoat();
    navigation.navigate("BoatStory", { boatId: boat.id });
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
    <View style={styles.topBar}>
  <TouchableOpacity
    style={styles.backButton}
    onPress={() => navigation.goBack()}
    activeOpacity={0.7}
  >
    <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
  </TouchableOpacity>

  <Text style={styles.topBarTitle}>Boats</Text>

  {/* Spacer to balance layout */}
  <View style={{ width: 40 }} />
</View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Text style={styles.title}>Add service record</Text>
          <Text style={styles.subtitle}>
            This is what a Keepr Pro sees after scanning a KeeprTag on the boat.
            Core details are pre-filled; they only choose the package and add a
            work order.
          </Text>

          {/* Technician + boat summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons
                name="person-circle-outline"
                size={22}
                color={colors.accentBlue}
              />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={styles.summaryLabel}>Logged in as</Text>
                <Text style={styles.summaryValue}>{technician.name}</Text>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <Ionicons
                name="boat-outline"
                size={20}
                color={colors.accentBlue}
              />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={styles.summaryLabel}>Asset</Text>
                <Text style={styles.summaryValue}>
                  {boat.name} • {boat.engine} • {boat.year}
                </Text>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <Ionicons
                name="location-outline"
                size={20}
                color={colors.accentBlue}
              />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={styles.summaryLabel}>Current location</Text>
                <Text style={styles.summaryValue}>
                  {boat.location?.type}
                  {boat.location?.provider
                    ? ` • ${boat.location.provider}`
                    : ""}
                </Text>
              </View>
            </View>
          </View>

          {/* Service type chips */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Service package</Text>
            <View style={styles.serviceOptions}>
              {SERVICE_OPTIONS.map((option) => {
                const isActive = option === selectedService;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.serviceChip,
                      isActive && styles.serviceChipActive,
                    ]}
                    onPress={() => setSelectedService(option)}
                    activeOpacity={0.9}
                  >
                    <Text
                      style={[
                        styles.serviceChipText,
                        isActive && styles.serviceChipTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Work order number */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Work order #</Text>
            <TextInput
              placeholder="e.g. WM-2025-1024"
              placeholderTextColor={colors.textMuted}
              value={workOrderNumber}
              onChangeText={setWorkOrderNumber}
              style={styles.input}
              returnKeyType="next"
            />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes for owner</Text>
            <TextInput
              placeholder="Optional summary the owner sees (rest stays on the work order)."
              placeholderTextColor={colors.textMuted}
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, styles.textarea]}
              multiline
            />
          </View>

          {/* Mock attach work order */}
          <TouchableOpacity
            style={styles.attachButton}
            activeOpacity={0.9}
            onPress={() => {
              // In a real app: open camera or file picker.
            }}
          >
            <Ionicons
              name="document-attach-outline"
              size={18}
              color={colors.accentBlue}
            />
            <Text style={styles.attachText}>
              Attach work order (photo / PDF)
            </Text>
          </TouchableOpacity>

          {/* Save */}
          <TouchableOpacity
            style={styles.saveButton}
            activeOpacity={0.9}
            onPress={handleSave}
          >
            <Text style={styles.saveButtonText}>Save service record</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  summaryValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  section: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: 4,
  },
  serviceOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  serviceChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder || colors.borderSubtle,
    backgroundColor: colors.chipBackground || colors.surfaceSubtle,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  serviceChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: "#DBEAFE",
  },
  serviceChipText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  serviceChipTextActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  attachButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  attachText: {
    marginLeft: spacing.xs,
    fontSize: 13,
    color: colors.accentBlue,
  },
  saveButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.accentBlue,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  topBar: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
  paddingBottom: spacing.sm,
},
backButton: {
  paddingHorizontal: 12,
  paddingVertical: 12,
  marginLeft: -6,
  borderRadius: 22,
},
topBarTitle: {
  flex: 1,
  textAlign: "left",
  fontSize: 17,
  fontWeight: "600",
  color: colors.textPrimary,
},
});
