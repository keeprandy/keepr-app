import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadows, spacing } from "../styles/theme";
import {
  MESSAGE_SCOPES,
  buildMessageResourceRef,
  createMemberThread,
  formatMessageTime,
  getMessageSenderLabel,
  groupThreadsByAsset,
  loadAuthorizedAssets,
  loadEligibleRecipientsForAsset,
  loadMessageWorkspace,
  loadSystemsForAsset,
  normalizeMessageScope,
  sendThreadReply,
} from "../lib/messagesService";

function contextLabel(thread) {
  const systemName = thread?.system?.name || null;
  const assetName = thread?.asset?.name || "Unknown asset";
  const proName = thread?.keeprPro?.name || null;
  if (systemName && proName) return `${systemName} · ${proName}`;
  if (systemName) return systemName;
  if (proName) return `General · ${proName}`;
  return thread?.subject || `General · ${assetName}`;
}

function sourceLabel(thread) {
  if (thread?.source_type === "public_system_story") return "Public System Story";
  if (thread?.source_type === "public_asset_story") return "Public Asset Story";
  if (thread?.hub_id) return "KeeprHub";
  return "Member";
}

function statusStyle(label) {
  if (label === "New inbound") return styles.statusNew;
  if (label === "Resolved") return styles.statusResolved;
  return styles.statusOpen;
}

