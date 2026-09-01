import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Linking,
  Modal,
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
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { getCatalogTemplateDetail } from "../lib/activatorApi";
import { getSignedUrl, listAttachmentsForTarget, removePlacementById } from "../lib/attachmentsApi";
import { createLinkAttachment, uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { projectModelTemplateDetail } from "../lib/modelTemplateProjection";
import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const DEFAULT_TEMPLATE_HERO = require("../assets/boats/tiara/tiara_oem_banner.png");
const IS_WEB = Platform.OS === "web";

const TABS = [
  { key: "overview", label: "Overview", icon: "boat-outline" },
  { key: "media", label: "Media", icon: "images-outline" },
  { key: "exterior", label: "Exterior", icon: "sunny-outline" },
  { key: "interior", label: "Interior", icon: "bed-outline" },
  { key: "electronics", label: "Helm & Electronics", icon: "speedometer-outline" },
  { key: "systems", label: "Systems", icon: "cog-outline" },
  { key: "options", label: "Options", icon: "options-outline" },
  { key: "specifications", label: "Specifications", icon: "analytics-outline" },
  { key: "care", label: "Care", icon: "checkbox-outline" },
  { key: "resources", label: "Resources", icon: "document-text-outline" },
];

const MODEL_RESOURCE_ROLES = [
  { key: "manual", label: "Owner's Manual" },
  { key: "warranty", label: "Warranty" },
  { key: "buyer_guide", label: "Buyer Guide" },
  { key: "spec_sheet", label: "Spec Sheet" },
  { key: "install_guide", label: "Install Guide" },
  { key: "source", label: "Source" },
];

const SECTION_TABS = {
  "Specifications": ["specifications"],
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
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  if (value.value !== undefined) return compact([valueText(value.value), value.unit]);
  if (value.model_expectation !== undefined) return valueText(value.model_expectation);
  if (value.description) return String(value.description);
  if (value.summary) return String(value.summary);
  if (value.label) return String(value.label);
  if (value.name) return String(value.name);
  if (value.text) return String(value.text);
  return null;
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

function resourceUrl(resource) {
  const metadata = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  return (
    metadata.attachment_signed_url ||
    metadata.attachment_storage_signed_url ||
    metadata.attachment_url ||
    resource?.attachment_signed_url ||
    resource?.attachment_storage_signed_url ||
    resource?.attachment_url ||
    resource?.url ||
    resource?.source_url ||
    metadata.url ||
    metadata.source_url ||
    null
  );
}

function itemSourceLabel(item, resources = []) {
  const source = resources.find((resource) => resource.id === item?.source_resource_id);
  if (source?.title) return source.title;
  if (item?.metadata?.source_document_title) return item.metadata.source_document_title;
  if (item?.metadata?.source_context) return item.metadata.source_context;
  return item?.source_resource_id ? "Linked source" : "Needs source";
}

function itemEditParams(item, templateKey, routeParams = {}) {
  if (!item?.id || String(item.id).startsWith("media-")) return null;
  return {
    templateKey,
    itemId: item.id,
    organizationId: routeParams.organizationId || null,
    workspaceId: routeParams.workspaceId || null,
  };
}

function mediaAsset(media, template = {}) {
  const uri =
    media?.attachment_signed_url ||
    media?.attachment_storage_signed_url ||
    media?.attachment_url ||
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

  return DEFAULT_TEMPLATE_HERO;
}

function mediaByRole(media = [], role) {
  if (role === "hero") return media.find((item) => item.is_hero || item.role === role || item.metadata?.role === role);
  if (role === "showcase") return media.find((item) => item.is_showcase || item.role === role || item.metadata?.role === role);
  return media.find((item) => item.role === role || item.metadata?.role === role);
}

function templateHeroPlacementId(template = {}) {
  const metadata = template?.metadata && typeof template.metadata === "object" ? template.metadata : {};
  return (
    metadata.presentation?.hero_placement_id ||
    metadata.presentation?.heroPlacementId ||
    metadata.model_media?.hero_placement_id ||
    metadata.hero_placement_id ||
    null
  );
}

function templateMediaLabel(template = {}) {
  const year = template.model_year ? `MY${template.model_year}` : null;
  return [year, template.manufacturer, template.model, "model media"].filter(Boolean).join(" ");
}

function modelTemplateLabel(template = {}) {
  const year = template.model_year ? `MY${template.model_year}` : null;
  return [year, template.manufacturer, template.model].filter(Boolean).join(" ") || template.template_key || "Model";
}

function normalizeTemplateAttachmentMedia(row, template = {}) {
  const sourceContext = row?.source_context && typeof row.source_context === "object" ? row.source_context : {};
  const heroPlacementId = templateHeroPlacementId(template);
  const isHero = !!row?.placement_id && row.placement_id === heroPlacementId;
  const sourceTemplateId = sourceContext.template_id || null;
  const sourceTemplateKey = sourceContext.template_key || null;
  const canDeleteAttachment = !!(
    row.attachment_id &&
    sourceContext.provenance === "model_template" &&
    (sourceTemplateId === template.id || sourceTemplateKey === template.template_key)
  );
  return {
    id: row.placement_id || row.attachment_id || row.id,
    attachment_id: row.attachment_id || row.id || null,
    placement_id: row.placement_id || null,
    target_type: "model_template",
    target_id: template.id || row.target_id || null,
    role: isHero ? "hero" : row.role || "gallery",
    label: row.label || row.title || row.file_name || null,
    sort_order: row.sort_order ?? null,
    is_hero: isHero,
    is_showcase: !!row.is_showcase,
    can_delete_attachment: canDeleteAttachment,
    title: row.title || row.label || row.file_name || "Model media",
    url: row.url || null,
    attachment_url: row.url || null,
    attachment_signed_url: row.attachment_signed_url || row.signed_url || null,
    attachment_storage_signed_url: row.attachment_storage_signed_url || row.signed_url || null,
    bucket: row.bucket || null,
    storage_path: row.storage_path || null,
    file_name: row.file_name || null,
    mime_type: row.mime_type || null,
    source_name: sourceContext.source_name || template.manufacturer || null,
    source_platform: "Keepr OEM Gallery",
    authority_state: sourceContext.authority_state || "oem_published",
    source_context: {
      provenance: "model_template",
      provenance_label: sourceContext.provenance_label || templateMediaLabel(template),
      provenance_detail: sourceContext.provenance_detail || "Reusable model/catalog media; not exact-hull evidence.",
      template_id: template.id || sourceContext.template_id || null,
      template_key: template.template_key || sourceContext.template_key || null,
      not_exact_hull_media: true,
      ...sourceContext,
    },
    metadata: {
      attachment_id: row.attachment_id || row.id || null,
      placement_id: row.placement_id || null,
      media_source: "attachment_placements",
      source_document_title: sourceContext.provenance_label || templateMediaLabel(template),
      placements: {
        hero: isHero,
        showcase: !!row.is_showcase,
      },
      not_exact_hull_media: true,
    },
  };
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function titleFromPickedAsset(asset, fallback = "Model media photo") {
  if (asset?.fileName) return asset.fileName;
  const uri = asset?.uri || "";
  const tail = uri.split(/[/?#]/).filter(Boolean).pop();
  return tail || fallback;
}

function modelResourceRoleLabel(role) {
  return MODEL_RESOURCE_ROLES.find((item) => item.key === role)?.label || labelize(role || "Resource");
}

function mediaFromResource(resource) {
  const metadata = resource?.metadata || {};
  if (resource?.resource_type !== "photo") return null;
  if (metadata.media_scope && metadata.media_scope !== "model_template") return null;
  const placements = metadata.placements && typeof metadata.placements === "object" ? metadata.placements : {};
  const isHero = placements.hero === true || metadata.is_hero === true || metadata.hero === true || metadata.role === "hero";
  const isShowcase = placements.showcase === true || metadata.is_showcase === true || metadata.showcase === true || metadata.role === "showcase";

  return {
    id: resource.id,
    resource_id: resource.id,
    attachment_id: resource.attachment_id || null,
    role: isHero ? "hero" : isShowcase ? "showcase" : metadata.role || metadata.showcase_role || "gallery",
    is_hero: isHero,
    is_showcase: isShowcase,
    placements: {
      ...placements,
      hero: isHero,
      showcase: isShowcase,
    },
    title: resource.title,
    url: resource.url || metadata.url || null,
    attachment_url: metadata.attachment_url || null,
    attachment_signed_url: metadata.attachment_signed_url || metadata.attachment_storage_signed_url || resource.attachment_signed_url || null,
    attachment_storage_signed_url: metadata.attachment_storage_signed_url || metadata.attachment_signed_url || resource.attachment_storage_signed_url || null,
    bucket: resource.bucket || metadata.attachment_bucket || metadata.storage_bucket || null,
    storage_path: resource.storage_path || metadata.attachment_storage_path || metadata.storage_path || null,
    file_name: resource.file_name || metadata.file_name || metadata.attachment_title || null,
    mime_type: resource.mime_type || metadata.mime_type || null,
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
      placements: {
        ...placements,
        hero: isHero,
        showcase: isShowcase,
      },
    },
  };
}

function normalizeTemplateMedia(detail = {}, templateAttachments = [], template = {}) {
  const safeDetail = detail || {};
  const attachmentRows = (templateAttachments || [])
    .map((item) => normalizeTemplateAttachmentMedia(item, template || safeDetail.template || {}))
    .filter(Boolean);

  const byId = new Map();

  attachmentRows.forEach((item) => byId.set(item.attachment_id || item.placement_id || item.id, item));

  // Do not surface bundled/static legacy media in the editable model gallery.
  // Model media must be attachment-backed so it can be opened, placed, removed, or deleted.

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
          attachment_signed_url: signedUrl,
          attachment_storage_signed_url: signedUrl,
          bucket,
          storage_path: path,
          metadata: {
            ...metadata,
            attachment_signed_url: signedUrl,
            attachment_storage_signed_url: signedUrl,
            attachment_bucket: bucket,
            attachment_storage_path: path,
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
        attachment_signed_url: attachment.signedUrl,
        attachment_storage_signed_url: attachment.signedUrl,
        attachment_url: attachment.url,
        bucket: attachment.bucket,
        storage_path: attachment.storage_path,
        mime_type: attachment.mime_type,
        file_name: attachment.title,
        metadata: {
          ...(resource.metadata || {}),
          attachment_title: attachment.title,
          attachment_signed_url: attachment.signedUrl,
          attachment_storage_signed_url: attachment.signedUrl,
          attachment_url: attachment.url,
          attachment_bucket: attachment.bucket,
          attachment_storage_path: attachment.storage_path,
          file_name: attachment.title,
          mime_type: attachment.mime_type,
        },
      };
    }),
  };
}

async function hydrateTemplateAttachmentMedia(template) {
  if (!template?.id) return [];
  const rows = await listAttachmentsForTarget("model_template", template.id);
  const mediaRows = (rows || []).filter((row) => {
    const mime = String(row.mime_type || "").toLowerCase();
    return row.kind === "photo" || mime.startsWith("image/");
  });

  return Promise.all(
    mediaRows.map(async (row) => {
      if (row.url || !row.bucket || !row.storage_path) return row;
      try {
        const signedUrl = await getSignedUrl({
          bucket: row.bucket,
          path: row.storage_path,
          expiresIn: 3600,
          transform: { width: 1200, height: 800, resize: "cover", quality: 84 },
        });
        return {
          ...row,
          attachment_signed_url: signedUrl,
          attachment_storage_signed_url: signedUrl,
          signed_url: signedUrl,
        };
      } catch (err) {
        console.log("Template attachment signing failed", err);
        return row;
      }
    })
  );
}

function normalizeTemplateAttachmentResource(row, template = {}) {
  const sourceContext = row?.source_context && typeof row.source_context === "object" ? row.source_context : {};
  const aiMetadata = row?.ai_metadata && typeof row.ai_metadata === "object" ? row.ai_metadata : {};
  const role = row.role || aiMetadata.role || row.kind || "resource";
  const url = resourceUrl(row);
  return {
    id: row.attachment_id || row.id,
    attachment_id: row.attachment_id || row.id,
    placement_id: row.placement_id || null,
    title: row.title || row.label || row.file_name || titleFromUrl(url || "Model resource"),
    resource_type: row.kind === "link" ? "link" : role,
    kind: row.kind,
    url,
    file_name: row.file_name,
    mime_type: row.mime_type,
    bucket: row.bucket,
    storage_path: row.storage_path,
    source_name: sourceContext.source_name || template.manufacturer || null,
    source_platform: "Keepr OEM Catalog",
    authority_state: sourceContext.authority_state || aiMetadata.authority || "official",
    source_context: {
      ...sourceContext,
      provenance: "model_template",
      provenance_label: sourceContext.provenance_label || `${modelTemplateLabel(template)} model resource`,
      provenance_detail:
        sourceContext.provenance_detail ||
        "Reusable model/catalog resource inherited by exact KACs; not exact-hull evidence.",
      template_id: template.id || sourceContext.template_id || null,
      template_key: template.template_key || sourceContext.template_key || null,
      not_exact_hull_evidence: true,
    },
    ai_metadata: aiMetadata,
    metadata: {
      attachment_id: row.attachment_id || row.id,
      placement_id: row.placement_id || null,
      source_document_title: sourceContext.provenance_label || `${modelTemplateLabel(template)} model resource`,
      source_context: sourceContext,
      role,
      not_exact_hull_evidence: true,
    },
  };
}

async function hydrateTemplateAttachmentResources(template) {
  if (!template?.id) return [];
  const rows = await listAttachmentsForTarget("model_template", template.id);
  const resourceRows = (rows || []).filter((row) => {
    const mime = String(row.mime_type || "").toLowerCase();
    return row.kind !== "photo" && !mime.startsWith("image/");
  });

  return Promise.all(
    resourceRows.map(async (row) => {
      const normalized = normalizeTemplateAttachmentResource(row, template);
      if (normalized.url || !normalized.bucket || !normalized.storage_path) return normalized;
      try {
        const signedUrl = await getSignedUrl({
          bucket: normalized.bucket,
          path: normalized.storage_path,
          expiresIn: 3600,
        });
        return {
          ...normalized,
          url: signedUrl,
          attachment_signed_url: signedUrl,
          attachment_storage_signed_url: signedUrl,
        };
      } catch (err) {
        console.log("Template resource signing failed", err);
        return normalized;
      }
    })
  );
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

function resourceTypeForRow(resource = {}) {
  if (resource.resource_type) return resource.resource_type;
  if (resource.kind === "link") return "link";
  if (resource.kind === "photo") return "photo";
  return resource.role || resource.ai_metadata?.role || "resource";
}

function resourceProvenanceText(resource = {}) {
  const sourceContext = resource.source_context && typeof resource.source_context === "object"
    ? resource.source_context
    : {};
  return compact([
    "OEM",
    sourceContext.source_name || sourceContext.provided_by_label || resource.source_name,
    sourceContext.provenance === "model_template" ? "Model Resource" : null,
    sourceContext.template_key ? "Inherited by KACs" : null,
  ]) || resource.provenance_label || resource.attribution || "Model resource";
}

function ResourcePanel({
  resources,
  onOpenResources,
  resourceLinkUrl = "",
  onResourceLinkUrlChange,
  onAddResourceUrl,
  onUploadResource,
  resourceRole,
  onResourceRoleChange,
  addingResource = false,
}) {
  const visible = resources.slice(0, 4);
  const canManage = !!(onAddResourceUrl || onUploadResource);
  return (
    <View style={styles.resourcesPanel}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.resourceEyebrow}>Evidence</Text>
          <Text style={styles.sectionTitle}>Documents & resources</Text>
        </View>
        <Text style={styles.sectionCount}>{resources.length}</Text>
      </View>
      {visible.length ? (
        <View style={styles.resourceList}>
          {visible.map((resource) => {
            const url = resourceUrl(resource);
            const resourceType = resourceTypeForRow(resource);
            return (
              <TouchableOpacity
                key={resource.id || resource.title}
                activeOpacity={url ? 0.86 : 1}
                onPress={() => url && Linking.openURL(url)}
                style={styles.resourceRow}
              >
                <View style={styles.resourceIcon}>
                  <Ionicons name={resourceType === "photo" ? "image-outline" : resourceType === "link" ? "link-outline" : "document-text-outline"} size={16} color={colors.brandBlue} />
                </View>
                <View style={styles.resourceCopy}>
                  <Text style={styles.resourceTitle} numberOfLines={1}>{resource.title || titleFromUrl(url || "Resource")}</Text>
                  <Text style={styles.resourceMeta} numberOfLines={1}>
                    {resourceProvenanceText(resource)}
                  </Text>
                </View>
                {url ? <Ionicons name="open-outline" size={15} color={colors.textMuted} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.resourceEmpty}>No documents or media are connected to this model yet.</Text>
      )}
      {canManage ? (
        <View style={styles.modelResourceManager}>
          <View style={styles.resourceRoleRow}>
            {MODEL_RESOURCE_ROLES.map((role) => (
              <TouchableOpacity
                key={role.key}
                activeOpacity={0.86}
                style={[styles.resourceRoleButton, resourceRole === role.key && styles.resourceRoleButtonActive]}
                onPress={() => onResourceRoleChange?.(role.key)}
                disabled={addingResource}
              >
                <Text style={[styles.resourceRoleText, resourceRole === role.key && styles.resourceRoleTextActive]}>
                  {role.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.mediaManager}>
            <TextInput
              value={resourceLinkUrl}
              onChangeText={onResourceLinkUrlChange}
              placeholder="Paste OEM resource URL"
              placeholderTextColor={colors.textMuted}
              style={styles.mediaInput}
            />
            <TouchableOpacity
              style={styles.mediaButton}
              onPress={onAddResourceUrl}
              disabled={addingResource}
              activeOpacity={0.86}
            >
              <Ionicons name="link-outline" size={15} color={colors.brandNavy} />
              <Text style={styles.mediaButtonText}>Add Link</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mediaPrimaryButton}
              onPress={onUploadResource}
              disabled={addingResource}
              activeOpacity={0.86}
            >
              {addingResource ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={15} color={colors.onPrimary} />}
              <Text style={styles.mediaPrimaryButtonText}>Add File</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <TouchableOpacity activeOpacity={0.86} style={styles.resourceManageButton} onPress={onOpenResources}>
        <Ionicons name="document-text-outline" size={15} color={colors.brandNavy} />
        <Text style={styles.resourceManageText}>View resources</Text>
      </TouchableOpacity>
    </View>
  );
}

function ItemCard({ item, resources, onPress, onOpenEditor, selected }) {
  const sourceLabel = itemSourceLabel(item, resources);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.itemCard, selected && styles.itemCardSelected]}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemBadge}>{standardLabel(item)}</Text>
        {onOpenEditor ? (
          <TouchableOpacity
            accessibilityLabel={`Edit ${item.label}`}
            onPress={onOpenEditor}
            style={styles.itemEditButton}
            activeOpacity={0.84}
          >
            <Ionicons name="create-outline" size={14} color={colors.brandBlue} />
            <Text style={styles.itemEditText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.itemTitle} numberOfLines={2}>{item.label}</Text>
      {valueText(item.expected_value) ? (
        <Text style={styles.itemValue} numberOfLines={2}>{valueText(item.expected_value)}</Text>
      ) : null}
      <Text style={styles.itemSource} numberOfLines={1}>{sourceLabel}</Text>
    </TouchableOpacity>
  );
}

function SectionGroup({ group, resources, selectedId, onSelect, onOpenEditor }) {
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
            resources={resources}
            selected={item.id === selectedId}
            onPress={() => onSelect(item)}
            onOpenEditor={() => onOpenEditor?.(item)}
          />
        ))}
      </View>
    </View>
  );
}

function Inspector({ item, resources, onEditItem }) {
  if (!item) return null;

  const price = item.metadata?.source_price;
  const selectionRule = item.applicability?.selection_rule;
  const source = resources.find((resource) => resource.id === item.source_resource_id) || resources[0];
  const sourceLink = resourceUrl(source);

  return (
    <View style={styles.inspector}>
      <Text style={styles.inspectorKicker}>{standardLabel(item)}</Text>
      <Text style={styles.inspectorTitle}>{item.label}</Text>
        <Text style={styles.inspectorText}>
          {item.metadata?.description || item.metadata?.source_note || "Published in the OEM model guide for this year/model template."}
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
          <Text style={styles.inspectorValue}>{itemSourceLabel(item, resources)}</Text>
        </View>
        <View style={styles.inspectorRow}>
          <Text style={styles.inspectorLabel}>Editable in</Text>
          <Text style={styles.inspectorValue}>Edit Model</Text>
        </View>
      </View>
      <View style={styles.inspectorActions}>
        {sourceLink ? (
          <TouchableOpacity activeOpacity={0.86} style={styles.inspectorActionButton} onPress={() => Linking.openURL(sourceLink)}>
            <Ionicons name="open-outline" size={15} color={colors.brandNavy} />
            <Text style={styles.inspectorActionText}>Open source</Text>
          </TouchableOpacity>
        ) : null}
        {itemEditParams(item, "", {}) && onEditItem ? (
          <TouchableOpacity activeOpacity={0.86} style={styles.inspectorPrimaryActionButton} onPress={() => onEditItem(item)}>
            <Ionicons name="create-outline" size={15} color={colors.onPrimary} />
            <Text style={styles.inspectorPrimaryActionText}>Edit Model</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function EmptyChapter({ tab }) {
  const label = TABS.find((item) => item.key === tab)?.label || "chapter";
  return (
    <View style={styles.emptyChapter}>
      <Ionicons name="sparkles-outline" size={22} color={colors.brandBlue} />
      <Text style={styles.emptyChapterTitle}>No {label} content has been added yet.</Text>
      <Text style={styles.emptyChapterText}>Add resources or edit the model to enrich this chapter.</Text>
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
  onSetHero,
  onToggleShowcase,
  onRemovePlacement,
  onDeleteAttachment,
  addingMedia = false,
}) {
  const gallery = includeHero ? media : media.filter((item) => item.is_showcase || item.role !== "hero");
  const canManage = !!(onAddMediaUrl || onUploadMedia);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const lightboxItem = lightboxIndex === null ? null : gallery[lightboxIndex] || null;
  const openLightbox = (item, index) => {
    onSelect?.(item);
    setLightboxIndex(index);
  };
  const moveLightbox = (direction) => {
    if (!gallery.length) return;
    setLightboxIndex((current) => {
      const index = current === null ? 0 : current;
      return (index + direction + gallery.length) % gallery.length;
    });
  };
  const lightboxUri = lightboxItem
    ? lightboxItem.attachment_signed_url || lightboxItem.attachment_storage_signed_url || lightboxItem.attachment_url || lightboxItem.url
    : null;

  return (
    <View style={styles.galleryPanel}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.resourceEyebrow}>Model media</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Text style={styles.sectionCount}>{gallery.length}</Text>
      </View>
      <Text style={styles.galleryText}>
        Model-level media is available to exact boats as inherited catalog media. It is not exact-hull evidence unless attached to that KAC.
      </Text>
      {canManage ? (
        <View style={styles.mediaManager}>
          <TextInput
            value={mediaUrl}
            onChangeText={onMediaUrlChange}
            placeholder="Paste OEM media URL"
            placeholderTextColor={colors.textMuted}
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
            <Text style={styles.mediaPrimaryButtonText}>Add Photos</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {gallery.length ? (
        <View style={styles.galleryGrid}>
          {gallery.map((item, index) => (
            <TouchableOpacity
              key={item.id || item.local_asset_key}
              style={styles.galleryCard}
              onPress={() => openLightbox(item, index)}
              activeOpacity={0.88}
            >
              <ImageBackground source={mediaAsset(item, template)} resizeMode="cover" style={styles.galleryImage} imageStyle={styles.galleryImageAsset}>
                <View style={styles.galleryShade}>
                  <View style={styles.galleryLabels}>
                    <Text style={styles.galleryRole}>{item.is_hero ? "Hero" : item.is_showcase ? "Showcase" : labelize(item.role)}</Text>
                    <Text style={styles.galleryProvenance}>Model media</Text>
                  </View>
                </View>
              </ImageBackground>
              {canManage ? (
                <View style={styles.galleryActions}>
                  <TouchableOpacity
                    style={styles.galleryActionButton}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      openLightbox(item, index);
                    }}
                  >
                    <Text style={styles.galleryActionText}>Open</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.galleryActionButton, item.is_hero && styles.galleryActionActive]}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      onSetHero?.(item);
                    }}
                  >
                    <Text style={[styles.galleryActionText, item.is_hero && styles.galleryActionTextActive]}>
                      {item.is_hero ? "Hero" : "Set hero"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.galleryActionButton, item.is_showcase && styles.galleryActionActive]}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      onToggleShowcase?.(item);
                    }}
                  >
                    <Text style={[styles.galleryActionText, item.is_showcase && styles.galleryActionTextActive]}>
                      {item.is_showcase ? "In showcase" : "Showcase"}
                    </Text>
                  </TouchableOpacity>
                  {item.placement_id ? (
                    <TouchableOpacity
                      style={styles.galleryActionButton}
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        onRemovePlacement?.(item);
                      }}
                    >
                      <Text style={styles.galleryActionText}>Remove placement</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.can_delete_attachment ? (
                    <TouchableOpacity
                      style={[styles.galleryActionButton, styles.galleryActionDanger]}
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        onDeleteAttachment?.(item);
                      }}
                    >
                      <Text style={[styles.galleryActionText, styles.galleryActionDangerText]}>Delete</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
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
      <Modal
        visible={!!lightboxItem}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxIndex(null)}
      >
        <View style={styles.lightboxBackdrop}>
          <View style={styles.lightboxShell}>
            <View style={styles.lightboxHeader}>
              <View style={styles.lightboxTitleBlock}>
                <Text style={styles.lightboxEyebrow}>Model media</Text>
                <Text style={styles.lightboxTitle} numberOfLines={1}>
                  {lightboxItem?.title || lightboxItem?.file_name || "Catalog image"}
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.lightboxIconButton}
                onPress={() => setLightboxIndex(null)}
              >
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.lightboxImageWrap}>
              {gallery.length > 1 ? (
                <TouchableOpacity
                  activeOpacity={0.86}
                  style={[styles.lightboxArrow, styles.lightboxArrowLeft]}
                  onPress={() => moveLightbox(-1)}
                >
                  <Ionicons name="chevron-back" size={28} color={colors.onPrimary} />
                </TouchableOpacity>
              ) : null}
              {lightboxItem ? (
                <ImageBackground
                  source={mediaAsset(lightboxItem, template)}
                  resizeMode="contain"
                  style={styles.lightboxImage}
                  imageStyle={styles.lightboxImageAsset}
                />
              ) : null}
              {gallery.length > 1 ? (
                <TouchableOpacity
                  activeOpacity={0.86}
                  style={[styles.lightboxArrow, styles.lightboxArrowRight]}
                  onPress={() => moveLightbox(1)}
                >
                  <Ionicons name="chevron-forward" size={28} color={colors.onPrimary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.lightboxFooter}>
              <View>
                <Text style={styles.lightboxMeta}>{lightboxIndex === null ? 0 : lightboxIndex + 1} of {gallery.length}</Text>
                <Text style={styles.lightboxProvenance}>
                  {lightboxItem?.provenance_label || lightboxItem?.attribution || "Reusable model/catalog media"}
                </Text>
              </View>
              <View style={styles.lightboxActions}>
                {lightboxUri ? (
                  <TouchableOpacity activeOpacity={0.86} style={styles.lightboxButton} onPress={() => Linking.openURL(lightboxUri)}>
                    <Ionicons name="open-outline" size={15} color={colors.brandNavy} />
                    <Text style={styles.lightboxButtonText}>Open source</Text>
                  </TouchableOpacity>
                ) : null}
                {onSetHero ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[styles.lightboxButton, lightboxItem?.is_hero && styles.lightboxButtonActive]}
                    onPress={() => onSetHero(lightboxItem)}
                  >
                    <Ionicons name="image-outline" size={15} color={lightboxItem?.is_hero ? colors.onPrimary : colors.brandNavy} />
                    <Text style={[styles.lightboxButtonText, lightboxItem?.is_hero && styles.lightboxButtonTextActive]}>
                      {lightboxItem?.is_hero ? "Hero" : "Set hero"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {onToggleShowcase ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[styles.lightboxButton, lightboxItem?.is_showcase && styles.lightboxButtonActive]}
                    onPress={() => onToggleShowcase(lightboxItem)}
                  >
                    <Ionicons name="images-outline" size={15} color={lightboxItem?.is_showcase ? colors.onPrimary : colors.brandNavy} />
                    <Text style={[styles.lightboxButtonText, lightboxItem?.is_showcase && styles.lightboxButtonTextActive]}>
                      {lightboxItem?.is_showcase ? "In showcase" : "Showcase"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
  const [templateAttachmentMedia, setTemplateAttachmentMedia] = useState([]);
  const [templateAttachmentResources, setTemplateAttachmentResources] = useState([]);
  const [resourceLinkUrl, setResourceLinkUrl] = useState("");
  const [resourceRole, setResourceRole] = useState("manual");
  const [addingResource, setAddingResource] = useState(false);
  const [identityModalVisible, setIdentityModalVisible] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({
    manufacturer: "",
    model: "",
    modelYear: "",
    category: "",
    className: "",
  });
  const [savingIdentity, setSavingIdentity] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await hydrateTemplatePhotoResources(await getCatalogTemplateDetail({ templateKey }));
      const [attachmentMedia, attachmentResources] = await Promise.all([
        hydrateTemplateAttachmentMedia(next?.template),
        hydrateTemplateAttachmentResources(next?.template),
      ]);
      setDetail(next);
      setTemplateAttachmentMedia(attachmentMedia);
      setTemplateAttachmentResources(attachmentResources);
      const items = next?.items || [];
      setSelectedItem((current) => {
        if (!current) return null;
        if (String(current.id || "").startsWith("media-")) return current;
        return items.find((item) => item.id === current.id) || null;
      });
    } catch (err) {
      console.error("Activator catalog detail failed:", err);
      setError(err?.message || "Could not load this model catalog.");
      setDetail(null);
      setTemplateAttachmentMedia([]);
      setTemplateAttachmentResources([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const modelProjection = useMemo(() => projectModelTemplateDetail(detail), [detail]);
  const items = modelProjection.items || [];
  const resources = useMemo(() => {
    const byId = new Map();
    [...(templateAttachmentResources || []), ...(modelProjection.resources || [])].forEach((resource) => {
      const key = resource?.attachment_id || resource?.resource_id || resource?.id || resource?.url;
      if (key && !byId.has(key)) byId.set(key, resource);
    });
    return Array.from(byId.values());
  }, [modelProjection.resources, templateAttachmentResources]);
  const template = modelProjection.template || {};
  const showcaseMedia = normalizeTemplateMedia(modelProjection, templateAttachmentMedia, modelProjection.template || {});
  const heroMedia = mediaByRole(showcaseMedia, "hero") || modelProjection.media?.hero;
  const visibleGroups = modelProjection.catalog?.chaptersByKey?.[tab] || [];
  const visibleItemIds = useMemo(() => {
    const ids = new Set();
    visibleGroups.forEach((group) => {
      group.children.forEach((item) => ids.add(item.id));
    });
    return ids;
  }, [visibleGroups]);
  const selectedItemForInspector = useMemo(() => {
    if (!selectedItem) return null;
    const selectedId = String(selectedItem.id || "");
    if (selectedId.startsWith("media-")) {
      return tab === "overview" || tab === "media" ? selectedItem : null;
    }
    return visibleItemIds.has(selectedItem.id) ? selectedItem : null;
  }, [selectedItem, tab, visibleItemIds]);
  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSelectedItem(null);
  };
  const openResourcesTab = () => selectTab("resources");

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  useEffect(() => {
    if (!template?.id) return;
    setIdentityDraft({
      manufacturer: template.manufacturer || "",
      model: template.model || "",
      modelYear: template.model_year ? String(template.model_year) : "",
      category: template.category || "marine",
      className: template.class || "",
    });
  }, [template?.id, template?.manufacturer, template?.model, template?.model_year, template?.category, template?.class]);

  const startExactBuild = () => {
    navigation.navigate("ActivatorExactBuild", {
      templateKey: template.template_key || templateKey,
      organizationId: route?.params?.organizationId || null,
      workspaceId: route?.params?.workspaceId || null,
    });
  };

  const customizeTemplate = (focusCanonicalKey = null) => {
    navigation.navigate("ActivatorTemplateCustomize", {
      templateKey: template.template_key || templateKey,
      organizationId: route?.params?.organizationId || null,
      workspaceId: route?.params?.workspaceId || null,
      focusCanonicalKey,
    });
  };

  const openTemplateItemEditor = (item) => {
    const params = itemEditParams(item, template.template_key || templateKey, route?.params || {});
    if (!params) return;
    navigation.navigate("ActivatorTemplateItemEditor", params);
  };

  const saveTemplateIdentity = async () => {
    const nextModelYear = Number(identityDraft.modelYear);
    const nextManufacturer = identityDraft.manufacturer.trim();
    const nextModel = identityDraft.model.trim();
    if (!template?.id) {
      Alert.alert("Template unavailable", "The model template is not loaded yet.");
      return;
    }
    if (!nextManufacturer || !nextModel || !Number.isFinite(nextModelYear)) {
      Alert.alert("Model details required", "Add manufacturer, model, and model year.");
      return;
    }

    setSavingIdentity(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Sign in is required to edit this model.");

      const { data: canManage, error: manageError } = await supabase.rpc("activator_user_can_manage_template", {
        p_user_id: userId,
        p_template_id: template.id,
      });
      if (manageError) throw manageError;
      if (!canManage) throw new Error("This account can view the model, but cannot edit OEM catalog truth.");

      const { error: updateError } = await supabase
        .from("asset_model_templates")
        .update({
          manufacturer: nextManufacturer,
          model: nextModel,
          model_year: nextModelYear,
          model_year_start: nextModelYear,
          model_year_end: nextModelYear,
          category: identityDraft.category.trim() || "marine",
          class: identityDraft.className.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", template.id);
      if (updateError) throw updateError;

      setIdentityModalVisible(false);
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not edit model", err?.message || "The model identity could not be saved.");
    } finally {
      setSavingIdentity(false);
    }
  };

  const getTemplateMediaUserId = async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error("Sign in is required to save template media.");

    const { data: canManage, error: manageError } = await supabase.rpc("activator_user_can_manage_template", {
      p_user_id: userId,
      p_template_id: template.id,
    });
    if (manageError) throw manageError;
    if (!canManage) {
      throw new Error("This account can view the model, but cannot add media to this OEM template.");
    }

    return userId;
  };

  const templateMediaSourceContext = (source = "oem_template_media") => ({
    provenance: "model_template",
    provenance_label: templateMediaLabel(template),
    provenance_detail: "Uploaded to the reusable model template; not exact-hull evidence.",
    contribution_context: source,
    authority_state: "oem_published",
    organization_id: route?.params?.organizationId || template.organization_id || null,
    template_id: template.id,
    template_key: template.template_key || templateKey,
    source_name: `${template.manufacturer || "OEM"} ${template.model || "model"}`.trim(),
    not_exact_hull_media: true,
  });

  const templateResourceSourceContext = (role, source = "oem_template_resource") => {
    const roleLabel = modelResourceRoleLabel(role);
    const orgName = template.manufacturer || "OEM";
    return {
      provenance: "model_template",
      provenance_label: `${orgName} ${roleLabel}`,
      provenance_detail: `Reusable ${roleLabel.toLowerCase()} inherited from the bound model template; not exact-hull evidence.`,
      contribution_context: source,
      contributor_role: "oem",
      contributed_by_org_role: "oem",
      authority_state: "official",
      organization_id: route?.params?.organizationId || template.organization_id || null,
      contributed_by_org_id: route?.params?.organizationId || template.organization_id || null,
      contributed_by_org_label: orgName,
      provided_by_label: orgName,
      authored_by_label: orgName,
      template_id: template.id,
      template_key: template.template_key || templateKey,
      source_name: `${orgName} ${template.model || "model"}`.trim(),
      applies_to_type: "model_template",
      applies_to_id: template.id,
      role,
      not_exact_hull_evidence: true,
    };
  };

  const modelResourceAiMetadata = (role) => ({
    role,
    authority: "official",
    privacy: "moves_with_asset",
    ai_scope: "asset",
    ai_context: ["manual", "warranty", "spec_sheet", "source"].includes(role) ? "primary" : "supporting",
    applies_to: "model_template",
  });

  const nextTemplateMediaSort = () => (templateAttachmentMedia || []).length + 1;
  const nextTemplateResourceSort = () => (templateAttachmentResources || []).length + 1;

  const createTemplatePlacement = async ({
    attachmentId,
    title,
    role = "gallery",
    isShowcase = true,
    sortOrder = nextTemplateMediaSort(),
  }) => {
    if (!attachmentId || !template?.id) throw new Error("Attachment and template are required.");
    const { data, error: placementError } = await supabase
      .from("attachment_placements")
      .upsert(
        {
          attachment_id: attachmentId,
          target_type: "model_template",
          target_id: template.id,
          role,
          label: title || null,
          sort_order: sortOrder,
          is_showcase: !!isShowcase,
        },
        { onConflict: "attachment_id,target_type,target_id", ignoreDuplicates: false }
      )
      .select("id,attachment_id,target_type,target_id,role,label,sort_order,is_showcase,created_at")
      .single();
    if (placementError) throw placementError;
    return data;
  };

  const updateTemplatePlacement = async (media, patch = {}) => {
    const placementId = media?.placement_id;
    if (!placementId || String(placementId).startsWith("media-")) throw new Error("This media item is not backed by a model placement.");
    if (!template?.id) throw new Error("Template is not loaded yet.");
    await getTemplateMediaUserId();

    const { error: updateError } = await supabase
      .from("attachment_placements")
      .update(patch)
      .eq("id", placementId)
      .eq("target_type", "model_template")
      .eq("target_id", template.id);
    if (updateError) throw updateError;
  };

  const updateTemplateHeroPlacement = async (placementId) => {
    if (!template?.id) throw new Error("Template is not loaded yet.");
    await getTemplateMediaUserId();
    const currentMetadata = template.metadata && typeof template.metadata === "object" ? template.metadata : {};
    const currentPresentation = currentMetadata.presentation && typeof currentMetadata.presentation === "object"
      ? currentMetadata.presentation
      : {};
    const nextMetadata = {
      ...currentMetadata,
      presentation: {
        ...currentPresentation,
        hero_placement_id: placementId || null,
      },
    };
    const { error: updateError } = await supabase
      .from("asset_model_templates")
      .update({ metadata: nextMetadata })
      .eq("id", template.id);
    if (updateError) throw updateError;
  };

  const setModelHero = async (media) => {
    setAddingMedia(true);
    try {
      if (!media?.placement_id) throw new Error("This media item needs a model placement before it can become Hero.");
      await updateTemplateHeroPlacement(media.placement_id);
      await updateTemplatePlacement(media, { role: "hero", is_showcase: true });
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not set hero", err?.message || "The model hero placement could not be saved.");
    } finally {
      setAddingMedia(false);
    }
  };

  const toggleModelShowcase = async (media) => {
    setAddingMedia(true);
    try {
      await updateTemplatePlacement(media, { is_showcase: !media.is_showcase });
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not update showcase", err?.message || "The showcase placement could not be saved.");
    } finally {
      setAddingMedia(false);
    }
  };

  const removeModelMediaPlacement = async (media) => {
    setAddingMedia(true);
    try {
      if (!media?.placement_id) throw new Error("This media item is not backed by a model placement.");
      if (media?.is_hero) await updateTemplateHeroPlacement(null);
      await getTemplateMediaUserId();
      await removePlacementById(media.placement_id);
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not remove placement", err?.message || "The placement could not be removed.");
    } finally {
      setAddingMedia(false);
    }
  };

  const isModelOwnedAttachment = (media) => {
    const context = media?.source_context && typeof media.source_context === "object" ? media.source_context : {};
    return !!(
      media?.attachment_id &&
      context.provenance === "model_template" &&
      (context.template_id === template?.id || context.template_key === (template?.template_key || templateKey))
    );
  };

  const deleteModelMediaAttachment = async (media) => {
    setAddingMedia(true);
    try {
      if (!isModelOwnedAttachment(media)) {
        throw new Error("Only media uploaded to this model can be deleted here. Inherited or shared media can have its placement removed.");
      }
      if (media?.is_hero) await updateTemplateHeroPlacement(null);
      await getTemplateMediaUserId();
      if (media?.placement_id) await removePlacementById(media.placement_id);
      const { count, error: placementCountError } = await supabase
        .from("attachment_placements")
        .select("id", { count: "exact", head: true })
        .eq("attachment_id", media.attachment_id);
      if (placementCountError) throw placementCountError;
      if ((count || 0) > 0) {
        throw new Error("This attachment is still used in another placement. Remove those placements before deleting the file.");
      }
      const { error: deleteError } = await supabase
        .from("attachments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", media.attachment_id);
      if (deleteError) throw deleteError;
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not delete attachment", err?.message || "The attachment could not be deleted.");
    } finally {
      setAddingMedia(false);
    }
  };

  const addTemplateMediaUrl = async () => {
    const raw = mediaUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setAddingMedia(true);
    try {
      if (!template?.id) throw new Error("Template is not loaded yet.");
      const userId = await getTemplateMediaUserId();
      const { data: attachment, error: insertError } = await supabase
        .from("attachments")
        .insert({
          owner_user_id: userId,
          asset_id: null,
          kind: "photo",
          url,
          title: titleFromUrl(url),
          notes: "OEM Gallery media",
          source_context: {
            ...templateMediaSourceContext("oem_template_media_link"),
            source_url: url,
          },
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      await createTemplatePlacement({
        attachmentId: attachment.id,
        title: titleFromUrl(url),
        role: "showcase",
        isShowcase: true,
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
    try {
      if (!template?.id) throw new Error("Template is not loaded yet.");
      const userId = await getTemplateMediaUserId();

      const pickerMediaTypes = ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: pickerMediaTypes,
        allowsMultipleSelection: true,
        quality: 0.9,
      });

      if (result.canceled) return;
      const pickedAssets = (result.assets || []).filter((asset) => asset?.uri);
      if (!pickedAssets.length) return;

      setAddingMedia(true);
      const firstSortOrder = nextTemplateMediaSort();
      for (const [index, picked] of pickedAssets.entries()) {
        const title = titleFromPickedAsset(picked, `${template.model || "Template"} media photo`);
        const sortOrder = firstSortOrder + index;
        const uploaded = await uploadAttachmentFromUri({
          userId,
          assetId: null,
          kind: "photo",
          fileUri: picked.uri,
          fileName: picked.fileName || `template-media-${Date.now()}.jpg`,
          mimeType: picked.mimeType || "image/jpeg",
          sizeBytes: picked.fileSize || null,
          title,
          sourceContext: templateMediaSourceContext("oem_template_media_upload"),
          placements: [
            {
              target_type: "model_template",
              target_id: template.id,
              role: "showcase",
              label: title,
              sort_order: sortOrder,
              is_showcase: true,
            },
          ],
        });
        if (!uploaded?.placements?.length && uploaded?.attachment?.id) {
          await createTemplatePlacement({
            attachmentId: uploaded.attachment.id,
            title,
            role: "showcase",
            isShowcase: true,
            sortOrder,
          });
        }
      }
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not upload media", err?.message || "The template photo could not be uploaded.");
    } finally {
      setAddingMedia(false);
    }
  };

  const createTemplateResourcePlacement = async ({
    attachmentId,
    title,
    role = resourceRole,
    sortOrder = nextTemplateResourceSort(),
  }) => createTemplatePlacement({
    attachmentId,
    title,
    role,
    isShowcase: false,
    sortOrder,
  });

  const updateTemplateResourceMetadata = async (attachmentId, role) => {
    if (!attachmentId) return;
    const { error: updateError } = await supabase
      .from("attachments")
      .update({ ai_metadata: modelResourceAiMetadata(role) })
      .eq("id", attachmentId);
    if (updateError) throw updateError;
  };

  const addTemplateResourceUrl = async () => {
    const raw = resourceLinkUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setAddingResource(true);
    try {
      if (!template?.id) throw new Error("Template is not loaded yet.");
      const userId = await getTemplateMediaUserId();
      const role = resourceRole || "source";
      const title = `${modelResourceRoleLabel(role)} · ${titleFromUrl(url)}`;
      const created = await createLinkAttachment({
        userId,
        assetId: null,
        url,
        title,
        notes: `${modelResourceRoleLabel(role)} for ${modelTemplateLabel(template)}`,
        sourceContext: {
          ...templateResourceSourceContext(role, "oem_template_resource_link"),
          source_url: url,
        },
        placements: [
          {
            target_type: "model_template",
            target_id: template.id,
            role,
            label: title,
            sort_order: nextTemplateResourceSort(),
            is_showcase: false,
          },
        ],
      });
      await updateTemplateResourceMetadata(created?.attachment?.id, role);
      setResourceLinkUrl("");
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not add resource", err?.message || "The model resource link could not be saved.");
    } finally {
      setAddingResource(false);
    }
  };

  const uploadTemplateResourceFile = async () => {
    setAddingResource(true);
    try {
      if (!template?.id) throw new Error("Template is not loaded yet.");
      const userId = await getTemplateMediaUserId();
      const role = resourceRole || "source";
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: !IS_WEB,
      });

      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;

      const title = picked.name || titleFromPickedAsset(picked, `${modelResourceRoleLabel(role)} file`);
      const uploaded = await uploadAttachmentFromUri({
        userId,
        assetId: null,
        kind: "file",
        fileUri: picked.uri,
        fileName: picked.name || title,
        mimeType: picked.mimeType || "application/octet-stream",
        sizeBytes: picked.size || null,
        title,
        notes: `${modelResourceRoleLabel(role)} for ${modelTemplateLabel(template)}`,
        sourceContext: templateResourceSourceContext(role, "oem_template_resource_upload"),
        placements: [
          {
            target_type: "model_template",
            target_id: template.id,
            role,
            label: title,
            sort_order: nextTemplateResourceSort(),
            is_showcase: false,
          },
        ],
      });
      await updateTemplateResourceMetadata(uploaded?.attachment?.id, role);
      if (!uploaded?.placements?.length && uploaded?.attachment?.id) {
        await createTemplateResourcePlacement({
          attachmentId: uploaded.attachment.id,
          title,
          role,
        });
      }
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not upload resource", err?.message || "The model resource file could not be uploaded.");
    } finally {
      setAddingResource(false);
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
          current={`${template.model || "Model"} Template`}
        />
        <ImageBackground source={mediaAsset(heroMedia, template)} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>{template.manufacturer || "OEM"} Catalog</Text>
              <Text style={styles.title}>MY{template.model_year || "Year"} {template.manufacturer || "Manufacturer"} {template.model || "Model"}</Text>
              <Text style={styles.subtitle}>
                The OEM model guide as a navigable ownership template, preserving brochure sections, standards, available options, care, and source provenance.
              </Text>
              <View style={styles.sourcePill}>
                <Ionicons name="document-text-outline" size={15} color={colors.brandNavy} />
                <Text style={styles.sourcePillText} numberOfLines={1}>
                  {heroMedia?.metadata?.source_document_title || resources[0]?.title || "OEM Buyer Guide"}
                </Text>
              </View>
              <View style={styles.heroActions}>
                <TouchableOpacity activeOpacity={0.86} style={styles.customizeButton} onPress={() => customizeTemplate()}>
                  <Ionicons name="create-outline" size={16} color={colors.brandNavy} />
                  <Text style={styles.customizeButtonText}>
                    Edit Model
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.86} style={styles.customizeButton} onPress={() => setIdentityModalVisible(true)}>
                  <Ionicons name="pencil-outline" size={16} color={colors.brandNavy} />
                  <Text style={styles.customizeButtonText}>
                    Edit Details
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

        <View style={styles.tabRow}>
          {TABS.map((item) => (
            <TabButton key={item.key} tab={item} active={tab === item.key} onPress={() => selectTab(item.key)} />
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
                  onSetHero={setModelHero}
                  onToggleShowcase={toggleModelShowcase}
                  onRemovePlacement={removeModelMediaPlacement}
                  onDeleteAttachment={deleteModelMediaAttachment}
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
              {tab === "overview" || tab === "resources" ? (
                <ResourcePanel
                  resources={resources}
                  onOpenResources={openResourcesTab}
                  resourceLinkUrl={resourceLinkUrl}
                  onResourceLinkUrlChange={setResourceLinkUrl}
                  onAddResourceUrl={addTemplateResourceUrl}
                  onUploadResource={uploadTemplateResourceFile}
                  resourceRole={resourceRole}
                  onResourceRoleChange={setResourceRole}
                  addingResource={addingResource}
                />
              ) : null}
              {visibleGroups.map((group) => (
                <SectionGroup
                  key={group.section.id}
                  group={group}
                  resources={resources}
                  selectedId={selectedItem?.id}
                  onSelect={setSelectedItem}
                  onOpenEditor={openTemplateItemEditor}
                />
              ))}
              {tab !== "overview" && tab !== "media" && tab !== "resources" && !visibleGroups.length ? (
                <EmptyChapter tab={tab} />
              ) : null}
            </View>
            {selectedItemForInspector ? (
              <View style={styles.inspectorColumn}>
                <Inspector
                  item={selectedItemForInspector}
                  resources={resources}
                  onEditItem={openTemplateItemEditor}
                />
              </View>
            ) : null}
          </View>
        )}
    </ScrollView>
      <Modal visible={identityModalVisible} animationType="fade" transparent onRequestClose={() => setIdentityModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.identityModal}>
            <View style={styles.identityHeader}>
              <View>
                <Text style={styles.identityEyebrow}>Catalog Identity</Text>
                <Text style={styles.identityTitle}>Edit Model</Text>
              </View>
              <TouchableOpacity style={styles.iconButton} onPress={() => setIdentityModalVisible(false)}>
                <Ionicons name="close" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.identityGrid}>
              <TextInput
                value={identityDraft.manufacturer}
                onChangeText={(value) => setIdentityDraft((current) => ({ ...current, manufacturer: value }))}
                placeholder="Manufacturer"
                placeholderTextColor={colors.textMuted}
                style={styles.identityInput}
              />
              <TextInput
                value={identityDraft.model}
                onChangeText={(value) => setIdentityDraft((current) => ({ ...current, model: value }))}
                placeholder="Model"
                placeholderTextColor={colors.textMuted}
                style={styles.identityInput}
              />
              <TextInput
                value={identityDraft.modelYear}
                onChangeText={(value) => setIdentityDraft((current) => ({ ...current, modelYear: value }))}
                placeholder="Model year"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={styles.identityInput}
              />
              <TextInput
                value={identityDraft.category}
                onChangeText={(value) => setIdentityDraft((current) => ({ ...current, category: value }))}
                placeholder="Category"
                placeholderTextColor={colors.textMuted}
                style={styles.identityInput}
              />
              <TextInput
                value={identityDraft.className}
                onChangeText={(value) => setIdentityDraft((current) => ({ ...current, className: value }))}
                placeholder="Class"
                placeholderTextColor={colors.textMuted}
                style={styles.identityInput}
              />
            </View>
            <View style={styles.identityActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setIdentityModalVisible(false)} disabled={savingIdentity}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={saveTemplateIdentity} disabled={savingIdentity}>
                {savingIdentity ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.saveButtonText}>Save Model</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.54)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  identityModal: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 560,
    padding: spacing.lg,
    width: "100%",
    ...shadows.card,
  },
  identityHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  identityEyebrow: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  identityTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  identityGrid: {
    gap: spacing.sm,
  },
  identityInput: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  identityActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  cancelButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  cancelButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 120,
    paddingHorizontal: spacing.lg,
  },
  saveButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
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
  resourcesPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  emptyChapter: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    minHeight: 160,
    justifyContent: "center",
    padding: spacing.xl,
    ...shadows.sm,
  },
  emptyChapterTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyChapterText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 420,
    textAlign: "center",
  },
  resourceEyebrow: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  resourceList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resourceRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    padding: spacing.md,
  },
  resourceIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  resourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  resourceTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  resourceMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  resourceEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  resourceManageButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  resourceManageText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  modelResourceManager: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  resourceRoleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  resourceRoleButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  resourceRoleButtonActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  resourceRoleText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
  },
  resourceRoleTextActive: {
    color: colors.onPrimary,
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
  galleryLabels: {
    alignItems: "flex-start",
    gap: spacing.xs,
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
  galleryProvenance: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: radius.sm,
    color: colors.brandNavy,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  galleryActions: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  galleryActionButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  galleryActionActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  galleryActionDanger: {
    borderColor: colors.accentRed,
  },
  galleryActionText: {
    color: colors.brandNavy,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 28,
  },
  galleryActionTextActive: {
    color: colors.onPrimary,
  },
  galleryActionDangerText: {
    color: colors.accentRed,
  },
  lightboxBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(7, 12, 24, 0.76)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  lightboxShell: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 1120,
    overflow: "hidden",
    width: "100%",
    ...shadows.lg,
  },
  lightboxHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lightboxTitleBlock: {
    flex: 1,
    paddingRight: spacing.md,
  },
  lightboxEyebrow: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  lightboxTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  lightboxIconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  lightboxImageWrap: {
    alignItems: "center",
    backgroundColor: "#050B17",
    minHeight: 520,
    position: "relative",
  },
  lightboxImage: {
    height: 560,
    width: "100%",
  },
  lightboxImageAsset: {
    objectFit: "contain",
  },
  lightboxArrow: {
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.72)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.full,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    position: "absolute",
    top: "45%",
    width: 52,
    zIndex: 4,
  },
  lightboxArrowLeft: {
    left: spacing.lg,
  },
  lightboxArrowRight: {
    right: spacing.lg,
  },
  lightboxFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  lightboxMeta: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  lightboxProvenance: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  lightboxActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  lightboxButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  lightboxButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  lightboxButtonText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  lightboxButtonTextActive: {
    color: colors.onPrimary,
  },
  itemHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemEditButton: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 4,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  itemEditText: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
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
  itemSource: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
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
  inspectorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  inspectorActionButton: {
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
  inspectorActionText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  inspectorPrimaryActionButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  inspectorPrimaryActionText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
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
