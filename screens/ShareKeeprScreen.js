import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, TouchableOpacity, Share, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabaseClient";
import { track } from "../lib/analytics";

export default function ShareKeeprScreen({ navigation }) {
  const [inviteUrl, setInviteUrl] = useState("");

  useEffect(() => {
    buildInvite();
  }, []);

  useFocusEffect(
  useCallback(() => {
    buildInvite();
  }, [])
);

  const buildInvite = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;

  if (!user) return;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("username, inbox_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.log("Profile fetch error:", error);
  }

  const fallbackSlug = `u_${user.id.slice(0, 8)}`;

  const slug =
    profile?.username ||
    profile?.inbox_name ||
    fallbackSlug;

  const url = `https://www.keeprhome.com/invite/${slug}`;

  setInviteUrl(url);

  track("share_keepr_qr_viewed", {
  invite_url: url,
  source_slug: slug,
});

  const { data: events, error: statsError } = await supabase
  .from("invite_events")
  .select("event_type")
  .eq("inviter_user_id", user.id);

if (statsError) {
  console.log("Invite stats fetch error:", statsError);
} else {
  const stats = {
    views: 0,
    clicks: 0,
    
  };

  (events || []).forEach((event) => {
    if (event.event_type === "view") stats.views += 1;
    if (event.event_type === "download_click") stats.clicks += 1;
    
  });

  setInviteStats(stats);
}
};

const handleShare = async () => {
  if (!inviteUrl) return;

  track("share_keepr_share_clicked", {
    invite_url: inviteUrl,
  });

  await Share.share({
    message: `I’m a keepr. You should be too.\n\n${inviteUrl}`,
  });
};

  const [inviteStats, setInviteStats] = useState({
  views: 0,
  clicks: 0,
  accepted: 0,
});

  const handleCopy = async () => {
    if (!inviteUrl) return;

    track("share_keepr_copy_link_clicked", {
      invite_url: inviteUrl,
    });

    await Clipboard.setStringAsync(inviteUrl);
  };


  return (
    
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Share Keepr</Text>
      <Text style={styles.title}>I’m a keepr.</Text>
      <Text style={styles.subtitle}>Become one.</Text>

      {inviteUrl ? (
        <View style={styles.qrWrap}>
          <QRCode value={inviteUrl} size={220} />
        </View>
      ) : null}

      <Text style={styles.link}>{inviteUrl}</Text>

      <TouchableOpacity style={styles.primaryBtn} onPress={handleShare}>
        <Text style={styles.primaryText}>Share</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={handleCopy}>
        <Text style={styles.secondaryText}>Copy Link</Text>
      </TouchableOpacity>
      <View style={styles.statsCard}>
  <Text style={styles.statsTitle}>Your invites</Text>

  <View style={styles.statsRow}>
    <View style={styles.statItem}>
      <Text style={styles.statNumber}>{inviteStats.views}</Text>
      <Text style={styles.statLabel}>Views</Text>
    </View>

    <View style={styles.statItem}>
      <Text style={styles.statNumber}>{inviteStats.clicks}</Text>
      <Text style={styles.statLabel}>Downloads</Text>
    </View>

  </View>
</View>
    </View>
    
  );
  
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  headerTitle: {
  fontSize: 18,
  fontWeight: "800",
  color: "#111827",
  textAlign: "center",
  marginTop: 60,
  marginBottom: 12,
},
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 16,
    color: "#6B7280",
    marginBottom: 20,
  },
  backButton: {
  position: "absolute",
  top: 54,
  left: 20,
  paddingVertical: 8,
  paddingHorizontal: 10,
  zIndex: 10,
},
backText: {
  fontSize: 16,
  fontWeight: "700",
  color: "#111827",
},
  qrWrap: {
    marginVertical: 20,
  },
  link: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 20,
  },
  primaryBtn: {
    backgroundColor: "#2D7DE3",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  secondaryText: {
    color: "#111827",
    fontWeight: "600",
  },
  statsCard: {
  width: "100%",
  maxWidth: 320,
  backgroundColor: "#F8FAFC",
  borderRadius: 16,
  padding: 14,
  marginBottom: 20,
  borderWidth: 1,
  borderColor: "#E2E8F0",
},
statsTitle: {
  fontSize: 13,
  fontWeight: "800",
  color: "#111827",
  marginBottom: 10,
  textAlign: "center",
},
statsRow: {
  flexDirection: "row",
  justifyContent: "space-between",
},
statItem: {
  alignItems: "center",
  flex: 1,
},
statNumber: {
  fontSize: 20,
  fontWeight: "900",
  color: "#111827",
},
statLabel: {
  fontSize: 11,
  color: "#6B7280",
  marginTop: 2,
},
});