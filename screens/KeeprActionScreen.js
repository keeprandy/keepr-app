import React from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";

export default function KeeprActionScreen({ route, navigation }) {
  const {
    assetId,
    kac,
    assetName,
    hubId,
    hubName,
  } = route?.params || {};

    const [message, setMessage] = React.useState("");
    const [threads, setThreads] = React.useState([]);
    const [replyByThreadId, setReplyByThreadId] = React.useState({});
    const [loadingContext, setLoadingContext] = React.useState(true);
    const [currentUserId, setCurrentUserId] = React.useState(null);
    const [assetOwnerId, setAssetOwnerId] = React.useState(null);
    const [isOwner, setIsOwner] = React.useState(false);
    const [profilesById, setProfilesById] = React.useState({});
    const [collapsedThreadIds, setCollapsedThreadIds] = React.useState({});

    React.useEffect(() => {
    let active = true;

    const loadContext = async () => {
        try {
        setLoadingContext(true);

        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id || null;

        const { data: assetRow, error } = await supabase
            .from("assets")
            .select("id, owner_id")
            .eq("id", assetId)
            .maybeSingle();

            console.log("KEEPRACTION OWNER RESOLVE", {
            assetId,
            assetRow,
            error,
            ownerId: assetRow?.owner_id || null,
            uid,
            });

        if (error) throw error;

        if (!active) return;

        setCurrentUserId(uid);
        setAssetOwnerId(assetRow?.owner_id || null);
        setIsOwner(!!uid && !!assetRow?.owner_id && String(uid) === String(assetRow.owner_id));
        } catch (e) {
        console.log("KeeprAction context load failed:", e?.message || e);
        } finally {
        if (active) setLoadingContext(false);
        }
    };


    if (assetId) loadContext();

    return () => {
        active = false;
    };
    }, [assetId]);

  
    const handleSendQuestion = async () => {
    if (!message.trim()) {
        Alert.alert("Add a message", "Type your question first.");
        return;
    }

    if (!currentUserId || !assetOwnerId) {
        Alert.alert("Not ready", "We could not resolve the owner for this asset.");
        return;
    }

    try {
    const { data: thread, error: threadError } = await supabase
    .from("asset_threads")
    .insert({
        asset_id: assetId,
        hub_id: hubId || null,
        owner_id: assetOwnerId,
        created_by: currentUserId,
        subject: assetName || "Asset question",
        status: "open",
    })
    .select("id")
    .single();

    console.log("THREAD INSERT RESULT", { thread, threadError });

    if (threadError) throw threadError;
    if (!thread?.id) throw new Error("Thread was not created.");

    const { error: msgError } = await supabase
    .from("asset_thread_messages")
    .insert({
        thread_id: thread.id,
        from_user_id: currentUserId,
        body: message.trim(),
    });

    console.log("MESSAGE INSERT RESULT", { msgError });

    if (msgError) throw msgError;

        setMessage("");
        await loadThreads();
    } catch (e) {
        Alert.alert("Could not send", e?.message || "Try again.");
    }
    };


    const handleSendReply = async (threadId) => {
  const body = String(replyByThreadId[threadId] || "").trim();

  if (!body) {
    Alert.alert("Add a reply", "Type your reply first.");
    return;
  }

  if (!currentUserId) {
    Alert.alert("Not ready", "You need to be signed in.");
    return;
  }

  try {
    const { error } = await supabase
      .from("asset_thread_messages")
      .insert({
        thread_id: threadId,
        from_user_id: currentUserId,
        body,
      });

    if (error) throw error;

    await supabase
      .from("asset_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId);

    setReplyByThreadId((prev) => ({
      ...prev,
      [threadId]: "",
    }));

    await loadThreads();
  } catch (e) {
    Alert.alert("Could not reply", e?.message || "Try again.");
  }
};

const loadThreads = React.useCallback(async () => {
  if (!assetId) return;

  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id || null;

  const { data: assetRow, error: assetError } = await supabase
    .from("assets")
    .select("id, owner_id")
    .eq("id", assetId)
    .maybeSingle();

  if (assetError) throw assetError;

  const ownerId = assetRow?.owner_id || null;

  setCurrentUserId(uid);
  setAssetOwnerId(ownerId);
  setIsOwner(!!uid && !!ownerId && String(uid) === String(ownerId));

  const { data: threadRows, error: threadError } = await supabase
    .from("asset_threads")
    .select(`
      id,
      asset_id,
      hub_id,
      owner_id,
      created_by,
      subject,
      status,
      created_at,
      updated_at,
      asset_thread_messages (
        id,
        from_user_id,
        body,
        created_at
      )
    `)
    .eq("asset_id", assetId)
    .order("updated_at", { ascending: false });

  if (threadError) throw threadError;

  const rows = threadRows || [];

  const userIds = Array.from(
    new Set(
      rows
        .flatMap((t) => [
          t.owner_id,
          t.created_by,
          ...(t.asset_thread_messages || []).map((m) => m.from_user_id),
        ])
        .filter(Boolean)
    )
  );

let profileRows = [];
let profileError = null;

if (userIds.length) {
  const result = await supabase
    .from("profiles")
    .select("id, display_name, full_name, email")
    .in("id", userIds);

  console.log("PROFILE QUERY", {
    userIds,
    data: result.data,
    error: result.error,
  });

  profileRows = result.data || [];
  profileError = result.error || null;

  if (!profileError) {
    const map = {};
    profileRows.forEach((p) => {
      map[p.id] = p;
    });

    console.log("PROFILE MAP", map);

    setProfilesById(map);
  }
}

setThreads(rows);
}, [assetId]);


React.useEffect(() => {
  loadThreads().catch((e) => {
    console.log("Load asset threads failed:", e?.message || e);
  });
}, [loadThreads]);

React.useEffect(() => {
  if (!assetId) return;

  const channel = supabase
    .channel(`asset-thread-messages-${assetId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "asset_thread_messages",
      },
      () => {
        loadThreads();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "asset_threads",
        filter: `asset_id=eq.${assetId}`,
      },
      () => {
        loadThreads();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [assetId, loadThreads]);

    const formatNameFromEmail = (email) => {
    if (!email) return "Keepr Member";
    return email.split("@")[0];
    };

    const formatMessageTime = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.shell}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() =>
            navigation.navigate("KeeprStoryInternal", {
              assetId,
              kac,
              hubId,
              hubName,
              mode: "internal",
            })
          }
        >
          <Ionicons name="chevron-back-outline" size={18} color={colors.textPrimary} />
          <Text style={styles.backText}>Back to {assetName || "Story"}</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.kicker}>MESSAGES</Text>
          <Text style={styles.title}>{assetName || "Asset Actions"}</Text>
          <Text style={styles.subtitle}>
            Ask the owner a question or start a lightweight Keepr conversation around this asset.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {isOwner ? "Owner Actions" : "Ask Owner"}
            </Text>

            <Text style={styles.cardHint}>
            {isOwner
                ? "You own this asset. Manage incoming questions, public actions, and story settings here."
                : "Use this for quick member-to-member questions about this asset."}
            </Text>

            {!isOwner ? (
            <>
                <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="Example: Which IMS bearing kit did you use?"
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
                style={styles.textArea}
                />

                <TouchableOpacity style={styles.primaryButton} onPress={handleSendQuestion}>
                <Text style={styles.primaryButtonText}>Send Question</Text>
                </TouchableOpacity>
            </>
            ) : (
            <View style={styles.ownerActionList}>
                <TouchableOpacity style={styles.ownerActionRow}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.ownerActionText}>View Incoming Messages</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.ownerActionRow}>
                <Ionicons name="settings-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.ownerActionText}>Configure Public Actions</Text>
                </TouchableOpacity>
            </View>
            )}

            <View style={styles.card}>
            <Text style={styles.cardTitle}>
                {isOwner ? "Incoming Messages" : "Private Messages about this asset"}
            </Text>

            <Text style={styles.cardHint}>
                {threads.length
                ? "Questions and replies stay connected to this asset. Only you and the asset owner can see this thread."
                : isOwner
                ? "No incoming messages yet."
                : "No messages yet. Ask the owner a question to start one."}
            </Text>

            {threads.map((thread) => {
            const messages = thread.asset_thread_messages || [];

            const participantMessage = messages.find(
            (m) => String(m.from_user_id) !== String(currentUserId)
            );

            const participantId = isOwner
            ? participantMessage?.from_user_id || thread.created_by
            : thread.owner_id;

            console.log("THREAD PARTICIPANT", {
            threadId: thread.id,
            participantId,
            participantProfile: profilesById[participantId],
            allProfiles: profilesById,
            });

            const participantProfile = profilesById[participantId] || {};

            const otherEmail = participantProfile.email || "";
            
            const otherName =
            participantProfile.full_name ||
            participantProfile.display_name ||
            participantProfile.email ||
            formatNameFromEmail(otherEmail);


            const collapsed = !!collapsedThreadIds[thread.id];
            const lastMessage = messages[messages.length - 1];
            const lastProfile = lastMessage ? profilesById[lastMessage.from_user_id] || {} : {};
            const lastSenderName =
            lastProfile.full_name ||
            lastProfile.display_name ||
            formatNameFromEmail(lastProfile.email);

            const lastPreview = lastMessage?.body || "No messages yet";
            const lastTime = lastMessage?.created_at ? formatMessageTime(lastMessage.created_at) : "";

            return (
                <View key={thread.id} style={styles.threadCard}>
                <TouchableOpacity
                    style={styles.threadHeader}
                    onPress={() =>
                    setCollapsedThreadIds((prev) => ({
                        ...prev,
                        [thread.id]: !prev[thread.id],
                    }))
                    }
                >
                    <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                        {otherName.slice(0, 2).toUpperCase()}
                    </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                    <Text style={styles.threadSubject}>
                    {otherName}
                    {otherEmail ? ` • ${otherEmail}` : ""}
                    </Text>

                    <Text style={styles.threadParticipant}>
                    {thread.subject || assetName}
                    </Text>

                    <Text style={styles.threadPreview} numberOfLines={1}>
                    Last: {lastSenderName}: “{lastPreview}”
                    </Text>

                    {!!lastTime && (
                    <Text style={styles.threadTime}>{lastTime}</Text>
                    )}
                    {!!otherEmail && (
                        <Text style={styles.threadEmail}>{otherEmail}</Text>
                    )}
                    </View>

                    <Ionicons
                    name={collapsed ? "chevron-down-outline" : "chevron-up-outline"}
                    size={18}
                    color={colors.textMuted}
                    />
                </TouchableOpacity>

                {!collapsed && (
                    <>
                    {(thread.asset_thread_messages || []).map((m) => {
                        const mine = String(m.from_user_id) === String(currentUserId);
                        const profile = profilesById[m.from_user_id] || {};

                        const displayName =
                        profile.full_name ||
                        profile.display_name ||
                        formatNameFromEmail(profile.email);

                        const roleLabel =
                        String(m.from_user_id) === String(assetOwnerId)
                            ? "Owner"
                            : "Member";

                        return (
                        <View
                            key={m.id}
                            style={[
                            styles.messageBubble,
                            mine ? styles.messageBubbleMine : styles.messageBubbleOther,
                            ]}
                        >
                            <Text style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                            {mine ? "You" : displayName} · {roleLabel}
                            {profile.email ? ` • ${profile.email}` : ""}
                            {m.created_at ? ` • ${formatMessageTime(m.created_at)}` : ""}
                            </Text>



                            <Text style={[styles.messageBody, mine && styles.messageBodyMine]}>
                            {m.body}
                            </Text>
                        </View>
                        );
                    })}

                    <TextInput
                        value={replyByThreadId[thread.id] || ""}
                        onChangeText={(txt) =>
                        setReplyByThreadId((prev) => ({
                            ...prev,
                            [thread.id]: txt,
                        }))
                        }
                        placeholder="Write a reply..."
                        placeholderTextColor={colors.textMuted}
                        multiline
                        textAlignVertical="top"
                        style={styles.replyBox}
                    />

                    <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => handleSendReply(thread.id)}
                    >
                        <Text style={styles.secondaryButtonText}>Reply</Text>
                    </TouchableOpacity>
                    </>
                )}
                </View>
            );
            })}

            </View>
            </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingBottom: spacing.xl,
  },
ownerActionList: {
  marginTop: spacing.md,
  gap: 10,
},

ownerActionRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.background,
  borderRadius: radius.lg,
  paddingHorizontal: spacing.md,
  paddingVertical: 13,
},

ownerActionText: {
  fontSize: 14,
  fontWeight: "900",
  color: colors.textPrimary,
},

messageEmail: {
  fontSize: 10,
  fontWeight: "700",
  color: colors.textMuted,
  marginBottom: 4,
},

messageEmailMine: {
  color: "rgba(255,255,255,0.75)",
},

threadCard: {
  marginTop: spacing.md,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  borderRadius: radius.lg,
  backgroundColor: colors.background,
  padding: spacing.md,
},

threadSubject: {
  fontSize: 13,
  fontWeight: "900",
  color: colors.textPrimary,
  marginBottom: spacing.sm,
},

threadHeader: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  marginBottom: spacing.sm,
},

threadPreview: {
  marginTop: 3,
  fontSize: 12,
  fontWeight: "700",
  color: colors.textSecondary,
},

threadTime: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
  color: colors.textMuted,
},

avatarCircle: {
  width: 38,
  height: 38,
  borderRadius: 19,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  alignItems: "center",
  justifyContent: "center",
},

avatarText: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textPrimary,
},

threadParticipant: {
  marginTop: 3,
  fontSize: 12,
  fontWeight: "800",
  color: colors.textSecondary,
},

threadEmail: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
  color: colors.textMuted,
},

messageMetaMine: {
  color: "rgba(255,255,255,0.82)",
},

messageBodyMine: {
  color: "white",
},

messageBubble: {
  marginTop: 8,
  borderRadius: radius.lg,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  maxWidth: "82%",
},

messageBubbleMine: {
  alignSelf: "flex-end",
  backgroundColor: colors.brandBlue,
},

messageBubbleOther: {
  alignSelf: "flex-start",
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
},

messageMeta: {
  fontSize: 10,
  fontWeight: "900",
  color: colors.textMuted,
  marginBottom: 4,
},

messageBody: {
  fontSize: 13,
  fontWeight: "700",
  color: colors.textPrimary,
},

replyBox: {
  marginTop: spacing.md,
  minHeight: 76,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  borderRadius: radius.lg,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  backgroundColor: colors.surface,
  color: colors.textPrimary,
  fontSize: 13,
},

secondaryButton: {
  marginTop: spacing.sm,
  alignSelf: "flex-end",
  borderRadius: radius.pill,
  backgroundColor: colors.textPrimary,
  paddingHorizontal: 18,
  paddingVertical: 10,
},

secondaryButtonText: {
  color: "white",
  fontSize: 13,
  fontWeight: "900",
},

  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  backText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  header: {
    marginBottom: spacing.lg,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  title: {
    marginTop: 4,
    fontSize: 26,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  cardHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  textArea: {
    marginTop: spacing.md,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 14,
  },
  primaryButton: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
});