import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";

export default function HubHeader({ hub, stats, logoUrl }) {
  const name = hub?.name || "KeeprHub";
  const type = hub?.hub_type || "community";
  const finalLogoUrl = logoUrl || hub?.logo_url || hub?.photo_url || hub?.hero_image_url || null;

  return (
    <View style={styles.hero}>
      <View style={styles.logoWrap}>
        {finalLogoUrl ? (
          <Image source={{ uri: finalLogoUrl }} style={styles.logo} resizeMode="contain" />
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
  );
}

const styles = StyleSheet.create({
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
});