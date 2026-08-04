import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
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
import * as ImagePicker from "expo-image-picker";

import { supabase } from "../lib/supabaseClient";
import { buildPrivateKeeprProActionPrefill } from "../lib/keeprProEngagement";
import {
  buildMessagesNavigationParams,
  sendThreadReply,
  startOwnerKeeprProRelationshipThread,
} from "../lib/messagesService";
import { createServiceRequestNotification } from "../lib/notificationsService";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

function contactRows(profile) {
  return [
    profile?.phone ? { icon: "call-outline", label: profile.phone, href: `tel:${profile.phone}` } : null,
    profile?.email ? { icon: "mail-outline", label: profile.email, href: `mailto:${profile.email}` } : null,
    profile?.website ? { icon: "globe-outline", label: profile.website, href: profile.website } : null,
    profile?.location ? { icon: "location-outline", label: profile.location } : null,
  ].filter(Boolean);
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanId(value) {
  return value ? String(value).trim() : "";
}

export default function PublicKeeprProProfileScreen({ route, navigation }) {
  const slug = route?.params?.slug || "wilsonmarine";
  const assetContext = route?.params?.assetContext || null;
  const [profile, setProfile] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedOffering, setSelectedOffering] = useState(null);
  const [requestText, setRequestText] = useState("");
  const [preferredTiming, setPreferredTiming] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [startingThread, setStartingThread] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: rpcError } = await supabase.rpc("get_public_keeprpro_profile", {
          p_slug: slug,
        });
        if (rpcError) throw rpcError;
        if (!active) return;
        setProfile(data || null);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Could not load this KeeprPro profile.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    let active = true;

    const loadRelationship = async () => {
      const assetId = cleanId(assetContext?.assetId);
      const orgId = cleanId(profile?.organization?.id);
      if (!assetId || !orgId || profile?.claimed_state !== "claimed") {
        if (active) setRelationship(null);
        return;
      }

      setRelationshipLoading(true);
      try {
        const { data: stewardship, error: stewardshipError } = await supabase
          .from("asset_provider_stewardships")
          .select("id,asset_id,keepr_pro_id,organization_id,relationship_type,access_scope,status")
          .eq("asset_id", assetId)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .eq("access_scope", "service_stewardship")
          .maybeSingle();
        if (stewardshipError) throw stewardshipError;

        const { data: thread, error: threadError } = await supabase
          .from("asset_threads")
          .select("id,asset_id,keepr_pro_id,owner_id,subject,status,updated_at")
          .eq("asset_id", assetId)
          .eq("keepr_pro_id", profile.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (threadError) throw threadError;

        const { data: actions, error: actionError } = await supabase
          .from("reminders")
          .select("id,title,status,due_at,updated_at,preferred_provider_id,extra_metadata")
          .eq("asset_id", assetId)
          .not("status", "in", "(completed,deleted,archived)")
          .order("updated_at", { ascending: false })
          .limit(12);
        if (actionError && !String(actionError.message || "").includes("preferred_provider_id")) {
          throw actionError;
        }

        const action = (actions || []).find((row) => {
          const providerTarget = row?.extra_metadata?.provider_target || {};
          return (
            row?.preferred_provider_id === profile.id ||
            providerTarget.id === profile.id ||
            providerTarget.organization_id === orgId ||
            providerTarget.stewardship_id === stewardship?.id
          );
        }) || null;

        const { data: members, error: membersError } = await supabase
          .from("org_members")
          .select("user_id,role,member_role")
          .eq("org_id", orgId)
          .limit(1);
        if (membersError) throw membersError;

        if (active) {
          setRelationship({
            relationship: stewardship || null,
            thread: thread || null,
            action: actionError ? null : action || null,
            providerMember: (members || [])[0] || null,
          });
        }
      } catch (err) {
        console.log("Owner KeeprPro relationship load failed:", err);
        if (active) setRelationship(null);
      } finally {
        if (active) setRelationshipLoading(false);
      }
    };

    loadRelationship();
    return () => {
      active = false;
    };
  }, [assetContext?.assetId, profile?.claimed_state, profile?.organization?.id]);

  const rows = contactRows(profile);
  const isClaimed = profile?.claimed_state === "claimed";
  const isPublished = profile?.publish_status === "published" || profile?.publish_status === "demo";
  const hasAssetContext = !!cleanId(assetContext?.assetId);
  const isLiveDestination = isClaimed && isPublished;
  const categories = asList(profile?.categories);
  const locations = asList(profile?.locations);
  const offerings = asList(profile?.service_offerings);
  const packages = asList(profile?.packages);
  const offeringList = useMemo(
    () => (offerings.length ? offerings : ["Marine Service", "Winterization", "Storage", "Commissioning"]),
    [offerings]
  );
  const relationshipThreadId = relationship?.thread?.id || relationship?.projection_thread?.id || null;
  const relationshipActionId = relationship?.action?.id || null;
  const relationshipId = relationship?.relationship?.id || null;
  const providerMemberId = relationship?.providerMember?.user_id || null;
  const assetName = assetContext?.assetName || relationship?.asset?.name || "this asset";
  const ownerName = assetContext?.ownerName || relationship?.owner?.display_name || "Owner";
  const kac = assetContext?.kac || relationship?.asset?.kac || relationship?.asset?.kac_id || null;

  const openMessages = async () => {
    if (!hasAssetContext || !profile?.id) return;
    let threadId = relationshipThreadId;
    if (!threadId) {
      if (!relationshipId) {
        Alert.alert("No relationship", "This asset is not connected to Wilson Marine yet.");
        return;
      }
      setStartingThread(true);
      try {
        const started = await startOwnerKeeprProRelationshipThread({
          assetId: assetContext.assetId,
          assetName,
          kac,
          keeprProId: profile.id,
          keeprProName: profile.display_name,
          organizationId: profile?.organization?.id || null,
          stewardshipId: relationshipId,
          providerMemberId,
          ownerId: assetContext.ownerId || null,
        });
        threadId = started?.thread?.id || null;
        setRelationship((prev) => ({
          ...(prev || {}),
          thread: started?.thread || null,
        }));
      } catch (err) {
        Alert.alert("Could not start conversation", err?.message || "Please try again.");
        return;
      } finally {
        setStartingThread(false);
      }
    }
    if (!threadId) return;
    navigation.navigate("RootTabs", {
      screen: "Messages",
      params: buildMessagesNavigationParams({
        scope: "asset",
        assetId: assetContext.assetId,
        assetName,
        parentAssetKac: kac,
        keeprProId: profile?.id,
        keeprProName: profile?.display_name,
        threadId,
        backRoute: "PublicKeeprProProfile",
        backParams: {
          slug,
          assetContext,
        },
      }),
    });
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission?.status && permission.status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images,
      quality: 0.85,
    });
    const asset = result?.assets?.[0];
    if (asset?.uri) {
      setPendingAttachments((prev) => [
        ...prev,
        {
          uri: asset.uri,
          fileName: asset.fileName || "photo.jpg",
          mimeType: asset.mimeType || "image/jpeg",
          fileSize: asset.fileSize || null,
          kind: "photo",
        },
      ]);
    }
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    const asset = result?.assets?.[0];
    if (asset?.uri) {
      setPendingAttachments((prev) => [
        ...prev,
        {
          uri: asset.uri,
          fileName: asset.name || "attachment",
          mimeType: asset.mimeType || null,
          fileSize: asset.size || null,
          kind: "file",
        },
      ]);
    }
  };

  const submitServiceRequest = async () => {
    if (!selectedOffering || !hasAssetContext || !profile?.id) return;
    const cleanRequest = requestText.trim();
    if (!cleanRequest) {
      Alert.alert("Request needed", "Add a short note for Wilson Marine.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const ownerId = assetContext.ownerId || authData?.user?.id || null;
      if (!ownerId) throw new Error("You need to be signed in.");

      const prefill = buildPrivateKeeprProActionPrefill({
        actionTitle: `${selectedOffering}: ${assetName}`,
        actionMessage: [cleanRequest, preferredTiming.trim() ? `Preferred timing: ${preferredTiming.trim()}` : null]
          .filter(Boolean)
          .join("\n"),
        assetId: assetContext.assetId,
        assetName,
        keeprProId: profile.id,
        keeprProLabel: profile.display_name,
        assignmentScope: "asset",
        sourceScreen: "owner_claimed_keeprpro_portal",
        contact: {
          profile_slug: profile.slug,
          relationship_id: relationshipId,
          provider_org_id: profile?.organization?.id || null,
          thread_id: relationshipThreadId || null,
          offering: selectedOffering,
          kac,
        },
      });

      let threadId = relationshipThreadId || null;
      if (!threadId && relationshipId) {
        const started = await startOwnerKeeprProRelationshipThread({
          assetId: assetContext.assetId,
          assetName,
          kac,
          keeprProId: profile.id,
          keeprProName: profile.display_name,
          organizationId: profile?.organization?.id || null,
          stewardshipId: relationshipId,
          providerMemberId,
          ownerId,
        });
        threadId = started?.thread?.id || null;
        setRelationship((prev) => ({
          ...(prev || {}),
          thread: started?.thread || null,
        }));
      }

      const extraMetadata = {
        ...(prefill.extra_metadata || {}),
        provider_target: {
          ...(prefill.extra_metadata?.provider_target || {}),
          organization_id: profile?.organization?.id || null,
          stewardship_id: relationshipId || null,
          access_scope: "service_stewardship",
        },
        provider_access_scope: "service_stewardship",
        service_offering: selectedOffering,
        relationship_id: relationshipId,
        asset_thread_id: threadId || null,
        requested_from: "claimed_keeprpro_portal",
        requested_by_owner_name: ownerName,
      };

      const { data: saved, error: insertError } = await supabase
        .from("reminders")
        .insert({
          owner_id: ownerId,
          title: prefill.title,
          notes: prefill.notes,
          due_at: prefill.due_at,
          has_time: prefill.has_time,
          is_urgent: prefill.is_urgent,
          repeat_rule: prefill.repeat_rule,
          status: "open",
          asset_id: assetContext.assetId,
          system_id: null,
          preferred_provider_id: profile.id,
          extra_metadata: extraMetadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      if (threadId) {
        await sendThreadReply(threadId, `${selectedOffering}: ${cleanRequest}`, {
          assetId: assetContext.assetId,
          kac,
          organizationId: profile?.organization?.id || null,
          stewardshipId: relationshipId,
          actionId: saved?.id || null,
          pendingAttachments,
          suppressNotification: true,
        });
      }

      await createServiceRequestNotification({
        actorUserId: ownerId,
        assetId: assetContext.assetId,
        kac,
        organizationId: profile?.organization?.id || null,
        stewardshipId: relationshipId,
        actionId: saved?.id || null,
        threadId,
        title: `${selectedOffering} request`,
        body: `${ownerName || "Customer"} requested ${selectedOffering} for ${assetName}.`,
      });

      setSelectedOffering(null);
      setRequestText("");
      setPreferredTiming("");
      setPendingAttachments([]);
      Alert.alert("Request sent", "Wilson Marine will see this in Needs Attention.");
    } catch (err) {
      Alert.alert("Could not send request", err?.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading profile...</Text>
          </View>
        ) : error || !profile ? (
          <View style={styles.stateCard}>
            <Ionicons name="search-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>Profile not found</Text>
            <Text style={styles.stateText}>{error || "This KeeprPro profile is not public."}</Text>
          </View>
        ) : (
          <>
            <View style={styles.headerBand}>
              {profile.header_image_url ? (
                <Image source={{ uri: profile.header_image_url }} style={styles.headerImage} resizeMode="cover" />
              ) : null}
              <View style={styles.avatar}>
                {profile.logo_url ? (
                  <Image source={{ uri: profile.logo_url }} style={styles.logoImage} resizeMode="contain" />
                ) : (
                  <Ionicons name="boat-outline" size={34} color="#2563EB" />
                )}
              </View>
            </View>

            <View style={styles.profileBlock}>
              <Text style={styles.eyebrow}>{hasAssetContext ? "Wilson Marine Portal" : "KeeprPro profile"}</Text>
              <Text style={styles.title}>{profile.display_name}</Text>
              <View style={styles.claimRow}>
                <Ionicons
                  name={isClaimed ? "shield-checkmark-outline" : "shield-outline"}
                  size={16}
                  color={isClaimed ? "#16A34A" : colors.textSecondary}
                />
                <Text style={styles.claimText}>
                  {isClaimed ? "Claimed profile" : "Claim this profile"}
                </Text>
              </View>
              <Text style={styles.description}>
                {profile.public_description || profile.short_description || "KeeprPro service provider profile."}
              </Text>
              {hasAssetContext && isLiveDestination ? (
                <View style={styles.contextCard}>
                  <Text style={styles.contextKicker}>Relationship context</Text>
                  <Text style={styles.contextTitle}>{ownerName} ↔ {profile.display_name}</Text>
                  <Text style={styles.contextText}>{assetName}{kac ? ` · ${kac}` : ""}</Text>
                  <Text style={styles.contextText}>
                    {relationshipLoading
                      ? "Loading current workspace..."
                      : relationshipId
                      ? "Existing stewardship relationship connected."
                      : "No active relationship projection found."}
                  </Text>
                </View>
              ) : null}
              {categories.length ? (
                <View style={styles.chipRow}>
                  {categories.map((item) => (
                    <View key={item} style={styles.chip}>
                      <Text style={styles.chipText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Contact</Text>
              {rows.map((row) => (
                <TouchableOpacity
                  key={`${row.icon}-${row.label}`}
                  style={styles.contactRow}
                  activeOpacity={row.href ? 0.8 : 1}
                  onPress={() => {
                    if (row.href) Linking.openURL(row.href);
                  }}
                >
                  <Ionicons name={row.icon} size={18} color="#2563EB" />
                  <Text style={styles.contactText}>{row.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Locations</Text>
              {locations.length ? (
                locations.map((location, index) => (
                  <View key={`${location.label || location.city || "location"}-${index}`} style={styles.contactRow}>
                    <Ionicons name="location-outline" size={18} color="#2563EB" />
                    <Text style={styles.contactText}>
                      {location.label || [location.city, location.state].filter(Boolean).join(", ")}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedText}>{profile.location || "No locations published yet."}</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Service Offerings</Text>
              <View style={styles.chipRow}>
                {offeringList.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[styles.chip, hasAssetContext && isLiveDestination && styles.clickableChip]}
                    disabled={!hasAssetContext || !isLiveDestination}
                    onPress={() => setSelectedOffering(item)}
                  >
                    <Text style={styles.chipText}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Packages / Playbooks</Text>
              <Text style={styles.mutedText}>
                {packages.length ? packages.join(" · ") : "No packages or Playbooks are published yet."}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Request Service</Text>
              {hasAssetContext && isLiveDestination ? (
                <Text style={styles.mutedText}>Choose an offering above to start from the Harris/Wilson workspace.</Text>
              ) : (
                <TouchableOpacity style={styles.disabledButton} activeOpacity={1} disabled>
                  <Ionicons name="construct-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.disabledButtonText}>
                    {isLiveDestination ? "Open from an asset to request service" : "Invite or contact provider"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {hasAssetContext && isLiveDestination ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Relationship Workspace</Text>
                <Text style={styles.contextKicker}>Current work</Text>
                <Text style={styles.contextTitle}>
                  {relationshipActionId ? relationship?.action?.title || "Active service request" : "No active service request"}
                </Text>
                <Text style={[styles.contextKicker, styles.sectionKicker]}>Conversation</Text>
                <TouchableOpacity
                  style={[styles.primaryButton, (startingThread || relationshipLoading || !relationshipId) && styles.primaryButtonDisabled]}
                  onPress={openMessages}
                  disabled={startingThread || relationshipLoading || !relationshipId}
                >
                  {startingThread ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFFFFF" />
                  )}
                  <Text style={styles.primaryButtonText}>
                    {relationshipThreadId ? "Continue conversation with Wilson Marine" : "Start conversation with Wilson Marine"}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.contextKicker, styles.sectionKicker]}>Start service</Text>
                <View style={styles.chipRow}>
                  {offeringList.map((item) => (
                    <TouchableOpacity key={`workspace-${item}`} style={[styles.chip, styles.clickableChip]} onPress={() => setSelectedOffering(item)}>
                      <Text style={styles.chipText}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <Modal visible={!!selectedOffering} transparent animationType="fade" onRequestClose={() => setSelectedOffering(null)}>
              <View style={styles.modalBackdrop}>
                <View style={styles.modalCard}>
                  <Text style={styles.eyebrow}>Request Service</Text>
                  <Text style={styles.modalTitle}>{selectedOffering}</Text>
                  <Text style={styles.contextText}>{assetName}{kac ? ` · ${kac}` : ""}</Text>
                  <TextInput
                    style={styles.input}
                    value={requestText}
                    onChangeText={setRequestText}
                    placeholder="What do you need Wilson Marine to do?"
                    multiline
                  />
                  <TextInput
                    style={styles.singleInput}
                    value={preferredTiming}
                    onChangeText={setPreferredTiming}
                    placeholder="Preferred timing (optional)"
                  />
                  <View style={styles.attachmentRow}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={pickPhoto} disabled={submitting}>
                      <Ionicons name="image-outline" size={17} color={colors.primary} />
                      <Text style={styles.secondaryButtonText}>Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryButton} onPress={pickFile} disabled={submitting}>
                      <Ionicons name="document-attach-outline" size={17} color={colors.primary} />
                      <Text style={styles.secondaryButtonText}>File</Text>
                    </TouchableOpacity>
                  </View>
                  {pendingAttachments.length ? (
                    <View style={styles.pendingList}>
                      {pendingAttachments.map((attachment, index) => (
                        <View key={`${attachment.uri}-${index}`} style={styles.pendingItem}>
                          <Ionicons name={attachment.kind === "photo" ? "image-outline" : "document-outline"} size={15} color={colors.primary} />
                          <Text style={styles.pendingText} numberOfLines={1}>{attachment.fileName || attachment.name || "Attachment"}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => setSelectedOffering(null)} disabled={submitting}>
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primaryButton} onPress={submitServiceRequest} disabled={submitting}>
                      <Ionicons name="send-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>{submitting ? "Sending..." : "Submit"}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </>
        )}
      </ScrollView>
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
  headerBand: {
    minHeight: 150,
    borderRadius: radius.md,
    backgroundColor: "#DBEAFE",
    justifyContent: "flex-end",
    padding: spacing.lg,
    overflow: "hidden",
  },
  headerImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  logoImage: {
    width: "100%",
    height: "100%",
  },
  profileBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: 4,
  },
  claimRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  claimText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  contextCard: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  contextKicker: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  contextTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  contextText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionKicker: {
    marginTop: spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipText: {
    ...typography.caption,
    color: "#1D4ED8",
    fontWeight: "800",
  },
  clickableChip: {
    borderColor: "#2563EB",
    backgroundColor: "#DBEAFE",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  contactText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  mutedText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  disabledButton: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#F8FAFC",
  },
  disabledButtonText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    ...typography.body,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  input: {
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    textAlignVertical: "top",
    ...typography.body,
    color: colors.textPrimary,
  },
  singleInput: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  attachmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  pendingList: {
    gap: spacing.xs || 6,
  },
  pendingItem: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  pendingText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "700",
    flex: 1,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
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
