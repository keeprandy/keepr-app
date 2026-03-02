// components/ReportsModal.js
import React, { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabaseClient";

/**
 * ReportsModal
 * - Web: centered modal
 * - Mobile: bottom sheet
 *
 * IMPORTANT:
 * StoryPrint usually expects a prebuilt "story" payload (built in HomeStoryScreen).
 * So we accept onOpenStorySheet() and call it rather than navigating directly with no params.
 */
export default function ReportsModal({ visible, onClose, asset, navigation, onOpenStorySheet }) {
  const isWeb = Platform.OS === "web";
  const assetId = asset?.id || null;
  const assetName = asset?.name || "Asset";

  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");

  const reports = useMemo(
    () => [
      {
        key: "story_sheet",
        section: "Story",
        title: "Story sheet",
        subtitle: "Printable snapshot of story + hero",
        icon: "print-outline",
        actionLabel: "Open",
        run: async () => {
          // Preferred: use the existing HomeStoryScreen builder (prevents empty StoryPrint).
          if (typeof onOpenStorySheet === "function") {
            onClose?.();
            onOpenStorySheet();
            return;
          }
          // Fallback: may render empty if StoryPrint requires params.
          onClose?.();
          navigation.navigate("StoryPrint");
        },
      },
      {
        key: "owner_systems",
        section: "Packages",
        title: "Owner Systems Inventory",
        subtitle: "Systems list + identity, warranty, assigned KeeprPro",
        icon: "document-text-outline",
        actionLabel: "Generate",
        run: async () => {
          if (!assetId) return;

          const { data, error } = await supabase.rpc("generate_owner_systems_package", {
            p_asset_id: assetId,
            p_title: "Owner Systems Inventory",
          });

          if (error) throw error;
          if (!data) throw new Error("No packageId returned.");

          onClose?.();
          navigation.navigate("OwnerSystemsPackagePrint", { packageId: data });
        },
      },
      {
        key: "timeline_cost",
        section: "Packages",
        title: "Timeline cost report",
        subtitle: "Line items + totals by year",
        icon: "cash-outline",
        actionLabel: "Generate",
        run: async () => {
          if (!assetId) return;

          const { data, error } = await supabase.rpc("generate_timeline_cost_package", {
            p_asset_id: assetId,
            p_title: "Timeline Cost Report",
          });

          if (error) throw error;
          if (!data) throw new Error("No packageId returned.");

          onClose?.();
          navigation.navigate("TimelineCostPackagePrint", { packageId: data });
        },
      },
    ],
    [assetId, navigation, onClose, onOpenStorySheet]
  );

  const grouped = useMemo(() => {
    const g = {};
    for (const r of reports) {
      if (!g[r.section]) g[r.section] = [];
      g[r.section].push(r);
    }
    Object.keys(g).forEach((k) => g[k].sort((a, b) => a.title.localeCompare(b.title)));
    return g;
  }, [reports]);

  const runReport = async (r) => {
    try {
      setError("");
      setBusyKey(r.key);
      await r.run();
    } catch (e) {
      setError(e?.message || "Failed to run report.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType={isWeb ? "fade" : "slide"} onRequestClose={onClose}>
      <View style={[styles.backdrop, isWeb ? styles.backdropCenter : styles.backdropBottom]}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Reports</Text>
              <Text style={styles.sub}>Snapshots generated from records in this Keepr • {assetName}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close-outline" size={22} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {Object.keys(grouped).map((section) => (
              <View key={section} style={styles.section}>
                <Text style={styles.sectionTitle}>{section}</Text>

                {grouped[section].map((r) => (
                  <View key={r.key} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Ionicons name={r.icon} size={18} />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={styles.rowTitle}>{r.title}</Text>
                        <Text style={styles.rowSub}>{r.subtitle}</Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => runReport(r)}
                      disabled={busyKey === r.key}
                      style={[styles.actionBtn, busyKey === r.key && styles.actionBtnBusy]}
                    >
                      <Text style={styles.actionText}>{busyKey === r.key ? "Working…" : r.actionLabel}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  backdropBottom: { justifyContent: "flex-end" },
  backdropCenter: { justifyContent: "center", alignItems: "center" },

  modal: {
    backgroundColor: "#fff",
    borderRadius: 16,
    width: Platform.OS === "web" ? 520 : "100%",
    maxHeight: Platform.OS === "web" ? "80%" : "75%",
    paddingBottom: 8,
  },

  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { marginTop: 4, fontSize: 12, opacity: 0.7 },

  content: { padding: 16 },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 13, fontWeight: "700", opacity: 0.8, marginBottom: 8 },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  rowLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 12, opacity: 0.65, marginTop: 2 },

  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#111" },
  actionBtnBusy: { opacity: 0.6 },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  error: { marginTop: 12, color: "#b00020", fontSize: 12 },
});
