import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabaseClient";

/**
 * V1: keep plan rules centralized here so we can tune limits without touching UI code.
 * If/when you move this to a server-side config, this object becomes the “defaults.”
 */
const PLAN_LIMITS = {
  free: {
    assets: 3,
    systems: "5 per asset",
    storage: "100MB",
    teamMembers: "Just you",
    reports: "Basic",
  },
  plus: {
    assets: 10,
    systems: "Unlimited",
    storage: "2GB",
    teamMembers: "Just you",
    reports: "Export-ready",
  },
  team: {
    assets: 20,
    systems: "Unlimited",
    storage: "5GB",
    teamMembers: "Up to 5 members",
    reports: "Export-ready",
  },
};

/**
 * Compare grid rows.
 * type:
 *  - "limit": show numeric/text limits
 *  - "bool": show check / dash
 *  - "text": show text values
 */
const PLAN_MATRIX = [
  { key: "assets", label: "Assets", type: "limit" },
  { key: "storage", label: "Storage", type: "text" },
  { key: "teamMembers", label: "Team members", type: "limit" },
  { key: "reports", label: "Print-ready reports", type: "bool" },
  { key: "packages", label: "Packages (V1)", type: "bool" },
  { key: "prioritySupport", label: "Priority support", type: "bool" },
  { key: "sharedVisibility", label: "Shared visibility", type: "boolStatic", free: false, plus: false, team: true },
  { key: "managedOnBehalf", label: "Managed-on-behalf-of workflows (V1)", type: "boolStatic", free: false, plus: false, team: true },
];

const PRICES = {
  yearly: {
    free: { label: "$0", suffix: "/year" },
    plus: { label: "$120", suffix: "/year" },
    team: { label: "$180", suffix: "/year" },
    savings: { plus: "Save $60 vs $15 monthly", team: "Save $60 vs $20 monthly" },
  },
  monthly: {
    free: { label: "$0", suffix: "/month" },
    plus: { label: "$15", suffix: "/month" },
    team: { label: "$20", suffix: "/month" },
    savings: { plus: "Best value yearly", team: "Best value yearly" },
  },
};

