import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useWorkspace } from "../context/WorkspaceContext";
import {
  formatMessageTime,
  loadKeeprProStewardshipThread,
  loadMessageWorkspace,
  loadThreadMessages,
  refreshThreadSummary,
  sendKeeprProStewardshipThreadReply,
} from "../lib/messagesService";
import { fetchAssetHeroUris } from "../lib/assetHeroResolver";
import { getKeeprSpacePortfolio } from "../lib/keeprspaceApi";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

const FALLBACK_BOAT = require("../assets/boats/boat_bennington_hero.jpg");

function compact(parts, separator = " · ") {
  return parts.filter(Boolean).join(separator);
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString();
}

function displayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function cleanName(value, fallback = "Customer") {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "member") return fallback;
  return text;
}

function portfolioItemsFromResult(result) {
  return result?.boats || result?.items || result?.assets || result?.portfolio || [];
}

function messagePreview(thread) {
  return String(thread?.latestMessagePreview || thread?.latestMessage?.body || "No messages yet").trim();
}

function hasMessageActivity(thread) {
  const preview = String(thread?.latestMessagePreview || thread?.latest_message || "").trim().toLowerCase();
  return Boolean(
    thread?.latestMessage?.body ||
    (preview && preview !== "no messages yet") ||
    thread?.summaryMessages?.length ||
    thread?.messages?.length
  );
}

function threadActivityAt(thread) {
  return thread?.latestMessage?.created_at || thread?.updated_at || thread?.created_at || null;
}

function projectionAsset(projection) {
  return projection?.asset || projection || {};
}

function threadBoatLabel(thread, portfolioItems = []) {
  const asset = thread?.asset || {};
  const projection = findThreadAssetProjection(thread, portfolioItems);
  const projectedAsset = projectionAsset(projection);
  const identity = projectedAsset.identity || {};
  const yearMakeModel = compact([
    projectedAsset.year || identity.year,
    projectedAsset.make || identity.make,
    projectedAsset.model || identity.model,
  ]);
  const assetName =
    projectedAsset.asset_name ||
    projectedAsset.name ||
    (asset.name && asset.name !== "Asset" ? asset.name : null);
  return compact([assetName, yearMakeModel]) || thread?.subject || "Boat";
}

function inferRelationshipType(thread) {
  const ref = thread?.resource_ref || {};
  return (
    ref.relationship_type ||
    ref.relationship_purpose ||
    thread?.source_type?.replace(/[_-]+/g, " ") ||
    "Service"
  );
}

function findThreadAssetProjection(thread, portfolioItems = []) {
  const assetId = thread?.asset_id || thread?.asset?.id || null;
  if (!assetId) return null;
  return portfolioItems.find((item) => String(item?.asset?.id || item?.asset_id || item?.id) === String(assetId)) || null;
}

function assetIdForThread(thread) {
  return (
    thread?.asset_id ||
    thread?.asset?.id ||
    thread?.resource_ref?.asset_id ||
    thread?.resource_ref?.parent_asset_id ||
    null
  );
}

function mergeThreadCollections(...collections) {
  const byId = new Map();
  collections.flat().filter(Boolean).forEach((thread) => {
    if (!thread?.id) return;
    byId.set(thread.id, { ...(byId.get(thread.id) || {}), ...thread });
  });
  return Array.from(byId.values());
}

function heroForThread(thread, portfolioItems = []) {
  const projection = findThreadAssetProjection(thread, portfolioItems);
  const asset = projectionAsset(projection);
  return (
    projection?.heroUrl ||
    projection?.hero_uri ||
    asset.heroUrl ||
    asset.hero_image_url ||
    asset.hero_thumb_url ||
    thread?.asset?.hero_image_url ||
    null
  );
}

