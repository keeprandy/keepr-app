// screens/onboarding/OnboardingWelcomeScreen.js

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { navigationRef } from "../../navigationRoot";

export default function OnboardingWelcomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="book-outline" size={28} color="#2563EB" />
        </View>

        <Text style={styles.title}>Every asset has a story.</Text>

        <Text style={styles.body}>
          Before you owned it.{"\n"}
          While you care for it.{"\n"}
          And one day, after you.
        </Text>

        <Text style={styles.sub}>
          Keepr helps you document that story — and make it Keepr Enabled.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigationRef.navigate("OnboardingChooseAssetType")}
        >
          <Text style={styles.buttonText}>Start your first story</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#E8F0FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: "800", color: "#111827", marginBottom: 16 },
  body: { fontSize: 16, color: "#374151", lineHeight: 26, marginBottom: 16 },
  sub: { fontSize: 14, color: "#6B7280", marginBottom: 40 },
  button: {
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15 },
});