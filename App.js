// App.js

import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import React from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import ManageTeamScreen from "./screens/ManageTeamScreen";
import PrivacyTrustScreen from "./screens/PrivacyTrustScreen";
import ProfileScreen from "./screens/ProfileScreen";

// Onboarding screens (locked narrative)
import OnboardingChooseAssetTypeScreen from "./screens/onboarding/OnboardingChooseAssetTypeScreen";
import OnboardingNarrative1Screen from "./screens/onboarding/OnboardingNarrative1Screen";
import OnboardingNarrative2Screen from "./screens/onboarding/OnboardingNarrative2Screen";
import OnboardingNarrative3Screen from "./screens/onboarding/OnboardingNarrative3Screen";
// Billing / Team
import PlanUpgradeScreen from "./screens/PlanUpgradeScreen";
import TeamScreen from "./screens/TeamScreen";

// Supabase
import { supabase } from "./lib/supabaseClient";

// Theme
import { colors } from "./styles/theme";

// Printing: Reports and the Keepr Story
import AssetQRCodesScreen from "./screens/AssetQRCodesScreen";
import OwnerSystemsPackagePrint from "./screens/OwnerSystemsPackagePrintScreen";
import StoryPrintScreen from "./screens/StoryPrintScreen";
import SystemReadinessPackagePrintScreen from "./screens/SystemReadinessPackagePrintScreen";
import SystemStoryPrintScreen from "./screens/SystemStoryPrintScreen";
import TimelineCostPackagePrintScreen from "./screens/TimelineCostPackagePrintScreen";

// Public Action Screen Launched from QR Code or Direct Link
import PublicActionScreen from "./screens/PublicActionScreen";

// Screens
import AssetGroupDashboardScreen from "./screens/AssetGroupDashboardScreen";
import CreateEventScreen from "./screens/CreateEventScreen";
import DashboardScreen from "./screens/DashboardScreen";
import SplashIntroScreen from "./screens/SplashIntroScreen";

// Deep link resolver
import KacResolveScreen from "./screens/KacResolveScreen";
import KacRouteScreen from "./screens/KacRouteScreen";

// Home
import AddHomeAssetScreen from "./screens/AddHomeAssetScreen";
import HomeScreen from "./screens/HomeScreen";
import HomeShowcaseScreen from "./screens/HomeShowcaseScreen";
import HomeStoryScreen from "./screens/HomeStoryScreen";
import HomeSystemsScreen from "./screens/HomeSystemsScreen";
import HomeSystemStoryScreen from "./screens/HomeSystemStoryScreen";

// Garage / vehicles
import AddVehicleAssetScreen from "./screens/AddVehicleAssetScreen";
import GarageScreen from "./screens/GarageScreen";
import VehicleShowcaseScreen from "./screens/VehicleShowcaseScreen";
import VehicleStoryScreen from "./screens/VehicleStoryScreen";
import VehicleSystemsScreen from "./screens/VehicleSystemsScreen";
import VehicleSystemStoryScreen from "./screens/VehicleSystemStoryScreen";

// Boats / marine
import AddAssetScreen from "./screens/AddAssetScreen";
import BoatScreen from "./screens/BoatScreen";
import BoatShowcaseScreen from "./screens/BoatShowcaseScreen";
import BoatStoryScreen from "./screens/BoatStoryScreen";
import BoatSystemsScreen from "./screens/BoatSystemsScreen";
import BoatSystemStoryScreen from "./screens/BoatSystemStoryScreen";

// Keepr Pros
import KeeprProAddServiceScreen from "./screens/KeeprProAddServiceScreen";
import KeeprProDetailScreen from "./screens/KeeprProDetailScreen";
import KeeprProsScreen from "./screens/KeeprProsScreen";

// Upload Lab
import AssetAttachmentsScreen from "./screens/AssetAttachmentsScreen";
import UploadLabScreen from "./screens/UploadLabScreen";

