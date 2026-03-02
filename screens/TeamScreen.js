import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { navigationRef } from "../navigationRoot";

function initials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


function getMemberLabel(p) {
  if (!p) return "";
  const display = String(p.display_name || "").trim();
  if (display) return display;

  const full = String(p.full_name || "").trim();
  if (full) return full;

  const first = String(p.first_name || "").trim();
  const last = String(p.last_name || "").trim();
  const fl = `${first} ${last}`.trim();
  if (fl) return fl;

  const username = String(p.username || "").trim();
  if (username) return username;

  const email = String(p.email || "").trim();
  if (email) return email;

  return "";
}

export default function TeamScreen({ navigation }) {
  const [loading, setLoading] = React.useState(true);
  const [org, setOrg] = React.useState(null);
  const [members, setMembers] = React.useState([]);
  const [profile, setProfile] = React.useState(null);

  // Plan gate: keep screen visible, but disable mutating actions unless on Team.
  const planKey = String(profile?.plan || "").toLowerCase();
  const isTeam = planKey === "team" || planKey.includes("team");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("id, plan, email, display_name, full_name")
        .eq("id", uid)
        .single();

      setProfile(prof || null);

let orgRow = null;

// 1️⃣ First: owned org (same logic as Settings)
const { data: ownedOrg, error: ownedOrgErr } = await supabase
  .from("orgs")
  .select("id, name, display_name, org_type, owner_user_id, created_at")
  .eq("owner_user_id", uid)
  .neq("org_type", "personal")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (ownedOrgErr) throw ownedOrgErr;

if (ownedOrg?.id) {
  orgRow = ownedOrg;
} else {
  // 2️⃣ Fallback to membership org
  const { data: myMembership, error: memErr } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (memErr) throw memErr;

  if (myMembership?.org_id) {
    const { data: memberOrg, error: orgErr } = await supabase
      .from("orgs")
      .select("id, name, display_name, org_type, owner_user_id, created_at")
      .eq("id", myMembership.org_id)
      .maybeSingle();

    if (orgErr) throw orgErr;

    orgRow = memberOrg || null;
  }
}

setOrg(orgRow);
if (!orgRow?.id) {
  setMembers([]);
  setLoading(false);
  return;
}

      const { data: memberRows, error: membersErr } = await supabase
        .from("org_members")
        .select("org_id, user_id, member_role, created_at")
        .eq("org_id", orgRow.id)
        .order("created_at", { ascending: true });

      if (membersErr) throw membersErr;

      const ids = (memberRows || []).map((r) => r.user_id).filter(Boolean);
      let profilesById = {};

      if (ids.length > 0) {
      const { data: profRows, error: profErr } = await supabase
        .from("profiles")
        .select("*")
        .in("id", ids);

        if (profErr) throw profErr;

        (profRows || []).forEach((p) => {
          profilesById[p.id] = p;
        });
      }

      const combined = (memberRows || []).map((m) => {
        const p = profilesById[m.user_id] || {};
        return {
          ...m,
          display: getMemberLabel(p) || m.user_id,
          email: p.email || "",
        };
      });
// Ensure owner is always present
if (orgRow?.owner_user_id) {
  const hasOwner = combined.some(
    (m) => m.user_id === orgRow.owner_user_id
  );

  if (!hasOwner) {
    combined.unshift({
      org_id: orgRow.id,
      user_id: orgRow.owner_user_id,
      member_role: "owner",
      display:
        profile?.display_name ||
        profile?.full_name ||
        profile?.email ||
        orgRow.owner_user_id,
      email: profile?.email || "",
    });
  }
}
      combined.sort((a, b) => {
        const aOwner = a.member_role === "owner" ? 1 : 0;
        const bOwner = b.member_role === "owner" ? 1 : 0;
        return bOwner - aOwner;
      });

      setMembers(combined);
    } catch (e) {
      Alert.alert("Team load failed", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleInvite = () => {
    Alert.alert(
      "Invite (next)",
      "Next step is email invites. For V1 today, this screen is read-only so we can ship gating and UI."
    );
  };

  const handleRemove = (member) => {
    if (member.member_role === "owner") {
      Alert.alert("Not allowed", "You can't remove the owner.");
      return;
    }
    Alert.alert("Remove member (next)", "Removal will be wired after invites.");
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() =>
              navigation?.canGoBack?.()
                ? navigation.goBack()
                : navigationRef.navigate("RootTabs")
            }
            style={styles.backButton}
            activeOpacity={0.8}
          >
            <Ionicons
              name="chevron-back-outline"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Team</Text>
            <Text style={styles.subtitle}>Up to 5 total members.</Text>
          </View>
        </View>

        {!isTeam && (
          <View style={styles.notice}>
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={colors.textPrimary}
            />
            <Text style={styles.noticeText}>
              Team is available on the Team plan.
            </Text>
          </View>
        )}

        <View style={styles.card}>
      <View style={styles.teamIdentity}>
        
      <View style={styles.teamAvatarLarge}>
        {(org?.team_photo_url || org?.photo_url) ? (
          <Image
            source={{ uri: org?.team_photo_url || org?.photo_url }}
            style={styles.teamAvatarLargeImage}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.teamAvatarLargeText}>
            {initials(org?.display_name || org?.name || "Our Team")}
          </Text>
        )}
      </View>

        <Text style={styles.teamNameLarge}>
          {org?.display_name || org?.name || "Our Team"}
        </Text>

        <Text style={styles.teamMeta}>
          Owner · {profile?.display_name || profile?.full_name || profile?.email}
        </Text>
      </View>
          {isTeam && org?.id && (
            <TouchableOpacity
                style={styles.manageRow}
                onPress={() =>
                navigation.navigate("ManageTeam", { orgId: org.id })
                }
                activeOpacity={0.85}
            >
                <Text style={styles.manageText}>Manage team</Text>
                <Ionicons
                name="chevron-forward-outline"
                size={16}
                color={colors.textMuted}
                />
            </TouchableOpacity>
            )}
          <View style={styles.divider} />

          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>Members</Text>
            <Text style={styles.countText}>{members.length}/5</Text>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 14 }}>
              <ActivityIndicator size="small" color={colors.textMuted} />
            </View>
          ) : (
            <View style={{ gap: 10, paddingTop: 6 }}>
              {members.length === 0 ? (
                <Text style={styles.emptyText}>No members found yet.</Text>
              ) : (
                members.map((m) => (
                  <View key={m.user_id} style={styles.memberRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {initials(m.display)}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.display}
                      </Text>
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {m.member_role === "owner" && (
                          <View style={styles.ownerBadge}>
                            <Text style={styles.ownerBadgeText}>Owner</Text>
                          </View>
                        )}
                        {m.member_role !== "owner" && (
                          <Text style={styles.memberMeta}>{m.member_role}</Text>
                        )}
                      </View>
                        {m.email ? ` • ${m.email}` : ""}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleRemove(m)}
                      style={styles.memberAction}
                      activeOpacity={0.85}
                      disabled={!isTeam || m.member_role === "owner"}
                    >
                      <Ionicons
                        name="remove-circle-outline"
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}


        </View>

        <View style={styles.footerNote}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.footerText}>
            V1 scope: members share visibility. Fine-grained permissions
            (systems-only access) comes next.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg || "#F5F6F8" },
  content: {
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
    backgroundColor: colors.surfaceSubtle,
  },
  title: {
    ...(typography?.title || {}),
    fontSize: typography?.title?.fontSize ?? 22,
    fontWeight: typography?.title?.fontWeight ?? "700",
    color: colors.textPrimary,
  },
  subtitle: {
    ...(typography?.subtitle || {}),
    fontSize: typography?.subtitle?.fontSize ?? 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
teamIdentity: {
  alignItems: "center",
  marginBottom: 14,
},
ownerBadge: {
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 999,
  backgroundColor: "#E0F2FE",
},

ownerBadgeText: {
  fontSize: 10,
  fontWeight: "800",
  color: "#0369A1",
  textTransform: "uppercase",
},
teamAvatarLarge: {
  width: 72,
  height: 72,
  borderRadius: 36,
  backgroundColor: colors.surfaceSubtle,
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 8,
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},
teamAvatarLargeImage: {
  width: "100%",
  height: "100%",
  borderRadius: 48, // match your avatar size (if 96x96)
},

teamAvatarLargeText: {
  fontSize: 20,
  fontWeight: "900",
  color: colors.textPrimary,
},

teamNameLarge: {
  fontSize: 18,
  fontWeight: "900",
  color: colors.textPrimary,
},

teamMeta: {
  fontSize: 12,
  color: colors.textMuted,
  marginTop: 2,
},
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: radius?.lg ?? 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    marginBottom: 12,
    ...(shadows?.subtle || {}),
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.xl ?? 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  cardTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 3 },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginTop: 12,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  countText: { fontSize: 12, fontWeight: "900", color: colors.textPrimary },

  emptyText: { fontSize: 13, color: colors.textMuted, paddingVertical: 10 },
  manageRow: {
  marginTop: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: 8,
  paddingHorizontal: 6,
  borderRadius: radius?.lg ?? 16,
  backgroundColor: colors.surfaceSubtle,
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},

manageText: {
  fontSize: 13,
  fontWeight: "800",
  color: colors.textPrimary,
},

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius?.lg ?? 16,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },
  avatarText: { fontSize: 12, fontWeight: "900", color: colors.textPrimary },
  memberName: { fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  memberMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  memberAction: { padding: 6 },

  inviteBtn: {
    marginTop: 14,
    borderRadius: radius?.pill ?? 999,
    paddingVertical: 11,
    backgroundColor: colors.textPrimary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  inviteText: { fontSize: 13, fontWeight: "900", color: colors.surface },

  footerNote: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingHorizontal: 4,
  },
  footerText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 16 },
});