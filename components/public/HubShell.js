import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';


const keeprLogo = require("../../assets/app_logo_icon.png");

export default function HubShell({
  children,
  hub,
  stats,
}) {
  const name = hub?.name || "KeeprHub";
  const type = hub?.hub_type || "community";
  const logoUrl = hub?.hero_image_url || null;

  return (
    <SafeAreaView
  edges={['top']}
  style={styles.screen}>
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <View style={styles.hero}>
            <View style={styles.logoWrap}>
            {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" />
            ) : (
                <Text style={styles.logoText}>
                {(hub?.name || "Hub").slice(0, 2).toUpperCase()}
                </Text>
            )}
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{name}</Text>
              <Text style={styles.type}>{type.toUpperCase()}</Text>

              <Text style={styles.stats}>
                {stats?.stories || 0} {(stats?.stories || 0) === 1 ? "Story" : "Stories"} ·{" "}
                {stats?.owners || 0} {(stats?.owners || 0) === 1 ? "Owner" : "Owners"} ·{" "}
                {stats?.makes || 0} {(stats?.makes || 0) === 1 ? "Make" : "Makes"}
              </Text>

              <Text style={styles.tagline}>
                Member-owned stories, history, and proof of care.
              </Text>

              {!!hub?.description && (
                <Text style={styles.description}>{hub.description}</Text>
              )}
            </View>
          </View>

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
    </View>
    </SafeAreaView>
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
  container: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
    marginBottom: 24,
  },
  logoWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: "86%",
    height: "86%",
  },
  logoText: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
  },
  type: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    color: "#64748B",
  },
  stats: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "800",
    color: "#334155",
  },
  tagline: {
    marginTop: 6,
    fontSize: 14,
    color: "#475569",
    fontWeight: "600",
  },
  description: {
    marginTop: 10,
    fontSize: 14,
    color: "#64748B",
    fontWeight: "700",
    lineHeight: 20,
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
  keeprLogo: {
    width: 32,
    height: 32,
  },
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