// Proof Builder
import KeeprIntelligenceScreen from "./screens/KeeprIntelligenceScreen";
import ProofBuilderScreen from "./screens/ProofBuilderScreen";

// Super Keeprs
import SuperKeeprDashboardScreen from "./screens/SuperKeeprDashboardScreen";

// Add Home
import AddHomeScreen from "./screens/AddHomeScreen";

// Service / DIY
import AddDIYEntryScreen from "./screens/AddDIYEntryScreen";
import AddServiceRecordScreen from "./screens/AddServiceRecordScreen";
import AddTimelineRecordScreen from "./screens/AddTimelineRecordScreen";
import ChangeLocationScreen from "./screens/ChangeLocationScreen";
import EditServiceRecordScreen from "./screens/EditServiceRecordScreen";
import EditTimelineRecordScreen from "./screens/EditTimelineRecordScreen";
import TimelineRecordScreen from "./screens/TimelineRecordScreen";

// QR / scan flows
import QRAssetRouterScreen from "./screens/QRAssetRouterScreen";
import QRScanScreen from "./screens/QRScanScreen";
import ScanScreen from "./screens/ScanScreen";

// Generic asset chat intake

// Add / Edit asset
import EditAssetScreen from "./screens/EditAssetScreen";

// Other
import SettingsScreen from "./screens/SettingsScreen";

// Auth
import { AuthProvider, useAuth } from "./context/AuthContext";
import AuthScreen from "./screens/AuthScreen";

import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import ChangePasswordScreen from "./screens/ChangePasswordScreen";
// Context providers
import { BoatsProvider } from "./context/BoatsContext";
import { HomeProvider } from "./context/HomeContext";
import { VehiclesProvider } from "./context/VehiclesContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";

// Enhance Connectors
import { EnhanceProvider } from "./enhance/EnhanceProvider";
import { useEnhanceAttachment } from "./enhance/useEnhanceAttachment";
import EditSystemEnrichmentScreen from "./screens/EditSystemEnrichmentScreen";

// Marine MVP
import AddMarineAssetScreen from "./screens/AddMarineAssetScreen";

// Web-only sidebar shell
import SidebarNav from "./components/SidebarNav";

// Global operation feedback (save/delete/upload)
import OperationFeedbackModal from "./components/OperationFeedbackModal";
import { OperationFeedbackProvider } from "./context/OperationFeedbackContext";

// Shared navigation ref
import { navigationRef } from "./navigationRoot";

// Notifications stack
import NotificationsStack from "./navigation/NotificationsStack";

// Reminders
import CreateReminderScreen from "./screens/CreateReminderScreen";

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const SuperKeeprStackNav = createNativeStackNavigator();
const HomeStackNav = createNativeStackNavigator();

/* ---------------- DEEP LINKING ----------------- */

const linking = {
  prefixes: [
    "keepr://",
    "http://localhost:8081",
    "https://keeprhome.com",
    "https://keeprmarine.com",
    "https://keeprauto.com",
    "https://keeprfamily.com",
    "https://keeprfleet.com",
    "https://keeprpros.com",
  ],
  config: {
    screens: {
      KacResolve: "k/:kac",
      PublicAction: "k/:kac/actions",
      RootTabs: {
        screens: {
          Dashboard: "",
          MyHome: "home",
          Garage: "garage",
          Boats: "boats",
          Notifications: "inbox",
          KeeprPros: "pros",
          Settings: "settings",
        },
      },

      TimelineRecord: "TimelineRecord",

      UploadLab: "upload-lab",
      AssetAttachments: "asset/:assetId/attachments",

      HomePublic: "public/home/:assetId",
      GaragePublic: "public/garage/:assetId",
      BoatPublic: "public/boat/:assetId",
    },
  },
};

/* ----------------- HOME STACK (optional) ----------------- */

