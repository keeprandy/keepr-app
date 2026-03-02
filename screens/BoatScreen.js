// screens/BoatScreen.js
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

const BOAT_HERO_ASPECT = 16 / 9;

// Small reusable chip for top-right quick actions
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

export default function BoatScreen({ navigation, route }) {
  const {
    assets: boats = [],
    loading,
    error,
    refetch,
  } = useAssets("boat");

  const [boatPickerVisible, setBoatPickerVisible] = useState(false);
  const [currentBoatId, setCurrentBoatId] = useState(null);

  // Helper to reach root stack screens like AddMarineAsset
  const parentNav = navigation.getParent?.() || navigation;

  // Refetch when screen regains focus
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Default / focus logic (supports focusAssetId from EditAssetScreen)
  useEffect(() => {
    const focusId = route?.params?.focusAssetId;

    if (focusId && boats.length > 0) {
      const match = boats.find((b) => b.id === focusId);
      if (match) {
        setCurrentBoatId(match.id);
        return;
      }
    }

    if (!currentBoatId && boats.length > 0) {
      setCurrentBoatId(boats[0]?.id);
    }
  }, [route?.params?.focusAssetId, boats, currentBoatId]);

  const currentBoat =
    boats.find((b) => b.id === currentBoatId) || boats[0] || null;

  const boatHeroImage = currentBoat?.hero_image_url
    ? { uri: currentBoat.hero_image_url }
    : null;

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("RootTabs", { screen: "Dashboard" });
    }
  };

  const handleSelectBoat = (boatId) => {
    setCurrentBoatId(boatId);
    setBoatPickerVisible(false);
  };

  const goToEditBoat = () => {
    if (currentBoat?.id) {
      navigation.navigate("EditAsset", { assetId: currentBoat.id });
    } else {
      navigation.navigate("EditAsset", { assetType: "boat" });
    }
  };

  // ✅ Use the Marine MVP creation flow (KAC + systems + story)
  const goToAddBoat = () => {
    parentNav.navigate("AddMarineAsset");
  };

  const goToBoatStory = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatStory", { boatId: currentBoat.id });
  };

  // Boat systems navigation (uses current boat id + name)
  const goToBoatSystems = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatSystems", {
      boatId: currentBoat.id,
      boatName: currentBoat.name || "Boat",
    });
  };

  // Showcase navigation
  const goToBoatShowcase = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("BoatShowcase", { boatId: currentBoat.id });
  };

  // Add service record from anywhere
  const goToAddServiceRecord = () => {
    if (!currentBoat?.id) return;
    navigation.navigate("AddServiceRecord", {
      source: "boat",
      assetId: currentBoat.id,
      boatId: currentBoat.id,
      assetName: currentBoat.name,
    });
  };

  // Loading / error / empty states
  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text>Loading your boats…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading boats: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentBoat) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center", marginBottom: spacing.md }}>
            You don’t have any boats yet. Add a type="boat" asset to get
            started.
          </Text>
          <TouchableOpacity
            style={styles.emptyAddButton}
            onPress={goToAddBoat}
            activeOpacity={0.9}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.brandBlue}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.emptyAddButtonText}>Add a boat</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --------- About this boat metadata ----------
  const boatMeta = {
    year: currentBoat.year,
    make: currentBoat.make,
    model: currentBoat.model,
    hullMaterial: currentBoat.hull_material,
    lengthFeet: currentBoat.length_feet,
    engineType: currentBoat.engine_type,
    hours: currentBoat.engine_hours,
    registrationNumber: currentBoat.registration_number,
    estValue: currentBoat.estimated_value,
    purchasePrice: currentBoat.purchase_price,
    purchaseDate: currentBoat.purchase_date,
    location: currentBoat.location,
  };

  const hasMeta =
    boatMeta.year ||
    boatMeta.make ||
    boatMeta.model ||
    boatMeta.hullMaterial ||
    boatMeta.lengthFeet ||
    boatMeta.engineType ||
    boatMeta.hours ||
    boatMeta.registrationNumber ||
    boatMeta.estValue ||
    boatMeta.purchasePrice ||
    boatMeta.purchaseDate ||
    boatMeta.location;

  const formatMoney = (v) =>
    typeof v === "number" ? `$${v.toLocaleString()}` : v;

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
            <Text style={styles.appTitle}>My Boat</Text>
            <Text style={styles.appSubtitle}>
              Track your boats, their systems, and everything that keeps you on
              the water.
            </Text>
          </View>
        </View>

        {/* Boat selector row */}
        <View style={styles.boatPickerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.boatPickerLabel}>Boat</Text>
            <Text style={styles.boatPickerSubtitle}>
              {currentBoat.name}
              {boatMeta.location ? ` · ${boatMeta.location}` : ""}
            </Text>
          </View>

          {/* NEW: add boat round button */}
          <TouchableOpacity
            style={styles.addBoatCircle}
            onPress={goToAddBoat}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color={colors.brandWhite} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.boatPickerButton}
            onPress={() => setBoatPickerVisible(true)}
            activeOpacity={0.85}
          >
            <Ionicons
              name="boat-outline"
              size={14}
              color={colors.textPrimary}
            />
            <Text style={styles.boatPickerButtonText}>
              {currentBoat.name}
            </Text>
            <Ionicons
              name="chevron-down"
              size={14}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Quick actions strip */}
        <View style={styles.quickActionsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsScroll}
          >
            <QuickActionChip
              icon="book-outline"
              label="Story & timeline"
              onPress={goToBoatStory}
            />
            <QuickActionChip
              icon="images-outline"
              label="Showcase"
              onPress={goToBoatShowcase}
            />
            <QuickActionChip
              icon="hammer-outline"
              label="Add service"
              onPress={goToAddServiceRecord}
            />
            <QuickActionChip
              icon="construct-outline"
              label="Systems"
              onPress={goToBoatSystems}
            />
            <QuickActionChip
              icon="create-outline"
              label="Edit details"
              onPress={goToEditBoat}
            />
          </ScrollView>
        </View>

        {/* Boat hero card */}
        <View style={styles.boatHeroCard}>
          <View style={styles.boatHeroImageWrap}>
            {boatHeroImage ? (
              <Image
                source={boatHeroImage}
                style={styles.boatHeroImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.boatHeroPlaceholder}>
                <Ionicons
                  name="boat-outline"
                  size={28}
                  color={colors.brandWhite}
                />
                <Text style={styles.boatHeroPlaceholderText}>
                  Add a photo of this boat to track upgrades, condition, and
                  resale value.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.boatHeroFooter}>
            <View style={{ flex: 1 }}>
              <Text style={styles.boatHeroTitle}>{currentBoat.name}</Text>
              {boatMeta.location ? (
                <Text style={styles.boatHeroMeta}>{boatMeta.location}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* About this boat */}
        {hasMeta ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About this boat</Text>
            <View style={styles.metaCard}>
              {boatMeta.year ? (
                <Text style={styles.metaLine}>Year: {boatMeta.year}</Text>
              ) : null}
              {boatMeta.make ? (
                <Text style={styles.metaLine}>Make: {boatMeta.make}</Text>
              ) : null}
              {boatMeta.model ? (
                <Text style={styles.metaLine}>Model: {boatMeta.model}</Text>
              ) : null}
              {boatMeta.lengthFeet ? (
                <Text style={styles.metaLine}>
                  Length: {boatMeta.lengthFeet} ft
                </Text>
              ) : null}
              {boatMeta.hullMaterial ? (
                <Text style={styles.metaLine}>
                  Hull: {boatMeta.hullMaterial}
                </Text>
              ) : null}
              {boatMeta.engineType ? (
                <Text style={styles.metaLine}>
                  Engine: {boatMeta.engineType}
                </Text>
              ) : null}
              {boatMeta.hours ? (
                <Text style={styles.metaLine}>
                  Hours: {boatMeta.hours.toLocaleString()}
                </Text>
              ) : null}
              {boatMeta.registrationNumber ? (
                <Text style={styles.metaLine}>
                  Registration: {boatMeta.registrationNumber}
                </Text>
              ) : null}
              {boatMeta.purchasePrice ? (
                <Text style={styles.metaLine}>
                  Purchase price: {formatMoney(boatMeta.purchasePrice)}
                </Text>
              ) : null}
              {boatMeta.estValue ? (
                <Text style={styles.metaLine}>
                  Estimated value: {formatMoney(boatMeta.estValue)}
                </Text>
              ) : null}
              {boatMeta.purchaseDate ? (
                <Text style={styles.metaLine}>
                  Purchased: {formatDateUS(boatMeta.purchaseDate)}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Boat picker modal */}
      <Modal
        visible={boatPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBoatPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select boat</Text>
              <TouchableOpacity onPress={() => setBoatPickerVisible(false)}>
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
              {boats.map((boat) => {
                const isActive = boat.id === currentBoatId;
                return (
                  <TouchableOpacity
                    key={boat.id}
                    style={[
                      styles.modalBoatRow,
                      isActive && styles.modalBoatRowActive,
                    ]}
                    onPress={() => handleSelectBoat(boat.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="boat-outline"
                      size={18}
                      color={
                        isActive ? colors.textPrimary : colors.textMuted
                      }
                    />
                    <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                      <Text style={styles.modalBoatName}>{boat.name}</Text>
                      <Text style={styles.modalBoatMeta}>
                        {boat.location ?? ""}
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

  boatPickerRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  boatPickerLabel: { ...typography.sectionLabel },
  boatPickerSubtitle: { fontSize: 12, color: colors.textSecondary },

  // NEW: blue add-boat circle
  addBoatCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },

  boatPickerButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.chipBackground,
  },
  boatPickerButtonText: {
    fontSize: 12,
    color: colors.textPrimary,
    marginHorizontal: spacing.xs,
  },

  // Quick actions strip
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

  boatHeroCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  boatHeroImageWrap: { width: "100%", aspectRatio: BOAT_HERO_ASPECT },
  boatHeroImage: { width: "100%", height: "100%" },
  boatHeroPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    paddingHorizontal: spacing.md,
  },
  boatHeroPlaceholderText: {
    textAlign: "center",
    fontSize: 11,
    color: colors.brandWhite,
    marginTop: spacing.xs,
  },
  boatHeroFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  boatHeroTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  boatHeroMeta: {
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
  modalBoatRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalBoatRowActive: {
    backgroundColor: colors.surfaceSubtle,
  },
  modalBoatName: {
    fontSize: 14,
    fontWeight: "600",
  },
  modalBoatMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
