import React, { useMemo, useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CommonActions } from "@react-navigation/native";

import { colors, spacing, radius } from "../styles/theme";
import { navigationRef } from "../navigationRoot";
import { supabase } from "../lib/supabaseClient";
import { subscribeToNotificationEvents } from "../lib/notificationsService";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
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

const KEEPR_ADMIN_ITEM = { key: "KeeprAdminHome", label: "Keepr Admin", icon: "shield-checkmark-outline" };

/** SuperKeepr menu (SuperKeeprStack) */
const SUPER_ITEMS = [
  { key: "SuperKeeprDashboard", label: "Portfolio", icon: "business-outline" },
  { key: "Notifications", label: "Event Inbox", icon: "notifications-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
  { key: "__exit__", label: "Exit SuperKeepr", icon: "log-out-outline" },
];

const WORKSPACE_NAV_CONFIG = {
  keeproem: [
    { key: "ActivatorOverview", label: "Overview", icon: "home-outline", initialMode: "needs", navSection: "ActivatorOverview" },
    { key: "ActivatorTemplates", label: "Product Catalog", icon: "library-outline", initialMode: "templates", navSection: "ActivatorTemplates" },
    { key: "SystemLibrary", label: "System Library", icon: "albums-outline", navSection: "ActivatorSystemLibrary" },
    { key: "ActivatorFind", label: "Fleet / Installed Base", icon: "boat-outline", initialMode: "fleet", navSection: "ActivatorFind" },
    { key: "ActivatorDealerNetwork", label: "Dealer Network", icon: "people-outline", initialMode: "connect", navSection: "ActivatorDealerNetwork" },
    { key: "ActivatorSuppliers", label: "Suppliers", icon: "git-network-outline", initialMode: "connect", navSection: "ActivatorSuppliers" },
    { key: "ActivatorResources", label: "Resources / Knowledge", icon: "documents-outline", initialMode: "templates", navSection: "ActivatorResources" },
    { key: "ActivatorWarranty", label: "Warranty / Programs", icon: "shield-checkmark-outline", initialMode: "builds", navSection: "ActivatorWarranty" },
    { key: "ActivatorAiContext", label: "AI Context / KeeprLINK", icon: "sparkles-outline", initialMode: "templates", navSection: "ActivatorAiContext" },
    { key: "ActivatorIntelligence", label: "Intelligence", icon: "analytics-outline", initialMode: "messages", navSection: "ActivatorIntelligence" },
    { key: "OrgIdentity", label: "Profile / Identity", icon: "person-circle-outline", initialMode: "profile", navSection: "OrgIdentity", secondary: true },
    { key: "KeeprSpaceAdmin", label: "Settings", icon: "settings-outline", initialMode: "profile", navSection: "KeeprSpaceAdmin", secondary: true },
  ],
  keeprdealer: [
    { key: "KeeprSpaceHome", label: "Overview", icon: "storefront-outline" },
    { key: "KeeprSpaceFleet", label: "Inventory / Boats", icon: "boat-outline" },
    { key: "DealerCustomers", label: "Customers", icon: "people-outline" },
    { key: "DealerService", label: "Service", icon: "construct-outline" },
    { key: "DealerStorage", label: "Storage", icon: "archive-outline" },
    { key: "KeeprSpaceActivator", label: "Brands", icon: "pricetag-outline" },
    { key: "DealerSystemsResources", label: "Systems / Resources", icon: "albums-outline" },
    { key: "KeeprSpacePlaybooks", label: "Actions", icon: "list-outline" },
    { key: "DealerAiContext", label: "AI Context / KeeprLINK", icon: "sparkles-outline" },
    { key: "DealerIntelligence", label: "Intelligence", icon: "analytics-outline" },
    { key: "OrgIdentity", label: "Profile / Identity", icon: "person-circle-outline", secondary: true },
    { key: "KeeprSpaceAdmin", label: "Settings", icon: "settings-outline", secondary: true },
  ],
  keeprpro: [
    { key: "KeeprSpaceHome", label: "Home", icon: "briefcase-outline" },
    { key: "KeeprSpaceFleet", label: "Fleet", icon: "boat-outline" },
    { key: "KeeprSpaceMessages", label: "Messages", icon: "chatbubbles-outline" },
    { key: "KeeprSpacePlaybooks", label: "Playbooks", icon: "list-outline" },
    { key: "KeeprSpaceActivator", label: "Activator", icon: "add-circle-outline" },
    { key: "KeeprSpaceAdmin", label: "Settings", icon: "settings-outline", secondary: true },
  ],
};

function workspaceLabel(workspace) {
  return workspace?.display_name || workspace?.name || workspace?.label || "Workspace";
}

function workspaceModeLabel(workspace) {
  switch (workspace?.workspace_type) {
    case "keeproem":
      return `${workspaceLabel(workspace)} OEM`;
    case "keeprdealer":
      return `${workspaceLabel(workspace)} Dealer`;
    case "keeprpro":
      return `${workspaceLabel(workspace)} Service`;
    default:
      return "Asset Lifecycle Intelligence";
  }
}

function workspaceOrganizationId(workspace) {
  const workspaceId = String(workspace?.workspace_id || workspace?.id || "");
  return (
    workspace?.organization_id ||
    workspace?.org_id ||
    workspace?.authority?.organization_id ||
    workspace?.authority?.org_id ||
    workspace?.authority?.subject_id ||
    (workspaceId.startsWith("org:") ? workspaceId.slice(4) : null) ||
    null
  );
}

function workspaceMatchesOrganization(workspace, organizationId) {
  const orgId = String(organizationId || "");
  if (!workspace || !orgId) return false;

  return (
    workspaceOrganizationId(workspace) === orgId ||
    workspace.workspace_id === `org:${orgId}` ||
    workspace.id === `org:${orgId}`
  );
}

function navItemsForWorkspace(workspace) {
  const type = workspace?.workspace_type;
  return WORKSPACE_NAV_CONFIG[type] || null;
}

function firstActivatorWorkspace(workspaces = [], currentWorkspace) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const requestedWorkspaceId = params.get("workspaceId");
      const requestedOrganizationId = params.get("organizationId");
      if (requestedOrganizationId) {
        const requestedOrgWorkspace = workspaces.find((workspace) =>
          workspaceMatchesOrganization(workspace, requestedOrganizationId) &&
          workspace.workspace_type &&
          workspace.workspace_type !== "keepr"
        );
        if (requestedOrgWorkspace) return requestedOrgWorkspace;
      }
      if (requestedWorkspaceId) {
        const requestedWorkspace = workspaces.find((workspace) =>
          workspace.workspace_id === requestedWorkspaceId || workspace.id === requestedWorkspaceId
        );
        if (requestedWorkspace?.workspace_type && requestedWorkspace.workspace_type !== "keepr") {
          return requestedWorkspace;
        }
      }
    } catch {}
  }

  if (currentWorkspace?.workspace_type && currentWorkspace.workspace_type !== "keepr") {
    return currentWorkspace;
  }

  return workspaces.find((workspace) =>
    ["keeproem", "keeprdealer", "keeprpro"].includes(workspace?.workspace_type)
  ) || currentWorkspace;
}