function HomeStack() {
  return (
    <HomeStackNav.Navigator screenOptions={{ headerShown: false }}>
      <HomeStackNav.Screen name="HomeScreen" component={HomeScreen} />
      <HomeStackNav.Screen name="MyHomeSystems" component={HomeSystemsScreen} />
      <HomeStackNav.Screen
        name="HomeSystemStory"
        component={HomeSystemStoryScreen}
      />
      <HomeStackNav.Screen
        name="KeeprProsFromHome"
        component={KeeprProsScreen}
      />
    </HomeStackNav.Navigator>
  );
}
function OnboardingStack() {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Onboarding1" component={OnboardingNarrative1Screen} />
      <RootStack.Screen name="Onboarding2" component={OnboardingNarrative2Screen} />
      <RootStack.Screen name="Onboarding3" component={OnboardingNarrative3Screen} />
      <RootStack.Screen name="OnboardingChooseAssetType" component={OnboardingChooseAssetTypeScreen} />
    </RootStack.Navigator>
  );
}
/* ----------------- TABS ----------------- */

function MainTabs() {
  const isWeb = Platform.OS === "web";
  const { width } = useWindowDimensions();
  const hideTabsOnWeb = isWeb && width >= 1024;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: hideTabsOnWeb
          ? { display: "none" }
          : {
              backgroundColor: colors.surface,
              borderTopColor: "#11182722",
              height: 60,
              paddingBottom: 8,
              paddingTop: 6,
            },
        tabBarActiveTintColor: colors.tabActive || colors.textPrimary,
        tabBarInactiveTintColor: colors.tabInactive || colors.textMuted,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Dashboard: focused ? "grid" : "grid-outline",
            MyHome: focused ? "home" : "home-outline",
            Garage: focused ? "car" : "car-outline",
            Boats: focused ? "boat" : "boat-outline",
            Notifications: focused ? "mail" : "mail-outline",
            KeeprPros: focused
              ? "shield-checkmark"
              : "shield-checkmark-outline",
            Settings: focused ? "settings" : "settings-outline",
          };
          const iconName = icons[route.name];
          if (!iconName) return null;
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: "Home" }}
      />
      <Tab.Screen
        name="MyHome"
        component={HomeStoryScreen}
        options={{ title: "My Home" }}
      />
      <Tab.Screen
        name="Garage"
        component={VehicleStoryScreen}
        options={{ title: "Garage" }}
      />
      <Tab.Screen
        name="Boats"
        component={BoatStoryScreen}
        options={{ title: "Boats" }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsStack}
        options={{ title: "Inbox" }}
      />
      <Tab.Screen
        name="KeeprPros"
        component={KeeprProsScreen}
        options={{ title: "Keepr Pros" }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

/* ----------------- SUPERKEEPR STACK ----------------- */

function SuperKeeprStack() {
  return (
    <SuperKeeprStackNav.Navigator screenOptions={{ headerShown: false }}>
      <SuperKeeprStackNav.Screen
        name="SuperKeeprDashboard"
        component={SuperKeeprDashboardScreen}
      />
      <SuperKeeprStackNav.Screen name="Settings" component={SettingsScreen} />
      <SuperKeeprStackNav.Screen name="AddHome" component={AddHomeScreen} />

      <SuperKeeprStackNav.Screen
        name="HomeStory"
        component={HomeStoryScreen}
      />
      <SuperKeeprStackNav.Screen
        name="HomeShowcase"
        component={HomeShowcaseScreen}
      />
      <SuperKeeprStackNav.Screen
        name="MyHomeSystems"
        component={HomeSystemsScreen}
      />
      <SuperKeeprStackNav.Screen
        name="HomeSystemStory"
        component={HomeSystemStoryScreen}
      />

      <SuperKeeprStackNav.Screen
        name="AddServiceRecord"
        component={AddServiceRecordScreen}
      />
      <SuperKeeprStackNav.Screen
        name="EditServiceRecord"
        component={EditServiceRecordScreen}
      />

      <SuperKeeprStackNav.Screen
        name="EditAsset"
        component={EditAssetScreen}
      />
      <SuperKeeprStackNav.Screen
        name="Notifications"
        component={NotificationsStack}
      />
      <SuperKeeprStackNav.Screen
        name="CreateEvent"
        component={CreateEventScreen}
        options={{ presentation: "modal" }}
      />
    </SuperKeeprStackNav.Navigator>
  );
}

/* ----------------- NAV THEME ----------------- */

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: "#11182722",
    text: colors.textPrimary,
  },
};

