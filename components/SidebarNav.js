import React, { useMemo, useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CommonActions } from "@react-navigation/native";

import { colors, spacing, radius } from "../styles/theme";
import { navigationRef } from "../navigationRoot";
import { supabase } from "../lib/supabaseClient";
import { subscribeToNotificationEvents } from "../lib/notificationsService";
import { useAuth } from "../context/AuthContext";
import appLogo from "../assets/app_logo_icon.png"; // ✅ Keepr™ logo

/** Consumer menu (RootTabs) */
const CONSUMER_ITEMS = [
  { key: "Dashboard", label: "Dashboard", icon: "grid-outline" },
  { key: "SuperKeeprStack", label: "SuperKeepr", icon: "business-outline" },
  { key: "KeeprProStack", label: "KeeprPro", icon: "briefcase-outline" },
  { key: "MyHome", label: "Homes", icon: "home-outline" },
  { key: "Garage", label: "Garage", icon: "car-outline" },
  { key: "Boats", label: "Boats", icon: "boat-outline" },
  { key: "OtherAssets", label: "Other Assets", icon: "cube-outline" },
  { key: "Notifications", label: "Actions Inbox", icon: "notifications-outline" },
  { key: "Messages", label: "Messages", icon: "chatbubbles-outline" },
  { key: "MyHubs", label: "KeeprHubs", icon: "people-outline" },
  { key: "KeeprPros", label: "Keepr™ Pros", icon: "construct-outline" },
  { key: "PlanUpgrade", label: "Plan & Upgrade", icon: "pricetag-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
];

/** SuperKeepr menu (SuperKeeprStack) */
const SUPER_ITEMS = [
  { key: "SuperKeeprDashboard", label: "Portfolio", icon: "business-outline" },
  { key: "Notifications", label: "Event Inbox", icon: "notifications-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
  { key: "__exit__", label: "Exit SuperKeepr", icon: "log-out-outline" },
];

const KEEPRPRO_ITEMS = [
  { key: "KeeprProHome", label: "Wilson Marine", icon: "briefcase-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
  { key: "__exit__", label: "Exit KeeprPro", icon: "log-out-outline" },
];

const NAV_PERSIST_KEY = "keepr.nav.state.v1";
const KEEPRPRO_HOME_PATH = "/pro-mode";

function returnToKeeprProHomeOnWeb() {
  if (Platform.OS !== "web") return false;

  try {
    window?.sessionStorage?.removeItem(NAV_PERSIST_KEY);
  } catch {}

  try {
    const path = window?.location?.pathname || "";
    if (path === KEEPRPRO_HOME_PATH) {
      window.location.reload();
    } else {
      window.location.assign(KEEPRPRO_HOME_PATH);
    }
    return true;
  } catch {
    return false;
  }
}

function formatBadgeCount(n) {
  if (!n || n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
}

/**
 * Safely get the deepest (leaf) route name
 */
function getLeafRouteNameSafe() {
  try {
    if (!navigationRef?.isReady?.() || !navigationRef.isReady()) return null;
    const root = navigationRef.getRootState?.();
    if (!root || !root.routes || typeof root.index !== "number") return null;

    let route = root.routes[root.index];
    while (route?.state?.routes && typeof route.state.index === "number") {
      route = route.state.routes[route.state.index];
    }
    return route?.name || null;
  } catch {
    return null;
  }
}

/** map routeName -> section highlight */
function normalizeToSection(routeName) {
  if (!routeName) return "Dashboard";

if (routeName === "SuperKeeprDashboard" || routeName === "SuperKeeprStack") {
  return "SuperKeeprStack";
}  

if (
  routeName === "KeeprProHome" ||
  routeName === "KeeprProStack"
) {
  return "KeeprProHome";
}

if (routeName === "KeeprProStewardshipView" || routeName === "KeeprProActionDetail") {
  return routeName;
}

  if (
    routeName === "MyHome" ||
    routeName === "HomeStory" ||
    routeName === "HomeShowcase" ||
    routeName === "MyHomeSystems" ||
    routeName === "HomeSystemStory" ||
    routeName === "HomePublic" ||
    routeName === "TimelineRecord" ||
    routeName === "HomeScreen"
    
  ) {
    return "MyHome";
  }

  if (
    routeName === "Garage" ||
    routeName === "VehicleStory" ||
    routeName === "VehicleShowcase" ||
    routeName === "VehicleSystems" ||
    routeName === "Vehicle" ||
    routeName === "Vehicles"
  ) {
    return "Garage";
  }

  if (
    routeName === "Boats" ||
    routeName === "BoatStory" ||
    routeName === "BoatShowcase" ||
    routeName === "BoatSystems" ||
    routeName === "Boat"
  ) {
    return "Boats";
  }

  if (
  routeName === "OtherAssets" ||
  routeName === "OtherAssetStory" ||
  routeName === "OtherAssetShowcase" ||
  routeName === "AddAsset" ||
  routeName === "AssetGroupDashboard"
) {
  return "OtherAssets";
}

if (
  routeName === "Notifications" ||
  routeName === "EventInbox" ||
  routeName === "Inbox" ||
  routeName === "Notification" ||
  routeName?.includes("Inbox") ||
  routeName?.includes("Notification")
) {
  return "Notifications";
}
if (routeName === "Messages" || routeName === "KeeprAction") {
  return "Messages";
}
if (
  routeName === "MyHubs" ||
  routeName === "HubDetail" ||
  routeName === "EditHub" ||
  routeName === "ManageHubStories" ||
  routeName === "InviteHubMembers"
) {
  return "MyHubs";
}

  if (routeName === "KeeprPros") return "KeeprPros";
  if (routeName === "Settings") return "Settings";
  if (routeName === "Dashboard") return "Dashboard";
  if (routeName === "PlanUpgrade") return "PlanUpgrade";

  return "Dashboard";
}

export default function SidebarNav({ currentRouteName }) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [userRole, setUserRole] = useState(null);

useEffect(() => {
  let active = true;

  const loadRole = async () => {
    if (!userId) {
      if (active) setUserRole(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (!active) return;
      if (error) {
        setUserRole(null);
        return;
      }

      setUserRole(data?.role || null);
    } catch {
      if (active) setUserRole(null);
    }
  };

  loadRole();

  return () => {
    active = false;
  };
}, [userId]);

  const [leafRouteName, setLeafRouteName] = useState(null);
  const [inboxCount, setInboxCount] = useState(0);

  const [isCollapsed, setIsCollapsed] = useState(false);

  // Persist sidebar collapse on web (no extra dependency)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      const v = window?.localStorage?.getItem("keepr.sidebar.collapsed");
      if (v === "1") setIsCollapsed(true);
    } catch {}
  }, []);

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      if (Platform.OS === "web") {
        try {
          window?.localStorage?.setItem("keepr.sidebar.collapsed", next ? "1" : "0");
        } catch {}
      }
      return next;
    });
  };

  /**
   * Sync route highlight once navigation is ready.
   * On web refresh, SidebarNav can mount before NavigationContainer is ready.
   * We wait briefly for navigationRef to become ready, then subscribe to state changes.
   */
  useEffect(() => {
    let unsub = null;
    let readyTimer = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      if (!navigationRef?.isReady?.() || !navigationRef.isReady()) return;

      const leaf = getLeafRouteNameSafe();
      if (leaf) setLeafRouteName(leaf);

      try {
        unsub = navigationRef.addListener("state", () => {
          const next = getLeafRouteNameSafe();
          if (next) setLeafRouteName(next);
        });
      } catch {
        // ignore
      }
    };

    // Try immediately
    attach();

    // If not ready yet, poll briefly (startup / refresh only)
    if (!navigationRef?.isReady?.() || !navigationRef.isReady()) {
      readyTimer = setInterval(() => {
        if (navigationRef?.isReady?.() && navigationRef.isReady()) {
          clearInterval(readyTimer);
          readyTimer = null;
          attach();
        }
      }, 100);
      // Safety stop after 5s
      setTimeout(() => {
        if (readyTimer) {
          clearInterval(readyTimer);
          readyTimer = null;
        }
      }, 5000);
    }

    return () => {
      cancelled = true;
      if (readyTimer) {
        clearInterval(readyTimer);
        readyTimer = null;
      }
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const activeKey = useMemo(
    () => normalizeToSection(leafRouteName || currentRouteName),
    [leafRouteName, currentRouteName]
  );

  const inSuperKeepr = useMemo(() => {
    const rn = String(leafRouteName || currentRouteName || "");
    return rn === "SuperKeeprDashboard" || rn.startsWith("SuperKeepr");
  }, [leafRouteName, currentRouteName]);

  const inKeeprPro = useMemo(() => {
    const rn = String(leafRouteName || currentRouteName || "");
    return (
      rn === "KeeprProHome" ||
      rn === "KeeprProStewardshipView" ||
      rn === "KeeprProActionDetail" ||
      rn === "KeeprProStack"
    );
  }, [leafRouteName, currentRouteName]);

const navItems = useMemo(() => {
  if (inSuperKeepr) return SUPER_ITEMS;
  if (inKeeprPro) return KEEPRPRO_ITEMS;

  if (userRole === "superkeepr" || userRole === "keeprpro") return CONSUMER_ITEMS;

  return CONSUMER_ITEMS.filter(
    (item) => item.key !== "SuperKeeprStack" && item.key !== "KeeprProStack"
  );
}, [inSuperKeepr, inKeeprPro, userRole]);

    // Public View SideBar Collapse
  const isPublicFlow = useMemo(() => {
  const rn = String(leafRouteName || currentRouteName || "");
  return rn === "PublicAction" || rn === "KacRoute" || rn === "KacResolve";
}, [leafRouteName, currentRouteName]);

  const fetchInboxCount = useCallback(async () => {
    if (!userId) return;
    try {
      const { count } = await supabase
        .from("inbox_items")
        .select("id", { count: "exact", head: true })
        .eq("to_user_id", userId)
        .eq("status", "pending");

      setInboxCount(count || 0);
    } catch {
      // ignore
    }
  }, [userId]);

  useEffect(() => {
    fetchInboxCount();
    const t = setInterval(fetchInboxCount, 15000);
    return () => clearInterval(t);
  }, [fetchInboxCount]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToNotificationEvents({
      userId,
      onEvent: () => fetchInboxCount(),
    });
  }, [fetchInboxCount, userId]);

  const badgeText = useMemo(() => formatBadgeCount(inboxCount), [inboxCount]);

  /**
   * SAFE navigation wrapper
   */
  const go = (key) => {
  if (key === "KeeprProStack" || key === "KeeprProHome") {
    if (returnToKeeprProHomeOnWeb()) return;
  }

  if (!navigationRef?.isReady?.() || !navigationRef.isReady()) return;

  try {
    if (key === "__exit__") {
      navigationRef.navigate("RootTabs", { screen: "Dashboard" });
      return;
    }

    if (key === "PlanUpgrade") {
      navigationRef.navigate("PlanUpgrade");
      return;
    }

    if (key === "SuperKeeprStack") {
      navigationRef.navigate("SuperKeeprStack", {
        screen: "SuperKeeprDashboard",
      });
      return;
    }

    if (key === "KeeprProStack") {
      navigationRef.navigate("KeeprProStack", {
        screen: "KeeprProHome",
      });
      return;
    }

    if (key === "KeeprProHome") {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "KeeprProStack",
              state: {
                index: 0,
                routes: [{ name: "KeeprProHome" }],
              },
            },
          ],
        })
      );
      return;
    }

    if (inSuperKeepr) {
      navigationRef.navigate("SuperKeeprStack", { screen: key });
      return;
    }

    if (inKeeprPro) {
      navigationRef.navigate("KeeprProStack", { screen: key });
      return;
    }

    if (key === "OtherAssets") {
  navigationRef.navigate("AssetGroupDashboard", { assetType: "other" });
  return;
}

