import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
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
import * as ImagePicker from "expo-image-picker";

import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

function compact(values) {
  return values.filter(Boolean).join(" · ");
}

function relationshipLabel(value) {
  if (value === "servicing_dealer") return "Servicing dealer";
  return String(value || "Provider").replace(/_/g, " ");
}

function assetDescriptor(asset) {
  return compact([asset.year, asset.make, asset.model]) || asset.asset_type || "Asset";
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function listFromValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function profileDraftFromContext(context) {
  return {
    display_name: context?.display_name || "",
    slug: context?.keepr_pro_slug || "",
    short_description: context?.short_description || "",
    public_description: context?.public_description || "",
    phone: context?.phone || "",
    email: context?.email || "",
    website: context?.website || "",
    location: context?.location || "",
    logo_url: context?.logo_url || "",
    header_image_url: context?.header_image_url || "",
    publish_status: context?.publish_status || "draft",
    categories: listFromValue(context?.categories || context?.category).join(", "),
    locations: Array.isArray(context?.locations)
      ? context.locations
          .map((item) => item?.label || [item?.city, item?.state].filter(Boolean).join(", "))
          .filter(Boolean)
          .join(", ")
      : context?.location || "",
    service_offerings: listFromValue(context?.service_offerings).join(", "),
    packages: listFromValue(context?.packages).join(", "),
  };
}

function EmptySection({ title, body }) {
  return (
    <View style={styles.emptySection}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{body}</Text>
    </View>
  );
}

const PRO_TABS = [
  { key: "needs", label: "Needs Attention", icon: "alert-circle-outline" },
  { key: "portfolio", label: "Portfolio", icon: "boat-outline" },
  { key: "messages", label: "Messages", icon: "chatbubble-ellipses-outline" },
  { key: "profile", label: "Profile", icon: "person-circle-outline" },
];

export default function KeeprProHomeScreen({ navigation }) {
  const [workspace, setWorkspace] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("needs");
  const [assetViewMode, setAssetViewMode] = useState("list");
  const [assetHeroUrls, setAssetHeroUrls] = useState({});
  const [profileMode, setProfileMode] = useState("view");
  const [profileDraft, setProfileDraft] = useState(profileDraftFromContext(null));
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_keeprpro_portfolio_workspace",
        {
          p_organization_id: null,
          p_search: search.trim() || null,
          p_limit: 50,
          p_offset: 0,
        }
      );
      if (rpcError) throw rpcError;
      setWorkspace(data || null);
    } catch (err) {
      console.error("KeeprPro portfolio load failed:", err);
      setError(err?.message || "Could not load Pro Mode.");
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const context = workspace?.context || null;
  const assets = workspace?.assets || [];
  const openActions = workspace?.open_actions || [];
  const recentMessages = workspace?.recent_messages || [];
  const upcomingWork = workspace?.upcoming_work || [];
  const recentServiceActivity = workspace?.recent_service_activity || [];

  useEffect(() => {
    if (context) setProfileDraft(profileDraftFromContext(context));
  }, [context]);
  const assetsById = useMemo(
    () => Object.fromEntries(assets.map((asset) => [asset.asset_id, asset])),
    [assets]
  );
  const needsAttentionItems = useMemo(() => {
    const actionItems = openActions.map((item) => ({
      ...item,
      item_type: "action",
      queue_label: item.due_at ? "Scheduled Soon" : "New Request",
      sort_at: item.due_at || item.updated_at || item.created_at || null,
    }));
    const messageItems = recentMessages.map((item) => ({
      ...item,
      item_type: "message",
      title: item.subject || item.asset_name || "Customer message",
      queue_label: item.sender_type === "keepr_pro" ? "Waiting on Owner" : "Unread Message",
      sort_at: item.latest_message_at || item.updated_at || null,
    }));
    return [...actionItems, ...messageItems].sort((a, b) =>
      String(b.sort_at || "").localeCompare(String(a.sort_at || ""))
    );
  }, [openActions, recentMessages]);

  const statusText = useMemo(() => {
    if (!context) return "No active KeeprPro context";
    return compact([
      context.profile_status ? `Profile ${context.profile_status}` : null,
      context.claimed_state ? `Claim ${context.claimed_state}` : null,
      context.member_role ? `Role ${context.member_role}` : null,
    ]);
  }, [context]);

  useEffect(() => {
    let active = true;

    async function signPortfolioHeroes() {
      const entries = await Promise.all(
        assets.map(async (asset) => {
          const hero = asset.hero_media;
          if (!hero?.bucket || !hero?.storage_path) return [asset.asset_id, null];

          try {
            const signed = await getSignedUrl({
              bucket: hero.bucket,
              path: hero.storage_path,
              expiresIn: 3600,
              transform: { width: 900, quality: 80 },
            });
            return [asset.asset_id, signed];
          } catch (err) {
            const publicUrl = supabase.storage
              .from(hero.bucket)
              .getPublicUrl(hero.storage_path)?.data?.publicUrl;
            return [asset.asset_id, publicUrl || null];
          }
        })
      );

      if (active) setAssetHeroUrls(Object.fromEntries(entries));
    }

    signPortfolioHeroes();
    return () => {
      active = false;
    };
  }, [assets]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const openAsset = (asset) => {
    navigation.navigate("KeeprProStewardshipView", {
      kac: asset.kac_id,
      assetId: asset.asset_id,
      organizationId: asset.organization_id,
      stewardshipId: asset.stewardship_id,
    });
  };

  const openWorkspaceForAssetId = (assetId) => {
    const asset = assetsById[assetId];
    if (asset) {
      openAsset(asset);
      return;
    }
    navigation.navigate("KeeprProStewardshipView", {
      assetId,
      organizationId: context?.organization_id,
    });
  };

  const renderAssetList = () => {
    if (!assets.length) {
      return (
        <EmptySection
          title="No connected assets"
          body="No stewarded customer assets match the current search."
        />
      );
    }

    if (assetViewMode === "visual") {
      return (
        <View style={styles.assetCardGrid}>
          {assets.map((asset) => (
            <TouchableOpacity
              key={asset.stewardship_id || asset.asset_id}
              style={styles.assetTile}
              activeOpacity={0.88}
              onPress={() => openAsset(asset)}
            >
              <View style={styles.assetTileMedia}>
                {assetHeroUrls[asset.asset_id] ? (
                  <Image
                    source={{ uri: assetHeroUrls[asset.asset_id] }}
                    style={styles.assetTileImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.assetTileFallback}>
                    <Ionicons
                      name={asset.asset_type === "boat" ? "boat-outline" : "cube-outline"}
                      size={34}
                      color="#2563EB"
                    />
                  </View>
                )}
                <View style={styles.assetStatusBadge}>
                  <Text style={styles.assetStatusBadgeText}>
                    {asset.portal_status || relationshipLabel(asset.relationship_type)}
                  </Text>
                </View>
              </View>
              <View style={styles.assetTileBody}>
                <Text style={styles.assetTitle}>{asset.asset_name}</Text>
                <Text style={styles.assetMeta}>{assetDescriptor(asset)}</Text>
                <Text style={styles.assetSubmeta} numberOfLines={2}>
                  {compact([
                    asset.owner_display_name,
                    relationshipLabel(asset.relationship_type),
                    asset.kac_id,
                  ])}
                </Text>
                <View style={styles.assetTileFooter}>
                  <View style={styles.assetTileMetric}>
                    <Text style={styles.assetMetricLabel}>What's Next</Text>
                    <Text style={styles.assetMetricValue} numberOfLines={1}>
                      {asset.what_next || "Open portal"}
                    </Text>
                  </View>
                  <View style={styles.assetTileCount}>
                    <Text style={styles.assetTileCountText}>{asset.open_action_count || 0}</Text>
                  </View>
                </View>
                {!!asset.recent_message_preview && (
                  <Text style={styles.assetMessagePreview} numberOfLines={1}>
                    {asset.recent_message_preview}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    return assets.map((asset) => (
      <TouchableOpacity
        key={asset.stewardship_id || asset.asset_id}
        style={styles.assetRow}
        activeOpacity={0.88}
        onPress={() => openAsset(asset)}
      >
        <View style={styles.assetIcon}>
          <Ionicons
            name={asset.asset_type === "boat" ? "boat-outline" : "cube-outline"}
            size={22}
            color="#2563EB"
          />
        </View>
        <View style={styles.assetBody}>
          <Text style={styles.assetTitle}>{asset.asset_name}</Text>
          <Text style={styles.assetMeta}>{assetDescriptor(asset)}</Text>
          <Text style={styles.assetSubmeta}>
            {compact([
              asset.owner_display_name,
              asset.kac_id,
              asset.make || asset.model ? compact([asset.make, asset.model]) : null,
              relationshipLabel(asset.relationship_type),
              asset.portal_status || "Connected",
              asset.recent_message_at ? `Last activity ${formatDate(asset.recent_message_at)}` : null,
            ])}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    ));
  };

  const renderSimpleRows = (items, { emptyTitle, emptyBody, icon, getTitle, getMeta, onPress }) => {
    if (!items.length) return <EmptySection title={emptyTitle} body={emptyBody} />;

    return items.map((item) => (
      <TouchableOpacity
        key={`${item.item_type || "item"}-${item.id}`}
        style={styles.simpleRow}
        activeOpacity={onPress ? 0.86 : 1}
        onPress={onPress ? () => onPress(item) : undefined}
      >
        <Ionicons name={icon} size={18} color="#2563EB" />
        <View style={styles.assetBody}>
          <Text style={styles.simpleTitle}>{getTitle(item)}</Text>
          <Text style={styles.simpleMeta}>{getMeta(item)}</Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /> : null}
      </TouchableOpacity>
    ));
  };

  const renderNeedsAttention = () => (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Needs Attention</Text>
          <Text style={styles.sectionSubtitle}>Who needs Wilson right now?</Text>
        </View>
        <Text style={styles.sectionCount}>{needsAttentionItems.length}</Text>
      </View>
      {renderSimpleRows(needsAttentionItems, {
        emptyTitle: "No active work needs attention",
        emptyBody: "Idle stewarded boats stay in Portfolio until there is a request, message, schedule, or service state to work.",
        icon: "alert-circle-outline",
        getTitle: (item) => item.title,
        getMeta: (item) =>
          compact([
            item.queue_label,
            item.asset_name,
            item.kac_id,
            item.latest_message || null,
            item.due_at ? `Due ${formatDate(item.due_at)}` : null,
          ]),
        onPress: (item) => openWorkspaceForAssetId(item.asset_id),
      })}
    </View>
  );

  const renderPortfolio = () => (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search asset, owner, KAC, make, model"
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Portfolio</Text>
            <Text style={styles.sectionSubtitle}>Stewardship customer database</Text>
          </View>
          <View style={styles.viewSwitch}>
            {[
              ["list", "List View"],
              ["visual", "Visual View"],
            ].map(([mode, label]) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.viewSwitchChip,
                  assetViewMode === mode && styles.viewSwitchChipActive,
                ]}
                activeOpacity={0.85}
                onPress={() => setAssetViewMode(mode)}
              >
                <Text
                  style={[
                    styles.viewSwitchText,
                    assetViewMode === mode && styles.viewSwitchTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Text style={styles.sectionCount}>{assets.length} connected</Text>
        {renderAssetList()}
      </View>
    </>
  );

  const renderMessages = () => (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Messages</Text>
          <Text style={styles.sectionSubtitle}>Customer conversations attached to a relationship</Text>
        </View>
        <Text style={styles.sectionCount}>{recentMessages.length}</Text>
      </View>
      {renderSimpleRows(recentMessages, {
        emptyTitle: "No shared messages",
        emptyBody: "Provider-scoped conversations appear here when a customer or Wilson message is connected to a stewarded asset.",
        icon: "chatbubble-ellipses-outline",
        getTitle: (item) => item.subject || item.asset_name || "Message thread",
        getMeta: (item) =>
          compact([
            item.asset_name,
            item.latest_message || "No messages yet",
            item.latest_message_at ? formatDate(item.latest_message_at) : null,
          ]),
        onPress: (item) => openWorkspaceForAssetId(item.asset_id),
      })}
    </View>
  );

  const publicProfileUrl = context?.keepr_pro_slug ? `/pro/${context.keepr_pro_slug}` : null;
  const categories = listFromValue(context?.categories || context?.category);
  const serviceOfferings = listFromValue(context?.service_offerings);
  const packages = listFromValue(context?.packages);
  const locations = Array.isArray(context?.locations)
    ? context.locations.filter((item) => item && (item.label || item.city || item.state || item.address_line1))
    : [];

  const renderProfileMasthead = () => (
    <View style={styles.profileHero}>
      {context?.header_image_url ? (
        <Image source={{ uri: context.header_image_url }} style={styles.profileCoverImage} resizeMode="cover" />
      ) : (
        <View style={styles.profileCoverFallback} />
      )}
      <View style={styles.profileHeroShade} />
      <View style={styles.profileHeroContent}>
        <View style={styles.profileLogo}>
          {context?.logo_url ? (
            <Image source={{ uri: context.logo_url }} style={styles.profileLogoImage} resizeMode="contain" />
          ) : (
            <Ionicons name="boat-outline" size={34} color="#2563EB" />
          )}
        </View>
        <View style={styles.profileHeroCopy}>
          <Text style={styles.profileHeroEyebrow}>KeeprPro identity</Text>
          <Text style={styles.profileHeroTitle}>{context?.display_name || "Wilson Marine"}</Text>
          <Text style={styles.profileHeroSubtitle}>
            {compact([
              context?.claimed_state === "claimed" ? "Claimed" : context?.claimed_state,
              context?.publish_status === "published" ? "Published" : context?.publish_status,
              context?.member_role ? `Role ${context.member_role}` : null,
            ])}
          </Text>
        </View>
      </View>
    </View>
  );

  const pickProfileImage = async (field) => {
    if (!context?.keepr_pro_id) return;
    try {
      setUploadingProfileImage(field);
      const pickerMediaTypes = ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: pickerMediaTypes,
        quality: 0.85,
      });
      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked) return;

      const fileExt =
        (picked.fileName && picked.fileName.split(".").pop()) ||
        (picked.mimeType && picked.mimeType.split("/").pop()) ||
        "jpg";
      const storagePath = `keeprpros/${context.keepr_pro_id}/${field}_${Date.now()}.${fileExt}`;
      const contentType = picked.mimeType || "image/jpeg";
      let uploadBody;
      if (Platform.OS === "web") {
        if (!picked.file) throw new Error("Web file object was not returned by the picker.");
        uploadBody = picked.file;
      } else {
        const response = await fetch(picked.uri);
        uploadBody = await response.blob();
      }
      const { error: uploadError } = await supabase.storage
        .from("org-images")
        .upload(storagePath, uploadBody, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicData } = supabase.storage.from("org-images").getPublicUrl(storagePath);
      const url = publicData?.publicUrl || null;
      if (!url) throw new Error("Could not get uploaded image URL.");
      setProfileDraft((prev) => ({ ...prev, [field]: url }));
    } catch (err) {
      Alert.alert("Upload failed", err?.message || "Could not upload this image.");
    } finally {
      setUploadingProfileImage(null);
    }
  };

  const saveProfile = async () => {
    if (!context?.keepr_pro_id || !context?.organization_id) return;
    setSavingProfile(true);
    try {
      const patch = {
        display_name: profileDraft.display_name,
        slug: profileDraft.slug,
        logo_url: profileDraft.logo_url,
        header_image_url: profileDraft.header_image_url,
        short_description: profileDraft.short_description,
        public_description: profileDraft.public_description,
        phone: profileDraft.phone,
        email: profileDraft.email,
        website: profileDraft.website,
        location: profileDraft.location,
        publish_status: profileDraft.publish_status,
        categories: listFromValue(profileDraft.categories),
        locations: listFromValue(profileDraft.locations).map((label) => ({ label })),
        service_offerings: listFromValue(profileDraft.service_offerings),
        packages: listFromValue(profileDraft.packages),
      };
      const { error: saveError } = await supabase.rpc("update_keeprpro_claimed_profile", {
        p_keepr_pro_id: context.keepr_pro_id,
        p_organization_id: context.organization_id,
        p_patch: patch,
      });
      if (saveError) throw saveError;
      setProfileMode("view");
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not save profile", err?.message || "Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const renderProfile = () => (
    <View style={styles.card}>
      {profileMode === "view" ? (
        <>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>{context?.display_name || "Wilson Marine"}</Text>
              <Text style={styles.sectionSubtitle}>Claimed professional identity</Text>
            </View>
            <TouchableOpacity style={styles.smallButton} onPress={() => setProfileMode("edit")} activeOpacity={0.86}>
              <Ionicons name="create-outline" size={16} color={colors.primary} />
              <Text style={styles.smallButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.profileStatusRow}>
            <View style={styles.statePill}>
              <Ionicons
                name={context?.claimed_state === "claimed" ? "shield-checkmark-outline" : "shield-outline"}
                size={15}
                color={context?.claimed_state === "claimed" ? "#16A34A" : colors.textSecondary}
              />
              <Text style={styles.statePillText}>{context?.claimed_state || "unclaimed"}</Text>
            </View>
            <View style={styles.statePill}>
              <Ionicons name={context?.verified ? "checkmark-circle-outline" : "ellipse-outline"} size={15} color="#2563EB" />
              <Text style={styles.statePillText}>{context?.verified ? "verified" : "not verified"}</Text>
            </View>
            <View style={styles.statePill}>
              <Ionicons name="radio-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.statePillText}>{context?.publish_status || "draft"}</Text>
            </View>
          </View>

          <Text style={styles.profileDescription}>
            {context?.public_description || context?.short_description || "No public description has been added yet."}
          </Text>

          <View style={styles.chipRow}>
            {(categories.length ? categories : ["marine"]).map((item) => (
              <View key={item} style={styles.infoChip}><Text style={styles.infoChipText}>{item}</Text></View>
            ))}
          </View>

          <View style={styles.profileGrid}>
            <View style={styles.profileFact}>
              <Text style={styles.assetMetricLabel}>Contact</Text>
              <Text style={styles.assetMetricValue}>{compact([context?.phone, context?.email]) || "Not published"}</Text>
              <Text style={styles.assetSubmeta}>{context?.website || "No website"}</Text>
            </View>
            <View style={styles.profileFact}>
              <Text style={styles.assetMetricLabel}>Locations</Text>
              <Text style={styles.assetMetricValue}>
                {locations[0]?.label || context?.location || "No location"}
              </Text>
              <Text style={styles.assetSubmeta}>
                {locations.length > 1 ? `${locations.length} locations` : "Primary service location"}
              </Text>
            </View>
            <View style={styles.profileFact}>
              <Text style={styles.assetMetricLabel}>Operator</Text>
              <Text style={styles.assetMetricValue}>{context?.organization_name || "Wilson Marine"}</Text>
              <Text style={styles.assetSubmeta}>Signed-in role: {context?.member_role || "member"}</Text>
            </View>
          </View>

          <View style={styles.profileSection}>
            <Text style={styles.cardLabel}>Service Offerings</Text>
            <View style={styles.chipRow}>
              {(serviceOfferings.length ? serviceOfferings : ["No offerings published"]).map((item) => (
                <View key={item} style={styles.infoChip}><Text style={styles.infoChipText}>{item}</Text></View>
              ))}
            </View>
          </View>

          <View style={styles.profileSection}>
            <Text style={styles.cardLabel}>Packages / Playbooks</Text>
            <Text style={styles.sectionSubtitle}>
              {packages.length ? packages.join(" · ") : "No packages or Playbooks are published yet."}
            </Text>
          </View>

          <View style={styles.profileActions}>
            <TouchableOpacity
              style={styles.secondaryActionButton}
              activeOpacity={0.86}
              onPress={() => {
                if (context?.keepr_pro_slug) navigation.navigate("PublicKeeprProProfile", { slug: context.keepr_pro_slug });
              }}
            >
              <Ionicons name="open-outline" size={16} color={colors.primary} />
              <Text style={styles.secondaryActionText}>Public profile preview</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <Text style={styles.sectionSubtitle}>Update Wilson Marine's claimed provider identity.</Text>
            </View>
          </View>
          <View style={styles.profileStatusRow}>
            <View style={styles.statePill}><Text style={styles.statePillText}>Claim: {context?.claimed_state || "unknown"}</Text></View>
            <View style={styles.statePill}><Text style={styles.statePillText}>ID: {context?.keepr_pro_id}</Text></View>
          </View>
          <View style={styles.uploadRow}>
            <TouchableOpacity style={styles.imageUploadBox} onPress={() => pickProfileImage("logo_url")}>
              {profileDraft.logo_url ? <Image source={{ uri: profileDraft.logo_url }} style={styles.uploadPreview} resizeMode="contain" /> : <Ionicons name="image-outline" size={24} color="#2563EB" />}
              <Text style={styles.uploadText}>{uploadingProfileImage === "logo_url" ? "Uploading..." : "Logo upload"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageUploadBoxWide} onPress={() => pickProfileImage("header_image_url")}>
              {profileDraft.header_image_url ? <Image source={{ uri: profileDraft.header_image_url }} style={styles.uploadPreviewWide} resizeMode="cover" /> : <Ionicons name="images-outline" size={24} color="#2563EB" />}
              <Text style={styles.uploadText}>{uploadingProfileImage === "header_image_url" ? "Uploading..." : "Cover image upload"}</Text>
            </TouchableOpacity>
          </View>
          {[
            ["display_name", "Business name"],
            ["slug", "Profile slug"],
            ["short_description", "Short description"],
            ["public_description", "Public description"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["website", "Website"],
            ["location", "Primary location"],
            ["categories", "Categories / tags"],
            ["locations", "Locations"],
            ["service_offerings", "Service offerings"],
            ["packages", "Packages / Playbooks"],
          ].map(([field, label]) => (
            <View key={field} style={styles.formField}>
              <Text style={styles.assetMetricLabel}>{label}</Text>
              <TextInput
                value={profileDraft[field]}
                onChangeText={(text) => setProfileDraft((prev) => ({ ...prev, [field]: text }))}
                style={[styles.profileInput, ["public_description", "service_offerings", "packages"].includes(field) && styles.profileTextArea]}
                multiline={["public_description", "service_offerings", "packages"].includes(field)}
                autoCapitalize={field === "slug" || field === "email" || field === "website" ? "none" : "sentences"}
              />
            </View>
          ))}
          <View style={styles.viewSwitch}>
            {["draft", "published"].map((status) => (
              <TouchableOpacity
                key={status}
                style={[styles.viewSwitchChip, profileDraft.publish_status === status && styles.viewSwitchChipActive]}
                onPress={() => setProfileDraft((prev) => ({ ...prev, publish_status: status }))}
              >
                <Text style={[styles.viewSwitchText, profileDraft.publish_status === status && styles.viewSwitchTextActive]}>{status}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.profileActions}>
            <TouchableOpacity style={styles.secondaryActionButton} onPress={() => { setProfileDraft(profileDraftFromContext(context)); setProfileMode("view"); }}>
              <Text style={styles.secondaryActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryActionButton, savingProfile && styles.disabled]} onPress={saveProfile} disabled={savingProfile}>
              {savingProfile ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <Text style={styles.primaryActionText}>{savingProfile ? "Saving..." : "Save Profile"}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.header}>
          <View style={styles.logoFallback}>
            {context?.logo_url ? (
              <Image source={{ uri: context.logo_url }} style={styles.headerLogoImage} resizeMode="contain" />
            ) : (
              <Ionicons name="boat-outline" size={28} color="#2563EB" />
            )}
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Pro Mode = portfolio</Text>
            <Text style={styles.title}>{context?.display_name || "Wilson Marine"}</Text>
            <Text style={styles.subtitle}>{statusText}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading portfolio...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons name="warning-outline" size={22} color="#B45309" />
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : !context ? (
          <View style={styles.stateCard}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>No KeeprPro context</Text>
            <Text style={styles.stateText}>
              This account is not an active member of a KeeprPro organization.
            </Text>
          </View>
        ) : (
          <>
            {renderProfileMasthead()}
            <View style={styles.contextCard}>
              <Text style={styles.cardLabel}>Active context</Text>
              <Text style={styles.cardTitle}>{context.organization_name}</Text>
              <Text style={styles.cardMeta}>
                KeeprPro operating context for customer stewardship.
              </Text>
              <Text style={styles.cardMeta}>
                Needs Attention is the daily queue. Portfolio is the searchable customer database. Messages are relationship conversations.
              </Text>
            </View>

            <View style={styles.primaryTabs}>
              {PRO_TABS.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.primaryTab, activeTab === tab.key && styles.primaryTabActive]}
                  activeOpacity={0.86}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Ionicons
                    name={tab.icon}
                    size={17}
                    color={activeTab === tab.key ? "#FFFFFF" : colors.textSecondary}
                  />
                  <Text style={[styles.primaryTabText, activeTab === tab.key && styles.primaryTabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {activeTab === "needs" ? renderNeedsAttention() : null}
            {activeTab === "portfolio" ? renderPortfolio() : null}
            {activeTab === "messages" ? renderMessages() : null}
            {activeTab === "profile" ? renderProfile() : null}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  logoFallback: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
    overflow: "hidden",
  },
  headerLogoImage: {
    width: "100%",
    height: "100%",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
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
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  contextCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  primaryTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  primaryTab: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  primaryTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  primaryTabText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  primaryTabTextActive: {
    color: "#FFFFFF",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  cardTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: 4,
  },
  cardMeta: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  searchWrap: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionCount: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  viewSwitch: {
    flexDirection: "row",
    gap: 8,
  },
  viewSwitchChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
  },
  viewSwitchChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  viewSwitchText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  viewSwitchTextActive: {
    color: "#FFFFFF",
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  assetCardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  assetTile: {
    width: "31%",
    minWidth: 300,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    ...shadows.card,
  },
  assetTileMedia: {
    height: 210,
    backgroundColor: "#DBEAFE",
  },
  assetTileImage: {
    width: "100%",
    height: "100%",
  },
  assetTileFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  assetStatusBadge: {
    position: "absolute",
    left: spacing.md,
    top: spacing.md,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.86)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  assetStatusBadgeText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  assetTileBody: {
    padding: spacing.md,
    gap: 4,
  },
  assetIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  assetBody: {
    flex: 1,
    minWidth: 0,
  },
  assetTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  assetMeta: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  assetSubmeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },
  assetTileFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.sm,
  },
  assetTileMetric: {
    flex: 1,
    minWidth: 0,
  },
  assetMetricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  assetMetricValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
    marginTop: 2,
  },
  assetTileCount: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  assetTileCountText: {
    ...typography.caption,
    color: "#1D4ED8",
    fontWeight: "800",
  },
  assetMessagePreview: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  profileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  profileFact: {
    flex: 1,
    minWidth: 220,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  profileHero: {
    minHeight: 210,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "flex-end",
    backgroundColor: "#DBEAFE",
    ...shadows.card,
  },
  profileCoverFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#DBEAFE",
  },
  profileCoverImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  profileHeroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.18)",
  },
  profileHeroContent: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    padding: spacing.lg,
  },
  profileLogo: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileLogoImage: {
    width: "100%",
    height: "100%",
  },
  profileHeroCopy: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 2,
  },
  profileHeroEyebrow: {
    ...typography.caption,
    color: "#FFFFFF",
    textTransform: "uppercase",
    fontWeight: "900",
  },
  profileHeroTitle: {
    ...typography.h1,
    color: "#FFFFFF",
    marginTop: 2,
  },
  profileHeroSubtitle: {
    ...typography.body,
    color: "#EFF6FF",
    fontWeight: "800",
    marginTop: 2,
  },
  smallButton: {
    minHeight: 38,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "#FFFFFF",
  },
  smallButtonText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "800",
  },
  profileStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statePill: {
    minHeight: 30,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
  },
  statePillText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  profileDescription: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  infoChip: {
    borderRadius: radius.full,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  infoChipText: {
    ...typography.caption,
    color: "#1D4ED8",
    fontWeight: "800",
  },
  profileSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  profileActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryActionButton: {
    minHeight: 42,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: "#FFFFFF",
  },
  secondaryActionText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: "800",
  },
  primaryActionButton: {
    minHeight: 42,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
  },
  primaryActionText: {
    ...typography.body,
    color: "#FFFFFF",
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.6,
  },
  uploadRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  imageUploadBox: {
    width: 160,
    minHeight: 132,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  imageUploadBoxWide: {
    flex: 1,
    minWidth: 260,
    minHeight: 132,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  uploadPreview: {
    width: 96,
    height: 72,
  },
  uploadPreviewWide: {
    width: "100%",
    height: 96,
    borderRadius: radius.sm,
  },
  uploadText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  formField: {
    marginTop: spacing.sm,
  },
  profileInput: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  profileTextArea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  simpleRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  simpleTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  simpleMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptySection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  emptyTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: "center",
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