/* ----------------- GLOBAL EVENT FAB ----------------- */

function GlobalEventFab() {
  return null;
}

/* ----------------- ENHANCE BOOTSTRAP ----------------- */

function EnhanceBootstrap() {
  useEnhanceAttachment();
  return null;
}

/* ----------------- KEEPR INTELLIGENCE WRAPPER ----------------- */
/**
 * Avoid passing inline functions to React Navigation's `component` prop.
 * Preserve the "key by attachmentId" behavior so switching attachments remounts.
 */
function KeeprIntelligenceWrapper(props) {
  const key = props?.route?.params?.attachmentId || "ki";
  return <KeeprIntelligenceScreen key={key} {...props} />;
}


console.log("✅ Enhance configured: ASSURANCE (no edge functions)");

/* ----------------- ROOT WITH AUTH + ROLE GATE ----------------- */

function Root({ onRouteChange, setCurrentRouteName, currentRouteName }) {
  const { initializing, user } = useAuth();

// Web navigation state persistence (prevents tab-switch / refresh from dumping to Dashboard)
const NAV_PERSIST_KEY = "keepr.nav.state.v1";
const [initialNavState, setInitialNavState] = React.useState(undefined);
const [isNavReady, setIsNavReady] = React.useState(Platform.OS !== "web");

React.useEffect(() => {
  if (Platform.OS !== "web") return;
  try {
    const raw = window?.sessionStorage?.getItem(NAV_PERSIST_KEY);
    if (raw) setInitialNavState(JSON.parse(raw));
  } catch (_) {}
  setIsNavReady(true);
}, []);

  const [role, setRole] = React.useState(null);
  const [onboardingState, setOnboardingState] = React.useState(null);
  const [assetCount, setAssetCount] = React.useState(null);
  const [loadingRole, setLoadingRole] = React.useState(false);

  const lastRoleLoadAtRef = React.useRef(0);

  // Normalize onboarding state (we've had both "complete" and "completed" in the DB)
  const normalizedOnboardingState = (onboardingState || "not_started").toLowerCase();
  const isOnboardingComplete =
    normalizedOnboardingState === "complete" ||
    normalizedOnboardingState === "completed";

  const isOnboardingDismissed = normalizedOnboardingState === "dismissed";
  const hasAssets = typeof assetCount === "number" ? assetCount > 0 : false;
  const shouldShowOnboarding = !hasAssets && !isOnboardingComplete && !isOnboardingDismissed;

  // Force correct landing route after profile gate resolves (web/state can be "sticky")
  const targetRoute = React.useMemo(() => {
    if (!role || onboardingState === null || assetCount === null) return null;

    return shouldShowOnboarding
      ? "OnboardingStack"
      : role === "superkeepr"
      ? "SuperKeeprStack"
      : "RootTabs";
  }, [role, onboardingState, assetCount, shouldShowOnboarding]);

  const didInitialNavResolve = React.useRef(false);
  const lastResetRouteRef = React.useRef(null);

  React.useEffect(() => {
  if (!targetRoute) return;
  if (!navigationRef?.isReady?.()) return;

  // ✅ Boot-only navigation enforcement:
  // After the first successful resolve, NEVER reset nav again on web tab-focus / token refresh.
  if (didInitialNavResolve.current) return;

  const current = navigationRef.getCurrentRoute()?.name;

  // If we're already in the right stack/screen, lock and stop.
  if (current === targetRoute) {
    didInitialNavResolve.current = true;
    lastResetRouteRef.current = targetRoute;
    return;
  }

  navigationRef?.reset?.({
    index: 0,
    routes: [{ name: targetRoute }],
  });

  lastResetRouteRef.current = targetRoute;
  didInitialNavResolve.current = true;
}, [targetRoute]);


  React.useEffect(() => {
    let mounted = true;

    const loadRole = async (reason = "unknown", opts = {}) => {
      const force = !!opts.force;
      // Web tab-focus / token refresh can fire auth events frequently.
      // Throttle role loads to avoid UI flicker / Splash remount.
      const now = Date.now();
      if (!force && now - lastRoleLoadAtRef.current < 30_000) {
        return;
      }
      lastRoleLoadAtRef.current = now;

      if (!user?.id) {
        if (!mounted) return;
        setRole(null);
        setOnboardingState(null);
        setAssetCount(null);
        setLoadingRole(false);
        return;
      }

      // Only show Splash during the very first bootstrap.
      if (!didInitialNavResolve.current) setLoadingRole(true);

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("role, onboarding_state")
          .eq("id", user.id)
          .single();

        const { count: aCount, error: aErr } = await supabase
          .from("assets")
          .select("id", { count: "exact", head: true });

        if (!mounted) return;
if (error || aErr) {
  console.log(
    "ROLE BOOTSTRAP ERROR:",
    error?.message || error,
    aErr?.message || aErr
  );

  // ✅ Do NOT force onboarding on transient DB/RLS/session timing issues
  // Leave unresolved so Splash stays up and we retry.
  setRole(null);
  setOnboardingState(null);
  setAssetCount(null);

  // retry once shortly after (session often hydrates right after first render)
  setTimeout(() => {
        if (mounted) loadRole("retry", { force: true });
  }, 400);

  return;
    }

    setRole(data?.role || "consumer");
    setOnboardingState((data?.onboarding_state || "not_started").toLowerCase());
    setAssetCount(typeof aCount === "number" ? aCount : 0);

    
} catch (e) {
  console.log("PROFILE ROLE LOAD EXCEPTION:", e?.message || e);
  if (!mounted) return;

  // Do NOT force onboarding.
  // Reset to unresolved and retry once.
  setRole(null);
  setOnboardingState(null);
  setAssetCount(null);

  setTimeout(() => {
        if (mounted) loadRole("retry", { force: true });
  }, 400);

  return;
} finally {
  if (!mounted) return;
  setLoadingRole(false);
}

    };
    loadRole("boot", { force: true });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Token refresh happens on tab focus; don't treat it like a cold boot.
      // We still refresh role info, but throttled and without remounting navigation.
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        loadRole(event);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [user?.id]);

  React.useEffect(() => {
    if (!setCurrentRouteName) return;
    if (initializing) setCurrentRouteName("SplashIntro");
    else if (!user) setCurrentRouteName("Auth");
  }, [initializing, user, setCurrentRouteName]);

const isResetLink = React.useMemo(() => {
  if (Platform.OS !== "web") return false;
  try {
    const href = window.location.href || "";
    const path = window.location.pathname || "";
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    if (path.startsWith("/reset")) return true;
    if (href.includes("/reset")) return true;
    if (hash.includes("type=recovery")) return true;
    if (hash.includes("access_token=") && hash.includes("refresh_token=")) return true;
    if (search.includes("code=")) return true;
    if (hash.includes("error=")) return true;
    return false;
  } catch (_) {
    return false;
  }
}, []);


const handleNavStateChange = React.useCallback(
  (state) => {
    if (Platform.OS === "web") {
      try {
        window?.sessionStorage?.setItem(NAV_PERSIST_KEY, JSON.stringify(state));
      } catch (_) {}
    }

    const route = navigationRef.getCurrentRoute();
    if (!route) return;

    if (setCurrentRouteName) setCurrentRouteName(route.name);

    if (onRouteChange) {
      const homeRoutes = new Set([
        "MyHome",
        "HomeScreen",
        "HomeStory",
        "HomeShowcase",
        "MyHomeSystems",
        "HomeSystemStory",
        "HomePublic",
      ]);

      const normalizedName = homeRoutes.has(route.name) ? "MyHome" : route.name;
      onRouteChange(normalizedName);
    }
  },
  [onRouteChange, setCurrentRouteName]
);

// Web: wait until persisted navigation state (if any) is restored before rendering.
if (Platform.OS === "web" && !isNavReady) return <SplashIntroScreen />;

if (initializing) return <SplashIntroScreen />;

// Let password-reset links render ResetPassword even if there is no session yet.
if (!user) {
  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        theme={navTheme}
        ref={navigationRef}
        linking={linking}
        initialState={Platform.OS === "web" ? initialNavState : undefined}
        onReady={() => setIsNavReady(true)}
        onStateChange={handleNavStateChange}
      >
        <RootStack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={isResetLink ? "ResetPassword" : "Auth"}
        >
          <RootStack.Screen name="Auth" component={AuthScreen} />
          <RootStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </View>
  );
}

