// screens/HomeScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

import { useAssets } from "../hooks/useAssets";
import { formatDateUS } from "../utils/format";

const HOME_HERO_ASPECT = 16 / 9;

/** Small reusable chip */
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

function normalizeMode(route) {
  const explicit = String(route?.params?.mode || "")
    .toLowerCase()
    .trim();
  if (explicit === "public" || explicit === "owner" || explicit === "pro")
    return explicit;
  if (route?.params?.qr) return "public";
  return "owner";
}

export default function HomeScreen({ navigation, route }) {
  const { assets: homes = [], loading, error, refetch } = useAssets("home");

  const [homePickerVisible, setHomePickerVisible] = useState(false);
  const [currentHomeId, setCurrentHomeId] = useState(null);

  const parentNav = navigation.getParent?.() || navigation;

  // --- MODE (NO HOOKS BELOW EARLY RETURNS) ---
  const mode = normalizeMode(route);
  const isPublicView = mode === "public";
  const isProView = mode === "pro";
  const isOwnerView = mode === "owner";

  // Refetch when focused
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Focus selected home if we were given focusAssetId
  useEffect(() => {
    const focusId = route?.params?.focusAssetId;

    if (focusId && homes.length > 0) {
      const match = homes.find((h) => h.id === focusId);
      if (match) {
        setCurrentHomeId(match.id);
        return;
      }
    }

    if (!currentHomeId && homes.length > 0) {
      setCurrentHomeId(homes[0]?.id);
    }
  }, [route?.params?.focusAssetId, homes, currentHomeId]);

  const currentHome =
    homes.find((h) => h.id === currentHomeId) || homes[0] || null;

  /* -------- NAV HELPERS -------- */

  const goToHomeSystems = () => {
    if (!currentHome?.id) return;
    navigation.navigate("MyHomeSystems", {
      homeId: currentHome.id,
      homeName: currentHome.name || "Home",
    });
  };

  const goToHomeStory = () => {
    if (!currentHome?.id) return;
    parentNav.navigate("HomeStory", { homeId: currentHome.id });
  };

  const goToHomeShowcase = () => {
    if (!currentHome?.id) return;
    parentNav.navigate("HomeShowcase", { homeId: currentHome.id });
  };

  const goToAddServiceRecord = () => {
    if (!currentHome?.id) return;
    parentNav.navigate("AddServiceRecord", {
      source: "home",
      assetId: currentHome.id,
      assetName: currentHome.name || "Home",
    });
  };

  const goToEditHome = () => {
    if (!currentHome?.id) return;
    parentNav.navigate("EditAsset", { assetId: currentHome.id });
  };

  const goToAddHome = () => {
    parentNav.navigate("EditAsset", { assetType: "home" });
  };

  const handleSelectHome = (homeId) => {
    setCurrentHomeId(homeId);
    setHomePickerVisible(false);
  };

  /* -------- Public actions -------- */

  const handleRequestMoreInfo = () => {
    Alert.alert(
      "Request sent",
      "We’ll let the owner know you’d like to see more about this home."
    );
  };

  // ✅ Web-safe: skip Alert confirm on web (it can be flaky) and navigate immediately.
  const handleImKeeprPro = () => {
    if (!currentHome?.id) return;

    if (Platform.OS === "web") {
      goToAddServiceRecord();
      return;
    }

    Alert.alert(
      "Keepr Pro",
      "Add a service record for this home?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add service", onPress: goToAddServiceRecord },
      ],
      { cancelable: true }
    );
  };

  /* -------- EARLY RETURNS (SAFE: NO HOOKS AFTER THIS POINT) -------- */

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text>Loading your home…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: "red", textAlign: "center" }}>
            Error loading home: {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!homes.length) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ textAlign: "center", marginBottom: spacing.md }}>
            You don’t have a home set up yet. Add a home asset to get started.
          </Text>
          <TouchableOpacity
            style={styles.emptyAddButton}
            onPress={goToAddHome}
            activeOpacity={0.9}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.brandBlue}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.emptyAddButtonText}>Add a home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ----- Everything below is render-only (no hooks) -----

  const home = currentHome;
  const heroImage = home?.hero_image_url ? { uri: home.hero_image_url } : null;
  const homeDisplayName = home?.name || "Home";
  const kac = home?.kac_id || "";
  const location = home?.location || "";

  // Safe meta (public hides sensitive fields)
  const metaLines = [];
  if (home?.year_built) metaLines.push(`Year built: ${home.year_built}`);
  if (home?.square_feet)
    metaLines.push(`Size: ${Number(home.square_feet).toLocaleString()} sq ft`);
  if (home?.beds) metaLines.push(`Bedrooms: ${home.beds}`);
  if (home?.baths) metaLines.push(`Bathrooms: ${home.baths}`);

  if (isOwnerView) {
    if (home?.purchase_price)
      metaLines.push(
        `Purchase price: $${Number(home.purchase_price).toLocaleString()}`
      );
    if (home?.estimated_value)
      metaLines.push(
        `Estimated value: $${Number(home.estimated_value).toLocaleString()}`
      );
    if (home?.purchase_date)
      metaLines.push(`Purchased: ${formatDateUS(home.purchase_date)}`);
  }

  const ownerQuickActions = [
    {
      key: "story",
      icon: "book-outline",
      label: "Story",
      onPress: goToHomeStory,
    },
    {
      key: "showcase",
      icon: "images-outline",
      label: "Showcase",
      onPress: goToHomeShowcase,
    },
    {
      key: "systems",
      icon: "construct-outline",
      label: "Systems",
      onPress: goToHomeSystems,
    },
    {
      key: "add",
      icon: "hammer-outline",
      label: "Add service",
      onPress: goToAddServiceRecord,
    },
    {
      key: "edit",
      icon: "create-outline",
      label: "Edit",
      onPress: goToEditHome,
    },
  ];

  const publicQuickActions = [
    {
      key: "overview",
      icon: "information-circle-outline",
      label: "Overview",
      onPress: () => {},
    },
    {
      key: "request",
      icon: "chatbubble-ellipses-outline",
      label: "Request info",
      onPress: handleRequestMoreInfo,
    },
    {
      key: "pro",
      icon: "shield-checkmark-outline",
      label: "I’m a Keepr Pro",
      onPress: handleImKeeprPro,
    },
    {
      key: "owner",
      icon: "lock-open-outline",
      label: "Owner? Story",
      onPress: goToHomeStory,
    },
  ];

  const proQuickActions = [
    {
      key: "add",
      icon: "hammer-outline",
      label: "Add service",
      onPress: goToAddServiceRecord,
    },
    {
      key: "systems",
      icon: "construct-outline",
      label: "Systems",
      onPress: goToHomeSystems,
    },
    {
      key: "owner",
      icon: "lock-open-outline",
      label: "Owner? Story",
      onPress: goToHomeStory,
    },
  ];

  const quickActions = isOwnerView
    ? ownerQuickActions
    : isProView
    ? proQuickActions
    : publicQuickActions;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          {navigation.canGoBack() && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle}>
              {isOwnerView
                ? "My Home"
                : isProView
                ? "Service view"
                : "About this home"}
            </Text>
            <Text style={styles.appSubtitle}>
              {isOwnerView
                ? "Your home, its systems, and the work that keeps it running."
                : isProView
                ? "Log work quickly and keep history accurate."
                : "High-level details and a maintenance snapshot for sharing."}
            </Text>
          </View>
        </View>

        {/* Home row */}
        <View style={styles.homeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeLabel}>
              {isOwnerView ? "Home" : "Home snapshot"}
            </Text>
            <Text style={styles.homeSubtitle} numberOfLines={1}>
              {homeDisplayName}
              {location ? ` · ${location}` : ""}
            </Text>

            {!!kac && (
              <View style={styles.kacRow}>
                <Text style={styles.kacLabel}>Verified Asset ID</Text>
                <View style={styles.kacBadge}>
                  <Ionicons
                    name="qr-code-outline"
                    size={12}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.kacText}>{kac}</Text>
                </View>
              </View>
            )}
          </View>

          {isOwnerView && (
            <TouchableOpacity
              style={styles.addHomeCircle}
              onPress={goToAddHome}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color={colors.brandWhite} />
            </TouchableOpacity>
          )}

          {isOwnerView && homes.length > 1 && (
            <TouchableOpacity
              style={styles.homePickerButton}
              onPress={() => setHomePickerVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons
                name="home-outline"
                size={14}
                color={colors.textPrimary}
              />
              <Text style={styles.homePickerButtonText} numberOfLines={1}>
                {homeDisplayName}
              </Text>
              <Ionicons
                name="chevron-down"
                size={14}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Quick actions */}
        <View style={styles.quickActionsRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {quickActions.map((qa) => (
              <QuickActionChip
                key={qa.key}
                icon={qa.icon}
                label={qa.label}
                onPress={qa.onPress}
              />
            ))}
          </ScrollView>
        </View>

        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroImageWrap}>
            {heroImage ? (
              <Image
                source={heroImage}
                style={styles.heroImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.heroPlaceholder}>
                <Ionicons
                  name="home-outline"
                  size={28}
                  color={colors.brandWhite}
                />
                <Text style={styles.heroPlaceholderText}>
                  {isOwnerView
                    ? "Add a photo to track upgrades, condition, and resale value."
                    : "A photo helps show condition and upgrades over time."}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.heroFooter}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>{homeDisplayName}</Text>
              {!!location && <Text style={styles.heroMeta}>{location}</Text>}
            </View>
          </View>
        </View>

        {/* About */}
        {metaLines.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About this home</Text>
            <View style={styles.metaCard}>
              {metaLines.map((line, idx) => (
                <Text key={String(idx)} style={styles.metaLine}>
                  {line}
                </Text>
              ))}
              {!isOwnerView && (
                <Text style={styles.metaHint}>
                  Some details are visible to the owner only.
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Home picker modal */}
      {isOwnerView && (
        <Modal
          visible={homePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setHomePickerVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Select home</Text>
                <TouchableOpacity onPress={() => setHomePickerVisible(false)}>
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {homes.map((h) => {
                  const isActive = h.id === home.id;
                  return (
                    <TouchableOpacity
                      key={h.id}
                      style={[
                        styles.modalHomeRow,
                        isActive && styles.modalHomeRowActive,
                      ]}
                      onPress={() => handleSelectHome(h.id)}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name="home-outline"
                        size={18}
                        color={isActive ? colors.textPrimary : colors.textMuted}
                      />
                      <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                        <Text style={styles.modalHomeName} numberOfLines={1}>
                          {h.name || "Home"}
                        </Text>
                        {!!h.location && (
                          <Text style={styles.modalHomeMeta} numberOfLines={1}>
                            {h.location}
                          </Text>
                        )}
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
      )}
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
    alignItems: "center",
  },
  backButton: {
    marginRight: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: 4,
  },
  appTitle: { ...typography.title },
  appSubtitle: { ...typography.subtitle },

  homeRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  homeLabel: { ...typography.sectionLabel },
  homeSubtitle: { fontSize: 12, color: colors.textSecondary },

  kacRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  kacLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  kacBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  kacText: { fontSize: 11, color: colors.textPrimary, fontWeight: "700" },

  addHomeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },

  homePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.surfaceSubtle,
    maxWidth: 180,
  },
  homePickerButtonText: {
    fontSize: 12,
    color: colors.textPrimary,
    marginHorizontal: spacing.xs,
    flexShrink: 1,
  },

  quickActionsRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
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

  heroCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  heroImageWrap: { width: "100%", aspectRatio: HOME_HERO_ASPECT },
  heroImage: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    paddingHorizontal: spacing.md,
  },
  heroPlaceholderText: {
    textAlign: "center",
    fontSize: 11,
    color: colors.brandWhite,
    marginTop: spacing.xs,
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  heroTitle: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  heroMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  section: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  sectionLabel: { ...typography.sectionLabel, marginBottom: spacing.xs },

  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  metaLine: { fontSize: 13, color: colors.textPrimary, paddingVertical: 3 },
  metaHint: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },

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
    alignItems: "center",
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  modalHomeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalHomeRowActive: { backgroundColor: colors.surfaceSubtle },
  modalHomeName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  modalHomeMeta: { fontSize: 12, color: colors.textMuted },
});
