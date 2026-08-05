import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import {
  loadAttachmentsForMessages,
  sendKeeprProStewardshipThreadReply,
  startKeeprProStewardshipThread,
} from "../lib/messagesService";
import AttachmentViewerModal from "../components/AttachmentViewerModal";
import MessageThreadPanel from "../components/MessageThreadPanel";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

function compact(values) {
  return values.filter((value) => value !== null && value !== undefined && value !== "").join(" · ");
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function actionProviderName(action, projection) {
  return (
    action?.provider_target?.label ||
    projection?.organization?.name ||
    projection?.keepr_pro?.name ||
    "Provider not set"
  );
}

function actionResponsibleName(action) {
  return action?.responsible_party?.label || action?.assigned_to || "Not assigned";
}

function EmptyBlock({ icon, title, body }) {
  return (
    <View style={styles.emptyBlock}>
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{body}</Text>
    </View>
  );
}

function RelationshipFileStrip({ files = [], onOpenFile, onAddFile, uploading = false }) {
  return (
    <View style={styles.fileStrip}>
      <View style={styles.fileStripHeader}>
        <View>
          <Text style={styles.fileStripTitle}>Files in this conversation</Text>
          <Text style={styles.fileStripSubtitle}>Photos, invoices, receipts, and quotes shared here.</Text>
        </View>
        <TouchableOpacity
          style={[styles.inlineButton, uploading && styles.disabled]}
          onPress={onAddFile}
          disabled={uploading}
          activeOpacity={0.86}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="add-outline" size={16} color={colors.primary} />
          )}
          <Text style={styles.inlineButtonText}>Add file</Text>
        </TouchableOpacity>
      </View>
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileStripList}>
          {files.map((file) => (
            <TouchableOpacity
              key={file.attachment_id || file.placement_id || file.id}
              style={styles.fileChip}
              onPress={() => onOpenFile(file)}
              activeOpacity={0.86}
            >
              <Ionicons
                name={String(file.mime_type || "").startsWith("image/") ? "image-outline" : "document-text-outline"}
                size={17}
                color="#2563EB"
              />
              <View style={styles.fileChipTextWrap}>
                <Text style={styles.fileChipTitle} numberOfLines={1}>{file.title || file.file_name || "File"}</Text>
                <Text style={styles.fileChipMeta} numberOfLines={1}>
                  {file.created_at ? formatDate(file.created_at) : file.mime_type || "Shared file"}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.fileStripEmpty}>No files have been shared in this conversation yet.</Text>
      )}
    </View>
  );
}

