import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { buildPrivateKeeprProActionPrefill } from "../lib/keeprProEngagement";
import {
  buildMessagesNavigationParams,
  startOwnerKeeprProRelationshipThread,
} from "../lib/messagesService";
import { getKeeprSpaceOrgConfig } from "../lib/keeprspaceApi";
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

function listFromValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function cleanId(value) {
  return value ? String(value).trim() : "";
}

function serviceLabel(service) {
  if (typeof service === "string") return service;
  return service?.owner_facing_label || service?.name || service?.label || "Service";
}

function serviceDescription(service) {
  if (!service || typeof service === "string") return "";
  return service.owner_facing_description || service.description || service.short_description || "";
}

function serviceEstimateLabel(service) {
  if (!service || typeof service === "string") return null;
  const metadata = service.metadata || {};
  if (metadata.price_label) return metadata.price_label;
  if (metadata.estimate_label) return metadata.estimate_label;
  if (metadata.estimate_required || service.estimate_required) return "Estimate required";
  if (service.price_label) return service.price_label;
  return null;
}

function serviceItems(service) {
  if (!service || typeof service === "string") return [];
  const metadata = service.metadata || {};
  const template = metadata.service_template || metadata;
  const items = Array.isArray(template.service_items)
    ? template.service_items
    : Array.isArray(template.checklist_items)
    ? template.checklist_items
    : Array.isArray(service.service_items)
    ? service.service_items
    : [];
  return items
    .map((item) => {
      if (typeof item === "string") return { label: item };
      if (item && typeof item === "object") {
        return {
          ...item,
          label: item.label || item.title || item.name || "",
        };
      }
      return null;
    })
    .filter((item) => item?.label);
}

function serviceKey(service) {
  if (typeof service === "string") return service;
  return (
    service?.id ||
    service?.slug ||
    service?.service_key ||
    service?.key ||
    serviceLabel(service)
  );
}

function normalizeLegacyOffering(item) {
  if (item && typeof item === "object") return item;
  return {
    id: null,
    name: String(item || "Service"),
    owner_facing_label: String(item || "Service"),
    status: "active",
    visibility: "owner_portal",
    is_legacy_profile_offering: true,
  };
}

function buildServiceTemplateSnapshot(service) {
  if (!service) return null;
  return {
    id: service.id || null,
    slug: service.slug || null,
    key: service.service_key || service.key || service.slug || service.id || serviceLabel(service),
    name: service.name || serviceLabel(service),
    label: serviceLabel(service),
    service_type: service.service_type || null,
    asset_system_type: service.asset_system_type || service.metadata?.asset_system_type || null,
    brand_applicability: service.brand_applicability || service.metadata?.brand_applicability || null,
    interval_trigger: service.interval_trigger || service.metadata?.interval_trigger || null,
    owner_facing_description: serviceDescription(service) || null,
    service_items: serviceItems(service),
    relationship_purposes: listFromValue(service.relationship_purposes),
    supported_asset_types: listFromValue(service.supported_asset_types),
    status: service.status || "active",
  };
}

