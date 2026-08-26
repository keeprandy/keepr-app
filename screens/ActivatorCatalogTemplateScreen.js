import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { getCatalogTemplateDetail } from "../lib/activatorApi";
import { getSignedUrl } from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const DEFAULT_TEMPLATE_HERO = require("../assets/boats/tiara/tiara_oem_banner.png");

const SHOWCASE_ASSETS = {
  tiara_39le_aft_module: require("../assets/boats/tiara/tiara_39le_aft_module.jpg"),
  tiara_39le_cabin_stateroom: require("../assets/boats/tiara/tiara_39le_cabin_stateroom.jpg"),
  tiara_39le_helm: require("../assets/boats/tiara/tiara_39le_helm.jpg"),
  tiara_39le_hero: require("../assets/boats/tiara/tiara_39le_hero.jpg"),
  tiara_39le_overhead: require("../assets/boats/tiara/tiara_39le_overhead.jpg"),
  tiara_39ls_aft_cockpit: require("../assets/boats/tiara/tiara_39ls_aft_cockpit.jpg"),
  tiara_39ls_cabin_stateroom: require("../assets/boats/tiara/tiara_39ls_cabin_stateroom.jpg"),
  tiara_39ls_cockpit_lounge: require("../assets/boats/tiara/tiara_39ls_cockpit_lounge.jpg"),
  tiara_39ls_hero: require("../assets/boats/tiara/tiara_39ls_hero.jpg"),
};

const TABS = [
  { key: "overview", label: "Overview", icon: "boat-outline" },
  { key: "media", label: "Media", icon: "images-outline" },
  { key: "exterior", label: "Exterior", icon: "sunny-outline" },
  { key: "interior", label: "Interior", icon: "bed-outline" },
  { key: "electronics", label: "Helm & Electronics", icon: "speedometer-outline" },
  { key: "systems", label: "Systems", icon: "cog-outline" },
  { key: "options", label: "Options", icon: "options-outline" },
  { key: "care", label: "Care", icon: "checkbox-outline" },
  { key: "resources", label: "Resources", icon: "document-text-outline" },
];

const SECTION_TABS = {
  "Specifications": ["overview"],
  "Systems": ["systems"],
  "Hull and Deck": ["overview", "exterior"],
  "Hardtop": ["exterior"],
  "Foredeck": ["exterior"],
  "Transom": ["exterior"],
  "Aft Cockpit": ["exterior"],
  "Upper Cockpit and Helm Area": ["overview", "electronics"],
  "Interior Group": ["interior"],
  "Staterooms": ["interior"],
  "Head": ["interior"],
  "Instrumentation, Safety and Equipment": ["electronics", "systems"],
  "Propulsion": ["systems", "options"],
  "Aft Cockpit Modules": ["options", "exterior"],
  "Mechanical Group": ["systems", "options"],
  "Electronics Group": ["electronics", "options"],
  "Interior Group Options": ["interior", "options"],
  "Exterior Group Options": ["exterior", "options"],
  "Upholstery Packages": ["interior", "options"],
  "Solid Surface Selections": ["interior", "options"],
  "Paint Selections": ["exterior", "options"],
  "International Options": ["options"],
  "Care": ["care"],
  "Resources": ["resources"],
};

function compact(parts) {
  return parts.filter(Boolean).join(" · ");
}

function labelize(value) {
  return String(value || "").replace(/_/g, " ");
}

function valueText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  if (value.value !== undefined) return compact([value.value, value.unit]);
  return JSON.stringify(value);
}

function standardLabel(item) {
  const state = item?.applicability?.standard_state;
  const rule = item?.applicability?.selection_rule;
  if (state === "standard") return "Standard";
  if (state === "optional" && rule === "choose_one") return "Choose one";
  if (state === "optional") return "Available option";
  if (state === "replaces_standard") return "Replaces standard";
  if (rule === "choose_many") return "Choose many";
  return labelize(item?.item_type);
}