if (loadingRole || !role || onboardingState === null || assetCount === null) return <SplashIntroScreen />;

const initialRouteName =
  shouldShowOnboarding
    ? "OnboardingStack"
    : role === "superkeepr"
    ? "SuperKeeprStack"
    : "RootTabs";


  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        theme={navTheme}
        ref={navigationRef}
        linking={linking}
        initialState={Platform.OS === "web" ? initialNavState : undefined}
        onReady={() => setIsNavReady(true)}
        onStateChange={handleNavStateChange}
      >
          <RootStack.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName={initialRouteName}
          >
          <RootStack.Screen name="Auth" component={AuthScreen} />
          <RootStack.Screen name="ResetPassword" component={ResetPasswordScreen} />

          <RootStack.Screen name="RootTabs" component={MainTabs} />
          <RootStack.Screen
            name="SuperKeeprStack"
            component={SuperKeeprStack}
          />

          <RootStack.Screen name="OnboardingStack" component={OnboardingStack} />
          <RootStack.Screen name="Profile" component={ProfileScreen} />
          <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
          <RootStack.Screen name="AdminSettings" component={SettingsScreen} />
          <RootStack.Screen name="PrivacyTrust" component={PrivacyTrustScreen} options={{ headerShown: false }}/>
          <RootStack.Screen name="PlanUpgrade" component={PlanUpgradeScreen}/>
          <RootStack.Screen name="Team" component={TeamScreen}/>
          <RootStack.Screen name="ManageTeam" component={ManageTeamScreen} />

          <RootStack.Screen name="UploadLab" component={UploadLabScreen} />

          <RootStack.Screen
            name="CreateEvent"
            component={CreateEventScreen}
            options={{ presentation: "modal" }}
          />
          <RootStack.Screen
            name="CreateReminder"
            component={CreateReminderScreen}
          />

          {/* Print your Keepr Story */}
          <RootStack.Screen
            name="StoryPrint"
            component={StoryPrintScreen}
            options={{ headerShown: false }}
          />
          {/* Print your System Story */}
          <RootStack.Screen
          name="SystemStoryPrint"
          component={SystemStoryPrintScreen}
          />
          <RootStack.Screen
          name="SystemReadinessPackagePrint"
          component={SystemReadinessPackagePrintScreen}
          options={{ headerShown: false }}
          />
          <RootStack.Screen
          name="TimelineCostPackagePrint"
          component={TimelineCostPackagePrintScreen}
          />
          <RootStack.Screen
          name="OwnerSystemsPackagePrint"
          component={OwnerSystemsPackagePrint}
          />
          {/* QR Code Screen */}
          <RootStack.Screen name="AssetQRCodes" component={AssetQRCodesScreen} />

          {/* Public Action */}
          <RootStack.Screen
            name="PublicAction"
            component={PublicActionScreen}
            options={{ title: "Quick Capture" }}
          />

          {/* Boats */}
          <RootStack.Screen name="Boat" component={BoatScreen} />
          <RootStack.Screen name="BoatStory" component={BoatStoryScreen} />
          <RootStack.Screen
            name="BoatShowcase"
            component={BoatShowcaseScreen}
          />
          <RootStack.Screen name="BoatSystems" component={BoatSystemsScreen} />
          <RootStack.Screen
            name="AddMarineAsset"
            component={AddMarineAssetScreen}
          />
          <RootStack.Screen
            name="BoatSystemStory"
            component={BoatSystemStoryScreen}
          />

          <RootStack.Screen name="AddAsset" component={AddAssetScreen} />

          {/* Home */}
          <RootStack.Screen name="HomeStory" component={HomeStoryScreen} />
          <RootStack.Screen name="HomePublic" component={HomeScreen} />
          <RootStack.Screen name="HomeScreen" component={HomeScreen} />
          <RootStack.Screen
            name="HomeShowcase"
            component={HomeShowcaseScreen}
          />
          <RootStack.Screen
            name="MyHomeSystems"
            component={HomeSystemsScreen}
          />
          <RootStack.Screen
            name="HomeSystemStory"
            component={HomeSystemStoryScreen}
          />
          <RootStack.Screen
            name="AddHomeAsset"
            component={AddHomeAssetScreen}
          />

          {/* Vehicles */}
          <RootStack.Screen name="Garage" component={GarageScreen} />
          <RootStack.Screen
            name="VehicleStory"
            component={VehicleStoryScreen}
          />
          <RootStack.Screen
            name="VehicleShowcase"
            component={VehicleShowcaseScreen}
          />
          <RootStack.Screen
            name="VehicleSystems"
            component={VehicleSystemsScreen}
          />
          <RootStack.Screen
            name="VehicleSystemStory"
            component={VehicleSystemStoryScreen}
          />
          <RootStack.Screen
            name="AddVehicleAsset"
            component={AddVehicleAssetScreen}
          />

          {/* Misc */}
          <RootStack.Screen name="AddHome" component={AddHomeScreen} />

          <RootStack.Screen
            name="AssetAttachments"
            component={AssetAttachmentsScreen}
          />
          <RootStack.Screen
            name="AssetGroupDashboard"
            component={AssetGroupDashboardScreen}
          />
          <RootStack.Screen
            name="AddDIYEntry"
            component={AddDIYEntryScreen}
          />
          <RootStack.Screen
            name="AddServiceRecord"
            component={AddServiceRecordScreen}
          />
          <RootStack.Screen
            name="TimelineRecord"
            component={TimelineRecordScreen}
            options={{ title: "Timeline Record" }}
          />
          <RootStack.Screen
            name="EditServiceRecord"
            component={EditServiceRecordScreen}
          />
          <RootStack.Screen
            name="AddTimelineRecord"
            component={AddTimelineRecordScreen}
          />
          <RootStack.Screen
            name="EditTimelineRecord"
            component={EditTimelineRecordScreen}
          />
          <RootStack.Screen
            name="EditSystemEnrichment"
            component={EditSystemEnrichmentScreen}
          />
          <RootStack.Screen
            name="ChangeLocation"
            component={ChangeLocationScreen}
          />

          <RootStack.Screen
            name="KeeprProAddService"
            component={KeeprProAddServiceScreen}
          />
          <RootStack.Screen
            name="KeeprProDetail"
            component={KeeprProDetailScreen}
          />

          <RootStack.Screen name="QRScan" component={QRScanScreen} />
          <RootStack.Screen
            name="QRAssetRouter"
            component={QRAssetRouterScreen}
          />
          <RootStack.Screen
            name="KacRoute"
            component={KacRouteScreen}
            options={{ headerShown: false }}
          />

          <RootStack.Screen name="Scan" component={ScanScreen} />

          <RootStack.Screen
            name="Notifications"
            component={NotificationsStack}
          />

          {/* Enhance and Proof Builder */}
          <RootStack.Screen
            name="ProofBuilder"
            component={ProofBuilderScreen}
            options={{ headerShown: false }}
          />

          {/* Intelligence Builder */}
          <RootStack.Screen
            name="KeeprIntelligence"
            component={KeeprIntelligenceWrapper}
          />

          <RootStack.Screen name="EditAsset" component={EditAssetScreen} />
          <RootStack.Screen name="KacResolve" component={KacResolveScreen} />
        </RootStack.Navigator>
      </NavigationContainer>

      <GlobalEventFab currentRouteName={currentRouteName} role={role} />
    </View>
  );
}


