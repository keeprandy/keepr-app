import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { navigationRef } from "../navigationRoot";
import { supabase } from "../lib/supabaseClient";

const Row = ({
  icon,
  iconBg,
  title,
  subtitle,
  onPress,
  rightIcon = "chevron-forward",
  disabled = false,
  rightNode = null,
  danger = false,
}) => (
  <TouchableOpacity
    style={[styles.row, disabled && { opacity: 0.55 }]}
    activeOpacity={0.85}
    onPress={onPress}
    disabled={disabled}
  >
    <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
      <Ionicons
        name={icon}
        size={18}
        color={danger ? (colors.error || "#DC2626") : colors.textPrimary}
      />
    </View>

    <View style={{ flex: 1 }}>
      <Text
        style={[styles.rowTitle, danger && { color: colors.error || "#DC2626" }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {!!subtitle && (
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </View>

    {rightNode ? rightNode : <Ionicons name={rightIcon} size={18} color={colors.textMuted} />}
  </TouchableOpacity>
);

export default function SettingsScreen({ navigation }) {
  const [profile, setProfile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  // Team visibility (owners + members)
  const [teamOrg, setTeamOrg] = React.useState(null);
  const [teamLoading, setTeamLoading] = React.useState(false);

  // Hidden internal tools (not part of consumer UX)
  const [showInternal, setShowInternal] = React.useState(false);
  const secretTapCount = React.useRef(0);
  const secretTapTimer = React.useRef(null);

  const loadProfile = React.useCallback(async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user?.id) return;

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "display_name, full_name, email, plan, role, onboarding_state, account_status, created_at, username"
        )
        .eq("id", user.id)
        .single();

      if (error) {
        // If profile row missing, don't crash Settings; just show email.
        setProfile({
          display_name: "",
          full_name: "",
          email: user.email || "",
          plan: "free",
          role: "consumer",
          onboarding_state: "not_started",
          account_status: "active",
        });
        return;
      }

      setProfile(data || null);
    } catch (e) {
      // no-op (keep screen usable)
      setProfile(null);
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      await loadProfile();
    })();
    return () => {
      if (secretTapTimer.current) clearTimeout(secretTapTimer.current);
    };
  }, [loadProfile]);

  const displayName = profile?.display_name || profile?.full_name || "Your profile";

  const plan = profile?.plan || "free";
  const [authEmail, setAuthEmail] = React.useState("");

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setAuthEmail(data?.user?.email || "");
    })();
  }, []);

  const email = authEmail;
  const username = profile?.username || null;

  const loadTeamOrg = React.useCallback(async () => {
    setTeamLoading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        setTeamOrg(null);
        return;
      }

      // Owner org (personal/team)
      const { data: ownedOrg, error: ownedOrgErr } = await supabase
        .from("orgs")
        .select("id,name,display_name,photo_url,org_type,owner_user_id,created_at")
        .eq("owner_user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ownedOrgErr) throw ownedOrgErr;

      if (ownedOrg?.id) {
        setTeamOrg(ownedOrg);
        return;
      }

// Member orgs (get up to 10)
const { data: myMemberships, error: memErr } = await supabase
  .from("org_members")
  .select("org_id,created_at")
  .eq("user_id", uid)
  .order("created_at", { ascending: false })
  .limit(10);

if (memErr) throw memErr;

if (!myMemberships?.length) {
  setTeamOrg(null);
  return;
}

let chosenOrg = null;

// Prefer a non-personal org
for (const m of myMemberships) {
  const { data: orgRow, error: orgErr } = await supabase
    .from("orgs")
    .select("id,name,display_name,photo_url,team_photo_url,org_type,owner_user_id,created_at")
    .eq("id", m.org_id)
    .maybeSingle();

  if (orgErr) throw orgErr;
  if (!orgRow?.id) continue;

  if (orgRow.org_type && orgRow.org_type !== "personal") {
    chosenOrg = orgRow;
    break;
  }

  // Fallback candidate if everything is personal
  if (!chosenOrg) {
    chosenOrg = orgRow;
  }
}
setTeamOrg(chosenOrg);

 // Catch     
    } catch {
      setTeamOrg(null);
    } finally {
      setTeamLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadTeamOrg();
  }, [loadTeamOrg]);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      Alert.alert("Sign out failed", e?.message || "Could not sign out.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    Alert.alert(
      "Deactivate account",
      "This will pause your account. You can reactivate by logging back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const { data: userRes } = await supabase.auth.getUser();
              const uid = userRes?.user?.id;
              if (!uid) throw new Error("No signed-in user.");

              // Soft cancel: mark profile deactivated
              const { error } = await supabase.from("profiles").update({ account_status: "deactivated" }).eq("id", uid);

              if (error) throw error;

              await supabase.auth.signOut({ scope: "local" });
            } catch (e) {
              Alert.alert("Could not deactivate", e?.message || "Try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const revealInternal = () => {
    // 7 taps within ~1.2s toggles internal tools
    secretTapCount.current += 1;

    if (secretTapTimer.current) clearTimeout(secretTapTimer.current);
    secretTapTimer.current = setTimeout(() => {
      secretTapCount.current = 0;
    }, 1200);

    if (secretTapCount.current >= 7) {
      secretTapCount.current = 0;
      setShowInternal((v) => !v);
    }
  };

  // Internal tools (hidden)
  const handleOpenUploadLab = () => {
    try {
      navigationRef.navigate("UploadLab");
    } catch {
      Alert.alert("Not available", "Upload Lab route not found.");
    }
  };

  const handleModeSwitch = async () => {
    // If you want to keep this as a true backdoor, leave it hidden.
    // This toggles consumer <-> superkeepr.
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) throw new Error("No signed-in user.");

      const currentRole = profile?.role || "consumer";
      const nextRole = currentRole === "superkeepr" ? "consumer" : "superkeepr";

      const { error } = await supabase.from("profiles").update({ role: nextRole }).eq("id", uid);

      if (error) throw error;

      await loadProfile();

      Alert.alert("Mode updated", `Now in ${nextRole} mode.`);
    } catch (e) {
      Alert.alert("Switch failed", e?.message || "Could not switch mode.");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPlanUpgrade = () => {
    try {
      navigationRef.navigate("PlanUpgrade");
    } catch {
      Alert.alert("Not available", "Plan & upgrade route not found yet.");
    }
  };

  const handleOpenTeam = () => {
    try {
      navigationRef.navigate("Team");
    } catch {
      Alert.alert("Not available", "Team route not found yet.");
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else if (navigationRef?.isReady?.()) {
                // Leave existing behavior as-is (depends on your navigator setup)
                navigationRef.navigate("RootTabs");
              }
            }}
            style={styles.backButton}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Profile, plan, and trust.</Text>
          </View>
        </View>

        {/* ACCOUNT */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <Row
              icon="person-outline"
              iconBg={colors.surfaceSubtle}
              title={displayName}
              subtitle={email || " "}
              onPress={() => navigationRef.navigate("Profile")}
            />
            <View style={styles.divider} />
            <Row
              icon="at-outline"
              iconBg={colors.surfaceSubtle}
              title={username ? `${username}@inbox.keeprhome.com` : "Choose your Keepr inbox"}
              subtitle={
                username
                  ? "Forward receipts and invoices here and they will land in your Event Inbox"
                  : "Not chosen yet"
              }
              onPress={() => navigationRef.navigate("Profile")}
            />
            <View style={styles.divider} />

            {/* Plan */}
            <Row
              icon="card-outline"
              iconBg={colors.surfaceSubtle}
              title="Plan & upgrade"
              subtitle={plan === "free" ? "Free plan" : `Plan: ${plan}`}
              onPress={() => navigationRef.navigate("PlanUpgrade")}
            />

            {/* Team (owners + members). If you're not on Team yet, this can still be visible if you belong to a team. */}
            {(teamLoading || teamOrg?.id || plan === "team") && (
              <>
                <View style={styles.divider} />
                <Row
                  icon="people-outline"
                  iconBg={colors.surfaceSubtle}
                  title="Team"
                  subtitle={
                    teamLoading
                      ? "Loading team…"
                      : teamOrg?.id
                      ? `Team: ${teamOrg.display_name || teamOrg.name || ""}`
                      : plan === "team"
                      ? "Create your first team"
                      : "Join or create a team"
                  }
                  onPress={handleOpenTeam}
                />
              </>
            )}
          </View>
        </View>

        {/* TRUST */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Trust</Text>
          <View style={styles.card}>
            <Row
              icon="shield-checkmark-outline"
              iconBg={colors.surfaceSubtle}
              title="Privacy & trust"
              subtitle="Ownership, security, and data control"
              onPress={() => navigationRef.navigate("PrivacyTrust")}
            />
          </View>
        </View>

        {/* ACCOUNT CONTROL */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <Row
              icon="log-out-outline"
              iconBg={colors.surfaceSubtle}
              title="Sign out"
              subtitle="Log out of this device"
              onPress={handleSignOut}
              disabled={busy}
              rightIcon="exit-outline"
              rightNode={busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
            />
          </View>
        </View>

        {/* DANGER ZONE */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.error || "#DC2626" }]}>Danger zone</Text>
          <View style={styles.card}>
            <Row
              icon="pause-circle-outline"
              iconBg={colors.surfaceSubtle}
              title="Deactivate account"
              subtitle="Pause your account — reactivate anytime"
              onPress={() =>
                Alert.alert(
                  "Deactivate account?",
                  "This will pause your account. You can reactivate anytime by logging back in.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Deactivate",
                      style: "destructive",
                      onPress: handleDeactivate,
                    },
                  ]
                )
              }
              danger
              disabled={busy}
            />
          </View>
        </View>

        {/* Hidden internal tools */}
        {showInternal && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Internal tools</Text>
            <View style={styles.card}>
              <Row
                icon="flask-outline"
                iconBg={colors.surfaceSubtle}
                title="Open Upload Lab"
                subtitle="Internal testing tools"
                onPress={handleOpenUploadLab}
              />
              <View style={styles.divider} />
              <Row
                icon="swap-horizontal-outline"
                iconBg={colors.surfaceSubtle}
                title="Switch mode"
                subtitle={`Current: ${profile?.role || "consumer"}`}
                onPress={handleModeSwitch}
                disabled={busy}
                rightNode={busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
              />
            </View>
          </View>
        )}

        {/* Footer backdoor trigger */}
        <TouchableOpacity activeOpacity={1} onPress={revealInternal} style={styles.footerTap}>
          <Text style={styles.footerText}>Keepr™</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg || "#F5F6F8",
  },
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

  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginLeft: 48,
  },

  footerTap: {
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 10,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});