function orgWorkspaces(workspaces = []) {
  return workspaces.filter((workspace) =>
    ["keeproem", "keeprdealer", "keeprpro"].includes(workspace?.workspace_type)
  );
}

function iconForWorkspace(workspace) {
  if (workspace?.workspace_type === "keeproem") return "business-outline";
  if (workspace?.workspace_type === "keeprdealer") return "storefront-outline";
  return "briefcase-outline";
}

function destinationForWorkspace(workspace) {
  if (["keeproem", "keeprdealer", "keeprpro"].includes(workspace?.workspace_type)) {
    return "KeeprSpaceModule";
  }
  return "PersonalModule";
}

function personalWorkspace(workspaces = []) {
  return workspaces.find((workspace) => workspace?.workspace_type === "keepr");
}

function activatorModeForSidebarKey(key, workspace) {
  const configItem = WORKSPACE_NAV_CONFIG[workspace?.workspace_type]?.find((item) => item.key === key);
  if (configItem?.initialMode) return configItem.initialMode;

  if (key === "ActivatorOverview") return "needs";
  if (key === "ActivatorDealerNetwork" || key === "ActivatorSuppliers") return "connect";
  if (key === "ActivatorResources" || key === "ActivatorAiContext") return "templates";
  if (key === "ActivatorWarranty") return "builds";
  if (key === "ActivatorIntelligence") return "messages";
  if (key === "OrgIdentity") return "profile";
  if (key === "KeeprSpaceAdmin" || key === "WilsonAdmin") return "profile";
  if (key === "KeeprSpaceMessages" || key === "WilsonMessages") return "messages";
  if (key === "KeeprSpaceFleet" || key === "WilsonFleet") return "fleet";
  if (key === "KeeprSpaceActivator" || key === "KeeprSpaceAddBoat") return "addBoat";
  if (key === "KeeprSpaceHome" || key === "WilsonHome") return workspace?.workspace_type === "keeprpro" ? "needs" : "fleet";
  if (key === "KeeprSpaceAdmin") return "profile";
  if (key === "ActivatorMessages" || key === "Messages") {
    return workspace?.workspace_type === "keeprpro" ? "messages" : "fleet";
  }
  if (key === "ActivatorFind") return "fleet";
  if (key === "ActivatorAdd") return "addBoat";
  if (key === "ActivatorConnect") return "connect";
  if (key === "ActivatorWork") return "builds";
  if (key === "ActivatorEngage") return "messages";
  if (key === "ActivatorFleet") return "fleet";
  if (key === "ActivatorBuilds") return "builds";
  if (key === "ActivatorTemplates") return "templates";
  if (key === "ActivatorHome") return workspace?.workspace_type === "keeprpro" ? "needs" : "fleet";
  if (key === "DealerCustomers" || key === "DealerService" || key === "DealerStorage") return "fleet";
  if (key === "DealerSystemsResources" || key === "DealerAiContext") return "fleet";
  if (key === "DealerIntelligence") return "messages";
  return "fleet";
}

