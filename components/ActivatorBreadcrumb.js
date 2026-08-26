import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { navigationRef } from "../navigationRoot";
import { colors, radius, shadows, spacing } from "../styles/theme";

function webPathForRoute(route, params = {}) {
  if (route === "ActivatorHome") {
    const nextParams = {
      initialMode: params.initialMode || "fleet",
      navSection: params.navSection || (params.initialMode === "templates" ? "ActivatorTemplates" : params.initialMode === "builds" ? "ActivatorBuilds" : "ActivatorFleet"),
      organizationId: params.organizationId || null,
      workspaceId: params.workspaceId || null,
    };
    const query = new URLSearchParams();
    Object.entries(nextParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    return `/activator?${query.toString()}`;
  }

  if (route === "KeeprSpaceFleet") {
    const query = new URLSearchParams();
    if (params.organizationId) query.set("organizationId", String(params.organizationId));
    if (params.workspaceId) query.set("workspaceId", String(params.workspaceId));
    return `/workspace/fleet${query.toString() ? `?${query.toString()}` : ""}`;
  }

  return null;
}

function navigateCrumb(navigation, route, params = {}) {
  const webPath = Platform.OS === "web" ? webPathForRoute(route, params) : null;
  if (webPath) {
    try {
      const current = `${window.location.pathname || ""}${window.location.search || ""}`;
      if (current !== webPath) window.location.assign(webPath);
      return;
    } catch {}
  }

  if (navigationRef?.isReady?.()) {
    navigationRef.navigate(route, params);
    return;
  }

  const parent = navigation?.getParent?.();
  if (parent?.navigate) {
    parent.navigate(route, params);
    return;
  }

  navigation?.navigate?.(route, params);
}

export default function ActivatorBreadcrumb({
  navigation,
  current = "Home",
  items = [],
  homeRoute = "ActivatorHome",
  homeParams = null,
  right = null,
}) {
  const goHome = () => navigateCrumb(navigation, homeRoute, homeParams || {});

  return (
    <View style={styles.shell}>
      <View style={styles.crumbs}>
        <TouchableOpacity onPress={goHome} activeOpacity={0.84} style={styles.homeButton}>
          <Ionicons name="home-outline" size={15} color={colors.brandNavy} />
          <Text style={styles.homeText}>Activator Home</Text>
        </TouchableOpacity>
        {items.map((item) => (
          <React.Fragment key={item.label}>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            {item.route ? (
              <TouchableOpacity
                onPress={() => navigateCrumb(navigation, item.route, item.params || {})}
                activeOpacity={0.84}
                style={styles.crumbButton}
              >
                <Text style={styles.crumbText}>{item.label}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.crumbText}>{item.label}</Text>
            )}
          </React.Fragment>
        ))}
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        <Text style={styles.currentText}>{current}</Text>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  crumbs: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    minWidth: 0,
  },
  homeButton: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  homeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  crumbButton: {
    minHeight: 28,
    justifyContent: "center",
  },
  crumbText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  currentText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  right: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
});
