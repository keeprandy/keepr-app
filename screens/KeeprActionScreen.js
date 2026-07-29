import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as Clipboard from "expo-clipboard";

import { colors, radius, shadows, spacing } from "../styles/theme";
import {
  MESSAGE_SCOPES,
  buildMessageResourceRef,
  createMessagesRealtimeSubscriptions,
  createMessageLinkThread,
  createMemberThread,
  formatMessageTime,
  getMatchingOpenThreads,
  getMessageSenderLabel,
  getThreadMessageLink,
  groupThreadsByAsset,
  loadAuthorizedAssets,
  loadEligibleRecipientsForAsset,
  loadMessageWorkspace,
  loadThreadMessages,
  loadSystemsForAsset,
  normalizeMessageScope,
  resolveMessageIdentities,
  rotateThreadMessageLink,
  sendThreadReply,
} from "../lib/messagesService";
import {
  buildKeeprAttentionEvent,
  shouldShowMessageAttention,
} from "../lib/inAppAttention";

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

function mergeVisibleAssets(...collections) {
  const byId = new Map();
  collections.flat().filter(Boolean).forEach((asset) => {
    if (!asset?.id) return;
    byId.set(asset.id, { ...(byId.get(asset.id) || {}), ...asset });
  });
  return Array.from(byId.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function absoluteMessageLink(path) {
  const cleanPath = String(path || "").trim();
  if (!cleanPath) return "";
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  const normalizedPath = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${normalizedPath}`;
  }
  return `https://app.keeprhome.com${normalizedPath}`;
}

function getPendingMessageLink(thread, currentUserId) {
  const messageLink = thread?.resource_ref?.message_link || null;
  const path = messageLink?.path || messageLink?.url || null;
  if (thread?.source_type !== "member_message_link") return null;
  if (messageLink?.claimed_by || messageLink?.status === "claimed") return null;
  const status = messageLink?.status === "revoked" || messageLink?.status === "expired"
    ? messageLink.status
    : "pending";
  if (!path && status === "pending") return null;
  const messages = thread?.messages || [];
  const hasRecipientActivity = messages.some((message) => {
    if (!message?.from_user_id) return false;
    if (currentUserId && String(message.from_user_id) === String(currentUserId)) return false;
    return true;
  });
  if (hasRecipientActivity) return null;
  return {
    path,
    url: path ? absoluteMessageLink(path) : "",
    status,
    recipientName:
      messageLink?.intended_recipient?.display_name ||
      messageLink?.intended_recipient?.email ||
      "recipient",
  };
}

function getDeliveryState(identity) {
  if (!identity) return null;
  if (identity.is_selectable && identity.user_id) {
    return {
      key: "in_app",
      label: "Delivery: in Keepr",
      body: `${identity.display_name || identity.email || "This recipient"} can receive this as an in-app Keepr conversation.`,
      actionLabel: "Send message",
      icon: "chatbubble-ellipses-outline",
      actionable: true,
    };
  }
  if (identity.source_type === "new_email" || identity.source_type === "external_contact") {
    return {
      key: "message_link",
      label: "Delivery: message link",
      body: "Keepr will create the conversation now and give you a link to paste into text, Messenger, email, a contact form, or any other channel.",
      actionLabel: "Create message link",
      icon: "mail-outline",
      actionable: true,
    };
  }
  if (identity.source_type === "keepr_pro") {
    return {
      key: "message_link",
      label: "Delivery: message link",
      body: `${identity.display_name || "This KeeprPro"} is known in Keepr but is not yet participating in Keepr Messages. Create a link that restores this exact conversation after they sign in.`,
      actionLabel: "Create message link",
      icon: "briefcase-outline",
      actionable: true,
    };
  }
  if (identity.user_id && (identity.source_type === "prior_conversation" || identity.source_type === "keepr_member")) {
    return {
      key: "message_link",
      label: "Delivery: message link",
      body: `${identity.display_name || "This Keepr member"} is not connected to this asset yet. Create a link that attaches them to this exact conversation after sign-in.`,
      actionLabel: "Create message link",
      icon: "people-outline",
      actionable: true,
    };
  }
  return {
    key: "message_link",
    label: "Delivery: message link",
    body: "Keepr will create the conversation now and give you a durable link to share anywhere.",
    actionLabel: "Create message link",
    icon: "information-circle-outline",
    actionable: true,
  };
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
  const [compactConversationOpen, setCompactConversationOpen] = useState(false);
  const [replyByThreadId, setReplyByThreadId] = useState({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStep, setComposerStep] = useState("context");
  const [assets, setAssets] = useState([]);
  const [systems, setSystems] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [attentionEvent, setAttentionEvent] = useState(null);
  const [threadMessagesById, setThreadMessagesById] = useState({});
  const [threadPageById, setThreadPageById] = useState({});
  const [threadLoading, setThreadLoading] = useState(false);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aboutQuery, setAboutQuery] = useState("");
  const [systemQuery, setSystemQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [identitySuggestions, setIdentitySuggestions] = useState([]);
  const [identityResolving, setIdentityResolving] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState(null);
  const [messageLinkResult, setMessageLinkResult] = useState(null);
  const toInputRef = useRef(null);
  const draftCacheRef = useRef(new Map());
  const [draft, setDraft] = useState({
    assetId: assetId || "",
    systemId: systemId || "",
    recipientId: "",
    mode: "review",
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

  const contextTitle = params.systemName || workspace.system?.name || params.assetName || workspace.asset?.name || "Keepr context";
  const contextSubtitle = isSystem
    ? `${params.assetName || workspace.asset?.name || "Parent asset"} · System`
    : "Asset";
  const selectedRecipient = selectedIdentity || recipients.find((recipient) => recipient.id === draft.recipientId) || null;
  const deliveryState = getDeliveryState(selectedIdentity);

  const refresh = useCallback(async ({ quiet = false, force = false } = {}) => {
    if (!quiet) setLoading(true);
    if (quiet) setRefreshing(true);
    try {
      const next = await loadMessageWorkspace({
        scope,
        assetId,
        kac,
        systemId,
        force,
      });
      setWorkspace(next);
      setSelectedThreadId((prev) => {
        if (initialThreadId && next.threads?.some((t) => t.id === initialThreadId)) {
          return initialThreadId;
        }
        if (prev && next.threads?.some((t) => t.id === prev)) return prev;
        return next.threads?.[0]?.id || null;
      });
      if (initialThreadId && next.threads?.some((t) => t.id === initialThreadId)) {
        setCompactConversationOpen(true);
      }

      const visibleAssets = mergeVisibleAssets(await loadAuthorizedAssets(), next.assets || [], next.threads.map((t) => t.asset));
      setAssets(visibleAssets);

      const effectiveAssetId = assetId || draft.assetId || next.asset?.id || "";
      const effectiveAsset = visibleAssets.find((a) => a.id === effectiveAssetId) || next.asset || null;
      if (effectiveAssetId) {
        const [systemRows, recipientRows] = await Promise.all([
          loadSystemsForAsset(effectiveAssetId, { userId: next.currentUserId, force }),
          loadEligibleRecipientsForAsset(effectiveAssetId, next.currentUserId, {
            hubId: effectiveAsset?.hub_id || null,
            force,
          }),
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
      setRefreshing(false);
    }
  }, [assetId, draft.assetId, initialThreadId, kac, scope, systemId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!params.launchComposer) return;
    setComposerOpen(true);
    setComposerStep(isGlobal ? "context" : "recipient");
  }, [params.launchComposer, assetId, systemId]);

  useEffect(() => {
    if (!composerOpen) return undefined;
    const timer = setTimeout(() => toInputRef.current?.focus?.(), 150);
    return () => clearTimeout(timer);
  }, [composerOpen]);

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
  const selectedMessages = selectedThread ? threadMessagesById[selectedThread.id] || [] : [];
  const selectedThreadWithMessages = selectedThread
    ? { ...selectedThread, messages: selectedMessages.length ? selectedMessages : selectedThread.messages || [] }
    : null;
  const selectedPendingMessageLink = useMemo(
    () => getPendingMessageLink(selectedThreadWithMessages, workspace.currentUserId),
    [selectedThreadWithMessages, workspace.currentUserId]
  );
  const showThreadList = !compact || !compactConversationOpen;
  const showConversation = !!selectedThreadWithMessages && (!compact || compactConversationOpen);

  const loadSelectedThreadMessages = useCallback(async ({ force = false } = {}) => {
    if (!selectedThread?.id) return;
    setThreadLoading(true);
    try {
      const result = await loadThreadMessages(selectedThread.id, { force });
      setThreadMessagesById((prev) => ({
        ...prev,
        [selectedThread.id]: result.messages || [],
      }));
      setThreadPageById((prev) => ({
        ...prev,
        [selectedThread.id]: {
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      }));
    } catch (e) {
      Alert.alert("Conversation unavailable", e?.message || "Could not load this conversation.");
    } finally {
      setThreadLoading(false);
    }
  }, [selectedThread?.id]);

  useEffect(() => {
    loadSelectedThreadMessages();
  }, [loadSelectedThreadMessages]);

  useEffect(() => {
    if (!workspace.currentUserId || !workspace.threads.length) return undefined;
    return createMessagesRealtimeSubscriptions({
      currentUserId: workspace.currentUserId,
      threads: workspace.threads,
      assetIds: assets.map((asset) => asset.id),
      selectedThreadId,
      onRefresh: async ({ quiet = true } = {}) => {
        await refresh({ quiet, force: true });
        if (selectedThreadId) await loadSelectedThreadMessages({ force: true });
      },
      onMessageReceived: ({ message, thread }) => {
        if (!shouldShowMessageAttention({ message, currentUserId: workspace.currentUserId, selectedThreadId })) {
          return;
        }
        const event = buildKeeprAttentionEvent({
          thread,
          message,
          senderLabel: thread?.participantLabel,
        });
        setAttentionEvent(event);
      },
    });
  }, [assets, loadSelectedThreadMessages, refresh, selectedThreadId, workspace.currentUserId, workspace.threads]);

  const handleLoadEarlier = async () => {
    if (!selectedThread?.id) return;
    const page = threadPageById[selectedThread.id] || {};
    if (!page.hasMore || !page.nextCursor) return;
    setEarlierLoading(true);
    try {
      const result = await loadThreadMessages(selectedThread.id, {
        before: page.nextCursor,
        force: true,
      });
      setThreadMessagesById((prev) => ({
        ...prev,
        [selectedThread.id]: [
          ...(result.messages || []),
          ...(prev[selectedThread.id] || []),
        ].filter((message, index, all) => all.findIndex((m) => m.id === message.id) === index),
      }));
      setThreadPageById((prev) => ({
        ...prev,
        [selectedThread.id]: {
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      }));
    } catch (e) {
      Alert.alert("Could not load earlier messages", e?.message || "Try again.");
    } finally {
      setEarlierLoading(false);
    }
  };

  const canOpenComposer = !!workspace.currentUserId && (isGlobal ? assets.length > 0 : !!assetId || !!draft.assetId);
  const canStart = !!workspace.currentUserId && (!!assetId || !!draft.assetId) && recipients.length > 0;
  const chosenAssetId = assetId || draft.assetId || "";
  const chosenSystemId = systemId || draft.systemId || "";
  const chosenAsset = assets.find((a) => a.id === chosenAssetId) || workspace.asset || null;
  const chosenSystem = systems.find((s) => s.id === chosenSystemId) || workspace.system || null;
  const launcherContextTitle = chosenSystem?.name || contextTitle;
  const launcherContextSubtitle = chosenSystem
    ? `${chosenAsset?.name || params.assetName || "Parent asset"} · System`
    : `${chosenAsset?.name || params.assetName || "Asset"} · Asset`;
  const breadcrumbText = chosenSystem?.name
    ? `${chosenAsset?.name || params.assetName || "Asset"} -> ${chosenSystem.name} -> New conversation`
    : `${chosenAsset?.name || params.assetName || "Keepr context"} -> New conversation`;
  const activeDraftKey = selectedIdentity?.identity_key
    ? [workspace.currentUserId || "anon", chosenAssetId || "_", chosenSystemId || "_", selectedIdentity.identity_key].join(":")
    : null;
  const filteredAssets = useMemo(() => {
    if (!isGlobal || chosenAssetId) return [];
    const query = aboutQuery.trim().toLowerCase();
    if (!query) return [];
    return assets
      .filter((asset) =>
        [asset.name, asset.kac_id, asset.asset_type, asset.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 8);
  }, [aboutQuery, assets, chosenAssetId, isGlobal]);
  const filteredSystems = useMemo(() => {
    if (!isGlobal || !chosenAssetId) return [];
    const query = systemQuery.trim().toLowerCase();
    if (!query) return [];
    return systems
      .filter((system) =>
        [system.name, system.manufacturer, system.model, system.location]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 8);
  }, [chosenAssetId, isGlobal, systemQuery, systems]);
  const matchingThreads = useMemo(
    () =>
      getMatchingOpenThreads(workspace.threads, {
        assetId: chosenAssetId,
        systemId: chosenSystemId || null,
        recipientId: draft.recipientId || selectedIdentity?.user_id || null,
      }),
    [chosenAssetId, chosenSystemId, draft.recipientId, selectedIdentity?.user_id, workspace.threads]
  );

  useEffect(() => {
    if (!composerOpen || !chosenAssetId) {
      setIdentitySuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIdentityResolving(true);
      try {
        const results = await resolveMessageIdentities({
          query: toQuery,
          assetId: chosenAssetId,
          systemId: chosenSystemId || null,
          hubId: chosenAsset?.hub_id || null,
          currentUserId: workspace.currentUserId,
          threads: workspace.threads,
          profilesById: workspace.profilesById,
          eligibleRecipients: recipients,
        });
        if (!cancelled) setIdentitySuggestions(results || []);
      } catch (e) {
        if (!cancelled) setIdentitySuggestions([]);
      } finally {
        if (!cancelled) setIdentityResolving(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    chosenAsset?.hub_id,
    chosenAssetId,
    chosenSystemId,
    composerOpen,
    recipients,
    toQuery,
    workspace.currentUserId,
    workspace.profilesById,
    workspace.threads,
  ]);

  useEffect(() => {
    if (!activeDraftKey) return;
    draftCacheRef.current.set(activeDraftKey, {
      subject: draft.subject,
      body: draft.body,
    });
  }, [activeDraftKey, draft.body, draft.subject]);

  useEffect(() => {
    if (!composerOpen || draft.mode === "new" || !selectedIdentity?.user_id) return;
    if (matchingThreads.length !== 1) return;
    handleContinueExisting(matchingThreads[0].id);
  }, [composerOpen, draft.mode, matchingThreads, selectedIdentity?.user_id]);

  const handleAssetChoice = async (nextAssetId) => {
    setDraft((prev) => ({ ...prev, assetId: nextAssetId, systemId: "", recipientId: "" }));
    setSelectedIdentity(null);
    setMessageLinkResult(null);
    setToQuery("");
    setAboutQuery("");
    setSystemQuery("");
    setComposerStep("recipient");
    const selectedAsset = assets.find((a) => a.id === nextAssetId) || null;
    const [systemRows, recipientRows] = await Promise.all([
      loadSystemsForAsset(nextAssetId),
      loadEligibleRecipientsForAsset(nextAssetId, workspace.currentUserId, {
        hubId: selectedAsset?.hub_id || null,
      }),
    ]);
    setSystems(systemRows);
    setRecipients(recipientRows);
  };

  const openLauncher = () => {
    setDraft((prev) => ({
      ...prev,
      assetId: assetId || "",
      systemId: systemId || "",
      recipientId: "",
      mode: "review",
      subject: params.systemName || params.assetName || workspace.system?.name || workspace.asset?.name || "",
      body: "",
    }));
    setSelectedIdentity(null);
    setMessageLinkResult(null);
    setToQuery("");
    setAboutQuery("");
    setSystemQuery("");
    setComposerStep(isGlobal ? "context" : "recipient");
    setComposerOpen(true);
  };

  const closeLauncher = () => {
    setComposerOpen(false);
    setComposerStep(isGlobal ? "context" : "recipient");
    setDraft((prev) => ({ ...prev, recipientId: "", mode: "review" }));
    setSelectedIdentity(null);
    setMessageLinkResult(null);
    setToQuery("");
    setAboutQuery("");
    setSystemQuery("");
    if (params.launchComposer && params.backRoute) {
      navigation.navigate(params.backRoute, params.backParams || {});
    }
  };

  const openTeamManagement = () => {
    navigation.navigate("Team");
  };

  const openInviteKeepr = () => {
    navigation.navigate("ShareKeepr");
  };

  const handleContinueExisting = (threadId) => {
    setSelectedThreadId(threadId);
    setCompactConversationOpen(true);
    setComposerOpen(false);
    setDraft((prev) => ({ ...prev, body: "", mode: "review" }));
    setSelectedIdentity(null);
    setToQuery("");
    setAboutQuery("");
    setSystemQuery("");
  };

  const selectIdentity = (identity) => {
    setSelectedIdentity(identity);
    setMessageLinkResult(null);
    setToQuery("");
    const key = identity?.identity_key
      ? [workspace.currentUserId || "anon", chosenAssetId || "_", chosenSystemId || "_", identity.identity_key].join(":")
      : null;
    const cachedDraft = key ? draftCacheRef.current.get(key) : null;
    setDraft((prev) => ({
      ...prev,
      recipientId: identity?.is_selectable && identity?.user_id ? identity.user_id : "",
      mode: "review",
      subject: cachedDraft?.subject || prev.subject || launcherContextTitle || "",
      body: cachedDraft?.body || prev.body || "",
    }));
  };

  const clearSelectedIdentity = () => {
    setSelectedIdentity(null);
    setMessageLinkResult(null);
    setDraft((prev) => ({ ...prev, recipientId: "", mode: "review" }));
    setTimeout(() => toInputRef.current?.focus?.(), 50);
  };

  const handleToSubmit = () => {
    const query = String(toQuery || "").trim();
    if (!query) return;
    const normalized = query.toLowerCase();
    const exactSelectable = identitySuggestions.find((identity) =>
      identity.is_selectable &&
      (
        String(identity.display_name || "").trim().toLowerCase() === normalized ||
        String(identity.email || "").trim().toLowerCase() === normalized
      )
    );
    if (exactSelectable) {
      selectIdentity(exactSelectable);
      return;
    }
    const exactAny = identitySuggestions.find((identity) =>
      String(identity.display_name || "").trim().toLowerCase() === normalized ||
      String(identity.email || "").trim().toLowerCase() === normalized ||
      String(identity.identity_key || "").toLowerCase() === `new_email:${normalized}`
    );
    if (exactAny) {
      selectIdentity(exactAny);
    }
  };

  const handleManualRefresh = async () => {
    await refresh({ quiet: true, force: true });
    await loadSelectedThreadMessages({ force: true });
  };

  const handleDeliveryAction = () => {
    if (!selectedIdentity || !deliveryState) return;
    if (deliveryState.key === "in_app") {
      handleCreateThread();
      return;
    }
    if (deliveryState.key === "message_link") {
      handleCreateMessageLink();
    }
  };

  const handleCreateThread = async () => {
    try {
      const chosenAsset = assets.find((a) => a.id === chosenAssetId) || workspace.asset || null;
      const finalSystemId = chosenSystemId || null;
      const chosenSystem = systems.find((s) => s.id === chosenSystemId) || workspace.system || null;
      const subject = draft.subject || chosenSystem?.name || chosenAsset?.name || "Keepr conversation";
      const thread = await createMemberThread({
        assetId: chosenAssetId,
        systemId: finalSystemId,
        keeprProId: params.keeprProId || null,
        hubId: chosenAsset?.hub_id || null,
        ownerId: chosenAsset?.owner_id || workspace.asset?.owner_id,
        recipientId: selectedIdentity?.user_id || draft.recipientId,
        subject,
        body: draft.body,
        resourceRef: params.canonicalResource || buildMessageResourceRef({
          parentAssetKac: params.kac || chosenAsset?.kac_id || workspace.asset?.kac_id || null,
          assetId: chosenAssetId,
          systemId: finalSystemId,
        }),
      });
      setDraft((prev) => ({ ...prev, body: "", subject: "", mode: "review" }));
      setComposerOpen(false);
      setComposerStep("context");
      await refresh({ quiet: true, force: true });
      if (thread?.id) {
        setSelectedThreadId(thread.id);
        setCompactConversationOpen(true);
        await loadThreadMessages(thread.id, { force: true }).then((result) => {
          setThreadMessagesById((prev) => ({ ...prev, [thread.id]: result.messages || [] }));
          setThreadPageById((prev) => ({
            ...prev,
            [thread.id]: { hasMore: result.hasMore, nextCursor: result.nextCursor },
          }));
        });
      }
    } catch (e) {
      Alert.alert("Could not start conversation", e?.message || "Try again.");
    }
  };

  const handleCreateMessageLink = async () => {
    try {
      const chosenAsset = assets.find((a) => a.id === chosenAssetId) || workspace.asset || null;
      const finalSystemId = chosenSystemId || null;
      const chosenSystem = systems.find((s) => s.id === chosenSystemId) || workspace.system || null;
      const subject = draft.subject || chosenSystem?.name || chosenAsset?.name || "Keepr conversation";
      const result = await createMessageLinkThread({
        assetId: chosenAssetId,
        systemId: finalSystemId,
        keeprProId: selectedIdentity?.keepr_pro_id || params.keeprProId || null,
        ownerId: chosenAsset?.owner_id || workspace.asset?.owner_id,
        recipient: selectedIdentity,
        subject,
        body: draft.body,
      });
      setMessageLinkResult(result);
      await refresh({ quiet: true, force: true });
      if (result?.thread_id) {
        setSelectedThreadId(result.thread_id);
        setCompactConversationOpen(true);
      }
    } catch (e) {
      Alert.alert("Could not create message link", e?.message || "Try again.");
    }
  };

  const copyMessageLink = async () => {
    if (!messageLinkResult?.copy_text) return;
    await Clipboard.setStringAsync(messageLinkResult.copy_text);
    Alert.alert("Copied", "Paste the message and link into text, Messenger, email, a contact form, or any other channel.");
  };

  const copyExistingMessageLink = async () => {
    if (!selectedThreadWithMessages?.id) return;
    try {
      const link = await getThreadMessageLink(selectedThreadWithMessages.id);
      if (link?.status === "revoked" || link?.status === "expired") {
        Alert.alert("Message link inactive", "Create a new link only if you intentionally want to rotate access for this same conversation.");
        return;
      }
      if (!link?.copy_text && !selectedPendingMessageLink?.url) {
        Alert.alert("Message link unavailable", "This conversation does not have a reusable pending link.");
        return;
      }
      await Clipboard.setStringAsync(
        link?.copy_text ||
          `${selectedThreadWithMessages.latestMessagePreview || ""}\n\nContinue the conversation in Keepr: ${selectedPendingMessageLink.url}`
      );
      Alert.alert("Copied", "This reused the original conversation link. No new conversation was created.");
    } catch (e) {
      Alert.alert("Could not copy link", e?.message || "Try again.");
    }
  };

  const rotateExistingMessageLink = async () => {
    if (!selectedThreadWithMessages?.id) return;
    try {
      const link = await rotateThreadMessageLink(selectedThreadWithMessages.id);
      if (!link?.copy_text) throw new Error("New link was not returned.");
      await Clipboard.setStringAsync(link.copy_text);
      await refresh({ quiet: true, force: true });
      Alert.alert("New link copied", "A new token was created for this same conversation.");
    } catch (e) {
      Alert.alert("Could not create new link", e?.message || "Try again.");
    }
  };

  const handleReply = async (threadId) => {
    try {
      await sendThreadReply(threadId, replyByThreadId[threadId]);
      setReplyByThreadId((prev) => ({ ...prev, [threadId]: "" }));
      await refresh({ quiet: true, force: true });
      await loadSelectedThreadMessages({ force: true });
    } catch (e) {
      Alert.alert("Could not reply", e?.message || "Try again.");
    }
  };

  const goBack = () => {
    if (composerOpen) {
      closeLauncher();
      return;
    }
    if (compact && compactConversationOpen) {
      setCompactConversationOpen(false);
      return;
    }
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
      <View style={[styles.shell, compact && styles.shellCompact]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goBack}>
            <Ionicons name="chevron-back-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.backText}>{compact && compactConversationOpen ? "Messages" : "Back"}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>MESSAGES</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              Conversations stay attached to the asset and system context that created them.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.newButton, !canOpenComposer && styles.newButtonQuiet]}
            onPress={openLauncher}
            disabled={!canOpenComposer}
          >
            <Ionicons name="create-outline" size={16} color={canOpenComposer ? "white" : colors.textMuted} />
            <Text style={[styles.newButtonText, !canOpenComposer && styles.newButtonTextQuiet]}>New conversation</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshButton} onPress={handleManualRefresh}>
            <Ionicons name="refresh-outline" size={17} color={colors.textPrimary} />
            <Text style={styles.refreshText}>{refreshing ? "Refreshing" : "Refresh"}</Text>
          </TouchableOpacity>
        </View>

        {attentionEvent ? (
          <View style={styles.attentionCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.attentionTitle}>{attentionEvent.title}</Text>
              <Text style={styles.attentionBody}>{attentionEvent.body}</Text>
            </View>
            <TouchableOpacity
              style={styles.attentionAction}
              onPress={() => {
                if (attentionEvent.threadId) setSelectedThreadId(attentionEvent.threadId);
                setAttentionEvent(null);
              }}
            >
              <Text style={styles.attentionActionText}>View</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attentionDismiss} onPress={() => setAttentionEvent(null)}>
              <Ionicons name="close-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

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
            <View style={styles.launcherHeader}>
              <View>
                <Text style={styles.cardTitle}>New conversation</Text>
                <Text style={styles.launcherCrumb}>
                  {breadcrumbText}
                </Text>
              </View>
              <TouchableOpacity style={styles.cancelButton} onPress={closeLauncher}>
                <Ionicons name="close-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={[styles.composerScroll, compact && styles.composerScrollCompact]}
              contentContainerStyle={styles.composerScrollContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <View style={styles.contextCard}>
                {params.contextImageUri ? (
                  <Image source={{ uri: params.contextImageUri }} style={styles.contextImage} />
                ) : (
                  <View style={styles.contextImageFallback}>
                    <Ionicons name={isSystem ? "construct-outline" : "cube-outline"} size={20} color={colors.primary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextKicker}>Message about</Text>
                  <Text style={styles.contextTitle} numberOfLines={1}>{launcherContextTitle}</Text>
                  <Text style={styles.contextSubtitle} numberOfLines={1}>{launcherContextSubtitle}</Text>
                </View>
              </View>
              {isGlobal ? (
                <>
                <Text style={styles.label}>About</Text>
                {chosenAssetId ? (
                  <View style={styles.selectedContextRow}>
                    <Text style={styles.selectedContextText} numberOfLines={1}>
                      {chosenSystem ? `${chosenSystem.name} · ${chosenAsset?.name || "Asset"}` : chosenAsset?.name || "Selected asset"}
                    </Text>
                    <TouchableOpacity
                      style={styles.changeContextButton}
                      onPress={() => {
                        setDraft((prev) => ({ ...prev, assetId: "", systemId: "", recipientId: "" }));
                        setSelectedIdentity(null);
                        setToQuery("");
                        setAboutQuery("");
                        setSystemQuery("");
                        setSystems([]);
                        setRecipients([]);
                      }}
                    >
                      <Text style={styles.changeContextText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={aboutQuery}
                      onChangeText={setAboutQuery}
                      placeholder="Search assets..."
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                    />
                    {aboutQuery.trim() ? (
                      <ScrollView
                        style={styles.searchResultBox}
                        contentContainerStyle={styles.searchResultsContent}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                      >
                        {filteredAssets.length ? filteredAssets.map((asset) => (
                          <TouchableOpacity key={asset.id} style={styles.searchResultRow} onPress={() => handleAssetChoice(asset.id)}>
                            <Ionicons name="cube-outline" size={17} color={colors.brandBlue} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.searchResultTitle} numberOfLines={1}>{asset.name}</Text>
                              <Text style={styles.searchResultMeta} numberOfLines={1}>{asset.kac_id || "Keepr asset"}</Text>
                            </View>
                          </TouchableOpacity>
                        )) : (
                          <Text style={styles.emptySmall}>No matching assets found.</Text>
                        )}
                      </ScrollView>
                    ) : null}
                  </>
                )}
              </>
              ) : null}

              {isGlobal && chosenAssetId ? (
                <>
                <Text style={styles.label}>Optional system</Text>
                {chosenSystem ? (
                  <View style={styles.selectedContextRow}>
                    <Text style={styles.selectedContextText} numberOfLines={1}>{chosenSystem.name}</Text>
                    <TouchableOpacity
                      style={styles.changeContextButton}
                      onPress={() => {
                        setDraft((prev) => ({ ...prev, systemId: "", recipientId: "" }));
                        setSelectedIdentity(null);
                        setToQuery("");
                        setSystemQuery("");
                      }}
                    >
                      <Text style={styles.changeContextText}>General</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={systemQuery}
                      onChangeText={setSystemQuery}
                      placeholder="Search systems, or leave as General..."
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                    />
                    {systemQuery.trim() ? (
                      <ScrollView
                        style={styles.searchResultBox}
                        contentContainerStyle={styles.searchResultsContent}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                      >
                        {filteredSystems.length ? filteredSystems.map((system) => (
                          <TouchableOpacity
                            key={system.id}
                            style={styles.searchResultRow}
                            onPress={() => {
                              setDraft((prev) => ({ ...prev, systemId: system.id, recipientId: "", subject: system.name }));
                              setSelectedIdentity(null);
                              setToQuery("");
                              setSystemQuery("");
                            }}
                          >
                            <Ionicons name="construct-outline" size={17} color={colors.brandBlue} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.searchResultTitle} numberOfLines={1}>{system.name}</Text>
                              <Text style={styles.searchResultMeta} numberOfLines={1}>System context</Text>
                            </View>
                          </TouchableOpacity>
                        )) : (
                          <Text style={styles.emptySmall}>No matching systems found. This can stay General.</Text>
                        )}
                      </ScrollView>
                    ) : null}
                  </>
                )}
              </>
              ) : null}

              {chosenAssetId ? (
                <>
                <Text style={styles.label}>To</Text>
                <View style={styles.toField}>
                  {selectedIdentity ? (
                    <View style={styles.recipientToken}>
                      <Text style={styles.recipientTokenText} numberOfLines={1}>
                        {selectedIdentity.display_name || selectedIdentity.email}
                      </Text>
                      <TouchableOpacity onPress={clearSelectedIdentity} style={styles.recipientRemove}>
                        <Ionicons name="close-outline" size={15} color={colors.brandBlue} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TextInput
                      ref={toInputRef}
                      value={toQuery}
                      onChangeText={setToQuery}
                      placeholder="Type a name or email address..."
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={handleToSubmit}
                      style={styles.toInput}
                    />
                  )}
                  {identityResolving ? <ActivityIndicator size="small" /> : null}
                </View>

                {!selectedIdentity ? (
                  <View style={styles.suggestionsBox}>
                    <Text style={styles.suggestionsTitle}>Suggested</Text>
                    {identitySuggestions.length ? (
                      <ScrollView
                        style={styles.suggestionsScroll}
                        contentContainerStyle={styles.suggestionsContent}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                      >
                        {identitySuggestions.map((identity) => (
                          <TouchableOpacity
                            key={identity.identity_key}
                            style={[styles.identityRow, !identity.is_selectable && styles.identityRowDisabled]}
                            onPress={() => selectIdentity(identity)}
                            activeOpacity={0.82}
                          >
                            {identity.avatar_url ? (
                              <Image source={{ uri: identity.avatar_url }} style={styles.identityAvatar} />
                            ) : (
                              <View style={styles.identityAvatarFallback}>
                                <Ionicons
                                  name={identity.source_type === "keepr_pro" ? "briefcase-outline" : identity.source_type === "new_email" ? "mail-outline" : "person-outline"}
                                  size={17}
                                  color={identity.is_selectable ? colors.brandBlue : colors.textMuted}
                                />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.identityName, !identity.is_selectable && styles.identityNameDisabled]} numberOfLines={1}>
                                {identity.display_name || identity.email}
                              </Text>
                              <Text style={styles.identityMeta} numberOfLines={1}>
                                {identity.relationship_label}
                                {identity.organization_name && identity.organization_name !== identity.display_name ? ` · ${identity.organization_name}` : ""}
                              </Text>
                              {identity.context_relevance ? (
                                <Text style={styles.identityWhy} numberOfLines={1}>{identity.context_relevance}</Text>
                              ) : null}
                            </View>
                            {identity.is_selectable ? (
                              <Ionicons name="add-circle-outline" size={19} color={colors.brandBlue} />
                            ) : (
                              <Ionicons name="information-circle-outline" size={19} color={colors.textMuted} />
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    ) : (
                      <View style={styles.noRecipientCard}>
                        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.noRecipientTitle}>No connected Keepr identity found.</Text>
                          <Text style={styles.noRecipientText}>
                            {toQuery && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toQuery.trim())
                              ? "External email messaging will be enabled in the next communication phase."
                              : "Search by name or email. Connected team members can receive in-app messages now."}
                          </Text>
                          <View style={styles.emptyActionRow}>
                            <TouchableOpacity style={styles.emptyPrimaryAction} onPress={openTeamManagement}>
                              <Ionicons name="people-outline" size={15} color="white" />
                              <Text style={styles.emptyPrimaryActionText}>Add Team member</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.emptySecondaryAction} onPress={openInviteKeepr}>
                              <Ionicons name="mail-outline" size={15} color={colors.brandBlue} />
                              <Text style={styles.emptySecondaryActionText}>Invite someone</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                ) : null}
                {selectedIdentity && !selectedIdentity.is_selectable ? (
                  <View style={styles.recipientUnavailableCard}>
                    <Ionicons name="information-circle-outline" size={17} color={colors.textMuted} />
                    <Text style={styles.recipientUnavailableText}>
                      {deliveryState?.key === "known_member_not_authorized"
                        ? `${selectedIdentity.display_name || "This person"} is not connected to this asset yet.`
                        : deliveryState?.body || "This recipient is not available for in-app messaging yet."}
                    </Text>
                  </View>
                ) : null}
              </>
              ) : null}

              {selectedIdentity?.user_id && matchingThreads.length > 1 ? (
                <>
                <Text style={styles.label}>Open conversation</Text>
                <View style={styles.matchList}>
                  {matchingThreads.slice(0, 5).map((thread) => (
                    <TouchableOpacity key={thread.id} style={styles.matchRow} onPress={() => handleContinueExisting(thread.id)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.matchTitle}>{contextLabel(thread)}</Text>
                        <Text style={styles.matchPreview} numberOfLines={1}>
                          {thread.latestMessagePreview || (thread.messages || [])[Math.max((thread.messages || []).length - 1, 0)]?.body || thread.subject || "Open conversation"}
                        </Text>
                        <Text style={styles.timeText}>{formatMessageTime(thread.updated_at || thread.created_at)}</Text>
                      </View>
                      <Text style={styles.matchAction}>Open</Text>
                    </TouchableOpacity>
                  ))}
                  {draft.recipientId && draft.mode !== "new" ? (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => {
                        setDraft((prev) => ({ ...prev, mode: "new" }));
                        setComposerStep("message");
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Start a new conversation</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
              ) : null}

              {selectedIdentity && messageLinkResult ? (
                <View style={styles.messageLinkCard}>
                  <View style={styles.messageLinkIcon}>
                    <Ionicons name="link-outline" size={20} color={colors.brandBlue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.messageLinkTitle}>Conversation link created</Text>
                    <Text style={styles.messageLinkBody}>
                      Copy the message and link, then paste it into text, Messenger, email, a contact form, or any other messaging surface.
                    </Text>
                    <Text style={styles.messageLinkUrl} numberOfLines={1}>
                      {messageLinkResult.link_url}
                    </Text>
                    <TouchableOpacity style={styles.copyLinkButton} onPress={copyMessageLink}>
                      <Ionicons name="copy-outline" size={16} color="white" />
                      <Text style={styles.copyLinkText}>Copy message and link</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {selectedIdentity && !messageLinkResult && (!selectedIdentity.user_id || matchingThreads.length === 0 || draft.mode === "new" || composerStep === "message") ? (
                <View style={styles.messageComposerCard}>
                <TextInput
                  value={draft.body}
                  onChangeText={(body) => setDraft((prev) => ({ ...prev, body }))}
                  placeholder={`Message ${selectedRecipient?.display_name || selectedRecipient?.label || selectedRecipient?.email || "recipient"}...`}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, styles.textArea]}
                />
                {deliveryState && deliveryState.key !== "in_app" ? (
                  <View style={styles.deliveryCard}>
                    <Ionicons name={deliveryState.icon} size={18} color={deliveryState.key === "in_app" ? colors.brandBlue : colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deliveryTitle}>{deliveryState.label}</Text>
                      <Text style={styles.deliveryBody}>{deliveryState.body}</Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.composerActions}>
                  <TouchableOpacity style={styles.cancelInlineButton} onPress={closeLauncher}>
                    <Text style={styles.cancelInlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      styles.primaryButtonInline,
                      (!deliveryState?.actionable || !draft.body.trim()) && styles.primaryButtonDisabled,
                    ]}
                    onPress={handleDeliveryAction}
                    disabled={!deliveryState?.actionable || !draft.body.trim()}
                  >
                    <Text style={styles.primaryButtonText}>{deliveryState?.actionLabel || "Send message"}</Text>
                  </TouchableOpacity>
                </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        {!composerOpen ? (
          loading ? (
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
            {showThreadList ? (
            <ScrollView style={[styles.threadPane, compact && styles.threadPaneCompact]} contentContainerStyle={styles.threadPaneContent}>
              {groups.map((group) => (
                <View key={group.assetId || "unknown"} style={styles.groupBlock}>
                  <Text style={styles.groupTitle}>{group.assetName}</Text>
                  {group.threads.map((thread) => (
                    <TouchableOpacity
                      key={thread.id}
                      style={[styles.threadRow, selectedThread?.id === thread.id && styles.threadRowActive]}
                      onPress={() => {
                        setSelectedThreadId(thread.id);
                        setCompactConversationOpen(true);
                      }}
                    >
                      <View style={styles.threadTopLine}>
                        <Text style={styles.threadContext} numberOfLines={1}>{contextLabel(thread)}</Text>
                        <View style={[styles.statusPill, statusStyle(thread.attentionState)]}>
                          <Text style={styles.statusText}>{thread.attentionState}</Text>
                        </View>
                      </View>
                      <Text style={styles.participant} numberOfLines={1}>{thread.participantLabel}</Text>
                      <Text style={styles.preview} numberOfLines={1}>{thread.latestMessagePreview || "No messages yet"}</Text>
                      <Text style={styles.timeText}>{formatMessageTime(thread.updated_at || thread.created_at)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            ) : null}

            {showConversation ? (
            <ScrollView
              style={[styles.conversationPane, compact && styles.conversationPaneCompact]}
              contentContainerStyle={[styles.conversationContent, compact && styles.conversationContentCompact]}
            >
              {selectedThreadWithMessages ? (
                <>
                  <View style={styles.conversationHeader}>
                    <Text style={styles.conversationTitle}>{contextLabel(selectedThreadWithMessages)}</Text>
                    <Text style={styles.conversationSubtitle}>
                      {selectedThreadWithMessages.asset?.name || "Asset"}
                      {selectedThreadWithMessages.system?.name ? ` · ${selectedThreadWithMessages.system.name}` : ""}
                      {selectedThreadWithMessages.keeprPro?.name ? ` · ${selectedThreadWithMessages.keeprPro.name}` : ""}
                    </Text>
                    <Text style={styles.sourceText}>
                      {selectedThreadWithMessages.participantLabel} · {sourceLabel(selectedThreadWithMessages)}
                    </Text>
                    {selectedPendingMessageLink ? (
                      <View style={styles.pendingLinkActionRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pendingLinkTitle}>
                            {selectedPendingMessageLink.status === "pending"
                              ? `Waiting for ${selectedPendingMessageLink.recipientName} to join`
                              : "Message link is no longer active"}
                          </Text>
                          <Text style={styles.pendingLinkBody}>
                            {selectedPendingMessageLink.status === "pending"
                              ? "This conversation already has a reusable message link."
                              : "Create a new link only if you intentionally want to rotate access for this same conversation."}
                          </Text>
                        </View>
                        {selectedPendingMessageLink.status === "pending" ? (
                          <TouchableOpacity style={styles.pendingLinkButton} onPress={copyExistingMessageLink}>
                            <Ionicons name="copy-outline" size={15} color={colors.brandBlue} />
                            <Text style={styles.pendingLinkButtonText}>Copy message link</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={styles.pendingLinkButton} onPress={rotateExistingMessageLink}>
                            <Ionicons name="refresh-outline" size={15} color={colors.brandBlue} />
                            <Text style={styles.pendingLinkButtonText}>Create new link</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : null}
                  </View>

                  {threadLoading && !selectedMessages.length ? (
                    <View style={styles.threadLoading}>
                      <ActivityIndicator />
                      <Text style={styles.emptySmall}>Loading conversation...</Text>
                    </View>
                  ) : null}

                  {threadPageById[selectedThreadWithMessages.id]?.hasMore ? (
                    <TouchableOpacity
                      style={styles.loadEarlierButton}
                      onPress={handleLoadEarlier}
                      disabled={earlierLoading}
                    >
                      {earlierLoading ? <ActivityIndicator size="small" /> : null}
                      <Text style={styles.loadEarlierText}>
                        {earlierLoading ? "Loading earlier..." : "Load earlier messages"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {(selectedThreadWithMessages.messages || []).map((m) => {
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
                      value={replyByThreadId[selectedThreadWithMessages.id] || ""}
                      onChangeText={(txt) => setReplyByThreadId((prev) => ({ ...prev, [selectedThreadWithMessages.id]: txt }))}
                      placeholder="Write a reply..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                      style={styles.replyBox}
                    />
                    <TouchableOpacity style={styles.replyButton} onPress={() => handleReply(selectedThreadWithMessages.id)}>
                      <Ionicons name="send-outline" size={16} color="white" />
                      <Text style={styles.replyButtonText}>Reply</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </ScrollView>
            ) : null}
            </View>
          )
        ) : null}
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
  shellCompact: {
    paddingBottom: 104,
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
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  refreshText: { color: colors.textPrimary, fontSize: 12, fontWeight: "900" },
  attentionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  attentionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  attentionBody: { marginTop: 2, color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  attentionAction: {
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  attentionActionText: { color: "white", fontSize: 12, fontWeight: "900" },
  attentionDismiss: { padding: 4 },
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
  composerScroll: {
    maxHeight: 640,
  },
  composerScrollCompact: {
    maxHeight: 560,
  },
  composerScrollContent: {
    paddingBottom: spacing.md,
  },
  launcherHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  launcherCrumb: { marginTop: 4, fontSize: 12, color: colors.textMuted, fontWeight: "800" },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  cancelButtonText: { fontSize: 12, color: colors.textSecondary, fontWeight: "900" },
  helperText: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.textSecondary, fontWeight: "700" },
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
  searchResultBox: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.xs,
    maxHeight: 260,
    ...shadows.subtle,
  },
  searchResultsContent: { gap: 6, paddingBottom: 2 },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  searchResultTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  searchResultMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  selectedContextRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  selectedContextText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  changeContextButton: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  changeContextText: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  contextCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#F8FBFF",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  contextImage: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  contextImageFallback: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  contextKicker: { fontSize: 11, fontWeight: "900", color: colors.brandBlue, textTransform: "uppercase" },
  contextTitle: { marginTop: 2, fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  contextSubtitle: { marginTop: 2, fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  noRecipientCard: {
    flexDirection: "row",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noRecipientTitle: { fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  noRecipientText: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: "700", color: colors.textSecondary },
  toField: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  toInput: {
    flex: 1,
    minHeight: 34,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
  },
  recipientToken: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    paddingLeft: 12,
    paddingRight: 7,
    paddingVertical: 7,
  },
  recipientTokenText: { color: colors.brandBlue, fontSize: 13, fontWeight: "900" },
  recipientRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  recipientUnavailableCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  recipientUnavailableText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  suggestionsBox: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: 6,
  },
  suggestionsScroll: {
    maxHeight: 280,
  },
  suggestionsContent: {
    gap: 6,
    paddingBottom: 2,
  },
  suggestionsTitle: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  identityRowDisabled: { opacity: 0.82 },
  identityAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
  },
  identityAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  identityName: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  identityNameDisabled: { color: colors.textSecondary },
  identityMeta: { marginTop: 2, color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  identityWhy: { marginTop: 2, color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  identityDisabledReason: { marginTop: 3, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  emptyActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emptyPrimaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  emptyPrimaryActionText: { color: "white", fontSize: 12, fontWeight: "900" },
  emptySecondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  emptySecondaryActionText: { color: colors.brandBlue, fontSize: 12, fontWeight: "900" },
  matchList: { gap: 8 },
  matchNotice: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    backgroundColor: "#F8FBFF",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  matchTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  matchPreview: { marginTop: 3, color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  matchAction: { color: colors.brandBlue, fontSize: 12, fontWeight: "900" },
  openConversationButton: {
    borderRadius: radius.pill,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButton: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryButtonDisabled: { opacity: 0.55 },
  secondaryButtonText: { color: colors.brandBlue, fontWeight: "900" },
  primaryButton: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    paddingVertical: 13,
  },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: "white", fontWeight: "900" },
  primaryButtonInline: { marginTop: 0, paddingHorizontal: 18 },
  messageComposerCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  messageLinkCard: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#F0F7FF",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.22)",
  },
  messageLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
  },
  messageLinkTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  messageLinkBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  messageLinkUrl: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: "800",
    color: colors.brandBlue,
  },
  copyLinkButton: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  copyLinkText: { color: "white", fontSize: 13, fontWeight: "900" },
  composeSummary: { fontSize: 13, color: colors.textPrimary, fontWeight: "900" },
  deliveryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#F8FBFF",
    padding: spacing.md,
    marginTop: spacing.md,
  },
  deliveryTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  deliveryBody: { marginTop: 3, color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  sendDisabledHint: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "right",
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelInlineButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelInlineText: { color: colors.textSecondary, fontWeight: "900" },
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
  conversationContentCompact: { paddingBottom: 118 },
  conversationHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
  },
  conversationTitle: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  conversationSubtitle: { marginTop: 4, fontSize: 13, fontWeight: "800", color: colors.textSecondary },
  sourceText: { marginTop: 5, fontSize: 12, fontWeight: "800", color: colors.textMuted },
  pendingLinkActionRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: spacing.sm,
  },
  pendingLinkTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: "900" },
  pendingLinkBody: { marginTop: 2, color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  pendingLinkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pendingLinkButtonText: { color: colors.brandBlue, fontSize: 12, fontWeight: "900" },
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
