import React from "react";
import { View, Text, StyleSheet, Image, useWindowDimensions } from "react-native";

export default function HubHeader({ hub, stats, logoUrl }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 640;
  const name = hub?.name || "KeeprHub";
  const type = hub?.hub_type || "community";
  const finalLogoUrl = logoUrl || hub?.logo_url || hub?.photo_url || hub?.hero_image_url || null;
  const description = hub?.description || null;

  return (
    <View style={[styles.hero, isCompact && styles.heroCompact]}>
      <View style={[styles.identityRow, isCompact && styles.identityRowCompact]}>
        <View style={[styles.logoWrap, isCompact && styles.logoWrapCompact]}>
          {finalLogoUrl ? (
            <Image source={{ uri: finalLogoUrl }} style={styles.logo} resizeMode="contain" />
          ) : (
            <Text style={[styles.logoText, isCompact && styles.logoTextCompact]}>
              {(hub?.name || "Hub").slice(0, 2).toUpperCase()}
            </Text>
          )}
        </View>

        <View style={styles.titleBlock}>
          <Text style={[styles.title, isCompact && styles.titleCompact]}>{name}</Text>
          <Text style={styles.type}>{type.toUpperCase()}</Text>

          <Text style={styles.stats}>
            {stats?.stories || 0} {(stats?.stories || 0) === 1 ? "Story" : "Stories"} ·{" "}
            {stats?.owners || 0} {(stats?.owners || 0) === 1 ? "Owner" : "Owners"} ·{" "}
            {stats?.makes || 0} {(stats?.makes || 0) === 1 ? "Make" : "Makes"}
          </Text>
        </View>
      </View>

      {!isCompact ? (
        <View style={styles.desktopCopy}>
        <Text style={styles.tagline}>
          Member-owned stories, history, and proof of care.
        </Text>

        {!!description && (
          <Text style={styles.description}>{description}</Text>
        )}
        </View>
      ) : null}

      {isCompact && description ? (
        <View style={styles.descriptionCard}>
          <Text style={styles.description}>{description}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginBottom: 24,
  },
  heroCompact: {
    marginBottom: 16,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
  },
  identityRowCompact: {
    gap: 12,
    alignItems: "center",
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
  logoWrapCompact: {
    width: 76,
    height: 76,
    borderRadius: 38,
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
  logoTextCompact: {
    fontSize: 19,
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
  titleCompact: {
    fontSize: 25,
    lineHeight: 29,
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
  desktopCopy: {
    marginLeft: 150,
  },
  descriptionCard: {
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  description: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "700",
    lineHeight: 20,
  },
});
