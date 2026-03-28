// screens/onboarding/OnboardingNarrative1Screen.js
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";
import KaiOrb from "../../components/KaiOrb";

const IS_WEB = Platform.OS === "web";

async function dismissOnboarding() {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return;
  await supabase
    .from("profiles")
    .update({ onboarding_state: "dismissed" })
    .eq("id", userId);
}

function PrimaryButton({ title, onPress }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} activeOpacity={0.9}>
      <Text style={styles.primaryBtnText}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function OnboardingNarrative1Screen() {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.kaiGuideWrap}>
              <View style={styles.orbWrap}>
                <KaiOrb size={88} variant="compact" rotate={false} />
              </View>
              <View style={styles.kaiGuideTextWrap}>
                <Text style={styles.kaiGuideLabel}>Kai</Text>
                <Text style={styles.kaiGuideSub}>
                  Let's get you started with Keepr™.
                </Text>
              </View>
            </View>

            <Text style={styles.h1}>How can Keepr™ help?</Text>


            <Text style={styles.p}>Get organized and reduce clutter.</Text>
            <Text style={styles.p}>Document my home with no more papers everywhere.</Text>
            <Text style={styles.p}>Track my vehicles, RVs, toys, and equipment.</Text>
            <Text style={styles.p}>
              Prepare to sell something by proving its upkeep and care.
            </Text>
            <Text style={styles.p}>
              Help manage my season cycles: Winterization and Fall Cleanup.
            </Text>
            <Text style={styles.p}>Organize your rental property or second home.</Text>

            <View style={styles.spacer} />

            <Text style={styles.h1}>Keepr™ gives your assets a clear story.</Text>

            <View style={styles.footer}>
              <PrimaryButton
                title="Continue"
                onPress={() => navigationRef.navigate("Onboarding2")}
              />

              <TouchableOpacity
                onPress={async () => {
                  await dismissOnboarding();
                  navigationRef?.reset?.({ index: 0, routes: [{ name: "RootTabs" }] });
                }}
                style={styles.skipWrap}
                activeOpacity={0.85}
              >
                <Text style={styles.skipText}>Skip for now</Text>
              </TouchableOpacity>
            </View>
          </View>

          {IS_WEB ? <View style={{ height: 20 }} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: "flex-start",
  },
  orbWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 96,
    height: 96,
    marginRight: 12,
  },
  kaiGuideWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  kaiGuideTextWrap: {
    flex: 1,
  },
  kaiGuideLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
  },
  kaiGuideSub: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: "#6B7280",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 20,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  h1: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    lineHeight: 30,
    marginBottom: 12,
  },
  sub: {
    fontSize: 16,
    lineHeight: 24,
    color: "#6B7280",
    marginBottom: 14,
  },
  p: {
    fontSize: 16,
    color: "#111827",
    lineHeight: 24,
    marginBottom: 12,
  },
  spacer: {
    height: 18,
  },
  footer: {
    marginTop: 24,
  },
  primaryBtn: {
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  skipWrap: {
    marginTop: 16,
    alignItems: "center",
  },
  skipText: {
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "700",
  },
});