function activatorNavSectionForSidebarKey(key) {
  const configItem = Object.values(WORKSPACE_NAV_CONFIG)
    .flat()
    .find((item) => item.key === key);
  if (configItem?.navSection) return configItem.navSection;

  if (key === "ActivatorOverview") return "ActivatorOverview";
  if (key === "ActivatorFind") return "ActivatorFind";
  if (key === "ActivatorAdd") return "ActivatorAdd";
  if (key === "ActivatorConnect") return "ActivatorConnect";
  if (key === "ActivatorWork") return "ActivatorWork";
  if (key === "ActivatorEngage") return "ActivatorEngage";
  if (key === "ActivatorTemplates") return "ActivatorTemplates";
  if (key === "SystemLibrary") return "ActivatorSystemLibrary";
  if (key === "OrgIdentity") return "OrgIdentity";
  if (key === "KeeprSpaceAdmin") return "KeeprSpaceAdmin";
  return null;
}

function activatorWorkspaceFromRoute(workspace) {
  let urlWorkspaceId = null;
  let urlOrganizationId = null;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
    const searchParams = new URLSearchParams(window.location.search || "");
    urlWorkspaceId = searchParams.get("workspaceId");
    urlOrganizationId = searchParams.get("organizationId");
    } catch {}
  }

  const workspaceType = workspace?.workspace_type && workspace.workspace_type !== "keepr"
    ? workspace.workspace_type
    : urlWorkspaceId?.startsWith("org:")
    ? "keeproem"
    : workspace?.workspace_type;
  const workspaceId = workspace?.workspace_type && workspace.workspace_type !== "keepr"
    ? workspace.workspace_id
    : urlWorkspaceId?.startsWith("org:")
    ? urlWorkspaceId
    : urlOrganizationId
    ? `org:${urlOrganizationId}`
    : null;
  const orgId = workspaceOrganizationId(workspace) ||
    urlOrganizationId ||
    (workspaceId?.startsWith("org:") ? workspaceId.slice(4) : null);

  if (!workspaceId || workspaceType === "keepr") return null;
  return {
    ...workspace,
    workspace_id: workspaceId,
    workspace_type: workspaceType,
    organization_id: orgId,
  };
}

function activatorHrefForSidebarKey(key, workspace) {
  if (Platform.OS !== "web") return null;

  const routeWorkspace = activatorWorkspaceFromRoute(workspace);
  const workspaceId = routeWorkspace?.workspace_id;
  const orgId = workspaceOrganizationId(routeWorkspace);
  if (!workspaceId) return null;

  if (key === "SystemLibrary") {
    const params = new URLSearchParams();
    params.set("workspaceId", workspaceId);
    if (orgId) params.set("organizationId", orgId);
    params.set("navSection", "ActivatorSystemLibrary");
    return `/activator/system-library?${params.toString()}`;
  }

  if (key === "ActivatorAdd") {
    const params = new URLSearchParams();
    params.set("workspaceId", workspaceId);
    if (orgId) params.set("organizationId", orgId);
    params.set("initialMode", "addBoat");
    params.set("navSection", "ActivatorAdd");
    return `/activator?${params.toString()}`;
  }

  if (
    key === "ActivatorHome" ||
    key === "ActivatorFind" ||
    key === "ActivatorWork" ||
    key === "ActivatorEngage" ||
    key === "ActivatorConnect" ||
    key === "ActivatorFleet" ||
    key === "ActivatorMessages" ||
    key === "ActivatorBuilds" ||
    key === "ActivatorTemplates" ||
    key === "ActivatorOverview" ||
    key === "ActivatorDealerNetwork" ||
    key === "ActivatorSuppliers" ||
    key === "ActivatorResources" ||
    key === "ActivatorWarranty" ||
    key === "ActivatorAiContext" ||
    key === "ActivatorIntelligence" ||
    key === "OrgIdentity" ||
    key === "KeeprSpaceAdmin"
  ) {
    const params = new URLSearchParams();
    params.set("workspaceId", workspaceId);
    if (orgId) params.set("organizationId", orgId);
    params.set("initialMode", activatorModeForSidebarKey(key, routeWorkspace));
    params.set("navSection", activatorNavSectionForSidebarKey(key) || (
      activatorModeForSidebarKey(key, routeWorkspace) === "templates"
        ? "ActivatorTemplates"
        : "ActivatorFind"
    ));
    return `/activator?${params.toString()}`;
  }

  return null;
}