if (key === "MyHubs") {
  navigationRef.navigate("MyHubs");
  return;
}

if (key === "Messages") {
  navigationRef.navigate("RootTabs", { screen: "Messages", params: { scope: "global" } });
  return;
}

    navigationRef.navigate("RootTabs", { screen: key });
  } catch {
    // no-op
  }
};

if (isPublicFlow) return null;
  return (
    <View
      style={[styles.shell, isCollapsed && styles.shellCollapsed]}
      className="keepr-sidebar no-print"
      data-sidebar="1"
      role="navigation"
    >
      <View style={[styles.brandRow, isCollapsed && styles.brandRowCollapsed]}>
        <View style={[styles.brandIconWrap, isCollapsed && styles.brandIconWrapCollapsed]}>
          <Image source={appLogo} style={styles.brandIconImg} />
        </View>

        {!isCollapsed ? (
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>Keepr™</Text>
            <Text style={styles.brandSub}>
              {inSuperKeepr
                ? "SuperKeepr portfolio"
                : inKeeprPro
                ? "KeeprPro portfolio"
                : "Asset Lifecycle Intelligence"}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={toggleCollapsed}
          style={styles.collapseBtn}
          activeOpacity={0.85}
          accessibilityLabel={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Ionicons name={isCollapsed ? "chevron-forward" : "chevron-back"} size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={styles.navList}>
        {navItems.map((item) => {
          const isActive = item.key === activeKey;

          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.navItem, isActive && styles.navItemActive, isCollapsed && styles.navItemCollapsed]}
              onPress={() => go(item.key)}
              activeOpacity={0.85}
            >
              <View style={[styles.navIcon, isCollapsed && styles.navIconCollapsed]}>
                <Ionicons name={item.icon} size={18} color={isActive ? "#E5E7EB" : "#9CA3AF"} />
              </View>

              {!isCollapsed ? (
                <Text style={[styles.navLabel, isActive && styles.navLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              ) : null}

              {item.key === "Notifications" && badgeText ? (
                isCollapsed ? (
                  <View style={styles.badgeDot}>
                    <Text style={styles.badgeDotText}>{badgeText}</Text>
                  </View>
                ) : (
                  <View style={styles.badgePill}>
                    <Text style={styles.badgeText}>{badgeText}</Text>
                  </View>
                )
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <View style={[styles.footerRow, isCollapsed && styles.footerRowCollapsed]}>
          <Ionicons name="person-circle-outline" size={22} color="#9CA3AF" />
          {!isCollapsed ? (
            <Text style={styles.footerText} numberOfLines={1}>
              {user?.email || "Signed out"}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: 280,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    borderRightWidth: 1,
    borderRightColor: "#0F172A",
    backgroundColor: "#1f2c46ff",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#797a7cff",
  },
  brandIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(44, 95, 204, 0)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
    overflow: "hidden",
  },
  brandIconWrapCollapsed: {
    marginRight: 0,
  },
  brandIconImg: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#E5E7EB",
  },
  brandSub: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 2,
  },
  navList: { flex: 1, paddingTop: spacing.sm },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    marginBottom: 6,
  },
  navItemActive: {
    backgroundColor: "#365aaaff",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  navIcon: { width: 26, alignItems: "center", marginRight: spacing.sm },
  navLabel: { flex: 1, fontSize: 14, color: "#dcdfe4ff", fontWeight: "600" },
  navLabelActive: { color: "#E5E7EB" },
  badgePill: {
    minWidth: 22,
    paddingHorizontal: 8,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  badgeText: { fontSize: 11, color: "white", fontWeight: "800" },

  shellCollapsed: {
    width: 76,
    paddingHorizontal: 10,
  },
  brandRowCollapsed: {
    justifyContent: "flex-start",
  },
  collapseBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "#0F172A",
    marginLeft: "auto",
  },
  navItemCollapsed: {
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  navIconCollapsed: {
    width: "auto",
    marginRight: 0,
  },
  badgeDot: {
    position: "absolute",
    right: 8,
    top: 8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDotText: { fontSize: 10, color: "white", fontWeight: "900" },
  footerRowCollapsed: {
    justifyContent: "center",
  },

  footer: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "#0F172A" },
  footerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  footerText: { marginLeft: spacing.xs, fontSize: 12, color: "#9CA3AF", flex: 1 },
});