/* ----------------- GLOBAL ERROR BOUNDARY ----------------- */
/**
 * Global render-error containment.
 * Prevents a single screen/component exception from blanking the whole app.
 * Note: Error boundaries catch render/lifecycle errors, not async promise rejections.
 */
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.log("🔥 Global App Error:", error);
    if (info?.componentStack) console.log("Component Stack:", info.componentStack);
    // TODO: wire Sentry here (captureException) when ready.
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={boundaryStyles.container}>
        <Text style={boundaryStyles.title}>Something went wrong.</Text>
        <Text style={boundaryStyles.subtitle}>
          The app hit an unexpected error. You can reload and continue.
        </Text>

        <TouchableOpacity style={boundaryStyles.button} onPress={this.handleReset}>
          <Text style={boundaryStyles.buttonText}>Reload</Text>
        </TouchableOpacity>

        {__DEV__ && this.state.error ? (
          <Text style={boundaryStyles.devError} numberOfLines={6}>
            {String(this.state.error?.message || this.state.error)}
          </Text>
        ) : null}
      </View>
    );
  }
}

const boundaryStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 360,
  },
  button: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.primary || "#2D7DE3",
    borderRadius: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },
  devError: {
    marginTop: 14,
    fontSize: 12,
    color: colors.textMuted || "#6b7280",
    textAlign: "center",
    maxWidth: 420,
  },
});