function normalizeActivatorJobSection(section) {
  if (section === "ActivatorFleet") return "ActivatorFind";
  if (section === "ActivatorBuilds") return "ActivatorWork";
  if (section === "ActivatorMessages") return "ActivatorEngage";
  return section;
}

const NAV_PERSIST_KEY = "keepr.nav.state.v1";
const KEEPRPRO_HOME_PATH = "/pro-mode";

function clearPersistedNavState() {
  if (Platform.OS !== "web") return;
  try {
    window?.sessionStorage?.removeItem(NAV_PERSIST_KEY);
  } catch {}
}

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

function replaceWebLocation(path, params = {}) {
  if (Platform.OS !== "web") return false;

  try {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    const nextUrl = `${path}${query.toString() ? `?${query.toString()}` : ""}`;
    const currentUrl = `${window.location.pathname || ""}${window.location.search || ""}`;
    if (currentUrl === nextUrl) return true;
    window.location.assign(nextUrl);
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

function getLeafRouteSafe() {
  try {
    if (!navigationRef?.isReady?.() || !navigationRef.isReady()) return null;
    const root = navigationRef.getRootState?.();
    if (!root || !root.routes || typeof root.index !== "number") return null;

    let route = root.routes[root.index];
    while (route?.state?.routes && typeof route.state.index === "number") {
      route = route.state.routes[route.state.index];
    }
    return route || null;
  } catch {
    return null;
  }
}

/** map routeName -> section highlight */
function normalizeToSection(routeName) {
  if (!routeName) return "Dashboard";

if (routeName === "KeeprAdminHome" || routeName === "KeeprAdminOrgDetail") {
  return "KeeprAdminHome";
}

if (routeName === "SuperKeeprDashboard" || routeName === "SuperKeeprStack") {
  return "SuperKeeprStack";
}  

if (
  routeName === "KeeprProHome" ||
  routeName === "KeeprProStack"
) {
  return "KeeprProHome";
}

if (routeName === "KeeprSpaceBoat" || routeName === "WilsonBoat") return "KeeprSpaceFleet";
if (routeName === "KeeprSpaceAddBoat") return "KeeprSpaceActivator";
if (
  routeName === "KeeprSpaceHome" ||
  routeName === "KeeprSpaceFleet" ||
  routeName === "KeeprSpaceActivator" ||
  routeName === "KeeprSpaceAddBoat" ||
  routeName === "KeeprSpaceMessages" ||
  routeName === "KeeprSpacePlaybooks" ||
  routeName === "KeeprSpaceAdmin" ||
  routeName === "KeeprSpaceSettings"
) {
  return routeName;
}
if (
  routeName === "WilsonHome" ||
  routeName === "WilsonFleet" ||
  routeName === "WilsonMessages" ||
  routeName === "WilsonAdmin" ||
  routeName === "WilsonSettings"
) {
  return routeName.replace("Wilson", "KeeprSpace");
}

if (routeName === "KeeprProStewardshipView" || routeName === "KeeprProActionDetail") {
  return "ActivatorFleet";
}

if (routeName === "ActivatorHome") return normalizeActivatorToSection(routeName, params);
if (routeName === "ActivatorBoatWorkspace") return "ActivatorFind";
if (routeName === "ActivatorCatalogTemplate" || routeName === "ActivatorTemplateCustomize") {
  return "ActivatorTemplates";
}
if (routeName === "ActivatorExactBuild") return "ActivatorWork";
if (routeName === "SystemLibrary") return "SystemLibrary";

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

function normalizeActivatorToSection(routeName, params = {}) {
  if (routeName === "ActivatorBoatWorkspace") return "ActivatorFind";
  if (routeName !== "ActivatorHome") return normalizeToSection(routeName);

  if (params?.navSection) return normalizeActivatorJobSection(params.navSection);

  switch (params?.initialMode) {
    case "messages":
      return "ActivatorEngage";
    case "profile":
      return "KeeprSpaceAdmin";
    case "addBoat":
      return "ActivatorAdd";
    case "connect":
      return "ActivatorConnect";
    case "network":
      return "ActivatorConnect";
    case "fleet":
      return "ActivatorFind";
    case "builds":
      return "ActivatorWork";
    case "templates":
      return "ActivatorTemplates";
    case "needs":
    default:
      return "ActivatorHome";
  }
}

function activeActivatorSectionFromWebLocation() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;

  try {
    const path = window.location.pathname || "";
    if (path.startsWith("/activator/build/")) return "ActivatorWork";
    if (path.startsWith("/activator/catalog/")) return "ActivatorTemplates";
    if (path !== "/activator") return null;

    const params = new URLSearchParams(window.location.search || "");
    const navSection = params.get("navSection");
    if (navSection) return normalizeActivatorJobSection(navSection);

    return normalizeActivatorToSection("ActivatorHome", {
      initialMode: params.get("initialMode") || null,
    });
  } catch {
    return null;
  }
}

export default function SidebarNav({ currentRouteName }) {
  const { user } = useAuth();
  const { currentWorkspace, setCurrentWorkspaceId, workspaces } = useWorkspace();
  const userId = user?.id || null;

  const [userRole, setUserRole] = useState(null);
  const [isInternalAdmin, setIsInternalAdmin] = useState(false);

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

useEffect(() => {
  let active = true;

  const loadInternalAdminAuthority = async () => {
    if (!userId) {
      if (active) setIsInternalAdmin(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("is_keepr_internal_admin", {
        p_user_id: userId,
      });

      if (!active) return;
      setIsInternalAdmin(!error && data === true);
    } catch {
      if (active) setIsInternalAdmin(false);
    }
  };

  loadInternalAdminAuthority();

  return () => {
    active = false;
  };
}, [user, userId, userRole]);

  const [leafRouteName, setLeafRouteName] = useState(null);
  const [leafRouteParams, setLeafRouteParams] = useState({});
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
      const route = getLeafRouteSafe();
      if (route?.params) setLeafRouteParams(route.params);

      try {
        unsub = navigationRef.addListener("state", () => {
          const nextRoute = getLeafRouteSafe();
          if (nextRoute?.name) setLeafRouteName(nextRoute.name);
          setLeafRouteParams(nextRoute?.params || {});
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

  const activeKey = useMemo(() => {
    const webSection = activeActivatorSectionFromWebLocation();
    if (webSection) return webSection;
    return normalizeActivatorToSection(leafRouteName || currentRouteName, leafRouteParams);
  }, [leafRouteName, currentRouteName, leafRouteParams]);

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

  const inActivator = useMemo(() => {
    const rn = String(leafRouteName || currentRouteName || "");
    return rn === "ActivatorHome" || rn.startsWith("Activator") || rn.startsWith("KeeprSpace");
  }, [leafRouteName, currentRouteName]);

  const sidebarWorkspace = useMemo(() => {
    return inActivator ? firstActivatorWorkspace(workspaces, currentWorkspace) : currentWorkspace;
  }, [currentWorkspace, inActivator, workspaces]);

  const workspaceNavItems = useMemo(() => orgWorkspaces(workspaces).map((workspace) => ({
    key: `workspace:${workspace.workspace_id}`,
    label: workspaceLabel(workspace),
    icon: iconForWorkspace(workspace),
    workspace,
  })), [workspaces]);

const navItems = useMemo(() => {
  const withInternalAdminMode = (items) => {
    if (!isInternalAdmin || items.some((item) => item.key === KEEPR_ADMIN_ITEM.key)) return items;
    return [
      ...items.slice(0, 1),
      KEEPR_ADMIN_ITEM,
      ...items.slice(1),
    ];
  };

  const workspaceItems = navItemsForWorkspace(sidebarWorkspace);
  if (workspaceItems) {
    return withInternalAdminMode(workspaceItems);
  }

  if (inSuperKeepr) return withInternalAdminMode(SUPER_ITEMS);
  if (inKeeprPro) {
    return withInternalAdminMode(navItemsForWorkspace({
      workspace_type: "keeprpro",
      display_name: "KeeprPro",
    }));
  }

  if (userRole === "superkeepr" || userRole === "keeprpro") {
    return withInternalAdminMode([
      ...CONSUMER_ITEMS.slice(0, 1),
      ...workspaceNavItems,
      ...CONSUMER_ITEMS.slice(1),
    ]);
  }

  const consumerItems = CONSUMER_ITEMS.filter(
    (item) => item.key !== "SuperKeeprStack" && item.key !== "KeeprProStack"
  );
  return withInternalAdminMode([
    ...consumerItems.slice(0, 1),
    ...workspaceNavItems,
    ...consumerItems.slice(1),
  ]);
}, [sidebarWorkspace, inSuperKeepr, inKeeprPro, isInternalAdmin, userRole, workspaceNavItems, workspaces]);

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
  if (key === "KeeprAdminHome") {
    clearPersistedNavState();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign("/keepr-admin");
      return;
    }
  }

  if (key === "KeeprProStack" || key === "KeeprProHome") {
    if (returnToKeeprProHomeOnWeb()) return;
  }

  if (!navigationRef?.isReady?.() || !navigationRef.isReady()) {
    console.warn("Sidebar navigation skipped because navigationRef is not ready", { key });
    return;
  }

  try {
    const isOrgWorkspace =
      sidebarWorkspace?.workspace_type && sidebarWorkspace.workspace_type !== "keepr";
    const resetToRoute = (name, params) => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name, params }],
        })
      );
    };
    const resetToPersonalModule = () => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "PersonalModule",
              state: {
                index: 0,
                routes: [
                  {
                    name: "PersonalTabs",
                    state: {
                      index: 0,
                      routes: [{ name: "Dashboard" }],
                    },
                  },
                ],
              },
            },
          ],
        })
      );
    };
    const resetToKeeprSpaceModule = (screen = "KeeprSpaceHome", params = {}, moduleWorkspaceId = sidebarWorkspace?.workspace_id || null) => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "KeeprSpaceModule",
              params: { workspaceId: moduleWorkspaceId },
              state: {
                index: 0,
                routes: [{ name: screen, params }],
              },
            },
          ],
        })
      );
    };
    const navigateActivatorMode = (initialMode = "fleet", targetWorkspace = sidebarWorkspace, navSectionOverride = null) => {
      const resolvedWorkspace = activatorWorkspaceFromRoute(targetWorkspace) || targetWorkspace;
      if (
        resolvedWorkspace?.workspace_id &&
        resolvedWorkspace.workspace_id !== currentWorkspace?.workspace_id
      ) {
        setCurrentWorkspaceId(resolvedWorkspace.workspace_id);
      }
      const params = {
        initialMode,
        navSection: navSectionOverride || (resolvedWorkspace?.workspace_type === "keeprpro" && initialMode === "needs"
          ? "ActivatorHome"
          : initialMode === "messages"
          ? "ActivatorEngage"
          : initialMode === "profile"
          ? "KeeprSpaceAdmin"
          : initialMode === "addBoat"
          ? "ActivatorAdd"
          : initialMode === "builds"
          ? "ActivatorWork"
          : initialMode === "templates"
          ? "ActivatorTemplates"
          : "ActivatorFind"),
        workspaceId: resolvedWorkspace?.workspace_id || null,
        organizationId: workspaceOrganizationId(resolvedWorkspace),
      };

      if (
        leafRouteName === "ActivatorHome" &&
        leafRouteParams?.initialMode === params.initialMode &&
        leafRouteParams?.navSection === params.navSection &&
        (leafRouteParams?.workspaceId || null) === (params.workspaceId || null)
      ) {
        return;
      }

      if (Platform.OS === "web") {
        if (replaceWebLocation("/activator", params)) return;
      }

      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "ActivatorHome", params }],
        })
      );
    };

    if (String(key).startsWith("workspace:")) {
      const workspaceId = String(key).slice("workspace:".length);
      const targetWorkspace = workspaces.find((workspace) => workspace.workspace_id === workspaceId);
      if (!targetWorkspace) return;
      setCurrentWorkspaceId(workspaceId);
      clearPersistedNavState();

      const destination = destinationForWorkspace(targetWorkspace);
      if (destination === "PersonalModule") {
        resetToPersonalModule();
      } else if (targetWorkspace.workspace_type === "keeproem") {
        navigateActivatorMode("fleet", targetWorkspace);
      } else {
        resetToKeeprSpaceModule("KeeprSpaceHome", { workspaceId }, workspaceId);
      }
      return;
    }

    if (key === "__exit__" || key === "PersonalKeepr") {
      const personal = workspaces.find((workspace) => workspace.workspace_type === "keepr");
      if (personal?.workspace_id) {
        setCurrentWorkspaceId(personal.workspace_id);
      }
      clearPersistedNavState();
      resetToPersonalModule();
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

    if (
      key === "KeeprSpaceHome" ||
      key === "KeeprSpaceFleet" ||
      key === "KeeprSpaceActivator" ||
      key === "KeeprSpaceAddBoat" ||
      key === "KeeprSpaceMessages" ||
      key === "KeeprSpacePlaybooks" ||
      key === "KeeprSpaceAdmin" ||
      key === "KeeprSpaceSettings" ||
      key === "WilsonHome" ||
      key === "WilsonFleet" ||
      key === "WilsonMessages" ||
      key === "WilsonAdmin" ||
      key === "WilsonSettings"
    ) {
      if (isOrgWorkspace) {
        if (sidebarWorkspace?.workspace_type === "keeproem") {
          navigateActivatorMode(activatorModeForSidebarKey(key, sidebarWorkspace));
          return;
        }
        const targetScreen = key.startsWith("Wilson") ? key.replace("Wilson", "KeeprSpace") : key;
        resetToKeeprSpaceModule(targetScreen, {
          workspaceId: sidebarWorkspace?.workspace_id || null,
        });
      }
      return;
    }

    if (key === "ActivatorHome") {
      if (isOrgWorkspace) {
        const targetWorkspace = sidebarWorkspace;
        navigateActivatorMode(
          activatorModeForSidebarKey(key, targetWorkspace),
          targetWorkspace,
          activatorNavSectionForSidebarKey(key)
        );
        return;
      }
      navigationRef.dispatch(CommonActions.reset({
        index: 0,
        routes: [{ name: "ActivatorHome", params: { initialMode: "fleet", navSection: "ActivatorHome" } }],
      }));
      return;
    }

    if (
      key === "ActivatorFind" ||
      key === "ActivatorAdd" ||
      key === "ActivatorConnect" ||
      key === "ActivatorWork" ||
      key === "ActivatorEngage" ||
      key === "ActivatorFleet" ||
      key === "ActivatorMessages" ||
      key === "ActivatorBuilds" ||
      key === "ActivatorTemplates" ||
      key === "ActivatorOverview" ||
      key === "ActivatorDealerNetwork" ||
      key === "ActivatorSuppliers" ||
      key === "ActivatorResources" ||
      key === "ActivatorWarranty" ||
      key === "ActivatorAiContext" ||
      key === "ActivatorIntelligence" ||
      key === "OrgIdentity"
    ) {
      if (isOrgWorkspace) {
        if (key === "ActivatorAdd") {
          resetToKeeprSpaceModule("KeeprSpaceActivator", {
            workspaceId: sidebarWorkspace?.workspace_id || null,
            organizationId: workspaceOrganizationId(sidebarWorkspace),
            intent: "add_boat",
            parentRoute: "ActivatorHome",
          });
          return;
        }
        navigateActivatorMode(
          activatorModeForSidebarKey(key, sidebarWorkspace),
          sidebarWorkspace,
          activatorNavSectionForSidebarKey(key)
        );
        return;
      }
      navigationRef.navigate("ActivatorHome", { initialMode: "fleet" });
      return;
    }

    if (key === "SystemLibrary") {
      if (isOrgWorkspace) {
        const params = {
          workspaceId: sidebarWorkspace?.workspace_id || null,
          organizationId: workspaceOrganizationId(sidebarWorkspace),
          navSection: "ActivatorSystemLibrary",
        };
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const href = activatorHrefForSidebarKey(key, sidebarWorkspace);
          if (href) {
            window.location.assign(href);
            return;
          }
        }
        navigationRef.dispatch(CommonActions.reset({
          index: 0,
          routes: [{ name: "SystemLibrary", params }],
        }));
      }
      return;
    }

    if (key === "Messages") {
      if (isOrgWorkspace) {
        resetToKeeprSpaceModule("KeeprSpaceMessages", {
          scope: "global",
          workspaceId: sidebarWorkspace?.workspace_id || null,
          organizationId: workspaceOrganizationId(sidebarWorkspace),
        });
        return;
      }
      navigationRef.navigate("PersonalModule", {
        screen: "PersonalTabs",
        params: { screen: "Messages", params: { scope: "global" } },
      });
      return;
    }

    if (
      key === "DealerCustomers" ||
      key === "DealerService" ||
      key === "DealerStorage" ||
      key === "DealerSystemsResources" ||
      key === "DealerAiContext" ||
      key === "DealerIntelligence"
    ) {
      if (isOrgWorkspace) {
        const screen =
          key === "DealerIntelligence"
            ? "KeeprSpaceMessages"
            : key === "DealerAiContext" || key === "DealerSystemsResources"
            ? "KeeprSpacePlaybooks"
            : "KeeprSpaceFleet";
        resetToKeeprSpaceModule(screen, {
          workspaceId: sidebarWorkspace?.workspace_id || null,
          organizationId: workspaceOrganizationId(sidebarWorkspace),
          navSection: key,
        });
      }
      return;
    }

    if (key === "Settings") {
      navigationRef.navigate("PersonalModule", {
        screen: "PersonalTabs",
        params: { screen: "Settings" },
      });
      return;
    }

    if (isOrgWorkspace && key === "Messages") {
      navigateActivatorMode(activatorModeForSidebarKey(key, sidebarWorkspace));
      return;
    }

    if (isOrgWorkspace && key === "KeeprSpaceAdmin") {
      navigateActivatorMode(activatorModeForSidebarKey(key, sidebarWorkspace));
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

    navigationRef.navigate("PersonalModule", {
      screen: "PersonalTabs",
      params: { screen: key },
    });
  } catch (err) {
    console.error("Sidebar navigation failed:", err);
  }
};

