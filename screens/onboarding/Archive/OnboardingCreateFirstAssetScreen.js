// screens/onboarding/OnboardingCreateFirstAssetScreen.js

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabaseClient";
import { navigationRef } from "../../navigationRoot";

export default function OnboardingCreateFirstAssetScreen({ route }) {
  const { type } = route.params;
  const [name, setName] = useState("");

  const createAsset = async () => {
    if (!name.trim()) return Alert.alert("Please enter a name.");

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;

const { data, error } = await supabase
  .from("assets")
  .insert({
    owner_id: userId,
    name: name.trim(),
    type, // ✅ matches schema ("home" | "vehicle" | "boat")
    status: "active",
  })
  .select("id")
  .single();

    if (error) return Alert.alert(error.message);

    await supabase
      .from("profiles")
      .update({ onboarding_asset_id: data.id })
      .eq("id", userId);

    navigationRef.navigate("OnboardingKeeprEnable", {
      assetId: data.id,
    });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>Name your story.</Text>

        <TextInput
          style={styles.input}
          placeholder="Brighton Home"
          value={name}
          onChangeText={setName}
        />

        <TouchableOpacity style={styles.button} onPress={createAsset}>
          <Text style={styles.buttonText}>Create story</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 24 },
  input: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "700" },
});