/* ----------------- APP ROOT ----------------- */

export default function App() {
  const isWebShell = Platform.OS === "web";
  const [currentRouteName, setCurrentRouteName] = React.useState("SplashIntro");

  // Global handler for tapping push/local notifications
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      try {
        const data = resp?.notification?.request?.content?.data;
        if (data?.type === "reminder" && data?.reminderId) {
          // Deep-link into the Inbox / Notifications, carrying reopenReminderId
          Linking.openURL(
            `keepr://inbox?reopenReminderId=${encodeURIComponent(
              data.reminderId
            )}`
          );
        }
      } catch (e) {
        console.log("Notification tap handler error:", e);
      }
    });

    return () => sub.remove();
  }, []);

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
      <OperationFeedbackProvider>
      <AuthProvider>
        <VehiclesProvider>
          <HomeProvider>
            <WorkspaceProvider>
              <BoatsProvider>
                <EnhanceProvider>
                  <EnhanceBootstrap />

                  {isWebShell ? (
                    <View style={appStyles.webShell}>
                      {/* Hide sidebar for print preview route */}
                      {currentRouteName === "StoryPrint" ? null : (
                        <SidebarNav currentRouteName={currentRouteName} />
                      )}

                      <View style={appStyles.webMain}>
                        <View style={appStyles.webMainInner}>
                          <Root
                            onRouteChange={setCurrentRouteName}
                            setCurrentRouteName={setCurrentRouteName}
                            currentRouteName={currentRouteName}
                          />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <Root
                      onRouteChange={setCurrentRouteName}
                      setCurrentRouteName={setCurrentRouteName}
                      currentRouteName={currentRouteName}
                    />
                  )}
                </EnhanceProvider>
              </BoatsProvider>
            </WorkspaceProvider>
          </HomeProvider>
        </VehiclesProvider>
      </AuthProvider>
            <OperationFeedbackModal />
      </OperationFeedbackProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const appStyles = StyleSheet.create({
  webShell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#020617",
  },
  webMain: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "flex-start",
    backgroundColor: colors.background,
  },
  webMainInner: {
    flex: 1,
    width: "100%",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
});