export default function PlanUpgradeScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState("free");
  const [billingStatus, setBillingStatus] = useState("inactive");
  const [billingCycle, setBillingCycle] = useState(null);
  const [cycle, setCycle] = useState("yearly");
  const [teamContext, setTeamContext] = useState({ isOwner: false, isMember: false, orgName: null, orgId: null });

  const teamLift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(teamLift, {
     toValue: (teamContext?.isOwner || String(plan || "free").toLowerCase() === "team") ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [plan, teamLift]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        if (isMounted) setLoading(false);
        return;
      }

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("plan,billing_status,billing_cycle")
        .eq("id", user.id)
        .single();

      if (!error && prof && isMounted) {
        setPlan(prof.plan || "free");
        setBillingStatus(prof.billing_status || "inactive");
        setBillingCycle(prof.billing_cycle || null);
      }

      // Team context (owner vs member) – used only for labeling and CTAs.
      // Server-side enforcement remains authoritative.
      if (isMounted) {
        let ctx = { isOwner: false, isMember: false, orgName: null, orgId: null };

        // Owner?
        const { data: ownedOrg } = await supabase
          .from("orgs")
          .select("id, display_name, name")
          .eq("owner_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ownedOrg?.id) {
          ctx = {
            isOwner: true,
            isMember: true,
            orgId: ownedOrg.id,
            orgName: ownedOrg.display_name || ownedOrg.name || null,
          };
        } else {
          // Member?
          const { data: mem } = await supabase
            .from("org_members")
            .select("org_id, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (mem?.org_id) {
            const { data: orgRow } = await supabase
              .from("orgs")
              .select("id, display_name, name")
              .eq("id", mem.org_id)
              .maybeSingle();

            if (orgRow?.id) {
              ctx = {
                isOwner: false,
                isMember: true,
                orgId: orgRow.id,
                orgName: orgRow.display_name || orgRow.name || null,
              };
            }
          }
        }

        setTeamContext(ctx);
      }

      if (isMounted) setLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const pricing = PRICES[cycle];

const normalizedPlan = String(plan || "free").toLowerCase();

// If you're a team owner, treat you as Team for UI purposes even if profile.plan is behind.
const effectivePlan = teamContext?.isOwner ? "team" : normalizedPlan;

const isOnFree = effectivePlan === "free";
const isOnPlus = effectivePlan === "plus";
const isOnTeam = effectivePlan === "team";

const isTeamOwner = !!teamContext?.isOwner;
  const isTeamMember = !!teamContext?.isMember;
  const orgLabel = teamContext?.orgName || "a team";

  const currentPlanLabel = useMemo(() => {
    if (loading) return "Loading…";

    const isOwner = !!teamContext?.isOwner;
    const isMember = !!teamContext?.isMember;
    const orgName = teamContext?.orgName || "a team";

    // Team membership can exist even if profile.plan is "free" (payer is the team owner).
    if (isOwner) return "Team Owner";
    if (isMember) return `Team Member (${orgName})`;

    const p = effectivePlan;
    
    if (p === "free") return "Starter";
    if (p === "plus") return "Plus";
    if (p === "team") return "Team Owner";
    return p.charAt(0).toUpperCase() + p.slice(1);
  }, [loading, plan, teamContext]);

  const openUrl = (url) => {
    if (!url) return;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign(url);
      return;
    }
    // native
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Linking } = require("react-native");
    Linking.openURL(url);
  };

  const startCheckout = async (targetPlan) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-checkout-session",
        {
          body: { plan: targetPlan, cycle },
        }
      );

      if (error) {
        Alert.alert("Checkout error", error.message || String(error));
        return;
      }

      if (!data?.url) {
        Alert.alert("Checkout error", "Missing checkout URL.");
        return;
      }

      openUrl(data.url);
    } catch (e) {
      Alert.alert("Checkout error", String(e?.message || e));
    }
  };


  const PlanButton = ({ title, disabled, onPress, variant }) => {
    const isPrimary = variant === "primary";
    return (
      <Pressable
        onPress={disabled ? undefined : onPress}
        style={({ pressed }) => [
          styles.cta,
          isPrimary ? styles.ctaPrimary : styles.ctaSecondary,
          disabled && styles.ctaDisabled,
          pressed && !disabled && { opacity: 0.92 },
        ]}
      >
        <Text
          style={[
            styles.ctaText,
            isPrimary ? styles.ctaTextPrimary : styles.ctaTextSecondary,
            disabled && styles.ctaTextDisabled,
          ]}
        >
          {title}
        </Text>
      </Pressable>
    );
  };

  const Card = ({
    tier,
    title,
    subtitle,
    bullets,
    badge,
    children,
    elevated,
  }) => {
    const lift =
      tier === "team"
        ? teamLift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] })
        : 0;

    return (
      <Animated.View
        style={[
          styles.card,
          elevated && styles.cardElevated,
          tier === "team" && { transform: [{ translateY: lift }] },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {!!badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardSubtitle}>{subtitle}</Text>

        <View style={styles.priceRow}>
          <Text style={styles.priceText}>{pricing[tier].label}</Text>
          <Text style={styles.priceSuffix}>{pricing[tier].suffix}</Text>
        </View>

        {tier !== "free" && (
          <Text style={styles.savingsText}>{pricing.savings[tier]}</Text>
        )}

        <View style={styles.bullets}>
          {bullets.map((b) => (
            <View key={b} style={styles.bulletRow}>
              <Ionicons name="checkmark" size={18} color="#111827" />
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 14 }}>{children}</View>
      </Animated.View>
    );
  };

  const renderBoolCell = (val) => {
    if (val) {
      return (
        <View style={styles.matrixBool}>
          <Ionicons name="checkmark" size={18} color="#111827" />
        </View>
      );
    }
    return <Text style={styles.matrixDash}>—</Text>;
  };

  const getCellValue = (tier, row) => {
    if (row.type === "boolStatic") {
      return row[tier];
    }
    if (row.type === "bool") {
      return !!PLAN_LIMITS?.[tier]?.[row.key];
    }
    if (row.type === "limit" || row.type === "text") {
      return PLAN_LIMITS?.[tier]?.[row.key];
    }
    return null;
  };

  const renderCell = (tier, row) => {
    const v = getCellValue(tier, row);

    if (row.type === "bool" || row.type === "boolStatic") {
      return renderBoolCell(!!v);
    }

    if (v === null || v === undefined || v === "") {
      return <Text style={styles.matrixDash}>—</Text>;
    }

    return <Text style={styles.matrixValue}>{String(v)}</Text>;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </Pressable>
        <View>
          <Text style={styles.h1}>Plan & Upgrade</Text>
          <Text style={styles.h2}>Choose what fits. Upgrade anytime.</Text>
        </View>
        <View style={{ flex: 1 }} />
      </View>

      <View style={styles.toggleWrap}>
        <Pressable
          onPress={() => setCycle("yearly")}
          style={[
            styles.toggleBtn,
            cycle === "yearly" && styles.toggleBtnActive,
          ]}
        >
          <Text
            style={[
              styles.toggleTitle,
              cycle === "yearly" && styles.toggleTitleActive,
            ]}
          >
            Yearly
          </Text>
          <Text
            style={[styles.toggleSub, cycle === "yearly" && styles.toggleSubActive]}
          >
            Best value
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setCycle("monthly")}
          style={[
            styles.toggleBtn,
            cycle === "monthly" && styles.toggleBtnActive,
          ]}
        >
          <Text
            style={[
              styles.toggleTitle,
              cycle === "monthly" && styles.toggleTitleActive,
            ]}
          >
            Monthly
          </Text>
          <Text
            style={[
              styles.toggleSub,
              cycle === "monthly" && styles.toggleSubActive,
            ]}
          >
            Flexible
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        
      {teamContext?.isMember && !teamContext?.isOwner && (
        <View style={styles.teamMemberNote}>
          <Ionicons name="people-outline" size={16} color="#374151" />
          <Text style={styles.teamMemberNoteText}>
            You’re a Team Member{teamContext?.orgName ? ` of ${teamContext.orgName}` : ""}. You can still upgrade your personal plan.
          </Text>
        </View>
      )}

<View style={styles.cardsRow}>
          <Card
            tier="free"
            title="Starter"
            subtitle="Get organized. Stay calm."
            bullets={[
            "1 User",
            "3 assets",
            "5 systems per asset",
            "100MB storage",
            "Commercial tagging",
            "Basic inventory + cost tracking",
            ]}
          >
            {isOnFree && (
              <PlanButton
                title="Current plan"
                disabled
                variant="secondary"
              />
            )}
          </Card>

          <Card
            tier="plus"
            title="Plus"
            subtitle="For serious owners."
            bullets={[
            "Single Owner Account",
            "10 assets",
            "Unlimited systems",
            "2GB storage",
            "Packages + warranty workflows",
            "Commercial asset reporting",
            "Export-ready reports",
            ]}
          >
            <PlanButton
              title={isOnPlus ? "Current plan" : "Upgrade to Plus"}
              disabled={isOnPlus || loading}
              onPress={() => startCheckout("plus")}
              variant={isOnPlus ? "secondary" : "primary"}
            />
          </Card>

          <Card
            tier="team"
            title="Team Owner"
            subtitle="Run ownership as a team."
            bullets={[
            "Multiple Users - We're a keepr Team!",
            "20 assets",
            "Unlimited systems",
            "5GB storage",
            "Up to 5 members",
            "Shared visibility across assets",
            "Managed-on-behalf-of workflows",
            "Commercial + operational reporting",
            "Ideal for families, partnerships, and property portfolios",
            ]}
            badge="Most popular"
            elevated
          >
            {isOnTeam && (
              <Pressable
                onPress={() => navigation.navigate("Team")}
                style={({ pressed }) => [
                  styles.manageTeam,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.manageTeamText}>Manage team</Text>
                <Ionicons name="chevron-forward" size={18} color="#111827" />
              </Pressable>
            )}

            <PlanButton
              title={isTeamOwner ? "Current plan" : "Upgrade to Team Owner"}
              disabled={isTeamOwner || loading}
              onPress={() => startCheckout("team")}
              variant={isTeamOwner ? "secondary" : "primary"}
            />
          </Card>
        </View>


        <View style={styles.footerNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#6B7280" />
          <Text style={styles.footerText}>
            You own what you put in. We do not share your data. We do not use your
            data to train our system and models.
          </Text>
        </View>

        <View style={styles.debugRow}>
          <Text style={styles.debugText}>
            Current: {currentPlanLabel}
            {billingStatus ? ` · ${billingStatus}` : ""}
            {billingCycle ? ` · ${billingCycle}` : ""}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F7FB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginRight: 12,
  },
  h1: { fontSize: 20, fontWeight: "800", color: "#111827" },
  h2: { marginTop: 2, fontSize: 13, color: "#6B7280" },

  toggleWrap: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBtnActive: { backgroundColor: "#0F172A" },
  toggleTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  toggleTitleActive: { color: "#FFFFFF" },
  toggleSub: { marginTop: 2, fontSize: 12, color: "#6B7280" },
  toggleSubActive: { color: "#CBD5E1" },

  content: { paddingHorizontal: 20, paddingVertical: 18 },
  cardsRow: { flexDirection: Platform.OS === "web" ? "row" : "column", gap: 14 },

  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    minWidth: Platform.OS === "web" ? 280 : undefined,
  },
  cardElevated: {
    borderColor: "#CBD5E1",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },

  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  badgeText: { fontSize: 12, fontWeight: "800", color: "#111827" },

  cardSubtitle: { marginTop: 2, fontSize: 13, color: "#6B7280" },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 10,
  },
  priceText: { fontSize: 34, fontWeight: "900", color: "#111827" },
  priceSuffix: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B7280",
    paddingBottom: 6,
  },
  savingsText: { marginTop: 4, fontSize: 12, fontWeight: "700", color: "#2563EB" },

  bullets: { marginTop: 12, gap: 10 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletText: { flex: 1, fontSize: 13, color: "#111827" },

  cta: {
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  ctaPrimary: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  ctaSecondary: { backgroundColor: "#FFFFFF", borderColor: "#E5E7EB" },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { fontSize: 14, fontWeight: "900" },
  ctaTextPrimary: { color: "#FFFFFF" },
  ctaTextSecondary: { color: "#111827" },
  ctaTextDisabled: { color: "#111827" },

  manageTeam: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  manageTeamText: { fontSize: 14, fontWeight: "800", color: "#111827" },

  compareWrap: {
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
  },
  compareTitle: { fontSize: 16, fontWeight: "900", color: "#111827" },
  compareSub: { marginTop: 4, fontSize: 12, color: "#6B7280", lineHeight: 16 },

  matrixOuter: { paddingTop: 12, paddingBottom: 2 },
  matrix: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    overflow: "hidden",
    minWidth: Platform.OS === "web" ? 860 : 820,
  },
  matrixHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  matrixRow: { flexDirection: "row", backgroundColor: "#FFFFFF" },
  matrixRowStriped: { backgroundColor: "#FAFAFB" },
  matrixFootRow: {
    flexDirection: "row",
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },

  matrixCell: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    width: 170,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "center",
  },
  matrixFeatureCol: { width: 320 },
  matrixHeaderText: { fontSize: 12, fontWeight: "900", color: "#111827" },
  matrixCurrent: { marginTop: 2, fontSize: 11, fontWeight: "800", color: "#2563EB" },
  matrixFeatureText: { fontSize: 13, fontWeight: "800", color: "#111827" },
  matrixValue: { fontSize: 13, fontWeight: "800", color: "#111827" },
  matrixDash: { fontSize: 13, fontWeight: "800", color: "#9CA3AF" },
  matrixBool: { height: 18, alignItems: "flex-start", justifyContent: "center" },
  matrixFootText: { fontSize: 12, color: "#6B7280", lineHeight: 16 },


  teamMemberNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  teamMemberNoteText: {
    flex: 1,
    color: "#374151",
    fontSize: 13,
    lineHeight: 18,
  },
  footerNote: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 6,
  },
  footerText: { flex: 1, fontSize: 12, color: "#6B7280", lineHeight: 16 },

  debugRow: { marginTop: 10, paddingHorizontal: 6 },
  debugText: { fontSize: 12, color: "#9CA3AF" },
});