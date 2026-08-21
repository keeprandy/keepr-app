import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
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
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";
import {
  fetchAssetHeroUris,
  getCachedAssetHeroUris,
  resolveAssetHeroUri,
} from "../lib/assetHeroResolver";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import {
  loadAttachmentsForMessages,
  sendKeeprProStewardshipThreadReply,
  startKeeprProStewardshipThread,
} from "../lib/messagesService";
import { buildServiceActionRouteParams } from "../lib/serviceActionPrefill";
import {
  createRelationshipRecordContribution,
  listRelationshipSharedHistory,
} from "../lib/relationshipContributionsApi";
import {
  listKeeprSpacePlaybooks,
  removeKeeprSpaceBoatAsset,
  updateKeeprSpaceBoatAsset,
} from "../lib/keeprspaceApi";
import { getActionScheduleLabel, getActionScheduledDueAt } from "../lib/playbookSchedule";
import { formatContributionAttribution } from "../lib/provenance";
import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { useWorkspace } from "../context/WorkspaceContext";
import AttachmentViewerModal from "../components/AttachmentViewerModal";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

const BOAT_HERO_OPTIONS = {
  transform: null,
  expiresIn: 60 * 60 * 24,
};

function boatEditSections(providerName = "Current Workspace") {
  const workspaceLabel = providerName || "Current Workspace";
  return [
  {
    title: "Boat details",
    fields: [
      ["year", "Year", "2026", "number-pad"],
      ["make", "Make", "Make"],
      ["model", "Model", "39 LE"],
      ["lengthFeet", "Length (ft)", "39", "decimal-pad"],
      ["hin", "Serial / HIN", "Optional but preferred"],
      ["name", "Boat name", "Optional"],
      ["hullMaterial", "Hull material", "Fiberglass, aluminum"],
      ["engine", "Engine type", "Twin Volvo Penta V8"],
      ["engineHours", "Engine hours", "Optional", "decimal-pad"],
      ["registrationNumber", "Registration #", "State registration number"],
      ["newUsed", "New / used", "New, used, certified"],
      ["location", "Primary location", "Dock, yard, showroom"],
    ],
  },
  {
    title: `${workspaceLabel} relationship metadata`,
    fields: [
      ["stockNumber", "Stock #", "Stock number"],
      ["listingUrl", "Listing URL", "https://..."],
      ["externalAssetId", "External / G2 asset ID", "Optional inventory system ID"],
      ["wilsonLocation", "Workspace location", "Showroom, storage yard, service bay"],
    ],
  },
  {
    title: "Existing customer / storage intake",
    fields: [
      ["customerExternalSystem", "Customer system", "g2"],
      ["customerExternalId", "Customer ID", "Optional external customer ID"],
      ["customerDisplayName", "Customer name", "Customer display name"],
      ["customerEmail", "Customer email", "Optional email", "email-address"],
      ["customerPhone", "Customer phone", "Optional phone", "phone-pad"],
    ],
  },
  {
    title: "Value & purchase",
    fields: [
      ["purchasePrice", "Purchase price", "Optional", "decimal-pad"],
      ["estimatedValue", "Estimated value", "Optional", "decimal-pad"],
      ["purchaseDate", "Purchase date", "YYYY-MM-DD"],
    ],
  },
  ];
}

const BOAT_EDIT_PATCH_KEYS = {
  lengthFeet: "length_feet",
  engine: "engine_type",
  engineHours: "engine_hours",
  hullMaterial: "hull_material",
  registrationNumber: "registration_number",
  assetMode: "asset_mode",
  commercialEntity: "commercial_entity",
  newUsed: "new_used",
  stockNumber: "stock_number",
  listingUrl: "listing_url",
  externalAssetId: "external_asset_id",
  wilsonLocation: "wilson_location",
  customerExternalSystem: "customer_external_system",
  customerExternalId: "customer_external_id",
  customerDisplayName: "customer_display_name",
  customerEmail: "customer_email",
  customerPhone: "customer_phone",
  purchasePrice: "purchase_price",
  estimatedValue: "estimated_value",
  purchaseDate: "purchase_date",
};

function compact(values) {
  return values.filter((value) => value !== null && value !== undefined && value !== "").join(" · ");
}

