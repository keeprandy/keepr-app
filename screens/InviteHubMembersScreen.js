import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
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
  fetchHubMembers,
  inviteHubMember,
  removeHubMember,
} from "../lib/hubsApi";
import { useAuth } from "../context/AuthContext";
import HubActionRow from "../components/hubs/HubActionRow";

export default function InviteHubMembersScreen({ navigation, route }) {
  const hubId = route?.params?.hubId;
  const { user } = useAuth();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [hub, setHub] = React.useState(null);
  const [members, setMembers] = React.useState([]);

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const [hubRecord, memberRows] = await Promise.all([
        fetchHub(hubId),
        fetchHubMembers(hubId),
      ]);
      setHub(hubRecord);
      setMembers(memberRows || []);
    } catch (e) {
      Alert.alert("Could not load members", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const pendingInvites = members.filter((m) => m.status === "invited");
  const activeMembers = members.filter((m) => m.status !== "invited");

  const currentMember = members.find(
  (m) => String(m.user_id) === String(user?.id)
);

const canManage =
  currentMember?.role === "owner" ||
  currentMember?.role === "admin";

  const submitInvite = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      Alert.alert("Missing email", "Enter an email address.");
      return;
    }

    try {
      setSaving(true);

      await inviteHubMember({
        hubId,
        email: cleanEmail,
        role,
        invitedBy: user?.id,
      });

      setEmail("");
      setRole("member");
      await load();
    } catch (e) {
      Alert.alert("Could not invite member", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member) => {
    const confirmed =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.confirm("Remove this member or invite from the Hub?")
        : true;

    if (!confirmed) return;

    try {
      await removeHubMember(member.id);
      await load();
    } catch (e) {
      Alert.alert("Could not remove member", e?.message || "Try again.");
    }
  };

  const memberLabel = (member) =>
    member.email || member.user_id || "Hub member";

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading members…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Invite Members</Text>
            <Text style={styles.subtitle}>
              {hub?.name || "Hub"} • Invite contributors to share public Stories.
            </Text>
          </View>
        </View>

        <HubActionRow
          navigation={navigation}
          hub={hub}
          hubId={hubId}
          canManage={canManage}
          active="members"
        />

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="member@example.com"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>Role</Text>
          <View style={styles.pillWrap}>
            {["member", "admin"].map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setRole(value)}
                style={[styles.pill, role === value && styles.pillActive]}
              >
                <Text style={[styles.pillText, role === value && styles.pillTextActive]}>
                  {value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={submitInvite}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="person-add-outline" size={16} color="#fff" />
                <Text style={styles.saveButtonText}>Invite Member</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <MemberSection
          title="Pending Invites"
          emptyText="No pending invites."
          members={pendingInvites}
          memberLabel={memberLabel}
          onRemove={removeMember}
        />

        <MemberSection
          title="Active Members"
          emptyText="No active members yet."
          members={activeMembers}
          memberLabel={memberLabel}
          onRemove={removeMember}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberSection({ title, emptyText, members, memberLabel, onRemove }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>

      <View style={styles.card}>
        {members.length === 0 ? (
          <Text style={styles.emptyText}>{emptyText}</Text>
        ) : (
          members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <View style={styles.rowIcon}>
                <Ionicons
                  name={member.status === "invited" ? "mail-outline" : "person-outline"}
                  size={17}
                  color={colors.textPrimary}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{memberLabel(member)}</Text>
                <Text style={styles.rowSubtext}>
                  {member.role || "member"} • {member.status || "active"}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => onRemove(member)}
              >
                <Ionicons name="trash-outline" size={16} color="#B91C1C" />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </View>
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
  title: { fontSize: 24, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 3, fontSize: 13, fontWeight: "700", color: colors.textMuted },
  section: { marginTop: 14 },
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
  label: {
    marginTop: 12,
    marginBottom: 7,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    fontWeight: "700",
  },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },
  pillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
    textTransform: "capitalize",
  },
  pillTextActive: { color: "#fff" },
  saveButton: {
    marginTop: 18,
    backgroundColor: colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  saveButtonText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  memberRow: {
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
  emptyText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
});