import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

let configured = false;
let configurePromise = null;
let configuredAppUserId = null;

export async function configurePurchases(appUserId) {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  if (!appUserId) return;

  if (configured && configuredAppUserId === appUserId) return;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    Purchases.setLogLevel(LOG_LEVEL.INFO);

    if (configuredAppUserId === appUserId) {
      configured = true;
      return;
    }

    await Purchases.configure({
      apiKey:
        Platform.OS === "ios"
          ? process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
          : process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
      appUserID: appUserId,
          });

    configured = true;
    configuredAppUserId = appUserId;
  })();

  try {
    await configurePromise;
  } finally {
    configurePromise = null;
  }
}

export async function ensurePurchasesConfigured() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  if (!configured) {
    throw new Error("RevenueCat is not configured yet.");
  }
}

export async function getAllOfferings() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  await ensurePurchasesConfigured();

  const offerings = await Purchases.getOfferings();
  console.log("RC offerings:", JSON.stringify(offerings, null, 2));
  return offerings;
}

export async function getTeamOffering() {
  const offerings = await getAllOfferings();
  return offerings?.all?.default || null;   
}

export async function getPlusOffering() {
  const offerings = await getAllOfferings();
  return offerings?.all?.plus || null;      
}

export async function getPackage(planKey, cycle) {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  if (!planKey || !cycle) return null;

  const normalizedPlan = String(planKey).toLowerCase();
  const normalizedCycle =
    cycle === "yearly" ? "annual" : String(cycle).toLowerCase();

  let offering = null;

  if (normalizedPlan === "team") {
    offering = await getTeamOffering();
  } else if (normalizedPlan === "plus") {
    offering = await getPlusOffering();
  } else {
    throw new Error(`Unknown plan: ${planKey}`);
  }

  if (!offering) return null;

  if (normalizedCycle === "monthly") return offering.monthly ?? null;
  if (normalizedCycle === "annual") return offering.annual ?? null;

  throw new Error(`Unknown cycle: ${cycle}`);
}

export async function purchasePackage(pkg) {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  await ensurePurchasesConfigured();

  if (!pkg) {
    throw new Error("No package provided for purchase.");
  }

  const result = await Purchases.purchasePackage(pkg);
  return result.customerInfo;
}

export async function restoreRevenueCatPurchases() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  await ensurePurchasesConfigured();
  return await Purchases.restorePurchases();
}

export function hasEntitlement(customerInfo, entitlementKey) {
  return !!customerInfo?.entitlements?.active?.[entitlementKey];
}
