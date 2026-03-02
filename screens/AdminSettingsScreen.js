// screens/SettingsScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { navigationRef } from "../navigationRoot";
import { ROUTES } from "../navigation/routes";

export default function SettingsScreen() {
  const [busy, setBusy] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [role, setRole] = useState("consumer"); // consumer | superkeepr

  const clearSupabaseWebStorage = () => {
    try {
      if (Platform.OS !== "web") return;
      const keys = Object.keys(window.localStorage || {});
      keys.forEach((k) => {
        if (k.startsWith("sb-")) window.localStorage.removeItem(k);
      });
    } catch (e) {
      // no-op
    }
  };

  useEffect(() => {
    let mounted = true;

    const loadRole = async () => {
      setRoleLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user?.id) {
          if (!mounted) return;
          setRole("consumer");
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (!mounted) return;

        if (error) {
          setRole("consumer");
        } else {
          setRole(data?.role || "consumer");
        }
      } catch (e) {
        if (!mounted) return;
        setRole("consumer");
      } finally {
        if (!mounted) return;
        setRoleLoading(false);
      }
    };

    loadRole();
    return () => {
      mounted = false;
    };
  }, []);

  const doLogout = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      clearSupabaseWebStorage();
      Alert.alert("Signed out", "You are now logged out.");
    } catch (e) {
      console.error(e);
      Alert.alert("Logout failed", e?.message || "Could not log out.");
    } finally {
      setBusy(false);
    }
  };

  const forceClearWebSession = async () => {
    setBusy(true);
    try {
      clearSupabaseWebStorage();
      await supabase.auth.signOut({ scope: "local" });
      Alert.alert("Cleared", "Web session storage cleared. Refresh the page.");
    } catch (e) {
      Alert.alert("Clear failed", e?.message || "Could not clear session.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = async () => {
    setBusy(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user?.id) throw new Error("No signed-in user");

      const nextRole = role === "superkeepr" ? "consumer" : "superkeepr";

      const { error } = await supabase
        .from("profiles")
        .update({ role: nextRole })
        .eq("id", user.id);

      if (error) throw error;

      setRole(nextRole);

      if (navigationRef.isReady()) {
        if (nextRole === "superkeepr") {
          navigationRef.navigate("SuperKeeprStack", {
            screen: ROUTES.SUPERKEEPR_DASHBOARD,
          });
        } else {
          navigationRef.navigate("RootTabs", {
            screen: ROUTES.DASHBOARD,
          });
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Switch failed", e?.message || "Could not switch mode.");
    } finally {
      setBusy(false);
    }
  };

  const modeLabel = useMemo(() => {
    if (roleLoading) return "Loading…";
    return role === "superkeepr" ? "SuperKeepr" : "Consumer";
  }, [role, roleLoading]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Account, privacy, and app controls.</Text>
        </View>

        {/* Mode */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Mode</Text>

          <View style={styles.modeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modeTitle}>Current mode</Text>
              <Text style={styles.modeValue}>{modeLabel}</Text>
            </View>

            <TouchableOpacity
              style={[styles.actionBtn, busy && styles.disabled]}
              activeOpacity={0.85}
              onPress={switchMode}
              disabled={busy || roleLoading}
            >
              {busy || roleLoading ? (
                <ActivityIndicator size="small" color="#111827" />
              ) : (
                <Ionicons name="swap-horizontal" size={18} color="#111827" />
              )}
              <Text style={styles.actionText}>
                Switch to {role === "superkeepr" ? "Consumer" : "SuperKeepr"}
              </Text>
            </TouchableOpacity>

            {/* ✅ Upload Lab entry (mobile-safe) */}
            <TouchableOpacity
              style={[styles.actionBtn, { marginTop: 8 }]}
              activeOpacity={0.85}
              onPress={() => {
                if (navigationRef.isReady()) {
                  navigationRef.navigate("UploadLab");
                }
              }}
            >
              <Ionicons name="flask-outline" size={18} color="#111827" />
              <Text style={styles.actionText}>Open Upload Lab</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Account */}
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.sectionLabel}>Account</Text>

          <TouchableOpacity
            style={[styles.actionBtn, busy && styles.disabled]}
            activeOpacity={0.85}
            onPress={doLogout}
            disabled={busy}
          >
            <Ionicons name="log-out-outline" size={18} color="#111827" />
            <Text style={styles.actionText}>Log out</Text>
          </TouchableOpacity>

          {Platform.OS === "web" && (
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { marginTop: 10 },
                busy && styles.disabled,
              ]}
              activeOpacity={0.85}
              onPress={forceClearWebSession}
              disabled={busy}
            >
              <Ionicons name="trash-outline" size={18} color="#111827" />
              <Text style={styles.actionText}>Force clear web session</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Privacy */}
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.sectionLabel}>Privacy & Data</Text>
          <Text style={styles.bodyText}>
            • No route tracking by default.{"\n"}
            • No driving behavior scoring.{"\n"}
            • Data is owned by the household, not sold to insurers.{"\n"}
            • You choose what to export when you sell an asset.
          </Text>

          <View style={[styles.infoBanner, { marginTop: 12 }]}>
            <Ionicons name="lock-closed-outline" size={16} color="#111827" />
            <Text style={styles.infoBannerText}>
              Keepr is built around care and trust — not surveillance.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F6F8",
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  header: { marginBottom: 10 },
  title: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 12, color: "#6B7280", marginTop: 2 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  modeRow: {
    gap: 10,
  },
  modeTitle: { fontSize: 12, color: "#6B7280", fontWeight: "700" },
  modeValue: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "800",
    marginTop: 2,
  },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  actionText: { fontSize: 13, fontWeight: "700", color: "#111827" },
  disabled: { opacity: 0.6 },

  bodyText: { fontSize: 13, color: "#111827", lineHeight: 18 },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    padding: 8,
    marginTop: 6,
  },
  infoBannerText: {
    fontSize: 11,
    color: "#1F2937",
    marginLeft: 6,
    flex: 1,
  },
});
