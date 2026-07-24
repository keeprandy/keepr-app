// App.js
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { posthog } from "./lib/posthog";

function safeParseStoredAsset(value) {
  if (!value || typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.id &&
      parsed.name
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

// import * as Notifications from "expo-notifications";
import React from "react";
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import GlassFooter from "./components/navigation/GlassFooter";
import MoreScreen from "./screens/MoreScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ExpoLinking from "expo-linking";
import {
  addReminderNotificationResponseListener,
  getLastReminderNotificationResponse,
  setReminderNotificationHandler,
} from "./lib/remindersNotifications";

import ManageTeamScreen from "./screens/ManageTeamScreen";
import PrivacyTrustScreen from "./screens/PrivacyTrustScreen";
import ProfileScreen from "./screens/ProfileScreen";

// Onboarding screens (locked narrative)
import OnboardingChooseAssetTypeScreen from "./screens/onboarding/OnboardingChooseAssetTypeScreen";
import OnboardingNarrative1Screen from "./screens/onboarding/OnboardingNarrative1Screen";
import OnboardingNarrative2Screen from "./screens/onboarding/OnboardingNarrative2Screen";
import OnboardingNarrative3Screen from "./screens/onboarding/OnboardingNarrative3Screen";
import KaiWelcomeScreen from "./screens/KaiWelcomeScreen";
import KaiOnboardingScreen from "./screens/KaiOnboardingScreen";

// KAI Orb Everywhere
import GlobalKaiFab from "./components/kai/GlobalKaiFab";
import { KaiProvider } from "./context/KaiContext";

// Billing / Team
import PlanUpgradeScreen from "./screens/PlanUpgradeScreen";
import TeamScreen from "./screens/TeamScreen";

// Supabase
import { supabase } from "./lib/supabaseClient";
import { track } from "./lib/analytics";
import { openShareAction } from "./lib/shareActions";

// Theme
import { colors } from "./styles/theme";

// Printing: Reports and the Keepr Story
import AssetQRCodesScreen from "./screens/AssetQRCodesScreen";
import OwnerSystemsPackagePrint from "./screens/OwnerSystemsPackagePrintScreen";
import StoryPrintScreen from "./screens/StoryPrintScreen";
import SystemReadinessPackagePrintScreen from "./screens/SystemReadinessPackagePrintScreen";
import SystemStoryPrintScreen from "./screens/SystemStoryPrintScreen";
import TimelineCostPackagePrintScreen from "./screens/TimelineCostPackagePrintScreen";
import KeeprStoryScreen from "./screens/KeeprStoryScreen";

// Public Action Screen Launched from QR Code or Direct Link
import PublicActionScreen from "./screens/PublicActionScreen";
import KeeprActionScreen from "./screens/KeeprActionScreen";
import SendToKeeprScreen from "./screens/SendToKeeprScreen";
import SendToKeeprAssetPicker from "./screens/SendToKeeprAssetPicker";
import PublicKeeprStoryScreen from "./screens/PublicKeeprStoryScreen";
import KeeprHubScreen from "./screens/KeeprHubScreen";
import HubDetailScreen from "./screens/HubDetailScreen";
import EditHubScreen from "./screens/EditHubScreen";
import ManageHubStoriesScreen from "./screens/ManageHubStoriesScreen";
import InviteHubMembersScreen from "./screens/InviteHubMembersScreen";
import MyHubsScreen from "./screens/MyHubsScreen";
import CreateHubScreen from "./screens/CreateHubScreen";
import AddHubStoryScreen from "./screens/AddHubStoryScreen";

// Screens
import AssetGroupDashboardScreen from "./screens/AssetGroupDashboardScreen";
import CreateEventScreen from "./screens/CreateEventScreen";
import DashboardScreen from "./screens/DashboardScreen";
import SplashIntroScreen from "./screens/SplashIntroScreen";

// Deep link resolver
import KacResolveScreen from "./screens/KacResolveScreen";
import KacRouteScreen from "./screens/KacRouteScreen";
import ShareKeeprScreen from "./screens/ShareKeeprScreen";

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

// Other Assets
import OtherAssetStoryScreen from "./screens/OtherAssetStoryScreen";
import OtherAssetShowcaseScreen from "./screens/OtherAssetShowcaseScreen";

// Keepr Pros
import KeeprProAddServiceScreen from "./screens/KeeprProAddServiceScreen";
import KeeprProDetailScreen from "./screens/KeeprProDetailScreen";
import KeeprProsScreen from "./screens/KeeprProsScreen";

// Upload Lab
import AssetAttachmentsScreen from "./screens/AssetAttachmentsScreen";
import AssetAttachmentsMobileScreen from "./screens/AssetAttachmentsMobileScreen";
import AssetAttachmentDetailMobileScreen from "./screens/AssetAttachmentDetailMobileScreen";
import ScanDocumentMobileScreen from "./screens/ScanDocumentMobileScreen";
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
import AddAssetChatScreen from "./screens/AddAssetChatScreen";

// Add / Edit asset
import EditAssetScreen from "./screens/EditAssetScreen";

// Other
import SettingsScreen from "./screens/SettingsScreen";
import PublicConfigScreen from "./screens/PublicConfigScreen";
import PublicConfigAssetPickerScreen from "./screens/PublicConfigAssetPickerScreen";


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

// In App Purchases
import { configurePurchases } from "./lib/purchases";

import { useShareIntent } from "expo-share-intent";

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();
const SuperKeeprStackNav = createNativeStackNavigator();
const HomeStackNav = createNativeStackNavigator();



/* ---------------- DEEP LINKING ----------------- */

const linking = {
  prefixes: [
    "keepr://",
    ...(Platform.OS === "web" ? ["http://localhost:8081"] : []),
    "https://app.keeprhome.com",
    "https://keeprhome.com",
    "https://keeprmarine.com",
    "https://keeprauto.com",
    "https://keeprfamily.com",
    "https://keeprfleet.com",
    "https://keeprpros.com",
  ],
 config: {
  screens: {
    ResetPassword: "reset",
    Auth: "auth",
    ShareKeepr: "share-keepr",
    ShareAction: "s/:token",
    
    PublicKeeprStory: "k/:kac",
    PublicAction: "k/:kac/actions",
    KeeprHubInternal: "KeeprHubInternal",
    KeeprStoryInternal: "KeeprStoryInternal",
    KeeprHub: "h/:slug",
    KacResolve: "resolve/:kac",
    RootTabs: {
      screens: {
        Dashboard: "dashboard",
        MyHome: "home",
        Garage: "garage",
        Boats: "boats",
        Notifications: {
          path: "inbox",
          screens: {
            InboxHome: "",
          },
        },
        KeeprPros: "pros",
        Settings: "settings",
      },
    },
    SuperKeeprStack: {
      path: "super",
      screens: {
        SuperKeeprDashboard: "",
      },
    },
    TimelineRecord: "TimelineRecord",
    CreateReminder: "CreateReminder",
    SystemStoryPrint: "SystemStoryPrint",
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
    <RootStack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="KaiWelcome"
    >
      <RootStack.Screen name="KaiWelcome" component={KaiWelcomeScreen} />
      <RootStack.Screen name="Onboarding1" component={OnboardingNarrative1Screen} />
      <RootStack.Screen name="Onboarding2" component={OnboardingNarrative2Screen} />
      <RootStack.Screen name="Onboarding3" component={OnboardingNarrative3Screen} />
      <RootStack.Screen name="KaiOnboarding" component={KaiOnboardingScreen} />
      <RootStack.Screen
        name="OnboardingChooseAssetType"
        component={OnboardingChooseAssetTypeScreen}
      />
    </RootStack.Navigator>
  );
}
/* ----------------- TABS ----------------- */

function MainTabs() {
  const isWeb = Platform.OS === "web";
  const { width } = useWindowDimensions();
  const hideTabsOnWeb = isWeb && width >= 1024;
  const [showQuickCapture, setShowQuickCapture] = React.useState(false);
  const [showAssetPicker, setShowAssetPicker] = React.useState(false);
  const [pendingCaptureType, setPendingCaptureType] = React.useState(null);
  const [selectedCaptureAsset, setSelectedCaptureAsset] = React.useState(null);

  React.useEffect(() => {
    let active = true;

    const loadLast = async () => {
      try {
        const user = (await supabase.auth.getUser()).data?.user;
        const userId = user?.id;

        if (!userId) {
          if (active) setSelectedCaptureAsset(null);
          return;
        }

        const scopedKey = `lastCaptureAsset:${userId}`;

        // one-time cleanup of the old global key
        if (Platform.OS === "web") {
          try {
            window?.localStorage?.removeItem("lastCaptureAsset");
          } catch (_) {}

          const stored = window?.localStorage?.getItem(scopedKey);
          if (!active) return;

          if (stored) {
            const parsed = safeParseStoredAsset(stored);

            if (parsed) {
              setSelectedCaptureAsset(parsed);
            } else {
              setSelectedCaptureAsset(null);

              if (Platform.OS === "web") {
                window?.localStorage?.removeItem(scopedKey);
              } else {
                await AsyncStorage.removeItem(scopedKey);
              }
            }
          } else {
            setSelectedCaptureAsset(null);
          }
          return;
        }

        try {
          await AsyncStorage.removeItem("lastCaptureAsset");
        } catch (_) {}

        const stored = await AsyncStorage.getItem(scopedKey);
        if (!active) return;

        if (stored) {
        const parsed = safeParseStoredAsset(stored);

        if (parsed) {
          setSelectedCaptureAsset(parsed);
        } else {
          setSelectedCaptureAsset(null);

          if (Platform.OS === "web") {
            window?.localStorage?.removeItem(scopedKey);
          } else {
            await AsyncStorage.removeItem(scopedKey);
          }
        }
      } else {
        setSelectedCaptureAsset(null);
      }
      } catch (e) {
        console.log("Failed to load last asset", e);
        if (active) setSelectedCaptureAsset(null);
      }
    };

    loadLast();

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
  const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session?.user?.id) {
      setSelectedCaptureAsset(null);
      setPickerAssets([]);
      return;
    }

    const scopedKey = `lastCaptureAsset:${session.user.id}`;

    try {
      const stored =
        Platform.OS === "web"
          ? window?.localStorage?.getItem(scopedKey)
          : await AsyncStorage.getItem(scopedKey);

      if (stored) {
        setSelectedCaptureAsset(safeParseStoredAsset(stored));
      } else {
        setSelectedCaptureAsset(null);
      }
    } catch (e) {
      console.log("Failed to restore scoped capture asset", e);
      setSelectedCaptureAsset(null);
    }
  });

  return () => {
    sub?.subscription?.unsubscribe?.();
  };
}, []);

  const [pickerAssets, setPickerAssets] = React.useState([]);
  const [pickerAssetsLoading, setPickerAssetsLoading] = React.useState(false);

  const handleQuickCaptureDocument = () => {
    setShowQuickCapture(false);
    setPendingCaptureType("scan");
    setShowAssetPicker(true);
  };
  const handleQuickCaptureLibrary = () => {
  setShowQuickCapture(false);
  setPendingCaptureType("library");
  setShowAssetPicker(true);
};

const handleQuickCaptureFile = () => {
  setShowQuickCapture(false);
  setPendingCaptureType("file");
  setShowAssetPicker(true);
};

const handleSelectCaptureAsset = async (asset) => {
  try {
    const user = (await supabase.auth.getUser()).data?.user;
    const userId = user?.id;

    if (!userId) {
      console.log("Quick Capture blocked: no signed-in user");
      return;
    }

    const isValid = pickerAssets.some((a) => a.id === asset?.id);
    if (!isValid) {
      console.log("Quick Capture blocked: asset not in current user's picker list", asset);
      setSelectedCaptureAsset(null);
      setShowAssetPicker(true);
      return;
    }

    const scopedKey = `lastCaptureAsset:${userId}`;

    setSelectedCaptureAsset(asset);
    setShowAssetPicker(false);

    if (Platform.OS === "web") {
      window?.localStorage?.setItem(scopedKey, JSON.stringify(asset));
    } else {
      await AsyncStorage.setItem(scopedKey, JSON.stringify(asset));
    }

    navigationRef.current?.navigate("AssetAttachmentsMobile", {
      assetId: asset.id,
      assetName: asset.name,
      autoOpen: pendingCaptureType,
    });
  } catch (e) {
    console.log("Failed to save/select capture asset", e);
  }
};
  
const handleQuickCapturePhoto = () => {
  setShowQuickCapture(false);
  setPendingCaptureType("camera");
  setShowAssetPicker(true);
};
React.useEffect(() => {
  let isActive = true;

  const loadPickerAssets = async () => {
    try {
      setPickerAssetsLoading(true);

  const user = (await supabase.auth.getUser()).data?.user;

  const { data, error } = await supabase
    .from("assets")
    .select("id, name, status, deleted_at")
    .eq("owner_id", user?.id)
    .is("deleted_at", null)
    .eq("status", "active")
    .order("name", { ascending: true });

      if (error) throw error;

      if (!isActive) return;

      const cleaned = (data || [])
        .filter((a) => a?.id && a?.name)
        .filter((a) => {
          // defensive client-side filter for obvious deleted placeholders
          const n = String(a.name || "").trim().toLowerCase();
          return n && n !== "deleted";
        });

      setPickerAssets(cleaned);
    } catch (e) {
      console.log("Quick Capture asset picker load failed:", e?.message || e);
      if (isActive) setPickerAssets([]);
    } finally {
      if (isActive) setPickerAssetsLoading(false);
    }
  };

  loadPickerAssets();

  return () => {
    isActive = false;
  };
  
}, []);

  return (
    <>
<Tab.Navigator
  tabBar={(props) => (
  <GlassFooter
    {...props}
    onQuickCapture={() => setShowQuickCapture(true)}
  />
)}
  screenOptions={{
    headerShown: false,
  }}
>
    <Tab.Screen
      name="Dashboard"
      component={DashboardScreen}
      options={{ title: "Home" }}
    />

    <Tab.Screen
      name="Notifications"
      component={NotificationsStack}
      options={{ title: "Inbox" }}
    />

    <Tab.Screen
      name="Create"
      component={DashboardScreen} // temporary
      options={{ title: "" }}
    />

    <Tab.Screen
      name="KeeprPros"
      component={KeeprProsScreen}
      options={{ title: "Pros" }}
    />

    <Tab.Screen
      name="More"
      component={MoreScreen} // we’ll create this next
      options={{ title: "More" }}
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
          name="Settings" 
          component={SettingsScreen} />
    </Tab.Navigator>
        {showQuickCapture ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowQuickCapture(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.18)",
              justifyContent: "flex-end",
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{
                backgroundColor: "#fff",
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                paddingTop: 14,
                paddingHorizontal: 18,
                paddingBottom: 28,
              }}
            >
              <View
                style={{
                  alignSelf: "center",
                  width: 38,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "#D1D5DB",
                  marginBottom: 16,
                }}
              />

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 18,
                }}
              >
                <TouchableOpacity
                  onPress={() => setShowQuickCapture(false)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: "#F3F4F6",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close" size={22} color="#111827" />
                </TouchableOpacity>

                <Text style={{ fontSize: 18, fontWeight: "800", color: "#111827" }}>
                  Add to Keepr
                </Text>

                <View style={{ width: 42, height: 42 }} />
              </View>
              {selectedCaptureAsset?.name ? (
                <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
                  Adding to {selectedCaptureAsset.name}
                </Text>
              ) : null}
              <Text
                style={{
                  fontSize: 13,
                  color: "#6B7280",
                  marginBottom: 14,
                }}
              >
                Quick capture for an asset. Choose what you want to add.
              </Text>

              <TouchableOpacity
                onPress={handleQuickCaptureDocument}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: "#E5E7EB",
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: "#EFF6FF",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="document-text-outline" size={22} color="#2563EB" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>
                    Scan Document
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                    Receipt, invoice, registration, warranty
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleQuickCaptureLibrary}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: "#E5E7EB",
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: "#F3F4F6",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="images-outline" size={22} color="#374151" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>
                    Photo Library
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                    Choose an image already on your phone
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleQuickCaptureFile}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 16,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: "#F3F4F6",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="document-outline" size={22} color="#374151" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>
                    Upload File
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                    Add a PDF or saved document
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        ) : null}

       {showAssetPicker ? (
  <TouchableOpacity
    activeOpacity={1}
    onPress={() => setShowAssetPicker(false)}
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.18)",
      justifyContent: "flex-end",
    }}
  >
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => {}}
      style={{
        backgroundColor: "#fff",
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 14,
        paddingHorizontal: 18,
        paddingBottom: 28,
      }}
    >
      <View
        style={{
          alignSelf: "center",
          width: 38,
          height: 4,
          borderRadius: 2,
          backgroundColor: "#D1D5DB",
          marginBottom: 16,
        }}
      />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <TouchableOpacity
          onPress={() => setShowAssetPicker(false)}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: "#F3F4F6",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="close" size={22} color="#111827" />
        </TouchableOpacity>

        <Text style={{ fontSize: 18, fontWeight: "800", color: "#111827" }}>
          Select Asset
        </Text>

        <View style={{ width: 42, height: 42 }} />
      </View>

      <View style={{ maxHeight: 420 }}>
        <ScrollView
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
        >
          {selectedCaptureAsset ? (
            <TouchableOpacity
              onPress={() => handleSelectCaptureAsset(selectedCaptureAsset)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: "#E5E7EB",
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  backgroundColor: "#EFF6FF",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 14,
                }}
              >
                <Ionicons name="time-outline" size={20} color="#2563EB" />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>
                  {selectedCaptureAsset.name}
                </Text>
                <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  Last used
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          ) : null}

          {pickerAssetsLoading ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 8, color: "#6B7280" }}>Loading assets…</Text>
            </View>
          ) : pickerAssets.length === 0 ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <Text style={{ color: "#6B7280" }}>No assets found.</Text>
            </View>
          ) : (
            pickerAssets.map((asset) => (
              <TouchableOpacity
                key={asset.id}
                onPress={() => handleSelectCaptureAsset(asset)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: "#E5E7EB",
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: "#F3F4F6",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="home-outline" size={20} color="#374151" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>
                    {asset.name}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </TouchableOpacity>
  </TouchableOpacity>
) : null}

</>
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

/* ----------------- GLOBAL KAI FAB ----------------- */

function GlobalEventFab({ currentRouteName, role }) {
  const route = String(currentRouteName || "");

  const hiddenRoutes = [
    "KaiWelcome",
    "KaiOnboarding",
    "Onboarding1",
    "Onboarding2",
    "Onboarding3",
    "OnboardingChooseAssetType",
    "SplashIntro",
    "Login",
    "Signup",
    "Auth",
    "AssetAttachments",
    "AssetAttachmentsMobile",
    "AssetAttachmentDetailMobile",
    "ProofBuilder",
    "ScanDocumentMobile",
    "Scan",
    "QRScan",
    "QRAssetRouter",
    "AddTimelineRecord",
    "TimelineRecord",
    "EditTimelineRecord",
    "Notifications",
    "OwnerSystemsPackagePrint",
  "Reports",
  "PrintView",
  "PublicAction",
  "PublicKeeprStory",
  "KeeprStory",
  "PublicConfig",
  ];

  if (hiddenRoutes.includes(route)) {
    return null;
  }

  return <GlobalKaiFab currentRouteName={currentRouteName} role={role} />;
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

function InviteRedirectScreen() {
  return <SplashIntroScreen />;
}

function ShareActionRedirectScreen({ navigation, route }) {
  React.useEffect(() => {
    let mounted = true;

    const openShare = async () => {
      const token = route?.params?.token;

      if (!token) {
        navigation.replace("Auth");
        return;
      }

      try {
        const opened = await openShareAction({
          supabase,
          token,
          clientPlatform: Platform.OS,
          storage: AsyncStorage,
        });

        track("share_link_opened", {
          share_action_id: opened?.id || null,
          activation_source_id: opened?.activationSourceId || null,
          shared_object_type: opened?.sharedObjectType || null,
          intended_action: opened?.intendedAction || null,
          activation_session_status: opened?.activationSessionStatus || null,
        });

        if (!mounted) return;
        navigation.replace("Invite", {
          slug: opened?.sourceSlugSnapshot || opened?.sharedObjectSlugSnapshot || null,
        });
      } catch (e) {
        console.log("Share action open failed:", e?.message || e);
        if (mounted) {
          navigation.replace("Auth");
        }
      }
    };

    openShare();

    return () => {
      mounted = false;
    };
  }, [navigation, route?.params?.token]);

  return <SplashIntroScreen />;
}

/* ----------------- ROOT WITH AUTH + ROLE GATE ----------------- */

function extractInviteSlugFromUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = ExpoLinking.parse(url);
    const path = parsed?.path || "";

    const querySlug =
      parsed?.queryParams?.slug ||
      parsed?.queryParams?.source ||
      parsed?.queryParams?.ref ||
      null;

    if (querySlug) return String(querySlug);

    const parts = path.split("/").filter(Boolean);
    const inviteIndex = parts.indexOf("invite");

    if (inviteIndex >= 0 && parts[inviteIndex + 1]) {
      return parts[inviteIndex + 1];
    }

    return null;
  } catch (e) {
    console.log("Invite slug parse failed:", e?.message || e);
    return null;
  }
}

async function captureInviteSourceFromUrl(url) {
  const slug = extractInviteSlugFromUrl(url);
  if (!slug) return;
  

  try {
    await AsyncStorage.setItem("keepr_acquisition_source_slug", slug);
    await AsyncStorage.setItem("keepr_invite_slug", slug);
    console.log("✅ Captured invite source:", slug);
  } catch (e) {
    console.log("Failed to save invite source:", e?.message || e);
  }
}

const PENDING_REMINDER_NOTIFICATION_KEY =
  "keepr.pendingReminderNotification.v1";

function extractReminderNotificationData(responseOrData) {
  const data =
    responseOrData?.notification?.request?.content?.data ||
    responseOrData?.request?.content?.data ||
    responseOrData ||
    {};

  let reminderId = data?.reminderId || data?.reminder_id || null;
  let afterSave = data?.afterSave || data?.after_save || "Notifications";

  if (!reminderId && data?.deepLink) {
    try {
      const parsed = ExpoLinking.parse(String(data.deepLink));
      reminderId =
        parsed?.queryParams?.reminderId ||
        parsed?.queryParams?.reminder_id ||
        parsed?.queryParams?.reopenReminderId ||
        null;
      afterSave =
        parsed?.queryParams?.afterSave ||
        parsed?.queryParams?.after_save ||
        afterSave;
    } catch (_) {}
  }

  if (!reminderId) return null;

  return {
    reminderId: String(reminderId),
    afterSave: String(afterSave || "Notifications"),
    eventKey: data?.eventKey || data?.event_key || null,
    notificationType:
      data?.notificationType || data?.notification_type || "reminder",
  };
}

async function storePendingReminderNotification(target) {
  if (!target?.reminderId) return;
  try {
    await AsyncStorage.setItem(
      PENDING_REMINDER_NOTIFICATION_KEY,
      JSON.stringify({
        ...target,
        storedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.log("Pending reminder notification store skipped:", error);
  }
}

async function takePendingReminderNotification() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REMINDER_NOTIFICATION_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(PENDING_REMINDER_NOTIFICATION_KEY);
    return JSON.parse(raw);
  } catch (error) {
    console.log("Pending reminder notification read skipped:", error);
    return null;
  }
}

async function verifyReminderForNotification({ reminderId, ownerId }) {
  if (!reminderId || !ownerId) {
    return { ok: false, reason: "missing_context" };
  }

  try {
    const { data, error } = await supabase.rpc("get_coordination_action", {
      p_reminder_id: reminderId,
    });

    if (!error) {
      if (!data?.id) return { ok: false, reason: "missing_or_unauthorized" };
      if (String(data.status || "").toLowerCase() === "archived") {
        return { ok: false, reason: "stale_archived" };
      }
      return { ok: true, reminder: data };
    }

    if (error?.code !== "PGRST202") {
      return { ok: false, reason: "query_failed", error };
    }

    const fallback = await supabase
      .from("reminders")
      .select("id,status,owner_id,extra_metadata")
      .eq("id", reminderId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (fallback.error) {
      return { ok: false, reason: "query_failed", error: fallback.error };
    }
    if (!fallback.data?.id) {
      return { ok: false, reason: "missing_or_unauthorized" };
    }
    if (String(fallback.data.status || "").toLowerCase() === "archived") {
      return { ok: false, reason: "stale_archived" };
    }

    return { ok: true, reminder: fallback.data };
  } catch (error) {
    return { ok: false, reason: "exception", error };
  }
}

async function openReminderFromNotification(target, ownerId) {
  const reminderId = target?.reminderId;
  if (!reminderId || !ownerId) return false;

  if (!navigationRef?.isReady?.()) {
    await storePendingReminderNotification(target);
    return false;
  }

  const verification = await verifyReminderForNotification({
    reminderId,
    ownerId,
  });

  if (!verification.ok) {
    console.log("Reminder notification target skipped:", {
      reminderId,
      reason: verification.reason,
      error: verification.error?.message || verification.error || null,
    });
    navigationRef.current?.navigate("Notifications", {
      screen: "InboxHome",
      params: {
        notificationStatus: verification.reason,
      },
    });
    return false;
  }

  navigationRef.current?.navigate("CreateReminder", {
    reminderId,
    afterSave: target.afterSave || "Notifications",
    notificationEventKey: target.eventKey || null,
  });

  return true;
}

function isPasswordRecoveryUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    const parsed = ExpoLinking.parse(url);
    const path = parsed?.path || "";
    const query = parsed?.queryParams || {};

    if (path === "reset" || path.startsWith("reset/")) return true;
    if (query.type === "recovery") return true;
    if (query.code) return true;
    if (query.access_token && query.refresh_token) return true;
    if (query.error || query.error_code || query.error_description) return true;
  } catch (_) {}

  try {
    const u = new URL(url);
    const hash = new URLSearchParams((u.hash || "").replace(/^#/, ""));
    const query = new URLSearchParams(u.search || "");
    const get = (key) => hash.get(key) || query.get(key) || "";
    const target = `${u.hostname || ""}${u.pathname || ""}`;

    if (target === "reset" || target.startsWith("reset/")) return true;
    if (url.includes("/reset")) return true;
    if (get("type") === "recovery") return true;
    if (get("code")) return true;
    if (get("access_token") && get("refresh_token")) return true;
    if (get("error") || get("error_code") || get("error_description")) return true;
  } catch (_) {
    if (url.startsWith("keepr://reset")) return true;
    if (url.includes("/reset")) return true;
    if (url.includes("type=recovery")) return true;
    if (url.includes("access_token=") && url.includes("refresh_token=")) return true;
    if (url.includes("code=")) return true;
  }

  return false;
}

function getInitialWebPasswordRecoveryUrl() {
  if (Platform.OS !== "web") return null;
  try {
    const href = window.location.href || "";
    return isPasswordRecoveryUrl(href) ? href : null;
  } catch (_) {
    return null;
  }
}

function normalizeInitialActionWebPath() {
  if (Platform.OS !== "web") return;
  try {
    const path = window.location.pathname || "";
    if (path === "/Notifications" || path === "/Notifications/InboxHome") {
      const next = `/inbox${window.location.search || ""}${window.location.hash || ""}`;
      window.history.replaceState(window.history.state, "", next);
    }
  } catch (_) {}
}

function Root({ onRouteChange, setCurrentRouteName, currentRouteName }) {
  const { initializing, user } = useAuth();
  const [isNavReady, setIsNavReady] = React.useState(Platform.OS !== "web");

  normalizeInitialActionWebPath();

    React.useEffect(() => {
    if (!user?.id) return;

    configurePurchases(user.id).catch((e) => {
      console.log("RevenueCat configure failed:", e?.message || e);
    });
  }, [user?.id]);

const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

React.useEffect(() => {
  if (!user?.id) return;
  if (!hasShareIntent || !shareIntent) return;
  if (!navigationRef?.isReady?.()) return;

  const file = shareIntent?.files?.[0] || null;
  const text = shareIntent?.text || null;
  const url = shareIntent?.webUrl || shareIntent?.url || null;

  const payload = {
    type: file ? "file" : url ? "link" : text ? "text" : null,
    file,
    url,
    text,
  };

  console.log("📥 RAW shareIntent:", JSON.stringify(shareIntent, null, 2));
  console.log("📥 Normalized payload:", JSON.stringify(payload, null, 2));

  navigationRef.current?.navigate("SendToKeeprAssetPicker", {
    incomingShare: payload,
  });

  resetShareIntent();
}, [user?.id, hasShareIntent, shareIntent, resetShareIntent]);

React.useEffect(() => {
  if (Platform.OS === "web") return;
  setReminderNotificationHandler();

  let mounted = true;

  const handleResponse = async (response) => {
    const target = extractReminderNotificationData(response);
    if (!target) return;
    if (!mounted) return;

    if (!user?.id || !navigationRef?.isReady?.()) {
      await storePendingReminderNotification(target);
      return;
    }

    await openReminderFromNotification(target, user.id);
  };

  const captureInitialNotification = async () => {
    const response = await getLastReminderNotificationResponse();
    await handleResponse(response);
  };

  captureInitialNotification();

  const sub = addReminderNotificationResponseListener(handleResponse);

  return () => {
    mounted = false;
    sub?.remove?.();
  };
}, [user?.id]);

React.useEffect(() => {
  if (Platform.OS === "web") return;
  if (!user?.id || !navigationRef?.isReady?.()) return;

  let mounted = true;

  const drainPending = async () => {
    const target = await takePendingReminderNotification();
    if (!mounted || !target?.reminderId) return;
    await openReminderFromNotification(target, user.id);
  };

  drainPending();

  return () => {
    mounted = false;
  };
}, [user?.id, isNavReady]);

// Web navigation state persistence (prevents tab-switch / refresh from dumping to Dashboard)
const NAV_PERSIST_KEY = "keepr.nav.state.v1";
const [initialNavState, setInitialNavState] = React.useState(undefined);
const [passwordRecoveryUrl, setPasswordRecoveryUrl] = React.useState(
  getInitialWebPasswordRecoveryUrl
);
const [checkedInitialRecoveryUrl, setCheckedInitialRecoveryUrl] = React.useState(
  Platform.OS === "web"
);

React.useEffect(() => {
  if (Platform.OS !== "web") return;
  try {
    const raw = window?.sessionStorage?.getItem(NAV_PERSIST_KEY);
    if (raw) setInitialNavState(JSON.parse(raw));
  } catch (_) {}
  setIsNavReady(true);
}, []);

React.useEffect(() => {
  if (Platform.OS === "web") return;

  let mounted = true;

  const captureInitialResetLink = async () => {
    try {
      const initialUrl = await ExpoLinking.getInitialURL();
      if (!mounted) return;
      if (isPasswordRecoveryUrl(initialUrl)) {
        setPasswordRecoveryUrl(initialUrl);
      }
    } catch (e) {
      console.log("Initial password reset link capture failed:", e?.message || e);
    } finally {
      if (mounted) setCheckedInitialRecoveryUrl(true);
    }
  };

  captureInitialResetLink();

  const subscription = ExpoLinking.addEventListener("url", ({ url }) => {
    if (!isPasswordRecoveryUrl(url)) return;
    setPasswordRecoveryUrl(url);
  });

  return () => {
    mounted = false;
    subscription?.remove?.();
  };
}, []);

// Clear persisted web nav state on sign-out so we do not restore stale routes
// like PublicAction without a valid KAC/token after logout.
React.useEffect(() => {
  if (Platform.OS !== "web") return;
  if (initializing) return;
  if (user) return;

  try {
    window?.sessionStorage?.removeItem(NAV_PERSIST_KEY);
  } catch (_) {}

  setInitialNavState(undefined);
}, [initializing, user]);

  const [role, setRole] = React.useState("consumer");
const [onboardingState, setOnboardingState] = React.useState("not_started");
const [assetCount, setAssetCount] = React.useState(0);
  const [loadingRole, setLoadingRole] = React.useState(false);

  React.useEffect(() => {
  if (!user?.id) {
    posthog.reset();
    return;
  }

  const identifyUser = async () => {
  let sourceSlug = null;

  try {
    sourceSlug = await AsyncStorage.getItem(
      "keepr_acquisition_source_slug"
    );
  } catch (e) {
    console.log("Failed to load acquisition source slug", e);
  }

  posthog.identify(user.id, {
    email: user.email,
    role,
    onboarding_state: onboardingState,
    asset_count: assetCount,
    source_slug: sourceSlug || null,
    is_internal_user:
      user.email?.includes("@keeprhome.com"),
  });
};

identifyUser();

}, [user?.id, role, onboardingState, assetCount]);

  const lastRoleLoadAtRef = React.useRef(0);

  // Normalize onboarding state (we've had both "complete" and "completed" in the DB)
  const normalizedOnboardingState = (onboardingState || "not_started").toLowerCase();
  const isOnboardingComplete =
    normalizedOnboardingState === "complete" ||
    normalizedOnboardingState === "completed";

  const isOnboardingDismissed = normalizedOnboardingState === "dismissed";
  const hasAssets = typeof assetCount === "number" ? assetCount > 0 : false;

  const activeTrigger = React.useMemo(() => {
    if (Platform.OS !== "web") return null;

    try {
      const path = window.location.pathname || "";
      const params = new URLSearchParams(window.location.search || "");

      if (path.startsWith("/h/") && params.get("invite")) {
        return {
          type: "hub_invite",
          hubSlug: path.split("/").filter(Boolean)[1],
          inviteToken: params.get("invite"),
        };
      }

      return null;
    } catch (_) {
      return null;
    }
  }, []);

  const shouldShowOnboarding =
  !activeTrigger &&
  !hasAssets &&
  !isOnboardingComplete &&
  !isOnboardingDismissed;

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

  const isResetLink = React.useMemo(() => {
  if (passwordRecoveryUrl) return true;
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
}, [passwordRecoveryUrl]);

React.useEffect(() => {
  if (!targetRoute) return;
  if (!navigationRef?.isReady?.()) return;
  if (isResetLink) return;

  if (activeTrigger?.type === "hub_invite") {
  didInitialNavResolve.current = true;
  return;
}

  if (Platform.OS === "web") {
    const path = window.location.pathname || "";

if (
  path.startsWith("/k/") ||
  path.startsWith("/h/") ||
  path.startsWith("/hub/") ||
  path.startsWith("/story/") ||
  path.startsWith("/resolve/") ||
  path.startsWith("/inbox") ||
  path.startsWith("/CreateReminder") ||
  path.startsWith("/Notifications") ||
  path.startsWith("/KeeprHubInternal") ||
  path.startsWith("/KeeprStoryInternal")
) {
      didInitialNavResolve.current = true;
      return;
    }
  }

  const current = navigationRef.getCurrentRoute()?.name;

  if (current !== targetRoute) {
    navigationRef.reset({
      index: 0,
      routes: [{ name: targetRoute }],
    });
  }

  didInitialNavResolve.current = true;
  lastResetRouteRef.current = targetRoute;
}, [targetRoute, isResetLink]);



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
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .eq("status", "active");

        if (!mounted) return;
if (error || aErr) {
  console.log(
    "ROLE BOOTSTRAP ERROR:",
    error?.message || error,
    aErr?.message || aErr
  );


  // Store-safe fallback: do not deadlock behind splash
  setRole("consumer");
setOnboardingState("not_started");
setAssetCount(0);
setLoadingRole(false);
return;
}

    setRole(data?.role || "consumer");
    setOnboardingState((data?.onboarding_state || "not_started").toLowerCase());
    setAssetCount(typeof aCount === "number" ? aCount : 0);

    
} catch (e) {
  console.log("PROFILE ROLE LOAD EXCEPTION:", e?.message || e);
  if (!mounted) return;

  // Store-safe fallback: do not deadlock behind splash
  setRole("consumer");
  setOnboardingState("not_started");
  setAssetCount(0);
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


React.useEffect(() => {
  if (!isResetLink) return;
  if (!navigationRef?.isReady?.()) return;

  navigationRef.reset({
    index: 0,
    routes: [
      {
        name: "ResetPassword",
        params: passwordRecoveryUrl ? { recoveryUrl: passwordRecoveryUrl } : undefined,
      },
    ],
  });
}, [isResetLink, passwordRecoveryUrl]);

const lastTrackedScreen = React.useRef(null);

const handleNavStateChange = React.useCallback(
  (state) => {
    if (Platform.OS === "web") {
      try {
        window?.sessionStorage?.setItem(NAV_PERSIST_KEY, JSON.stringify(state));
      } catch (_) {}
    }

    const route = navigationRef.getCurrentRoute();
    if (!route) return;

    if (lastTrackedScreen.current === route.name) {
      return;
    }

    lastTrackedScreen.current = route.name;

    posthog.capture("screen_viewed", {
      screen: route.name,
      params: route.params || {},
      role,
    });

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
  [onRouteChange, setCurrentRouteName, role]
);

// Web: wait until persisted navigation state (if any) is restored before rendering.
if (Platform.OS === "web" && !isNavReady) return <SplashIntroScreen />;

if (Platform.OS !== "web" && !checkedInitialRecoveryUrl) return <SplashIntroScreen />;

if (initializing) return <SplashIntroScreen />;

// Let password-reset links render ResetPassword even if there is no session yet.
if (!user) {
  return (
    <View style={{ flex: 1 }}>
        <NavigationContainer
          key="logged-out"
          theme={navTheme}
          ref={navigationRef}
          linking={linking}
          initialState={undefined}
          onReady={() => setIsNavReady(true)}
        >
        <RootStack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={isResetLink ? "ResetPassword" : "Auth"}
        >
          {/* Public KAC routes MUST be accessible without auth */}
          <RootStack.Screen name="KacRoute" component={KacRouteScreen} />
          <RootStack.Screen name="PublicAction" component={PublicActionScreen} />
          <RootStack.Screen name="KeeprAction" component={KeeprActionScreen} options={{ headerShown: false }} />
          <RootStack.Screen name="KacResolve" component={KacResolveScreen} />
          <RootStack.Screen name="PublicKeeprStory" component={PublicKeeprStoryScreen}/>
          <RootStack.Screen name="KeeprHub" component={KeeprHubScreen}/>
          <RootStack.Screen name="HubDetail" component={HubDetailScreen} />
          <RootStack.Screen name="EditHub" component={EditHubScreen} />
          <RootStack.Screen name="ManageHubStories" component={ManageHubStoriesScreen} />
          <RootStack.Screen name="InviteHubMembers" component={InviteHubMembersScreen} />
          <RootStack.Screen name="MyHubs" component={MyHubsScreen} />
          <RootStack.Screen name="CreateHub" component={CreateHubScreen} options={{ headerShown: false }}/>
          <RootStack.Screen name="KeeprHubInternal" component={KeeprHubScreen}/>
          <RootStack.Screen name="AddHubStory" component={AddHubStoryScreen} />
          <RootStack.Screen name="KeeprStoryInternal" component={PublicKeeprStoryScreen}/>
          
          <RootStack.Screen name="ShareAction" component={ShareActionRedirectScreen} />
          <RootStack.Screen name="Invite" component={InviteRedirectScreen} />
          <RootStack.Screen name="Auth" component={AuthScreen} />
          <RootStack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            initialParams={
              passwordRecoveryUrl ? { recoveryUrl: passwordRecoveryUrl } : undefined
            }
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </View>
  );
}

if (loadingRole && role === null) return <SplashIntroScreen />;

const initialRouteName = isResetLink
  ? "ResetPassword"
  : shouldShowOnboarding
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
        initialState={
          Platform.OS === "web" &&
          !window.location.pathname.startsWith("/k/") &&
          !window.location.pathname.startsWith("/h/") &&
          !window.location.pathname.startsWith("/hub/") &&
          !window.location.pathname.startsWith("/story/") &&
          !window.location.pathname.startsWith("/inbox") &&
          !window.location.pathname.startsWith("/CreateReminder") &&
          !window.location.pathname.startsWith("/Notifications") &&
          !window.location.pathname.startsWith("/resolve/")
          
            ? initialNavState
            : undefined
        }
        onReady={() => setIsNavReady(true)}
        onStateChange={handleNavStateChange}
          >
          <RootStack.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName={initialRouteName}
          >
          <RootStack.Screen name="ShareAction" component={ShareActionRedirectScreen} />
          <RootStack.Screen name="Invite" component={InviteRedirectScreen} />
          <RootStack.Screen name="Auth" component={AuthScreen} />
          <RootStack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            initialParams={
              passwordRecoveryUrl ? { recoveryUrl: passwordRecoveryUrl } : undefined
            }
          />

          <RootStack.Screen name="RootTabs" component={MainTabs} />
          <RootStack.Screen
            name="SuperKeeprStack"
            component={SuperKeeprStack}
          />

          <RootStack.Screen name="OnboardingStack" component={OnboardingStack} />
          <RootStack.Screen name="Profile" component={ProfileScreen} />
          <RootStack.Screen name="ShareKeepr" component={ShareKeeprScreen} />

          <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
          <RootStack.Screen name="AdminSettings" component={SettingsScreen} />
          <RootStack.Screen name="PrivacyTrust" component={PrivacyTrustScreen} options={{ headerShown: false }}/>
          <RootStack.Screen name="PlanUpgrade" component={PlanUpgradeScreen}/>
          <RootStack.Screen name="Team" component={TeamScreen}/>
          <RootStack.Screen name="ManageTeam" component={ManageTeamScreen} />
          <RootStack.Screen name="PublicConfig" component={PublicConfigScreen} />
          <RootStack.Screen name="PublicConfigAssetPicker" component={PublicConfigAssetPickerScreen} />
          <RootStack.Screen name="PublicKeeprStory" component={PublicKeeprStoryScreen} />
          <RootStack.Screen name="KeeprHub" component={KeeprHubScreen}/>
          <RootStack.Screen name="HubDetail" component={HubDetailScreen} />
          <RootStack.Screen name="EditHub" component={EditHubScreen} />
          <RootStack.Screen name="ManageHubStories" component={ManageHubStoriesScreen} />
          <RootStack.Screen name="InviteHubMembers" component={InviteHubMembersScreen} />
          <RootStack.Screen name="MyHubs" component={MyHubsScreen} />
          <RootStack.Screen name="CreateHub" component={CreateHubScreen} options={{ headerShown: false }}/>
          <RootStack.Screen name="KeeprHubInternal" component={KeeprHubScreen}/>
          <RootStack.Screen name="AddHubStory" component={AddHubStoryScreen}/>
          <RootStack.Screen name="KeeprStoryInternal" component={PublicKeeprStoryScreen}/>
          
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
          <RootStack.Screen
            name="KeeprStory"
            component={KeeprStoryScreen}
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
          <RootStack.Screen name="KeeprAction" component={KeeprActionScreen} options={{ headerShown: false }} />
          <RootStack.Screen
            name="SendToKeeprAssetPicker"
            component={SendToKeeprAssetPicker}
          />
          {/* Mobile Send to Keepr Function */}
          <RootStack.Screen
            name="SendToKeepr"
            component={SendToKeeprScreen}
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
          <RootStack.Screen
            name="AddAssetChat"
            component={AddAssetChatScreen}
            options={{ headerShown: false }}
          />
          <RootStack.Screen name="KaiWelcome" component={KaiWelcomeScreen} />
          <RootStack.Screen name="KaiOnboarding" component={KaiOnboardingScreen} />

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

          {/* Other Assets */}
          <RootStack.Screen
            name="OtherAssetStory"
            component={OtherAssetStoryScreen}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="OtherAssetShowcase"
            component={OtherAssetShowcaseScreen}
            options={{ headerShown: false }}
          />

          {/* Misc */}
          <RootStack.Screen name="AddHome" component={AddHomeScreen} />

          <RootStack.Screen
            name="AssetAttachments"
            component={AssetAttachmentsScreen}
          />
          <RootStack.Screen
            name="AssetAttachmentsMobile"
            component={AssetAttachmentsMobileScreen}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="AssetAttachmentDetailMobile"
            component={AssetAttachmentDetailMobileScreen}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
          name="ScanDocumentMobile"
          component={ScanDocumentMobileScreen}
          options={{ headerShown: false }}
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

console.log("🔥 RENDER ERROR:", this.state.error);

return (
  <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
    <Text style={{ color: "black" }}>
      {String(this.state.error?.message || this.state.error)}
    </Text>
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


const pathname =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.pathname
    : "";

const searchParams =
  Platform.OS === "web" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;

const isInternalHubUrl =
  pathname.startsWith("/hub/");

const isPublicHubUrl =
  pathname.startsWith("/h/");

const isPublicAssetUrl =
  pathname.startsWith("/k/") ||
  pathname.startsWith("/resolve/");

const forceKeeprShell =
  currentRouteName === "KeeprHubInternal" ||
  currentRouteName === "KeeprStoryInternal" ||
  isInternalHubUrl;

const forcePublicShell =
  !forceKeeprShell &&
  (isPublicHubUrl || isPublicAssetUrl);

const isPublicWebRoute =
  forcePublicShell ||
  (
    !forceKeeprShell &&
    [
      "PublicKeeprStory",
      "PublicAction",
      "KacRoute",
      "KacResolve",
      "KeeprHub",
    ].includes(currentRouteName)
  );

const hideSidebarRoutes = [
  "StoryPrint", 
  "Auth", 
  "ResetPassword",
  "PublicKeeprStory",
  "KeeprHub",
  "ShareAction",
  "PublicAction",
  "KacRoute",
  "KacResolve",
];

React.useEffect(() => {
  console.log("POSTHOG TEST EVENT FIRING");

  posthog.capture("debug_app_loaded", {
    platform: Platform.OS,
    timestamp: new Date().toISOString(),
  });
}, []);

  React.useEffect(() => {
  let mounted = true;

  const captureInitialInvite = async () => {
    try {
      const initialUrl = await ExpoLinking.getInitialURL();
      if (!mounted) return;
      await captureInviteSourceFromUrl(initialUrl);
    } catch (e) {
      console.log("Initial invite link capture failed:", e?.message || e);
    }
  };

  captureInitialInvite();

const subscription = ExpoLinking.addEventListener("url", ({ url }) => {
  console.log("🔥 URL RECEIVED:", url);
  captureInviteSourceFromUrl(url);
});

  return () => {
    mounted = false;
    subscription?.remove?.();
  };
}, []);

  /* Global handler for tapping push/local notifications
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
  */

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
                      <KaiProvider>

                        <EnhanceBootstrap />

                        {isWebShell ? (
                        isPublicWebRoute ? (
                          <Root
                            onRouteChange={setCurrentRouteName}
                            setCurrentRouteName={setCurrentRouteName}
                            currentRouteName={currentRouteName}
                          />
                        ) : (
                          <View style={appStyles.webShell}>
                            {hideSidebarRoutes.includes(currentRouteName) ? null : (
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
                        )
                      ) : (
                        <Root
                          onRouteChange={setCurrentRouteName}
                          setCurrentRouteName={setCurrentRouteName}
                          currentRouteName={currentRouteName}
                        />
                      )}

                      </KaiProvider>
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
  backgroundColor: colors.background,
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