if (isPublicFlow) return null;
  const renderNavItem = (item) => {
    const isActive = item.key === activeKey;
    const navHref = activatorHrefForSidebarKey(item.key, sidebarWorkspace);
    const navItemStyle = [
      styles.navItem,
      isActive && styles.navItemActive,
      isCollapsed && styles.navItemCollapsed,
    ];
    const iconColor = isActive ? "#E5E7EB" : "#9CA3AF";
    const handleNavPress = () => {
      if (item.key === "KeeprAdminHome" && Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign("/keepr-admin");
        return;
      }
      if (navHref && Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(navHref);
        return;
      }
      go(item.key);
    };
    const navContent = (
      <>
        <View style={[styles.navIcon, isCollapsed && styles.navIconCollapsed]}>
          <Ionicons name={item.icon} size={18} color={iconColor} />
        </View>

        {!isCollapsed ? (
          <Text
            style={[
              styles.navLabel,
              isActive && styles.navLabelActive,
            ]}
            numberOfLines={1}
          >
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
      </>
    );

    if (Platform.OS === "web" && navHref) {
      return (
        <a
          key={item.key}
          href={navHref}
          style={StyleSheet.flatten([navItemStyle, styles.webNavLink])}
          aria-current={isActive ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            if (typeof window !== "undefined") window.location.assign(navHref);
          }}
        >
          {navContent}
        </a>
      );
    }

    return (
      <TouchableOpacity
        key={item.key}
        style={navItemStyle}
        onPress={handleNavPress}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {navContent}
      </TouchableOpacity>
    );
  };

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
                : sidebarWorkspace?.workspace_type !== "keepr"
                ? workspaceModeLabel(sidebarWorkspace)
                : inKeeprPro
                ? "KeeprPro workspace"
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
        {navItems.map(renderNavItem)}
      </View>

      <View style={styles.footer}>
        {isInternalAdmin && Platform.OS === "web" ? (
          <a
            href="/keepr-admin"
            style={StyleSheet.flatten([
              styles.modeChoice,
              activeKey === "KeeprAdminHome" && styles.modeChoiceActive,
              isCollapsed && styles.modeChoiceCollapsed,
              styles.webNavLink,
            ])}
            aria-current={activeKey === "KeeprAdminHome" ? "page" : undefined}
            aria-label="Open Keepr Admin"
            onClick={(event) => {
              event.preventDefault();
              if (typeof window !== "undefined") window.location.assign("/keepr-admin");
            }}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={activeKey === "KeeprAdminHome" ? "#E5E7EB" : "#9CA3AF"}
            />
            {!isCollapsed ? (
              <Text
                style={[
                  styles.modeChoiceText,
                  activeKey === "KeeprAdminHome" && styles.modeChoiceTextActive,
                ]}
                numberOfLines={1}
              >
                Keepr Admin
              </Text>
            ) : null}
          </a>
        ) : isInternalAdmin ? (
          <TouchableOpacity
            style={[
              styles.modeChoice,
              activeKey === "KeeprAdminHome" && styles.modeChoiceActive,
              isCollapsed && styles.modeChoiceCollapsed,
            ]}
            onPress={() => go("KeeprAdminHome")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Open Keepr Admin"
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={activeKey === "KeeprAdminHome" ? "#E5E7EB" : "#9CA3AF"}
            />
            {!isCollapsed ? (
              <Text
                style={[
                  styles.modeChoiceText,
                  activeKey === "KeeprAdminHome" && styles.modeChoiceTextActive,
                ]}
                numberOfLines={1}
              >
                Keepr Admin
              </Text>
            ) : null}
          </TouchableOpacity>
        ) : null}
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
    minHeight: 42,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    marginBottom: 6,
    width: "100%",
  },
  navItemActive: {
    backgroundColor: "#365aaaff",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  webNavLink: {
    display: "flex",
    boxSizing: "border-box",
    alignItems: "center",
    width: "100%",
    textDecorationLine: "none",
    cursor: "pointer",
  },
  navIcon: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 26,
  },
  navLabel: {
    color: "#dcdfe4ff",
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    minWidth: 0,
  },
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

  footer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#0F172A",
  },
  modeChoice: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  modeChoiceActive: {
    backgroundColor: "rgba(54, 90, 170, 0.45)",
    borderWidth: 1,
    borderColor: "#365AAA",
  },
  modeChoiceCollapsed: {
    justifyContent: "center",
  },
  modeChoiceText: {
    marginLeft: spacing.xs,
    fontSize: 12,
    color: "#CBD5E1",
    fontWeight: "700",
    flex: 1,
  },
  modeChoiceTextActive: {
    color: "#E5E7EB",
  },
  footerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  footerText: { marginLeft: spacing.xs, fontSize: 12, color: "#9CA3AF", flex: 1 },
});