export default function KeeprProStewardshipViewScreen({ route, navigation }) {
  const { assetId, kac, organizationId } = route?.params || {};
  const [projection, setProjection] = useState(null);
  const [portal, setPortal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [viewMode, setViewMode] = useState("visual");
  const [heroUrl, setHeroUrl] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [actionNextStep, setActionNextStep] = useState("");
  const [actionStatus, setActionStatus] = useState("open");
  const [savingReply, setSavingReply] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [completingAction, setCompletingAction] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [startingThread, setStartingThread] = useState(false);
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const [showOriginalRequestDetails, setShowOriginalRequestDetails] = useState(false);
  const [showUpdateWork, setShowUpdateWork] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const relationshipThreadId = portal?.projection_thread?.id || messages?.[0]?.id || null;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!assetId && !kac) {
      setError("Missing asset.");
      setLoading(false);
      return;
    }

    if (!quiet) setLoading(true);
    setError(null);

    try {
      const projectionRpc = kac
        ? supabase.rpc("get_keeprpro_stewardship_asset_by_kac", {
            p_kac: kac,
            p_organization_id: organizationId || null,
          })
        : supabase.rpc("get_keeprpro_stewardship_asset", {
            p_asset_id: assetId,
            p_organization_id: organizationId || null,
          });
      const { data, error: rpcError } = await projectionRpc;
      if (rpcError) throw rpcError;

      if (!data) {
        setProjection(null);
        setError("This asset is not available in the active KeeprPro context.");
        return;
      }

      const { data: messageRows, error: messageError } = await supabase.rpc(
        "get_keeprpro_stewardship_messages",
        {
          p_asset_id: data.asset?.id || assetId || null,
          p_kac: data.asset?.kac_id || kac || null,
          p_organization_id: data.organization?.id || organizationId || null,
        }
      );
      if (messageError) throw messageError;

      const { data: portalData, error: portalError } = await supabase.rpc(
        "get_keeprpro_relationship_portal",
        {
          p_asset_id: data.asset?.id || assetId || null,
          p_kac: data.asset?.kac_id || kac || null,
          p_organization_id: data.organization?.id || organizationId || null,
        }
      );
      if (portalError) throw portalError;

      const messageIds = (messageRows || []).flatMap((thread) =>
        (thread.messages || []).map((message) => message.id).filter(Boolean)
      );
      const attachmentsByMessage = await loadAttachmentsForMessages(messageIds);
      setProjection(data);
      setPortal(portalData || null);
      setMessages(
        (messageRows || []).map((thread) => ({
          ...thread,
          messages: (thread.messages || []).map((message) => ({
            ...message,
            attachments: attachmentsByMessage[message.id] || [],
          })),
        }))
      );
    } catch (err) {
      console.error("Stewardship View load failed:", err);
      setProjection(null);
      setPortal(null);
      setMessages([]);
      setError(err?.message || "Could not load the Stewardship View.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [assetId, kac, organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const threadId = relationshipThreadId;
    if (!threadId) return undefined;

    let active = true;
    let notificationChannel = null;
    const reload = () => {
      if (!active) return;
      load({ quiet: true });
    };

    const messageChannel = supabase
      .channel(`keeprpro-space-thread:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "asset_thread_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        reload
      )
      .subscribe();

    supabase.auth.getUser().then(({ data }) => {
      const userId = data?.user?.id || null;
      if (!active || !userId) return;
      notificationChannel = supabase
        .channel(`keeprpro-space-notifications:${userId}:${threadId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notification_events",
            filter: `recipient_user_id=eq.${userId}`,
          },
          (payload) => {
            if (String(payload?.new?.thread_id || "") === String(threadId)) reload();
          }
        )
        .subscribe();
    });

    return () => {
      active = false;
      supabase.removeChannel(messageChannel);
      if (notificationChannel) supabase.removeChannel(notificationChannel);
    };
  }, [load, relationshipThreadId]);

  useEffect(() => {
    setActionNote(portal?.current_action?.provider_response?.note || "");
    setActionNextStep(portal?.current_action?.provider_response?.next_step || "");
    setActionStatus(portal?.current_action?.status || "open");
  }, [portal?.current_action?.id, portal?.current_action?.provider_response, portal?.current_action?.status]);

  useEffect(() => {
    let active = true;

    const signHero = async () => {
      const hero = projection?.hero_media;
      if (!hero?.bucket || !hero?.storage_path) {
        setHeroUrl(null);
        return;
      }

      try {
        const signed = await getSignedUrl({
          bucket: hero.bucket,
          path: hero.storage_path,
          expiresIn: 3600,
          transform: { width: 1400, quality: 82 },
        });
        if (active) setHeroUrl(signed);
      } catch (err) {
        const publicUrl = supabase.storage
          .from(hero.bucket)
          .getPublicUrl(hero.storage_path)?.data?.publicUrl;
        if (active) setHeroUrl(publicUrl || null);
      }
    };

    signHero();
    return () => {
      active = false;
    };
  }, [projection?.hero_media]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const asset = projection?.asset || {};
  const systems = projection?.systems || [];
  const records = projection?.service_records || [];
  const actions = projection?.actions || [];
  const currentAction = portal?.current_action || null;
  const activeWorkTitle = currentAction?.title || "No active service request";
  const currentActionOpen =
    currentAction?.id && !["completed", "deleted", "archived"].includes(String(currentAction.status || "open"));
  const sharedActions = currentActionOpen
    ? [currentAction, ...actions.filter((action) => action.id !== currentAction.id)]
    : actions;
  const sharedActionCount = Number.isFinite(Number(portal?.shared_action_count))
    ? Number(portal.shared_action_count)
    : sharedActions.length;
  const whatNext = portal?.what_next || null;
  const playbook = portal?.playbook || null;
  const appointment = portal?.appointment || null;
  const sharedFiles = portal?.shared_files || [];
  const hasRelationshipThread = Boolean(relationshipThreadId);
  const canEditCurrentAction = Boolean(
    currentActionOpen &&
      (portal?.permitted_operations?.update_action_status ||
        portal?.permitted_operations?.update_provider_response ||
        portal?.permitted_operations?.complete_action)
  );

  const openAction = (action) => {
    navigation.navigate("KeeprProActionDetail", {
      actionId: action.id,
      organizationId: projection?.organization?.id || organizationId,
    });
  };

  const conciseActionDescription = (() => {
    if (!currentAction?.id) return "No active service request is open in this relationship.";
    const explicit = currentAction?.provider_response?.note || currentAction?.provider_response?.next_step;
    if (explicit) return explicit;
    return "No concise description has been set.";
  })();
  const latestActionActivity =
    currentAction?.updated_at || portal?.projection_thread?.updated_at || currentAction?.created_at || null;
  const currentStage = currentAction?.status ? String(currentAction.status).replace(/_/g, " ") : "No active service request";
  const waitingOn = currentAction?.id ? actionResponsibleName(currentAction) : "No one";
  const nextStepLabel = currentAction?.id ? whatNext?.title || "No next step has been set." : "No active work is waiting.";
  const targetDateLabel = currentAction?.due_at ? formatDate(currentAction.due_at) : "No target date set";
  const ownerName = portal?.owner_display_name || asset.owner_display_name || "Owner";
  const providerName = projection?.organization?.name || projection?.keepr_pro?.name || "KeeprPro";
  const relationshipTitle = `${ownerName} ↔ ${providerName}`;
  const wilsonAdvisor =
    currentAction?.provider_response?.advisor ||
    currentAction?.provider_response?.advisor_name ||
    currentAction?.provider_response?.staff_name ||
    "No Wilson advisor assigned";
  const ownerPhone = asset.owner_phone || asset.owner_contact?.phone || null;
  const ownerEmail = asset.owner_email || asset.owner_contact?.email || null;
  const providerPhone = projection?.keepr_pro?.phone || projection?.organization?.phone || null;
  const providerWebsite = projection?.keepr_pro?.website || projection?.organization?.website || null;
  const relatedSystems = systems.map((system) => {
    const systemRecords = records.filter((record) =>
      String(record.system_id || record.system?.id || "") === String(system.id)
    );
    return {
      ...system,
      recordCount: systemRecords.length,
    };
  });

  const contactByPhone = (phone) => {
    if (!phone) return;
    if (typeof window !== "undefined") window.location.href = `tel:${phone}`;
  };

  const contactByEmail = (email) => {
    if (!email) return;
    if (typeof window !== "undefined") window.location.href = `mailto:${email}`;
  };

  const openProviderWebsite = () => {
    if (!providerWebsite || typeof window === "undefined") return;
    window.open(providerWebsite, "_blank", "noopener,noreferrer");
  };

  const connectPlaybook = () => {
    Alert.alert(
      "Playbook not connected",
      "This KeeprSpace does not yet have a persisted Playbook. The current view is using the real shared Action until the Playbook engine is connected."
    );
  };

  const openMessages = async () => {
    let threadId = portal?.projection_thread?.id || messages?.[0]?.id || null;
    if (!threadId) {
      if (!asset.id || !(projection?.organization?.id || organizationId)) return;
      setStartingThread(true);
      try {
        const started = await startKeeprProStewardshipThread({
          assetId: asset.id,
          organizationId: projection?.organization?.id || organizationId,
        });
        threadId = started?.thread?.id || null;
        setPortal((prev) =>
          prev
            ? {
                ...prev,
                projection_thread: {
                  ...(prev.projection_thread || {}),
                  ...(started.thread || {}),
                  id: threadId,
                },
              }
            : prev
        );
        setMessages((prev) =>
          prev.some((thread) => thread.id === threadId)
            ? prev
            : [
                {
                  ...(started.thread || {}),
                  id: threadId,
                  asset_id: asset.id,
                  subject: started.thread?.subject || `${asset.name} · ${projection?.organization?.name || "KeeprPro"}`,
                  messages: started.message ? [started.message] : [],
                },
                ...prev,
              ]
        );
      } catch (err) {
        Alert.alert("Could not start messages", err?.message || "Please try again.");
        return;
      } finally {
        setStartingThread(false);
      }
    }
    if (!threadId) return;
    navigation.navigate("KeeprAction", {
      assetId: asset.id,
      assetName: asset.name,
      kac: asset.kac_id,
      threadId,
      scope: "asset",
      perspective: "keepr_pro",
      organizationId: projection?.organization?.id || organizationId,
      providerName: projection?.organization?.name || projection?.keepr_pro?.name || "KeeprPro",
      ownerName: portal?.owner_display_name || asset.owner_display_name || "Owner",
      backRoute: "KeeprProStack",
      backParams: {
        screen: "KeeprProStewardshipView",
        params: {
          assetId: asset.id,
          kac: asset.kac_id,
          organizationId: projection?.organization?.id || organizationId,
        },
      },
    });
  };

  const sendReply = async ({ body = replyDraft, attachments = [] } = {}) => {
    const threadId = portal?.projection_thread?.id || messages?.[0]?.id || null;
    if (!threadId) {
      Alert.alert("No thread", "No Harris/Wilson thread was returned by the projection.");
      return;
    }

    setSavingReply(true);
    try {
      const sentMessage = await sendKeeprProStewardshipThreadReply({
        threadId,
        organizationId: projection?.organization?.id || organizationId,
        body,
        assetId: asset.id,
        stewardshipId: projection?.stewardship?.id || null,
        actionId: currentAction?.id || null,
        pendingAttachments: attachments,
      });
      if (sentMessage?.id) {
        setMessages((prev) =>
          prev.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: [...(thread.messages || []), sentMessage],
                }
              : thread
          )
        );
        if (sentMessage.attachments?.length) {
          setPortal((prev) =>
            prev
              ? {
                  ...prev,
                  shared_files: [
                    ...(prev.shared_files || []),
                    ...sentMessage.attachments.filter(
                      (attachment) =>
                        !(prev.shared_files || []).some(
                          (file) =>
                            String(file.attachment_id || file.id) ===
                            String(attachment.attachment_id || attachment.id)
                        )
                    ),
                  ],
                }
              : prev
          );
        }
      }
      setReplyDraft("");
      load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not reply", err?.message || "Please try again.");
    } finally {
      setSavingReply(false);
    }
  };

  const saveAction = async () => {
    if (!currentAction?.id) return;
    setSavingAction(true);
    try {
      const { error: actionError } = await supabase.rpc(
        "update_keeprpro_stewardship_action_response",
        {
          p_reminder_id: currentAction.id,
          p_organization_id: projection?.organization?.id || organizationId,
          p_note: actionNote,
          p_next_step: actionNextStep,
          p_status: actionStatus,
        }
      );
      if (actionError) throw actionError;
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not save Action", err?.message || "Please try again.");
    } finally {
      setSavingAction(false);
    }
  };

  const completeAction = () => {
    if (!currentAction?.id) return;
    Alert.alert(
      "Complete Action",
      "Complete this shared Action and add the resulting service record to Wilson-relevant Harris history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            setCompletingAction(true);
            try {
              const { error: completeError } = await supabase.rpc(
                "complete_keeprpro_stewardship_action",
                {
                  p_reminder_id: currentAction.id,
                  p_organization_id: projection?.organization?.id || organizationId,
                  p_completion_notes: actionNote,
                  p_performed_at: new Date().toISOString().slice(0, 10),
                }
              );
              if (completeError) throw completeError;
              await load({ quiet: true });
            } catch (err) {
              Alert.alert("Could not complete Action", err?.message || "Please try again.");
            } finally {
              setCompletingAction(false);
            }
          },
        },
      ]
    );
  };

  const openRecord = (record) => {
    if (!record?.id) return;
    navigation.navigate("TimelineRecord", {
      sourceType: "service_record",
      serviceRecordId: record.id,
    });
  };

  const openSharedFile = async (file) => {
    if (!file) return;
    let url = file.url || null;
    if (!url && file.bucket && file.storage_path) {
      try {
        url = await getSignedUrl({
          bucket: file.bucket,
          path: file.storage_path,
          expiresIn: 3600,
        });
      } catch {}
    }

    setViewerAttachment({
      ...file,
      id: file.attachment_id || file.id,
      url,
      fileName: file.file_name,
      mimeType: file.mime_type,
    });
  };

  const addSharedFile = async () => {
    if (!asset.id || !portal?.stewardship_id) return;
    setUploadingFile(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error("You need to be signed in.");

      await uploadAttachmentFromUri({
        userId,
        assetId: asset.id,
        kind: "file",
        fileUri: picked.uri,
        fileName: picked.name || picked.fileName || "Shared file",
        mimeType: picked.mimeType || null,
        sizeBytes: picked.size || null,
        title: picked.name || picked.fileName || "Shared file",
        sourceContext: {
          screen: "KeeprProStewardshipView",
          source_type: "relationship_portal",
          source_id: portal.stewardship_id,
          asset_id: asset.id,
          action_id: currentAction?.id || null,
          thread_id: portal?.projection_thread?.id || null,
        },
        placements: [
          {
            target_type: "asset",
            target_id: asset.id,
            role: "relationship_shared",
            label: portal.stewardship_id,
          },
          ...(currentAction?.id
            ? [
                {
                  target_type: "reminder",
                  target_id: currentAction.id,
                  role: "relationship_shared",
                  label: portal.stewardship_id,
                },
              ]
            : []),
        ],
      });
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not add shared file", err?.message || "Please try again.");
    } finally {
      setUploadingFile(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading Stewardship View...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>Restricted</Text>
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>KeeprSpace</Text>
              <Text style={styles.title}>{relationshipTitle}</Text>
              <Text style={styles.subtitle}>
                {asset.name} · {ownerName} ↔ {providerName} · KAC: {asset.kac_id}
              </Text>
            </View>

            <View style={styles.viewModeRow}>
              <Text style={styles.viewModeLabel}>View as</Text>
              <View style={styles.viewModeChips}>
                {[
                  ["visual", "Visual View"],
                  ["list", "List View"],
                ].map(([mode, label]) => (
                  <TouchableOpacity
                    key={mode}
                    style={[
                      styles.viewModeChip,
                      viewMode === mode && styles.viewModeChipActive,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setViewMode(mode)}
                  >
                    <Text
                      style={[
                        styles.viewModeChipText,
                        viewMode === mode && styles.viewModeChipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.headerMessageButton, startingThread && styles.disabled]}
                onPress={openMessages}
                disabled={startingThread}
                activeOpacity={0.86}
              >
                {startingThread ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.headerMessageButtonText}>
                  {hasRelationshipThread ? "Open messages" : "Start messages"}
                </Text>
              </TouchableOpacity>
            </View>

            {viewMode === "visual" ? (
              <>
                <View style={styles.visualHero}>
                  {heroUrl ? (
                    <Image source={{ uri: heroUrl }} style={styles.heroImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.heroFallback}>
                      <Ionicons name="boat-outline" size={42} color="#2563EB" />
                    </View>
                  )}
                  <View style={styles.heroOverlay}>
                    <Text style={styles.heroContext}>Shared asset relationship</Text>
                    <Text style={styles.heroTitle}>{asset.name}</Text>
                    <Text style={styles.heroMeta}>
                      {compact([asset.year, asset.make, asset.model, asset.kac_id])}
                    </Text>
                  </View>
                </View>

                <View style={styles.whatNextCard}>
                  <View style={styles.whatNextHeader}>
                    <View style={styles.sectionTitleBlock}>
                      <Text style={styles.cardLabel}>Where we are now</Text>
                      <Text style={styles.whatNextTitle}>{activeWorkTitle}</Text>
                      <Text style={styles.whatNextBody}>{conciseActionDescription}</Text>
                    </View>
                    <View style={styles.workActions}>
                      <TouchableOpacity style={styles.secondaryButton} onPress={openMessages} activeOpacity={0.86}>
                        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textPrimary} />
                        <Text style={styles.secondaryButtonText}>Message</Text>
                      </TouchableOpacity>
                      {canEditCurrentAction ? (
                        <TouchableOpacity
                          style={styles.primaryButton}
                          onPress={() => setShowUpdateWork((value) => !value)}
                          activeOpacity={0.86}
                        >
                          <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                          <Text style={styles.primaryButtonText}>Update work</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.summaryGrid}>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Current stage</Text>
                      <Text style={styles.detailValue}>{currentStage}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Waiting on</Text>
                      <Text style={styles.detailValue}>{waitingOn}</Text>
                    </View>
                    <View style={styles.summaryItemWide}>
                      <Text style={styles.detailLabel}>Next step</Text>
                      <Text style={styles.detailValue}>{nextStepLabel}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Target date</Text>
                      <Text style={styles.detailValue}>{targetDateLabel}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Last activity</Text>
                      <Text style={styles.detailValue}>{formatDate(latestActionActivity)}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Wilson advisor</Text>
                      <Text style={styles.detailValue}>{wilsonAdvisor}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.detailLabel}>Linked system</Text>
                      <Text style={styles.detailValue}>
                        {currentAction?.system_name || currentAction?.system?.name || "Asset-level work"}
                      </Text>
                    </View>
                  </View>
                  {currentAction?.notes ? (
                    <View style={styles.originalRequestBox}>
                      <TouchableOpacity
                        style={styles.originalRequestToggle}
                        onPress={() => setShowOriginalRequestDetails((value) => !value)}
                        activeOpacity={0.86}
                      >
                        <Text style={styles.originalRequestToggleText}>
                          View original request details
                        </Text>
                        <Ionicons
                          name={showOriginalRequestDetails ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={colors.primary}
                        />
                      </TouchableOpacity>
                      {showOriginalRequestDetails ? (
                        <Text style={styles.originalRequestText}>{currentAction.notes}</Text>
                      ) : null}
                    </View>
                  ) : null}
                  {canEditCurrentAction && showUpdateWork ? (
                    <View style={styles.operationPanel}>
                      <Text style={styles.cardLabel}>Update work</Text>
                      <Text style={styles.inputLabel}>Current stage</Text>
                      <View style={styles.statusChoiceRow}>
                        {["open", "requested", "in_progress", "waiting"].map((status) => (
                          <TouchableOpacity
                            key={status}
                            style={[
                              styles.statusChoice,
                              actionStatus === status && styles.statusChoiceActive,
                            ]}
                            onPress={() => setActionStatus(status)}
                            activeOpacity={0.85}
                          >
                            <Text
                              style={[
                                styles.statusChoiceText,
                                actionStatus === status && styles.statusChoiceTextActive,
                              ]}
                            >
                              {status.replace(/_/g, " ")}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.inputLabel}>Shared update</Text>
                      <TextInput
                        value={actionNote}
                        onChangeText={setActionNote}
                        placeholder="Add a timestamped Wilson update..."
                        multiline
                        style={[styles.input, styles.textArea]}
                      />
                      <Text style={styles.inputLabel}>Next step</Text>
                      <TextInput
                        value={actionNextStep}
                        onChangeText={setActionNextStep}
                        placeholder="Set the next step..."
                        style={styles.input}
                      />
                      <View style={styles.operationActions}>
                        <TouchableOpacity
                          style={[styles.primaryButton, savingAction && styles.disabled]}
                          onPress={saveAction}
                          disabled={savingAction}
                          activeOpacity={0.86}
                        >
                          {savingAction ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                          <Text style={styles.primaryButtonText}>Save update</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryButton, completingAction && styles.disabled]}
                          onPress={completeAction}
                          disabled={completingAction || currentAction.status === "completed"}
                          activeOpacity={0.86}
                        >
                          {completingAction ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                          <Text style={styles.secondaryButtonText}>Complete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={styles.visualGrid}>
                  <View style={styles.visualPanel}>
                    <Text style={styles.cardLabel}>Andy Drake</Text>
                    <Text style={styles.visualValue}>Owner</Text>
                    <Text style={styles.visualMuted}>Current responsibility: {waitingOn === ownerName ? nextStepLabel : "No owner step assigned"}</Text>
                    <View style={styles.contactRow}>
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByPhone(ownerPhone)} disabled={!ownerPhone}>
                        <Ionicons name="call-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Call</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByEmail(ownerEmail)} disabled={!ownerEmail}>
                        <Ionicons name="mail-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Email</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inlineButton} onPress={openMessages}>
                        <Ionicons name="chatbubble-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Message</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.visualPanel}>
                    <Text style={styles.cardLabel}>Wilson Marine</Text>
                    <Text style={styles.visualValue}>Professional steward</Text>
                    <Text style={styles.visualMuted}>Assigned staff: {wilsonAdvisor}</Text>
                    <View style={styles.contactRow}>
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByPhone(providerPhone)} disabled={!providerPhone}>
                        <Ionicons name="call-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Call</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inlineButton} onPress={openProviderWebsite} disabled={!providerWebsite}>
                        <Ionicons name="globe-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Website</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inlineButton} onPress={openMessages}>
                        <Ionicons name="chatbubble-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Message</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={styles.visualGrid}>
                  <View style={styles.visualPanel}>
                    <Text style={styles.cardLabel}>Playbook / cycle</Text>
                    <Text style={styles.visualValue}>{playbook?.exists ? "Connected" : "Annual Winterization"}</Text>
                    <Text style={styles.visualMuted}>
                      {playbook?.exists
                        ? "Using persisted ordered Playbook state."
                        : "No persisted Playbook steps are connected yet; current work is driven by the shared Action."}
                    </Text>
                    {!playbook?.exists ? (
                      <TouchableOpacity style={[styles.secondaryButton, styles.panelButton]} onPress={connectPlaybook}>
                        <Ionicons name="git-branch-outline" size={16} color={colors.textPrimary} />
                        <Text style={styles.secondaryButtonText}>Connect Playbook</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={styles.visualPanel}>
                    <Text style={styles.cardLabel}>Appointment</Text>
                    <Text style={styles.visualValue}>
                      {appointment?.scheduled ? "Scheduled" : "No appointment is scheduled"}
                    </Text>
                    <Text style={styles.visualMuted}>Scheduling appears here only when a persisted appointment record exists.</Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionTitleBlock}>
                      <Text style={styles.cardTitle}>Related systems</Text>
                      <Text style={styles.sectionHint}>Systems included in this stewardship projection and related Wilson history.</Text>
                    </View>
                    <Text style={styles.count}>{systems.length}</Text>
                  </View>
                  {relatedSystems.map((system) => (
                    <View key={system.id} style={styles.visualSystemPill}>
                      <Ionicons name="construct-outline" size={16} color="#2563EB" />
                      <View style={styles.rowBody}>
                        <Text style={styles.visualSystemText}>{system.name}</Text>
                        <Text style={styles.rowMeta}>
                          {system.recordCount ? `${system.recordCount} Wilson record${system.recordCount === 1 ? "" : "s"}` : "No Wilson records yet"}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                {sharedActions.length > 1 ? (
                  <View style={styles.card}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.cardTitle}>Related work</Text>
                      <Text style={styles.count}>{sharedActionCount}</Text>
                    </View>
                    {sharedActions.map((action) => (
                        <TouchableOpacity
                          key={action.id}
                          style={styles.actionRow}
                          activeOpacity={0.86}
                          onPress={() => openAction(action)}
                        >
                          <Ionicons name="alert-circle-outline" size={18} color="#2563EB" />
                          <View style={styles.rowBody}>
                            <Text style={styles.rowTitle}>{action.title}</Text>
                            <Text style={styles.rowMeta}>
                              {compact([action.status || "open", action.system_name])}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      ))}
                  </View>
                ) : null}

                <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.cardTitle}>Conversation and files</Text>
                    <Text style={styles.count}>{messages.length}</Text>
                  </View>
                  {messages.length ? (
                    messages.map((thread) => (
                      <View key={thread.id} style={styles.row}>
                        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#2563EB" />
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle}>{thread.subject || "Message thread"}</Text>
                          <RelationshipFileStrip
                            files={sharedFiles}
                            onOpenFile={openSharedFile}
                            onAddFile={addSharedFile}
                            uploading={uploadingFile}
                          />
                          <MessageThreadPanel
                            messages={thread.messages || []}
                            perspective="keepr_pro"
                            ownerDisplayName={portal?.owner_display_name || asset.owner_display_name}
                            providerDisplayName={projection?.organization?.name || projection?.keepr_pro?.name}
                            replyValue={replyDraft}
                            onReplyChange={setReplyDraft}
                            onSend={sendReply}
                            activeNotificationContext={{
                              thread_id: thread.id,
                              action_id: portal?.current_action?.id || null,
                              asset_id: asset.id || asset.asset_id || null,
                              stewardship_id: portal?.stewardship_id || projection?.stewardship?.id || null,
                            }}
                            replyPlaceholder="Reply as Wilson Marine..."
                            replyDisabled={savingReply}
                            replying={savingReply}
                            onOpenAttachment={setViewerAttachment}
                            footerActions={
                              <TouchableOpacity style={styles.secondaryButton} onPress={openMessages} activeOpacity={0.86}>
                                <Text style={styles.secondaryButtonText}>Open full thread</Text>
                              </TouchableOpacity>
                            }
                          />
                          {!(thread.messages || []).some((message) => message.sender_type === "keepr_pro") ? (
                            <Text style={styles.emptyStateText}>Wilson has not replied yet.</Text>
                          ) : null}
                        </View>
                      </View>
                    ))
                  ) : (
                    <EmptyBlock
                      icon="chatbubble-outline"
                      title="No shared message thread"
                      body="Only provider-scoped Harris/Wilson threads appear here."
                    />
                  )}
                </View>

                <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionTitleBlock}>
                      <Text style={styles.cardTitle}>Relationship files</Text>
                      <Text style={styles.sectionHint}>Files shared across the Harris/Wilson relationship; one attachment can also be placed on work, records, and history.</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.inlineButton, uploadingFile && styles.disabled]}
                      onPress={addSharedFile}
                      disabled={uploadingFile}
                      activeOpacity={0.86}
                    >
                      {uploadingFile ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Ionicons name="add-outline" size={16} color={colors.primary} />
                      )}
                      <Text style={styles.inlineButtonText}>Add file</Text>
                    </TouchableOpacity>
                  </View>
                  {sharedFiles.length ? (
                    sharedFiles.map((file) => (
                      <TouchableOpacity
                        key={file.attachment_id || file.placement_id}
                        style={styles.row}
                        onPress={() => openSharedFile(file)}
                        activeOpacity={0.86}
                      >
                        <Ionicons name="attach-outline" size={18} color="#2563EB" />
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle}>{file.title || file.file_name}</Text>
                          <Text style={styles.rowMeta}>{file.created_at ? formatDate(file.created_at) : "Shared file"}</Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <EmptyBlock
                      icon="attach-outline"
                      title="No files yet"
                      body="Photos, invoices, receipts, and quotes appear here after they are shared in the relationship."
                    />
                  )}
                </View>

                <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.cardTitle}>Previous work with Wilson Marine</Text>
                    <Text style={styles.count}>{records.length}</Text>
                  </View>
                  {records.map((record) => (
                    <TouchableOpacity
                      key={record.id}
                      style={styles.row}
                      onPress={() => openRecord(record)}
                      activeOpacity={0.86}
                    >
                      <Ionicons name="document-text-outline" size={18} color="#2563EB" />
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>{record.title}</Text>
                        <Text style={styles.rowMeta}>{formatDate(record.performed_at)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <>
                <View style={styles.listViewLabel}>
                  <Text style={styles.cardLabel}>KeeprSpace · List View</Text>
                  <Text style={styles.listViewText}>
                    {portal?.relationship_title || "Andy Drake ↔ Wilson Marine"} · {asset.kac_id}
                  </Text>
                </View>

            <View style={styles.whatNextCard}>
              <View style={styles.whatNextHeader}>
                <View>
                  <Text style={styles.cardLabel}>Where we are now</Text>
                  <Text style={styles.whatNextTitle}>
                    {activeWorkTitle}
                  </Text>
                </View>
                {currentAction?.status ? (
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>{currentAction.status}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.whatNextBody}>
                {conciseActionDescription}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Safe asset summary</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Owner</Text>
                  <Text style={styles.detailValue}>{asset.owner_display_name}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Type</Text>
                  <Text style={styles.detailValue}>{asset.type}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Boat</Text>
                  <Text style={styles.detailValue}>
                    {compact([asset.year, asset.make, asset.model]) || "Not specified"}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Descriptors</Text>
                  <Text style={styles.detailValue}>
                    {compact([
                      asset.length_feet ? `${asset.length_feet} ft` : null,
                      asset.hull_material,
                      asset.engine_type,
                    ]) || "Not specified"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Playbook and Scheduling</Text>
              </View>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Playbook</Text>
                  <Text style={styles.detailValue}>
                    {playbook?.exists ? "Connected" : "No Playbook is connected"}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Appointment</Text>
                  <Text style={styles.detailValue}>
                    {appointment?.scheduled ? "Scheduled" : "No appointment is scheduled"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleBlock}>
                  <Text style={styles.cardTitle}>Related systems</Text>
                  <Text style={styles.sectionHint}>Included by the Harris/Wilson stewardship relationship and related Wilson history.</Text>
                </View>
                <Text style={styles.count}>{systems.length}</Text>
              </View>
              {systems.length ? (
                systems.map((system) => (
                  <View key={system.id} style={styles.row}>
                    <Ionicons name="construct-outline" size={18} color="#2563EB" />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{system.name}</Text>
                      <Text style={styles.rowMeta}>
                        {compact([
                          system.system_type,
                          system.lifecycle_status || system.status,
                          system.next_service_date ? `Next ${formatDate(system.next_service_date)}` : null,
                        ]) || "System context"}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <EmptyBlock
                  icon="albums-outline"
                  title="No systems included"
                  body="The current projection does not include system details."
                />
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Previous work with Wilson Marine</Text>
                <Text style={styles.count}>{records.length}</Text>
              </View>
              {records.length ? (
                records.map((record) => (
                  <TouchableOpacity
                    key={record.id}
                    style={styles.row}
                    onPress={() => openRecord(record)}
                    activeOpacity={0.86}
                  >
                    <Ionicons name="document-text-outline" size={18} color="#2563EB" />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{record.title}</Text>
                      <Text style={styles.rowMeta}>
                        {compact([
                          formatDate(record.performed_at),
                          record.service_type || record.category,
                          record.verification_status,
                        ])}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))
              ) : (
                <EmptyBlock
                  icon="document-outline"
                  title="No Wilson-attributed records"
                  body="Only service records attributed to Wilson Marine are shown here."
                />
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Current and upcoming work</Text>
                <Text style={styles.count}>{sharedActionCount}</Text>
              </View>
              {sharedActions.length ? (
                sharedActions.map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    style={styles.actionRow}
                    activeOpacity={0.86}
                    onPress={() => openAction(action)}
                  >
                    <Ionicons name="notifications-outline" size={18} color="#2563EB" />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{action.title}</Text>
                      <Text style={styles.rowMeta}>
                        {compact([
                          action.status || "open",
                          action.system_name,
                          action.due_at ? `Due ${formatDate(action.due_at)}` : null,
                        ])}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))
              ) : (
                <EmptyBlock
                  icon="notifications-off-outline"
                  title="No shared open Actions"
                  body="Provider attribution alone is not enough; Actions must be assigned or shared with Wilson."
                />
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Conversation</Text>
                <Text style={styles.count}>{messages.length}</Text>
              </View>
              {messages.length ? (
                messages.map((thread) => (
                  <View key={thread.id} style={styles.row}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#2563EB" />
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>{thread.subject || "Message thread"}</Text>
                        <RelationshipFileStrip
                          files={sharedFiles}
                          onOpenFile={openSharedFile}
                          onAddFile={addSharedFile}
                          uploading={uploadingFile}
                        />
                        <MessageThreadPanel
                          messages={thread.messages || []}
                          perspective="keepr_pro"
                        ownerDisplayName={portal?.owner_display_name || asset.owner_display_name}
                        providerDisplayName={projection?.organization?.name || projection?.keepr_pro?.name}
                        replyValue={replyDraft}
                        onReplyChange={setReplyDraft}
                        onSend={sendReply}
                        activeNotificationContext={{
                          thread_id: thread.id,
                          action_id: portal?.current_action?.id || null,
                          asset_id: asset.id || asset.asset_id || null,
                          stewardship_id: portal?.stewardship_id || projection?.stewardship?.id || null,
                        }}
                        replyPlaceholder="Reply as Wilson Marine..."
                        replyDisabled={savingReply}
                        replying={savingReply}
                        onOpenAttachment={setViewerAttachment}
                        footerActions={
                          <TouchableOpacity style={styles.secondaryButton} onPress={openMessages} activeOpacity={0.86}>
                            <Text style={styles.secondaryButtonText}>Open full thread</Text>
                          </TouchableOpacity>
                        }
                      />
                      {!(thread.messages || []).some((message) => message.sender_type === "keepr_pro") ? (
                        <Text style={styles.emptyStateText}>Wilson has not replied yet.</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              ) : (
                <EmptyBlock
                  icon="chatbubble-outline"
                  title="No shared message thread"
                  body="Only provider-scoped Harris/Wilson threads appear here."
                />
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Relationship files</Text>
                <TouchableOpacity
                  style={[styles.inlineButton, uploadingFile && styles.disabled]}
                  onPress={addSharedFile}
                  disabled={uploadingFile}
                  activeOpacity={0.86}
                >
                  {uploadingFile ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="add-outline" size={16} color={colors.primary} />
                  )}
                  <Text style={styles.inlineButtonText}>Add file</Text>
                </TouchableOpacity>
              </View>
              {sharedFiles.length ? (
                sharedFiles.map((file) => (
                  <TouchableOpacity
                    key={file.attachment_id || file.placement_id}
                    style={styles.row}
                    onPress={() => openSharedFile(file)}
                    activeOpacity={0.86}
                  >
                    <Ionicons name="attach-outline" size={18} color="#2563EB" />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{file.title || file.file_name}</Text>
                      <Text style={styles.rowMeta}>{file.created_at ? formatDate(file.created_at) : "Shared file"}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <EmptyBlock
                  icon="attach-outline"
                  title="No files yet"
                  body="Photos, invoices, receipts, and quotes appear here after they are shared in the relationship."
                />
              )}
            </View>
              </>
            )}
          </>
        )}
      </ScrollView>
      <AttachmentViewerModal
        visible={!!viewerAttachment}
        attachment={viewerAttachment}
        collection={viewerAttachment ? [viewerAttachment] : []}
        index={0}
        onClose={() => setViewerAttachment(null)}
        assetName={asset.name}
        assetId={asset.id}
        recordId={null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    paddingVertical: spacing.md,
  },
  headerMessageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginLeft: "auto",
    ...shadows.card,
  },
  headerMessageButtonText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "900",
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: 4,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  viewModeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  viewModeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  viewModeChips: {
    flexDirection: "row",
    gap: 8,
  },
  viewModeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
  },
  viewModeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  viewModeChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  viewModeChipTextActive: {
    color: "#FFFFFF",
  },
  visualHero: {
    minHeight: 340,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#DBEAFE",
    justifyContent: "flex-end",
    ...shadows.card,
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  heroOverlay: {
    padding: spacing.lg,
    backgroundColor: "rgba(15, 23, 42, 0.58)",
  },
  heroContext: {
    ...typography.caption,
    color: "#DBEAFE",
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroTitle: {
    ...typography.h1,
    color: "#FFFFFF",
    marginTop: 4,
  },
  heroMeta: {
    ...typography.body,
    color: "#E5E7EB",
    marginTop: 4,
  },
  visualGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  fileStrip: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#F8FAFC",
    padding: spacing.sm,
    gap: spacing.sm,
  },
  fileStripHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  fileStripTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  fileStripSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  fileStripList: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  fileStripEmpty: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  fileChip: {
    width: 220,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#FFFFFF",
    padding: spacing.sm,
  },
  fileChipTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  fileChipTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  fileChipMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  whatNextCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  whatNextHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  workActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  whatNextTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: 2,
  },
  whatNextBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statusPill: {
    borderRadius: 999,
    backgroundColor: "#DBEAFE",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  statusPillText: {
    ...typography.caption,
    color: "#1D4ED8",
    fontWeight: "800",
  },
  serviceStateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryItem: {
    flex: 1,
    minWidth: 180,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  summaryItemWide: {
    flexGrow: 2,
    flexBasis: 320,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  serviceStateItem: {
    flex: 1,
    minWidth: 170,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  descriptionPanel: {
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
    gap: 4,
  },
  originalRequestBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  originalRequestToggle: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  originalRequestToggleText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: "800",
  },
  originalRequestText: {
    ...typography.caption,
    color: colors.textSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  operationPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 86,
    textAlignVertical: "top",
  },
  replyInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  statusChoiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statusChoice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: "#FFFFFF",
  },
  statusChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: "#DBEAFE",
  },
  statusChoiceText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  statusChoiceTextActive: {
    color: colors.primary,
  },
  operationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  primaryButtonText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  inlineButton: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inlineButtonText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.65,
  },
  replyComposer: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  emptyStateRow: {
    gap: 4,
  },
  emptyStateText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  visualPanel: {
    flex: 1,
    minWidth: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  visualValue: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  visualMuted: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  panelButton: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
  },
  visualSystemPill: {
    minHeight: 40,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  visualSystemText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  listViewLabel: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  listViewText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitleBlock: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  count: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  detailItem: {
    width: "48%",
    minWidth: 170,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  messageThreadPreview: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  messageBubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxWidth: "82%",
  },
  messageMine: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary,
  },
  messageOther: {
    alignSelf: "flex-start",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  messageMetaMine: {
    color: "rgba(255,255,255,0.82)",
  },
  messageText: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },
  messageTextMine: {
    color: "#FFFFFF",
  },
  emptyBlock: {
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.lg,
  },
  emptyTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
