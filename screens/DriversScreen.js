// screens/DriversScreen.js
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { layoutStyles } from "../styles/layout";
import {
  colors,
  spacing,
  radius,
  typography,
  shadows,
} from "../styles/theme";
import { useVehicles } from "../context/VehiclesContext";
import KeeprModal from "../components/KeeprModal";
const INITIAL_DRIVERS = [
  {
    id: "andy",
    name: "Andy",
    role: "Keepr · Manages the garage",
    description:
      "Sees every vehicle, maintenance status, and upcoming needs across homes.",
    vehicleIds: ["civic", "p911", "moto", "boat"],
  },
  {
    id: "taylor",
    name: "Taylor",
    role: "Teen driver · Assigned to the Civic",
    description:
      "App runs quietly in the background. No routes, no scores — just car health and reminders.",
    vehicleIds: ["civic"],
  },
];

export default function DriversScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const { vehicles } = useVehicles();
  const [drivers, setDrivers] = useState(INITIAL_DRIVERS);
  const [selectedDriverId, setSelectedDriverId] = useState(
    INITIAL_DRIVERS[0]?.id ?? null
  );

  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === selectedDriverId) || drivers[0] || null,
    [drivers, selectedDriverId]
  );

  // Add driver modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [formError, setFormError] = useState("");

  const openAddModal = () => {
    setNewName("");
    setNewRole("");
    setNewDescription("");
    setFormError("");
    setAddModalVisible(true);
  };

  const closeAddModal = () => setAddModalVisible(false);

  const handleAddDriver = () => {
    if (!newName.trim()) {
      setFormError("Driver name is required.");
      return;
    }

    const id = `driver-${Date.now().toString()}`;

    const newDriver = {
      id,
      name: newName.trim(),
      role: newRole.trim() || "Household driver",
      description:
        newDescription.trim() ||
        "Keepr will quietly track the vehicles assigned to this driver.",
      vehicleIds: [],
    };

    setDrivers((prev) => [...prev, newDriver]);
    setSelectedDriverId(id);
    setAddModalVisible(false);
  };

  const toggleVehicleForDriver = (driverId, vehicleId) => {
    setDrivers((prev) =>
      prev.map((d) => {
        if (d.id !== driverId) return d;
        const hasVehicle = d.vehicleIds.includes(vehicleId);
        return {
          ...d,
          vehicleIds: hasVehicle
            ? d.vehicleIds.filter((id) => id !== vehicleId)
            : [...d.vehicleIds, vehicleId],
        };
      })
    );
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.appTitle}>Drivers</Text>
          <Text style={styles.appSubtitle}>
            Assign drivers, keep everyone informed, and let Keepr handle the
            tracking.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addDriverButton}
          onPress={openAddModal}
          activeOpacity={0.85}
        >
          <Ionicons name="add-outline" size={16} color={colors.brandWhite} />
          <Text style={styles.addDriverButtonText}>Add driver</Text>
        </TouchableOpacity>
      </View>

      {/* Content layout */}
      <View
        style={[
          styles.contentRow,
          isWide ? styles.contentRowWide : styles.contentRowStacked,
        ]}
      >
        {/* Drivers list */}
        <View
          style={[
            styles.listColumn,
            !isWide && { marginRight: 0, marginBottom: spacing.sm },
          ]}
        >
          <Text style={styles.sectionLabel}>Household</Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.md }}
          >
            {drivers.map((driver) => {
              const isSelected = selectedDriver?.id === driver.id;
              return (
                <TouchableOpacity
                  key={driver.id}
                  style={[
                    styles.driverCard,
                    isSelected && styles.driverCardSelected,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => setSelectedDriverId(driver.id)}
                >
                  <View style={styles.driverHeaderRow}>
                    <Ionicons
                      name={
                        driver.id === "andy"
                          ? "person-circle-outline"
                          : "person-outline"
                      }
                      size={22}
                      color={colors.textPrimary}
                    />
                    <View style={styles.driverTextBlock}>
                      <Text style={styles.driverName}>{driver.name}</Text>
                      <Text style={styles.driverRole}>{driver.role}</Text>
                    </View>
                  </View>
                  <Text style={styles.driverMeta}>{driver.description}</Text>
                </TouchableOpacity>
              );
            })}

            <View style={styles.infoBanner}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={colors.brandBlue}
              />
              <Text style={styles.infoBannerText}>
                Drivers only set things up once. From there, Keepr automates the
                rest.
              </Text>
            </View>
          </ScrollView>
        </View>

        {/* Selected driver details */}
        <View
          style={[
            styles.detailColumn,
            !isWide && { marginLeft: 0 }, // tighter on mobile
          ]}
        >
          <Text style={styles.sectionLabel}>Driver details</Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
          >
            {selectedDriver ? (
              <View style={styles.detailCard}>
                {/* Driver header */}
                <View style={styles.detailHeaderRow}>
                  <Ionicons
                    name={
                      selectedDriver.id === "andy"
                        ? "person-circle-outline"
                        : "person-outline"
                    }
                    size={26}
                    color={colors.textPrimary}
                  />
                  <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                    <Text style={styles.detailTitle}>
                      {selectedDriver.name}
                    </Text>
                    <Text style={styles.detailRole}>
                      {selectedDriver.role}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>About</Text>
                  <Text style={styles.detailValue}>
                    {selectedDriver.description}
                  </Text>
                </View>

                {/* Assigned vehicles */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Assigned vehicles</Text>
                  {vehicles.length === 0 ? (
                    <Text style={styles.detailValueMuted}>
                      No vehicles in the garage yet.
                    </Text>
                  ) : (
                    <View style={styles.chipsRow}>
                      {vehicles.map((vehicle) => {
                        const isAssigned =
                          selectedDriver.vehicleIds.includes(vehicle.id);
                        return (
                          <TouchableOpacity
                            key={vehicle.id}
                            style={[
                              styles.vehicleChip,
                              isAssigned && styles.vehicleChipActive,
                            ]}
                            onPress={() =>
                              toggleVehicleForDriver(
                                selectedDriver.id,
                                vehicle.id
                              )
                            }
                            activeOpacity={0.85}
                          >
                            <Ionicons
                              name={
                                isAssigned
                                  ? "checkmark-circle"
                                  : "ellipse-outline"
                              }
                              size={14}
                              color={
                                isAssigned
                                  ? colors.brandBlue
                                  : colors.textMuted
                              }
                            />
                            <Text
                              style={[
                                styles.vehicleChipText,
                                isAssigned && styles.vehicleChipTextActive,
                              ]}
                            >
                              {vehicle.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <Text style={styles.helperText}>
                    Tap to assign or unassign vehicles for this driver. In a
                    full build, this controls which cars their app can see.
                  </Text>
                </View>

                {/* Teen framing example for Taylor */}
                {selectedDriver.id === "taylor" && (
                  <>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Car health view</Text>
                      <Text style={styles.detailValue}>
                        Overall: Good. Just a routine oil change coming up in
                        ~350 miles.
                      </Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>
                        What this app does
                      </Text>
                      <Text style={styles.detailValue}>
                        • Keeps track of how much the car is driven.{"\n"}
                        • Helps prevent surprise breakdowns.{"\n"}
                        • Reminds your parent when it’s time for service.
                      </Text>
                    </View>
                    <View style={styles.infoBannerGreen}>
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={16}
                        color={colors.accentGreen}
                      />
                      <Text style={styles.infoBannerGreenText}>
                        This isn’t here to monitor you — it’s here to take care
                        of the car you rely on.
                      </Text>
                    </View>
                  </>
                )}
              </View>
            ) : (
              <Text style={styles.emptyText}>
                Select a driver to see their details.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Add Driver Modal */}
      <KeeprModal
        visible={addModalVisible}
        onRequestClose={closeAddModal}
        animationType="slide"
      >
        <View style={styles.modalHeaderRow}>
          <Text style={styles.modalTitle}>Add driver</Text>
          <TouchableOpacity onPress={closeAddModal}>
            <Ionicons name="close-outline" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>
          Add a person to your Keepr household and assign vehicles they can see.
        </Text>

        <Text style={styles.modalLabel}>Name *</Text>
        <TextInput
          style={styles.modalInput}
          placeholder="e.g., Jordan"
          value={newName}
          onChangeText={setNewName}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.modalLabel}>Role</Text>
        <TextInput
          style={styles.modalInput}
          placeholder="e.g., Teen driver, Partner, Roommate"
          value={newRole}
          onChangeText={setNewRole}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.modalLabel}>Notes</Text>
        <TextInput
          style={[styles.modalInput, styles.modalNotesInput]}
          placeholder="Optional: how they use the vehicles, reminders, etc."
          value={newDescription}
          onChangeText={setNewDescription}
          placeholderTextColor={colors.textMuted}
          multiline
        />

        {formError ? <Text style={styles.modalError}>{formError}</Text> : null}

        <View style={styles.modalButtonRow}>
          <TouchableOpacity
            style={styles.modalSecondaryButton}
            onPress={closeAddModal}
            activeOpacity={0.85}
          >
            <Text style={styles.modalSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.modalPrimaryButton}
            onPress={handleAddDriver}
            activeOpacity={0.85}
          >
            <Text style={styles.modalPrimaryText}>Save driver</Text>
          </TouchableOpacity>
        </View>
      </KeeprModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  appTitle: {
    ...typography.title,
  },
  appSubtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  addDriverButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  addDriverButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandWhite,
    marginLeft: spacing.xs,
  },

  contentRow: {
    flex: 1,
    marginTop: spacing.xs,
  },
  contentRowWide: {
    flexDirection: "row",
  },
  contentRowStacked: {
    flexDirection: "column",
  },
  listColumn: {
    flex: 1,
    marginRight: spacing.sm,
  },
  detailColumn: {
    flex: 1.1,
    marginLeft: spacing.sm,
  },

  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: 4,
  },

  driverCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  driverCardSelected: {
    borderColor: colors.accentBlue,
    ...shadows.subtle,
  },
  driverHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  driverTextBlock: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  driverName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  driverRole: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  driverMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },

  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  infoBannerText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
    flex: 1,
  },

  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    flex: 1,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  detailRole: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  detailSection: {
    marginTop: spacing.md,
  },
  detailLabel: {
    ...typography.sectionLabel,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  detailValueMuted: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  vehicleChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.chipBackground,
  },
  vehicleChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: "#EFF6FF",
  },
  vehicleChipText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  vehicleChipTextActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  infoBannerGreen: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#ECFDF3",
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  infoBannerGreenText: {
    fontSize: 11,
    color: "#166534",
    marginLeft: spacing.xs,
    flex: 1,
  },

  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },

  // Modal styles (inner card, reused with KeeprModal)
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 8,
  },
  modalLabel: {
    ...typography.sectionLabel,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  modalNotesInput: {
    height: 70,
    textAlignVertical: "top",
  },
  modalError: {
    fontSize: 11,
    color: colors.accentRed,
    marginTop: spacing.xs,
  },
  modalButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  modalSecondaryButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    marginRight: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  modalSecondaryText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  modalPrimaryButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
  },
  modalPrimaryText: {
    fontSize: 12,
    color: colors.brandWhite,
    fontWeight: "600",
  },
});
