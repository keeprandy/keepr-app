// screens/onboarding/OnboardingKeeprEnableScreen.js

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";

export default function OnboardingKeeprEnableScreen({ route }) {
  const { assetId } = route.params;

  const completeOnboarding = async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;

    await supabase
      .from("profiles")
      .update({ onboarding_state: "completed" })
      .eq("id", userId);

    navigationRef.navigate("RootTabs");
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>Make this Keepr Enabled</Text>

        <Text style={styles.body}>
          A Keepr Enabled asset includes:
        </Text>

        <Text style={styles.list}>• A curated photo{"\n"}
          • One piece of proof{"\n"}
          • One defined system
        </Text>

        <Text style={styles.sub}>
          You can add these now — or continue and build it over time.
        </Text>

        <TouchableOpacity style={styles.button} onPress={completeOnboarding}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 16 },
  body: { fontSize: 14, color: "#374151", marginBottom: 12 },
  list: { fontSize: 14, color: "#111827", lineHeight: 22, marginBottom: 20 },
  sub: { fontSize: 13, color: "#6B7280", marginBottom: 30 },
  button: {
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "700" },
});