function groupItems(items = []) {
  const byParent = new Map();
  const byId = new Map();

  items.forEach((item) => {
    byId.set(item.id, item);
    const key = item.parent_item_id || "root";
    byParent.set(key, [...(byParent.get(key) || []), item]);
  });

  const sections = (byParent.get("root") || [])
    .filter((item) => item.item_type === "section")
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return sections.map((section) => ({
    section,
    children: (byParent.get(section.id) || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  }));
}

function tabSections(groups, tab) {
  if (tab === "media") return [];
  if (tab === "overview") {
    return groups.filter(({ section }) => (SECTION_TABS[section.label] || []).includes("overview"));
  }
  return groups.filter(({ section }) => (SECTION_TABS[section.label] || []).includes(tab));
}

function specValue(items, key, fallback) {
  const found = items.find((item) => item.canonical_key === key);
  return valueText(found?.expected_value) || fallback;
}

function modelFallbackSpecs(template = {}) {
  const model = String(template.model || "").toLowerCase();
  if (model.includes("56 ls")) {
    return {
      loa: "56'2\"",
      beam: "16'0\"",
      hp: "2,400 HP",
      fuel: "1,000 gal",
      water: "150 gal",
    };
  }
  if (model.includes("43 ls")) {
    return {
      loa: "43'6\"",
      beam: "13'0\"",
      hp: "1,200 HP",
      fuel: "400 gal",
      water: "60 gal",
    };
  }
  return {
    loa: "39'6\"",
    beam: "12'6\"",
    hp: "1,200 HP",
    fuel: "500 gal",
    water: "50 gal",
  };
}

function mediaAsset(media, template = {}) {
  const localKey = media?.local_asset_key || media?.metadata?.local_asset_key;
  if (SHOWCASE_ASSETS[localKey]) return SHOWCASE_ASSETS[localKey];
  const uri =
    media?.attachment_signed_url ||
    media?.attachment_url ||
    media?.attachment_storage_signed_url ||
    media?.url ||
    media?.signed_url ||
    media?.public_url ||
    media?.publicUrl ||
    media?.uri ||
    media?.metadata?.attachment_signed_url ||
    media?.metadata?.attachment_url ||
    media?.metadata?.attachment_storage_signed_url ||
    media?.metadata?.url ||
    media?.metadata?.uri ||
    null;
  if (uri && !String(uri).startsWith("app://")) return { uri };

  const model = String(template.model || "").toLowerCase();
  if (model.includes("39 le")) return SHOWCASE_ASSETS.tiara_39le_hero;
  if (model.includes("39 ls")) return SHOWCASE_ASSETS.tiara_39ls_hero;
  return DEFAULT_TEMPLATE_HERO;
}

function mediaByRole(media = [], role) {
  return media.find((item) => item.role === role || item.metadata?.role === role);
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function mediaFromResource(resource) {
  const metadata = resource?.metadata || {};
  if (resource?.resource_type !== "photo") return null;
  if (metadata.media_scope && metadata.media_scope !== "model_template") return null;

  return {
    id: resource.id,
    resource_id: resource.id,
    attachment_id: resource.attachment_id || null,
    role: metadata.role || metadata.showcase_role || "gallery",
    title: resource.title,
    url: resource.url,
    attachment_url: metadata.attachment_url || null,
    attachment_signed_url: metadata.attachment_signed_url || null,
    local_asset_key: metadata.local_asset_key,
    source_name: resource.source_name,
    source_platform: resource.source_platform,
    source_url: resource.source_url,
    authority_state: resource.authority_state,
    rights_status: resource.rights_status,
    metadata: {
      ...metadata,
      attachment_id: resource.attachment_id || metadata.attachment_id || null,
      source_resource_id: resource.id,
      media_source: "asset_resources",
    },
  };
}

function normalizeTemplateMedia(detail = {}) {
  const safeDetail = detail || {};
  const byId = new Map();

  (safeDetail.resources || [])
    .map(mediaFromResource)
    .filter(Boolean)
    .forEach((item) => byId.set(item.resource_id || item.id, item));

  (safeDetail.showcase_media || []).forEach((item) => {
    const key = item.resource_id || item.id || item.local_asset_key || item.title;
    if (!key || byId.has(key)) return;
    byId.set(key, { ...item, metadata: { ...(item.metadata || {}), media_source: "showcase_media" } });
  });

  return Array.from(byId.values()).sort((a, b) => {
    const aSort = Number(a.metadata?.sort_order ?? 999);
    const bSort = Number(b.metadata?.sort_order ?? 999);
    if (aSort !== bSort) return aSort - bSort;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

async function hydrateTemplatePhotoResources(detail) {
  const resources = detail?.resources || [];
  const resourcesWithSignedStorage = await Promise.all(
    resources.map(async (resource) => {
      const metadata = resource?.metadata || {};
      const bucket = metadata.attachment_bucket || metadata.storage_bucket || null;
      const path = metadata.attachment_storage_path || metadata.storage_path || null;
      if (resource?.resource_type !== "photo" || !bucket || !path) return resource;
      try {
        const signedUrl = await getSignedUrl({
          bucket,
          path,
          expiresIn: 3600,
          transform: { width: 1200, height: 800, resize: "cover", quality: 84 },
        });
        return {
          ...resource,
          metadata: {
            ...metadata,
            attachment_signed_url: signedUrl,
            attachment_storage_signed_url: signedUrl,
          },
        };
      } catch (err) {
        console.log("Template resource storage signing failed", err);
        return resource;
      }
    })
  );
  const attachmentIds = resources
    .filter((resource) => resource?.resource_type === "photo" && resource?.attachment_id)
    .map((resource) => resource.attachment_id);

  if (!attachmentIds.length) return { ...detail, resources: resourcesWithSignedStorage };

  const { data, error } = await supabase
    .from("attachments")
    .select("id,bucket,storage_path,url,kind,mime_type,title")
    .in("id", attachmentIds);

  if (error) throw error;

  const byId = new Map();
  for (const attachment of data || []) {
    let signedUrl = attachment.url || null;
    if (attachment.bucket && attachment.storage_path) {
      try {
        signedUrl = await getSignedUrl({
          bucket: attachment.bucket,
          path: attachment.storage_path,
          expiresIn: 3600,
          transform: attachment.kind === "photo" || String(attachment.mime_type || "").startsWith("image/")
            ? { width: 1200, height: 800, resize: "cover", quality: 84 }
            : null,
        });
      } catch (err) {
        console.log("Template media signing failed", err);
      }
    }
    byId.set(attachment.id, { ...attachment, signedUrl });
  }

  return {
    ...detail,
    resources: resourcesWithSignedStorage.map((resource) => {
      const attachment = byId.get(resource.attachment_id);
      if (!attachment) return resource;
      return {
        ...resource,
        metadata: {
          ...(resource.metadata || {}),
          attachment_title: attachment.title,
          attachment_signed_url: attachment.signedUrl,
          attachment_url: attachment.url,
        },
      };
    }),
  };
}

function TabButton({ tab, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Ionicons name={tab.icon} size={15} color={active ? colors.onPrimary : colors.textSecondary} />
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
        {tab.label}
      </Text>
    </TouchableOpacity>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ItemCard({ item, onPress, selected }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.itemCard, selected && styles.itemCardSelected]}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemBadge}>{standardLabel(item)}</Text>
        <Ionicons name="open-outline" size={15} color={colors.textMuted} />
      </View>
      <Text style={styles.itemTitle} numberOfLines={2}>{item.label}</Text>
      {valueText(item.expected_value) ? (
        <Text style={styles.itemValue} numberOfLines={2}>{valueText(item.expected_value)}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function SectionGroup({ group, selectedId, onSelect }) {
  const { section, children } = group;

  return (
    <View style={styles.sectionGroup}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.label}</Text>
        <Text style={styles.sectionCount}>{children.length}</Text>
      </View>
      <View style={styles.itemGrid}>
        {children.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onPress={() => onSelect(item)}
          />
        ))}
      </View>
    </View>
  );
}

function Inspector({ item, resources }) {
  if (!item) {
    return (
      <View style={styles.inspector}>
        <View style={styles.inspectorIcon}>
          <Ionicons name="hand-left-outline" size={20} color={colors.brandBlue} />
        </View>
        <Text style={styles.inspectorTitle}>Open any catalog item</Text>
        <Text style={styles.inspectorText}>
          Standards, options, systems, care items, and resources open into this product detail panel.
        </Text>
      </View>
    );
  }

  const price = item.metadata?.source_price;
  const selectionRule = item.applicability?.selection_rule;
  const source = resources.find((resource) => resource.id === item.source_resource_id) || resources[0];

  return (
    <View style={styles.inspector}>
      <Text style={styles.inspectorKicker}>{standardLabel(item)}</Text>
      <Text style={styles.inspectorTitle}>{item.label}</Text>
      <Text style={styles.inspectorText}>
        {item.metadata?.description || item.metadata?.source_note || "Published in the Tiara model guide for this year/model template."}
      </Text>

      <View style={styles.inspectorRows}>
        <View style={styles.inspectorRow}>
          <Text style={styles.inspectorLabel}>Model expectation</Text>
          <Text style={styles.inspectorValue}>{valueText(item.expected_value) || standardLabel(item)}</Text>
        </View>
        <View style={styles.inspectorRow}>
          <Text style={styles.inspectorLabel}>Selection rule</Text>
          <Text style={styles.inspectorValue}>{selectionRule ? labelize(selectionRule) : "As published"}</Text>
        </View>
        {price ? (
          <View style={styles.inspectorRow}>
            <Text style={styles.inspectorLabel}>Source price note</Text>
            <Text style={styles.inspectorValue}>{price}</Text>
          </View>
        ) : null}
        <View style={styles.inspectorRow}>
          <Text style={styles.inspectorLabel}>Source</Text>
          <Text style={styles.inspectorValue}>{source?.title || "Tiara Yachts buyer guide"}</Text>
        </View>
      </View>
    </View>
  );
}

function ShowcaseGallery({
  media,
  onSelect,
  template,
  includeHero = false,
  title = "Showcase Gallery",
  mediaUrl = "",
  onMediaUrlChange,
  onAddMediaUrl,
  onUploadMedia,
  addingMedia = false,
}) {
  const gallery = includeHero ? media : media.filter((item) => item.role !== "hero");
  const canManage = !!(onAddMediaUrl || onUploadMedia);

  return (
    <View style={styles.galleryPanel}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{gallery.length}</Text>
      </View>
      <Text style={styles.galleryText}>
        OEM model-level imagery inherited by vessels until an exact hull has delivery, owner, or evidence photos.
      </Text>
      {canManage ? (
        <View style={styles.mediaManager}>
          <TextInput
            value={mediaUrl}
            onChangeText={onMediaUrlChange}
            placeholder="Paste OEM media URL"
            style={styles.mediaInput}
          />
          <TouchableOpacity
            style={styles.mediaButton}
            onPress={onAddMediaUrl}
            disabled={addingMedia}
            activeOpacity={0.86}
          >
            <Ionicons name="link-outline" size={15} color={colors.brandNavy} />
            <Text style={styles.mediaButtonText}>Add Link</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mediaPrimaryButton}
            onPress={onUploadMedia}
            disabled={addingMedia}
            activeOpacity={0.86}
          >
            {addingMedia ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={15} color={colors.onPrimary} />}
            <Text style={styles.mediaPrimaryButtonText}>Upload Photo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {gallery.length ? (
        <View style={styles.galleryGrid}>
          {gallery.map((item) => (
            <TouchableOpacity
              key={item.id || item.local_asset_key}
              style={styles.galleryCard}
              onPress={() => onSelect(item)}
              activeOpacity={0.88}
            >
              <ImageBackground source={mediaAsset(item, template)} resizeMode="cover" style={styles.galleryImage} imageStyle={styles.galleryImageAsset}>
                <View style={styles.galleryShade}>
                  <Text style={styles.galleryRole}>{labelize(item.role)}</Text>
                </View>
              </ImageBackground>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.galleryEmpty}>
          <Ionicons name="images-outline" size={22} color={colors.textMuted} />
          <Text style={styles.galleryEmptyTitle}>No template media configured</Text>
          <Text style={styles.galleryEmptyText}>
            Add model-level photos to this template so catalog, builder, and exact-hull views can inherit the right imagery.
          </Text>
        </View>
      )}
    </View>
  );
}

export default function ActivatorCatalogTemplateScreen({ navigation, route }) {
  const templateKey = route?.params?.templateKey || "tiara-2027-39-le";
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [addingMedia, setAddingMedia] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await hydrateTemplatePhotoResources(await getCatalogTemplateDetail({ templateKey }));
      setDetail(next);
      const items = next?.items || [];
      setSelectedItem((current) => current || items.find((item) => item.canonical_key === "standard.instrumentation.garmin_9617") || items.find((item) => item.item_type !== "section") || null);
    } catch (err) {
      console.error("Activator catalog detail failed:", err);
      setError(err?.message || "Could not load this model catalog.");
      setDetail(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const items = detail?.items || [];
  const resources = detail?.resources || [];
  const template = detail?.template || {};
  const showcaseMedia = normalizeTemplateMedia(detail);
  const heroMedia = mediaByRole(showcaseMedia, "hero");
  const fallbackSpecs = modelFallbackSpecs(template);
  const groups = useMemo(() => groupItems(items), [items]);
  const visibleGroups = useMemo(() => tabSections(groups, tab), [groups, tab]);
  const specs = {
    loa: specValue(items, "spec.loa", fallbackSpecs.loa),
    beam: specValue(items, "spec.beam", fallbackSpecs.beam),
    hp: specValue(items, "spec.max_horsepower", fallbackSpecs.hp),
    fuel: specValue(items, "spec.fuel_capacity", fallbackSpecs.fuel),
    water: specValue(items, "spec.water_capacity", fallbackSpecs.water),
  };

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const startExactBuild = () => {
    navigation.navigate("ActivatorExactBuild", {
      templateKey: template.template_key || templateKey,
      organizationId: route?.params?.organizationId || null,
      workspaceId: route?.params?.workspaceId || null,
    });
  };

  const customizeTemplate = () => {
    navigation.navigate("ActivatorTemplateCustomize", {
      templateKey: template.template_key || templateKey,
      organizationId: route?.params?.organizationId || null,
      workspaceId: route?.params?.workspaceId || null,
    });
  };

  const insertTemplatePhotoResource = async ({
    title,
    url = null,
    attachmentId = null,
    attachment = null,
    role = "gallery",
    source = "manual_template_media_add",
  }) => {
    if (!template?.id) throw new Error("Template is not loaded yet.");

    const existingMedia = normalizeTemplateMedia(detail);
    const nextSort = existingMedia.length + 1;
    const { error: insertError } = await supabase
      .from("asset_resources")
      .insert({
        resource_type: "photo",
        title,
        url,
        attachment_id: attachmentId,
        source_name: template.manufacturer || "Tiara Yachts",
        source_platform: "Keepr OEM template media",
        source_url: url,
        authority_state: "oem_published",
        rights_status: "review_permission",
        applies_to_type: "template",
        applies_to_id: template.id,
        metadata: {
          media_scope: "model_template",
          role,
          sort_order: nextSort,
          attachment_id: attachmentId || attachment?.id || null,
          attachment_bucket: attachment?.bucket || null,
          attachment_storage_path: attachment?.storage_path || null,
          source_document_title: `${template.manufacturer || "Tiara Yachts"} ${template.model || "model"} media`,
          not_exact_hull_media: true,
          contribution_context: source,
          visibility_intent: "template_inherited_until_hull_media",
        },
      });

    if (insertError) throw insertError;
  };

  const addTemplateMediaUrl = async () => {
    const raw = mediaUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setAddingMedia(true);
    try {
      await insertTemplatePhotoResource({
        title: titleFromUrl(url),
        url,
        source: "manual_template_media_link",
      });
      setMediaUrl("");
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not add media", err?.message || "The template media link could not be saved.");
    } finally {
      setAddingMedia(false);
    }
  };

  const uploadTemplatePhoto = async () => {
    setAddingMedia(true);
    try {
      const pickerMediaTypes = ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: pickerMediaTypes,
        allowsMultipleSelection: false,
        quality: 0.9,
      });

      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Sign in is required to upload template media.");

      const title = picked.fileName || `${template.model || "Template"} media photo`;
      const uploaded = await uploadAttachmentFromUri({
        userId,
        assetId: null,
        kind: "photo",
        fileUri: picked.uri,
        fileName: picked.fileName || `template-media-${Date.now()}.jpg`,
        mimeType: picked.mimeType || "image/jpeg",
        sizeBytes: picked.fileSize || null,
        title,
        sourceContext: {
          contribution_context: "oem_template_media_upload",
          authority_state: "oem_published",
          organization_id: route?.params?.organizationId || template.organization_id || null,
          template_id: template.id,
          template_key: template.template_key || templateKey,
        },
        placements: [],
      });

      await insertTemplatePhotoResource({
        title,
        attachmentId: uploaded?.attachment?.id,
        attachment: uploaded?.attachment,
        source: "oem_template_media_upload",
      });
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not upload media", err?.message || "The template photo could not be uploaded.");
    } finally {
      setAddingMedia(false);
    }
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ActivatorBreadcrumb
          navigation={navigation}
          items={[
            {
              label: "Model Catalog",
              route: "ActivatorHome",
              params: {
                initialMode: "templates",
                navSection: "ActivatorTemplates",
                organizationId: route?.params?.organizationId || null,
                workspaceId: route?.params?.workspaceId || null,
              },
            },
          ]}
          current={`${template.model || "39 LS"} Template`}
        />
        <ImageBackground source={mediaAsset(heroMedia, template)} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Tiara Yachts Catalog</Text>
              <Text style={styles.title}>MY{template.model_year || "2027"} {template.manufacturer || "Tiara Yachts"} {template.model || "39 LE"}</Text>
              <Text style={styles.subtitle}>
                The OEM model guide as a navigable ownership template, preserving brochure sections, standards, available options, care, and source provenance.
              </Text>
              <View style={styles.sourcePill}>
                <Ionicons name="document-text-outline" size={15} color={colors.brandNavy} />
                <Text style={styles.sourcePillText} numberOfLines={1}>
                  {heroMedia?.metadata?.source_document_title || resources[0]?.title || "Tiara Yachts Buyer Guide MY2027"}
                </Text>
              </View>
              <View style={styles.heroActions}>
                <TouchableOpacity activeOpacity={0.86} style={styles.customizeButton} onPress={customizeTemplate}>
                  <Ionicons name="create-outline" size={16} color={colors.brandNavy} />
                  <Text style={styles.customizeButtonText}>
                    Customize Template
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.86} style={styles.buildButton} onPress={startExactBuild}>
                  <Ionicons name="construct-outline" size={16} color={colors.onPrimary} />
                  <Text style={styles.buildButtonText}>
                    Build a {template.model || "39 LS"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.statsRow}>
          <Stat label="LOA" value={specs.loa} />
          <Stat label="Beam" value={specs.beam} />
          <Stat label="Max HP" value={specs.hp} />
          <Stat label="Fuel" value={specs.fuel} />
          <Stat label="Water" value={specs.water} />
        </View>

        <View style={styles.tabRow}>
          {TABS.map((item) => (
            <TabButton key={item.key} tab={item} active={tab === item.key} onPress={() => setTab(item.key)} />
          ))}
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Opening model guide...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.accentRed} />
            <Text style={styles.emptyTitle}>Catalog is not available</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.detailLayout}>
            <View style={styles.groupsColumn}>
              {(tab === "overview" || tab === "media") ? (
                <ShowcaseGallery
                  media={showcaseMedia}
                  template={template}
                  includeHero={tab === "media"}
                  title={tab === "media" ? "Template Media" : "Showcase Gallery"}
                  mediaUrl={mediaUrl}
                  onMediaUrlChange={setMediaUrl}
                  onAddMediaUrl={addTemplateMediaUrl}
                  onUploadMedia={uploadTemplatePhoto}
                  addingMedia={addingMedia}
                  onSelect={(media) => setSelectedItem({
                    id: `media-${media.id}`,
                    item_type: "photo",
                    label: media.title,
                    expected_value: { value: labelize(media.role) },
                    applicability: { standard_state: "model showcase" },
                    source_resource_id: media.id,
                    metadata: {
                      description: media.metadata?.usage_note,
                      source_context: media.metadata?.source_document_title,
                    },
                  })}
                />
              ) : null}
              {visibleGroups.map((group) => (
                <SectionGroup
                  key={group.section.id}
                  group={group}
                  selectedId={selectedItem?.id}
                  onSelect={setSelectedItem}
                />
              ))}
            </View>
            <View style={styles.inspectorColumn}>
              <Inspector item={selectedItem} resources={resources} />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignSelf: "stretch",
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    minHeight: 330,
    overflow: "hidden",
    width: "100%",
    ...shadows.sm,
  },
  heroImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  heroOverlay: {
    backgroundColor: "rgba(6, 14, 31, 0.38)",
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 330,
    padding: spacing.xl,
  },
  heroCopy: {
    maxWidth: 780,
  },
  eyebrow: {
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.onPrimary,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 42,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 700,
  },
  sourcePill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    maxWidth: 420,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  sourcePillText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "800",
  },
  heroActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  customizeButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: "rgba(255,255,255,0.62)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  customizeButtonText: {
    color: colors.brandNavy,
    fontSize: 13,
    fontWeight: "900",
  },
  buildButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  buildButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  stat: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 150,
    padding: spacing.lg,
    ...shadows.sm,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: "900",
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 4,
    textTransform: "uppercase",
  },
  tabRow: {
    backgroundColor: "rgba(255,255,255,0.82)",
    borderColor: "rgba(226,232,240,0.88)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  tabButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  tabButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  tabTextActive: {
    color: colors.onPrimary,
  },
  detailLayout: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  groupsColumn: {
    flex: 1,
    gap: spacing.lg,
    minWidth: 320,
  },
  inspectorColumn: {
    maxWidth: 390,
    minWidth: 300,
    width: "32%",
  },
  sectionGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  itemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  itemCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 120,
    minWidth: 210,
    padding: spacing.md,
    width: "30%",
  },
  itemCardSelected: {
    borderColor: colors.brandBlue,
    shadowColor: colors.brandBlue,
    shadowOpacity: 0.16,
    shadowRadius: 10,
  },
  galleryPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  galleryText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  mediaManager: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  mediaInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 14,
    minHeight: 42,
    minWidth: 240,
    paddingHorizontal: spacing.md,
  },
  mediaButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  mediaButtonText: {
    color: colors.brandNavy,
    fontSize: 13,
    fontWeight: "800",
  },
  mediaPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  mediaPrimaryButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "800",
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  galleryEmpty: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.xl,
  },
  galleryEmptyTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  galleryEmptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 420,
    textAlign: "center",
  },
  galleryCard: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 230,
    overflow: "hidden",
    width: "30%",
  },
  galleryImage: {
    backgroundColor: "#0B1220",
    height: 150,
    width: "100%",
  },
  galleryImageAsset: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  galleryShade: {
    backgroundColor: "rgba(6,14,31,0.18)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  galleryRole: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(19,26,68,0.86)",
    borderRadius: radius.sm,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textTransform: "capitalize",
  },
  itemHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemBadge: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  itemTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 19,
    marginTop: spacing.md,
  },
  itemValue: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  inspector: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  inspectorIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  inspectorKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  inspectorTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
    marginTop: spacing.sm,
  },
  inspectorText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  inspectorRows: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  inspectorRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  inspectorLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  inspectorValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 3,
  },
  centered: {
    alignItems: "center",
    gap: spacing.md,
    justifyContent: "center",
    minHeight: 220,
  },
  emptyPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 200,
    padding: spacing.xl,
    ...shadows.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  mutedText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
});
