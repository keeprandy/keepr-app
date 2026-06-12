import React from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { useAuth } from "../context/AuthContext";
import { fetchMyHubs } from "../lib/hubsApi";
import { colors, spacing, radius, shadows } from "../styles/theme";

export default function MyHubsScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [hubs, setHubs] = React.useState([]);

  const load = React.useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const rows = await fetchMyHubs(user.id);
      setHubs(rows || []);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>KeeprHubs</Text>
            <Text style={styles.subtitle}>
              Shared spaces for clubs, communities, events, dealers, and member Stories.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate("CreateHub")}
        >
          <Ionicons name="add-circle-outline" size={18} color="#fff" />
          <Text style={styles.primaryButtonText}>Create Hub</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>My Hubs</Text>

        {loading ? (
          <ActivityIndicator />
        ) : hubs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No Hubs yet.</Text>
            <Text style={styles.emptyText}>
              Create a Hub for a club, event, marina, dealer, or ownership community.
            </Text>
          </View>
        ) : (
          hubs.map((hub) => (
            <TouchableOpacity
              key={hub.id}
              style={styles.card}
              onPress={() => navigation.navigate("HubDetail", { hubId: hub.id })}
            >
              <View style={styles.icon}>
                <Ionicons name="people-outline" size={18} color={colors.textPrimary} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{hub.name}</Text>
                <Text style={styles.cardMeta}>
                  {hub.role || "member"} • {hub.visibility || "public"}
                </Text>
                {hub.description ? (
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {hub.description}
                  </Text>
                ) : null}
              </View>

              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg || colors.background || "#F5F6F8" },
  wrap: {
  paddingHorizontal: 14,
  paddingTop: 14,
  paddingBottom: spacing.xl,
  maxWidth: 920,
  alignSelf: "center",
  width: "100%",
},

  headerRow: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: spacing.lg,
},

backButton: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  marginRight: spacing.sm,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
},
title: {
  fontSize: 24,
  fontWeight: "900",
  color: colors.textPrimary,
},

subtitle: {
  marginTop: 3,
  fontSize: 13,
  fontWeight: "700",
  color: colors.textMuted,
},
  primaryButton: {
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: spacing.lg,
  },
  primaryButtonText: { color: "#fff", fontWeight: "900" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
    ...(shadows?.card || {}),
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  cardMeta: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.textMuted },
  cardDescription: { marginTop: 5, fontSize: 12, color: colors.textSecondary },
  emptyCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  emptyTitle: { fontWeight: "900", color: colors.textPrimary },
  emptyText: { marginTop: 4, color: colors.textSecondary, fontSize: 13 },
});