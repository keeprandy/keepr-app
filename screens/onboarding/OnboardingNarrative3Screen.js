// screens/onboarding/OnboardingNarrative3Screen.js
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";
import KaiOrb from "../../components/KaiOrb";

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

function SecondaryButton({ title, onPress }) {
  return (
    <TouchableOpacity style={styles.secondaryBtn} onPress={onPress}>
      <Text style={styles.secondaryBtnText}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function OnboardingNarrative3Screen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.card}>
                      <View style={styles.kaiGuideWrap}>
                      <KaiOrb size={88} variant="compact" rotate={false} />
                      <View style={styles.kaiGuideTextWrap}>
                        <Text style={styles.kaiGuideLabel}>Kai</Text>
                        <Text style={styles.kaiGuideSub}>
                          I’ll walk you through how Keepr works.
                        </Text>
                      </View>
                    </View>
          <Text style={styles.h1}>In the next 5 minutes…</Text>

          <Text style={styles.p}>You can:</Text>

          <View style={{ height: 10 }} />

          <Text style={styles.bullet}>• Add an asset you care about</Text>
          <Text style={styles.bullet}>• Define a key system</Text>
          <Text style={styles.bullet}>• Record something that’s already happened</Text>
          <Text style={styles.bullet}>• Attach the proof</Text>

          <View style={{ height: 18 }} />

          <Text style={styles.p}>Ready to start your first asset?</Text>

          <View style={{ height: 22 }} />

          <PrimaryButton
            title="Start"
            onPress={() => navigationRef.navigate("KaiOnboarding")}
          />

          <View style={{ height: 10 }} />

          <SecondaryButton title="Back" onPress={() => navigationRef.goBack()} />

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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 22,
  },
  h1: { fontSize: 22, fontWeight: "900", color: "#111827", lineHeight: 28, marginBottom: 14 },
  p: { fontSize: 15, color: "#111827", lineHeight: 22 },
  bullet: { fontSize: 15, color: "#111827", lineHeight: 22, marginBottom: 6 },
  primaryBtn: {
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  secondaryBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  secondaryBtnText: { color: "#111827", fontWeight: "900", fontSize: 15 },
  skipWrap: { marginTop: 16, alignItems: "center" },
  skipText: { color: "#6B7280", fontSize: 13, fontWeight: "700" },

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
});
