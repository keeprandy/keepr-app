// screens/GarageScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { formatDateUS } from "../utils/format";

const VEHICLE_HERO_ASPECT = 16 / 9;

// Small reusable chip for top quick actions – mirrors BoatScreen
const QuickActionChip = ({ icon, label, onPress }) => (
  <TouchableOpacity
    style={styles.quickActionChip}
    onPress={onPress}
    activeOpacity={0.9}
  >
    <Ionicons
      name={icon}
      size={14}
      color={colors.textSecondary}
      style={{ marginRight: 4 }}
    />
    <Text style={styles.quickActionLabel}>{label}</Text>
  </TouchableOpacity>
);

export default function GarageScreen({ navigation, route }) {
  const {
    assets: vehicles = [],
    loading,
    error,
    refetch,
  } = useAssets("vehicle");

  const [vehiclePickerVisible, setVehiclePickerVisible] = useState(false);
  const [currentVehicleId, setCurrentVehicleId] = useState(null);

  // Refetch when screen regains focus
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Default / focus logic (supports focusAssetId from EditAssetScreen)
  useEffect(() => {
    const focusId = route?.params?.focusAssetId;

    if (focusId && vehicles.length > 0) {
      const match = vehicles.find((v) => v.id === focusId);
      if (match) {
        setCurrentVehicleId(match.id);
        return;
      }
    }

    if (!currentVehicleId && vehicles.length > 0) {
      setCurrentVehicleId(vehicles[0]?.id);
    }
  }, [route?.params?.focusAssetId, vehicles, currentVehicleId]);

  const currentVehicle =
    vehicles.find((v) => v.id === currentVehicleId) || vehicles[0] || null;

  const vehicleHeroImage = currentVehicle?.hero_image_url
    ? { uri: currentVehicle.hero_image_url }
    : null;

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("RootTabs", { screen: "Dashboard" });
    }
  };

  const handleSelectVehicle = (vehicleId) => {
    setCurrentVehicleId(vehicleId);
    setVehiclePickerVisible(false);
  };

  const goToEditVehicle = () => {
    if (currentVehicle?.id) {
      navigation.navigate("EditAsset", { assetId: currentVehicle.id });
    } else {
      navigation.navigate("EditAsset", { assetType: "vehicle" });
    }
  };

  const goToAddVehicle = () => {
    navigation.navigate("EditAsset", { assetType: "vehicle" });
  };

  const goToVehicleStory = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("VehicleStory", { vehicleId: currentVehicle.id });
  };

  const goToVehicleSystems = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("VehicleSystems", {
      vehicleId: currentVehicle.id,
      vehicleName:
        currentVehicle.name ||
        [currentVehicle.year, currentVehicle.make, currentVehicle.model]
          .filter(Boolean)
          .join(" ") ||
        "Vehicle",
    });
  };

  const goToVehicleShowcase = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("VehicleShowcase", { vehicleId: currentVehicle.id });
  };

  const buildVehicleDisplayName = () =>
    currentVehicle?.name ||
    [currentVehicle?.year, currentVehicle?.make, currentVehicle?.model]
      .filter(Boolean)
      .join(" ") ||
    "Vehicle";

  const goToAddServiceRecord = () => {
    if (!currentVehicle?.id) return;
    navigation.navigate("AddServiceRecord", {
      source: "vehicle",
      assetId: currentVehicle.id,
      vehicleId: currentVehicle.id,
      assetName: buildVehicleDisplayName(),
    });
  };

  // Loading / error / empty states
  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text>Loading your garage…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading vehicles: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentVehicle) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center", marginBottom: spacing.md }}>
            You don’t have any vehicles yet. Add a type="vehicle" asset to get
            started.
          </Text>
          <TouchableOpacity
            style={styles.emptyAddButton}
            onPress={goToAddVehicle}
            activeOpacity={0.9}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.brandBlue}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.emptyAddButtonText}>Add a vehicle</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --------- About this vehicle metadata ----------
  const vehicleMeta = {
    year: currentVehicle.year,
    make: currentVehicle.make,
    model: currentVehicle.model,
    trim: currentVehicle.trim,
    bodyStyle: currentVehicle.body_style,
    engine: currentVehicle.engine,
    drivetrain: currentVehicle.drivetrain,
    transmission: currentVehicle.transmission,
    color: currentVehicle.color,
    odometer: currentVehicle.current_odometer,
    vin: currentVehicle.vin,
    plate: currentVehicle.plate_number,
    estValue: currentVehicle.estimated_value,
    purchasePrice: currentVehicle.purchase_price,
    purchaseDate: currentVehicle.purchase_date,
    location: currentVehicle.location,
  };

  const hasMeta =
    vehicleMeta.year ||
    vehicleMeta.make ||
    vehicleMeta.model ||
    vehicleMeta.trim ||
    vehicleMeta.bodyStyle ||
    vehicleMeta.engine ||
    vehicleMeta.drivetrain ||
    vehicleMeta.transmission ||
    vehicleMeta.color ||
    vehicleMeta.odometer != null ||
    vehicleMeta.vin ||
    vehicleMeta.plate ||
    vehicleMeta.estValue != null ||
    vehicleMeta.purchasePrice != null ||
    vehicleMeta.purchaseDate ||
    vehicleMeta.location;

  const formatMoney = (v) =>
    typeof v === "number" ? `$${v.toLocaleString()}` : v;

  const vehicleDisplayName = buildVehicleDisplayName();

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
            <Ionicons
              name="chevron-back"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>My Garage</Text>
            <Text style={styles.appSubtitle}>
              Track your cars, trucks, bikes, and toys – and everything that
              keeps them on the road.
            </Text>
          </View>
        </View>

        {/* Vehicle selector row – mirrors BoatScreen boat picker */}
        <View style={styles.vehiclePickerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehiclePickerLabel}>Vehicle</Text>
            <Text style={styles.vehiclePickerSubtitle}>
              {vehicleDisplayName}
              {vehicleMeta.location ? ` · ${vehicleMeta.location}` : ""}
            </Text>
          </View>

          {/* Blue add-vehicle circle */}
          <TouchableOpacity
            style={styles.addVehicleCircle}
            onPress={goToAddVehicle}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color={colors.brandWhite} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.vehiclePickerButton}
            onPress={() => setVehiclePickerVisible(true)}
            activeOpacity={0.85}
          >
            <Ionicons
              name="car-sport-outline"
              size={14}
              color={colors.textPrimary}
            />
            <Text style={styles.vehiclePickerButtonText}>
              {vehicleDisplayName}
            </Text>
            <Ionicons
              name="chevron-down"
              size={14}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Quick actions strip – same pattern as BoatScreen */}
        <View style={styles.quickActionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsScroll}
          >
            <QuickActionChip
              icon="book-outline"
              label="Story & timeline"
              onPress={goToVehicleStory}
            />
            <QuickActionChip
              icon="images-outline"
              label="Showcase"
              onPress={goToVehicleShowcase}
            />
            <QuickActionChip
              icon="hammer-outline"
              label="Add service"
              onPress={goToAddServiceRecord}
            />
            <QuickActionChip
              icon="construct-outline"
              label="Systems"
              onPress={goToVehicleSystems}
            />
            <QuickActionChip
              icon="create-outline"
              label="Edit details"
              onPress={goToEditVehicle}
            />
          </ScrollView>
        </View>

        {/* Vehicle hero card */}
        <View style={styles.vehicleHeroCard}>
          <View style={styles.vehicleHeroImageWrap}>
            {vehicleHeroImage ? (
              <Image
                source={vehicleHeroImage}
                style={styles.vehicleHeroImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.vehicleHeroPlaceholder}>
                <Ionicons
                  name="car-sport-outline"
                  size={28}
                  color={colors.brandWhite}
                />
                <Text style={styles.vehicleHeroPlaceholderText}>
                  Add a photo of this vehicle to track upgrades, condition, and
                  resale value.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.vehicleHeroFooter}>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleHeroTitle}>{vehicleDisplayName}</Text>
              {vehicleMeta.location ? (
                <Text style={styles.vehicleHeroMeta}>
                  {vehicleMeta.location}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* About this vehicle */}
        {hasMeta ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About this vehicle</Text>
            <View style={styles.metaCard}>
              {vehicleMeta.year ? (
                <Text style={styles.metaLine}>Year: {vehicleMeta.year}</Text>
              ) : null}
              {vehicleMeta.make ? (
                <Text style={styles.metaLine}>Make: {vehicleMeta.make}</Text>
              ) : null}
              {vehicleMeta.model ? (
                <Text style={styles.metaLine}>Model: {vehicleMeta.model}</Text>
              ) : null}
              {vehicleMeta.trim ? (
                <Text style={styles.metaLine}>Trim: {vehicleMeta.trim}</Text>
              ) : null}
              {vehicleMeta.bodyStyle ? (
                <Text style={styles.metaLine}>
                  Body style: {vehicleMeta.bodyStyle}
                </Text>
              ) : null}
              {vehicleMeta.engine ? (
                <Text style={styles.metaLine}>
                  Engine: {vehicleMeta.engine}
                </Text>
              ) : null}
              {vehicleMeta.drivetrain ? (
                <Text style={styles.metaLine}>
                  Drivetrain: {vehicleMeta.drivetrain}
                </Text>
              ) : null}
              {vehicleMeta.transmission ? (
                <Text style={styles.metaLine}>
                  Transmission: {vehicleMeta.transmission}
                </Text>
              ) : null}
              {vehicleMeta.color ? (
                <Text style={styles.metaLine}>
                  Color: {vehicleMeta.color}
                </Text>
              ) : null}
              {vehicleMeta.odometer != null ? (
                <Text style={styles.metaLine}>
                  Odometer: {vehicleMeta.odometer.toLocaleString()} mi
                </Text>
              ) : null}
              {vehicleMeta.vin ? (
                <Text style={styles.metaLine}>VIN: {vehicleMeta.vin}</Text>
              ) : null}
              {vehicleMeta.plate ? (
                <Text style={styles.metaLine}>Plate: {vehicleMeta.plate}</Text>
              ) : null}
              {vehicleMeta.purchasePrice != null ? (
                <Text style={styles.metaLine}>
                  Purchase price: {formatMoney(vehicleMeta.purchasePrice)}
                </Text>
              ) : null}
              {vehicleMeta.estValue != null ? (
                <Text style={styles.metaLine}>
                  Estimated value: {formatMoney(vehicleMeta.estValue)}
                </Text>
              ) : null}
              {vehicleMeta.purchaseDate ? (
                <Text style={styles.metaLine}>
                  Purchased: {formatDateUS(vehicleMeta.purchaseDate)}
                </Text>
              ) : null}
              {vehicleMeta.location ? (
                <Text style={styles.metaLine}>
                  Location: {vehicleMeta.location}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Vehicle picker modal – mirrors BoatScreen modal */}
      <Modal
        visible={vehiclePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVehiclePickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select vehicle</Text>
              <TouchableOpacity
                onPress={() => setVehiclePickerVisible(false)}
              >
                <Ionicons
                  name="close-outline"
                  size={22}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: spacing.sm }}
            >
              {vehicles.map((v) => {
                const isActive = v.id === currentVehicleId;
                const name =
                  v.name ||
                  [v.year, v.make, v.model].filter(Boolean).join(" ");
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.modalVehicleRow,
                      isActive && styles.modalVehicleRowActive,
                    ]}
                    onPress={() => handleSelectVehicle(v.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="car-sport-outline"
                      size={18}
                      color={
                        isActive ? colors.textPrimary : colors.textMuted
                      }
                    />
                    <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                      <Text style={styles.modalVehicleName}>
                        {name || "Vehicle"}
                      </Text>
                      <Text style={styles.modalVehicleMeta}>
                        {v.location ?? ""}
                      </Text>
                    </View>
                    {isActive && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.accentGreen}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---- STYLES ---- */
const styles = StyleSheet.create({
  scrollContent: { paddingBottom: spacing.xl },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
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
  appTitle: { ...typography.title },
  appSubtitle: { ...typography.subtitle },

  vehiclePickerRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  vehiclePickerLabel: { ...typography.sectionLabel },
  vehiclePickerSubtitle: { fontSize: 12, color: colors.textSecondary },

  addVehicleCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },

  vehiclePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.chipBackground,
  },
  vehiclePickerButtonText: {
    fontSize: 12,
    color: colors.textPrimary,
    marginHorizontal: spacing.xs,
  },

  // Quick actions strip – same as BoatScreen
  quickActionsRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  quickActionsScroll: {
    paddingVertical: 2,
  },
  quickActionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: spacing.xs,
  },
  quickActionLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "500",
  },

  vehicleHeroCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  vehicleHeroImageWrap: { width: "100%", aspectRatio: VEHICLE_HERO_ASPECT },
  vehicleHeroImage: { width: "100%", height: "100%" },
  vehicleHeroPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    paddingHorizontal: spacing.md,
  },
  vehicleHeroPlaceholderText: {
    textAlign: "center",
    fontSize: 11,
    color: colors.brandWhite,
    marginTop: spacing.xs,
  },
  vehicleHeroFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  vehicleHeroTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  vehicleHeroMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionLabel: { ...typography.sectionLabel, marginBottom: spacing.xs },

  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  metaLine: {
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 3,
  },

  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  emptyAddButtonText: {
    fontSize: 14,
    color: colors.brandBlue,
    fontWeight: "600",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalVehicleRowActive: {
    backgroundColor: colors.surfaceSubtle,
  },
  modalVehicleName: {
    fontSize: 14,
    fontWeight: "600",
  },
  modalVehicleMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