function labelize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function shouldSkipBackgroundRefresh() {
  return Platform.OS === "web" && typeof document !== "undefined" && document.visibilityState === "hidden";
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

function normalizeCanonicalThread(thread) {
  if (!thread?.thread_id) return null;
  return {
    id: thread.thread_id,
    subject: thread.subject,
    status: thread.status,
    updated_at: thread.updated_at,
    messages: thread.messages || [],
  };
}

function normalizeCanonicalProjection(canonical, fallback = null) {
  if (!canonical?.asset?.id) return fallback;
  const relationship = canonical.relationship || {};
  const canonicalSystems = Array.isArray(canonical.systems) ? canonical.systems : [];
  const fallbackSystems = Array.isArray(fallback?.systems) ? fallback.systems : [];
  const canonicalHistory = Array.isArray(canonical.shared_history) ? canonical.shared_history : [];
  const fallbackHistory = Array.isArray(fallback?.service_records) ? fallback.service_records : [];
  return {
    ...(fallback || {}),
    asset: {
      ...(fallback?.asset || {}),
      ...(canonical.asset || {}),
      owner_display_name: canonical.owner?.display_name || fallback?.asset?.owner_display_name,
      owner_email: canonical.owner?.email || fallback?.asset?.owner_email,
      hero_placement_id:
        canonical.asset?.hero_placement_id ||
        fallback?.asset?.hero_placement_id ||
        null,
      hero_image_url:
        canonical.asset?.hero_image_url ||
        fallback?.asset?.hero_image_url ||
        null,
      hero_thumb_url:
        canonical.asset?.hero_thumb_url ||
        fallback?.asset?.hero_thumb_url ||
        null,
    },
    organization: relationship.organization_id
      ? {
          ...(fallback?.organization || {}),
          id: relationship.organization_id,
          name: relationship.organization_name,
          slug: relationship.organization_slug,
        }
      : fallback?.organization,
    keepr_pro: relationship.keepr_pro_id
      ? {
          ...(fallback?.keepr_pro || {}),
          id: relationship.keepr_pro_id,
          name: relationship.keepr_pro_name,
          slug: relationship.keepr_pro_slug,
        }
      : fallback?.keepr_pro,
    relationship: relationship.id
      ? {
          ...(fallback?.relationship || {}),
          id: relationship.id,
          relationship_type: relationship.relationship_type,
          relationship_purpose: relationship.relationship_purpose,
          status: relationship.status,
          access_scope: relationship.access_scope,
          claim_state: relationship.claim_state,
          initiated_at: relationship.initiated_at,
          effective_from: relationship.effective_from,
          effective_to: relationship.effective_to,
        }
      : fallback?.relationship,
    stewardship: relationship.compatibility_stewardship_id
      ? {
          ...(fallback?.stewardship || {}),
          id: relationship.compatibility_stewardship_id,
        }
      : fallback?.stewardship,
    systems: canonicalSystems.length ? canonicalSystems : fallbackSystems,
    service_records: canonicalHistory.length ? canonicalHistory : fallbackHistory,
    actions: canonical.current_action ? [canonical.current_action] : fallback?.actions || [],
    hero_media: fallback?.hero_media || null,
  };
}

function normalizeCanonicalPortal(canonical, fallback = null) {
  if (!canonical?.asset?.id) return fallback || null;
  const thread = normalizeCanonicalThread(canonical.messages);
  const canonicalFiles = Array.isArray(canonical.files) ? canonical.files : [];
  const fallbackFiles = Array.isArray(fallback?.shared_files) ? fallback.shared_files : [];
  const currentAction = canonical.current_action
    ? {
        ...(fallback?.current_action || {}),
        ...canonical.current_action,
        provider_response: {
          ...(fallback?.current_action?.provider_response || {}),
          ...(canonical.current_action.provider_response || {}),
          next_step:
            canonical.current_action.provider_response?.next_step ||
            canonical.operating_state?.next_step ||
            fallback?.current_action?.provider_response?.next_step,
        },
        responsible_party:
          canonical.current_action.responsible_party ||
          fallback?.current_action?.responsible_party ||
          (canonical.operating_state?.waiting_on
            ? { label: canonical.operating_state.waiting_on }
            : null),
      }
    : fallback?.current_action || null;

  return {
    ...(fallback || {}),
    current_action: currentAction,
    owner_display_name: canonical.owner?.display_name || fallback?.owner_display_name,
    relationship_title:
      canonical.owner?.display_name && canonical.relationship?.organization_name
        ? `${canonical.owner.display_name} ↔ ${canonical.relationship.organization_name}`
        : fallback?.relationship_title,
    stewardship_id:
      canonical.relationship?.compatibility_stewardship_id || fallback?.stewardship_id || null,
    projection_thread: thread || fallback?.projection_thread || null,
    shared_files: canonicalFiles.length ? canonicalFiles : fallbackFiles,
    shared_action_count: canonical.counts?.open_actions ?? fallback?.shared_action_count,
    permitted_operations: {
      ...(fallback?.permitted_operations || {}),
      ...(canonical.permitted_operations || {}),
    },
    what_next: canonical.operating_state?.next_step
      ? { ...(fallback?.what_next || {}), title: canonical.operating_state.next_step }
      : fallback?.what_next,
  };
}

function compactMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function messageSenderLabel(message, ownerName, providerName) {
  if (message?.sender_type === "keepr_pro") return providerName || "Service Team";
  if (message?.sender_name) return message.sender_name;
  return ownerName || "Owner";
}

function isPlaybookStepComplete(step) {
  return ["complete", "completed", "done"].includes(String(step?.status || "").toLowerCase());
}

function isLivePlaybook(playbook) {
  return ["active", "activated", "in_progress"].includes(String(playbook?.status || "").toLowerCase());
}

function playbookDedupeKey(playbook) {
  return String(playbook?.name || "").trim().toLowerCase() || String(playbook?.id || "");
}

function playbookDisplayStatus(playbook) {
  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  if (steps.length && steps.every(isPlaybookStepComplete)) return "complete";
  if (isLivePlaybook(playbook)) return "active";
  return String(playbook?.status || "draft").replace(/_/g, " ");
}

function visibleRelationshipPlaybooks(playbooks = []) {
  const filtered = playbooks.filter((item) =>
    !["archived", "deleted"].includes(String(item?.status || "").toLowerCase())
  );
  const liveKeys = new Set(filtered.filter(isLivePlaybook).map(playbookDedupeKey));
  return filtered
    .filter((item) => {
      const status = String(item?.status || "").toLowerCase();
      return !(status === "draft" && liveKeys.has(playbookDedupeKey(item)));
    })
    .sort((a, b) => {
      const liveDelta = Number(isLivePlaybook(b)) - Number(isLivePlaybook(a));
      if (liveDelta) return liveDelta;
      return String(b?.updated_at || b?.created_at || "").localeCompare(String(a?.updated_at || a?.created_at || ""));
    });
}

function playbookProgressSummary(playbook) {
  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  const completeCount = steps.filter(isPlaybookStepComplete).length;
  return `${completeCount} of ${steps.length} complete`;
}

function playbookStepScheduleLabel(step) {
  if (!step?.due_date) return "Unscheduled";
  const date = formatDate(step.due_date);
  const time = step?.metadata?.due_time || step?.due_time || null;
  return time ? `${date} · ${time}` : date;
}

function playbookStepExecutionLabel(step) {
  if (isPlaybookStepComplete(step)) return "Done";
  if (step?.due_date) return playbookStepScheduleLabel(step);
  if (step?.action_id) return "Active";
  return "Unscheduled";
}

function playbookStepKindLabel(step) {
  if (step?.step_type === "service") return "Service";
  return "Action";
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
  const { currentWorkspace } = useWorkspace();
  const { assetId, kac } = route?.params || {};
  const organizationId =
    route?.params?.organizationId ||
    currentWorkspace?.organization_id ||
    currentWorkspace?.org_id ||
    null;
  const isWilsonBoatRoute =
    route?.name === "KeeprSpaceBoat" ||
    route?.name === "WilsonBoat" ||
    (Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname.startsWith("/wilson/boats/"));
  const parentRoute = route?.params?.parentRoute || (isWilsonBoatRoute ? "KeeprSpaceFleet" : "ActivatorHome");
  const parentParams =
    parentRoute === "KeeprSpaceFleet" || parentRoute === "WilsonFleet"
      ? {
          organizationId,
          workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
        }
      : {
          initialMode: "fleet",
          organizationId,
          workspaceId: organizationId ? `org:${organizationId}` : null,
        };
  const parentCrumbLabel =
    parentRoute === "KeeprSpaceFleet" || parentRoute === "WilsonFleet"
      ? "Active Fleet"
      : "Service";
  const breadcrumbHomeRoute =
    parentRoute === "KeeprSpaceFleet" || parentRoute === "WilsonFleet"
      ? "KeeprSpaceHome"
      : parentRoute;
  const breadcrumbHomeParams = {
    ...(parentRoute === "KeeprSpaceFleet" || parentRoute === "WilsonFleet" ? {} : parentParams),
    organizationId,
    workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
  };
  const [projection, setProjection] = useState(null);
  const [portal, setPortal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [relationshipPlaybooks, setRelationshipPlaybooks] = useState([]);
  const [viewMode, setViewMode] = useState("visual");
  const [heroState, setHeroState] = useState({ assetId: null, url: null });
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
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [showOriginalRequestDetails, setShowOriginalRequestDetails] = useState(false);
  const [showUpdateWork, setShowUpdateWork] = useState(false);
  const [showContributionForm, setShowContributionForm] = useState(false);
  const [contributionTitle, setContributionTitle] = useState("");
  const [contributionType, setContributionType] = useState("service");
  const [contributionDate, setContributionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionNote, setContributionNote] = useState("");
  const [contributionProof, setContributionProof] = useState(null);
  const [savingContribution, setSavingContribution] = useState(false);
  const [showBoatEdit, setShowBoatEdit] = useState(false);
  const [boatEditDraft, setBoatEditDraft] = useState({});
  const [savingBoatEdit, setSavingBoatEdit] = useState(false);
  const [removingBoat, setRemovingBoat] = useState(false);
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
      let legacyProjection = null;
      let legacyPortal = null;
      let legacyMessages = [];
      let canonical = null;
      let directSystems = [];
      let directActions = [];
      let playbookRows = [];
      let directAssetHero = null;
      let directRelationship = null;
      let legacyError = null;
      let canonicalError = null;

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
        legacyProjection = data || null;
      } catch (err) {
        legacyError = err;
      }

      const resolvedAssetId = legacyProjection?.asset?.id || assetId || null;
      const resolvedKac = legacyProjection?.asset?.kac_id || kac || null;
      const resolvedOrgId = legacyProjection?.organization?.id || organizationId || null;

      if (resolvedAssetId) {
        try {
          const { data: canonicalData, error: resolverError } = await supabase.rpc(
            "resolve_asset_relationship_workspace",
            {
              p_asset_id: resolvedAssetId,
              p_organization_id: resolvedOrgId,
              p_relationship_id: null,
              p_action_id: null,
            }
          );
          if (resolverError) throw resolverError;
          canonical = canonicalData || null;
        } catch (err) {
          canonicalError = err;
          console.warn("Canonical relationship resolver unavailable, using compatibility RPCs:", err?.message || err);
        }
      }

      if (!legacyProjection && !canonical) {
        setProjection(null);
        setError(
          canonicalError?.message ||
            legacyError?.message ||
            "This asset is not available in the active KeeprPro context."
        );
        return;
      }

      if ((resolvedAssetId || resolvedKac) && resolvedOrgId) {
        try {
          const { data: messageRows, error: messageError } = await supabase.rpc(
            "get_keeprpro_stewardship_messages",
            {
              p_asset_id: legacyProjection?.asset?.id || resolvedAssetId,
              p_kac: legacyProjection?.asset?.kac_id || resolvedKac,
              p_organization_id: legacyProjection?.organization?.id || resolvedOrgId,
            }
          );
          if (messageError) throw messageError;
          legacyMessages = messageRows || [];
        } catch (err) {
          console.warn("Could not load KeeprPro relationship messages:", err?.message || err);
        }

        try {
          const { data: portalData, error: portalError } = await supabase.rpc(
            "get_keeprpro_relationship_portal",
            {
              p_asset_id: legacyProjection?.asset?.id || resolvedAssetId,
              p_kac: legacyProjection?.asset?.kac_id || resolvedKac,
              p_organization_id: legacyProjection?.organization?.id || resolvedOrgId,
            }
          );
          if (portalError) throw portalError;
          legacyPortal = portalData || null;
        } catch (err) {
          console.warn("Could not load KeeprPro relationship portal:", err?.message || err);
        }
      }

      if (resolvedAssetId) {
        const [assetResult, relationshipResult, systemsResult, actionsResult] = await Promise.all([
          supabase
            .from("assets")
            .select(
              "id,name,type,kac_id,year,make,model,serial_number,location,length_feet,engine_type,engine_hours,hull_material,registration_number,notes,asset_mode,extra_metadata,hero_placement_id,hero_image_url,hero_thumb_url"
            )
            .eq("id", resolvedAssetId)
            .maybeSingle(),
          resolvedOrgId
            ? supabase
                .from("asset_relationships")
                .select("id,relationship_type,status,access_scope,claim_state,metadata")
                .eq("asset_id", resolvedAssetId)
                .eq("organization_id", resolvedOrgId)
                .eq("status", "active")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase
            .from("systems")
            .select("*")
            .eq("asset_id", resolvedAssetId)
            .order("name", { ascending: true }),
          supabase
            .from("reminders")
            .select("*")
            .eq("asset_id", resolvedAssetId)
            .or("status.is.null,status.not.in.(completed,deleted,archived)")
            .order("due_at", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false }),
        ]);

        if (assetResult.error) {
          console.warn("Could not load asset hero continuity:", assetResult.error.message);
        } else {
          directAssetHero = assetResult.data || null;
        }

        if (relationshipResult.error) {
          console.warn("Could not load asset relationship continuity:", relationshipResult.error.message);
        } else {
          directRelationship = relationshipResult.data || null;
        }

        if (systemsResult.error) {
          console.warn("Could not load asset systems continuity:", systemsResult.error.message);
        } else {
          directSystems = systemsResult.data || [];
        }

        if (actionsResult.error) {
          console.warn("Could not load asset action continuity:", actionsResult.error.message);
        } else {
          directActions = actionsResult.data || [];
        }
      }

      const fallbackAsset = {
        ...(legacyProjection?.asset || {}),
        ...(canonical?.asset || {}),
        ...(directAssetHero || {}),
        id: directAssetHero?.id || canonical?.asset?.id || legacyProjection?.asset?.id || resolvedAssetId,
        kac_id: directAssetHero?.kac_id || canonical?.asset?.kac_id || legacyProjection?.asset?.kac_id || resolvedKac,
        name: directAssetHero?.name || canonical?.asset?.name || legacyProjection?.asset?.name || "Boat",
        owner_display_name:
          canonical?.owner?.display_name || legacyProjection?.asset?.owner_display_name || legacyPortal?.owner_display_name,
        owner_email: canonical?.owner?.email || legacyProjection?.asset?.owner_email,
        hero_placement_id:
          directAssetHero?.hero_placement_id ||
          canonical?.asset?.hero_placement_id ||
          legacyProjection?.asset?.hero_placement_id ||
          null,
        hero_image_url:
          directAssetHero?.hero_image_url ||
          directAssetHero?.hero_thumb_url ||
          canonical?.asset?.hero_image_url ||
          legacyProjection?.asset?.hero_image_url ||
          null,
        hero_thumb_url:
          directAssetHero?.hero_thumb_url ||
          canonical?.asset?.hero_thumb_url ||
          legacyProjection?.asset?.hero_thumb_url ||
          null,
        hin: directAssetHero?.serial_number || canonical?.asset?.hin || canonical?.asset?.serial_number || legacyProjection?.asset?.hin || null,
      };
      const relationshipSharedHistory =
        resolvedAssetId && resolvedOrgId
          ? await listRelationshipSharedHistory({
              assetId: resolvedAssetId,
              organizationId: resolvedOrgId,
              assetRelationshipId: canonical?.relationship?.id || null,
              stewardshipId: canonical?.relationship?.compatibility_stewardship_id || null,
            }).catch((err) => {
              console.warn("Relationship shared history unavailable:", err?.message || err);
              return null;
            })
          : null;

      if (resolvedAssetId && resolvedOrgId) {
        try {
          const playbookResult = await listKeeprSpacePlaybooks({
            organizationId: resolvedOrgId,
            assetId: resolvedAssetId,
            systemId: null,
          });
          playbookRows = Array.isArray(playbookResult?.playbooks)
            ? playbookResult.playbooks
            : [];
        } catch (err) {
          console.warn("KeeprSpace playbooks unavailable:", err?.message || err);
        }
      }

      const continuityProjection = {
        ...(legacyProjection || {}),
        asset: fallbackAsset,
        organization: legacyProjection?.organization ||
          (canonical?.relationship?.organization_id
            ? {
                id: canonical.relationship.organization_id,
                name: canonical.relationship.organization_name,
                slug: canonical.relationship.organization_slug,
              }
            : null),
        keepr_pro: legacyProjection?.keepr_pro ||
          (canonical?.relationship?.keepr_pro_id
            ? {
                id: canonical.relationship.keepr_pro_id,
                name: canonical.relationship.keepr_pro_name,
                slug: canonical.relationship.keepr_pro_slug,
              }
            : null),
        relationship:
          directRelationship?.id || legacyProjection?.relationship?.id || canonical?.relationship?.id
            ? {
                ...(legacyProjection?.relationship || {}),
                ...(directRelationship || {}),
                id:
                  directRelationship?.id ||
                  legacyProjection?.relationship?.id ||
                  canonical?.relationship?.id,
                relationship_type:
                  directRelationship?.relationship_type ||
                  legacyProjection?.relationship?.relationship_type ||
                  canonical?.relationship?.relationship_type,
                relationship_purpose:
                  legacyProjection?.relationship?.relationship_purpose ||
                  canonical?.relationship?.relationship_purpose,
                status:
                  directRelationship?.status ||
                  legacyProjection?.relationship?.status ||
                  canonical?.relationship?.status,
                access_scope:
                  directRelationship?.access_scope ||
                  legacyProjection?.relationship?.access_scope ||
                  canonical?.relationship?.access_scope,
                claim_state:
                  directRelationship?.claim_state ||
                  legacyProjection?.relationship?.claim_state ||
                  canonical?.relationship?.claim_state,
                metadata:
                  directRelationship?.metadata ||
                  legacyProjection?.relationship?.metadata ||
                  canonical?.relationship?.metadata ||
                  {},
                compatibility_stewardship_id:
                  legacyProjection?.relationship?.compatibility_stewardship_id ||
                  canonical?.relationship?.compatibility_stewardship_id,
              }
            : null,
        systems: legacyProjection?.systems?.length ? legacyProjection.systems : directSystems,
        service_records: Array.isArray(relationshipSharedHistory)
          ? relationshipSharedHistory
          : [],
        actions: legacyProjection?.actions?.length ? legacyProjection.actions : directActions,
      };
      const continuityPortal = legacyPortal
        ? {
            ...legacyPortal,
            current_action: legacyPortal.current_action || directActions[0] || null,
            shared_action_count:
              legacyPortal.shared_action_count ?? (directActions.length ? directActions.length : undefined),
          }
        : {
            current_action: directActions[0] || null,
            owner_display_name: canonical?.owner?.display_name || fallbackAsset.owner_display_name,
            relationship_title:
              canonical?.owner?.display_name && canonical?.relationship?.organization_name
                ? `${canonical.owner.display_name} ↔ ${canonical.relationship.organization_name}`
                : null,
            stewardship_id: canonical?.relationship?.compatibility_stewardship_id || null,
            shared_action_count: directActions.length,
          };

      const canonicalThread = normalizeCanonicalThread(canonical?.messages);
      const messageRows = canonicalThread ? [canonicalThread] : legacyMessages;
      const attachmentsByMessage = await loadAttachmentsForMessages(
        (messageRows || []).flatMap((thread) =>
        (thread.messages || []).map((message) => message.id).filter(Boolean)
        )
      );
      setProjection(normalizeCanonicalProjection(canonical, continuityProjection));
      setPortal(normalizeCanonicalPortal(canonical, continuityPortal));
      setRelationshipPlaybooks(playbookRows);
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
      setRelationshipPlaybooks([]);
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
    if (!projection?.relationship?.id && !projection?.asset?.id) return undefined;
    const interval = setInterval(() => {
      if (shouldSkipBackgroundRefresh()) return;
      load({ quiet: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [load, projection?.asset?.id, projection?.relationship?.id]);

  useEffect(() => {
    setActionNote(portal?.current_action?.provider_response?.note || "");
    setActionNextStep(portal?.current_action?.provider_response?.next_step || "");
    setActionStatus(portal?.current_action?.status || "open");
  }, [portal?.current_action?.id, portal?.current_action?.provider_response, portal?.current_action?.status]);

  const heroAsset = useMemo(() => {
    const asset = projection?.asset || {};
    const hero = projection?.hero_media || null;
    const relationshipHeroPlacementId =
      projection?.relationship?.metadata?.presentation?.hero_placement_id ||
      projection?.relationship?.metadata?.presentation?.heroPlacementId ||
      null;
    return {
      id: asset.id || assetId || null,
      relationship_hero_placement_id: relationshipHeroPlacementId,
      hero_placement_id: asset.hero_placement_id || null,
      hero_image_url: asset.hero_image_url || null,
      hero_thumb_url: asset.hero_thumb_url || null,
      hero_media_bucket: hero?.bucket || null,
      hero_media_path: hero?.storage_path || null,
    };
  }, [
    projection?.asset?.id,
    projection?.asset?.hero_placement_id,
    projection?.asset?.hero_image_url,
    projection?.asset?.hero_thumb_url,
    projection?.relationship?.metadata,
    projection?.hero_media?.bucket,
    projection?.hero_media?.storage_path,
    assetId,
  ]);

  const setHeroIfChanged = useCallback((assetIdForHero, url) => {
    if (!assetIdForHero || !url) return;
    setHeroState((prev) => {
      if (prev.assetId === assetIdForHero && prev.url === url) return prev;
      return { assetId: assetIdForHero, url };
    });
  }, []);

  const restoreHero = useCallback((isActive) => {
    const heroAssetId = heroAsset.id;

    if (!heroAssetId) {
      setHeroState((prev) => (prev.assetId ? { assetId: null, url: null } : prev));
      return;
    }

    const cached = getCachedAssetHeroUris([heroAssetId], BOAT_HERO_OPTIONS, { allowAnySize: true });
    if (cached[heroAssetId]) {
      setHeroIfChanged(heroAssetId, cached[heroAssetId]);
    }

    const signHero = async () => {
      const resolvedUrls = await fetchAssetHeroUris([heroAssetId], {
        ...BOAT_HERO_OPTIONS,
        organizationId: projection?.relationship?.organization_id || organizationId || null,
      });
      const assetHero =
        resolvedUrls[heroAssetId] ||
        (await resolveAssetHeroUri(
          {
            id: heroAssetId,
            relationship_hero_placement_id: heroAsset.relationship_hero_placement_id,
            hero_placement_id: heroAsset.hero_placement_id,
            hero_image_url: heroAsset.hero_image_url,
            hero_thumb_url: heroAsset.hero_thumb_url,
          },
          BOAT_HERO_OPTIONS
        ));
      if (assetHero) {
        if (isActive()) setHeroIfChanged(heroAssetId, assetHero);
        return;
      }

      if (!heroAsset.hero_media_bucket || !heroAsset.hero_media_path) {
        return;
      }

      try {
        const signed = await getSignedUrl({
          bucket: heroAsset.hero_media_bucket,
          path: heroAsset.hero_media_path,
          expiresIn: BOAT_HERO_OPTIONS.expiresIn,
          transform: BOAT_HERO_OPTIONS.transform,
        });
        if (isActive()) setHeroIfChanged(heroAssetId, signed);
      } catch (err) {
        const publicUrl = supabase.storage
          .from(heroAsset.hero_media_bucket)
          .getPublicUrl(heroAsset.hero_media_path)?.data?.publicUrl;
        if (isActive() && publicUrl) setHeroIfChanged(heroAssetId, publicUrl);
      }
    };

    signHero();
  }, [
    heroAsset,
    organizationId,
    projection?.relationship?.organization_id,
    setHeroIfChanged,
  ]);

  useEffect(() => {
    let active = true;
    restoreHero(() => active);
    return () => {
      active = false;
    };
  }, [restoreHero]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      restoreHero(() => active);
      return () => {
        active = false;
      };
    }, [restoreHero])
  );

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const asset = projection?.asset || {};
  useEffect(() => {
    if (!asset?.id) return;
    if (showBoatEdit) return;
    const metadata = asset.extra_metadata || {};
    const relationshipMetadata = projection?.relationship?.metadata || {};
    const inventory = relationshipMetadata.inventory || {};
    const customer = relationshipMetadata.customer || {};
    setBoatEditDraft({
      assetMode: metadata.asset_mode || asset.asset_mode || "commercial",
      commercialEntity: metadata.commercial_entity || "",
      name: asset.name || "",
      year: asset.year ? String(asset.year) : "",
      make: asset.make || "",
      model: asset.model || "",
      hin: asset.hin || asset.serial_number || "",
      location: asset.location || "",
      lengthFeet: metadata.length_feet || asset.length_feet ? String(metadata.length_feet || asset.length_feet) : "",
      engine: asset.engine_type || asset.engine || "",
      engineHours: metadata.engine_hours || asset.engine_hours ? String(metadata.engine_hours || asset.engine_hours) : "",
      hullMaterial: asset.hull_material || metadata.hull_material || "",
      registrationNumber: asset.registration_number || metadata.registration_number || "",
      newUsed: metadata.new_used || "",
      notes: asset.notes || metadata.notes || "",
      stockNumber: inventory.stock_number || "",
      listingUrl: inventory.listing_url || "",
      externalAssetId: inventory.external_asset_id || "",
      wilsonLocation: inventory.location || asset.location || "",
      customerExternalSystem: customer.external_system || "g2",
      customerExternalId: customer.external_customer_id || "",
      customerDisplayName: customer.display_name || "",
      customerEmail: customer.email || "",
      customerPhone: customer.phone || "",
      purchasePrice: metadata.purchase_price ? String(metadata.purchase_price) : "",
      estimatedValue: metadata.estimated_value ? String(metadata.estimated_value) : "",
      purchaseDate: metadata.purchase_date || "",
    });
  }, [
    asset?.id,
    asset?.name,
    asset?.year,
    asset?.make,
    asset?.model,
    asset?.hin,
    asset?.serial_number,
    asset?.location,
    asset?.length_feet,
    asset?.engine_type,
    asset?.engine_hours,
    asset?.hull_material,
    asset?.registration_number,
    asset?.notes,
    asset?.asset_mode,
    asset?.extra_metadata,
    projection?.relationship?.metadata,
    showBoatEdit,
  ]);

  const heroUrl = heroState.assetId === (asset.id || assetId || null) ? heroState.url : null;
  const systems = projection?.systems || [];
  const records = projection?.service_records || [];
  const actions = projection?.actions || [];
  const currentAction = portal?.current_action || null;
  const activeWorkTitle = currentAction?.title || "";
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
  const hasPersistedPlaybook = Boolean(playbook?.exists);
  const hasPersistedAppointment = Boolean(appointment?.scheduled);
  const visiblePlaybooks = visibleRelationshipPlaybooks(relationshipPlaybooks);
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

  const openPhotos = () => {
    if (!asset.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: asset.id,
      assetName: asset.name,
      assetType: "boat",
      organizationId: projection?.organization?.id || organizationId,
      stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
      parentRoute,
      workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
      returnRoute: "KeeprSpaceBoat",
      returnParams: {
        assetId: asset.id,
        kac: asset.kac_id || kac || null,
        organizationId: projection?.organization?.id || organizationId,
        stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
        parentRoute,
        workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
      },
    });
  };

  const saveBoatEdit = async () => {
    if (!asset.id || !organizationId) return;
    const patch = Object.entries(boatEditDraft || {}).reduce((acc, [key, value]) => {
      acc[BOAT_EDIT_PATCH_KEYS[key] || key] = typeof value === "string" ? value.trim() : value;
      return acc;
    }, {});
    setSavingBoatEdit(true);
    try {
      await updateKeeprSpaceBoatAsset({
        assetId: asset.id,
        organizationId,
        patch,
      });
      setShowBoatEdit(false);
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not save boat", err?.message || "Please try again.");
    } finally {
      setSavingBoatEdit(false);
    }
  };

  const removeBoat = () => {
    if (!asset.id || !organizationId) return;
    const doRemove = async () => {
      setRemovingBoat(true);
      try {
        await removeKeeprSpaceBoatAsset({ assetId: asset.id, organizationId });
        navigation.navigate(parentRoute, parentParams);
      } catch (err) {
        Alert.alert("Could not remove boat", err?.message || "Please try again.");
      } finally {
        setRemovingBoat(false);
      }
    };

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`Remove ${asset.name || "this boat"} from this KeeprSpace?`)) doRemove();
      return;
    }

    Alert.alert("Remove boat?", `Remove ${asset.name || "this boat"} from this KeeprSpace?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: doRemove },
    ]);
  };

  const openNewAction = () => {
    if (!asset.id) return;
    const orgId = projection?.organization?.id || organizationId || null;
    navigation.navigate(
      "CreateReminder",
      buildServiceActionRouteParams({
        assetId: asset.id,
        assetName: asset.name,
        assetType: "boat",
        sourceScreen: "keeprspace_boat",
        organizationId: orgId,
        afterSave: "KeeprSpaceBoat",
        afterSaveParams: {
          assetId: asset.id,
          kac: asset.kac_id || kac || null,
          organizationId: orgId,
          stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
          parentRoute,
          workspaceId: route?.params?.workspaceId || (orgId ? `org:${orgId}` : null),
        },
      })
    );
  };

  const openPlaybooks = () => {
    if (!asset.id) return;
    const orgId = projection?.organization?.id || organizationId || null;
    navigation.navigate("KeeprSpacePlaybooks", {
      assetId: asset.id,
      assetName: asset.name,
      kac: asset.kac_id || kac || null,
      organizationId: orgId,
      stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
      workspaceId: route?.params?.workspaceId || (orgId ? `org:${orgId}` : null),
    });
  };

  const conciseActionDescription = (() => {
    if (!currentAction?.id) return "";
    const explicit = currentAction?.provider_response?.note || currentAction?.provider_response?.next_step;
    if (explicit) return explicit;
    return "";
  })();
  const latestActionActivity =
    currentAction?.updated_at || portal?.projection_thread?.updated_at || currentAction?.created_at || null;
  const currentStage = currentAction?.status ? String(currentAction.status).replace(/_/g, " ") : "";
  const waitingOn = currentAction?.id ? actionResponsibleName(currentAction) : "No one";
  const nextStepLabel = currentAction?.id ? whatNext?.title || "No next step has been set." : "No active work is waiting.";
  const targetDateLabel = currentAction ? getActionScheduleLabel(currentAction, formatDate) : "No target date set";
  const ownerName = portal?.owner_display_name || asset.owner_display_name || "Owner";
  const providerName = projection?.organization?.name || projection?.keepr_pro?.name || "KeeprPro";
  const relationshipTitle = `${ownerName} ↔ ${providerName}`;
  const relationshipRole =
    projection?.relationship?.relationship_purpose ||
    projection?.relationship?.relationship_type ||
    "service";
  const relationshipStatus = projection?.relationship?.status || "active";
  const relationshipRoleLabel = labelize(relationshipRole);
  const relationshipStatusLabel = labelize(relationshipStatus);
  const boatDescriptor = compact([asset.year, asset.make, asset.model]);
  const boatFacts = [
    asset.registration ? { label: "Registration", value: asset.registration } : null,
    asset.serial ? { label: "Serial", value: asset.serial } : null,
    asset.length_feet ? { label: "Length", value: `${asset.length_feet} ft` } : null,
    asset.engine_type ? { label: "Engine", value: asset.engine_type } : null,
    asset.hull_material ? { label: "Hull", value: asset.hull_material } : null,
  ].filter(Boolean);
  const providerAdvisor =
    currentAction?.provider_response?.advisor ||
    currentAction?.provider_response?.advisor_name ||
    currentAction?.provider_response?.staff_name ||
    "No provider advisor assigned";
  const ownerPhone = asset.owner_phone || asset.owner_contact?.phone || null;
  const ownerEmail = asset.owner_email || asset.owner_contact?.email || null;
  const providerPhone = projection?.keepr_pro?.phone || projection?.organization?.phone || null;
  const providerWebsite = projection?.keepr_pro?.website || projection?.organization?.website || null;
  const relatedSystems = systems.map((system) => {
    const systemRecords = records.filter((record) =>
      String(record.system_id || record.system?.id || "") === String(system.id)
    );
    const systemActions = sharedActions.filter((action) =>
      String(action.system_id || action.system?.id || "") === String(system.id) ||
      String(action.system_name || action.system?.name || "").toLowerCase() ===
        String(system.name || "").toLowerCase()
    );
    return {
      ...system,
      recordCount: systemRecords.length,
      actionCount: systemActions.length,
    };
  });
  const visibleRelatedSystems = relatedSystems;

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

  const resolveClaimedProviderSlug = async () => {
    const directSlug =
      projection?.keepr_pro?.slug ||
      projection?.keepr_pro?.keepr_pro_slug ||
      projection?.keepr_pro?.profile_slug ||
      null;
    if (directSlug) return directSlug;

    const normalizeUuid = (value) => {
      const text = String(value || "").trim().replace(/^org:/i, "");
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : null;
    };
    const uniqueUuids = (values = []) => [...new Set(values.map(normalizeUuid).filter(Boolean))];
    const providerName = String(
      projection?.keepr_pro?.name ||
        projection?.organization?.name ||
        ""
    )
      .split(" · ")[0]
      .trim();
    const profileIds = uniqueUuids([
      projection?.keepr_pro?.id,
      projection?.relationship?.keepr_pro_id,
    ]);
    const orgIds = uniqueUuids([
      projection?.organization?.id,
      projection?.relationship?.organization_id,
      organizationId,
    ]);
    const pickClaimedSlug = (rows = []) =>
      (rows || []).find(
        (row) =>
          row?.slug &&
          row?.claimed_state === "claimed" &&
          ["published", "demo"].includes(row?.publish_status)
      )?.slug || null;

    try {
      if (profileIds.length) {
        const { data, error } = await supabase
          .from("keepr_pros")
          .select("slug,claimed_state,publish_status")
          .in("id", profileIds);
        if (error) throw error;
        const slug = pickClaimedSlug(data);
        if (slug) return slug;
      }

      if (orgIds.length) {
        const { data, error } = await supabase
          .from("keepr_pros")
          .select("slug,claimed_state,publish_status")
          .in("organization_id", orgIds);
        if (error) throw error;
        const slug = pickClaimedSlug(data);
        if (slug) return slug;
      }

      if (providerName) {
        const { data, error } = await supabase
          .from("keepr_pros")
          .select("slug,claimed_state,publish_status,name")
          .ilike("name", providerName)
          .limit(10);
        if (error) throw error;
        const slug = pickClaimedSlug(data);
        if (slug) return slug;
      }
    } catch (err) {
      console.log("Provider claimed profile lookup skipped:", err);
    }

    return null;
  };

  const openProviderProfile = async () => {
    const slug = await resolveClaimedProviderSlug();
    if (slug) {
      navigation.navigate("PublicKeeprProProfile", {
        slug,
        assetContext: {
          assetId: asset.id,
          assetName: asset.name,
          assetType: "boat",
          kac: asset.kac_id || kac || null,
          ownerName,
        },
      });
      return;
    }

    if (projection?.keepr_pro?.id) {
      navigation.navigate("KeeprProDetail", {
        pro: projection.keepr_pro,
        assetId: asset.id,
        assetName: asset.name,
        assetType: "boat",
        assignmentScope: "asset",
      });
    }
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
    navigation.navigate("KeeprSpaceMessages", {
      threadId,
      assetId: asset.id,
      kac: asset.kac_id || kac || null,
      stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
      organizationId: projection?.organization?.id || organizationId,
      workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
    });
  };

  const sendReply = async ({ body = replyDraft, attachments = [] } = {}) => {
    const threadId = portal?.projection_thread?.id || messages?.[0]?.id || null;
    if (!threadId) {
      Alert.alert("No thread", "No relationship thread was returned by the projection.");
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
      setReplyAttachments([]);
      load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not reply", err?.message || "Please try again.");
    } finally {
      setSavingReply(false);
    }
  };

  const pickReplyAttachment = async (kind = "file") => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: kind === "photo" ? "image/*" : "*/*",
      });
      if (result.canceled) return;
      const picked = result.assets?.[0];
      if (!picked?.uri) return;
      setReplyAttachments((prev) => [
        ...prev,
        {
          uri: picked.uri,
          fileName: picked.name || picked.fileName || picked.uri.split("/").pop() || "attachment",
          mimeType: picked.mimeType || null,
          size: picked.size || null,
          kind,
        },
      ]);
    } catch (error) {
      Alert.alert("Could not add attachment", error?.message || "Please try again.");
    }
  };

  const renderPlaybookSummary = () => {
    if (!visiblePlaybooks.length) return null;

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleBlock}>
        <Text style={styles.cardTitle}>Playbook loop</Text>
        <Text style={styles.sectionHint}>Recurring relationship plans for this boat. Playbooks organize; Actions execute.</Text>
          </View>
          <TouchableOpacity style={styles.inlineButton} onPress={openPlaybooks} activeOpacity={0.86}>
            <Ionicons name="reader-outline" size={16} color={colors.primary} />
            <Text style={styles.inlineButtonText}>Open Playbook</Text>
          </TouchableOpacity>
        </View>
        {visiblePlaybooks.map((item) => {
          const steps = Array.isArray(item.steps) ? item.steps : [];
          const nextStep =
            steps.find((step) => !["complete", "completed", "done", "skipped"].includes(String(step?.status || "").toLowerCase())) ||
            steps[0] ||
            null;
          return (
            <View key={item.id || item.name} style={styles.playbookBlock}>
              <View style={styles.playbookHeader}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.name || "Untitled Playbook"}</Text>
                  <Text style={styles.rowMeta}>
                    {compact([
                      playbookDisplayStatus(item),
                      playbookProgressSummary(item),
                      nextStep?.title ? `Next: ${nextStep.title}` : null,
                    ])}
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{playbookDisplayStatus(item)}</Text>
                </View>
              </View>
              <View style={styles.playbookStepList}>
                {steps.slice(0, 6).map((step, index) => (
                  <View key={step.id || `${item.id}-${index}`} style={styles.playbookStepRow}>
                    <View style={styles.playbookStepIndex}>
                      <Text style={styles.playbookStepIndexText}>{step.position || index + 1}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{step.title || "Untitled step"}</Text>
                      <Text style={styles.rowMeta}>
                        {compact([
                          playbookStepKindLabel(step),
                          step.responsible_party ? String(step.responsible_party).replace(/_/g, " ") : null,
                          playbookStepScheduleLabel(step),
                        ])}
                      </Text>
                    </View>
                    <Text style={styles.playbookStepStatus}>{playbookStepExecutionLabel(step)}</Text>
                  </View>
                ))}
                {steps.length > 6 ? (
                  <Text style={styles.sectionHint}>+ {steps.length - 6} more steps in the Playbook.</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderConversationSummary = () => {
    if (!messages.length) return null;

    return (
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleBlock}>
            <Text style={styles.cardTitle}>Conversation</Text>
            <Text style={styles.sectionHint}>Latest relationship messages. Open Messages for the full thread.</Text>
          </View>
          <Text style={styles.count}>{messages.length}</Text>
        </View>
        {messages.map((thread) => {
          const latestMessages = (thread.messages || []).slice(-2);
          return (
            <View key={thread.id} style={styles.conversationSummary}>
              <View style={styles.conversationSummaryHeader}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#2563EB" />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{thread.subject || `${asset.name || "Boat"} conversation`}</Text>
                  <Text style={styles.rowMeta}>
                    {compact([relationshipRole, relationshipStatus, `${latestMessages.length || 0} recent message${latestMessages.length === 1 ? "" : "s"}`])}
                  </Text>
                </View>
              </View>
              <View style={styles.conversationPreviewList}>
                {latestMessages.length ? (
                  latestMessages.map((message) => {
                    const mine = message.sender_type === "keepr_pro";
                    return (
                      <View
                        key={message.id || `${thread.id}-${message.created_at}-${message.body}`}
                        style={[styles.conversationPreviewBubble, mine && styles.conversationPreviewBubbleMine]}
                      >
                        <Text style={[styles.conversationPreviewMeta, mine && styles.conversationPreviewMetaMine]}>
                          {messageSenderLabel(message, ownerName, providerName)}
                          {message.created_at ? ` · ${compactMessageTime(message.created_at)}` : ""}
                        </Text>
                        <Text
                          style={[styles.conversationPreviewText, mine && styles.conversationPreviewTextMine]}
                          numberOfLines={2}
                        >
                          {message.body || "Attachment shared"}
                        </Text>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.emptyStateText}>No messages yet.</Text>
                )}
              </View>
              <View style={styles.compactReplyBox}>
                {replyAttachments.length ? (
                  <View style={styles.pendingReplyStrip}>
                    {replyAttachments.map((attachment, index) => (
                      <View key={`${attachment.uri}-${index}`} style={styles.pendingReplyChip}>
                        <Ionicons
                          name={attachment.kind === "photo" ? "image-outline" : "document-attach-outline"}
                          size={16}
                          color={colors.brandBlue}
                        />
                        <Text style={styles.pendingReplyText} numberOfLines={1}>
                          {attachment.fileName || "Attachment"}
                        </Text>
                        <TouchableOpacity
                          onPress={() =>
                            setReplyAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                          }
                        >
                          <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}
                <TextInput
                  value={replyDraft}
                  onChangeText={setReplyDraft}
                  placeholder={`Reply as ${providerName || "Service Team"}...`}
                  multiline
                  style={[styles.input, styles.compactReplyInput]}
                />
                <View style={styles.operationActions}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => pickReplyAttachment("photo")} activeOpacity={0.86}>
                    <Ionicons name="image-outline" size={15} color={colors.textPrimary} />
                    <Text style={styles.secondaryButtonText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => pickReplyAttachment("file")} activeOpacity={0.86}>
                    <Ionicons name="document-attach-outline" size={15} color={colors.textPrimary} />
                    <Text style={styles.secondaryButtonText}>File</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, savingReply && styles.disabled]}
                    onPress={() => sendReply({ body: replyDraft, attachments: replyAttachments })}
                    disabled={savingReply || (!replyDraft.trim() && !replyAttachments.length)}
                    activeOpacity={0.86}
                  >
                    {savingReply ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send-outline" size={15} color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>Reply</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={openMessages} activeOpacity={0.86}>
                    <Ionicons name="open-outline" size={15} color={colors.textPrimary} />
                    <Text style={styles.secondaryButtonText}>Open conversation</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    );
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
      `Complete this shared Action and add the resulting service record to ${asset.name || "this boat"} history?`,
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

  const submitContribution = async () => {
    if (!asset.id || !organizationId) return;
    if (!String(contributionTitle || "").trim()) {
      Alert.alert("Title required", `Add a title for the record ${providerName || "this workspace"} is contributing.`);
      return;
    }
    setSavingContribution(true);
    try {
      await createRelationshipRecordContribution({
        assetId: asset.id,
        organizationId: projection?.organization?.id || organizationId,
        assetRelationshipId: projection?.relationship?.id || null,
        stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
        title: contributionTitle,
        recordType: contributionType,
        performedAt: contributionDate || null,
        amount: contributionAmount || null,
        note: contributionNote || null,
        metadata: {
          source_screen: "KeeprProStewardshipView",
          provider_name: providerName,
          attachment_ids: contributionProof?.attachmentId ? [contributionProof.attachmentId] : [],
        },
      });
      setContributionTitle("");
      setContributionType("service");
      setContributionDate(new Date().toISOString().slice(0, 10));
      setContributionAmount("");
      setContributionNote("");
      setContributionProof(null);
      setShowContributionForm(false);
      Alert.alert("Sent to owner Inbox", `${ownerName || "The owner"} can review and accept this record into the asset history.`);
    } catch (err) {
      Alert.alert("Could not send contribution", err?.message || "Please try again.");
    } finally {
      setSavingContribution(false);
    }
  };

  const addContributionProof = async () => {
    if (!asset.id) return;
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

      const attachment = await uploadAttachmentFromUri({
        userId,
        assetId: asset.id,
        kind: "file",
        fileUri: picked.uri,
        fileName: picked.name || picked.fileName || "Contribution proof",
        mimeType: picked.mimeType || null,
        sizeBytes: picked.size || null,
        title: picked.name || picked.fileName || "Contribution proof",
        sourceContext: {
          screen: "KeeprProStewardshipView",
          source_type: "relationship_record_contribution_pending",
          asset_id: asset.id,
          organization_id: projection?.organization?.id || organizationId,
        },
        placements: [
          {
            target_type: "asset",
            target_id: asset.id,
            role: "relationship_contribution_proof",
            label: projection?.relationship?.id || portal?.stewardship_id || null,
          },
        ],
      });

      setContributionProof({
        attachmentId: attachment?.id || attachment?.attachment_id || null,
        title: picked.name || picked.fileName || "Contribution proof",
      });
    } catch (err) {
      Alert.alert("Could not add proof", err?.message || "Please try again.");
    }
  };

  const openRecord = (record) => {
    if (!record?.id) return;
    navigation.navigate("TimelineRecord", {
      sourceType: "service_record",
      serviceRecordId: record.id,
      serviceRecordSnapshot: record,
      assetId: asset.id || assetId || null,
      organizationId: projection?.organization?.id || organizationId || null,
      assetRelationshipId: projection?.relationship?.id || null,
      stewardshipId: portal?.stewardship_id || projection?.stewardship?.id || null,
      origin: {
        name: parentRoute === "KeeprSpaceFleet" ? "KeeprSpaceBoat" : "ActivatorBoat",
        params: route?.params || {},
      },
    });
  };

  const openSharedFile = async (file) => {
    if (!file) return;
    const attachmentId = file.attachment_id || file.attachmentId || file.id || null;
    let attachmentRow = null;

    if (attachmentId) {
      try {
        const { data, error } = await supabase
          .from("attachments")
          .select("id, kind, title, notes, url, file_name, mime_type, bucket, storage_path, created_at, size_bytes, ai_metadata")
          .eq("id", attachmentId)
          .maybeSingle();
        if (!error && data) attachmentRow = data;
      } catch (error) {
        console.warn("Relationship attachment hydration failed:", error?.message || error);
      }
    }

    const fileName =
      file.fileName ||
      file.file_name ||
      attachmentRow?.file_name ||
      attachmentRow?.title ||
      file.title ||
      "Attachment";
    const mimeType =
      file.mimeType ||
      file.mime_type ||
      attachmentRow?.mime_type ||
      attachmentRow?.contentType ||
      null;
    const bucket =
      file.bucket ||
      file.storage_bucket ||
      file.storage?.bucket ||
      attachmentRow?.bucket ||
      attachmentRow?.storage_bucket ||
      "asset-files";
    const storagePath =
      file.storage_path ||
      file.storagePath ||
      file.storage?.path ||
      attachmentRow?.storage_path ||
      attachmentRow?.storagePath ||
      attachmentRow?.storage?.path ||
      null;
    let url =
      file.url ||
      file.signedUrl ||
      file.signed_url ||
      file.publicUrl ||
      file.public_url ||
      attachmentRow?.url ||
      attachmentRow?.signedUrl ||
      attachmentRow?.signed_url ||
      attachmentRow?.publicUrl ||
      attachmentRow?.public_url ||
      null;

    if (!url && bucket && storagePath) {
      try {
        url = await getSignedUrl({
          bucket,
          path: storagePath,
          expiresIn: 3600,
          transform: String(mimeType || "").toLowerCase().startsWith("image/")
            ? { width: 1800, quality: 88 }
            : null,
        });
      } catch {
        try {
          url = await getSignedUrl({
            bucket,
            path: storagePath,
            expiresIn: 3600,
          });
        } catch (error) {
          console.warn("Relationship attachment URL unavailable:", error?.message || error);
        }
      }
    }

    setViewerAttachment({
      ...(attachmentRow || {}),
      ...file,
      id: attachmentId || attachmentRow?.id || file.id,
      attachment_id: attachmentId || attachmentRow?.id || file.attachment_id || null,
      url,
      fileName,
      file_name: fileName,
      mimeType,
      mime_type: mimeType,
      bucket,
      storage_path: storagePath,
      storage: {
        ...(attachmentRow?.storage || {}),
        ...(file.storage || {}),
        bucket,
        path: storagePath,
      },
      asset_name: asset?.name || assetName,
    });
  };

  const renderContributionCard = () => (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBlock}>
          <Text style={styles.cardTitle}>Contribute a record</Text>
          <Text style={styles.sectionHint}>Send a provider-authored record to the owner's Inbox for review.</Text>
        </View>
        <TouchableOpacity
          style={styles.inlineButton}
          onPress={() => setShowContributionForm((value) => !value)}
          activeOpacity={0.86}
        >
          <Ionicons name={showContributionForm ? "chevron-up" : "add-outline"} size={16} color={colors.primary} />
          <Text style={styles.inlineButtonText}>{showContributionForm ? "Close" : "New record"}</Text>
        </TouchableOpacity>
      </View>
      {showContributionForm ? (
        <View style={styles.operationPanel}>
          <Text style={styles.inputLabel}>Title</Text>
          <TextInput
            value={contributionTitle}
            onChangeText={setContributionTitle}
            placeholder="Invoice, work order, inspection, service note..."
            style={styles.input}
          />
          <View style={styles.detailGrid}>
            <View style={styles.detailItemPlain}>
              <Text style={styles.inputLabel}>Type</Text>
              <TextInput
                value={contributionType}
                onChangeText={setContributionType}
                placeholder="service"
                style={styles.input}
              />
            </View>
            <View style={styles.detailItemPlain}>
              <Text style={styles.inputLabel}>Date</Text>
              <TextInput
                value={contributionDate}
                onChangeText={setContributionDate}
                placeholder="YYYY-MM-DD"
                style={styles.input}
              />
            </View>
            <View style={styles.detailItemPlain}>
              <Text style={styles.inputLabel}>Amount</Text>
              <TextInput
                value={contributionAmount}
                onChangeText={setContributionAmount}
                placeholder="Optional"
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
          </View>
          <Text style={styles.inputLabel}>Note</Text>
          <TextInput
            value={contributionNote}
            onChangeText={setContributionNote}
            placeholder={`What should ${ownerName || "the owner"} review?`}
            multiline
            style={[styles.input, styles.textArea]}
          />
          <TouchableOpacity
            style={styles.inlineButton}
            onPress={addContributionProof}
            activeOpacity={0.86}
          >
            <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
            <Text style={styles.inlineButtonText}>
              {contributionProof?.title ? `Proof: ${contributionProof.title}` : "Add proof"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, savingContribution && styles.disabled]}
            onPress={submitContribution}
            disabled={savingContribution}
            activeOpacity={0.86}
          >
            {savingContribution ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={styles.primaryButtonText}>Send to owner Inbox</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

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
            <ActivatorBreadcrumb
              navigation={navigation}
              homeRoute={breadcrumbHomeRoute}
              current={asset.name || asset.kac_id || "Service Relationship"}
              homeParams={breadcrumbHomeParams}
              items={[
                {
                  label: parentCrumbLabel,
                  route: parentRoute,
                  params: parentParams,
                },
              ]}
              right={(
                <View style={styles.breadcrumbWorkspace}>
                  <Ionicons name="briefcase-outline" size={14} color={colors.brandNavy} />
                  <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{providerName}</Text>
                  <Text style={styles.breadcrumbSwitchText}>Service</Text>
                </View>
              )}
            />
            <View style={styles.header}>
              <Text style={styles.eyebrow}>KeeprSpace</Text>
              <Text style={styles.title}>{relationshipTitle}</Text>
              <Text style={styles.subtitle}>
                {asset.name} · Active Keeprship with {providerName}
              </Text>
              <View style={styles.boatCrudRow}>
                <TouchableOpacity style={styles.boatCrudButton} onPress={() => setShowBoatEdit((value) => !value)} activeOpacity={0.86}>
                  <Ionicons name="create-outline" size={16} color={colors.brandBlue} />
                  <Text style={styles.boatCrudButtonText}>{showBoatEdit ? "Close edit" : "Edit boat"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.boatCrudButton} onPress={openPhotos} activeOpacity={0.86}>
                  <Ionicons name="images-outline" size={16} color={colors.brandBlue} />
                  <Text style={styles.boatCrudButtonText}>Photos</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.boatCrudButton, styles.boatCrudDanger]} onPress={removeBoat} disabled={removingBoat} activeOpacity={0.86}>
                  {removingBoat ? <ActivityIndicator size="small" color={colors.danger} /> : <Ionicons name="trash-outline" size={16} color={colors.danger} />}
                  <Text style={[styles.boatCrudButtonText, styles.boatCrudDangerText]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showBoatEdit ? (
              <View style={styles.boatEditPanel}>
                <View style={styles.boatEditHeader}>
                  <View style={styles.boatEditHeaderCopy}>
                    <Text style={styles.boatEditSectionTitle}>Edit boat details</Text>
                    <Text style={styles.boatEditHelper}>Update the shared boat profile, then save or cancel from either end of the form.</Text>
                  </View>
                  <View style={styles.boatEditTopActions}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowBoatEdit(false)} activeOpacity={0.86}>
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.primaryButton, savingBoatEdit && styles.disabled]} onPress={saveBoatEdit} disabled={savingBoatEdit} activeOpacity={0.86}>
                      {savingBoatEdit ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="save-outline" size={16} color="#FFFFFF" />}
                      <Text style={styles.primaryButtonText}>Save boat</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.boatEditSection}>
                  <Text style={styles.boatEditSectionTitle}>Basics</Text>
                  <View style={styles.boatEditModeRow}>
                    {[
                      ["personal", "Personal"],
                      ["commercial", "Commercial"],
                    ].map(([mode, label]) => (
                      <TouchableOpacity
                        key={mode}
                        style={[
                          styles.boatEditModeButton,
                          boatEditDraft.assetMode === mode && styles.boatEditModeButtonActive,
                        ]}
                        activeOpacity={0.86}
                        onPress={() => setBoatEditDraft((current) => ({ ...current, assetMode: mode }))}
                      >
                        <Text
                          style={[
                            styles.boatEditModeText,
                            boatEditDraft.assetMode === mode && styles.boatEditModeTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {boatEditDraft.assetMode === "commercial" ? (
                    <View style={styles.boatEditGrid}>
                      <View style={styles.boatEditFieldWide}>
                        <Text style={styles.detailLabel}>Commercial entity</Text>
                        <TextInput
                          value={boatEditDraft.commercialEntity || ""}
                          onChangeText={(value) => setBoatEditDraft((current) => ({ ...current, commercialEntity: value }))}
                          style={styles.boatEditInput}
                          placeholder={providerName}
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
                {boatEditSections(providerName).map((section) => (
                  <View key={section.title} style={styles.boatEditSection}>
                    <Text style={styles.boatEditSectionTitle}>{section.title}</Text>
                    <View style={styles.boatEditGrid}>
                      {section.fields.map(([key, label, placeholder, keyboardType]) => (
                        <View key={key} style={key === "notes" ? styles.boatEditFieldWide : styles.boatEditField}>
                          <Text style={styles.detailLabel}>{label}</Text>
                          <TextInput
                            value={boatEditDraft[key] || ""}
                            onChangeText={(value) => setBoatEditDraft((current) => ({ ...current, [key]: value }))}
                            style={styles.boatEditInput}
                            multiline={key === "notes"}
                            placeholder={placeholder || label}
                            placeholderTextColor={colors.textMuted}
                            keyboardType={keyboardType || "default"}
                            autoCapitalize={key === "customerEmail" || key === "listingUrl" ? "none" : "sentences"}
                          />
                        </View>
                      ))}
                    </View>
                    {section.title === "Boat details" ? (
                      <View style={styles.boatEditFieldWide}>
                        <Text style={styles.detailLabel}>Notes</Text>
                        <TextInput
                          value={boatEditDraft.notes || ""}
                          onChangeText={(value) => setBoatEditDraft((current) => ({ ...current, notes: value }))}
                          style={[styles.boatEditInput, styles.boatEditMultiline]}
                          multiline
                          placeholder="Trips, storage notes, marina details..."
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
                <View style={styles.boatEditActions}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowBoatEdit(false)} activeOpacity={0.86}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.primaryButton, savingBoatEdit && styles.disabled]} onPress={saveBoatEdit} disabled={savingBoatEdit} activeOpacity={0.86}>
                    {savingBoatEdit ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="save-outline" size={16} color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>Save boat</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

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
                <View style={styles.assetRelationshipHeader}>
                  <View style={styles.visualHero}>
                    {heroUrl ? (
                      <ImageBackground
                        source={{ uri: heroUrl }}
                        style={styles.heroImage}
                        imageStyle={styles.heroImageAsset}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.heroFallbackContent}>
                        <Ionicons name="boat-outline" size={40} color="#2563EB" />
                        <Text style={styles.heroFallbackTitle}>{asset.name || "Boat"}</Text>
                        <Text style={styles.heroFallbackMeta}>Keeprship photo will appear here when shared</Text>
                      </View>
                    )}
                    <View style={styles.heroOverlay}>
                      <Text style={styles.heroContext}>Active Keeprship</Text>
                      <Text style={styles.heroTitle}>{asset.name}</Text>
                      <Text style={styles.heroMeta}>{boatDescriptor}</Text>
                    </View>
                  </View>

                  <View style={styles.relationshipSummaryCard}>
                    <Text style={styles.cardLabel}>Keeprship</Text>
                    <Text style={styles.cardTitle}>{relationshipTitle}</Text>
                    <Text style={styles.sectionHint}>
                      One shared relationship: work, messages, files, history, and playbooks stay attached to this boat.
                    </Text>
                    <View style={styles.relationshipContextGrid}>
                      <View style={styles.relationshipContextItem}>
                        <Text style={styles.detailLabel}>Owner</Text>
                        <Text style={styles.detailValue}>{ownerName}</Text>
                      </View>
                      <View style={styles.relationshipContextItem}>
                        <Text style={styles.detailLabel}>Provider role</Text>
                        <Text style={styles.detailValue}>{relationshipRoleLabel}</Text>
                      </View>
                      <View style={styles.relationshipContextItem}>
                        <Text style={styles.detailLabel}>Status</Text>
                        <Text style={styles.detailValue}>{relationshipStatusLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.boatSpecGridCompact}>
                      {boatFacts.map((fact) => (
                        <View key={fact.label} style={styles.boatSpecChipCompact}>
                          <Text style={styles.detailLabel}>{fact.label}</Text>
                          <Text style={styles.detailValue}>{fact.value}</Text>
                        </View>
                      ))}
                      <View style={styles.boatSpecChipCompact}>
                        <Text style={styles.detailLabel}>Systems</Text>
                        <Text style={styles.detailValue}>{systems.length}</Text>
                      </View>
                      <View style={styles.boatSpecChipCompact}>
                        <Text style={styles.detailLabel}>History</Text>
                        <Text style={styles.detailValue}>{records.length}</Text>
                      </View>
                      <View style={styles.boatSpecChipCompact}>
                        <Text style={styles.detailLabel}>Open work</Text>
                        <Text style={styles.detailValue}>{sharedActions.length}</Text>
                      </View>
                      <View style={styles.boatSpecChipCompact}>
                        <Text style={styles.detailLabel}>Messages</Text>
                        <Text style={styles.detailValue}>{messages.length}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {currentActionOpen ? (
                  <View style={styles.whatNextCard}>
                    <View style={styles.whatNextHeader}>
                      <View style={styles.sectionTitleBlock}>
                        <Text style={styles.cardLabel}>Now</Text>
                        <Text style={styles.whatNextTitle}>{activeWorkTitle}</Text>
                        <Text style={styles.whatNextBody}>{conciseActionDescription}</Text>
                      </View>
                      <View style={styles.workActions}>
                        <TouchableOpacity style={styles.secondaryButton} onPress={openPlaybooks} activeOpacity={0.86}>
                          <Ionicons name="reader-outline" size={16} color={colors.textPrimary} />
                          <Text style={styles.secondaryButtonText}>Playbooks</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryButton} onPress={openNewAction} activeOpacity={0.86}>
                          <Ionicons name="add-circle-outline" size={16} color={colors.textPrimary} />
                          <Text style={styles.secondaryButtonText}>New Action</Text>
                        </TouchableOpacity>
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
                      {currentAction ? (
                        <View style={styles.summaryItem}>
                          <Text style={styles.detailLabel}>Target date</Text>
                          <Text style={styles.detailValue}>{targetDateLabel}</Text>
                        </View>
                      ) : null}
                      {latestActionActivity ? (
                        <View style={styles.summaryItem}>
                          <Text style={styles.detailLabel}>Last activity</Text>
                          <Text style={styles.detailValue}>{formatDate(latestActionActivity)}</Text>
                        </View>
                      ) : null}
                      {providerAdvisor ? (
                        <View style={styles.summaryItem}>
                          <Text style={styles.detailLabel}>Advisor</Text>
                          <Text style={styles.detailValue}>{providerAdvisor}</Text>
                        </View>
                      ) : null}
                      {currentAction?.system_name || currentAction?.system?.name ? (
                        <View style={styles.summaryItem}>
                          <Text style={styles.detailLabel}>Linked system</Text>
                          <Text style={styles.detailValue}>
                            {currentAction?.system_name || currentAction?.system?.name}
                          </Text>
                        </View>
                      ) : null}
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
                          placeholder={`Add a timestamped ${providerName || "service"} update...`}
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
                ) : null}

                {renderPlaybookSummary()}

                <View style={styles.visualGrid}>
                  <View style={styles.visualPanel}>
                    <Text style={styles.cardLabel}>{ownerName}</Text>
                    <Text style={styles.visualValue}>Owner</Text>
                    {currentActionOpen && waitingOn === ownerName ? (
                      <Text style={styles.visualMuted}>Current responsibility: {nextStepLabel}</Text>
                    ) : null}
                    <View style={styles.contactRow}>
                      {ownerPhone ? (
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByPhone(ownerPhone)}>
                        <Ionicons name="call-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Call</Text>
                      </TouchableOpacity>
                      ) : null}
                      {ownerEmail ? (
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByEmail(ownerEmail)}>
                        <Ionicons name="mail-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Email</Text>
                      </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity style={styles.inlineButton} onPress={openMessages}>
                        <Ionicons name="chatbubble-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Message</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.visualPanel}>
                    <TouchableOpacity onPress={openProviderProfile} activeOpacity={0.85}>
                      <Text style={[styles.cardLabel, styles.linkLabel]}>{providerName}</Text>
                    </TouchableOpacity>
                    <Text style={styles.visualValue}>{relationshipRoleLabel}</Text>
                    {currentActionOpen && providerAdvisor ? (
                      <Text style={styles.visualMuted}>Assigned staff: {providerAdvisor}</Text>
                    ) : null}
                    <View style={styles.contactRow}>
                      <TouchableOpacity style={styles.inlineButton} onPress={openProviderProfile}>
                        <Ionicons name="business-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Profile</Text>
                      </TouchableOpacity>
                      {providerPhone ? (
                      <TouchableOpacity style={styles.inlineButton} onPress={() => contactByPhone(providerPhone)}>
                        <Ionicons name="call-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Call</Text>
                      </TouchableOpacity>
                      ) : null}
                      {providerWebsite ? (
                      <TouchableOpacity style={styles.inlineButton} onPress={openProviderWebsite}>
                        <Ionicons name="globe-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Website</Text>
                      </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity style={styles.inlineButton} onPress={openMessages}>
                        <Ionicons name="chatbubble-outline" size={15} color={colors.primary} />
                        <Text style={styles.inlineButtonText}>Message</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {renderConversationSummary()}

                {hasPersistedPlaybook || hasPersistedAppointment ? (
                  <View style={styles.visualGrid}>
                    {hasPersistedPlaybook ? (
                      <View style={styles.visualPanel}>
                        <Text style={styles.cardLabel}>Playbook / cycle</Text>
                        <Text style={styles.visualValue}>Connected</Text>
                        <Text style={styles.visualMuted}>Using persisted ordered Playbook state.</Text>
                      </View>
                    ) : null}
                    {hasPersistedAppointment ? (
                      <View style={styles.visualPanel}>
                        <Text style={styles.cardLabel}>Appointment</Text>
                        <Text style={styles.visualValue}>Scheduled</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {visibleRelatedSystems.length ? (
                  <View style={styles.card}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleBlock}>
                        <Text style={styles.cardTitle}>Asset systems</Text>
                        <Text style={styles.sectionHint}>Systems connected to this Keepr asset and available for records, Actions, and Playbooks.</Text>
                      </View>
                      <Text style={styles.count}>{visibleRelatedSystems.length}</Text>
                    </View>
                    {visibleRelatedSystems.map((system) => (
                      <View key={system.id} style={styles.visualSystemPill}>
                        <Ionicons name="construct-outline" size={16} color="#2563EB" />
                        <View style={styles.rowBody}>
                          <Text style={styles.visualSystemText}>{system.name}</Text>
                          <Text style={styles.rowMeta}>
                            {compact([
                              system.recordCount ? `${system.recordCount} record${system.recordCount === 1 ? "" : "s"}` : null,
                              system.actionCount ? `${system.actionCount} action${system.actionCount === 1 ? "" : "s"}` : null,
                              system.system_type,
                              system.lifecycle_status || system.status,
                            ]) || "Ready for records, Actions, and Playbooks"}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}

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

                {sharedFiles.length ? (
                  <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionTitleBlock}>
                      <Text style={styles.cardTitle}>Relationship files</Text>
                      <Text style={styles.sectionHint}>Files shared across this relationship.</Text>
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
                  {sharedFiles.map((file) => (
                      <TouchableOpacity
                        key={file.attachment_id || file.placement_id}
                        style={styles.row}
                        onPress={() => openSharedFile(file)}
                        activeOpacity={0.86}
                      >
                        <Ionicons name="attach-outline" size={18} color="#2563EB" />
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle}>{file.title || file.file_name}</Text>
                          <Text style={styles.rowMeta}>
                            {compact([
                              file.created_at ? formatDate(file.created_at) : "Shared file",
                              formatContributionAttribution(file),
                            ])}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                {renderContributionCard()}

                {records.length ? (
                  <View style={styles.card}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.cardTitle}>Previous work with {providerName}</Text>
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
                        <Text style={styles.rowMeta}>
                          {compact([
                            formatDate(record.performed_at),
                            formatContributionAttribution(record),
                          ])}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.listViewLabel}>
                  <Text style={styles.cardLabel}>Keeprship · List View</Text>
                  <Text style={styles.listViewText}>
                    {portal?.relationship_title || relationshipTitle}
                  </Text>
                </View>

            {currentActionOpen ? (
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
            ) : null}

            {renderPlaybookSummary()}

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Keepr asset summary</Text>
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

            {hasPersistedPlaybook || hasPersistedAppointment ? (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Playbook loop</Text>
              </View>
              <View style={styles.detailGrid}>
                {hasPersistedPlaybook ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Playbook</Text>
                  <Text style={styles.detailValue}>Connected</Text>
                </View>
                ) : null}
                {hasPersistedAppointment ? (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Appointment</Text>
                  <Text style={styles.detailValue}>Scheduled</Text>
                </View>
                ) : null}
              </View>
            </View>
            ) : null}

            {visibleRelatedSystems.length ? (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleBlock}>
                  <Text style={styles.cardTitle}>Asset systems</Text>
                  <Text style={styles.sectionHint}>Systems connected to this Keepr asset and available for records, Actions, and Playbooks.</Text>
                </View>
                <Text style={styles.count}>{visibleRelatedSystems.length}</Text>
              </View>
              {visibleRelatedSystems.map((system) => (
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
                ))}
            </View>
            ) : null}

            {records.length ? (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Previous work with {providerName}</Text>
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
                      <Text style={styles.rowMeta}>
                        {compact([
                          formatDate(record.performed_at),
                          record.service_type || record.category,
                          record.verification_status,
                          formatContributionAttribution(record),
                        ])}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
            </View>
            ) : null}

            {renderContributionCard()}

            {sharedActions.length ? (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Shared work</Text>
                <Text style={styles.count}>{sharedActionCount}</Text>
              </View>
              {sharedActions.map((action) => (
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
                          getActionScheduledDueAt(action) ? `Due ${getActionScheduleLabel(action, formatDate)}` : getActionScheduleLabel(action, formatDate),
                        ])}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
            </View>
            ) : null}

            {renderConversationSummary()}

            {sharedFiles.length ? (
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
              {sharedFiles.map((file) => (
                  <TouchableOpacity
                    key={file.attachment_id || file.placement_id}
                    style={styles.row}
                    onPress={() => openSharedFile(file)}
                    activeOpacity={0.86}
                  >
                    <Ionicons name="attach-outline" size={18} color="#2563EB" />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{file.title || file.file_name}</Text>
                      <Text style={styles.rowMeta}>
                        {compact([
                          file.created_at ? formatDate(file.created_at) : "Shared file",
                          formatContributionAttribution(file),
                        ])}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
            </View>
            ) : null}
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
  breadcrumbWorkspace: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 280,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  breadcrumbWorkspaceText: {
    color: colors.brandNavy,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "900",
  },
  breadcrumbSwitchText: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
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
  boatCrudRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  boatCrudButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  boatCrudButtonText: {
    ...typography.caption,
    color: colors.brandBlue,
    fontWeight: "900",
  },
  boatCrudDanger: {
    borderColor: "#FECACA",
  },
  boatCrudDangerText: {
    color: colors.danger,
  },
  boatEditPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  boatEditHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
  },
  boatEditHeaderCopy: {
    flex: 1,
    minWidth: 260,
  },
  boatEditHelper: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "700",
    marginTop: 3,
  },
  boatEditTopActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  boatEditSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  boatEditSectionTitle: {
    ...typography.small,
    color: colors.brandNavy,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  boatEditModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  boatEditModeButton: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  boatEditModeButtonActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  boatEditModeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "900",
  },
  boatEditModeTextActive: {
    color: "#FFFFFF",
  },
  boatEditGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  boatEditField: {
    flexBasis: 180,
    flexGrow: 1,
    gap: 6,
  },
  boatEditFieldWide: {
    flexBasis: "100%",
    gap: 6,
  },
  boatEditInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  boatEditMultiline: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  boatEditActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.md,
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
  assetRelationshipHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  visualHero: {
    flex: 1.05,
    minWidth: 320,
    minHeight: 300,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
    justifyContent: "flex-end",
    ...shadows.card,
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  heroImageAsset: {
    objectFit: "cover",
    resizeMode: "cover",
  },
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  heroFallbackContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
    gap: spacing.xs,
  },
  heroFallbackTitle: {
    ...typography.h2,
    color: colors.brandNavy,
    fontWeight: "900",
  },
  heroFallbackMeta: {
    ...typography.body,
    color: colors.textSecondary,
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
  relationshipContextCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    ...shadows.card,
  },
  relationshipContextItem: {
    flex: 1,
    minWidth: 160,
    borderRadius: radius.sm,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
  },
  relationshipSummaryCard: {
    flex: 0.95,
    minWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    justifyContent: "space-between",
    ...shadows.card,
  },
  relationshipContextGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  boatSpecGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  boatSpecChip: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 150,
    padding: spacing.md,
  },
  boatSpecGridCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  boatSpecChipCompact: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 120,
    flexGrow: 1,
    padding: spacing.sm,
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
  conversationSummary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
    gap: spacing.md,
  },
  conversationSummaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  conversationPreviewList: {
    gap: spacing.sm,
  },
  conversationPreviewBubble: {
    alignSelf: "flex-start",
    maxWidth: "78%",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  conversationPreviewBubbleMine: {
    alignSelf: "flex-end",
    borderColor: "#2563EB",
    backgroundColor: "#2F80ED",
  },
  conversationPreviewMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    marginBottom: 3,
  },
  conversationPreviewMetaMine: {
    color: "#DBEAFE",
  },
  conversationPreviewText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  conversationPreviewTextMine: {
    color: "#FFFFFF",
  },
  compactReplyBox: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  compactReplyInput: {
    minHeight: 58,
    textAlignVertical: "top",
  },
  pendingReplyStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  pendingReplyChip: {
    maxWidth: 240,
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
  pendingReplyText: {
    flex: 1,
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "800",
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
  linkLabel: {
    color: colors.primary,
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
  detailItemPlain: {
    width: "31%",
    minWidth: 160,
    gap: 4,
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
  playbookBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  playbookHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  playbookStepList: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  playbookStepRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "#F8FAFC",
  },
  playbookStepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
  },
  playbookStepIndexText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "900",
  },
  playbookStepStatus: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "900",
    textTransform: "uppercase",
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
