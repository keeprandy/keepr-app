import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Platform } from "react-native";

export default function HubContextBar({
  hub,
  capabilities,
  mode = "public",
  navigation,
}) {
  const hubType = capabilities?.hubType || hub?.hub_type || "community";
  const viewerLabel = capabilities?.isHubAdmin
    ? "Hub Admin"
    : capabilities?.isHubMember
    ? "Hub Member"
    : capabilities?.isKeeprMember
    ? "Keepr Member"
    : "Visitor";

  const purpose =
    hubType === "community"
      ? "Member-owned stories from this community."
      : hubType === "portfolio"
      ? "A curated collection of ownership stories."
      : hubType === "dealer"
      ? "Documented inventory stories from this dealer."
      : "A curated Hub of Keepr Stories.";

  return (
    <View style={styles.bar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>
          Keepr Enabled {hubType.replace("_", " ")}
        </Text>
        <Text style={styles.title}>
          {mode === "internal" ? "Managing" : "Viewing"} {hub?.name || "this Hub"}
        </Text>
        <Text style={styles.body}>{hub?.description || purpose}</Text>
      </View>

      <View style={styles.identityPill}>
        <Text style={styles.identityLabel}>You are</Text>
        <Text style={styles.identityText}>{viewerLabel}</Text>
      </View>
      {mode === "public" && capabilities?.canManageHub && hub?.id ? (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            if (!hub?.id) return;

            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.location.href = `/KeeprHubInternal?hubId=${encodeURIComponent(
                hub.id
              )}&mode=internal`;
              return;
            }

            navigation.navigate("KeeprHubInternal", {
              hubId: hub.id,
              mode: "internal",
            });
          }}
        >
          <Text style={styles.actionButtonText}>Open in Keepr</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.9,
    color: "#64748B",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: "900",
    color: "#0F172A",
  },
  actionButton: {
  borderRadius: 999,
  backgroundColor: "#111827",
  paddingHorizontal: 14,
  paddingVertical: 9,
    },
    actionButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    },
  body: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    color: "#64748B",
  },
  identityPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F8FAFC",
  },
  identityLabel: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    color: "#64748B",
    textTransform: "uppercase",
  },
  identityText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "900",
    color: "#0F172A",
  },
});