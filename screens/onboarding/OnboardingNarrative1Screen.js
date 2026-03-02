// screens/onboarding/OnboardingNarrative1Screen.js
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";

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
          <Text style={styles.h1}>Ownership deserves structure.</Text>

          <Text style={styles.p}>The day you need proof</Text>
          <Text style={styles.p}>is not the day to start organizing.</Text>

          <View style={{ height: 18 }} />

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
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 22,
  },
  h1: { fontSize: 22, fontWeight: "900", color: "#111827", lineHeight: 28, marginBottom: 16 },
  p: { fontSize: 16, color: "#111827", lineHeight: 22 },
  primaryBtn: {
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  skipWrap: { marginTop: 16, alignItems: "center" },
  skipText: { color: "#6B7280", fontSize: 13, fontWeight: "700" },
});
