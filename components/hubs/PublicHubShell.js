import React from "react";
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import HubHeader from "./HubHeader";

const keeprLogo = require("../../assets/app_logo_icon.png");

export default function PublicHubShell({ children, hub, stats, logoUrl }) {
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <HubHeader hub={hub} stats={stats} logoUrl={logoUrl} />
          {children}
        </View>

        <View style={styles.footer}>
          <View style={styles.footerBrand}>
            <Image source={keeprLogo} style={styles.keeprLogo} resizeMode="contain" />
            <View>
              <Text style={styles.footerTitle}>Powered by Keepr™</Text>
              <Text style={styles.footerText}>
                Documented ownership continuity for the things that matter.
              </Text>
            </View>
          </View>

          <View style={styles.footerLinks}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === "web") window.open("https://www.keeprhome.com", "_blank");
              }}
            >
              <Text style={styles.footerLink}>Join Keepr</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === "web") window.open("https://www.keeprhome.com", "_blank");
              }}
            >
              <Text style={styles.footerLink}>About Keepr</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  footer: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 24,
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 18,
  },
  footerBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  keeprLogo: { width: 32, height: 32 },
  footerTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0F172A",
  },
  footerText: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748B",
  },
  footerLinks: {
    flexDirection: "row",
    gap: 18,
    marginTop: 12,
  },
  footerLink: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
});