function buildContext(thread, portfolioItems = [], workspaceName = "Wilson Marine") {
  const projection = findThreadAssetProjection(thread, portfolioItems);
  const relationship = projection?.relationship || projection?.service_relationship || projection?.dealer_relationship || {};
  const provider =
    projection?.organization?.name ||
    projection?.organization_name ||
    projection?.keepr_pro?.name ||
    workspaceName;
  const assigned =
    relationship.assigned_staff_name ||
    relationship.assigned_to_name ||
    relationship.advisor_name ||
    thread?.providerPersonName ||
    thread?.resource_ref?.assigned_to ||
    (thread?.latestMessage?.sender_type === "keepr_pro" ? thread?.latestMessage?.sender_name : null) ||
    "Team";
  const type =
    relationship.relationship_purpose ||
    relationship.relationship_type ||
    thread?.relationship_type ||
    inferRelationshipType(thread);
  const status = relationship.status || thread?.status || "active";
  return {
    assigned,
    provider,
    type,
    status,
    line: compact([assigned, provider, String(type || "").replace(/\b\w/g, (m) => m.toUpperCase())]),
  };
}

function getPersonName(thread, profilesById = {}, perspective = "keepr_pro") {
  const latest = thread?.latestMessage || {};
  if (perspective === "keepr_pro") {
    if (thread?.customerName) return cleanName(thread.customerName, "Customer");
    if (latest.sender_type !== "keepr_pro") {
      return cleanName(latest.sender_name || profilesById[latest.from_user_id]?.display_name || profilesById[latest.from_user_id]?.full_name, "Customer");
    }
    return cleanName(thread?.ownerDisplayName || thread?.asset?.owner_display_name || "Andy Drake", "Customer");
  }
  return cleanName(thread?.participantLabel || latest.sender_name, "Participant");
}

function providerParticipantLabel(thread, context) {
  const latestProviderMessage = [...(thread?.messages || [])]
    .reverse()
    .find((message) => message?.sender_type === "keepr_pro" && message?.sender_name);
  return cleanName(thread?.providerPersonName || latestProviderMessage?.sender_name || context?.assigned || context?.provider, "Team");
}

function threadFromRecentMessage(item) {
  const latestMessage = item.latest_message
    ? {
        id: `${item.id || item.thread_id}-latest`,
        thread_id: item.thread_id || item.id,
        body: item.latest_message,
        created_at: item.latest_message_at || item.updated_at,
        sender_type: item.sender_type,
        sender_name: item.sender_name,
      }
    : null;
  return {
    id: item.thread_id || item.id,
    asset_id: item.asset_id,
    subject: item.subject || item.asset_name || "Conversation",
    status: item.status || "open",
    source_type: item.relationship_type || "keeprpro_stewardship",
    updated_at: item.latest_message_at || item.updated_at,
    asset: {
      id: item.asset_id,
      name: item.asset_name,
      kac_id: item.kac_id,
    },
    relationship_type: item.relationship_type,
    customerName: item.customer_name || item.owner_name || (item.sender_type !== "keepr_pro" ? item.sender_name : null),
    providerPersonName: item.sender_type === "keepr_pro" ? item.sender_name : null,
    latestMessage,
    latestMessagePreview: item.latest_message || "No messages yet",
    messages: [],
    summaryMessages: latestMessage ? [latestMessage] : [],
    attentionState: item.sender_type === "keepr_pro" ? "open" : "new inbound",
  };
}

