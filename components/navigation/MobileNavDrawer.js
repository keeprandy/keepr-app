import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { INBOX_MODES, navigateToInbox } from "../../lib/inboxNavigation";
import { colors, radius, spacing } from "../../styles/theme";
import appLogo from "../../assets/app_logo_icon.png";

const DRAWER_ITEMS = [
  { key: "Dashboard", label: "Dashboard", icon: "grid-outline" },
  { key: "MyHome", label: "Homes", icon: "home-outline" },
  { key: "Garage", label: "Garage", icon: "car-outline" },
  { key: "Boats", label: "Boats", icon: "boat-outline" },
  { key: "OtherAssets", label: "Other Assets", icon: "cube-outline" },
  { key: "Notifications", label: "Actions Inbox", icon: "notifications-outline", mode: INBOX_MODES.ACTIONS },
  { key: "Messages", label: "Messages", icon: "chatbubbles-outline", mode: INBOX_MODES.MESSAGES },
  { key: "MyHubs", label: "KeeprHubs", icon: "people-outline" },
  { key: "KeeprPros", label: "Keepr Pros", icon: "construct-outline" },
  { key: "PlanUpgrade", label: "Plan & Upgrade", icon: "pricetag-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
];

function formatBadge(count) {
  const n = Number(count || 0);
  if (!n) return null;
  return n > 99 ? "99+" : String(n);
}

export default function MobileNavDrawer({
  visible,
  onClose,
  navigation,
  actionsCount = 0,
  messagesCount = 0,
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawerWidth = Math.min(Math.round(width * 0.84), 360);
  const [mounted, setMounted] = useState(visible);
  const slideProgress = useRef(new Animated.Value(0)).current;

  const closeDrawer = () => {
    Animated.timing(slideProgress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setMounted(false);
      onClose?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -48) closeDrawer();
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideProgress.setValue(0);
      Animated.timing(slideProgress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(slideProgress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setMounted(false));
  }, [slideProgress, visible]);

  const badges = useMemo(
    () => ({
      Notifications: formatBadge(actionsCount),
      Messages: formatBadge(messagesCount),
    }),
    [actionsCount, messagesCount]
  );

  const go = (item) => {
    const parent = navigation?.getParent?.() || navigation;
    closeDrawer();
    if (!parent?.navigate) return;

    if (item.mode) {
      navigateToInbox(parent, item.mode);
      return;
    }
    if (item.key === "OtherAssets") {
      parent.navigate("AssetGroupDashboard", { assetType: "other" });
      return;
    }
    if (item.key === "MyHubs") {
      parent.navigate("MyHubs");
      return;
    }
    if (item.key === "PlanUpgrade") {
      parent.navigate("PlanUpgrade");
      return;
    }
    if (item.key === "Settings") {
      parent.navigate("Settings");
      return;
    }
    parent.navigate("RootTabs", { screen: item.key });
  };

  if (!mounted) return null;

  const drawerTranslateX = slideProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });

  const backdropOpacity = slideProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={closeDrawer}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDrawer} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawerShell,
            {
              width: drawerWidth,
              transform: [{ translateX: drawerTranslateX }],
            },
          ]}
          {...panResponder.panHandlers}
        >
        <View
          style={[
            styles.drawer,
            {
              paddingTop: Math.max(insets.top, spacing.lg),
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Image source={appLogo} style={styles.brandLogo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.brandTitle}>Keepr™</Text>
              <Text style={styles.brandSubtitle}>Asset Lifecycle Intelligence</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={closeDrawer} accessibilityRole="button" accessibilityLabel="Close navigation">
              <Ionicons name="close-outline" size={22} color="#CBD5E1" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
            {DRAWER_ITEMS.map((item) => (
              <TouchableOpacity key={item.key} style={styles.navItem} onPress={() => go(item)} activeOpacity={0.86}>
                <View style={styles.navIcon}>
                  <Ionicons name={item.icon} size={20} color="#CBD5E1" />
                </View>
                <Text style={styles.navLabel}>{item.label}</Text>
                {badges[item.key] ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badges[item.key]}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.38)",
  },
  drawerShell: {
    height: "100%",
    backgroundColor: "#1f2c46ff",
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 8, height: 0 },
    elevation: 14,
    overflow: "hidden",
  },
  drawer: {
    flex: 1,
    backgroundColor: "#1f2c46ff",
    paddingHorizontal: spacing.md,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#797a7cff",
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(44, 95, 204, 0)",
    overflow: "hidden",
  },
  brandLogo: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  brandTitle: {
    color: "#E5E7EB",
    fontSize: 18,
    fontWeight: "900",
  },
  brandSubtitle: {
    marginTop: 2,
    color: "#9CA3AF",
    fontSize: 11,
    fontWeight: "700",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "#0F172A",
  },
  navList: {
    paddingVertical: spacing.sm,
    gap: 4,
  },
  navItem: {
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  navIcon: {
    width: 26,
    alignItems: "center",
  },
  navLabel: {
    flex: 1,
    color: "#dcdfe4ff",
    fontSize: 15,
    fontWeight: "700",
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    paddingHorizontal: 7,
  },
  badgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },
});
