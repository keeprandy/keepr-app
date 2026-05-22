import React from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
  TouchableOpacity,
  StatusBar,
} from "react-native";

const keeprLogo = require("../../assets/app_logo_icon.png");

export default function PublicShell({
  children,
  kac,
}) {
  return (
  <View style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerInner}>
        <TouchableOpacity
          onPress={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.open(
                "https://www.keeprhome.com",
                "_blank",
                "noopener,noreferrer"
              );
            }
          }}
          style={styles.brandRow}
          activeOpacity={0.85}
        >
          <Image source={keeprLogo} style={styles.logo} resizeMode="contain" />

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>Keepr™ Story</Text>
            <Text style={styles.subtitle}>Documented ownership continuity.</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
                  style={styles.createYoursButton}
                  onPress={() => {
                    const url = `${getPublicStoryBaseUrl()}/invite/keepr`;
                    if (Platform.OS === "web" && typeof window !== "undefined") {
                      window.location.href = url;
                    }
                  }}
                  activeOpacity={0.88}
                >
                  <Text style={styles.createYoursButtonText}>Create yours</Text>
                </TouchableOpacity>

        {!!kac && (
          <View style={styles.kacPill}>
            <Text style={styles.kacLabel}>KAC</Text>
            <Text numberOfLines={1} style={styles.kacValue}>
              {kac}
            </Text>
          </View>
        )}
      </View>
    </View>

    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.container}>{children}</View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Powered by Keepr™ — documented ownership continuity for the things that matter.
        </Text>
      </View>
    </ScrollView>
  </View>
);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 40,
  },

  header: {
  width: "100%",
  backgroundColor: "#FFFFFF",
  borderBottomWidth: 1,
  borderBottomColor: "#E7EBF0",

  paddingTop:
  Platform.OS === "web"
    ? 12
    : Platform.OS === "android"
    ? (StatusBar.currentHeight || 24) + 12
    : 60,
},

  headerInner: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },

  logo: {
    width: 34,
    height: 34,
    marginRight: 9,
    flexShrink: 0,
  },

  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },

  subtitle: {
    marginTop: 2,
    fontSize: 11,
    color: "#64748B",
  },

  kacPill: {
    maxWidth: 150,
    borderWidth: 1,
    borderColor: "#D8DEE8",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "#FFFFFF",
    flexShrink: 0,
  },

  kacLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 1,
  },

  kacValue: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
  },

  container: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingTop: 16,
  },

  footer: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 14,
    marginTop: 24,
  },

  footerText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748B",
  },
});