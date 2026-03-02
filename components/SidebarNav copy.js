// components/SidebarNav.js
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, typography } from "../styles/theme";
import { navigationRef } from "../navigationRoot";

const NAV_ITEMS = [
  {
    key: "Dashboard",
    label: "Home",
    icon: "grid-outline",
    activeIcon: "grid",
  },
  {
    key: "MyHome",
    label: "My Home",
    icon: "home-outline",
    activeIcon: "home",
  },
  {
    key: "Garage",
    label: "Garage",
    icon: "car-outline",
    activeIcon: "car",
  },
  {
    key: "Boats",
    label: "Boats",
    icon: "boat-outline",
    activeIcon: "boat",
  },
  {
    key: "KeeprPros",
    label: "Keepr Pros",
    icon: "shield-checkmark-outline",
    activeIcon: "shield-checkmark",
  },
  {
    key: "Settings",
    label: "Settings",
    icon: "settings-outline",
    activeIcon: "settings",
  },
];

// Map deep route names → the tab key we want active
function mapRouteToSection(routeName) {
  if (!routeName) return null;

  // Home tab
  if (
    routeName === "MyHome" ||
    routeName.startsWith("MyHome") ||
    routeName.startsWith("HomeSystem")
  ) {
    return "MyHome";
  }

  // Garage / vehicles
  if (routeName === "Garage" || routeName.startsWith("Vehicle")) {
    return "Garage";
  }

  // Boats / marine
  if (routeName === "Boats" || routeName === "Boat" || routeName.startsWith("Boat")) {
    return "Boats";
  }

  // Keepr Pros
  if (routeName === "KeeprPros" || routeName.startsWith("KeeprPro")) {
    return "KeeprPros";
  }

  // Dashboard & Settings map 1:1
  if (routeName === "Dashboard") return "Dashboard";
  if (routeName === "Settings") return "Settings";

  return routeName;
}

export default function SidebarNav({ currentRouteName }) {
  const activeKey = mapRouteToSection(currentRouteName);

  const handlePress = (tabKey) => {
    if (!navigationRef.isReady()) return;
    navigationRef.navigate("RootTabs", { screen: tabKey });
  };

  return (
    <View style={styles.container}>
      {/* Brand / logo */}
      <View style={styles.brandRow}>
        <View style={styles.brandLogoWrap}>
          <Image
            // 👇 update this path/filename if your logo lives somewhere else
            source={require("../assets/app_logo_icon.png")}
            style={styles.brandLogo}
            resizeMode="contain"
          />
        </View>
        <View>
          <Text style={styles.brandTitle}>Keepr</Text>
          <Text style={styles.brandSubtitle}>
            Asset story & service hub
          </Text>
        </View>
      </View>

      {/* Nav items */}
      <View style={styles.navSection}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeKey === item.key;
          const iconName = isActive ? item.activeIcon : item.icon;

          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.navItem, isActive && styles.navItemActive]}
              onPress={() => handlePress(item.key)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={iconName}
                size={18}
                color={
                  isActive ? colors.brandWhite : colors.textSecondary
                }
                style={{ marginRight: spacing.sm }}
              />
              <Text
                style={[
                  styles.navLabel,
                  isActive && styles.navLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 240,
    backgroundColor: "#020617",
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  brandLogoWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  brandLogo: {
    width: 36,
    height: 36,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.brandWhite,
  },
  brandSubtitle: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  navSection: {
    marginTop: spacing.sm,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: 2,
  },
  navItemActive: {
    backgroundColor: "#0F172A",
  },
  navLabel: {
    fontSize: 14,
    color: "#9CA3AF",
  },
  navLabelActive: {
    color: colors.brandWhite,
    fontWeight: "600",
  },
});
