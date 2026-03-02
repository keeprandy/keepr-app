// screens/onboarding/OnboardingNarrative2Screen.js
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";

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

export default function OnboardingNarrative2Screen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.h1}>How Keepr™ works: 4 Basics</Text>

          <View style={styles.row}>
            <Text style={styles.term}>Asset</Text>
            <Text style={styles.def}>What you own: Home, Car, Boat, etc.</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.term}>System</Text>
            <Text style={styles.def}>How it works: Think Furnace, or Tires</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.term}>Record</Text>
            <Text style={styles.def}>What happened: Oil Change, New Refrigerator</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.term}>Attachment</Text>
            <Text style={styles.def}>What proves it: Receipt, Invoice, Warranty</Text>
          </View>

          <View style={{ height: 16 }} />

          <Text style={styles.p}>
            Attach proof to the right part of the story —{"\n"}
            and everything stays connected.
          </Text>

          <View style={{ height: 22 }} />

          <PrimaryButton title="Continue" onPress={() => navigationRef.navigate("Onboarding3")} />

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
  row: { flexDirection: "row", alignItems: "baseline", marginBottom: 10 },
  term: { width: 110, fontSize: 16, fontWeight: "900", color: "#111827" },
  def: { fontSize: 16, color: "#111827" },
  p: { fontSize: 15, color: "#111827", lineHeight: 22 },
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
});