export default function KeeprActionScreen({ route, navigation }) {
  const params = route?.params || {};
  const requestedScope = params.scope || normalizeMessageScope(params);
  const assetId = params.assetId || params.asset_id || null;
  const systemId = params.systemId || params.system_id || null;
  const kac = params.kac || null;
  const initialThreadId = params.threadId || params.assetThreadId || params.asset_thread_id || null;
  const { width } = useWindowDimensions();
  const compact = width < 900;

  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState({
    currentUserId: null,
    asset: null,
    system: null,
    profilesById: {},
    threads: [],
  });
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [replyByThreadId, setReplyByThreadId] = useState({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [assets, setAssets] = useState([]);
  const [systems, setSystems] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [draft, setDraft] = useState({
    assetId: assetId || "",
    systemId: systemId || "",
    recipientId: "",
    subject: "",
    body: "",
  });

  const scope = requestedScope || MESSAGE_SCOPES.GLOBAL;
  const isGlobal = scope === MESSAGE_SCOPES.GLOBAL && !assetId && !systemId;
  const isSystem = !!assetId && !!systemId;
  const title = isGlobal ? "All Messages" : isSystem ? `${params.systemName || workspace.system?.name || "System"} Messages` : `${params.assetName || workspace.asset?.name || "Asset"} Messages`;
  const emptyText = isGlobal
    ? "No conversations yet."
    : isSystem
      ? "No conversations about this system yet."
      : "No conversations about this asset yet.";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadMessageWorkspace({
        scope,
        assetId,
        kac,
        systemId,
      });
      setWorkspace(next);
      setSelectedThreadId((prev) => {
        if (initialThreadId && next.threads?.some((t) => t.id === initialThreadId)) {
          return initialThreadId;
        }
        if (prev && next.threads?.some((t) => t.id === prev)) return prev;
        return next.threads?.[0]?.id || null;
      });

      const visibleAssets = await loadAuthorizedAssets();
      setAssets(visibleAssets);

      const effectiveAssetId = assetId || draft.assetId || next.asset?.id || "";
      if (effectiveAssetId) {
        const [systemRows, recipientRows] = await Promise.all([
          loadSystemsForAsset(effectiveAssetId),
          loadEligibleRecipientsForAsset(effectiveAssetId, next.currentUserId),
        ]);
        setSystems(systemRows);
        setRecipients(recipientRows);
      } else {
        setSystems([]);
        setRecipients([]);
      }
    } catch (e) {
      Alert.alert("Messages unavailable", e?.message || "Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, [assetId, draft.assetId, initialThreadId, kac, scope, systemId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setDraft((prev) => ({
      ...prev,
      assetId: assetId || prev.assetId || "",
      systemId: systemId || prev.systemId || "",
      subject:
        prev.subject ||
        params.systemName ||
        params.assetName ||
        workspace.system?.name ||
        workspace.asset?.name ||
        "",
    }));
  }, [assetId, params.assetName, params.systemName, systemId, workspace.asset?.name, workspace.system?.name]);

  const groups = useMemo(() => groupThreadsByAsset(workspace.threads), [workspace.threads]);
  const selectedThread = useMemo(
    () => workspace.threads.find((t) => t.id === selectedThreadId) || workspace.threads[0] || null,
    [selectedThreadId, workspace.threads]
  );
  const canStart = !!workspace.currentUserId && (!!assetId || !!draft.assetId) && recipients.length > 0;

  const handleAssetChoice = async (nextAssetId) => {
    setDraft((prev) => ({ ...prev, assetId: nextAssetId, systemId: "", recipientId: "" }));
    const [systemRows, recipientRows] = await Promise.all([
      loadSystemsForAsset(nextAssetId),
      loadEligibleRecipientsForAsset(nextAssetId, workspace.currentUserId),
    ]);
    setSystems(systemRows);
    setRecipients(recipientRows);
  };

  const handleCreateThread = async () => {
    try {
      const chosenAssetId = assetId || draft.assetId;
      const chosenAsset = assets.find((a) => a.id === chosenAssetId) || workspace.asset || null;
      const chosenSystemId = systemId || draft.systemId || null;
      const chosenSystem = systems.find((s) => s.id === chosenSystemId) || workspace.system || null;
      const subject = draft.subject || chosenSystem?.name || chosenAsset?.name || "Keepr conversation";
      await createMemberThread({
        assetId: chosenAssetId,
        systemId: chosenSystemId,
        keeprProId: params.keeprProId || null,
        ownerId: chosenAsset?.owner_id || workspace.asset?.owner_id,
        recipientId: draft.recipientId,
        subject,
        body: draft.body,
        resourceRef: params.canonicalResource || buildMessageResourceRef({
          parentAssetKac: params.kac || chosenAsset?.kac_id || workspace.asset?.kac_id || null,
          assetId: chosenAssetId,
          systemId: chosenSystemId,
        }),
      });
      setDraft((prev) => ({ ...prev, body: "", subject: "" }));
      setComposerOpen(false);
      await refresh();
    } catch (e) {
      Alert.alert("Could not start conversation", e?.message || "Try again.");
    }
  };

  const handleReply = async (threadId) => {
    try {
      await sendThreadReply(threadId, replyByThreadId[threadId]);
      setReplyByThreadId((prev) => ({ ...prev, [threadId]: "" }));
      await refresh();
    } catch (e) {
      Alert.alert("Could not reply", e?.message || "Try again.");
    }
  };

  const goBack = () => {
    if (params.backRoute) {
      navigation.navigate(params.backRoute, params.backParams || {});
      return;
    }
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RootTabs", { screen: "Dashboard" });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goBack}>
            <Ionicons name="chevron-back-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>MESSAGES</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              Conversations stay attached to the asset and system context that created them.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.newButton, !canStart && styles.newButtonQuiet]}
            onPress={() => setComposerOpen((prev) => !prev)}
            disabled={!canStart}
          >
            <Ionicons name="create-outline" size={16} color={canStart ? "white" : colors.textMuted} />
            <Text style={[styles.newButtonText, !canStart && styles.newButtonTextQuiet]}>New conversation</Text>
          </TouchableOpacity>
        </View>

        {params.keeprProName ? (
          <View style={styles.truthCard}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.truthText}>
              {params.keeprProName} is connected to this system but is not yet participating in Keepr Messages.
            </Text>
          </View>
        ) : null}

        {composerOpen ? (
          <View style={styles.composerCard}>
            <Text style={styles.cardTitle}>Start a conversation</Text>
            {isGlobal ? (
              <>
                <Text style={styles.label}>Asset</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                  {assets.map((asset) => (
                    <TouchableOpacity
                      key={asset.id}
                      style={[styles.choicePill, draft.assetId === asset.id && styles.choicePillActive]}
                      onPress={() => handleAssetChoice(asset.id)}
                    >
                      <Text style={[styles.choiceText, draft.assetId === asset.id && styles.choiceTextActive]}>{asset.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}

            <Text style={styles.label}>System context</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              <TouchableOpacity
                style={[styles.choicePill, !draft.systemId && !systemId && styles.choicePillActive]}
                onPress={() => setDraft((prev) => ({ ...prev, systemId: "" }))}
              >
                <Text style={[styles.choiceText, !draft.systemId && !systemId && styles.choiceTextActive]}>General</Text>
              </TouchableOpacity>
              {systems.map((system) => (
                <TouchableOpacity
                  key={system.id}
                  style={[styles.choicePill, (draft.systemId || systemId) === system.id && styles.choicePillActive]}
                  onPress={() => setDraft((prev) => ({ ...prev, systemId: system.id, subject: system.name }))}
                  disabled={!!systemId}
                >
                  <Text style={[styles.choiceText, (draft.systemId || systemId) === system.id && styles.choiceTextActive]}>{system.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Eligible participant</Text>
            {recipients.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                {recipients.map((recipient) => (
                  <TouchableOpacity
                    key={recipient.id}
                    style={[styles.choicePill, draft.recipientId === recipient.id && styles.choicePillActive]}
                    onPress={() => setDraft((prev) => ({ ...prev, recipientId: recipient.id }))}
                  >
                    <Text style={[styles.choiceText, draft.recipientId === recipient.id && styles.choiceTextActive]}>{recipient.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.emptySmall}>No eligible authenticated participant is available for this context yet.</Text>
            )}

            <TextInput
              value={draft.subject}
              onChangeText={(subject) => setDraft((prev) => ({ ...prev, subject }))}
              placeholder="Subject"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={draft.body}
              onChangeText={(body) => setDraft((prev) => ({ ...prev, body }))}
              placeholder="Write the first message..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateThread}>
              <Text style={styles.primaryButtonText}>Send first message</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator />
            <Text style={styles.emptySmall}>Loading messages...</Text>
          </View>
        ) : workspace.threads.length === 0 ? (
          <View style={styles.loadingCard}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{emptyText}</Text>
            {canStart ? <Text style={styles.emptySmall}>Start a conversation when you need context preserved.</Text> : null}
          </View>
        ) : (
          <View style={[styles.workspace, compact && styles.workspaceCompact]}>
            <ScrollView style={[styles.threadPane, compact && styles.threadPaneCompact]} contentContainerStyle={styles.threadPaneContent}>
              {groups.map((group) => (
                <View key={group.assetId || "unknown"} style={styles.groupBlock}>
                  <Text style={styles.groupTitle}>{group.assetName}</Text>
                  {group.threads.map((thread) => (
                    <TouchableOpacity
                      key={thread.id}
                      style={[styles.threadRow, selectedThread?.id === thread.id && styles.threadRowActive]}
                      onPress={() => setSelectedThreadId(thread.id)}
                    >
                      <View style={styles.threadTopLine}>
                        <Text style={styles.threadContext} numberOfLines={1}>{contextLabel(thread)}</Text>
                        <View style={[styles.statusPill, statusStyle(thread.attentionState)]}>
                          <Text style={styles.statusText}>{thread.attentionState}</Text>
                        </View>
                      </View>
                      <Text style={styles.participant} numberOfLines={1}>{thread.participantLabel}</Text>
                      <Text style={styles.preview} numberOfLines={1}>
                        {(thread.messages || [])[Math.max((thread.messages || []).length - 1, 0)]?.body || "No messages yet"}
                      </Text>
                      <Text style={styles.timeText}>{formatMessageTime(thread.updated_at || thread.created_at)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>

            <ScrollView style={[styles.conversationPane, compact && styles.conversationPaneCompact]} contentContainerStyle={styles.conversationContent}>
              {selectedThread ? (
                <>
                  <View style={styles.conversationHeader}>
                    <Text style={styles.conversationTitle}>{contextLabel(selectedThread)}</Text>
                    <Text style={styles.conversationSubtitle}>
                      {selectedThread.asset?.name || "Asset"}
                      {selectedThread.system?.name ? ` · ${selectedThread.system.name}` : ""}
                      {selectedThread.keeprPro?.name ? ` · ${selectedThread.keeprPro.name}` : ""}
                    </Text>
                    <Text style={styles.sourceText}>
                      {selectedThread.participantLabel} · {sourceLabel(selectedThread)}
                    </Text>
                  </View>

                  {(selectedThread.messages || []).map((m) => {
                    const mine = m.from_user_id && String(m.from_user_id) === String(workspace.currentUserId);
                    const label = mine ? "You" : getMessageSenderLabel(m, workspace.profilesById);
                    return (
                      <View key={m.id} style={[styles.messageBubble, mine ? styles.messageMine : styles.messageOther]}>
                        <Text style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                          {label}
                          {m.created_at ? ` · ${formatMessageTime(m.created_at)}` : ""}
                        </Text>
                        <Text style={[styles.messageBody, mine && styles.messageBodyMine]}>{m.body}</Text>
                      </View>
                    );
                  })}

                  <View style={styles.replyDock}>
                    <TextInput
                      value={replyByThreadId[selectedThread.id] || ""}
                      onChangeText={(txt) => setReplyByThreadId((prev) => ({ ...prev, [selectedThread.id]: txt }))}
                      placeholder="Write a reply..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                      style={styles.replyBox}
                    />
                    <TouchableOpacity style={styles.replyButton} onPress={() => handleReply(selectedThread.id)}>
                      <Ionicons name="send-outline" size={16} color="white" />
                      <Text style={styles.replyButtonText}>Reply</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  shell: {
    flex: 1,
    width: "100%",
    maxWidth: 1280,
    alignSelf: "center",
    padding: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  backText: { fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  kicker: { fontSize: 11, fontWeight: "900", color: colors.textMuted },
  title: { fontSize: 28, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  newButtonQuiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle },
  newButtonText: { color: "white", fontSize: 13, fontWeight: "900" },
  newButtonTextQuiet: { color: colors.textMuted },
  truthCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  truthText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textSecondary, fontWeight: "700" },
  composerCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.subtle,
  },
  cardTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  label: { marginTop: spacing.md, marginBottom: 7, fontSize: 12, fontWeight: "900", color: colors.textMuted },
  choiceRow: { gap: 8, paddingBottom: 2 },
  choicePill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  choicePillActive: { borderColor: colors.brandBlue, backgroundColor: "#EFF6FF" },
  choiceText: { color: colors.textSecondary, fontWeight: "800", fontSize: 12 },
  choiceTextActive: { color: colors.brandBlue },
  input: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
  },
  textArea: { minHeight: 92 },
  primaryButton: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    paddingVertical: 13,
  },
  primaryButtonText: { color: "white", fontWeight: "900" },
  loadingCard: {
    flex: 1,
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 18, color: colors.textPrimary, fontWeight: "900" },
  emptySmall: { fontSize: 13, color: colors.textSecondary, fontWeight: "700" },
  workspace: {
    flex: 1,
    minHeight: 560,
    flexDirection: "row",
    gap: spacing.md,
  },
  workspaceCompact: {
    flexDirection: "column",
  },
  threadPane: {
    width: 390,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  threadPaneCompact: {
    width: "100%",
    maxHeight: 340,
  },
  threadPaneContent: { padding: spacing.md, gap: spacing.md },
  groupBlock: { gap: spacing.sm },
  groupTitle: { fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  threadRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  threadRowActive: { borderColor: colors.brandBlue, backgroundColor: "#F8FBFF" },
  threadTopLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  threadContext: { flex: 1, fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  statusNew: { backgroundColor: "#DBEAFE" },
  statusOpen: { backgroundColor: "#ECFDF5" },
  statusResolved: { backgroundColor: "#F3F4F6" },
  statusText: { fontSize: 10, fontWeight: "900", color: colors.textPrimary },
  participant: { marginTop: 8, fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  preview: { marginTop: 4, fontSize: 12, color: colors.textSecondary },
  timeText: { marginTop: 5, fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  conversationPane: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  conversationPaneCompact: {
    minHeight: 420,
  },
  conversationContent: { padding: spacing.lg },
  conversationHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
  },
  conversationTitle: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  conversationSubtitle: { marginTop: 4, fontSize: 13, fontWeight: "800", color: colors.textSecondary },
  sourceText: { marginTop: 5, fontSize: 12, fontWeight: "800", color: colors.textMuted },
  messageBubble: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxWidth: "82%",
  },
  messageMine: { alignSelf: "flex-end", backgroundColor: colors.brandBlue },
  messageOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  messageMeta: { fontSize: 10, fontWeight: "900", color: colors.textMuted, marginBottom: 4 },
  messageMetaMine: { color: "rgba(255,255,255,0.82)" },
  messageBody: { fontSize: 13, lineHeight: 19, color: colors.textPrimary, fontWeight: "700" },
  messageBodyMine: { color: "white" },
  replyDock: { marginTop: spacing.lg },
  replyBox: {
    minHeight: 82,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  replyButtonText: { color: "white", fontWeight: "900" },
});
