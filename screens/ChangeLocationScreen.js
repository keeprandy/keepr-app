// screens/ChangeLocationScreen.js
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { boats } from "../data/boats";
import { updateBoatLocation } from "../data/boat";

const LOCATION_TYPES = ["In Slip", "At Home", "On Trailer", "Stored"];

const MARINA_OPTIONS = [
  "Eldean Shipyard, Holland",
  "Anchorage Marina, Holland",
  "Holland State Park Marina",
  "Bayshore Marina, Saugatuck",
  "Tower Marine, Douglas",
  "Saugatuck Yacht Services",
  "Jefferson Beach Marina, St. Clair Shores",
  "MacRay Harbor, Harrison Township",
  "Emerald City Harbor, St. Clair Shores",
  "Miller Marina, St. Clair Shores",
  "Harbor West Marina, Traverse City",
  "Clinch Park Marina, Traverse City",
  "Suttons Bay Marina",
  "Elk Rapids Marina",
  "Walstrom Marine, Harbor Springs",
  "Irish Boat Shop, Harbor Springs",
  "Bay Harbor Lake Marina, Petoskey",
  "Petoskey Marina",
  "Great Lakes Marina, Muskegon",
  "Holiday Isle Marina, Muskegon",
  "Grand Isle Marina, Grand Haven",
  "North Shore Marina, Spring Lake",
  "Lyman’s on the Lake, Houghton Lake",
  "East Bay Marina, Houghton Lake",
];

export default function ChangeLocationScreen({ route, navigation }) {
  const boatId = route?.params?.boatId;
  let boat = null;

  if (boatId) {
    boat = boats.find((b) => b.id === boatId);
  }
  if (!boat) {
    boat = boats.find((b) => b.isPrimary) || boats[0];
  }

  const [locationType, setLocationType] = useState(
    boat.location?.type || "In Slip"
  );
  const [marinaSearch, setMarinaSearch] = useState("");
  const [selectedMarina, setSelectedMarina] = useState(
    boat.location?.provider || ""
  );
  const [slipNumber, setSlipNumber] = useState("");

  const filteredMarinas = useMemo(() => {
    const term = marinaSearch.trim().toLowerCase();
    if (!term) return MARINA_OPTIONS;
    return MARINA_OPTIONS.filter((m) =>
      m.toLowerCase().includes(term)
    );
  }, [marinaSearch]);

  const handleSave = () => {
    if (locationType === "In Slip") {
      if (!selectedMarina) {
        // In a real app: show validation. For now, just don't proceed.
        return;
      }
      const base = selectedMarina.trim();
      const provider = slipNumber
        ? `${base} – Slip ${slipNumber.trim()}`
        : base;

      updateBoatLocation(boat, "In Slip", provider);
    } else if (locationType === "Stored") {
      updateBoatLocation(boat, "Stored", "Wilson Marine");
    } else if (locationType === "At Home") {
      updateBoatLocation(boat, "At Home", null);
    } else if (locationType === "On Trailer") {
      updateBoatLocation(boat, "On Trailer", null);
    }

    navigation.goBack();
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
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Change boat location</Text>
            <Text style={styles.subtitle}>
              Set where this boat is right now — at home, on a trailer, stored,
              or in a slip at a marina.
            </Text>
          </View>

          {/* Location type chips */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Location type</Text>
            <View style={styles.typeChips}>
              {LOCATION_TYPES.map((type) => {
                const isActive = type === locationType;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeChip,
                      isActive && styles.typeChipActive,
                    ]}
                    onPress={() => setLocationType(type)}
                    activeOpacity={0.9}
                  >
                    <Text
                      style={[
                        styles.typeChipText,
                        isActive && styles.typeChipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* In Slip: Marina search + Slip number */}
          {locationType === "In Slip" && (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>Marina</Text>
              <TextInput
                placeholder="Search marinas…"
                placeholderTextColor={colors.textMuted}
                value={marinaSearch}
                onChangeText={setMarinaSearch}
                style={styles.input}
              />

              <View style={styles.marinaList}>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {filteredMarinas.map((marina) => {
                    const isSelected = marina === selectedMarina;
                    return (
                      <TouchableOpacity
                        key={marina}
                        style={[
                          styles.marinaRow,
                          isSelected && styles.marinaRowSelected,
                        ]}
                        activeOpacity={0.9}
                        onPress={() => setSelectedMarina(marina)}
                      >
                        <Ionicons
                          name={
                            isSelected
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={16}
                          color={
                            isSelected
                              ? colors.accentBlue
                              : colors.textMuted
                          }
                          style={{ marginRight: spacing.xs }}
                        />
                        <Text
                          style={[
                            styles.marinaText,
                            isSelected && styles.marinaTextSelected,
                          ]}
                        >
                          {marina}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.sectionLabel}>Slip number (optional)</Text>
                <TextInput
                  placeholder="e.g. 122"
                  placeholderTextColor={colors.textMuted}
                  value={slipNumber}
                  onChangeText={setSlipNumber}
                  style={styles.input}
                  keyboardType="default"
                />
              </View>
            </View>
          )}

          {/* Helper copy for other types */}
          {locationType !== "In Slip" && (
            <View style={styles.section}>
              <Text style={styles.helperText}>
                {locationType === "At Home" &&
                  "We’ll treat this boat as stored at your primary home (driveway, barn, or side yard)."}
                {locationType === "On Trailer" &&
                  "The boat is on a trailer and mobile — in your driveway, yard, or ready to tow."}
                {locationType === "Stored" &&
                  "For this demo, “Stored” assumes a professional provider like Wilson Marine handling storage."}
              </Text>
            </View>
          )}

          {/* Save button */}
          <TouchableOpacity
            style={styles.saveButton}
            activeOpacity={0.9}
            onPress={handleSave}
          >
            <Text style={styles.saveButtonText}>Save location</Text>
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
    paddingBottom: spacing.xl, // space so button isn't under keyboard
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 4,
  },

  section: {
    marginTop: spacing.md,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: 4,
  },

  typeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  typeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder || colors.borderSubtle,
    backgroundColor: colors.chipBackground || colors.surfaceSubtle,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  typeChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: "#DBEAFE",
  },
  typeChipText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  typeChipTextActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },

  sectionBlock: {
    marginTop: spacing.md,
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

  marinaList: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    ...shadows.subtle,
    maxHeight: 220, // keeps it from taking the whole screen
    overflow: "hidden",
  },
  marinaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  marinaRowSelected: {
    backgroundColor: colors.surfaceSubtle,
  },
  marinaText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  marinaTextSelected: {
    fontWeight: "600",
  },

  helperText: {
    fontSize: 12,
    color: colors.textMuted,
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

