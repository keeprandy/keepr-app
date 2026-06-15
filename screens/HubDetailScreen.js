import React from "react";
import { supabase } from "../lib/supabaseClient";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, shadows } from "../styles/theme";
import {
  fetchHub,
  fetchHubStoryLinks,
  fetchHubMembers,
} from "../lib/hubsApi";
import { useFocusEffect } from "@react-navigation/native";

function getMemberName(member) {
  return (
    member?.display_name ||
    member?.profile?.display_name ||
    member?.profile?.full_name ||
    member?.profile?.inbox_name ||
    member?.profile?.username ||
    member?.profile?.email ||
    member?.email ||
    "Member"
  );
}

function getRoleLabel(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function getAssetSubtitle(asset) {
  const parts = [asset?.year, asset?.make, asset?.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "Ownership Story";
}

function getOwnerName(row) {
  const profile = row?.ownerProfile;

  return (
    profile?.display_name ||
    profile?.full_name ||
    profile?.inbox_name ||
    profile?.username ||
    profile?.email ||
    null
  );
}

function getAssetTitle(asset) {
  const yearMakeModel = [asset?.year, asset?.make, asset?.model]
    .filter(Boolean)
    .join(" ");

  return (
    asset?.name ||
    yearMakeModel ||
    asset?.kac_id ||
    "Ownership Story"
  );
}

export default function HubDetailScreen({ navigation, route }) {
  const hubId = route?.params?.hubId;
  const slug = route?.params?.slug;

  const [loading, setLoading] = React.useState(true);
  const [hub, setHub] = React.useState(null);
  const [stories, setStories] = React.useState([]);
  const [members, setMembers] = React.useState([]);

  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user || null);
    });
  }, []);

  const loadHub = React.useCallback(async () => {
    if (!hubId) {
      Alert.alert("Missing Hub", "No Hub was provided.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [hubRecord, storyRows, memberRows] = await Promise.all([
        fetchHub(hubId),
        fetchHubStoryLinks(hubId),
        fetchHubMembers(hubId),
      ]);

      setHub(hubRecord);
      setStories(storyRows || []);
      setMembers(memberRows || []);
    } catch (e) {
      Alert.alert("Could not load Hub", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useFocusEffect(
  React.useCallback(() => {
    loadHub();
  }, [loadHub])
);

  const openPublicHub = () => {
    const hubSlug = hub?.slug || slug;
    if (!hubSlug) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(`/h/${hubSlug}`, "_blank", "noopener,noreferrer");
      return;
    }

    navigation.navigate("KeeprHub", { slug: hubSlug });
  };

const currentMember = members.find(
  (m) => String(m.user_id) === String(user?.id)
);

const canAddStory = !!currentMember || !!user?.id;

const canManage =
  currentMember?.role === "owner" ||
  currentMember?.role === "admin";

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading Hub…</Text>
        </View>
      </SafeAreaView>
    );
  }
  function AdminRow({ icon, title, onPress }) {
  return (
    <TouchableOpacity
      style={styles.adminRow}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={colors.textPrimary}
      />

      <Text style={styles.adminText}>
        {title}
      </Text>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );
}

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{hub?.name || "KeeprHub"} Profile</Text>
            <Text style={styles.subtitle}>
              {stories.length} {stories.length === 1 ? "Story" : "Stories"} •{" "}
              {members.length} {members.length === 1 ? "Member" : "Members"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>Hub</Text>
          <Text style={styles.cardTitle}>{hub?.name}</Text>
          {!!hub?.description && <Text style={styles.cardText}>{hub.description}</Text>}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() =>
              navigation.navigate("KeeprHubInternal", {
                hubId: hub.id,
                mode: "internal",
              })
            }
          >
            <Ionicons name="eye-outline" size={16} color="white" />
            <Text style={styles.primaryButtonText}>View Hub</Text>
          </TouchableOpacity>
          {canAddStory? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("AddHubStory", { hubId })}
          >
            <Ionicons name="add-circle-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>Add Asset Story</Text>
          </TouchableOpacity>
        ) : null}

        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Stories</Text>
          <View style={styles.card}>
            {stories.length === 0 ? (
              <Text style={styles.emptyText}>No stories linked yet.</Text>
            ) : (
              stories.map((row) => {
                const asset = row.asset;
                return (
                  <View key={row.id} style={styles.listRow}>
                    <View style={styles.rowIcon}>
                      <Ionicons name="document-text-outline" size={17} color={colors.textPrimary} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {getAssetTitle(asset)}
                      </Text>

                      <Text style={styles.rowSubtext}>
                        {getAssetSubtitle(asset)}
                      </Text>

                      {!!getOwnerName(row) && (
                        <Text style={styles.rowSubtext}>
                          Owned by {getOwnerName(row)}
                        </Text>
                      )}
                    </View>

                    {row.featured ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Featured</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Members</Text>
          <View style={styles.card}>
            {members.length === 0 ? (
              <Text style={styles.emptyText}>No members yet.</Text>
            ) : (
              members.map((member) => (
                <View key={member.id} style={styles.listRow}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="person-outline" size={17} color={colors.textPrimary} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{getMemberName(member)}</Text>
                    <Text style={styles.rowSubtext}>{getRoleLabel(member.role)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        {canManage && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Administration</Text>

            <View style={styles.card}>
              <AdminRow
                icon="create-outline"
                title="Edit Hub"
                onPress={() =>
                  navigation.navigate("EditHub", { hubId })
                }
              />

              <AdminRow
                icon="albums-outline"
                title="Manage Stories"
                onPress={() =>
                  navigation.navigate("ManageHubStories", {
                    hubId,
                  })
                }
              />

              <AdminRow
                icon="person-add-outline"
                title="Invite Members"
                onPress={() =>
                  navigation.navigate("InviteHubMembers", {
                    hubId,
                  })
                }
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg || colors.background || "#F5F6F8" },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, color: colors.textMuted },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },
  secondaryButton: {
  marginTop: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  borderRadius: 14,
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
  paddingVertical: 12,
},

secondaryButtonText: {
  color: colors.textPrimary,
  fontWeight: "900",
  fontSize: 13,
},
  title: { fontSize: 24, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 3, fontSize: 13, fontWeight: "700", color: colors.textMuted },

  section: { marginTop: 12 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardTitle: { marginTop: 4, fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  cardText: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.textMuted },

  primaryButton: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 12,
  },
  primaryButtonText: { color: "#fff", fontWeight: "900", fontSize: 13 },

  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },
  rowTitle: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  rowSubtext: { marginTop: 2, fontSize: 12, fontWeight: "600", color: colors.textMuted },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  emptyText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },

  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  adminText: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.textPrimary },
});