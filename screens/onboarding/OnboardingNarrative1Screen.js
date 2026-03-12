// screens/onboarding/OnboardingNarrative1Screen.js
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";
import KaiOrb from "../../components/KaiOrb";

const IS_WEB = Platform.OS === "web";

async function dismissOnboarding() {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return;
  await supabase.from("profiles").update({ onboarding_state: "dismissed" }).eq("id", userId);
}

function PrimaryButton({ title, onPress }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress}>
      <Text style={styles.primaryBtnText}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function OnboardingNarrative1Screen() {
  return (
    
    <SafeAreaView style={styles.screen}>

      <View style={styles.container}>
        <View style={styles.card}>
                <View style={styles.kaiGuideWrap}>
                  <View style={styles.orbWrap}>
                    <KaiOrb size={88} variant="compact" rotate={false} />
                    </View>
                    <View style={styles.kaiGuideTextWrap}>
                        <Text style={styles.kaiGuideLabel}>Kai</Text>
                        <Text style={styles.kaiGuideSub}>
                          I’ll walk you through how Keepr™ works.
                        </Text>
                    </View>
                </View>
          <Text style={styles.h1}>Ownership deserves structure.</Text>

          <Text style={styles.p}>The day you need proof is not the day to start organizing.</Text>

          <Text style={styles.p}>Keepr™ gives your assets a clear story.</Text>

          <View style={{ height: 28 }} />

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
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        {IS_WEB ? <View style={{ height: 20 }} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },

container: { flex: 1, padding: 24, justifyContent: "center" },

  orbWrap: {
    alignItems: "center",
    marginBottom: 18,
    width: 120,
    height: 120,
  },
  kaiGuideWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  kaiGuideTextWrap: {
    marginLeft: 12,
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
    padding: 22,
  },

  h1: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    lineHeight: 30,
    marginBottom: 18,
  },

  p: {
    fontSize: 16,
    color: "#111827",
    lineHeight: 24,
    marginBottom: 14,
  },

  primaryBtn: {
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 26,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
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
