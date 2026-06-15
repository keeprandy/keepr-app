import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import HubHeader from "./HubHeader";

export default function InternalHubShell({ children, hub, stats, logoUrl }) {
  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <HubHeader hub={hub} stats={stats} logoUrl={logoUrl} />
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F7FA" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  container: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
  },
});