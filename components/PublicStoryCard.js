import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { useFocusEffect } from "@react-navigation/native";

export default function PublicStoryCard({
  asset,
  assetName = "this asset",
  onOpenSettings,
}) {
  const kac = asset?.kac_id || asset?.kac || asset?.kac_code || null;
  const [isPublic, setIsPublic] = React.useState(false);

const loadPublicState = React.useCallback(async () => {
  if (!asset?.id) {
    setIsPublic(false);
    return;
  }

  const { data, error } = await supabase
    .from("assets")
    .select("extra_metadata")
    .eq("id", asset.id)
    .maybeSingle();

  if (error) {
    console.log("PublicStoryCard state load failed:", error);
    setIsPublic(false);
    return;
  }

  setIsPublic(
    data?.extra_metadata?.publicConfig?.story?.enabled === true
  );
}, [asset?.id]);

React.useEffect(() => {
  loadPublicState();
}, [loadPublicState]);

useFocusEffect(
  React.useCallback(() => {
    loadPublicState();
  }, [loadPublicState])
);

  const openPublicStory = () => {
    if (!kac) return;

    const base =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : "https://app.keeprhome.com";

    const url = `${base}/k/${kac}`;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    Linking.openURL(url);
  };

  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Public Story</Text>
        <Text style={styles.subtitle}>
          {isPublic
        ? `${assetName} has a public Keepr Story that can be viewed by anyone with the link or QR code.`
        : `${assetName} is private. Turn on public view before sharing a Keepr Story link or QR code.`}
        </Text>
        <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            isPublic ? styles.statusDotPublic : styles.statusDotPrivate,
          ]}
        />
        <Text style={styles.statusText}>
          {isPublic ? "Public view is ON" : "Private by default"}
        </Text>
      </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, (!kac || !isPublic) && styles.disabled]}
        onPress={openPublicStory}
        activeOpacity={0.9}
        disabled={!kac || !isPublic}
      >
        <Ionicons name="globe-outline" size={16} color="white" />
        <Text style={styles.primaryText}>
        {isPublic ? "View Public Story" : "Public View Off"}
      </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={onOpenSettings}
        activeOpacity={0.9}
      >
        <Ionicons name="settings-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryText}>Public Story Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    gap: 10,
  },

  title: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  subtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
  },

  primaryText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },

  statusRow: {
  marginTop: 8,
  flexDirection: "row",
  alignItems: "center",
  gap: 7,
},

statusDot: {
  width: 8,
  height: 8,
  borderRadius: 999,
},

statusDotPublic: {
  backgroundColor: "#059669",
},

statusDotPrivate: {
  backgroundColor: "#9CA3AF",
},

statusText: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textPrimary,
},

  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },

  secondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },

  disabled: {
    opacity: 0.5,
  },
});