function MessageRow({ thread, selected, profilesById, portfolioItems, heroUrl, context, onPress }) {
  const personName = getPersonName(thread, profilesById);
  const unread = thread?.attentionState && !["open", "read"].includes(String(thread.attentionState).toLowerCase());
  return (
    <TouchableOpacity
      style={[styles.threadRow, selected && styles.threadRowSelected]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <View style={[styles.unreadDot, unread && styles.unreadDotActive]} />
      <Image source={heroUrl ? { uri: heroUrl } : FALLBACK_BOAT} style={styles.threadThumb} resizeMode="cover" />
      <View style={styles.threadText}>
        <View style={styles.threadTop}>
          <Text style={styles.threadPerson} numberOfLines={1}>{personName}</Text>
          <Text style={styles.threadTime}>{shortDate(threadActivityAt(thread))}</Text>
        </View>
        <Text style={styles.threadBoat} numberOfLines={1}>{threadBoatLabel(thread, portfolioItems)}</Text>
        <Text style={styles.threadPreview} numberOfLines={1}>{messagePreview(thread)}</Text>
        <Text style={styles.threadContext} numberOfLines={1}>{context.line}</Text>
      </View>
      {unread ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>1</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MessagesWithDates({ messages, currentUserId, profilesById, ownerName, providerName }) {
  let lastKey = "";
  return (
    <View style={styles.messageList}>
      {messages.map((message) => {
        const key = dateKey(message.created_at);
        const showDate = key && key !== lastKey;
        lastKey = key || lastKey;
        const mine = message?.sender_type === "keepr_pro";
        const label = mine
          ? cleanName(message.sender_name, providerName || "Wilson Marine")
          : cleanName(message.sender_name || profilesById[message.from_user_id]?.display_name, ownerName);
        return (
          <React.Fragment key={message.id}>
            {showDate ? (
              <View style={styles.dateSeparator}>
                <View style={styles.dateLine} />
                <Text style={styles.dateText}>{displayDate(message.created_at)}</Text>
                <View style={styles.dateLine} />
              </View>
            ) : null}
            <View style={[styles.chatRow, mine && styles.chatRowMine]}>
              <View style={[styles.avatar, mine && styles.avatarMine]}>
                <Text style={[styles.avatarText, mine && styles.avatarTextMine]}>{String(label || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                <Text style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}>
                  {label}{message.created_at ? ` · ${formatMessageTime(message.created_at)}` : ""}
                </Text>
                <Text style={[styles.bubbleBody, mine && styles.bubbleBodyMine]}>{message.body}</Text>
              </View>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export default function KeeprSpaceMessagesScreen({ navigation, route }) {
  const { currentWorkspace } = useWorkspace();
  const organizationId =
    route?.params?.organizationId ||
    currentWorkspace?.organization_id ||
    currentWorkspace?.org_id ||
    null;
  const workspaceId = route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null);
  const workspaceName =
    currentWorkspace?.display_name ||
    currentWorkspace?.name ||
    currentWorkspace?.label ||
    "Wilson Marine";
  const initialThreadId = route?.params?.threadId || null;
  const backAssetId = route?.params?.assetId || null;
  const backKac = route?.params?.kac || null;
  const backStewardshipId = route?.params?.stewardshipId || null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workspace, setWorkspace] = useState({ currentUserId: null, threads: [], profilesById: {} });
  const [portfolioItems, setPortfolioItems] = useState([]);
  const [heroUrls, setHeroUrls] = useState({});
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyByThreadId, setReplyByThreadId] = useState({});
  const [pendingAttachmentsByThreadId, setPendingAttachmentsByThreadId] = useState({});
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    const scopedThreads = (workspace.threads || []).filter(hasMessageActivity);
    const filtered = scopedThreads.filter((thread) => {
      const attention = String(thread?.attentionState || thread?.status || "").toLowerCase();
      if (filter === "unread") return attention && !["open", "read", "active"].includes(attention);
      if (filter === "attention") return ["new", "new inbound", "owner responded", "needs_attention", "needs attention", "unread"].includes(attention);
      return true;
    });
    const sorted = [...filtered].sort((a, b) => new Date(threadActivityAt(b) || 0) - new Date(threadActivityAt(a) || 0));
    if (!query) return sorted;
    return sorted.filter((thread) => {
      const haystack = [
        getPersonName(thread, workspace.profilesById),
        threadBoatLabel(thread, portfolioItems),
        messagePreview(thread),
        buildContext(thread, portfolioItems, workspaceName).line,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, portfolioItems, search, workspace.profilesById, workspace.threads, workspaceName]);

  const selectedThread = useMemo(
    () =>
      (workspace.threads || []).find((thread) => thread.id === selectedThreadId) ||
      null,
    [selectedThreadId, workspace.threads]
  );
  const selectedThreadIdStable = selectedThread?.id || null;
  const selectedAssetId = selectedThread ? assetIdForThread(selectedThread) : null;

  const selectedContext = selectedThread ? buildContext(selectedThread, portfolioItems, workspaceName) : null;
  const selectedHeroUrl = selectedThread
    ? heroUrls[assetIdForThread(selectedThread)] || heroForThread(selectedThread, portfolioItems)
    : null;
  const selectedProjection = selectedThread ? findThreadAssetProjection(selectedThread, portfolioItems) : null;
  const selectedOwnerName = selectedThread
    ? cleanName(
        selectedThread.customerName ||
        selectedThread.ownerDisplayName ||
          projectionAsset(selectedProjection)?.owner_display_name ||
          selectedProjection?.owner_display_name ||
          selectedProjection?.owner?.display_name ||
          "Andy Drake",
        "Customer"
      )
    : "Customer";
  const selectedProviderPerson = selectedThread
    ? providerParticipantLabel(selectedThread, selectedContext)
    : "Team";
  const selectedKac = selectedThread?.asset?.kac_id || projectionAsset(selectedProjection)?.kac_id || null;
  const selectedAssetName = selectedThread ? threadBoatLabel(selectedThread, portfolioItems) : null;
  const selectedInlineMessages = selectedThread?.messages || [];
  const selectedSummaryMessages = selectedThread?.summaryMessages || [];

  const load = useCallback(async ({ quiet = false, force = false } = {}) => {
    if (!quiet) setLoading(true);
    if (quiet) setRefreshing(true);
    try {
      const [messagesResult, portfolioResult, directThread] = await Promise.all([
        loadMessageWorkspace({ scope: "global", force, pageSize: 100 }),
        organizationId ? getKeeprSpacePortfolio({ organizationId }) : Promise.resolve(null),
        initialThreadId ? refreshThreadSummary(initialThreadId).catch(() => null) : Promise.resolve(null),
      ]);
      const items = portfolioItemsFromResult(portfolioResult);
      const recentMessageThreads = (portfolioResult?.recent_messages || [])
        .map(threadFromRecentMessage)
        .filter((thread) => thread?.id);
      const directAssetId = assetIdForThread(directThread) || route?.params?.assetId || null;
      const directProjection = directAssetId
        ? items.find((item) => String(item?.asset?.id || item?.asset_id || item?.id) === String(directAssetId))
        : null;
      const directProjectionAsset = projectionAsset(directProjection);
      const stewardshipThreadResult =
        initialThreadId && (route?.params?.assetId || route?.params?.kac || directAssetId) && organizationId
          ? await loadKeeprProStewardshipThread({
              assetId: route?.params?.assetId || directAssetId || null,
              kac: route?.params?.kac || directProjectionAsset?.kac_id || null,
              organizationId,
              threadId: initialThreadId,
              assetName:
                route?.params?.assetName ||
                directProjectionAsset?.asset_name ||
                directProjectionAsset?.name ||
                null,
              providerName: workspaceName,
              ownerName:
                route?.params?.ownerName ||
                directProjectionAsset?.owner_display_name ||
                directProjection?.owner_display_name ||
                directProjection?.owner?.display_name ||
                null,
            }).catch(() => null)
          : null;
      const directThreadHydrated = directThread
        ? {
            ...directThread,
            asset: directThread.asset || directProjectionAsset || null,
            subject:
              directThread.subject ||
              directProjectionAsset?.asset_name ||
              directProjectionAsset?.name ||
              route?.params?.assetName ||
              null,
            ownerDisplayName:
              directThread.ownerDisplayName ||
              directProjectionAsset?.owner_display_name ||
              directProjection?.owner_display_name ||
              directProjection?.owner?.display_name ||
              null,
          }
        : null;
      const mergedThreads = mergeThreadCollections(
        messagesResult.threads || [],
        recentMessageThreads,
        directThreadHydrated ? [directThreadHydrated] : [],
        stewardshipThreadResult?.threads || []
      );
      setPortfolioItems(items);
      setWorkspace({
        ...messagesResult,
        currentUserId: messagesResult.currentUserId || stewardshipThreadResult?.currentUserId || null,
        profilesById: {
          ...(messagesResult.profilesById || {}),
          ...(stewardshipThreadResult?.profilesById || {}),
        },
        threads: mergedThreads,
      });
      setSelectedThreadId((prev) => {
        if (prev && mergedThreads.some((thread) => thread.id === prev)) return prev;
        if (initialThreadId && mergedThreads.some((thread) => thread.id === initialThreadId)) return initialThreadId;
        return null;
      });
    } catch (error) {
      console.warn("KeeprSpace messages unavailable:", error?.message || error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialThreadId, organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load({ quiet: true, force: true });
    }, [load])
  );

  useEffect(() => {
    let active = true;
    const assetIds = Array.from(new Set((workspace.threads || [])
      .map((thread) => assetIdForThread(thread))
      .filter(Boolean)));
    if (!assetIds.length) {
      return () => {
        active = false;
      };
    }

    fetchAssetHeroUris(assetIds, { transform: { width: 320, quality: 78 }, expiresIn: 60 * 60 * 24 })
      .then((urls) => {
        if (active && urls) {
          setHeroUrls((prev) => ({ ...prev, ...urls }));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [
    [
      ...visibleThreads.map((thread) => assetIdForThread(thread)),
      selectedAssetId,
    ].filter(Boolean).join("|"),
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadThread() {
      if (!selectedThreadIdStable) {
        setThreadMessages([]);
        setThreadLoading(false);
        return;
      }
      if (selectedAssetId && organizationId) {
        setThreadLoading(true);
        try {
          const result = await loadKeeprProStewardshipThread({
            assetId: selectedAssetId,
            kac: selectedKac,
            organizationId,
            threadId: selectedThreadIdStable,
            assetName: selectedAssetName,
            providerName: workspaceName,
            ownerName: selectedOwnerName,
          });
          const hydrated = result?.threads?.[0];
          if (!cancelled && hydrated?.messages?.length) {
            setThreadMessages(hydrated.messages);
            return;
          }
        } catch (error) {
          console.warn("KeeprSpace relationship thread unavailable:", error?.message || error);
        } finally {
          if (!cancelled) setThreadLoading(false);
        }
      }
      if (Array.isArray(selectedInlineMessages) && selectedInlineMessages.length) {
        setThreadMessages(selectedInlineMessages);
        return;
      }
      setThreadLoading(true);
      try {
        const result = await loadThreadMessages(selectedThreadIdStable, { limit: 80 });
        if (!cancelled) setThreadMessages((result.messages || []).length ? result.messages : selectedSummaryMessages);
      } catch (error) {
        console.warn("KeeprSpace thread unavailable:", error?.message || error);
        if (!cancelled) setThreadMessages(selectedInlineMessages || selectedSummaryMessages);
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    }
    loadThread();
    return () => {
      cancelled = true;
    };
  }, [
    organizationId,
    selectedAssetId,
    selectedAssetName,
    selectedKac,
    selectedOwnerName,
    selectedThreadIdStable,
    workspaceName,
  ]);

  const openBoat = () => {
    if (!assetIdForThread(selectedThread)) return;
    const assetId = assetIdForThread(selectedThread);
    navigation.navigate("KeeprSpaceBoat", {
      assetId,
      kac: selectedThread.asset?.kac_id || selectedProjection?.asset?.kac_id || null,
      organizationId,
      stewardshipId:
        selectedProjection?.relationship?.compatibility_stewardship_id ||
        selectedProjection?.stewardship_id ||
        null,
      parentRoute: "KeeprSpaceMessages",
      workspaceId,
    });
  };

  const goBack = () => {
    const selectedAssetId = selectedThread ? assetIdForThread(selectedThread) : null;
    const targetAssetId = backAssetId || selectedAssetId;
    if (targetAssetId) {
      navigation.navigate("KeeprSpaceBoat", {
        assetId: targetAssetId,
        kac: backKac || selectedThread?.asset?.kac_id || selectedProjection?.asset?.kac_id || null,
        organizationId,
        stewardshipId:
          backStewardshipId ||
          selectedProjection?.relationship?.compatibility_stewardship_id ||
          selectedProjection?.stewardship_id ||
          null,
        parentRoute: "KeeprSpaceFleet",
        workspaceId,
      });
      return;
    }
    navigation.navigate("KeeprSpaceHome", { workspaceId });
  };

  const sendReply = async ({ body, attachments }) => {
    if (!selectedThread?.id) return;
    const pendingAttachments = attachments || pendingAttachmentsByThreadId[selectedThread.id] || [];
    if (!String(body || "").trim() && !pendingAttachments.length) return;
    setSending(true);
    try {
      const sent = await sendKeeprProStewardshipThreadReply({
        threadId: selectedThread.id,
        organizationId,
        body,
        assetId: selectedThread.asset_id || selectedThread.asset?.id || null,
        stewardshipId:
          selectedProjection?.relationship?.compatibility_stewardship_id ||
          selectedProjection?.stewardship_id ||
          null,
        pendingAttachments,
      });
      setReplyByThreadId((prev) => ({ ...prev, [selectedThread.id]: "" }));
      setPendingAttachmentsByThreadId((prev) => ({ ...prev, [selectedThread.id]: [] }));
      setThreadMessages((prev) => [...prev, sent].filter(Boolean));
      load({ quiet: true, force: true });
    } catch (error) {
      console.warn("KeeprSpace reply failed:", error?.message || error);
    } finally {
      setSending(false);
    }
  };

  const pickAttachment = async (kind = "file") => {
    if (!selectedThread?.id) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: kind === "photo" ? "image/*" : "*/*",
      });
      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;
      const pending = {
        uri: picked.uri,
        fileName: picked.name || picked.fileName || picked.uri.split("/").pop() || "attachment",
        mimeType: picked.mimeType || null,
        size: picked.size || null,
        kind,
      };
      setPendingAttachmentsByThreadId((prev) => ({
        ...prev,
        [selectedThread.id]: [...(prev[selectedThread.id] || []), pending],
      }));
    } catch (error) {
      console.warn("KeeprSpace attachment picker failed:", error?.message || error);
    }
  };

  const removePendingAttachment = (threadId, index) => {
    setPendingAttachmentsByThreadId((prev) => ({
      ...prev,
      [threadId]: (prev[threadId] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  if (loading && !workspace.threads?.length) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.emptySmall}>Loading messages...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>Messages</Text>
            <Text style={styles.title}>All Messages</Text>
            <Text style={styles.subtitle}>Person-to-person conversations with boats as shared context.</Text>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={() => load({ quiet: true, force: true })}>
            {refreshing ? <ActivityIndicator size="small" /> : <Ionicons name="refresh" size={18} color={colors.textPrimary} />}
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.shell}>
          <View style={styles.leftPane}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search people, boats, message text..."
                style={styles.searchInput}
              />
            </View>
            <View style={styles.filterRow}>
              {[
                ["all", "All"],
                ["unread", "Unread"],
                ["attention", "Needs Attention"],
              ].map(([key, label]) => (
                <TouchableOpacity key={key} onPress={() => setFilter(key)} activeOpacity={0.82}>
                  <Text style={filter === key ? styles.filterActive : styles.filterText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView
              style={styles.threadList}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ quiet: true, force: true })} />}
            >
              {visibleThreads.map((thread) => (
                <MessageRow
                  key={thread.id}
                  thread={thread}
                  selected={thread.id === selectedThread?.id}
                  profilesById={workspace.profilesById}
                  portfolioItems={portfolioItems}
                  heroUrl={heroUrls[assetIdForThread(thread)] || heroForThread(thread, portfolioItems)}
                  context={buildContext(thread, portfolioItems, workspaceName)}
                  onPress={() => setSelectedThreadId(thread.id)}
                />
              ))}
              {!visibleThreads.length ? <Text style={styles.emptySmall}>No conversations yet.</Text> : null}
            </ScrollView>
            <Text style={styles.countText}>Showing {visibleThreads.length} conversation{visibleThreads.length === 1 ? "" : "s"}</Text>
          </View>

          <View style={styles.rightPane}>
            {selectedThread ? (
              <>
                <View style={styles.threadHeader}>
                  <Image source={selectedHeroUrl ? { uri: selectedHeroUrl } : FALLBACK_BOAT} style={styles.headerThumb} resizeMode="cover" />
                  <View style={styles.headerThreadText}>
                    <Text style={styles.headerBoat} numberOfLines={1}>{threadBoatLabel(selectedThread, portfolioItems)}</Text>
                    <Text style={styles.headerPeople} numberOfLines={1}>
                      {selectedOwnerName} ↔ {selectedProviderPerson} · {selectedContext?.provider || workspaceName}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaPill}>{selectedContext?.type || "Service"}</Text>
                      <View style={styles.statusDot} />
                      <Text style={styles.statusText}>{selectedContext?.status || "active"}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.openBoatButton} onPress={openBoat}>
                    <Text style={styles.openBoatText}>Open Boat</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.messagesScroll} contentContainerStyle={styles.messagesContent}>
                  {threadLoading && !threadMessages.length ? (
                    <View style={styles.loadingInline}>
                      <ActivityIndicator />
                      <Text style={styles.emptySmall}>Loading conversation...</Text>
                    </View>
                  ) : (
                    <MessagesWithDates
                      messages={threadMessages}
                      currentUserId={workspace.currentUserId}
                      profilesById={workspace.profilesById}
                      ownerName={selectedOwnerName}
                      providerName={selectedContext?.provider || workspaceName}
                    />
                  )}
                </ScrollView>
                <View style={styles.composerWrap}>
                  <View style={styles.composerMain}>
                    {(pendingAttachmentsByThreadId[selectedThread.id] || []).length ? (
                      <View style={styles.pendingStrip}>
                        {(pendingAttachmentsByThreadId[selectedThread.id] || []).map((attachment, index) => (
                          <View key={`${attachment.uri}-${index}`} style={styles.pendingChip}>
                            <Ionicons
                              name={attachment.kind === "photo" ? "image-outline" : "document-attach-outline"}
                              size={16}
                              color={colors.brandBlue}
                            />
                            <Text style={styles.pendingChipText} numberOfLines={1}>
                              {attachment.fileName || "Attachment"}
                            </Text>
                            <TouchableOpacity onPress={() => removePendingAttachment(selectedThread.id, index)}>
                              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <TextInput
                      value={replyByThreadId[selectedThread.id] || ""}
                      onChangeText={(value) => setReplyByThreadId((prev) => ({ ...prev, [selectedThread.id]: value }))}
                      placeholder={`Reply as ${selectedContext?.provider || workspaceName}...`}
                      multiline
                      style={styles.composerInput}
                    />
                  </View>
                  <TouchableOpacity style={styles.composerToolButton} onPress={() => pickAttachment("photo")} activeOpacity={0.86}>
                    <Ionicons name="image-outline" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.composerToolButton} onPress={() => pickAttachment("file")} activeOpacity={0.86}>
                    <Ionicons name="document-attach-outline" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.composerSendButton,
                      (sending ||
                        (!String(replyByThreadId[selectedThread.id] || "").trim() &&
                          !(pendingAttachmentsByThreadId[selectedThread.id] || []).length)) &&
                        styles.composerSendButtonDisabled,
                    ]}
                    onPress={() =>
                      sendReply({
                        body: replyByThreadId[selectedThread.id] || "",
                        attachments: pendingAttachmentsByThreadId[selectedThread.id] || [],
                      })
                    }
                    disabled={
                      sending ||
                      (!String(replyByThreadId[selectedThread.id] || "").trim() &&
                        !(pendingAttachmentsByThreadId[selectedThread.id] || []).length)
                    }
                    activeOpacity={0.86}
                  >
                    {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send-outline" size={18} color="#FFFFFF" />}
                    <Text style={styles.composerSendText}>Reply</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.emptyPanel}>
                <Ionicons name="chatbubbles-outline" size={34} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>No conversation selected</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  backText: {
    fontWeight: "900",
    color: colors.textPrimary,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: "uppercase",
    fontWeight: "900",
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  subtitle: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  refreshText: {
    fontWeight: "900",
    color: colors.textPrimary,
  },
  shell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.sm,
  },
  leftPane: {
    width: 430,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
  },
  searchBar: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontWeight: "700",
    color: colors.textPrimary,
    outlineStyle: "none",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterActive: {
    color: colors.primary,
    fontWeight: "900",
  },
  filterText: {
    color: colors.textSecondary,
    fontWeight: "800",
  },
  threadList: {
    flex: 1,
  },
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
    borderRadius: radius.md,
    minHeight: 104,
  },
  threadRowSelected: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#93C5FD",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
  unreadDotActive: {
    backgroundColor: colors.primary,
  },
  threadThumb: {
    width: 82,
    height: 62,
    borderRadius: radius.sm,
    backgroundColor: "#E5E7EB",
  },
  threadText: {
    flex: 1,
    minWidth: 0,
  },
  threadTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  threadPerson: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  threadTime: {
    color: colors.textSecondary,
    fontWeight: "700",
    fontSize: 12,
  },
  threadBoat: {
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 2,
  },
  threadPreview: {
    color: colors.textSecondary,
    fontWeight: "600",
    marginTop: 4,
  },
  threadContext: {
    color: colors.textSecondary,
    fontWeight: "800",
    marginTop: 8,
    fontSize: 12,
  },
  unreadBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  countText: {
    color: colors.textSecondary,
    fontWeight: "700",
    paddingTop: spacing.sm,
  },
  rightPane: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerThumb: {
    width: 74,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: "#E5E7EB",
  },
  headerThreadText: {
    flex: 1,
    minWidth: 0,
  },
  headerBoat: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  headerPeople: {
    color: colors.textSecondary,
    fontWeight: "800",
    marginTop: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  metaPill: {
    color: colors.textSecondary,
    fontWeight: "900",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  statusText: {
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  openBoatButton: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  openBoatText: {
    color: colors.primary,
    fontWeight: "900",
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
  },
  messageList: {
    gap: spacing.sm,
  },
  dateSeparator: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginVertical: spacing.sm,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dateText: {
    color: colors.textSecondary,
    fontWeight: "800",
    fontSize: 12,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    maxWidth: "72%",
  },
  chatRowMine: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMine: {
    backgroundColor: colors.primary,
  },
  avatarText: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 12,
  },
  avatarTextMine: {
    color: "#FFFFFF",
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 520,
  },
  bubbleOther: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
    borderBottomLeftRadius: 6,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderBottomRightRadius: 6,
  },
  bubbleMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  bubbleMetaMine: {
    color: "#DBEAFE",
  },
  bubbleBody: {
    color: colors.textPrimary,
    fontWeight: "700",
    lineHeight: 19,
  },
  bubbleBodyMine: {
    color: "#FFFFFF",
  },
  composerWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    backgroundColor: "#FFFFFF",
  },
  composerMain: {
    flex: 1,
    gap: spacing.xs,
  },
  pendingStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  pendingChip: {
    maxWidth: 220,
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingChipText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 12,
  },
  composerInput: {
    minHeight: 52,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontWeight: "700",
    textAlignVertical: "top",
    outlineStyle: "none",
  },
  composerToolButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  composerSendButton: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  composerSendButtonDisabled: {
    opacity: 0.45,
  },
  composerSendText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loadingInline: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptySmall: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  emptyPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
});
