import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

let configured = false;
let configurePromise = null;

export async function configurePurchases(appUserId) {
  if (Platform.OS !== "ios") return;
  if (!appUserId) return;
  if (configured) return;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    Purchases.setLogLevel(LOG_LEVEL.INFO);

    await Purchases.configure({
      apiKey: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
      appUserID: appUserId,
    });

    configured = true;
  })();

  try {
    await configurePromise;
  } finally {
    configurePromise = null;
  }
}

export async function ensurePurchasesConfigured() {
  if (Platform.OS !== "ios") return;
  if (!configured) {
    throw new Error("RevenueCat is not configured yet.");
  }
}

export async function getAnnualPackage() {
  if (Platform.OS !== "ios") return null;
  await ensurePurchasesConfigured();
  const offerings = await Purchases.getOfferings();
  console.log("RC offerings:", JSON.stringify(offerings, null, 2));
  return offerings?.current?.annual ?? null;
}

export async function purchaseAnnualPackage(pkg) {
  if (Platform.OS !== "ios") return null;
  await ensurePurchasesConfigured();
  const result = await Purchases.purchasePackage(pkg);
  return result.customerInfo;
}

export async function restoreRevenueCatPurchases() {
  if (Platform.OS !== "ios") return null;
  await ensurePurchasesConfigured();
  return await Purchases.restorePurchases();
}

export function hasTeamEntitlement(customerInfo) {
  return !!customerInfo?.entitlements?.active?.team;
}