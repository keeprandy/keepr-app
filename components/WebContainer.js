import React from "react";
import { View, Platform, StyleSheet } from "react-native";

export default function WebContainer({ children }) {
  if (Platform.OS !== "web") return children;

  return <View style={styles.wrap}>{children}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    maxWidth: 900,
    marginHorizontal: "auto",
    minHeight: "100vh",
    backgroundColor: "transparent",
  },
});
