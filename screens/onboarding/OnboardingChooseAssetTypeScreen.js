// screens/onboarding/OnboardingChooseAssetTypeScreen.js

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { navigationRef } from "../../navigationRoot";

const Option = ({ icon, label, type }) => (
  <TouchableOpacity
    style={styles.option}
    onPress={() =>
      navigationRef.navigate(type === "home" ? "AddHomeAsset" : type === "vehicle" ? "AddVehicleAsset" : "AddMarineAsset", { fromOnboarding: true })
    }
  >
    <View style={styles.optionIcon}>
      <Ionicons name={icon} size={20} color="#111827" />
    </View>
    <Text style={styles.optionText}>{label}</Text>
  </TouchableOpacity>
);

export default function OnboardingChooseAssetTypeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>Ready to start your first asset?</Text>

        <Option icon="home-outline" label="Home" type="home" />
        <Option icon="car-outline" label="Vehicle" type="vehicle" />
        <Option icon="boat-outline" label="Boat" type="boat" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 24 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    backgroundColor: "white",
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  optionText: { fontSize: 15, fontWeight: "700" },
});