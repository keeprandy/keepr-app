import React, { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, TouchableOpacity, Share, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabaseClient";
import { track } from "../lib/analytics";
import { buildUserInviteUrl } from "../lib/inviteLinks";
import { createShareAction } from "../lib/shareActions";
import { trackMemberInviteShareInitiated } from "../lib/keeprEffect";

export default function ShareKeeprScreen({ navigation }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrShareAction, setQrShareAction] = useState(null);

  useEffect(() => {
    buildInvite();
  }, []);

  useFocusEffect(
  useCallback(() => {
    buildInvite();
  }, [])
);

  const createLegacyInvite = (user, profile) => {
  const fallbackSlug = `u_${user.id.slice(0, 8)}`;

  const slug =
    profile?.username ||
    profile?.inbox_name ||
    profile?.acquisition_source_slug ||
    fallbackSlug;

  return {
    slug,
    url: buildUserInviteUrl({ sourceSlug: slug }),
  };
};

const createKeeprShareAction = async (channel) => {
  const action = await createShareAction({
    supabase,
    sharedObjectType: "keepr",
    intendedAction: "signup",
    channel,
  });

  track("share_action_created", {
    share_action_id: action?.id,
    activation_source_id: action?.activationSourceId,
    shared_object_type: action?.sharedObjectType,
    intended_action: action?.intendedAction,
    channel: action?.channel,
  });

  return action;
};

const getCleanInviteUrlForSlug = (slug, fallbackUrl) => {
  if (!slug) return fallbackUrl;
  return buildUserInviteUrl({ sourceSlug: slug });
};

  const buildInvite = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;

  if (!user) return;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("username, inbox_name, acquisition_source_slug")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.log("Profile fetch error:", error);
  }

  const legacyInvite = createLegacyInvite(user, profile);
  let url = legacyInvite.url;
  let slug = legacyInvite.slug;
  let action = null;

  try {
    action = await createKeeprShareAction("qr");
    url = getCleanInviteUrlForSlug(slug, url);
  } catch (e) {
    console.log("Share action QR creation failed; using legacy invite link:", e?.message || e);
  }

  setInviteUrl(url);
  setSourceSlug(slug);
  setQrShareAction(action);

  track("share_keepr_qr_viewed", {
  invite_url: url,
  source_slug: slug,
});

  trackMemberInviteShareInitiated({
    sourceSlug: slug,
    activationSourceId: action?.activationSourceId || null,
    channel: "qr",
  });

  track("share_qr_viewed", {
  share_action_id: action?.id || null,
  activation_source_id: action?.activationSourceId || null,
  shared_object_type: action?.sharedObjectType || "keepr",
  intended_action: action?.intendedAction || "signup",
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

  let shareUrl = inviteUrl;
  let action = qrShareAction;

  try {
    action = await createKeeprShareAction("native_share");
    shareUrl = getCleanInviteUrlForSlug(sourceSlug, shareUrl);
  } catch (e) {
    console.log("Share action native creation failed; using current invite link:", e?.message || e);
  }

  track("share_keepr_share_clicked", {
  invite_url: shareUrl,
  source_slug: sourceSlug,
});

  track("share_native_opened", {
  share_action_id: action?.id || null,
  activation_source_id: action?.activationSourceId || null,
  shared_object_type: action?.sharedObjectType || "keepr",
  intended_action: action?.intendedAction || "signup",
});

  trackMemberInviteShareInitiated({
    sourceSlug,
    activationSourceId: action?.activationSourceId || null,
    channel: "native_share",
  });

  await Share.share({
    message: `I’m a keepr. You should be too.\n\n${shareUrl}`,
  });
};

  const [inviteStats, setInviteStats] = useState({
  views: 0,
  clicks: 0,
  accepted: 0,
});

const [sourceSlug, setSourceSlug] = useState("");
const [showCopied, setShowCopied] = useState(false);

  const handleCopy = async () => {
    if (!inviteUrl) return;

   let copyUrl = inviteUrl;
   let action = qrShareAction;

   try {
    action = await createKeeprShareAction("copy_link");
    copyUrl = getCleanInviteUrlForSlug(sourceSlug, copyUrl);
   } catch (e) {
    console.log("Share action copy creation failed; using current invite link:", e?.message || e);
   }

   track("share_keepr_copy_link_clicked", {
  invite_url: copyUrl,
  source_slug: sourceSlug,
});

    track("share_link_copied", {
  share_action_id: action?.id || null,
  activation_source_id: action?.activationSourceId || null,
  shared_object_type: action?.sharedObjectType || "keepr",
  intended_action: action?.intendedAction || "signup",
});

    trackMemberInviteShareInitiated({
      sourceSlug,
      activationSourceId: action?.activationSourceId || null,
      channel: "copy_link",
    });

    await Clipboard.setStringAsync(copyUrl);
    setShowCopied(true);

    setTimeout(() => {
      setShowCopied(false);
    }, 2000);
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

{showCopied && (
  <View style={styles.toast}>
    <Text style={styles.toastText}>Copied to clipboard</Text>
  </View>
)}
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

  toast: {
  position: "absolute",
  bottom: 110,
  backgroundColor: "#111827",
  paddingHorizontal: 18,
  paddingVertical: 10,
  borderRadius: 999,
  shadowColor: "#000",
  shadowOpacity: 0.2,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
},

toastText: {
  color: "#fff",
  fontWeight: "700",
  fontSize: 13,
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
