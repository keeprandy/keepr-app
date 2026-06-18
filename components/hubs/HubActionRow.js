import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../styles/theme";

export default function HubActionRow({
  navigation,
  hub,
  hubId,
  canManage = false,
  active = "overview",
}) {
  const id = hubId || hub?.id;

  const goPublic = () => {
    if (!hub?.slug) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(`/h/${hub.slug}`, "_blank", "noopener,noreferrer");
      return;
    }

    navigation.navigate("KeeprHub", { slug: hub.slug });
  };

  const actions = [
    {
      key: "overview",
      label: "Overview",
      icon: "grid-outline",
      onPress: () => navigation.navigate("HubDetail", { hubId: id }),
    },
    {
      key: "stories",
      label: "Stories",
      icon: "albums-outline",
      onPress: () => navigation.navigate("ManageHubStories", { hubId: id }),
    },
    {
      key: "members",
      label: "Members",
      icon: "people-outline",
      onPress: () => navigation.navigate("InviteHubMembers", { hubId: id }),
    },
    {
      key: "settings",
      label: "Settings",
      icon: "settings-outline",
      onPress: () => navigation.navigate("EditHub", { hubId: id }),
      adminOnly: true,
    },
    {
      key: "public",
      label: "Public",
      icon: "globe-outline",
      onPress: goPublic,
    },
  ];

  return (
    <View style={styles.row}>
      {actions
        .filter((item) => !item.adminOnly || canManage)
        .map((item) => {
          const isActive = active === item.key;

          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.pill, isActive && styles.pillActive]}
              onPress={item.onPress}
              activeOpacity={0.85}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={isActive ? "#fff" : colors.textPrimary}
              />
              <Text style={[styles.text, isActive && styles.textActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  text: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },
  textActive: {
    color: "#fff",
  },
});