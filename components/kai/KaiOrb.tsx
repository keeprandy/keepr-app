import React from "react";
import { TouchableOpacity, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  onPress: () => void;
};

export default function KaiOrb({ onPress }: Props) {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.orb} onPress={onPress}>
        <Ionicons name="sparkles" size={22} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 24,
    right: 24,
    zIndex: 999
  },
  orb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1E6DE0", // Keepr Blue
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6
  }
});