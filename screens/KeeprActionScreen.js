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
import { getSupabaseFunctionUrl } from "../lib/supabaseFunctions";

const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

async function postPublicThread(payload) {
  if (!ANON_KEY) throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY");

  const res = await fetch(getSupabaseFunctionUrl("public-thread"), {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    const err = new Error((json && (json.error || json.message)) || text || `HTTP ${res.status}`);
    err.code = json?.error || null;
    throw err;
  }

  return json || {};
}

export default function KeeprActionScreen({ route, navigation }) {
    const {
      assetId,
      kac,
      assetName,
      assetOwnerId: routeAssetOwnerId,
      hubId,
      hubName,
      threadId,
      messageId,
      projectionType,
      publicThreadToken,
      accessState,
    } = route?.params || {};

    const [message, setMessage] = React.useState("");
    const [threads, setThreads] = React.useState([]);
    const [replyByThreadId, setReplyByThreadId] = React.useState({});
    const [loadingContext, setLoadingContext] = React.useState(true);
    const [currentUserId, setCurrentUserId] = React.useState(null);
   const [assetOwnerId, setAssetOwnerId] = React.useState(routeAssetOwnerId || null);
    const [resolvedAssetId, setResolvedAssetId] = React.useState(assetId || null);
    const [resolvedAssetName, setResolvedAssetName] = React.useState(assetName || null);
    const [isOwner, setIsOwner] = React.useState(false);
    const [profilesById, setProfilesById] = React.useState({});
    const [collapsedThreadIds, setCollapsedThreadIds] = React.useState({});
    const [threadAccessState, setThreadAccessState] = React.useState(accessState || null);
    const isPublicThread = !!publicThreadToken;

const notifyThreadMessage = React.useCallback(async ({
  eventType,
  threadId: notifyThreadId,
  messageId: notifyMessageId,
}) => {
  if (!notifyThreadId || !notifyMessageId) return;

  try {
    const { error } = await supabase.functions.invoke("asset-thread-notify", {
      body: {
        event_type: eventType,
        thread_id: notifyThreadId,
        message_id: notifyMessageId,
        asset_id: resolvedAssetId || assetId || null,
        kac: kac || null,
        projection_type: projectionType || null,
        hub_id: hubId || null,
      },
    });

    if (error) {
      console.error("Asset thread notification failed", error);
    }
  } catch (notificationError) {
    console.error("Asset thread notification failed", notificationError);
  }
}, [assetId, resolvedAssetId, kac, projectionType, hubId]);

const applyPublicThreadResponse = React.useCallback((json) => {
  const thread = json?.thread || null;
  const asset = json?.asset || null;
  if (!thread?.id || !asset?.id) {
    throw new Error("private_link_expired");
  }

  setCurrentUserId(null);
  setAssetOwnerId(thread.owner_id || null);
  setResolvedAssetId(asset.id);
  setResolvedAssetName(asset.name || "Asset");
  setIsOwner(false);
  setProfilesById({});
  setThreads([thread]);
  setThreadAccessState(null);
  setCollapsedThreadIds((prev) => ({ ...prev, [thread.id]: false }));
}, []);

const loadPublicThread = React.useCallback(async () => {
  if (!publicThreadToken) return false;

  try {
    const json = await postPublicThread({
      intent: "read_thread",
      token: publicThreadToken,
      message_id: messageId || null,
    });
    applyPublicThreadResponse(json);
    return true;
  } catch (e) {
    const code = e?.code || e?.message;
    setThreadAccessState(code === "expired" ? "private_link_expired" : "private_link_expired");
    setThreads([]);
    return true;
  }
}, [publicThreadToken, messageId, applyPublicThreadResponse]);

React.useEffect(() => {
  let active = true;

  const loadContext = async () => {
    try {
      setLoadingContext(true);

      if (publicThreadToken) {
        await loadPublicThread();
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id || null;

      if (!uid && threadId) {
        if (!active) return;
        setCurrentUserId(null);
        setThreadAccessState("requires_sign_in");
        return;
      }

      let query = supabase
        .from("assets")
        .select("id, owner_id, name, kac_id");

      if (assetId) {
        query = query.eq("id", assetId);
      } else if (kac) {
        query = query.eq("kac_id", kac);
      } else {
        throw new Error("Missing asset context.");
      }

      const { data: assetRow, error } = await query.maybeSingle();

      console.log("ASSET ROW", assetRow);
      console.log("OWNER", assetRow?.owner_id);
      console.log("ERROR", error);

      if (error) throw error;

      if (!active) return;

      setCurrentUserId(uid);
      setResolvedAssetId(assetRow?.id || assetId || null);
      setResolvedAssetName(assetRow?.name || assetName || null);
      setAssetOwnerId(assetRow?.owner_id || routeAssetOwnerId || null);
      const effectiveOwnerId = assetRow?.owner_id || routeAssetOwnerId || null;

      setIsOwner(
        !!uid &&
          !!effectiveOwnerId &&
          String(uid) === String(effectiveOwnerId)
      );
      setThreadAccessState(accessState || null);
    } catch (e) {
      console.log("KeeprAction context load failed:", e?.message || e);
    } finally {
      if (active) setLoadingContext(false);
    }
  };

  loadContext();

  return () => {
    active = false;
  };
}, [assetId, kac, assetName, publicThreadToken, accessState, loadPublicThread]);

  
const handleSendQuestion = async () => {
  console.log("SEND QUESTION BUTTON FIRED", {
    message,
    assetId,
    resolvedAssetId,
    kac,
    currentUserId,
    assetOwnerId,
    isOwner,
    hubId,
  });

  const cleanMessage = String(message || "").trim();

  if (!cleanMessage) {
    console.log("SEND QUESTION BLOCKED: empty message");
    Alert.alert("Add a message", "Type your question first.");
    return;
  }

  if (!currentUserId) {
    console.log("SEND QUESTION BLOCKED: no current user");
    Alert.alert("Not ready", "You need to be signed in.");
    return;
  }

    const effectiveOwnerId = assetOwnerId || routeAssetOwnerId || null;

    if (!effectiveOwnerId) {
      console.log("SEND QUESTION BLOCKED: no asset owner", {
        assetOwnerId,
        routeAssetOwnerId,
      });
      Alert.alert("Not ready", "We could not resolve the owner for this asset.");
      return;
    }

  const threadAssetId = resolvedAssetId || assetId;

  if (!threadAssetId) {
    console.log("SEND QUESTION BLOCKED: no resolved asset id");
    Alert.alert("Not ready", "We could not resolve this asset.");
    return;
  }

  try {
    console.log("CREATING THREAD", {
      threadAssetId,
      hubId,
      assetOwnerId,
      currentUserId,
      subject: resolvedAssetName || assetName || "Asset question",
    });

    const { data: existingThread, error: existingThreadError } = await supabase
      .from("asset_threads")
      .select("id")
      .eq("asset_id", threadAssetId)
      .eq("owner_id", effectiveOwnerId)
      .eq("created_by", currentUserId)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingThreadError) throw existingThreadError;

    let thread = existingThread;
    let threadError = null;

    if (!thread?.id) {
      const result = await supabase
        .from("asset_threads")
        .insert({
          asset_id: threadAssetId,
          hub_id: hubId || null,
          owner_id: effectiveOwnerId,
          created_by: currentUserId,
          subject: resolvedAssetName || assetName || "Asset question",
          status: "open",
        })
        .select("id")
        .single();

      thread = result.data;
      threadError = result.error;
    } else {
      await supabase
        .from("asset_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", thread.id);
    }

    console.log("THREAD INSERT RESULT", { thread, threadError });

    if (threadError) throw threadError;
    if (!thread?.id) throw new Error("Thread was not created.");

    const { data: createdMessage, error: msgError } = await supabase
      .from("asset_thread_messages")
      .insert({
        thread_id: thread.id,
        from_user_id: currentUserId,
        body: cleanMessage,
      })
      .select("id")
      .single();

    console.log("MESSAGE INSERT RESULT", { msgError });

    if (msgError) throw msgError;

    setMessage("");
    await notifyThreadMessage({
      eventType: "new_ask_owner_message",
      threadId: thread.id,
      messageId: createdMessage?.id,
    });
    await loadThreads();
  } catch (e) {
    console.log("SEND QUESTION ERROR", e);
    Alert.alert("Could not send", e?.message || "Try again.");
  }
};

    const handleSendReply = async (threadId) => {
  const body = String(replyByThreadId[threadId] || "").trim();

  if (!body) {
    Alert.alert("Add a reply", "Type your reply first.");
    return;
  }

  if (publicThreadToken) {
    try {
      const json = await postPublicThread({
        intent: "post_followup",
        token: publicThreadToken,
        message: body,
      });

      setReplyByThreadId((prev) => ({
        ...prev,
        [threadId]: "",
      }));
      applyPublicThreadResponse(json);
    } catch (e) {
      setThreadAccessState("private_link_expired");
      Alert.alert("Could not reply", "This private link is expired or unavailable.");
    }
    return;
  }

  if (!currentUserId) {
    Alert.alert("Not ready", "You need to be signed in.");
    return;
  }

  if (!resolvedAssetId) {
  Alert.alert("Not ready", "We could not resolve this asset.");
  return;
}

  try {
    const { data: createdMessage, error } = await supabase
      .from("asset_thread_messages")
      .insert({
        thread_id: threadId,
        from_user_id: currentUserId,
        body,
      })
      .select("id")
      .single();

    if (error) throw error;

    await supabase
      .from("asset_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId);

    setReplyByThreadId((prev) => ({
      ...prev,
      [threadId]: "",
    }));

    await notifyThreadMessage({
      eventType: "owner_reply",
      threadId,
      messageId: createdMessage?.id,
    });
    await loadThreads();
  } catch (e) {
    Alert.alert("Could not reply", e?.message || "Try again.");
  }
};

const loadThreads = React.useCallback(async () => {
  if (publicThreadToken) return;
  const threadAssetId = resolvedAssetId || assetId;
  if (!threadAssetId) return;

  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id || null;

  const { data: assetRow, error: assetError } = await supabase
    .from("assets")
    .select("id, owner_id, name")
    .eq("id", threadAssetId)
    .maybeSingle();

  if (assetError) throw assetError;

  const ownerId = assetRow?.owner_id || routeAssetOwnerId || null;

  setCurrentUserId(uid);
  setAssetOwnerId(ownerId);
  setResolvedAssetName(assetRow?.name || assetName || null);
  setIsOwner(!!uid && !!ownerId && String(uid) === String(ownerId));

  let threadQuery = supabase
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
    .eq("asset_id", threadAssetId);

  if (threadId) {
    threadQuery = threadQuery.eq("id", threadId);
  }

  const { data: threadRows, error: threadError } = await threadQuery.order(
    "updated_at",
    { ascending: false }
  );

  if (threadError) {
    if (threadId) setThreadAccessState("access_denied");
    throw threadError;
  }

  const rows = threadRows || [];

  if (threadId && rows.length === 0) {
    setThreadAccessState("missing_thread");
  } else if (!accessState) {
    setThreadAccessState(null);
  }

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

    if (!result.error) {
      const map = {};
      (result.data || []).forEach((p) => {
        map[p.id] = p;
      });

      console.log("PROFILE MAP", map);
      setProfilesById(map);
    }
  }

  setThreads(rows);
}, [resolvedAssetId, assetId, assetName, routeAssetOwnerId, threadId, accessState, publicThreadToken]);


React.useEffect(() => {
  if (publicThreadToken) return;
  loadThreads().catch((e) => {
    console.log("Load asset threads failed:", e?.message || e);
  });
}, [loadThreads, publicThreadToken]);

React.useEffect(() => {
  if (!threadId) return;
  setCollapsedThreadIds((prev) => ({
    ...prev,
    [threadId]: false,
  }));
}, [threadId, messageId]);

React.useEffect(() => {
  if (publicThreadToken) return;
  const threadAssetId = resolvedAssetId || assetId;
  if (!threadAssetId) return;

  const channel = supabase
    .channel(`asset-thread-messages-${threadAssetId}`)
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
        filter: `asset_id=eq.${threadAssetId}`,
      },
      () => {
        loadThreads();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [resolvedAssetId, assetId, loadThreads, publicThreadToken]);

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

const noticeCopyByState = {
  missing_thread: {
    title: "Thread unavailable",
    text: "We could not find that exact message thread for this asset. You can still use asset Actions from here.",
  },
  access_denied: {
    title: "Access denied",
    text: "You do not have access to this asset thread.",
  },
  private_link_expired: {
    title: "Private link expired",
    text: "This public sender link is expired or has been revoked. Ask the owner for a fresh link.",
  },
  requires_sign_in: {
    title: "Sign in to open this conversation",
    text: "After sign-in, Keepr will return you to this exact asset thread.",
  },
};

const accessNotice = noticeCopyByState[threadAccessState] || null;

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
            {threadId
              ? "Opening the exact asset conversation from your notification."
              : "Ask the owner a question or start a lightweight Keepr conversation around this asset."}
          </Text>
        </View>

        {accessNotice && (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>{accessNotice.title}</Text>
            <Text style={styles.noticeText}>{accessNotice.text}</Text>
            {threadAccessState === "requires_sign_in" && (
              <TouchableOpacity
                style={styles.noticeButton}
                onPress={() =>
                  navigation.navigate("Auth", {
                    continueRoute: route?.name || "KeeprThread",
                    continueParams: route?.params || {},
                  })
                }
              >
                <Text style={styles.noticeButtonText}>Sign in to continue</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {(threadId || messageId || projectionType || hubId) && (
          <View style={styles.contextChip}>
            <Ionicons name="link-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.contextChipText} numberOfLines={1}>
              {threadId ? `Thread ${String(threadId).slice(0, 8)}` : "Asset Actions"}
              {messageId ? ` • Message ${String(messageId).slice(0, 8)}` : ""}
              {projectionType ? ` • ${projectionType}` : ""}
              {hubId ? " • Hub context" : ""}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {isOwner ? "Owner Actions" : "Ask Owner"}
            </Text>

            <Text style={styles.cardHint}>
            {isOwner
                ? "You own this asset. Manage incoming questions, public actions, and story settings here."
                : "Use this for quick member-to-member questions about this asset."}
            </Text>

            {!isOwner && !isPublicThread ? (
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

               <TouchableOpacity
  style={styles.primaryButton}
  onPress={() => {
    console.log("SEND QUESTION TOUCHABLE PRESSED");
    handleSendQuestion();
  }}
>
                <Text style={styles.primaryButtonText}>Send Question</Text>
                </TouchableOpacity>
            </>
            ) : isOwner ? (
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
            ) : (
            <Text style={styles.cardHint}>
                You are viewing this conversation through a secure private link. Use the reply box below to follow up.
            </Text>
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
                        const isTargetMessage =
                        !!messageId && String(m.id) === String(messageId);

                        const displayName =
                        profile.full_name ||
                        profile.display_name ||
                        m.sender_role === "public_sender" && "Public Sender" ||
                        formatNameFromEmail(profile.email);

                        const roleLabel =
                        String(m.from_user_id) === String(assetOwnerId)
                            ? "Owner"
                            : m.sender_role === "public_sender"
                            ? "Public Sender"
                            : "Member";

                        return (
                        <View
                            key={m.id}
                            style={[
                            styles.messageBubble,
                            mine ? styles.messageBubbleMine : styles.messageBubbleOther,
                            isTargetMessage && styles.messageBubbleHighlight,
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

noticeCard: {
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  borderRadius: radius.lg,
  backgroundColor: colors.surface,
  padding: spacing.md,
  marginBottom: spacing.md,
},

noticeTitle: {
  fontSize: 14,
  fontWeight: "900",
  color: colors.textPrimary,
},

noticeText: {
  marginTop: 4,
  fontSize: 13,
  lineHeight: 18,
  color: colors.textSecondary,
},

noticeButton: {
  marginTop: spacing.md,
  alignSelf: "flex-start",
  borderRadius: radius.pill,
  backgroundColor: colors.textPrimary,
  paddingHorizontal: 16,
  paddingVertical: 10,
},

noticeButtonText: {
  color: "white",
  fontSize: 13,
  fontWeight: "900",
},

contextChip: {
  alignSelf: "flex-start",
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  borderRadius: radius.pill,
  backgroundColor: colors.surface,
  paddingHorizontal: 12,
  paddingVertical: 8,
  marginBottom: spacing.md,
  maxWidth: "100%",
},

contextChipText: {
  flexShrink: 1,
  fontSize: 12,
  fontWeight: "800",
  color: colors.textSecondary,
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

messageBubbleHighlight: {
  borderWidth: 2,
  borderColor: colors.brandBlue,
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