export default function PublicKeeprProProfileScreen({ route, navigation }) {
  const slug = route?.params?.slug || "wilsonmarine";
  const assetContext = route?.params?.assetContext || null;
  const [profile, setProfile] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [error, setError] = useState(null);
  const [configuredServices, setConfiguredServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState(null);
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

  useEffect(() => {
    let active = true;
    const orgId = cleanId(profile?.organization?.id);
    if (!orgId || profile?.claimed_state !== "claimed") {
      setConfiguredServices([]);
      setServicesError(null);
      setServicesLoading(false);
      return () => {
        active = false;
      };
    }

    setServicesLoading(true);
    setServicesError(null);
    getKeeprSpaceOrgConfig({ organizationId: orgId })
      .then((config) => {
        if (!active) return;
        const services = Array.isArray(config?.service_offerings)
          ? config.service_offerings
          : [];
        const ownerVisibleServices = services.filter((service) => {
          const status = String(service?.status || "active").toLowerCase();
          const visibility = String(service?.visibility || "owner_portal").toLowerCase();
          return status === "active" && visibility !== "internal";
        });
        setConfiguredServices(ownerVisibleServices);
      })
      .catch((err) => {
        if (!active) return;
        console.log("Owner-facing KeeprSpace services unavailable:", err?.message || err);
        setConfiguredServices([]);
        setServicesError(err?.message || "Could not load configured Services.");
      })
      .finally(() => {
        if (active) setServicesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [profile?.claimed_state, profile?.organization?.id]);

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
    () => {
      if (configuredServices.length) return configuredServices;
      const legacyOfferings = offerings.length
        ? offerings
        : ["Marine Service", "Winterization", "Storage", "Commissioning"];
      return legacyOfferings.map(normalizeLegacyOffering);
    },
    [configuredServices, offerings]
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

  const requestService = (service) => {
    if (!hasAssetContext || !profile?.id) return;
    if (!isLiveDestination) {
      Alert.alert("Provider unavailable", "This provider is not ready for service requests yet.");
      return;
    }

    const label = serviceLabel(service);
    const description = serviceDescription(service);
    const snapshot = buildServiceTemplateSnapshot(service);
    const providerOrgId = profile?.organization?.id || null;
    const prefill = buildPrivateKeeprProActionPrefill({
      actionTitle: `${label}: ${assetName}`,
      actionMessage: description || `Request ${label} from ${profile.display_name}.`,
      assetId: assetContext.assetId,
      assetName,
      keeprProId: profile.id,
      keeprProLabel: profile.display_name,
      assignmentScope: "asset",
      sourceScreen: "owner_claimed_keeprpro_portal",
      contact: {
        profile_slug: profile.slug,
        relationship_id: relationshipId,
        provider_org_id: providerOrgId,
        thread_id: relationshipThreadId || null,
        service_offering_id: service?.id || null,
        service_offering_key: serviceKey(service),
        offering: label,
        kac,
      },
    });

    prefill.extra_metadata = {
      ...(prefill.extra_metadata || {}),
      provider_target: {
        ...(prefill.extra_metadata?.provider_target || {}),
        org_id: providerOrgId,
        organization_id: providerOrgId,
        stewardship_id: relationshipId || null,
        access_scope: "service_stewardship",
      },
      provider_access_scope: "service_stewardship",
      action_type: "service",
      service_action: true,
      service_offering: label,
      service_template_id: snapshot?.id || null,
      service_template_key: snapshot?.key || serviceKey(service),
      service_template_name: snapshot?.name || label,
      service_template_label: snapshot?.label || label,
      service_template_snapshot: snapshot,
      service_template_org_id: providerOrgId,
      relationship_id: relationshipId,
      asset_thread_id: relationshipThreadId || null,
      requested_from: "claimed_keeprpro_portal",
      requested_by_owner_name: ownerName,
    };

    navigation.navigate("CreateReminder", {
      assetId: assetContext.assetId,
      organizationId: providerOrgId,
      prefill,
      afterSave: "PublicKeeprProProfile",
      afterSaveParams: {
        slug,
        assetContext,
      },
    });
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
              {servicesLoading ? (
                <View style={styles.inlineStateRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.mutedText}>Loading Wilson Marine Services...</Text>
                </View>
              ) : null}
              {!configuredServices.length && servicesError ? (
                <Text style={styles.mutedText}>Published Services are shown while configured Services are unavailable.</Text>
              ) : null}
              <View style={styles.serviceGrid}>
                {offeringList.map((service) => {
                  const label = serviceLabel(service);
                  const description = serviceDescription(service);
                  const estimate = serviceEstimateLabel(service);
                  const items = serviceItems(service).slice(0, 3);
                  return (
                    <View key={`offering-${serviceKey(service)}`} style={styles.serviceCard}>
                      <View style={styles.serviceCardHeader}>
                        <View style={styles.serviceIcon}>
                          <Ionicons name="construct-outline" size={18} color="#2563EB" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.serviceTitle}>{label}</Text>
                          {estimate ? <Text style={styles.serviceMeta}>{estimate}</Text> : null}
                        </View>
                      </View>
                      <Text style={styles.serviceDescriptionText}>
                        {description || "Request this Service from Wilson Marine for your boat."}
                      </Text>
                      {items.length ? (
                        <View style={styles.serviceItemList}>
                          {items.map((item, index) => (
                            <Text key={`${item.label}-${index}`} style={styles.serviceItemText} numberOfLines={1}>
                              • {item.label}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.requestButton, (!hasAssetContext || !isLiveDestination) && styles.requestButtonDisabled]}
                        disabled={!hasAssetContext || !isLiveDestination}
                        onPress={() => requestService(service)}
                      >
                        <Text style={styles.requestButtonText}>Request Service</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
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
                  {offeringList.map((service) => (
                    <TouchableOpacity
                      key={`workspace-${serviceKey(service)}`}
                      style={[styles.chip, styles.clickableChip]}
                      onPress={() => requestService(service)}
                    >
                      <Text style={styles.chipText}>{serviceLabel(service)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
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
  inlineStateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  serviceCard: {
    flexBasis: 220,
    flexGrow: 1,
    minWidth: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    gap: spacing.sm,
  },
  serviceCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  serviceIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  serviceMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    marginTop: 2,
  },
  serviceDescriptionText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  serviceItemList: {
    gap: 3,
  },
  serviceItemText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  requestButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs || 4,
  },
  requestButtonDisabled: {
    opacity: 0.5,
  },
  requestButtonText: {
    ...typography.caption,
    color: "#1D4ED8",
    fontWeight: "900",
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
