import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from "expo-image-picker";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  getActivatorBoatBrowser,
  getCatalogTemplates,
  getExactBuildWorkQueue,
} from "../lib/activatorApi";
import { createOrgModelTemplate } from "../lib/keeprAdminApi";
import {
  connectKeeprSpaceBoat,
  createKeeprSpaceBoat,
  getKeeprSpaceOrgConfig,
  getKeeprSpacePortfolio,
  resolveKeeprSpaceKac,
  updateKeeprSpaceServiceProfile,
  upsertKeeprSpaceOrgLocation,
  upsertKeeprSpaceOrgMemberAssignment,
  upsertKeeprSpaceOrgProfile,
  upsertKeeprSpaceOrgRelationship,
  upsertKeeprSpaceOrgServiceOffering,
  upsertKeeprSpaceOrgTeam,
} from "../lib/keeprspaceApi";
import { fetchAssetHeroUris } from "../lib/assetHeroResolver";
import { listModelTemplateMediaForTemplates } from "../lib/attachmentsApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { getActionScheduledDueAt, isPlaybookDueDatePending } from "../lib/playbookSchedule";
import { supabase } from "../lib/supabaseClient";
import {
  TIARA_56_LS_TEMPLATE_KEY,
  TIARA_KF018_BUILD_KEY,
  tiaraKf018FactoryBuild,
} from "../data/tiaraKf018FactoryBuild";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const BOAT_HERO = require("../assets/boats/tiara/tiara_39ls_hero.jpg");

const SHOWCASE_ASSETS = {
  tiara_39le_hero: require("../assets/boats/tiara/tiara_39le_hero.jpg"),
  tiara_39ls_hero: require("../assets/boats/tiara/tiara_39ls_hero.jpg"),
};
const ENABLE_KF018_LOCAL_FLEET_FALLBACK = process.env.EXPO_PUBLIC_ENABLE_KF018_LOCAL_FLEET_FALLBACK === "1";

function navSectionForActivatorMode(nextMode) {
  return (
    nextMode === "messages" ? "ActivatorEngage" :
    nextMode === "profile" ? "KeeprSpaceAdmin" :
    nextMode === "addBoat" ? "ActivatorAdd" :
    nextMode === "connect" ? "ActivatorConnect" :
    nextMode === "fleet" ? "ActivatorFind" :
    nextMode === "builds" ? "ActivatorWork" :
    nextMode === "templates" ? "ActivatorTemplates" :
    "ActivatorHome"
  );
}

function activatorModeUrl(nextMode, { workspaceId = null, organizationId = null } = {}) {
  const params = new URLSearchParams();
  params.set("initialMode", nextMode || "fleet");
  params.set("navSection", navSectionForActivatorMode(nextMode || "fleet"));
  if (organizationId) params.set("organizationId", String(organizationId));
  if (workspaceId) params.set("workspaceId", String(workspaceId));
  return `/activator?${params.toString()}`;
}

function setActivatorWebUrl(nextMode, context = {}) {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const nextUrl = activatorModeUrl(nextMode, context);
  const currentUrl = `${window.location.pathname || ""}${window.location.search || ""}`;
  if (currentUrl === nextUrl) return true;
  window.history.pushState({}, "", nextUrl);
  return true;
}

function openActivatorWebPath(path, params = {}) {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const nextUrl = `${path}${query.toString() ? `?${query.toString()}` : ""}`;
  const currentUrl = `${window.location.pathname || ""}${window.location.search || ""}`;
  if (currentUrl === nextUrl) return true;
  window.location.assign(nextUrl);
  return true;
}

const KEEPRSPACE_ADMIN_TABS = [
  { key: "profile", label: "Profile", icon: "business-outline" },
  { key: "locations", label: "Locations", icon: "location-outline" },
  { key: "members", label: "Members", icon: "people-outline" },
  { key: "teams", label: "Teams", icon: "git-network-outline" },
  { key: "services", label: "Services", icon: "construct-outline" },
  { key: "capabilities", label: "Capabilities", icon: "flash-outline" },
  { key: "brands", label: "Brands / Relationships", icon: "link-outline" },
];

const OEM_WORK_AREAS = [
  {
    key: "fleet",
    label: "Find",
    icon: "search-outline",
    description: "Search boats, owners, HINs, dealers, and active KACs.",
  },
  {
    key: "addBoat",
    label: "Add / Connect",
    icon: "add-circle-outline",
    description: "Resolve a boat, create one if needed, and connect the owner context.",
  },
  {
    key: "connect",
    label: "Connect",
    icon: "people-outline",
    description: "Connect or leave owner unknown, then continue the relationship handoff.",
  },
  {
    key: "messages",
    label: "Engage",
    icon: "chatbubbles-outline",
    description: "Customer, dealer, and internal activation conversations.",
  },
  {
    key: "templates",
    label: "Model Catalog",
    icon: "library-outline",
    description: "Reusable model templates, sources, systems, manuals, and media.",
    authority: "Detail",
  },
  {
    key: "needs",
    label: "Needs Attention",
    icon: "notifications-outline",
    description: "Recent follow-ups and activation exceptions.",
    hidden: true,
  },
  {
    key: "builds",
    label: "Work",
    icon: "construct-outline",
    description: "Open exact builds, factory sources, handoff queues, and work context.",
    hidden: true,
  },
  {
    key: "profile",
    label: "Admin",
    icon: "settings-outline",
    description: "Organization profile and operating setup.",
    hidden: true,
  },
];

const WILSON_REPRESENTED_BRANDS = [
  { name: "Bennington", inventoryCount: 113, inventoryState: "New inventory" },
  { name: "Harris", inventoryCount: 75, inventoryState: "Inventory" },
  { name: "Bayliner", inventoryCount: 11, inventoryState: "Inventory" },
  { name: "Starweld", inventoryCount: 10, inventoryState: "Inventory" },
  { name: "Evotti", inventoryCount: 9, inventoryState: "Inventory" },
  { name: "Sportsman", inventoryCount: 9, inventoryState: "Inventory" },
  { name: "SunChaser", inventoryCount: 8, inventoryState: "Inventory" },
  { name: "Crestliner", inventoryCount: 7, inventoryState: "Inventory" },
  { name: "Crownline", inventoryCount: 2, inventoryState: "Inventory" },
  { name: "Smoker Craft", inventoryCount: null, inventoryState: "Represented brand" },
  { name: "Mercury", inventoryCount: null, inventoryState: "Propulsion" },
  { name: "Yamaha", inventoryCount: null, inventoryState: "Propulsion" },
];

const DEALER_INTAKE_EXAMPLES = [
  {
    key: "harris-2009-origin",
    model: "2009 Harris Kayot V220i",
    identifier: "Sold by Wilson Marine · Jun 5, 2020",
    state: "Owned / Connected",
    action: "Open",
    assetId: "9733c254-579b-47ab-8b51-593b1d44f8fa",
    kac: "BOAT-2008-3BOZ95",
  },
  {
    key: "bennington-build-sheet",
    model: "Bennington pontoon intake",
    identifier: "Brand represented · build sheet or DMS import",
    state: "Brand Intake",
    action: "Start Intake",
  },
  {
    key: "harris-inventory",
    model: "Harris inventory boat",
    identifier: "Resolve HIN/Keepr Code before create",
    state: "Resolve First",
    action: "Add Boat",
  },
];

const DEFAULT_WORK_AREAS = [
  {
    key: "fleet",
    label: "Active Boats",
    icon: "boat-outline",
    description: "Searchable portfolio of authorized boats.",
  },
  {
    key: "builds",
    label: "In Progress",
    icon: "shield-checkmark-outline",
    description: "Boats moving through readiness and assignment.",
  },
  {
    key: "network",
    label: "Network",
    icon: "storefront-outline",
    description: "Authorized relationships for this workspace.",
  },
];

const DEALER_WORK_AREAS = [
  ...DEFAULT_WORK_AREAS,
  {
    key: "profile",
    label: "KeeprSpace Admin",
    icon: "settings-outline",
    description: "Profile, members, locations, teams, services, capabilities, and brands.",
    authority: "Admin",
  },
];

const PRO_WORK_AREAS = [
  {
    key: "needs",
    label: "Needs Attention",
    icon: "alert-circle-outline",
    description: "Open requests, customer replies, upcoming work, and service follow-through.",
  },
  {
    key: "fleet",
    label: "Active Boats",
    icon: "boat-outline",
    description: "Searchable customer boat portfolio from active service relationships.",
  },
  {
    key: "addBoat",
    label: "Add Boat",
    icon: "add-circle-outline",
    description: "Resolve an existing boat before creating a new customer KAC.",
  },
  {
    key: "messages",
    label: "Messages",
    icon: "chatbubbles-outline",
    description: "Relationship conversations across the authorized portfolio.",
  },
  {
    key: "profile",
    label: "KeeprSpace Admin",
    icon: "settings-outline",
    description: "Profile, members, locations, teams, services, capabilities, and brands.",
    authority: "Admin",
  },
];

const SALES_WORK_AREAS = [
  {
    key: "fleet",
    label: "Active Boats",
    icon: "boat-outline",
    description: "Boats connected through sales, delivery, activation, or service relationships.",
  },
  {
    key: "builds",
    label: "Delivery Prep",
    icon: "shield-checkmark-outline",
    description: "Exact boats moving through dealer prep, buyer additions, and owner handoff.",
  },
  {
    key: "addBoat",
    label: "Add Boat",
    icon: "add-circle-outline",
    description: "Resolve an existing boat before creating a new sales or delivery KAC.",
  },
  {
    key: "network",
    label: "Network",
    icon: "storefront-outline",
    description: "OEMs, locations, buyers, and connected vessel relationships.",
  },
  {
    key: "profile",
    label: "KeeprSpace Admin",
    icon: "settings-outline",
    description: "Profile, members, locations, teams, services, capabilities, and brands.",
    authority: "Admin",
  },
];

const SERVICE_WORK_AREAS = [
  {
    key: "needs",
    label: "Needs Attention",
    icon: "alert-circle-outline",
    description: "Open requests, customer replies, upcoming work, and service follow-through.",
  },
  {
    key: "fleet",
    label: "Active Boats",
    icon: "boat-outline",
    description: "Searchable customer boat portfolio from active service relationships.",
  },
  {
    key: "addBoat",
    label: "Add Boat",
    icon: "add-circle-outline",
    description: "Resolve an existing boat before creating a new customer KAC.",
  },
  {
    key: "messages",
    label: "Messages",
    icon: "chatbubbles-outline",
    description: "Relationship conversations across the authorized portfolio.",
  },
  {
    key: "profile",
    label: "KeeprSpace Admin",
    icon: "settings-outline",
    description: "Profile, members, locations, teams, services, capabilities, and brands.",
    authority: "Admin",
  },
];

const ADD_BOAT_PURPOSES = [
  { key: "service", label: "Service", state: "In Service" },
  { key: "stewardship", label: "Stewardship", state: "Under Stewardship" },
  { key: "storage", label: "Storage", state: "Stored" },
  { key: "selling_dealer", label: "Selling Dealer", state: "For Sale" },
  { key: "delivery_dealer", label: "Delivery Dealer", state: "Delivery Prep" },
];

const ADD_BOAT_STATES = ["For Sale", "Delivery Prep", "Owned / Connected", "Under Stewardship", "In Service", "Stored"];

const EMPTY_NEW_BOAT = {
  year: "",
  make: "",
  model: "",
  hin: "",
  newUsed: "Used",
  name: "",
  photos: [],
  location: "",
  engine: "",
  owner: "",
  operationalState: "In Service",
};

function compact(parts) {
  return parts.filter(Boolean).join(" · ");
}

function labelize(value) {
  return String(value || "").replace(/_/g, " ");
}

export function listFromValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function textFromListValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value == null ? "" : String(value);
}

function textFromLineListValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => item?.label || item?.title || item?.name || item)
      .filter(Boolean)
      .join("\n");
  }
  return value == null ? "" : String(value);
}

function confirmAdminChange(title, message, onConfirm) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (window.confirm(message || title)) onConfirm?.();
    return;
  }

  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Continue", style: "destructive", onPress: onConfirm },
  ]);
}

function isWideAdminField(key) {
  return key.includes("description") || key === "source_url" || key === "service_items";
}

function isMultilineAdminField(key) {
  return key.includes("description") || key === "service_items";
}

function initialsForName(value) {
  const words = String(value || "KeeprSpace")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "K";
}

function titleForBoat(boat) {
  const identity = boat?.identity || {};
  return compact([identity.year, identity.make, identity.model]) || boat?.asset_name || "Boat";
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("verified") || normalized.includes("active") || normalized.includes("ready")) return "good";
  if (normalized.includes("pending") || normalized.includes("draft") || normalized.includes("reported") || normalized.includes("awaiting")) return "watch";
  return "neutral";
}

function mediaAsset(media) {
  const localKey = media?.local_asset_key || media?.metadata?.local_asset_key;
  if (SHOWCASE_ASSETS[localKey]) return SHOWCASE_ASSETS[localKey];

  const uri =
    media?.url ||
    media?.signed_url ||
    media?.public_url ||
    media?.publicUrl ||
    media?.uri ||
    media?.metadata?.url ||
    media?.metadata?.uri ||
    null;
  if (uri && !String(uri).startsWith("app://")) return { uri };

  return null;
}

function heroMediaFromTemplate(template) {
  const configured = template?.metadata?.presentation?.hero_media ||
    template?.metadata?.hero_media ||
    template?.metadata?.model_hero_media ||
    null;
  if (configured) return configured;

  return (template?.showcase_media || []).find((item) => item.role === "hero" || item.metadata?.role === "hero");
}

function assetIdForBoat(boat) {
  return boat?.asset_id || boat?.asset?.id || boat?.id || null;
}

function uriFromHeroMedia(media) {
  if (!media) return null;
  if (typeof media === "string") return media;
  return (
    media.url ||
    media.signed_url ||
    media.public_url ||
    media.publicUrl ||
    media.hero_image_url ||
    media.hero_thumb_url ||
    media.uri ||
    null
  );
}

function heroUriFromBoat(boat) {
  const presentation = boat?.metadata?.presentation || {};
  const assetPresentation = boat?.asset?.metadata?.presentation || {};

  return (
    uriFromHeroMedia(boat?.hero_media) ||
    uriFromHeroMedia(boat?.relationship_hero_media) ||
    uriFromHeroMedia(boat?.asset?.hero_media) ||
    uriFromHeroMedia(boat?.media?.hero) ||
    uriFromHeroMedia(boat?.metadata?.hero_media) ||
    presentation.hero_url ||
    presentation.hero_image_url ||
    presentation.hero_thumb_url ||
    assetPresentation.hero_url ||
    assetPresentation.hero_image_url ||
    assetPresentation.hero_thumb_url ||
    boat?.hero_image_url ||
    boat?.hero_thumb_url ||
    boat?.primary_photo_url ||
    boat?.showcase_image_url ||
    boat?.cover_image_url ||
    boat?.image_url ||
    boat?.asset?.hero_image_url ||
    boat?.asset?.hero_thumb_url ||
    null
  );
}

function heroSourceForBoat(boat, heroUri = null) {
  const rowHeroUri = heroUri || heroUriFromBoat(boat);
  if (rowHeroUri) return { uri: rowHeroUri };

  const model = normalizeModelName(compact([
    boat?.identity?.make,
    boat?.identity?.model,
    boat?.template?.manufacturer,
    boat?.template?.model,
    boat?.asset_name,
  ]));

  if (model.includes("tiara39le")) return SHOWCASE_ASSETS.tiara_39le_hero;
  if (model.includes("tiara39ls")) return SHOWCASE_ASSETS.tiara_39ls_hero;

  return null;
}

function normalizeModelName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPersonalFallbackWorkspaceId(value) {
  return value === "keepr:fallback";
}

function workspaceOrganizationId(workspace) {
  const workspaceId = String(workspace?.workspace_id || workspace?.id || "");
  return (
    workspace?.organization_id ||
    workspace?.org_id ||
    workspace?.authority?.organization_id ||
    workspace?.authority?.org_id ||
    workspace?.authority?.subject_id ||
    (workspaceId.startsWith("org:") ? workspaceId.slice(4) : null) ||
    null
  );
}

function organizationIdFromWorkspaceId(workspaceId) {
  const id = String(workspaceId || "");
  return id.startsWith("org:") ? id.slice(4) : null;
}

function workspaceMatchesOrganization(workspace, organizationId) {
  const orgId = String(organizationId || "");
  if (!workspace || !orgId) return false;

  return (
    workspaceOrganizationId(workspace) === orgId ||
    workspace.workspace_id === `org:${orgId}` ||
    workspace.id === `org:${orgId}`
  );
}

function workspaceHasCapability(workspace, capability) {
  const capabilities =
    workspace?.capabilities ||
    workspace?.workspace_capabilities ||
    workspace?.organization?.workspace_capabilities ||
    workspace?.metadata?.capabilities ||
    [];
  return listFromValue(capabilities).includes(capability);
}

function fallbackTemplateStats(template = {}) {
  const model = String(template.model || "").toLowerCase();
  if (model.includes("56 ls")) {
    return { loa: "56'2\"", beam: "16'0\"", max_hp: "2,400 HP" };
  }
  return { loa: "39'6\"", beam: "12'6\"", max_hp: "1,200 HP" };
}

function workspaceKind(workspace) {
  const type = workspace?.workspace_type || workspace?.type;
  if (type === "keeproem") return "oem";
  if (type === "keeprdealer") return "dealer";
  if (type === "keeprpro" || type === "pro") return "pro";
  return "owner";
}

function defaultWorkspaceProjection(workspace) {
  const kind = workspaceKind(workspace);
  if (kind === "dealer") return "sales";
  if (kind === "pro") return "service";
  return null;
}

function canSwitchProjection(workspace) {
  const kind = workspaceKind(workspace);
  return kind === "dealer" || kind === "pro";
}

function projectionLabel(value) {
  return value === "sales" ? "Sales" : "Service";
}

function copyForWorkspace(workspace, projection = null) {
  const kind = workspaceKind(workspace);
  const name =
    workspace?.display?.name ||
    workspace?.display_name ||
    workspace?.name ||
    workspace?.org_name ||
    workspace?.organization_name ||
    workspace?.label ||
    "Keepr";

  if (kind === "oem") {
    return {
      eyebrow: "Customer Experience",
      title: "Find the boat and complete the next job",
      subtitle: "Search first, then open the boat, update details, connect the owner, or continue the handoff work.",
      search: "Search HIN, Keepr code, boat, owner, dealer, or customer",
      primaryMetric: "Visible boats",
      filteredMetric: "In view",
      modeMetric: "CX",
      networkTitle: "Connected organizations",
      networkBody: "Dealers, service teams, and OEM contacts stay connected through the boat they support.",
      emptyTitle: "No boats found",
      emptyBody: "Search by HIN, Keepr code, owner, dealer, or model. If Keepr cannot find it, use Add Boat.",
      name,
    };
  }

  if (kind === "dealer") {
    if (projection === "service") {
      return {
        eyebrow: "KeeprPro",
        title: "Supported boats and service continuity",
        subtitle: "A service projection for assigned vessels, open care needs, records, and customer follow-through.",
        search: "Search supported boats, HIN, customer, service state",
        primaryMetric: "Supported boats",
        filteredMetric: "In view",
        modeMetric: "Service",
        networkTitle: "Service relationships",
        networkBody: "Service access is based on active vessel relationships, so private owner information stays scoped to the work at hand.",
        emptyTitle: "No supported boats visible in Service mode yet",
        emptyBody: "Boats appear here when a valid service relationship connects this workspace to the vessel.",
        name,
      };
    }
    return {
      eyebrow: "KeeprDealer",
      title: "Your boats, customers, locations, and service",
      subtitle: "A dealer workspace for delivered boats, active customers, marina locations, and continuity after the sale.",
      search: "Search boats, customers, HIN, location, service state",
      primaryMetric: "Customer boats",
      filteredMetric: "In view",
      modeMetric: "Dealer",
      networkTitle: "OEMs and locations",
      networkBody: "Represented OEMs, known locations, and customer vessels resolve into one operational workspace without turning locations into separate companies.",
      emptyTitle: "No customer boats visible for this dealer workspace yet",
      emptyBody: "Boats appear when an active boat relationship connects this dealer, location, or service team to the vessel.",
      name,
    };
  }

  if (kind === "pro") {
    if (projection === "sales") {
      return {
        eyebrow: "KeeprDealer",
        title: "Boats, customers, delivery, and activation",
        subtitle: "A sales projection for represented boats, delivery relationships, buyer handoff, and continuity after the sale.",
        search: "Search boats, customers, HIN, location, delivery state",
        primaryMetric: "Sales boats",
        filteredMetric: "In view",
        modeMetric: "Sales",
        networkTitle: "Sales relationships",
        networkBody: "Sales access is based on active boat relationships; service history and owner-private context remain relationship scoped.",
        emptyTitle: "No sales boats visible in Sales mode yet",
        emptyBody: "Boats appear here when a valid selling, delivery, or activation relationship connects this workspace to the vessel.",
        name,
      };
    }
    return {
      eyebrow: "KeeprPro",
      title: "Supported boats and service continuity",
      subtitle: "A service workspace for assigned vessels, open care needs, records, and customer follow-through.",
      search: "Search supported boats, HIN, customer, service state",
      primaryMetric: "Supported boats",
      filteredMetric: "In view",
      modeMetric: "Service",
      networkTitle: "Service relationships",
      networkBody: "Service access is based on active vessel relationships, so private owner information stays scoped to the work at hand.",
      emptyTitle: "No supported boats visible yet",
      emptyBody: "Boats appear here when a valid service relationship connects this workspace to the vessel.",
      name,
    };
  }

  return {
    eyebrow: "Keepr",
    title: "My boats and ownership continuity",
    subtitle: "A private owner workspace for your assets, care history, trusted providers, and future handoff.",
    search: "Search my boats, HIN, care item, provider",
    primaryMetric: "My boats",
    filteredMetric: "In view",
    modeMetric: "Owner",
    networkTitle: "Trusted relationships",
    networkBody: "Owners control which organizations can see and support each vessel.",
    emptyTitle: "No boats visible yet",
    emptyBody: "Your boats and authorized support relationships will appear here as they are connected.",
    name,
  };
}

function normalizeFilters({ workspace, search }) {
  const kind = workspaceKind(workspace);
  const filters = { limit: 50 };
  const trimmed = search.trim();
  if (trimmed) filters.search = trimmed;

  const orgId = workspace?.organization_id || workspace?.org_id;
  if (kind === "oem" && orgId) filters.oem_org_id = orgId;
  if (kind === "dealer" && orgId) filters.dealer_org_id = orgId;
  return filters;
}

function kf018FleetProjection() {
  const workOrder = tiaraKf018FactoryBuild.work_order || {};
  const catalog = tiaraKf018FactoryBuild.catalog_template || {};
  return {
    id: "factory-build-kf018",
    asset_id: "factory-build-kf018",
    source_type: "factory_build_workspace",
    asset_name: "KF018 · 2027 Tiara 56 LS",
    kac_id: "KAC-TIARA-56LS-KF018",
    owner_state: "OEM Build",
    organization_id: null,
    template: {
      template_key: TIARA_56_LS_TEMPLATE_KEY,
      manufacturer: catalog.manufacturer || "Tiara Yachts",
      model: catalog.model || "56 LS",
      model_year: catalog.model_year || 2027,
    },
    identity: {
      year: String(catalog.model_year || 2027),
      make: catalog.manufacturer || "Tiara Yachts",
      model: catalog.model || "56 LS",
      hin: workOrder.hin,
      hull_number: workOrder.hull_number,
      build_code: workOrder.build_code,
      order_number: workOrder.order_number,
    },
    activation: {
      status: "OEM Build",
      stage: "factory_build",
    },
    verification: {
      percent: 70,
      status: "factory_confirmed",
    },
    oem_relationship: {
      organization_name: "Tiara Yachts",
      relationship_type: "builder",
      relationship_purpose: "Factory build",
      status: "Active",
    },
    dealer_relationship: {
      organization_name: workOrder.dealer || "Ocean Blue Yachts",
      relationship_type: "dealer",
      relationship_purpose: "Delivery",
      status: "Pending",
      location_name: "Stuart, FL",
    },
    exact_build: {
      template_key: TIARA_56_LS_TEMPLATE_KEY,
      build_key: TIARA_KF018_BUILD_KEY,
      hull_number: workOrder.hull_number,
      source_type: workOrder.source_type,
      source_document: workOrder.source_document,
    },
  };
}

function withKf018FleetProjection(data, workspace, search) {
  if (!ENABLE_KF018_LOCAL_FLEET_FALLBACK) return data;
  if (workspaceKind(workspace) !== "oem") return data;

  const query = String(search || "").trim().toLowerCase();
  const projection = kf018FleetProjection();
  const searchable = [
    projection.asset_name,
    projection.kac_id,
    projection.identity?.hin,
    projection.identity?.hull_number,
    projection.identity?.build_code,
    projection.identity?.order_number,
    projection.template?.model,
    projection.template?.manufacturer,
  ].filter(Boolean).join(" ").toLowerCase();

  if (query && !searchable.includes(query)) return data;

  const currentBoats = Array.isArray(data?.boats) ? data.boats : [];
  const alreadyPresent = currentBoats.some((boat) => {
    const haystack = [boat.asset_id, boat.id, boat.kac_id, boat.identity?.hin, boat.identity?.hull_number, boat.asset_name]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return haystack.includes("factory-build-kf018")
      || haystack.includes("kac-tiara-56ls-kf018")
      || haystack.includes("ssukf018h627")
      || haystack.some((value) => value.includes("kf018"));
  });

  if (alreadyPresent) return data;

  const nextBoats = [projection, ...currentBoats];
  const counts = data?.counts || {};
  return {
    ...(data || {}),
    boats: nextBoats,
    counts: {
      ...counts,
      visible_boats: Math.max(Number(counts.visible_boats || 0), nextBoats.length),
      filtered_boats: Math.max(Number(counts.filtered_boats || 0), nextBoats.length),
    },
  };
}

function workAreasForWorkspace(workspace) {
  const kind = workspaceKind(workspace);
  if (kind === "oem") return OEM_WORK_AREAS;
  if (kind === "dealer") return DEALER_WORK_AREAS;
  if (kind === "pro") return PRO_WORK_AREAS;
  return DEFAULT_WORK_AREAS;
}

function workAreasForProjection(workspace, projection) {
  const kind = workspaceKind(workspace);
  if (kind === "oem") return OEM_WORK_AREAS;
  if (kind === "dealer" || kind === "pro") {
    return projection === "sales" ? SALES_WORK_AREAS : SERVICE_WORK_AREAS;
  }
  return DEFAULT_WORK_AREAS;
}

export function defaultBrandProfile(workspace) {
  const kind = workspaceKind(workspace);
  const workspaceName =
    workspace?.display?.name ||
    workspace?.display_name ||
    workspace?.name ||
    workspace?.org_name ||
    workspace?.organization_name ||
    workspace?.label ||
    null;
  const organizationId = workspace?.organization_id || workspace?.org_id || null;
  const slug = workspace?.slug || workspace?.organization_slug || workspace?.display?.slug || "";
  const logoUri =
    workspace?.display?.logo_url ||
    workspace?.display?.photo_url ||
    workspace?.photo_url ||
    null;
  const headerImageUri =
    workspace?.display?.header_image_url ||
    workspace?.display?.team_photo_url ||
    workspace?.team_photo_url ||
    null;
  if (kind === "pro") {
    return {
      displayName: workspaceName || "Wilson Marine",
      location: "Howell, Michigan",
      profileStatus: "Published",
      shortDescription: "Marine service, storage, stewardship, and customer continuity for supported boats.",
      publicDescription:
        "Wilson Marine supports customer boats across service, storage, seasonal care, stewardship, messaging, and long-term ownership continuity in Keepr.",
      website: "wilsonboats.com",
      phone: "",
      email: "",
      serviceOfferings: "Marine service, Winterization, Storage, Commissioning",
      packages: "",
      logoUri,
      headerImageUri,
      organizationId,
      keeprProId: workspace?.keepr_pro_id || workspace?.display?.keepr_pro_id || null,
      slug,
    };
  }

  if (kind === "dealer") {
    return {
      displayName: workspaceName || "SkipperBud's",
      location: "Lake Fenton Marina · Fenton, Michigan",
      profileStatus: "Published",
      shortDescription: "Dealer sales, delivery, marina locations, and service continuity for activated boats.",
      publicDescription:
        "SkipperBud's receives OEM-activated boats, prepares delivery, adds exact-hull evidence, activates owners, and continues as a trusted service partner in Keepr.",
      website: "skipperbuds.com",
      phone: "",
      email: "",
      serviceOfferings: "Sales, Delivery, Service, Owner activation",
      packages: "",
      logoUri,
      headerImageUri,
      organizationId,
      keeprProId: workspace?.keepr_pro_id || workspace?.display?.keepr_pro_id || null,
      slug,
    };
  }

  return {
    displayName: workspaceName || "OEM Organization",
    location: "",
    profileStatus: "Draft",
    shortDescription: "OEM catalog, activation, dealer network, and ownership continuity workspace.",
    publicDescription:
      "This organization builds reusable model templates, exact-build activations, dealer-network continuity, and ownership-ready digital records in Keepr.",
    website: "",
    phone: "",
    email: "",
    serviceOfferings: "Catalog, Activation, Dealer network",
    packages: "",
    logoUri,
    headerImageUri,
    organizationId,
    keeprProId: workspace?.keepr_pro_id || workspace?.display?.keepr_pro_id || null,
    slug,
  };
}

export function brandProfileFromKeeprSpaceContext(context, workspace) {
  if (!context) return defaultBrandProfile(workspace);
  return {
    displayName: context.display_name || context.organization_name || defaultBrandProfile(workspace).displayName,
    location: context.location || defaultBrandProfile(workspace).location,
    profileStatus: context.publish_status || context.profile_status || "draft",
    shortDescription: context.short_description || defaultBrandProfile(workspace).shortDescription,
    publicDescription: context.public_description || defaultBrandProfile(workspace).publicDescription,
    website: context.website || defaultBrandProfile(workspace).website,
    phone: context.phone || "",
    email: context.email || "",
    serviceOfferings: Array.isArray(context.service_offerings)
      ? context.service_offerings.filter(Boolean).join(", ")
      : "",
    packages: Array.isArray(context.packages) ? context.packages.filter(Boolean).join(", ") : "",
    logoUri: context.logo_url || context.photo_url || null,
    headerImageUri: context.header_image_url || context.team_photo_url || null,
    keeprProId: context.keepr_pro_id || null,
    organizationId: context.organization_id || null,
    slug: context.keepr_pro_slug || context.organization_slug || "",
  };
}

export function brandProfileFromOrgConfig(config, workspace) {
  if (!config?.organization) return brandProfileFromKeeprSpaceContext(config?.context, workspace);
  const fallback = defaultBrandProfile(workspace);
  const org = config.organization || {};
  const pro = config.keepr_pro || {};
  const firstLocation = Array.isArray(config.locations) ? config.locations[0] : null;
  const services = Array.isArray(config.service_offerings)
    ? config.service_offerings.map((service) => service.owner_facing_label || service.name).filter(Boolean)
    : [];
  const locationLabel = firstLocation
    ? [firstLocation.name, firstLocation.city, firstLocation.region].filter(Boolean).join(" · ")
    : fallback.location;

  return {
    displayName: org.display_name || org.name || pro.display_name || fallback.displayName,
    location: locationLabel,
    profileStatus: pro.publish_status || org.status || fallback.profileStatus,
    shortDescription: pro.short_description || org.short_description || fallback.shortDescription,
    publicDescription: pro.public_description || org.public_description || fallback.publicDescription,
    website: pro.website || org.website || fallback.website,
    phone: pro.phone || org.phone || fallback.phone,
    email: pro.email || org.email || fallback.email,
    serviceOfferings: services.join(", "),
    packages: Array.isArray(pro.packages) ? pro.packages.filter(Boolean).join(", ") : fallback.packages,
    logoUri: pro.logo_url || org.logo_url || org.photo_url || fallback.logoUri,
    headerImageUri: pro.header_image_url || org.header_image_url || org.team_photo_url || fallback.headerImageUri,
    keeprProId: pro.id || fallback.keeprProId,
    organizationId: org.id || fallback.organizationId,
    slug: org.slug || pro.slug || fallback.slug,
  };
}

async function pickLocalImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.9,
  });

  if (result.canceled) return null;
  return result.assets?.[0]?.uri || null;
}

async function pickActivatorBoatPhotos() {
  const pickerMediaTypes = ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: pickerMediaTypes,
    allowsMultipleSelection: true,
    selectionLimit: 12,
    quality: 0.9,
  });

  if (result.canceled) return null;
  return (result.assets || []).filter((asset) => asset?.uri);
}

async function uploadActivatorBoatPhotos({ assetId, photos }) {
  if (!assetId || !photos?.length) return;

  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    const isHero = index === 0;
    await uploadAttachmentFromUri({
      assetId,
      kind: "photo",
      fileUri: photo.uri,
      fileName: photo.fileName || `activator-boat-${index + 1}.jpg`,
      mimeType: photo.mimeType || "image/jpeg",
      sizeBytes: photo.fileSize || null,
      title: isHero ? "Activator hero photo" : "Activator showcase photo",
      sourceContext: "activator_boat_create",
      setAsAssetHero: isHero,
      placements: [
        {
          target_type: "asset",
          target_id: assetId,
          role: isHero ? "primary" : "showcase",
          label: isHero ? "Hero" : "Showcase",
          sort_order: index,
          is_showcase: true,
        },
      ],
    });
  }
}

export async function pickAndUploadBrandImage({ profile, field }) {
  const keeprProId = profile?.keeprProId;
  const organizationId = profile?.organizationId;
  if (!keeprProId && !organizationId) return pickLocalImage();

  const pickerMediaTypes = ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: pickerMediaTypes,
    quality: 0.9,
  });
  if (result.canceled) return null;

  const picked = result.assets?.[0];
  if (!picked) return null;

  const fileExt =
    (picked.fileName && picked.fileName.split(".").pop()) ||
    (picked.mimeType && picked.mimeType.split("/").pop()) ||
    "jpg";
  const storagePath = `keeprspaces/${organizationId || keeprProId}/${field}_${Date.now()}.${fileExt}`;
  const contentType = picked.mimeType || "image/jpeg";

  let uploadBody;
  if (Platform.OS === "web" && picked.file) {
    uploadBody = picked.file;
  } else {
    const response = await fetch(picked.uri);
    if (!response.ok) throw new Error("Could not read the selected image.");
    uploadBody = await response.blob();
  }

  const { error: uploadError } = await supabase.storage
    .from("org-images")
    .upload(storagePath, uploadBody, { contentType, upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("org-images").getPublicUrl(storagePath);
  const url = publicData?.publicUrl || null;
  if (!url) throw new Error("Could not get uploaded image URL.");
  return url;
}

function WorkAreaButton({ item, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.workAreaButton, active && styles.workAreaButtonActive]}
    >
      <View style={[styles.workAreaIcon, active && styles.workAreaIconActive]}>
        <Ionicons name={item.icon} size={17} color={active ? colors.onPrimary : colors.brandBlue} />
      </View>
      <View style={styles.workAreaTextWrap}>
        <View style={styles.workAreaTitleRow}>
          <Text style={[styles.workAreaLabel, active && styles.workAreaLabelActive]} numberOfLines={1}>
            {item.label}
          </Text>
          {item.authority ? (
            <View style={styles.authorityPill}>
              <Text style={styles.authorityPillText}>{item.authority}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.workAreaDescription, active && styles.workAreaDescriptionActive]} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ProjectionModeSwitch({ value, onChange, compact = false }) {
  return (
    <View style={[styles.projectionSwitch, compact && styles.projectionSwitchCompact]}>
      {["sales", "service"].map((mode) => {
        const active = value === mode;
        return (
          <TouchableOpacity
            key={mode}
            activeOpacity={0.86}
            onPress={() => onChange(mode)}
            style={[styles.projectionButton, active && styles.projectionButtonActive]}
          >
            <Ionicons
              name={mode === "sales" ? "pricetag-outline" : "construct-outline"}
              size={14}
              color={active ? colors.onPrimary : colors.textSecondary}
            />
            <Text style={[styles.projectionButtonText, active && styles.projectionButtonTextActive]}>
              {projectionLabel(mode)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function statusItemsForRail({ copy, projectionMode }) {
  if (projectionMode === "sales") {
    return {
      title: "Sales Workspace",
      items: [
        { label: "Brands", value: String(WILSON_REPRESENTED_BRANDS.length) },
        { label: "Connected Boats", value: "1" },
      ],
    };
  }
  if (projectionMode === "service" || copy?.modeMetric === "Service") {
    return {
      title: "Service Status",
      items: [
        { label: "Supported Boats", value: "1" },
        { label: "Needs Attention", value: "1" },
        { label: "Open Threads", value: "1" },
        { label: "Stored / Seasonal", value: "1" },
      ],
    };
  }
  return {
    title: "Production / Activation Status",
    items: [
      { label: "Catalog Models", value: "0" },
      { label: "Exact Builds", value: "0" },
      { label: "Dealer Links", value: "0" },
    ],
  };
}

function WorkAreaRail({ areas, mode, onChange, copy, projectionMode, onProjectionModeChange, showProjectionSwitch }) {
  const status = statusItemsForRail({ copy, projectionMode });
  return (
    <View style={styles.workAreaRail}>
      <View style={styles.railHeader}>
        <Text style={styles.railKicker}>Workspace</Text>
        <Text style={styles.railTitle}>{copy.modeMetric} Operations</Text>
        {showProjectionSwitch ? (
          <ProjectionModeSwitch
            value={projectionMode}
            onChange={onProjectionModeChange}
            compact
          />
        ) : null}
      </View>
      <View style={styles.railList}>
        {areas.filter((item) => !item.hidden).map((item) => (
          <WorkAreaButton
            key={item.key}
            item={item}
            active={mode === item.key}
            onPress={() => onChange(item.key)}
          />
        ))}
      </View>
      <View style={styles.statusPanel}>
        <Text style={styles.statusPanelKicker}>{status.title}</Text>
        <View style={styles.statusMetricGrid}>
          {status.items.map((item) => (
            <View key={item.label} style={styles.statusMetric}>
              <Text style={styles.statusMetricValue}>{item.value}</Text>
              <Text style={styles.statusMetricLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function MetricTile({ label, value, icon }) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricIcon}>
        <Ionicons name={icon} size={16} color={colors.brandBlue} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const FLEET_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_owner", label: "Needs Owner" },
  { key: "connected", label: "Connected Owners" },
  { key: "dealer", label: "Dealer Connected" },
  { key: "56ls", label: "56 LS" },
  { key: "39", label: "39 Series" },
];

function boatSearchText(boat) {
  return [
    boat?.asset_name,
    boat?.kac_id,
    boat?.identity?.hin,
    boat?.identity?.hull_number,
    boat?.identity?.year,
    boat?.identity?.make,
    boat?.identity?.model,
    boat?.dealer_relationship?.organization_name,
    boat?.oem_relationship?.organization_name,
    boat?.owner_relationship?.owner_name,
    boat?.template?.manufacturer,
    boat?.template?.model,
  ].filter(Boolean).join(" ").toLowerCase();
}

function fleetFilterMatchesBoat(boat, filter) {
  const state = String(boat?.activation?.status || boat?.owner_state || "").toLowerCase();
  const text = boatSearchText(boat);
  if (filter === "needs_owner") return state.includes("pending owner") || state.includes("unclaimed") || state.includes("owner unknown");
  if (filter === "connected") return Boolean(boat?.owner_relationship?.owner_name) || state.includes("activated") || state.includes("connected");
  if (filter === "dealer") return Boolean(boat?.dealer_relationship?.organization_name);
  if (filter === "56ls") return text.includes("56 ls") || text.includes("56ls");
  if (filter === "39") return text.includes("39 ls") || text.includes("39 le") || text.includes("39ls") || text.includes("39le");
  return true;
}

function imageContextLabelForBoat(boat, heroUri) {
  const rowHeroUri = heroUri || heroUriFromBoat(boat);
  if (rowHeroUri) return "Asset photo";
  return "Catalog image";
}

function FleetFilters({ value, onChange }) {
  return (
    <View style={styles.fleetFilterRow}>
      {FLEET_FILTERS.map((filter) => {
        const selected = value === filter.key;
        return (
          <TouchableOpacity
            key={filter.key}
            accessibilityRole="button"
            accessibilityLabel={`Filter ${filter.label}`}
            style={[styles.fleetFilterChip, selected && styles.fleetFilterChipActive]}
            onPress={() => onChange(filter.key)}
            activeOpacity={0.86}
          >
            <Text style={[styles.fleetFilterText, selected && styles.fleetFilterTextActive]}>{filter.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function BoatResultRow({ boat, onPress, heroUri = null }) {
  const dealer = boat?.dealer_relationship;
  const oem = boat?.oem_relationship;
  const activation = boat?.activation || {};
  const state = activation.status || boat?.owner_state || "in review";
  const tone = statusTone(state);
  const heroSource = heroSourceForBoat(boat, heroUri);
  const imageLabel = imageContextLabelForBoat(boat, heroUri);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${boat?.asset_name || "boat"}`}
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <ImageBackground source={heroSource} resizeMode="cover" style={styles.resultThumb} imageStyle={styles.resultThumbImage}>
        <View style={styles.resultImageBadge}>
          <Text style={styles.resultImageBadgeText}>{imageLabel}</Text>
        </View>
      </ImageBackground>
      <View style={styles.resultMain}>
        <View style={styles.resultTitleRow}>
          <View style={styles.resultTitleWrap}>
            <Text style={styles.resultTitle} numberOfLines={1}>{boat?.asset_name || "Untitled boat"}</Text>
            <Text style={styles.resultSubtitle} numberOfLines={1}>{titleForBoat(boat)}</Text>
          </View>
          <View style={[styles.statePill, styles[`statePill_${tone}`]]}>
            <Text style={[styles.statePillText, styles[`statePillText_${tone}`]]} numberOfLines={1}>
              {labelize(state)}
            </Text>
          </View>
        </View>
        <View style={styles.resultMetaGrid}>
          <View style={styles.resultMetaCell}>
            <Text style={styles.relationshipLabel}>Keepr Code</Text>
            <Text style={styles.relationshipValue} numberOfLines={1}>{boat?.kac_id || "Pending"}</Text>
          </View>
          <View style={styles.resultMetaCell}>
            <Text style={styles.relationshipLabel}>HIN</Text>
            <Text style={styles.relationshipValue} numberOfLines={1}>{boat?.identity?.hin || boat?.identity?.hull_number || "Not set"}</Text>
          </View>
          <View style={styles.resultMetaCell}>
            <Text style={styles.relationshipLabel}>Dealer</Text>
            <Text style={styles.relationshipValue} numberOfLines={1}>{dealer?.organization_name || "Not connected"}</Text>
          </View>
          <View style={styles.resultMetaCell}>
            <Text style={styles.relationshipLabel}>Builder</Text>
            <Text style={styles.relationshipValue} numberOfLines={1}>{oem?.organization_name || boat?.template?.manufacturer || "Not connected"}</Text>
          </View>
        </View>
      </View>
      <View style={styles.resultOpen}>
        <Text style={styles.openTwinText}>Open Keepr</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const CX_JOB_CARDS = [
  {
    key: "find",
    title: "Find a Boat / Owner",
    meta: "Global search",
    icon: "search-outline",
    mode: "fleet",
  },
  {
    key: "add",
    title: "Add Boat",
    meta: "Create or resolve",
    icon: "add-circle-outline",
    mode: "addBoat",
    addBoatMode: "create",
  },
  {
    key: "import",
    title: "Import Fleet",
    meta: "Factory and list work",
    icon: "cloud-upload-outline",
    mode: "builds",
  },
  {
    key: "needs-owner",
    title: "Needs Owner",
    meta: "Unclaimed handoffs",
    icon: "person-add-outline",
    mode: "addBoat",
    addBoatMode: "find",
  },
  {
    key: "connected",
    title: "Connected Owners",
    meta: "Active relationships",
    icon: "people-outline",
    mode: "fleet",
  },
  {
    key: "recent",
    title: "Recent / Needs Attention",
    meta: "Follow-up queue",
    icon: "notifications-outline",
    mode: "needs",
  },
];

function CxJobLanding({ counts, onSelect }) {
  return (
    <View style={styles.cxLanding}>
      <View style={styles.cxLandingHeader}>
        <View>
          <Text style={styles.sectionKicker}>CX workspace</Text>
          <Text style={styles.sectionTitle}>What job are you doing?</Text>
        </View>
        <View style={styles.commandBadge}>
          <Text style={styles.commandBadgeText}>{counts?.visible_boats || 0} boats</Text>
        </View>
      </View>
      <View style={styles.cxJobGrid}>
        {CX_JOB_CARDS.map((item) => (
          <TouchableOpacity
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={styles.cxJobCard}
            onPress={() => onSelect(item)}
            activeOpacity={0.86}
          >
            <View style={styles.cxJobIcon}>
              <Ionicons name={item.icon} size={18} color={colors.brandBlue} />
            </View>
            <View style={styles.cxJobText}>
              <Text style={styles.cxJobTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.cxJobMeta} numberOfLines={1}>{item.meta}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function BoatCard({ boat, onPress, view = "default", heroUri = null }) {
  const dealer = boat?.dealer_relationship;
  const oem = boat?.oem_relationship;
  const activation = boat?.activation || {};
  const state = activation.status || boat?.owner_state || "in review";
  const tone = statusTone(state);
  const isServiceView = view === "service";
  const roleLabel = dealer?.relationship_purpose || dealer?.relationship_type || "Service";
  const serviceStatus = dealer?.status || activation.status || boat?.owner_state || "Active";
  const heroSource = heroSourceForBoat(boat, heroUri);
  const imageLabel = imageContextLabelForBoat(boat, heroUri);

  return (
    <View style={styles.boatCard}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open ${boat?.asset_name || "boat"}`}
        onPress={onPress}
        activeOpacity={0.9}
      >
        <ImageBackground source={heroSource} resizeMode="cover" style={styles.cardImage} imageStyle={styles.cardImageAsset}>
        <View style={styles.cardShade}>
          <View style={styles.statusRibbon}>
            <Ionicons name="image-outline" size={13} color={colors.onPrimary} />
            <Text style={styles.statusRibbonText}>{imageLabel}</Text>
          </View>
        </View>
        </ImageBackground>
      </TouchableOpacity>

      <View style={styles.cardBody}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Open ${boat?.asset_name || "boat"}`}
          style={styles.cardHeader}
          onPress={onPress}
          activeOpacity={0.86}
        >
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle} numberOfLines={1}>{boat?.asset_name || "Untitled boat"}</Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>{titleForBoat(boat)}</Text>
          </View>
          <View style={[styles.statePill, styles[`statePill_${tone}`]]}>
            <Text style={[styles.statePillText, styles[`statePillText_${tone}`]]} numberOfLines={1}>
              {labelize(state)}
            </Text>
          </View>
        </TouchableOpacity>

        {isServiceView ? (
          <View style={styles.serviceRelationshipStrip}>
            <View style={styles.serviceRelationshipRow}>
              <View>
                <Text style={styles.relationshipLabel}>Relationship</Text>
                <Text style={styles.relationshipValue} numberOfLines={1}>
                  {labelize(roleLabel)}
                </Text>
              </View>
              <View>
                <Text style={styles.relationshipLabel}>Status</Text>
                <Text style={styles.relationshipValue} numberOfLines={1}>
                  {labelize(serviceStatus)}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Open service workspace for ${boat?.asset_name || "boat"}`}
              style={styles.serviceRelationshipOpen}
              onPress={onPress}
              activeOpacity={0.86}
            >
              <Text style={styles.serviceRelationshipOpenText}>Open service workspace</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Open digital twin for ${boat?.asset_name || "boat"}`}
              style={styles.identityStrip}
              onPress={onPress}
              activeOpacity={0.86}
            >
              <View>
                <Text style={styles.stripLabel}>Keepr Code</Text>
                <Text style={styles.stripValue} numberOfLines={1}>{boat?.kac_id || "Pending"}</Text>
              </View>
              <Text style={styles.openTwinText}>Open Digital Twin</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.relationshipGrid}>
              <View style={styles.relationshipCell}>
                <Text style={styles.relationshipLabel}>Builder</Text>
                <Text style={styles.relationshipValue} numberOfLines={1}>
                  {oem?.organization_name || boat?.template?.manufacturer || "Not connected"}
                </Text>
              </View>
              <View style={styles.relationshipCell}>
                <Text style={styles.relationshipLabel}>Dealer</Text>
                <Text style={styles.relationshipValue} numberOfLines={1}>
                  {dealer?.organization_name || "Not connected"}
                </Text>
              </View>
              <View style={styles.relationshipCellWide}>
                <Text style={styles.relationshipLabel}>Location</Text>
                <Text style={styles.relationshipValue} numberOfLines={1}>
                  {dealer?.location_name || compact([dealer?.location_city, dealer?.location_region]) || "Not set"}
                </Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function NetworkPanel({ data, copy, workspace }) {
  const kind = workspaceKind(workspace);
  const oemDealers = data?.oem_lens?.dealer_network || [];
  const dealerOems = data?.dealer_lens?.represented_oems || [];
  const locations = data?.dealer_lens?.locations || [];
  const items = kind === "dealer" ? dealerOems : oemDealers;

  return (
    <View style={styles.networkPanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>{copy.eyebrow}</Text>
          <Text style={styles.sectionTitle}>{copy.networkTitle}</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{kind === "dealer" ? dealerOems.length + locations.length : oemDealers.length}</Text>
          <Text style={styles.networkCountLabel}>connected</Text>
        </View>
      </View>
      <Text style={styles.networkText}>{copy.networkBody}</Text>
      <View style={styles.inlineChips}>
        {items.slice(0, 10).map((item) => (
          <View key={item.relationship_id} style={styles.smallChip}>
            <Text style={styles.smallChipText} numberOfLines={1}>
              {item.dealer_name || item.oem_name}
            </Text>
            <Text style={styles.smallChipMeta} numberOfLines={1}>
              {item.csi_recognition || labelize(item.status)}
            </Text>
          </View>
        ))}
        {kind === "dealer" ? locations.slice(0, 6).map((location) => (
          <View key={location.id} style={styles.smallChip}>
            <Text style={styles.smallChipText} numberOfLines={1}>{location.name}</Text>
            <Text style={styles.smallChipMeta} numberOfLines={1}>
              {compact([location.city, location.region]) || "Location"}
            </Text>
          </View>
        )) : null}
      </View>
    </View>
  );
}

function modelLifecycleStatus(template) {
  const raw = template?.metadata?.lifecycle_status || template?.metadata?.lifecycle || template?.lifecycle_status;
  if (raw) return String(raw).toLowerCase();
  const year = Number(template?.model_year);
  if (Number.isFinite(year) && year < 2027) return "previous";
  return "active";
}

function modelDefinitionStatus(template) {
  const raw =
    template?.metadata?.definition_status ||
    template?.definition_status ||
    template?.publish_status ||
    template?.status;
  return raw ? String(raw).toLowerCase() : "published";
}

function CatalogCard({ template, templateMedia, onPress, draft, sourceReview, onOpenDraft, onOpenSourceReview }) {
  const stats = template?.metadata?.hero_specs || {};
  const fallbackStats = fallbackTemplateStats(template);
  const heroMedia = templateMedia?.hero || heroMediaFromTemplate(template);
  const imageSource = mediaAsset(heroMedia);
  const imageLabel = heroMedia ? "Model media" : "Needs model hero";
  const lifecycle = modelLifecycleStatus(template);
  const definitionStatus = modelDefinitionStatus(template);
  return (
    <TouchableOpacity style={styles.catalogCard} onPress={onPress} activeOpacity={0.9}>
      {imageSource ? (
      <ImageBackground source={imageSource} resizeMode="cover" style={styles.catalogImage} imageStyle={styles.catalogImageAsset}>
        <View style={styles.catalogShade}>
          <View style={styles.catalogBadge}>
            <Ionicons name="library-outline" size={13} color={colors.onPrimary} />
            <Text style={styles.catalogBadgeText}>{imageLabel}</Text>
          </View>
        </View>
      </ImageBackground>
      ) : (
        <View style={[styles.catalogImage, styles.catalogImageEmpty]}>
          <View style={styles.catalogBadge}>
            <Ionicons name="image-outline" size={13} color={colors.onPrimary} />
            <Text style={styles.catalogBadgeText}>{imageLabel}</Text>
          </View>
        </View>
      )}
      <View style={styles.catalogBody}>
        <Text style={styles.catalogKicker}>{template.organization_name || template.manufacturer}</Text>
        <Text style={styles.catalogTitle} numberOfLines={1}>
          MY{template.model_year} {template.manufacturer} {template.model}
        </Text>
        <View style={styles.catalogStatusRow}>
          <View style={[styles.catalogStatusPill, styles[`catalogStatus_${lifecycle}`] || null]}>
            <Text style={styles.catalogStatusText}>{labelize(lifecycle)}</Text>
          </View>
          <View style={styles.catalogStatusPill}>
            <Text style={styles.catalogStatusText}>{labelize(definitionStatus)}</Text>
          </View>
          {draft ? (
            <View style={[styles.catalogStatusPill, styles.catalogStatus_review]}>
              <Text style={styles.catalogStatusText}>source draft</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.catalogText} numberOfLines={2}>
          Reusable model page with media, specs, options, systems, care, resources, and exact-build entry.
        </Text>
        <View style={styles.catalogSpecs}>
          <Text style={styles.catalogSpec}>{stats.loa || fallbackStats.loa} LOA</Text>
          <Text style={styles.catalogSpec}>{stats.beam || fallbackStats.beam} Beam</Text>
          <Text style={styles.catalogSpec}>{stats.max_hp || fallbackStats.max_hp}</Text>
        </View>
        <View style={styles.catalogFooter}>
          <Text style={styles.catalogFooterText}>Open model</Text>
          <View style={styles.catalogFooterActions}>
            {draft ? (
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.catalogActionButton}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onOpenDraft?.(draft);
                }}
              >
                <Text style={styles.catalogActionText}>Review draft</Text>
              </TouchableOpacity>
            ) : null}
            {sourceReview ? (
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.catalogActionButton}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onOpenSourceReview?.(template);
                }}
              >
                <Text style={styles.catalogActionText}>Source review</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function CatalogPanel({
  templates,
  templateMediaById = {},
  loading,
  onOpen,
  onOpenSourceReview,
  query = "",
  canAuthor = false,
  modelDraft,
  onModelDraftChange,
  onCreateModel,
  creatingModel = false,
}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const matchesModelQuery = (template) => {
    if (!normalizedQuery) return true;
    const stats = template?.metadata?.hero_specs || {};
    const fallbackStats = fallbackTemplateStats(template);
    const searchableText = [
      template?.template_key,
      template?.manufacturer,
      template?.organization_name,
      template?.model,
      template?.model_year,
      template?.series,
      modelLifecycleStatus(template),
      modelDefinitionStatus(template),
      stats.loa || fallbackStats.loa,
      stats.beam || fallbackStats.beam,
      stats.max_hp || fallbackStats.max_hp,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedQuery);
  };
  const visibleTemplates = templates.filter(matchesModelQuery);
  const lifecycleCounts = visibleTemplates.reduce((counts, template) => {
    const lifecycle = modelLifecycleStatus(template);
    counts[lifecycle] = (counts[lifecycle] || 0) + 1;
    return counts;
  }, {});
  const reviewCount = visibleTemplates.filter((template) => {
    const status = modelDefinitionStatus(template);
    return status === "draft" || status === "review";
  }).length;
  const publishedCount = visibleTemplates.filter((template) => modelDefinitionStatus(template) === "published").length;

  return (
    <View style={styles.catalogPanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>OEM Catalog</Text>
          <Text style={styles.sectionTitle}>Product lineage</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{visibleTemplates.length}</Text>
          <Text style={styles.networkCountLabel}>models</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        Current, previous, and retired model years live here as reusable OEM model pages. Open a model to review it, edit its Keepr definition, or build an exact boat from it.
      </Text>
      {canAuthor ? (
        <View style={styles.createModelPanel}>
          <View>
            <Text style={styles.newBuildKicker}>Create Model</Text>
            <Text style={styles.newBuildTitle}>Add a reusable model template</Text>
          </View>
          <View style={styles.createModelGrid}>
            <TextInput
              value={modelDraft?.manufacturer || ""}
              onChangeText={(value) => onModelDraftChange?.({ ...modelDraft, manufacturer: value })}
              placeholder="Manufacturer"
              placeholderTextColor={colors.textMuted}
              style={styles.createModelInput}
            />
            <TextInput
              value={modelDraft?.model || ""}
              onChangeText={(value) => onModelDraftChange?.({ ...modelDraft, model: value })}
              placeholder="Model"
              placeholderTextColor={colors.textMuted}
              style={styles.createModelInput}
            />
            <TextInput
              value={modelDraft?.modelYear || ""}
              onChangeText={(value) => onModelDraftChange?.({ ...modelDraft, modelYear: value.replace(/[^0-9]/g, "").slice(0, 4) })}
              placeholder="Model year"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              style={styles.createModelInput}
            />
            <TouchableOpacity
              style={[styles.createModelButton, creatingModel && styles.profileSaveButtonDisabled]}
              onPress={onCreateModel}
              disabled={creatingModel}
              activeOpacity={0.86}
            >
              {creatingModel ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="add-circle-outline" size={16} color={colors.onPrimary} />}
              <Text style={styles.createModelButtonText}>{creatingModel ? "Creating" : "Create"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View style={styles.catalogFilterGroups}>
        <View style={styles.catalogFilterGroup}>
          <Text style={styles.catalogFilterLabel}>Lifecycle</Text>
          <View style={styles.catalogStageRow}>
            <View style={styles.catalogStageChip}>
              <Text style={styles.catalogStageValue}>{lifecycleCounts.active || 0}</Text>
              <Text style={styles.catalogStageLabel}>Active</Text>
            </View>
            <View style={styles.catalogStageChip}>
              <Text style={styles.catalogStageValue}>{lifecycleCounts.previous || 0}</Text>
              <Text style={styles.catalogStageLabel}>Previous</Text>
            </View>
            <View style={styles.catalogStageChip}>
              <Text style={styles.catalogStageValue}>{lifecycleCounts.retired || 0}</Text>
              <Text style={styles.catalogStageLabel}>Retired</Text>
            </View>
          </View>
        </View>
        <View style={styles.catalogFilterGroup}>
          <Text style={styles.catalogFilterLabel}>Keepr definition</Text>
          <View style={styles.catalogStageRow}>
            <View style={styles.catalogStageChip}>
              <Text style={styles.catalogStageValue}>{publishedCount}</Text>
              <Text style={styles.catalogStageLabel}>Published</Text>
            </View>
            <View style={styles.catalogStageChip}>
              <Text style={styles.catalogStageValue}>{reviewCount}</Text>
              <Text style={styles.catalogStageLabel}>Draft/review</Text>
            </View>
          </View>
        </View>
      </View>
      {loading ? (
        <View style={styles.centeredSmall}>
          <ActivityIndicator color={colors.brandBlue} />
        </View>
      ) : visibleTemplates.length ? (
        <>
          {visibleTemplates.length ? (
            <View style={styles.catalogGrid}>
              {visibleTemplates.map((template) => (
                <CatalogCard
                  key={template.id}
                  template={template}
                  templateMedia={templateMediaById[template.id]}
                  onPress={() => onOpen(template)}
                  sourceReview={modelDefinitionStatus(template) === "draft"}
                  onOpenSourceReview={onOpenSourceReview}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.mutedTextLeft}>
          {normalizedQuery ? "No models match that search." : "No models are in this organization's catalog yet."}
        </Text>
      )}
    </View>
  );
}

function exactDraftQueueRow(draft) {
  const identifierParts = compact([
    draft?.draft_key ? `Draft ${draft.draft_key}` : null,
    draft?.identifier || null,
    draft?.selected_count !== undefined && draft?.selected_count !== null ? `${draft.selected_count} selected` : null,
  ]);

  return {
    key: `exact-draft-${draft.id || draft.draft_key}`,
    model: draft.model || draft.display_name || "Exact build draft",
    identifier: identifierParts || "Saved exact-build draft",
    state: draft.status === "factory_frozen" ? "Factory Frozen" : draft.status === "in_review" ? "In Review" : "Draft",
    action: draft.status === "factory_frozen" ? "Open" : "Continue Draft",
    templateKey: draft.template_key,
    draftId: draft.id,
    draftKey: draft.draft_key,
    source: "exact_build_draft",
  };
}

function ProductionBuildsPanel({ templates, loading, drafts = [], onBuild, onOpenDraft, workspaceKindValue, onOpenAsset, onAddBoat }) {
  const isDealerLike = workspaceKindValue === "dealer" || workspaceKindValue === "pro";
  if (isDealerLike) {
    const primaryBrands = WILSON_REPRESENTED_BRANDS.slice(0, 8);
    const bennington = WILSON_REPRESENTED_BRANDS.find((brand) => brand.name === "Bennington");
    return (
      <View style={styles.productionPanel}>
        <View style={styles.networkHeader}>
          <View>
            <Text style={styles.sectionKicker}>Sales Intake</Text>
            <Text style={styles.sectionTitle}>Start with the exact boat</Text>
          </View>
          <View style={styles.networkCount}>
            <Text style={styles.networkCountValue}>1</Text>
            <Text style={styles.networkCountLabel}>connected</Text>
          </View>
        </View>
        <Text style={styles.networkText}>
          Wilson does not build from a manufacturer catalog here. Wilson finds or creates the exact boat from inventory, a sales record, a build sheet, or an owner connection.
        </Text>
        <View style={styles.dealerSimpleGrid}>
          <View style={styles.dealerSimpleCard}>
            <View>
              <Text style={styles.newBuildKicker}>Brands Wilson Carries</Text>
              <Text style={styles.newBuildTitle}>
                {bennington?.inventoryCount ? `${bennington.inventoryCount} new Bennington boats in inventory` : "Brand context only"}
              </Text>
            </View>
            <View style={styles.simpleBrandRow}>
              {primaryBrands.map((brand) => (
                <View key={brand.name} style={[styles.simpleBrandPill, brand.name === "Bennington" && styles.simpleBrandPillFeatured]}>
                  <Text style={styles.simpleBrandPillText}>{brand.name}</Text>
                  <Text style={styles.simpleBrandPillMeta}>
                    {brand.inventoryCount !== null && brand.inventoryCount !== undefined
                      ? `${brand.inventoryCount} ${brand.name === "Bennington" ? "new" : "in stock"}`
                      : brand.inventoryState}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.dealerSimpleCard}>
            <View>
              <Text style={styles.newBuildKicker}>Add a Boat</Text>
              <Text style={styles.newBuildTitle}>Resolve before create</Text>
              <Text style={styles.simpleCardText}>
                Search by Keepr Code, HIN, stock number, or owner context. Create only when Keepr cannot find the boat.
              </Text>
            </View>
            <TouchableOpacity style={styles.buildQueueButton} onPress={onAddBoat} activeOpacity={0.86}>
              <Ionicons name="search-outline" size={15} color={colors.onPrimary} />
              <Text style={styles.buildQueueButtonText}>Find or Add Boat</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.currentBuildsPanel}>
          <View style={styles.currentBuildsHeader}>
            <View>
              <Text style={styles.sectionKicker}>Connected Boats</Text>
              <Text style={styles.sectionTitle}>Exact boats Wilson can work on</Text>
            </View>
            <Text style={styles.currentBuildsCount}>1</Text>
          </View>
          <View style={styles.buildQueue}>
            {DEALER_INTAKE_EXAMPLES.slice(0, 1).map((item) => {
              const tone = statusTone(item.state);
              return (
                <View key={item.key} style={styles.buildQueueRow}>
                  <View style={styles.buildQueueIcon}>
                    <Ionicons name="boat-outline" size={18} color={colors.brandBlue} />
                  </View>
                  <View style={styles.buildQueueText}>
                    <View style={styles.buildQueueTitleRow}>
                      <Text style={styles.buildQueueTitle}>{item.model}</Text>
                      <View style={[styles.statePill, styles[`statePill_${tone}`]]}>
                        <Text style={[styles.statePillText, styles[`statePillText_${tone}`]]}>{item.state}</Text>
                      </View>
                    </View>
                    <Text style={styles.buildQueueMeta}>{item.identifier}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.buildQueueButton}
                    onPress={() => {
                      if (item.assetId && onOpenAsset) {
                        onOpenAsset({ asset_id: item.assetId, kac_id: item.kac });
                      } else if (onAddBoat) {
                        onAddBoat();
                      }
                    }}
                    activeOpacity={0.86}
                  >
                    <Ionicons name={item.assetId ? "open-outline" : "add-circle-outline"} size={15} color={colors.onPrimary} />
                    <Text style={styles.buildQueueButtonText}>{item.action}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  const draftRows = (Array.isArray(drafts) ? drafts : []).map(exactDraftQueueRow);
  const buildRows = draftRows;

  return (
    <View style={styles.productionPanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>Configure Hulls</Text>
          <Text style={styles.sectionTitle}>Start and continue exact builds</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{buildRows.length}</Text>
          <Text style={styles.networkCountLabel}>in progress</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        Builders create new KACs from the customized OEM catalog, configure exact hull options, assign HIN/build details, then freeze the factory layer for dealer assignment.
      </Text>
      <View style={styles.layerMap}>
        {[
          ["Model Catalog", `${templates.length} templates`],
          ["Exact Builds", `${buildRows.length} drafts`],
          ["Digital Twin", "Operational assets"],
        ].map(([label, value]) => (
          <View key={label} style={styles.layerMapItem}>
            <Text style={styles.layerMapLabel}>{label}</Text>
            <Text style={styles.layerMapValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.newBuildCatalog}>
        <View style={styles.newBuildHeader}>
          <View>
            <Text style={styles.newBuildKicker}>Start New Build</Text>
            <Text style={styles.newBuildTitle}>Configure from this catalog</Text>
          </View>
          <View style={styles.newBuildCount}>
            <Text style={styles.newBuildCountValue}>{templates.length}</Text>
            <Text style={styles.newBuildCountLabel}>models</Text>
          </View>
        </View>
        {templates.length ? (
          <View style={styles.modelList}>
            {templates.map((template) => (
              <TouchableOpacity
                key={template.id || template.template_key}
                activeOpacity={0.86}
                onPress={() => onBuild(template)}
                style={[styles.modelOption, styles.modelOptionReady]}
              >
                <Text style={[styles.modelOptionText, styles.modelOptionTextReady]}>
                  MY{template.model_year} {template.manufacturer} {template.model}
                </Text>
                <Text style={[styles.modelOptionState, styles.modelOptionStateReady]}>
                  Start build
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.mutedTextLeft}>Create a model before starting exact builds.</Text>
        )}
      </View>
      <View style={styles.stageStrip}>
        {["Template", "OEM Build", "Factory Frozen", "Dealer Assigned", "Dealer Prep", "Owner Ready", "Activated"].map((stage, index) => (
          <View key={stage} style={styles.stageItem}>
            <View style={[styles.stageDot, index === 1 && styles.stageDotActive]} />
            <Text style={[styles.stageText, index === 1 && styles.stageTextActive]}>{stage}</Text>
          </View>
        ))}
      </View>
      <View style={styles.currentBuildsPanel}>
        <View style={styles.currentBuildsHeader}>
          <View>
            <Text style={styles.sectionKicker}>Current Builds</Text>
            <Text style={styles.sectionTitle}>Builds in progress</Text>
          </View>
          <Text style={styles.currentBuildsCount}>{buildRows.length}</Text>
        </View>
        {loading ? (
          <View style={styles.centeredSmall}>
            <ActivityIndicator color={colors.brandBlue} />
          </View>
        ) : (
          <View style={styles.buildQueue}>
            {buildRows.length ? buildRows.map((build) => {
              const template = templates.find((item) => item.template_key === build.templateKey) || { template_key: build.templateKey };
              const tone = statusTone(build.state);
              return (
                <View key={build.key} style={styles.buildQueueRow}>
                  <View style={styles.buildQueueIcon}>
                    <Ionicons name="boat-outline" size={18} color={colors.brandBlue} />
                  </View>
                  <View style={styles.buildQueueText}>
                    <View style={styles.buildQueueTitleRow}>
                      <Text style={styles.buildQueueTitle}>{build.model}</Text>
                      <View style={[styles.statePill, styles[`statePill_${tone}`]]}>
                        <Text style={[styles.statePillText, styles[`statePillText_${tone}`]]}>{build.state}</Text>
                      </View>
                    </View>
                    <Text style={styles.buildQueueMeta}>{build.identifier}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.buildQueueButton}
                    onPress={() => onBuild({
                      ...template,
                      template_key: template.template_key,
                      buildKey: build.buildKey || null,
                      hullNumber: build.hullNumber || null,
                      draftId: build.draftId || null,
                      draftKey: build.draftKey || null,
                    })}
                    activeOpacity={0.86}
                  >
                    <Ionicons name="construct-outline" size={15} color={colors.onPrimary} />
                    <Text style={styles.buildQueueButtonText}>{build.action}</Text>
                  </TouchableOpacity>
                  {build.assetId && onOpenAsset ? (
                    <TouchableOpacity
                      style={styles.buildQueueSecondaryButton}
                      onPress={() => onOpenAsset({ asset_id: build.assetId, kac_id: build.kac })}
                      activeOpacity={0.86}
                    >
                      <Ionicons name="boat-outline" size={15} color={colors.brandBlue} />
                      <Text style={styles.buildQueueSecondaryButtonText}>Open Digital Twin</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            }) : (
              <Text style={styles.mutedTextLeft}>No exact builds are in progress for this organization yet.</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function BrandProfilePanel({
  profile,
  kind,
  onChange,
  onPickLogo,
  onPickHeader,
  onSave,
  saving = false,
  uploadingLogo = false,
  uploadingHeader = false,
}) {
  const isDealer = kind === "dealer";
  const isPro = kind === "pro";
  const canUseMarineFallback = (isDealer || isPro) && !profile.headerImageUri;
  const previewChildren = (
    <View style={styles.oemPreviewShade}>
      <View style={styles.oemPreviewLogo}>
        {profile.logoUri ? (
          <Image source={{ uri: profile.logoUri }} resizeMode="contain" style={styles.oemPreviewLogoImage} />
        ) : (
          <Text style={styles.dealerLogoFallback}>{initialsForName(profile.displayName)}</Text>
        )}
      </View>
      <View style={styles.oemPreviewCopy}>
        <Text style={styles.oemPreviewKicker}>{isDealer ? "KeeprDealer Identity" : isPro ? "KeeprPro Identity" : "KeeprOEM Identity"}</Text>
        <Text style={styles.oemPreviewTitle}>{profile.displayName}</Text>
        <Text style={styles.oemPreviewText}>{profile.shortDescription}</Text>
      </View>
    </View>
  );
  const fields = [
    ["displayName", "Brand name"],
    ["location", isDealer ? "Primary location" : isPro ? "Primary service location" : "Headquarters"],
    ["website", "Website"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["serviceOfferings", isPro ? "Service offerings" : "Capabilities"],
    ["packages", "Packages / playbooks"],
    ["shortDescription", "Short description"],
    ["publicDescription", "Public description"],
  ];

  return (
    <View style={styles.oemProfilePanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>{isDealer ? "Dealer Mode" : isPro ? "KeeprPro Mode" : "OEM Mode"}</Text>
          <Text style={styles.sectionTitle}>{isDealer ? "Dealer profile builder" : isPro ? "KeeprSpace profile" : "Brand profile builder"}</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{profile.profileStatus}</Text>
          <Text style={styles.networkCountLabel}>status</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        {isDealer
          ? "This is the dealer equivalent of Pro Mode: SkipperBud's configures the sales, delivery, location, and service identity owners will see after activation."
          : isPro
          ? "This is the production KeeprPro identity inside the new KeeprSpace shell: claimed profile, public service presence, locations, offerings, and owner-facing service context."
          : "This is the OEM equivalent of Pro Mode: the organization configures the customer-facing brand presence that flows into dealer and owner projections."}
      </Text>

      <View style={styles.oemPreviewHero}>
        {profile.headerImageUri || canUseMarineFallback ? (
          <ImageBackground
            source={profile.headerImageUri ? { uri: profile.headerImageUri } : BOAT_HERO}
            resizeMode="cover"
            style={styles.oemPreviewCover}
            imageStyle={styles.oemPreviewCoverImage}
          >
            {previewChildren}
          </ImageBackground>
        ) : (
          <View style={[styles.oemPreviewCover, styles.brandPreviewEmpty]}>
            {previewChildren}
          </View>
        )}
      </View>

      <View style={styles.oemUploadGrid}>
        <TouchableOpacity style={styles.oemUploadTile} activeOpacity={0.86} onPress={onPickLogo}>
          {uploadingLogo ? (
            <ActivityIndicator size="small" color={colors.brandBlue} />
          ) : profile.logoUri ? (
            <Image source={{ uri: profile.logoUri }} resizeMode="contain" style={styles.oemUploadLogoPreview} />
          ) : (
            <Ionicons name="image-outline" size={24} color={colors.brandBlue} />
          )}
          <Text style={styles.oemUploadTitle}>{uploadingLogo ? "Uploading logo..." : "Profile photo / logo"}</Text>
          <Text style={styles.oemUploadText}>
            {profile.logoUri
              ? "Logo is selected. Save the profile to make it persistent."
              : isDealer ? "Updates the dealer mark shown in sales, service, and owner portal projections." : isPro ? "Updates the service mark shown in service relationships and owner requests." : "Updates the OEM mark shown across Activator projections."}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.oemUploadTileWide} activeOpacity={0.86} onPress={onPickHeader}>
          {uploadingHeader ? (
            <ActivityIndicator size="small" color={colors.brandBlue} />
          ) : profile.headerImageUri ? (
            <Image source={{ uri: profile.headerImageUri }} resizeMode="cover" style={styles.oemUploadHeaderPreview} />
          ) : (
            <Ionicons name="images-outline" size={24} color={colors.brandBlue} />
          )}
          <Text style={styles.oemUploadTitle}>{uploadingHeader ? "Uploading header..." : "Header image"}</Text>
          <Text style={styles.oemUploadText}>
            {profile.headerImageUri
              ? "Header is selected. Save the profile to make it persistent."
              : isDealer ? "Sets the visual dealer header for Dealer Mode, locations, delivery prep, and service portal previews." : isPro ? "Sets the service profile header owners see when they request support or view the relationship." : "Sets the visual brand header for OEM Mode and downstream profile previews."}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.oemFormGrid}>
        {fields.map(([key, label]) => (
          <View key={key} style={key === "publicDescription" ? styles.oemFieldWide : styles.oemField}>
            <Text style={styles.oemFieldLabel}>{label}</Text>
            <TextInput
              value={profile[key]}
              onChangeText={(value) => onChange({ ...profile, [key]: value })}
              multiline={key === "publicDescription"}
              style={[styles.oemInput, key === "publicDescription" && styles.oemTextArea]}
              placeholder={label}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        ))}
      </View>

      <View style={styles.oemFlowCard}>
        <Ionicons name="git-network-outline" size={18} color={colors.brandBlue} />
        <View style={styles.oemFlowCopy}>
          <Text style={styles.oemFlowTitle}>What this unlocks next</Text>
          <Text style={styles.oemFlowText}>
            {isDealer
              ? "Dealer profile identity becomes the brand layer behind sales activation, delivery prep, locations, service continuity, owner portal actions, and future public dealer pages."
              : isPro
              ? "KeeprSpace profile identity becomes the brand layer behind the Wilson portfolio, owner service requests, relationship threads, work history, and future customer activation."
              : "OEM profile identity becomes the brand layer behind catalog templates, exact hull activations, dealer-network views, owner handoff, and future public OEM pages."}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.profileSaveButton, (!onSave || saving) && styles.profileSaveButtonDisabled]}
        activeOpacity={0.86}
        disabled={!onSave || saving}
        onPress={onSave}
      >
        {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="save-outline" size={16} color={colors.onPrimary} />}
        <Text style={styles.profileSaveButtonText}>{saving ? "Saving..." : "Save KeeprSpace Profile"}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function KeeprSpaceAdminPanel({
  profile,
  kind,
  config,
  activeTab,
  onTabChange,
  onChangeProfile,
  onPickLogo,
  onPickHeader,
  onSaveProfile,
  onSaveLocation,
  onSaveTeam,
  onSaveAssignment,
  onSaveService,
  onSaveCapabilities,
  onSaveRelationship,
  savingProfile = false,
  savingKey = null,
  uploadingLogo = false,
  uploadingHeader = false,
  loading = false,
}) {
  const [locationDraft, setLocationDraft] = useState({
    name: "",
    location_type: "showroom",
    address_line1: "",
    city: "",
    region: "",
    postal_code: "",
    phone: "",
    status: "active",
  });
  const [teamDraft, setTeamDraft] = useState({ name: "", team_type: "", description: "", status: "active" });
  const [serviceDraft, setServiceDraft] = useState({
    name: "",
    service_type: "",
    asset_system_type: "boat",
    brand_applicability: "",
    interval_trigger: "",
    service_items: "",
    owner_facing_label: "",
    owner_facing_description: "",
    status: "active",
    relationship_purposes: "service",
    supported_asset_types: "boat",
  });
  const [assignmentDraft, setAssignmentDraft] = useState({
    user_id: "",
    org_team_id: "",
    org_location_id: "",
    assignment_role: "",
    is_primary: false,
    status: "active",
  });
  const [brandDraft, setBrandDraft] = useState({
    to_org_name: "",
    relationship_type: "represented_brand",
    status: "source_reported",
    authority_state: "public_source_reported",
    evidence_state: "public_source_reported",
    source_type: "org_reported",
    source_name: "",
    source_url: "",
  });
  const [capabilitiesDraft, setCapabilitiesDraft] = useState("");

  useEffect(() => {
    const orgCapabilities = config?.organization?.workspace_capabilities || config?.organization?.capabilities || [];
    setCapabilitiesDraft(Array.isArray(orgCapabilities) ? orgCapabilities.join(", ") : "");
  }, [config?.organization?.workspace_capabilities, config?.organization?.capabilities]);

  const members = config?.members || [];
  const locations = config?.locations || [];
  const teams = config?.teams || [];
  const assignments = config?.member_assignments || [];
  const services = (config?.service_offerings || []).map((service) => {
    const template = service.metadata?.service_template || service.metadata || {};
    const serviceItems = template.service_items || template.checklist_items || service.service_items || [];
    return {
      ...service,
      asset_system_type: service.asset_system_type || template.asset_system_type || "",
      brand_applicability: service.brand_applicability || template.brand_applicability || "",
      interval_trigger: service.interval_trigger || template.interval_trigger || "",
      service_items: Array.isArray(serviceItems)
        ? serviceItems.map((item) => item?.label || item?.title || item?.name || item).filter(Boolean).join("\n")
        : "",
      template_kind: service.template_kind || template.template_kind || "service_action_template",
    };
  });
  const relationships = config?.brand_relationships || [];

  const saveLocation = () => onSaveLocation?.(locationDraft);
  const saveTeam = () => onSaveTeam?.(teamDraft);
  const saveAssignment = () => onSaveAssignment?.(assignmentDraft);
  const saveService = () => onSaveService?.({
    ...serviceDraft,
    template_kind: serviceDraft.template_kind || "service_action_template",
    relationship_purposes: listFromValue(serviceDraft.relationship_purposes),
    supported_asset_types: listFromValue(serviceDraft.supported_asset_types),
    service_items: String(serviceDraft.service_items || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
  });
  const saveBrand = () => onSaveRelationship?.(brandDraft);
  const editAssignment = (assignment) => setAssignmentDraft({
    id: assignment.id || "",
    user_id: assignment.user_id || "",
    org_team_id: assignment.org_team_id || "",
    org_location_id: assignment.org_location_id || "",
    assignment_role: assignment.assignment_role || "",
    is_primary: Boolean(assignment.is_primary),
    status: assignment.status || "active",
  });
  const editBrand = (relationship) => setBrandDraft({
    ...relationship,
    to_org_name: relationship.to_org_name || relationship.org?.name || relationship.related_org_name || relationship.to_org_id || "",
    relationship_type: relationship.relationship_type || "represented_brand",
    status: relationship.status || "source_reported",
    authority_state: relationship.authority_state || "public_source_reported",
    evidence_state: relationship.evidence_state || "public_source_reported",
    source_type: relationship.source_type || "org_reported",
    source_name: relationship.source_name || "",
    source_url: relationship.source_url || "",
  });
  const editService = (service) => setServiceDraft({
    ...service,
    relationship_purposes: textFromListValue(service.relationship_purposes),
    supported_asset_types: textFromListValue(service.supported_asset_types),
    service_items: textFromLineListValue(service.service_items),
  });
  const archiveLocation = (location) => confirmAdminChange(
    "Archive location",
    `Archive ${location.name || "this location"}? Existing history and relationships will remain intact.`,
    () => onSaveLocation?.({ ...location, status: "archived" }),
  );
  const archiveTeam = (team) => confirmAdminChange(
    "Archive team",
    `Archive ${team.name || "this team"}? Existing assignments and history will remain intact.`,
    () => onSaveTeam?.({ ...team, status: "archived" }),
  );
  const archiveService = (service) => confirmAdminChange(
    "Deactivate service",
    `Deactivate ${service.owner_facing_label || service.name || "this service"}? It will stop appearing as an active Playbook service, but existing Actions will remain intact.`,
    () => onSaveService?.({
      ...service,
      status: "archived",
      relationship_purposes: listFromValue(service.relationship_purposes),
      supported_asset_types: listFromValue(service.supported_asset_types),
      service_items: listFromValue(textFromLineListValue(service.service_items).replace(/\n/g, ",")),
    }),
  );
  const activateService = (service) => onSaveService?.({
    ...service,
    status: "active",
    relationship_purposes: listFromValue(service.relationship_purposes),
    supported_asset_types: listFromValue(service.supported_asset_types),
    service_items: listFromValue(textFromLineListValue(service.service_items).replace(/\n/g, ",")),
  });
  const serviceIsActive = (service) => String(service.status || "active").toLowerCase() === "active";
  const serviceStatusLabel = (service) => serviceIsActive(service) ? "ACTIVE" : "INACTIVE";
  const removeAssignment = (assignment) => confirmAdminChange(
    "Remove assignment",
    "Remove this team/location assignment? The member will remain in the organization.",
    () => onSaveAssignment?.({ ...assignment, status: "inactive" }),
  );
  const disconnectBrand = (relationship) => confirmAdminChange(
    "Disconnect relationship",
    `Disconnect ${relationship.org?.name || relationship.to_org_name || relationship.related_org_name || "this organization"} from this KeeprSpace? The canonical organization will not be deleted.`,
    () => onSaveRelationship?.({ ...relationship, status: "inactive" }),
  );

  const resetLocation = () => setLocationDraft({
    name: "",
    location_type: "showroom",
    address_line1: "",
    city: "",
    region: "",
    postal_code: "",
    phone: "",
    status: "active",
  });
  const resetTeam = () => setTeamDraft({ name: "", team_type: "", description: "", status: "active" });
  const resetAssignment = () => setAssignmentDraft({
    user_id: "",
    org_team_id: "",
    org_location_id: "",
    assignment_role: "",
    is_primary: false,
    status: "active",
  });
  const resetService = () => setServiceDraft({
    name: "",
    service_type: "",
    asset_system_type: "boat",
    brand_applicability: "",
    interval_trigger: "",
    service_items: "",
    owner_facing_label: "",
    owner_facing_description: "",
    status: "active",
    relationship_purposes: "service",
    supported_asset_types: "boat",
  });
  const resetBrand = () => setBrandDraft({
    to_org_name: "",
    relationship_type: "represented_brand",
    status: "source_reported",
    authority_state: "public_source_reported",
    evidence_state: "public_source_reported",
    source_type: "org_reported",
    source_name: "",
    source_url: "",
  });

  return (
    <View style={styles.oemProfilePanel}>
      <View style={styles.adminTabs}>
        {KEEPRSPACE_ADMIN_TABS.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.adminTab, selected && styles.adminTabActive]}
              activeOpacity={0.86}
              onPress={() => onTabChange(tab.key)}
            >
              <Ionicons name={tab.icon} size={15} color={selected ? colors.onPrimary : colors.textSecondary} />
              <Text style={[styles.adminTabText, selected && styles.adminTabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.brandBlue} />
          <Text style={styles.mutedText}>Loading organization configuration...</Text>
        </View>
      ) : activeTab === "profile" ? (
        <BrandProfilePanel
          profile={profile}
          kind={kind}
          onChange={onChangeProfile}
          onPickLogo={onPickLogo}
          onPickHeader={onPickHeader}
          onSave={onSaveProfile}
          saving={savingProfile}
          uploadingLogo={uploadingLogo}
          uploadingHeader={uploadingHeader}
        />
      ) : activeTab === "locations" ? (
        <AdminSection
          kicker="Org Locations"
          title="Locations"
          count={locations.length}
          description="One canonical organization can operate through many physical places. Asset relationships can point to the org and, when needed, one of these locations."
        >
          <View style={styles.adminList}>
            {locations.map((location) => (
              <View key={location.id || location.name} style={styles.adminRow}>
                <TouchableOpacity style={styles.adminRowContent} activeOpacity={0.86} onPress={() => setLocationDraft({ ...location })}>
                  <Text style={styles.adminRowTitle}>{location.name}</Text>
                  <Text style={styles.adminRowMeta}>{[location.location_type, location.city, location.region].filter(Boolean).join(" · ") || "Location"}</Text>
                </TouchableOpacity>
                <View style={styles.adminRowActions}>
                  <Text style={styles.adminStatus}>{location.status || "active"}</Text>
                  <AdminRowActions onEdit={() => setLocationDraft({ ...location })} onArchive={() => archiveLocation(location)} />
                </View>
              </View>
            ))}
          </View>
          <ConfigForm
            title={locationDraft.id ? "Edit location" : "Add location"}
            fields={[
              ["name", "Location name"],
              ["location_type", "Type"],
              ["address_line1", "Address"],
              ["city", "City"],
              ["region", "State / region"],
              ["postal_code", "Postal code"],
              ["phone", "Phone"],
              ["status", "Status"],
            ]}
            draft={locationDraft}
            onChange={setLocationDraft}
            onSave={saveLocation}
            onReset={resetLocation}
            saving={savingKey === "location"}
          />
        </AdminSection>
      ) : activeTab === "members" ? (
        <AdminSection
          kicker="Org Members"
          title="Members"
          count={members.length}
          description="Members come from canonical org membership. Team and location assignments layer on top of the same member record."
        >
          <View style={styles.adminList}>
            {members.map((member) => (
              <View key={member.user_id || member.id} style={styles.adminRow}>
                <View>
                  <Text style={styles.adminRowTitle}>{member.profile?.full_name || member.profile?.email || member.user_id}</Text>
                  <Text style={styles.adminRowMeta}>{[member.profile?.email, member.role].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={styles.adminStatus}>{member.status || "active"}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.adminNote}>Invites continue through the existing org membership flow. This slice manages the canonical member context after a person belongs to the org.</Text>
        </AdminSection>
      ) : activeTab === "teams" ? (
        <AdminSection
          kicker="Teams / Departments"
          title="Teams"
          count={teams.length}
          description="Teams are configurable org structure. Type and assignment role are hints, not a hard-coded Wilson taxonomy."
        >
          <View style={styles.adminList}>
            {teams.map((team) => (
              <View key={team.id || team.slug} style={styles.adminRow}>
                <TouchableOpacity style={styles.adminRowContent} activeOpacity={0.86} onPress={() => setTeamDraft({ ...team })}>
                  <Text style={styles.adminRowTitle}>{team.name}</Text>
                  <Text style={styles.adminRowMeta}>{[team.team_type, team.description].filter(Boolean).join(" · ")}</Text>
                </TouchableOpacity>
                <View style={styles.adminRowActions}>
                  <Text style={styles.adminStatus}>{team.status || "active"}</Text>
                  <AdminRowActions onEdit={() => setTeamDraft({ ...team })} onArchive={() => archiveTeam(team)} />
                </View>
              </View>
            ))}
          </View>
          <ConfigForm
            title={teamDraft.id ? "Edit team" : "Create team"}
            fields={[["name", "Team name"], ["team_type", "Team type hint"], ["description", "Description"], ["status", "Status"]]}
            draft={teamDraft}
            onChange={setTeamDraft}
            onSave={saveTeam}
            onReset={resetTeam}
            saving={savingKey === "team"}
          />
          <AssignmentForm
            members={members}
            teams={teams}
            locations={locations}
            assignments={assignments}
            draft={assignmentDraft}
            onChange={setAssignmentDraft}
            onSave={saveAssignment}
            onReset={resetAssignment}
            onEditAssignment={editAssignment}
            onRemoveAssignment={removeAssignment}
            saving={savingKey === "assignment"}
          />
        </AdminSection>
      ) : activeTab === "services" ? (
        <AdminSection
          kicker="Owner-Facing Services"
          title="Services"
          count={services.length}
          description="Services are managed data. The next slice can make owner portal actions consume these without a code change."
        >
          <View style={styles.adminList}>
            {services.map((service) => (
              <View key={service.id || service.slug} style={styles.adminRow}>
                <TouchableOpacity style={styles.adminRowContent} activeOpacity={0.86} onPress={() => editService(service)}>
                  <Text style={styles.adminRowTitle}>{service.owner_facing_label || service.name}</Text>
                  <Text style={styles.adminRowMeta}>
                    {[service.service_type, service.asset_system_type, service.brand_applicability, service.interval_trigger].filter(Boolean).join(" · ") || service.description}
                  </Text>
                </TouchableOpacity>
                <View style={styles.adminRowActions}>
                  <Text style={styles.adminStatus}>{serviceStatusLabel(service)}</Text>
                  <AdminRowActions
                    onEdit={() => editService(service)}
                    onArchive={() => serviceIsActive(service) ? archiveService(service) : activateService(service)}
                    archiveLabel={serviceIsActive(service) ? "Deactivate" : "Activate"}
                    archiveTone={serviceIsActive(service) ? "danger" : "primary"}
                  />
                </View>
              </View>
            ))}
          </View>
          <ConfigForm
            title={serviceDraft.id ? "Edit service" : "Add service"}
            fields={[
              ["name", "Internal service name"],
              ["service_type", "Service type hint"],
              ["asset_system_type", "Asset / system type"],
              ["brand_applicability", "Brand / applicability"],
              ["interval_trigger", "Interval / trigger"],
              ["service_items", "Service items"],
              ["owner_facing_label", "Owner action label"],
              ["owner_facing_description", "Owner-facing description"],
              ["relationship_purposes", "Relationship purposes"],
              ["supported_asset_types", "Supported asset types"],
              ["status", "Status"],
            ]}
            draft={serviceDraft}
            onChange={setServiceDraft}
            onSave={saveService}
            onReset={resetService}
            saving={savingKey === "service"}
          />
        </AdminSection>
      ) : activeTab === "capabilities" ? (
        <AdminSection
          kicker="Workspace Capabilities"
          title="Capabilities"
          count={listFromValue(capabilitiesDraft).length}
          description="Capabilities describe what this org can do. Asset access still comes from relationships, not capabilities alone."
        >
          <View style={styles.oemFieldWide}>
            <Text style={styles.oemFieldLabel}>Capabilities</Text>
            <TextInput
              value={capabilitiesDraft}
              onChangeText={setCapabilitiesDraft}
              style={styles.oemInput}
              placeholder="service_provider, sales, delivery, storage"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <AdminSaveButton label="Save capabilities" onPress={() => onSaveCapabilities?.(capabilitiesDraft)} saving={savingKey === "capabilities"} />
        </AdminSection>
      ) : (
        <AdminSection
          kicker="Brands Are Relationships"
          title="Brands / Organization Relationships"
          count={relationships.length}
          description="Dealer-published representation, org-confirmed relationships, and counterparty-confirmed OEM relationships are different authority states over the same org relationship."
        >
          <View style={styles.adminList}>
            {relationships.map((relationship) => (
              <View key={relationship.id} style={styles.adminRow}>
                <TouchableOpacity style={styles.adminRowContent} activeOpacity={0.86} onPress={() => editBrand(relationship)}>
                  <Text style={styles.adminRowTitle}>{relationship.org?.name || relationship.to_org_name || relationship.related_org_name || relationship.to_org_id}</Text>
                  <Text style={styles.adminRowMeta}>{[relationship.relationship_type, relationship.authority_state, relationship.evidence_state].filter(Boolean).join(" · ")}</Text>
                </TouchableOpacity>
                <View style={styles.adminRowActions}>
                  <Text style={styles.adminStatus}>{relationship.status || "source_reported"}</Text>
                  <AdminRowActions onEdit={() => editBrand(relationship)} onArchive={() => disconnectBrand(relationship)} archiveLabel="Disconnect" />
                </View>
              </View>
            ))}
          </View>
          <ConfigForm
            title="Add represented brand / OEM"
            fields={[
              ["to_org_name", "Brand or organization name"],
              ["relationship_type", "Relationship type"],
              ["status", "Status"],
              ["authority_state", "Authority state"],
              ["evidence_state", "Evidence state"],
              ["source_name", "Source name"],
              ["source_url", "Source URL"],
            ]}
            draft={brandDraft}
            onChange={setBrandDraft}
            onSave={saveBrand}
            onReset={resetBrand}
            saving={savingKey === "relationship"}
          />
        </AdminSection>
      )}
    </View>
  );
}

function AdminSection({ kicker, title, count, description, children }) {
  return (
    <View style={styles.adminSection}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>{kicker}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{count}</Text>
          <Text style={styles.networkCountLabel}>records</Text>
        </View>
      </View>
      <Text style={styles.networkText}>{description}</Text>
      {children}
    </View>
  );
}

function ConfigForm({ title, fields, draft, onChange, onSave, onReset, saving }) {
  return (
    <View style={styles.adminForm}>
      <View style={styles.adminFormHeader}>
        <Text style={styles.adminFormTitle}>{title}</Text>
        {onReset ? (
          <TouchableOpacity onPress={onReset} activeOpacity={0.86}>
            <Text style={styles.adminResetText}>New</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.oemFormGrid}>
        {fields.map(([key, label]) => {
          const wide = isWideAdminField(key);
          const multiline = isMultilineAdminField(key);
          return (
            <View key={key} style={wide ? styles.oemFieldWide : styles.oemField}>
              <Text style={styles.oemFieldLabel}>{label}</Text>
              <TextInput
                value={draft[key] == null ? "" : String(draft[key])}
                onChangeText={(value) => onChange({ ...draft, [key]: value })}
                multiline={multiline}
                style={[styles.oemInput, multiline && styles.oemTextArea]}
                placeholder={label}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          );
        })}
      </View>
      <AdminSaveButton label="Save" onPress={onSave} saving={saving} />
    </View>
  );
}

function AdminRowActions({ onEdit, onArchive, archiveLabel = "Archive", archiveTone = "danger" }) {
  const archiveIsDanger = archiveTone === "danger";
  return (
    <View style={styles.adminMiniActions}>
      <TouchableOpacity style={styles.adminMiniButton} onPress={onEdit} activeOpacity={0.86}>
        <Text style={styles.adminMiniButtonText}>Edit</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.adminMiniButton, archiveIsDanger ? styles.adminMiniButtonDanger : styles.adminMiniButtonPrimary]}
        onPress={onArchive}
        activeOpacity={0.86}
      >
        <Text style={[styles.adminMiniButtonText, archiveIsDanger ? styles.adminMiniButtonDangerText : styles.adminMiniButtonPrimaryText]}>
          {archiveLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AssignmentForm({ members, teams, locations, assignments, draft, onChange, onSave, onReset, onEditAssignment, onRemoveAssignment, saving }) {
  const memberName = (userId) => {
    const member = members.find((item) => (item.user_id || item.id) === userId);
    return member?.profile?.full_name || member?.profile?.email || member?.email || userId || "Member";
  };
  const teamName = (teamId) => teams.find((team) => team.id === teamId)?.name || "No team";
  const locationName = (locationId) => locations.find((location) => location.id === locationId)?.name || "No location";

  return (
    <View style={styles.adminForm}>
      <View style={styles.adminFormHeader}>
        <View>
          <Text style={styles.adminFormTitle}>Assign member to team / location</Text>
          <Text style={styles.adminFormHint}>{assignments.length} assignments</Text>
        </View>
        {onReset ? (
          <TouchableOpacity onPress={onReset} activeOpacity={0.86}>
            <Text style={styles.adminResetText}>New</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {assignments.length ? (
        <View style={styles.adminList}>
          {assignments.map((assignment) => (
            <View
              key={assignment.id || `${assignment.user_id}-${assignment.org_team_id}-${assignment.org_location_id}-${assignment.assignment_role}`}
              style={styles.adminRow}
            >
              <TouchableOpacity style={styles.adminRowContent} activeOpacity={0.86} onPress={() => onEditAssignment?.(assignment)}>
                <Text style={styles.adminRowTitle}>{memberName(assignment.user_id)}</Text>
                <Text style={styles.adminRowMeta}>
                  {[teamName(assignment.org_team_id), locationName(assignment.org_location_id), assignment.assignment_role].filter(Boolean).join(" · ")}
                </Text>
              </TouchableOpacity>
              <View style={styles.adminRowActions}>
                <Text style={styles.adminStatus}>{assignment.status || "active"}</Text>
                <AdminRowActions onEdit={() => onEditAssignment?.(assignment)} onArchive={() => onRemoveAssignment?.(assignment)} archiveLabel="Remove" />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.oemFormGrid}>
        <View style={styles.oemField}>
          <Text style={styles.oemFieldLabel}>Member</Text>
          <View style={styles.adminChipWrap}>
            {members.map((member) => {
              const memberId = member.user_id || member.id;
              return (
                <TouchableOpacity
                  key={memberId}
                  style={[styles.adminChip, draft.user_id === memberId && styles.adminChipActive]}
                  onPress={() => onChange({ ...draft, user_id: memberId })}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.adminChipText, draft.user_id === memberId && styles.adminChipTextActive]}>
                    {member.profile?.full_name || member.profile?.email || "Member"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={styles.oemField}>
          <Text style={styles.oemFieldLabel}>Team</Text>
          <View style={styles.adminChipWrap}>
            {teams.map((team) => (
              <TouchableOpacity
                key={team.id}
                style={[styles.adminChip, draft.org_team_id === team.id && styles.adminChipActive]}
                onPress={() => onChange({ ...draft, org_team_id: team.id })}
                activeOpacity={0.86}
              >
                <Text style={[styles.adminChipText, draft.org_team_id === team.id && styles.adminChipTextActive]}>{team.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.oemField}>
          <Text style={styles.oemFieldLabel}>Location</Text>
          <View style={styles.adminChipWrap}>
            {locations.map((location) => (
              <TouchableOpacity
                key={location.id}
                style={[styles.adminChip, draft.org_location_id === location.id && styles.adminChipActive]}
                onPress={() => onChange({ ...draft, org_location_id: location.id })}
                activeOpacity={0.86}
              >
                <Text style={[styles.adminChipText, draft.org_location_id === location.id && styles.adminChipTextActive]}>{location.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.oemField}>
          <Text style={styles.oemFieldLabel}>Assignment role hint</Text>
          <TextInput
            value={draft.assignment_role}
            onChangeText={(value) => onChange({ ...draft, assignment_role: value })}
            style={styles.oemInput}
            placeholder="advisor, manager, technician"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>
      <AdminSaveButton label="Save assignment" onPress={onSave} saving={saving} />
    </View>
  );
}

function AdminSaveButton({ label, onPress, saving }) {
  return (
    <TouchableOpacity
      style={[styles.profileSaveButton, saving && styles.profileSaveButtonDisabled]}
      activeOpacity={0.86}
      disabled={saving}
      onPress={onPress}
    >
      {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="save-outline" size={16} color={colors.onPrimary} />}
      <Text style={styles.profileSaveButtonText}>{saving ? "Saving..." : label}</Text>
    </TouchableOpacity>
  );
}

function NeedsAttentionPanel({ data, onOpenAsset }) {
  const actions = data?.open_actions || [];
  const messages = data?.recent_messages || [];
  const upcoming = data?.upcoming_work || [];
  const items = [
    ...actions.map((item) => ({
      ...item,
      item_type: "action",
      label: getActionScheduledDueAt(item) ? "Scheduled work" : isPlaybookDueDatePending(item) ? "Unscheduled work" : "Open request",
    })),
    ...messages.map((item) => ({ ...item, item_type: "message", label: "Customer message" })),
    ...upcoming.map((item) => ({ ...item, item_type: "upcoming", label: "Upcoming work" })),
  ];

  return (
    <View style={styles.servicePanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>Service Mode</Text>
          <Text style={styles.sectionTitle}>Needs Attention</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{items.length}</Text>
          <Text style={styles.networkCountLabel}>items</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        This queue is sourced from the existing Wilson KeeprPro service engine: reminders/actions, relationship messages, service history, and stewarded assets.
      </Text>
      <View style={styles.serviceList}>
        {items.length ? items.slice(0, 16).map((item, index) => (
          <TouchableOpacity
            key={`${item.item_type}-${item.id || item.thread_id || item.asset_id || "item"}-${index}`}
            style={styles.serviceRow}
            activeOpacity={0.86}
            onPress={() => item.asset_id && onOpenAsset({ asset_id: item.asset_id, kac_id: item.kac_id, organization_id: item.organization_id })}
          >
            <View style={styles.serviceRowIcon}>
              <Ionicons
                name={item.item_type === "message" ? "chatbubble-ellipses-outline" : item.item_type === "upcoming" ? "calendar-outline" : "construct-outline"}
                size={17}
                color={colors.brandBlue}
              />
            </View>
            <View style={styles.serviceRowBody}>
              <Text style={styles.serviceRowKicker}>{item.label}</Text>
              <Text style={styles.serviceRowTitle} numberOfLines={1}>{item.title || item.subject || item.asset_name || "Service item"}</Text>
              <Text style={styles.serviceRowMeta} numberOfLines={1}>
                {compact([item.asset_name, item.kac_id, item.status || item.queue_label || item.relationship_type])}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )) : (
          <View style={styles.emptyPanelCompact}>
            <Text style={styles.emptyTitle}>No urgent service work</Text>
            <Text style={styles.mutedText}>Wilson has no open service actions or recent customer messages in this KeeprSpace view.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function MessagesPanel({ data, onOpenAsset }) {
  const messages = data?.recent_messages || [];
  return (
    <View style={styles.servicePanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>Relationship Messages</Text>
          <Text style={styles.sectionTitle}>Portfolio conversations</Text>
        </View>
        <View style={styles.networkCount}>
          <Text style={styles.networkCountValue}>{messages.length}</Text>
          <Text style={styles.networkCountLabel}>threads</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        Messages remain `asset_threads` and `asset_thread_messages`. KeeprSpace is only aggregating Wilson’s relationship threads.
      </Text>
      <View style={styles.serviceList}>
        {messages.length ? messages.map((message, index) => (
          <TouchableOpacity
            key={`message-${message.id || message.thread_id || message.asset_id || "thread"}-${index}`}
            style={styles.serviceRow}
            activeOpacity={0.86}
            onPress={() => message.asset_id && onOpenAsset({ asset_id: message.asset_id, kac_id: message.kac_id, organization_id: message.organization_id })}
          >
            <View style={styles.serviceRowIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.brandBlue} />
            </View>
            <View style={styles.serviceRowBody}>
              <Text style={styles.serviceRowKicker}>Asset conversation</Text>
              <Text style={styles.serviceRowTitle} numberOfLines={1}>{message.subject || message.asset_name || "Customer thread"}</Text>
              <Text style={styles.serviceRowMeta} numberOfLines={1}>{message.body || message.latest_message || "Open relationship workspace"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )) : (
          <View style={styles.emptyPanelCompact}>
            <Text style={styles.emptyTitle}>No recent messages</Text>
            <Text style={styles.mutedText}>Customer relationship threads will appear here as Wilson’s portfolio conversations continue.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function OptionChip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.optionChip, selected && styles.optionChipSelected]}
      onPress={onPress}
      activeOpacity={0.86}
    >
      <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AddBoatPanel({
  mode,
  onModeChange,
  query,
  onQueryChange,
  onResolve,
  resolving,
  results,
  onConnect,
  connectingId,
  relationshipPurpose,
  onPurposeChange,
  operatingStates,
  onToggleState,
  createDraft,
  onDraftChange,
  onPickPhotos,
  onCreate,
  creating,
  organizationName,
}) {
  const purposeLabel = ADD_BOAT_PURPOSES.find((item) => item.key === relationshipPurpose)?.label || "Service";

  return (
    <View style={styles.servicePanel}>
      <View style={styles.networkHeader}>
        <View>
          <Text style={styles.sectionKicker}>Resolve Before Create</Text>
          <Text style={styles.sectionTitle}>Add a Boat</Text>
        </View>
        <View style={styles.commandBadge}>
          <Text style={styles.commandBadgeText}>{organizationName || "KeeprSpace"}</Text>
        </View>
      </View>
      <Text style={styles.networkText}>
        Find the existing canonical boat first. If Keepr cannot resolve it, create one boat and connect this organization through a relationship. People add boats; Keepr manages identity.
      </Text>

      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "find" && styles.segmentButtonActive]}
          onPress={() => onModeChange("find")}
          activeOpacity={0.86}
        >
          <Ionicons name="search-outline" size={15} color={mode === "find" ? colors.onPrimary : colors.textSecondary} />
          <Text style={[styles.segmentText, mode === "find" && styles.segmentTextActive]}>Find Existing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "create" && styles.segmentButtonActive]}
          onPress={() => onModeChange("create")}
          activeOpacity={0.86}
        >
          <Ionicons name="add-circle-outline" size={15} color={mode === "create" ? colors.onPrimary : colors.textSecondary} />
          <Text style={[styles.segmentText, mode === "create" && styles.segmentTextActive]}>Create New Boat</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.addBoatSection}>
        <Text style={styles.oemFieldLabel}>How are you working with this boat?</Text>
        <View style={styles.optionChipRow}>
          {ADD_BOAT_PURPOSES.map((purpose) => (
            <OptionChip
              key={purpose.key}
              label={purpose.label}
              selected={relationshipPurpose === purpose.key}
              onPress={() => onPurposeChange(purpose.key)}
            />
          ))}
        </View>
      </View>

      <View style={styles.addBoatSection}>
        <Text style={styles.oemFieldLabel}>Operating state</Text>
        <View style={styles.optionChipRow}>
          {ADD_BOAT_STATES.map((state) => (
            <OptionChip
              key={state}
              label={state}
              selected={operatingStates.includes(state)}
              onPress={() => onToggleState(state)}
            />
          ))}
        </View>
      </View>

      {mode === "find" ? (
        <>
      <View style={styles.addKacSearch}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Scan or enter Keepr code, HIN, or boat identity"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={onResolve}
        />
        <TouchableOpacity style={styles.addKacButton} onPress={onResolve} disabled={resolving} activeOpacity={0.86}>
          {resolving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="scan-outline" size={16} color={colors.onPrimary} />}
          <Text style={styles.addKacButtonText}>{resolving ? "Resolving" : "Find Boat"}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.serviceList}>
        {results.length ? results.map((asset) => (
          <View key={asset.asset_id} style={styles.addKacResult}>
            <View style={styles.serviceRowBody}>
              <Text style={styles.serviceRowKicker}>{asset.already_connected ? "Already connected" : "Existing canonical asset"}</Text>
              <Text style={styles.serviceRowTitle}>{asset.asset_name || "Untitled boat"}</Text>
              <Text style={styles.serviceRowMeta}>{compact([asset.kac_id, asset.year, asset.make, asset.model, asset.hin])}</Text>
            </View>
            <TouchableOpacity
              style={[styles.addKacButton, asset.already_connected && styles.addKacButtonSecondary]}
              disabled={asset.already_connected || connectingId === asset.asset_id}
              onPress={() => onConnect(asset)}
              activeOpacity={0.86}
            >
              {connectingId === asset.asset_id ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="link-outline" size={16} color={asset.already_connected ? colors.textSecondary : colors.onPrimary} />}
              <Text style={[styles.addKacButtonText, asset.already_connected && styles.addKacButtonTextSecondary]}>
                {asset.already_connected ? "Connected" : `Add to ${organizationName || "KeeprSpace"}`}
              </Text>
            </TouchableOpacity>
          </View>
        )) : (
          <View style={styles.emptyPanelCompact}>
            <Text style={styles.emptyTitle}>Find an existing boat</Text>
            <Text style={styles.mutedText}>Search first by Keepr code, HIN, or identity. If there is no match, use Create New Boat and Keepr will create the durable identity underneath.</Text>
          </View>
        )}
      </View>
        </>
      ) : (
        <View style={styles.createBoatCard}>
          <View style={styles.oemFormGrid}>
            {[
              ["year", "Year"],
              ["make", "Make"],
              ["model", "Model"],
              ["hin", "HIN if known"],
              ["name", "Boat name optional"],
              ["location", "Location"],
              ["engine", "Propulsion / engine summary"],
              ["owner", "Owner optional"],
            ].map(([key, label]) => (
              <View key={key} style={key === "engine" ? styles.oemFieldWide : styles.oemField}>
                <Text style={styles.oemFieldLabel}>{label}</Text>
                <TextInput
                  value={createDraft[key]}
                  onChangeText={(value) => onDraftChange({ ...createDraft, [key]: value })}
                  style={styles.oemInput}
                  placeholder={label}
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            ))}
          </View>
          <View style={styles.addBoatSection}>
            <Text style={styles.oemFieldLabel}>Boat photos</Text>
            <TouchableOpacity style={styles.photoPickButton} onPress={onPickPhotos} activeOpacity={0.86}>
              <Ionicons name="images-outline" size={18} color={colors.brandBlue} />
              <Text style={styles.photoPickText}>
                {createDraft.photos?.length ? `${createDraft.photos.length} selected` : "Select photo"}
              </Text>
            </TouchableOpacity>
            {createDraft.photos?.length ? (
              <View style={styles.photoPreviewRow}>
                {createDraft.photos.slice(0, 4).map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={styles.photoPreviewWrap}>
                    <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
                    {index === 0 ? (
                      <View style={styles.photoHeroBadge}>
                        <Text style={styles.photoHeroBadgeText}>Hero</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.addBoatSection}>
            <Text style={styles.oemFieldLabel}>New / Used</Text>
            <View style={styles.optionChipRow}>
              {["New", "Used"].map((value) => (
                <OptionChip
                  key={value}
                  label={value}
                  selected={createDraft.newUsed === value}
                  onPress={() => onDraftChange({ ...createDraft, newUsed: value })}
                />
              ))}
            </View>
          </View>
          <TouchableOpacity style={styles.createBoatButton} onPress={onCreate} disabled={creating} activeOpacity={0.86}>
            {creating ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="boat-outline" size={16} color={colors.onPrimary} />}
            <Text style={styles.createBoatButtonText}>{creating ? "Creating Boat" : `Create Boat + ${purposeLabel}`}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function FoundationPending({ error }) {
  return (
    <View style={styles.emptyPanel}>
      <View style={styles.emptyIcon}>
        <Ionicons name="construct-outline" size={22} color={colors.brandBlue} />
      </View>
      <Text style={styles.emptyTitle}>Demo data is not connected yet</Text>
      <Text style={styles.mutedText}>
        The product surface is ready. The connected Supabase project still needs the approved Activator foundation and read-only browser resolvers before live fleet data can appear.
      </Text>
      <Text style={styles.microText}>{error}</Text>
    </View>
  );
}

export default function ActivatorHomeScreen({ navigation, route, fixedMode = null }) {
  const { currentWorkspace, setCurrentWorkspaceId, workspaces } = useWorkspace();
  const initialMode = fixedMode || route?.params?.initialMode || "fleet";
  const [modeState, setModeState] = useState(initialMode);
  const [projectionMode, setProjectionMode] = useState(defaultWorkspaceProjection(currentWorkspace) || "service");
  const [search, setSearch] = useState("");
  const [fleetFilter, setFleetFilter] = useState("all");
  const [brandProfile, setBrandProfile] = useState(defaultBrandProfile(currentWorkspace));
  const [data, setData] = useState(null);
  const [assetHeroUrls, setAssetHeroUrls] = useState({});
  const [catalogTemplates, setCatalogTemplates] = useState([]);
  const [catalogTemplateMediaById, setCatalogTemplateMediaById] = useState({});
  const [exactBuildDrafts, setExactBuildDrafts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [modelDraft, setModelDraft] = useState({ manufacturer: "", model: "", modelYear: "2027" });
  const [creatingModel, setCreatingModel] = useState(false);
  const [orgConfig, setOrgConfig] = useState(null);
  const [orgConfigLoading, setOrgConfigLoading] = useState(false);
  const [adminTab, setAdminTab] = useState("profile");
  const [adminSavingKey, setAdminSavingKey] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingBrandImage, setUploadingBrandImage] = useState(null);
  const [addBoatMode, setAddBoatMode] = useState("find");
  const [addBoatQuery, setAddBoatQuery] = useState("");
  const [addBoatResults, setAddBoatResults] = useState([]);
  const [addBoatLoading, setAddBoatLoading] = useState(false);
  const [addBoatConnectingId, setAddBoatConnectingId] = useState(null);
  const [addBoatPurpose, setAddBoatPurpose] = useState("service");
  const [addBoatStates, setAddBoatStates] = useState(["In Service"]);
  const [newBoatDraft, setNewBoatDraft] = useState(EMPTY_NEW_BOAT);
  const [creatingBoat, setCreatingBoat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const currentKind = workspaceKind(currentWorkspace);
  const memberRole = currentWorkspace?.authority?.member_role || currentWorkspace?.authority?.role || null;
  const canAuthorCatalog =
    ["owner", "admin", "manager"].includes(String(memberRole || "").toLowerCase()) &&
    (currentKind === "oem" || workspaceHasCapability(currentWorkspace, "model_catalog"));
  const projectionSwitchable = canSwitchProjection(currentWorkspace);
  const activeProjection = projectionSwitchable ? projectionMode : defaultWorkspaceProjection(currentWorkspace);
  const copy = useMemo(() => copyForWorkspace(currentWorkspace, activeProjection), [currentWorkspace, activeProjection]);
  const isPersonalKeepr = currentKind === "owner";
  const workAreas = useMemo(() => workAreasForProjection(currentWorkspace, activeProjection), [currentWorkspace, activeProjection]);
  const mode = fixedMode || modeState;
  const routeInitialMode = route?.params?.initialMode || null;
  const routeWorkspaceId = route?.params?.workspaceId || null;
  const routeNavSection = route?.params?.navSection || null;
  const syncModeRoute = useCallback((nextMode) => {
    if (fixedMode) return;

    const navSection = navSectionForActivatorMode(nextMode);
    const routeOrganizationId = route?.params?.organizationId || organizationIdFromWorkspaceId(routeWorkspaceId);
    const routeOrgWorkspace = routeOrganizationId
      ? workspaces.find((workspace) =>
          workspaceMatchesOrganization(workspace, routeOrganizationId) &&
          workspace.workspace_type &&
          workspace.workspace_type !== "keepr"
        )
      : null;
    const activeWorkspace = currentWorkspace?.workspace_type === "keepr" && routeOrgWorkspace
      ? routeOrgWorkspace
      : currentWorkspace;
    const workspaceId = activeWorkspace?.workspace_type === "keepr"
      ? routeWorkspaceId || null
      : activeWorkspace?.workspace_id || routeWorkspaceId || null;
    const organizationId = workspaceOrganizationId(activeWorkspace) || routeOrganizationId || null;
    if (
      routeInitialMode === nextMode &&
      routeNavSection === navSection &&
      routeWorkspaceId === workspaceId
    ) {
      return;
    }

    setActivatorWebUrl(nextMode, { workspaceId, organizationId });

    try {
      navigation.setParams?.({ initialMode: nextMode, navSection, workspaceId, organizationId });
    } catch (err) {
      console.error("Activator mode route update failed:", err);
    }
  }, [
    currentWorkspace?.org_id,
    currentWorkspace?.organization_id,
    currentWorkspace?.workspace_id,
    currentWorkspace?.workspace_type,
    fixedMode,
    navigation,
    route?.params?.organizationId,
    routeInitialMode,
    routeNavSection,
    routeWorkspaceId,
    workspaces,
  ]);

  const setMode = useCallback((nextMode) => {
    if (!fixedMode) {
      setModeState((current) => current === nextMode ? current : nextMode);
      syncModeRoute(nextMode);
      return;
    }

    const routeForMode = {
      needs: "KeeprSpaceHome",
      fleet: "KeeprSpaceFleet",
      messages: "KeeprSpaceMessages",
      profile: "KeeprSpaceAdmin",
    }[nextMode];

    if (routeForMode) {
      try {
        const targetParams = { workspaceId: currentWorkspace?.workspace_id || null };
        navigation.navigate(routeForMode, targetParams);
      } catch (err) {
        console.error("KeeprSpace in-page navigation failed:", err);
      }
    }
  }, [currentWorkspace?.workspace_id, fixedMode, navigation, syncModeRoute]);

  const navigateKeeprSpaceBoat = useCallback((params) => {
    try {
      navigation.navigate("KeeprSpaceModule", {
        screen: "KeeprSpaceBoat",
        params,
      });
    } catch (err) {
      console.error("KeeprSpace boat navigation failed:", err);
    }
  }, [navigation]);

  const navigateCanonicalBoatStory = useCallback((params) => {
    try {
      navigation.navigate("BoatStory", params);
    } catch (err) {
      console.error("Canonical boat story navigation failed:", err);
    }
  }, [navigation]);

  useEffect(() => {
    const requestedWorkspaceId = route?.params?.workspaceId;
    const requestedOrganizationId = route?.params?.organizationId || organizationIdFromWorkspaceId(requestedWorkspaceId);
    if (
      isPersonalFallbackWorkspaceId(requestedWorkspaceId) &&
      requestedOrganizationId
    ) {
      const orgWorkspace = workspaces.find((workspace) =>
        workspaceMatchesOrganization(workspace, requestedOrganizationId) &&
        workspace.workspace_type &&
        workspace.workspace_type !== "keepr"
      );
      if (orgWorkspace?.workspace_id && orgWorkspace.workspace_id !== currentWorkspace?.workspace_id) {
        setCurrentWorkspaceId(orgWorkspace.workspace_id);
      }
      return;
    }
    if (requestedOrganizationId && requestedWorkspaceId?.startsWith?.("org:")) {
      const orgWorkspace = workspaces.find((workspace) =>
        workspaceMatchesOrganization(workspace, requestedOrganizationId) &&
        workspace.workspace_type &&
        workspace.workspace_type !== "keepr"
      );
      if (orgWorkspace?.workspace_id && orgWorkspace.workspace_id !== currentWorkspace?.workspace_id) {
        setCurrentWorkspaceId(orgWorkspace.workspace_id);
      }
      return;
    }
    if (
      requestedWorkspaceId &&
      requestedWorkspaceId !== currentWorkspace?.workspace_id &&
      workspaces.some((workspace) => workspace.workspace_id === requestedWorkspaceId || workspace.id === requestedWorkspaceId)
    ) {
      setCurrentWorkspaceId(requestedWorkspaceId);
    }
  }, [currentWorkspace?.workspace_id, route?.params?.organizationId, route?.params?.workspaceId, setCurrentWorkspaceId, workspaces]);

  useEffect(() => {
    setBrandProfile(defaultBrandProfile(currentWorkspace));
    setModelDraft({
      manufacturer:
        currentWorkspace?.display_name ||
        currentWorkspace?.name ||
        currentWorkspace?.organization_name ||
        "",
      model: "",
      modelYear: "2027",
    });
    setProjectionMode(defaultWorkspaceProjection(currentWorkspace) || "service");
  }, [currentWorkspace]);

  useEffect(() => {
    if (!projectionSwitchable) return;
    if (projectionMode === "sales") {
      setAddBoatPurpose("selling_dealer");
      setAddBoatStates(["For Sale"]);
      setNewBoatDraft((current) => ({ ...current, operationalState: "For Sale" }));
    } else {
      setAddBoatPurpose("service");
      setAddBoatStates(["In Service"]);
      setNewBoatDraft((current) => ({ ...current, operationalState: "In Service" }));
    }
  }, [projectionMode, projectionSwitchable]);

  useEffect(() => {
    if (fixedMode) return;
    const requestedMode = routeInitialMode;
    if (requestedMode && workAreas.some((area) => area.key === requestedMode)) {
      setModeState((current) => current === requestedMode ? current : requestedMode);
    }
  }, [fixedMode, routeInitialMode, workAreas]);

  useEffect(() => {
    if (fixedMode) return;
    if (
      currentWorkspace?.workspace_type === "keepr" &&
      route?.params?.organizationId &&
      route?.params?.workspaceId?.startsWith?.("org:")
    ) {
      return;
    }
    if (!routeInitialMode && currentKind === "pro" && mode === "fleet") {
      setMode(workAreas[0]?.key || "needs");
      return;
    }

    if (!workAreas.some((area) => area.key === mode)) {
      setMode(workAreas[0]?.key || "fleet");
    }
  }, [currentKind, fixedMode, mode, routeInitialMode, setMode, workAreas]);

  useEffect(() => {
    if (!isPersonalKeepr) return;
    if (route?.params?.workspaceId) return;
    navigation.navigate("PersonalModule", {
      screen: "PersonalTabs",
      params: { screen: "Boats" },
    });
  }, [isPersonalKeepr, navigation, route?.params?.workspaceId]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (isPersonalKeepr) {
      setLoading(false);
      setRefreshing(false);
      setData(null);
      setError(null);
      return;
    }

    if (!quiet) setLoading(true);
    setError(null);

    try {
      let nextData;
      const kind = workspaceKind(currentWorkspace);
      const orgId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;

      if (kind === "pro" || kind === "dealer") {
        nextData = await getKeeprSpacePortfolio({
          organizationId: orgId,
          search,
          limit: 50,
          offset: 0,
        });
        setBrandProfile(brandProfileFromKeeprSpaceContext(nextData?.context, currentWorkspace));
      } else {
        const nextFilters = normalizeFilters({ workspace: currentWorkspace, search });
        nextData = await getActivatorBoatBrowser(nextFilters);
        nextData = withKf018FleetProjection(nextData, currentWorkspace, search);
      }
      setData(nextData);

      if (orgId) {
        setOrgConfigLoading(true);
        try {
          const nextConfig = await getKeeprSpaceOrgConfig({ organizationId: orgId });
          setOrgConfig(nextConfig);
          if (nextConfig?.organization) {
            setBrandProfile(brandProfileFromOrgConfig(nextConfig, currentWorkspace));
          }
        } catch (configErr) {
          console.warn("KeeprSpace org config unavailable:", configErr?.message || configErr);
          setOrgConfig(null);
        } finally {
          setOrgConfigLoading(false);
        }
      } else {
        setOrgConfig(null);
      }

      setCatalogLoading(true);
      try {
        const nextTemplates = await getCatalogTemplates(kind === "oem" ? orgId : null);
        setCatalogTemplates(nextTemplates);
        try {
          setCatalogTemplateMediaById(await listModelTemplateMediaForTemplates(nextTemplates));
        } catch (mediaErr) {
          console.warn("Activator catalog template media unavailable:", mediaErr?.message || mediaErr);
          setCatalogTemplateMediaById({});
        }
      } catch (catalogErr) {
        console.warn("Activator catalog templates unavailable:", catalogErr?.message || catalogErr);
        setCatalogTemplates([]);
        setCatalogTemplateMediaById({});
      }

      if (kind === "oem" && orgId) {
        try {
          const nextDrafts = await getExactBuildWorkQueue(orgId);
          setExactBuildDrafts(nextDrafts);
        } catch (draftErr) {
          console.warn("Exact build draft queue unavailable:", draftErr?.message || draftErr);
          setExactBuildDrafts([]);
        }
      } else {
        setExactBuildDrafts([]);
      }
    } catch (err) {
      console.error("Activator browser load failed:", err);
      setError(err?.message || "Could not load this workspace.");
      setData(null);
    } finally {
      setLoading(false);
      setCatalogLoading(false);
      setRefreshing(false);
    }
  }, [currentWorkspace, isPersonalKeepr, search]);

  useEffect(() => {
    load();
  }, [load]);

  const boats = data?.boats || [];
  const counts = data?.counts || {};
  const fleetResults = useMemo(
    () => boats.filter((boat) => fleetFilterMatchesBoat(boat, fleetFilter)),
    [boats, fleetFilter]
  );
  const heroOrganizationId = currentWorkspace?.organization_id || currentWorkspace?.org_id || route?.params?.organizationId || null;
  const heroAssetIds = useMemo(
    () => Array.from(new Set(boats.map(assetIdForBoat).filter(Boolean))),
    [boats]
  );
  const heroAssetIdsKey = heroAssetIds.join("|");

  useEffect(() => {
    let active = true;

    async function loadAssetHeroes() {
      if (!heroAssetIds.length) {
        setAssetHeroUrls({});
        return;
      }

      const urls = await fetchAssetHeroUris(heroAssetIds, {
        transform: { width: 900, quality: 80 },
        organizationId: heroOrganizationId,
      });
      if (active) setAssetHeroUrls(urls);
    }

    loadAssetHeroes();
    return () => {
      active = false;
    };
  }, [heroAssetIdsKey, heroOrganizationId]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const openBoat = (boat) => {
    const resolvedAssetId = boat?.asset_id || boat?.id || null;
    const resolvedOrgId = boat?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;

    if (mode === "builds" && (boat?.source_type === "factory_build_workspace" || boat?.exact_build?.build_key)) {
      if (openActivatorWebPath(`/activator/build/${encodeURIComponent(boat?.exact_build?.template_key || boat?.template?.template_key || TIARA_56_LS_TEMPLATE_KEY)}`, {
        buildKey: boat?.exact_build?.build_key || null,
        hullNumber: boat?.exact_build?.hull_number || boat?.identity?.hull_number || boat?.identity?.hin || null,
        parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
        organizationId: resolvedOrgId,
        workspaceId: currentWorkspace?.workspace_id || null,
      })) return;

      navigation.navigate("ActivatorExactBuild", {
        templateKey: boat?.exact_build?.template_key || boat?.template?.template_key || TIARA_56_LS_TEMPLATE_KEY,
        buildKey: boat?.exact_build?.build_key || null,
        hullNumber: boat?.exact_build?.hull_number || boat?.identity?.hull_number || boat?.identity?.hin || null,
        parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
        organizationId: resolvedOrgId,
        workspaceId: currentWorkspace?.workspace_id || null,
      });
      return;
    }

    const assetParams = {
      assetId: resolvedAssetId,
      kac: boat.kac_id,
      organizationId: resolvedOrgId,
      stewardshipId: boat.stewardship_id || boat.service_relationship?.stewardship_id || null,
      parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
      workspaceId: currentWorkspace?.workspace_id || null,
      systemsRole: activeProjection || (currentKind === "oem" ? "oem" : null),
    };

    if (mode === "fleet" && resolvedAssetId && currentKind === "oem") {
      navigateCanonicalBoatStory({
        boatId: resolvedAssetId,
        assetId: resolvedAssetId,
        kac: boat.kac_id,
        organizationId: resolvedOrgId,
        workspaceId: currentWorkspace?.workspace_id || null,
        relationshipRole: "oem",
        teamMemberType: "oem",
        systemsRole: activeProjection || "oem",
        parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
      });
      return;
    }

    if (mode === "fleet" && resolvedAssetId) {
      navigateKeeprSpaceBoat(assetParams);
      return;
    }

    if (activeProjection === "service") {
      if (fixedMode) {
        navigateKeeprSpaceBoat(assetParams);
        return;
      }

      navigation.navigate("KeeprProStack", {
        screen: "KeeprProStewardshipView",
        params: assetParams,
      });
      return;
    }

    navigation.navigate("ActivatorBoatWorkspace", {
      assetId: boat.asset_id,
      assetName: boat.asset_name,
    });
  };

  const openCatalogTemplate = (template) => {
    if (openActivatorWebPath(`/activator/catalog/${encodeURIComponent(template.template_key)}`, {
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    })) return;

    navigation.navigate("ActivatorCatalogTemplate", {
      templateKey: template.template_key,
    });
  };

  const openTemplateDraft = (draft) => {
    if (openActivatorWebPath(`/activator/catalog-drafts/${encodeURIComponent(draft.draft_key)}`, {
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    })) return;

    navigation.navigate("ActivatorTemplateDraft", {
      draftKey: draft.draft_key,
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    });
  };

  const openTemplateSourceReview = (template) => {
    if (openActivatorWebPath(`/activator/catalog/${encodeURIComponent(template.template_key)}/customize`, {
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    })) return;

    navigation.navigate("ActivatorTemplateCustomize", {
      templateKey: template.template_key,
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    });
  };

  const openExactBuild = (template) => {
    if (openActivatorWebPath(`/activator/build/${encodeURIComponent(template.template_key)}`, {
      buildKey: template.buildKey || null,
      hullNumber: template.hullNumber || null,
      draftId: template.draftId || null,
      draftKey: template.draftKey || null,
      parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    })) return;

    navigation.navigate("ActivatorExactBuild", {
      templateKey: template.template_key,
      buildKey: template.buildKey || null,
      hullNumber: template.hullNumber || null,
      draftId: template.draftId || null,
      draftKey: template.draftKey || null,
      parentRoute: fixedMode ? "KeeprSpaceFleet" : "ActivatorHome",
      organizationId: workspaceOrganizationId(currentWorkspace),
      workspaceId: currentWorkspace?.workspace_id || null,
    });
  };

  const createCatalogModel = async () => {
    const organizationId = workspaceOrganizationId(currentWorkspace);
    const modelYear = Number(modelDraft.modelYear);
    if (!organizationId) {
      Alert.alert("Missing organization", "Open an organization workspace before creating a model.");
      return;
    }
    if (!canAuthorCatalog) {
      Alert.alert("Not authorized", "Only org owners, admins, and managers can author reusable catalog models.");
      return;
    }
    if (!modelDraft.manufacturer.trim() || !modelDraft.model.trim() || !Number.isFinite(modelYear)) {
      Alert.alert("Model details required", "Add manufacturer, model, and model year.");
      return;
    }

    setCreatingModel(true);
    try {
      const created = await createOrgModelTemplate({
        organizationId,
        manufacturer: modelDraft.manufacturer,
        model: modelDraft.model,
        modelYear,
      });
      await load({ quiet: true });
      setModelDraft((current) => ({ ...current, model: "" }));
      const template = created?.template || null;
      if (template?.template_key) openCatalogTemplate(template);
    } catch (err) {
      Alert.alert("Could not create model", err?.message || "Please try again.");
    } finally {
      setCreatingModel(false);
    }
  };

  const openCoreAddBoat = useCallback((intent = "add_boat") => {
    navigation.navigate("KeeprSpaceModule", {
      screen: "KeeprSpaceActivator",
      params: {
        workspaceId: currentWorkspace?.workspace_id || null,
        organizationId: workspaceOrganizationId(currentWorkspace),
        intent,
        parentRoute: "ActivatorHome",
      },
    });
  }, [
    currentWorkspace?.org_id,
    currentWorkspace?.organization_id,
    currentWorkspace?.workspace_id,
    navigation,
  ]);

  const pickBrandLogo = async () => {
    try {
      setUploadingBrandImage("logo");
      const uri = await pickAndUploadBrandImage({ profile: brandProfile, field: "logo_url" });
      if (uri) setBrandProfile((current) => ({ ...current, logoUri: uri }));
    } catch (err) {
      Alert.alert("Upload failed", err?.message || "Could not upload this profile image.");
    } finally {
      setUploadingBrandImage(null);
    }
  };

  const pickBrandHeader = async () => {
    try {
      setUploadingBrandImage("header");
      const uri = await pickAndUploadBrandImage({ profile: brandProfile, field: "header_image_url" });
      if (uri) setBrandProfile((current) => ({ ...current, headerImageUri: uri }));
    } catch (err) {
      Alert.alert("Upload failed", err?.message || "Could not upload this header image.");
    } finally {
      setUploadingBrandImage(null);
    }
  };

  const saveBrandProfile = async () => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    const keeprProId = brandProfile.keeprProId || data?.context?.keepr_pro_id || null;
    if (!orgId) {
      Alert.alert("Profile not connected", "This KeeprSpace does not have an organization profile to update yet.");
      return;
    }

    setSavingProfile(true);
    try {
      const orgPatch = {
        display_name: brandProfile.displayName,
        slug: brandProfile.slug,
        photo_url: brandProfile.logoUri,
        team_photo_url: brandProfile.headerImageUri,
        logo_url: brandProfile.logoUri,
        header_image_url: brandProfile.headerImageUri,
        short_description: brandProfile.shortDescription,
        public_description: brandProfile.publicDescription,
        phone: brandProfile.phone,
        email: brandProfile.email,
        website: brandProfile.website,
        location: brandProfile.location,
        publish_status: brandProfile.profileStatus,
        service_offerings: listFromValue(brandProfile.serviceOfferings),
        packages: listFromValue(brandProfile.packages),
        source_metadata: { managed_from: "keeprspace_admin" },
      };
      const nextConfig = await upsertKeeprSpaceOrgProfile({
        organizationId: orgId,
        patch: orgPatch,
      });
      if (nextConfig) {
        setOrgConfig(nextConfig);
        setBrandProfile(brandProfileFromOrgConfig(nextConfig, currentWorkspace));
      }

      if (keeprProId) {
        await updateKeeprSpaceServiceProfile({
          organizationId: orgId,
          keeprProId,
          patch: {
            display_name: brandProfile.displayName,
            slug: brandProfile.slug,
            logo_url: brandProfile.logoUri,
            header_image_url: brandProfile.headerImageUri,
            short_description: brandProfile.shortDescription,
            public_description: brandProfile.publicDescription,
            phone: brandProfile.phone,
            email: brandProfile.email,
            website: brandProfile.website,
            location: brandProfile.location,
            publish_status: brandProfile.profileStatus,
            service_offerings: listFromValue(brandProfile.serviceOfferings),
            packages: listFromValue(brandProfile.packages),
            locations: listFromValue(brandProfile.location).map((label) => ({ label })),
          },
        });
      }
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not save profile", err?.message || "Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveOrgLocation = async (location) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("location");
    try {
      const nextConfig = await upsertKeeprSpaceOrgLocation({ organizationId: orgId, location });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save location", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgTeam = async (team) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("team");
    try {
      const nextConfig = await upsertKeeprSpaceOrgTeam({ organizationId: orgId, team });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save team", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgMemberAssignment = async (assignment) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("assignment");
    try {
      const nextConfig = await upsertKeeprSpaceOrgMemberAssignment({ organizationId: orgId, assignment });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save assignment", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgService = async (service) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("service");
    try {
      const nextConfig = await upsertKeeprSpaceOrgServiceOffering({ organizationId: orgId, service });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save service", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgRelationship = async (relationship) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("relationship");
    try {
      const nextConfig = await upsertKeeprSpaceOrgRelationship({
        fromOrgId: orgId,
        toOrgId: relationship.to_org_id || null,
        toOrgName: relationship.to_org_name || relationship.brand_name || relationship.name,
        relationshipType: relationship.relationship_type || "represented_brand",
        payload: relationship,
      });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save relationship", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgCapabilities = async (capabilities) => {
    const orgId = brandProfile.organizationId || data?.context?.organization_id || currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    setAdminSavingKey("capabilities");
    try {
      const nextConfig = await upsertKeeprSpaceOrgProfile({
        organizationId: orgId,
        patch: { workspace_capabilities: listFromValue(capabilities) },
      });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save capabilities", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const setRelationshipPurpose = (purpose) => {
    const nextPurpose = ADD_BOAT_PURPOSES.find((item) => item.key === purpose);
    setAddBoatPurpose(purpose);
    if (nextPurpose?.state && !addBoatStates.includes(nextPurpose.state)) {
      setAddBoatStates([nextPurpose.state]);
      setNewBoatDraft((current) => ({ ...current, operationalState: nextPurpose.state }));
    }
  };

  const toggleAddBoatState = (state) => {
    setAddBoatStates((current) => {
      const next = current.includes(state)
        ? current.filter((item) => item !== state)
        : [...current, state];
      return next.length ? next : [state];
    });
  };

  const resolveAddBoat = async () => {
    const orgId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!addBoatQuery.trim()) return;
    setAddBoatLoading(true);
    try {
      const result = await resolveKeeprSpaceKac({
        query: addBoatQuery,
        organizationId: orgId,
      });
      setAddBoatResults(result?.matches || []);
    } catch (err) {
      Alert.alert("Could not find boat", err?.message || "Please try again.");
      setAddBoatResults([]);
    } finally {
      setAddBoatLoading(false);
    }
  };

  const connectAddBoatAsset = async (asset) => {
    const orgId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!asset?.asset_id || !orgId) return;
    setAddBoatConnectingId(asset.asset_id);
    try {
      await connectKeeprSpaceBoat({
        assetId: asset.asset_id,
        organizationId: orgId,
        relationshipPurpose: addBoatPurpose,
        operatingStates: addBoatStates,
      });
      await load({ quiet: true });
      setMode("fleet");
      setAddBoatResults([]);
      setAddBoatQuery("");
    } catch (err) {
      Alert.alert("Could not connect boat", err?.message || "Please try again.");
    } finally {
      setAddBoatConnectingId(null);
    }
  };

  const createAddBoat = async () => {
    const orgId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
    if (!orgId) return;
    if (!newBoatDraft.make.trim() || !newBoatDraft.model.trim()) {
      Alert.alert("Make and model required", "Add at least the make and model to create a canonical boat.");
      return;
    }

    setCreatingBoat(true);
    try {
      const created = await createKeeprSpaceBoat({
        organizationId: orgId,
        relationshipPurpose: addBoatPurpose,
        operatingStates: addBoatStates,
        boat: {
          year: newBoatDraft.year,
          make: newBoatDraft.make,
          model: newBoatDraft.model,
          hin: newBoatDraft.hin,
          new_used: newBoatDraft.newUsed,
          name: newBoatDraft.name,
          location: newBoatDraft.location,
          engine: newBoatDraft.engine,
          owner: newBoatDraft.owner,
          operational_state: addBoatStates[0] || newBoatDraft.operationalState,
        },
      });
      await uploadActivatorBoatPhotos({
        assetId: created?.asset_id || created?.asset?.id || created?.id || null,
        photos: newBoatDraft.photos || [],
      });
      await load({ quiet: true });
      setMode("fleet");
      setNewBoatDraft(EMPTY_NEW_BOAT);
      setAddBoatQuery("");
          setAddBoatResults([]);
    } catch (err) {
      Alert.alert("Could not create boat", err?.message || "Please try again.");
    } finally {
      setCreatingBoat(false);
    }
  };

  const isDealerSalesMode = mode === "builds" && activeProjection === "sales" && currentKind !== "oem";
  const buildsKicker = isDealerSalesMode ? "Delivery" : "Work";
  const buildsTitle = isDealerSalesMode ? "Delivery Prep" : "Work Queue";
  const buildsMetricLabel = isDealerSalesMode ? "Brand paths" : "Work items";
  const buildsMetricValue = isDealerSalesMode ? String(WILSON_REPRESENTED_BRANDS.length) : String(catalogTemplates.length + exactBuildDrafts.length);
  const breadcrumbCurrent =
    mode === "fleet" ? "Find" :
    mode === "builds" ? buildsTitle :
    mode === "needs" ? "Recent / Needs Attention" :
    mode === "messages" ? "Messages" :
    mode === "addBoat" ? "Add / Connect" :
    mode === "templates" ? "Model Catalog" :
    mode === "profile" ? (projectionSwitchable ? `${projectionLabel(activeProjection)} Profile` : currentKind === "oem" ? "OEM Profile" : "Profile") :
    "Dealer Network";
  const heroSource =
    brandProfile.headerImageUri
      ? { uri: brandProfile.headerImageUri }
      : ["dealer", "pro"].includes(currentKind)
      ? BOAT_HERO
      : null;
  const shouldShowHeroLogo = ["oem", "dealer", "pro"].includes(currentKind);
  const heroLogo = brandProfile.logoUri ? { uri: brandProfile.logoUri } : null;
  const modeHeroCopy = mode === "templates"
    ? {
        eyebrow: "OEM Catalog",
        title: `${copy.name} product lineage`,
        subtitle: "Current, previous, and retired model years. Open a model, edit its reusable definition, or build an exact boat from it.",
      }
    : {
        eyebrow: copy.eyebrow,
        title: copy.title,
        subtitle: copy.subtitle,
      };
  const heroInner = (
    <View style={styles.heroOverlay}>
      {shouldShowHeroLogo ? (
        heroLogo ? (
          <Image
            source={heroLogo}
            resizeMode="contain"
            style={styles.oemLogo}
          />
        ) : (
          <View style={styles.oemLogo}>
            <Text style={styles.dealerLogoFallback}>{initialsForName(copy.name)}</Text>
          </View>
        )
      ) : null}
      <View style={styles.heroCopy}>
        <Text style={styles.eyebrow}>{modeHeroCopy.eyebrow}</Text>
        <Text style={styles.title}>{modeHeroCopy.title}</Text>
        <Text style={styles.subtitle}>{modeHeroCopy.subtitle}</Text>
        <View style={styles.heroActions}>
          <View style={styles.workspaceBadge}>
            <Ionicons name="briefcase-outline" size={15} color={colors.brandNavy} />
            <Text style={styles.workspaceBadgeText} numberOfLines={1}>{copy.name}</Text>
          </View>
          <View style={styles.workspaceBadge}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.brandNavy} />
            <Text style={styles.workspaceBadgeText}>Relationship scoped</Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ActivatorBreadcrumb
          navigation={navigation}
          homeRoute={fixedMode ? "KeeprSpaceHome" : "ActivatorHome"}
          current={breadcrumbCurrent}
          homeParams={{
            initialMode: "fleet",
            workspaceId: currentWorkspace?.workspace_id || null,
          }}
          right={(
            <View style={styles.breadcrumbWorkspace}>
              <Ionicons name={currentKind === "oem" ? "business-outline" : currentKind === "dealer" ? "storefront-outline" : currentKind === "pro" ? "briefcase-outline" : "person-outline"} size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{copy.name}</Text>
              <Text style={styles.breadcrumbSwitchText}>{copy.modeMetric}</Text>
            </View>
          )}
        />
        {heroSource ? (
          <ImageBackground
            source={heroSource}
            resizeMode="cover"
            style={styles.hero}
            imageStyle={styles.heroImage}
          >
            {heroInner}
          </ImageBackground>
        ) : (
          <View style={[styles.hero, styles.heroEmpty]}>
            {heroInner}
          </View>
        )}

        <View style={styles.workspaceShell}>
          {currentKind !== "oem" ? (
            <WorkAreaRail
              areas={workAreas}
              mode={mode}
              onChange={(nextMode) => {
                if (nextMode === "addBoat" && currentKind === "oem") {
                  openCoreAddBoat("add_boat");
                  return;
                }
                setMode(nextMode);
              }}
              copy={copy}
              projectionMode={activeProjection}
              onProjectionModeChange={setProjectionMode}
              showProjectionSwitch={projectionSwitchable}
            />
          ) : null}
          <View style={styles.workspaceMain}>
            <View style={styles.commandBar}>
              <View style={styles.commandHeader}>
                <View>
                  <Text style={styles.commandKicker}>
                    {mode === "fleet" ? "Find" : mode === "builds" ? buildsKicker : mode === "templates" ? "Reference" : mode === "profile" ? "Admin" : mode === "needs" ? "Needs Attention" : mode === "messages" ? "Engage" : mode === "addBoat" ? "Add / Connect" : "Network"}
                  </Text>
                  <Text style={styles.commandTitle}>
                    {mode === "fleet" ? "Find a Boat / Owner" : mode === "builds" ? buildsTitle : mode === "templates" ? "Model Catalog" : mode === "profile" ? `${copy.modeMetric} Profile` : mode === "needs" ? "Recent / Needs Attention" : mode === "messages" ? "Messages" : mode === "addBoat" ? "Add Boat or Connect Owner" : copy.networkTitle}
                  </Text>
                </View>
                <View style={styles.commandBadge}>
                  <Text style={styles.commandBadgeText}>{copy.modeMetric}</Text>
                </View>
              </View>
              {projectionSwitchable ? (
                <View style={styles.commandProjectionRow}>
                  <Text style={styles.projectionHint}>
                    Choose whether this job is sales or service focused.
                  </Text>
                  <ProjectionModeSwitch
                    value={projectionMode}
                    onChange={setProjectionMode}
                  />
                </View>
              ) : null}
              <View style={styles.searchRow}>
                <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={mode === "templates" ? "Search models, years, series..." : copy.search}
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
              </View>
              {mode === "fleet" ? (
                <FleetFilters value={fleetFilter} onChange={setFleetFilter} />
              ) : null}
            </View>

            {mode !== "templates" ? (
              <View style={styles.metricsRow}>
                <MetricTile label={copy.primaryMetric} value={counts.visible_boats ?? "0"} icon="boat-outline" />
                <MetricTile label={copy.filteredMetric} value={counts.filtered_boats ?? "0"} icon="filter-outline" />
                <MetricTile label={mode === "builds" ? buildsMetricLabel : "Workspace"} value={mode === "builds" ? buildsMetricValue : copy.modeMetric} icon="compass-outline" />
              </View>
            ) : null}

            {mode === "profile" ? (
              <KeeprSpaceAdminPanel
                profile={brandProfile}
                kind={currentKind}
                config={orgConfig}
                activeTab={adminTab}
                onTabChange={setAdminTab}
                onChangeProfile={setBrandProfile}
                onPickLogo={pickBrandLogo}
                onPickHeader={pickBrandHeader}
                onSaveProfile={currentKind === "owner" ? null : saveBrandProfile}
                onSaveLocation={saveOrgLocation}
                onSaveTeam={saveOrgTeam}
                onSaveAssignment={saveOrgMemberAssignment}
                onSaveService={saveOrgService}
                onSaveCapabilities={saveOrgCapabilities}
                onSaveRelationship={saveOrgRelationship}
                savingProfile={savingProfile}
                savingKey={adminSavingKey}
                uploadingLogo={uploadingBrandImage === "logo"}
                uploadingHeader={uploadingBrandImage === "header"}
                loading={orgConfigLoading}
              />
            ) : mode === "needs" ? (
              <NeedsAttentionPanel data={data} onOpenAsset={openBoat} />
            ) : mode === "messages" ? (
              <MessagesPanel data={data} onOpenAsset={openBoat} />
            ) : mode === "addBoat" || mode === "connect" ? (
              <AddBoatPanel
                mode={mode === "connect" ? "find" : addBoatMode}
                onModeChange={setAddBoatMode}
                query={addBoatQuery}
                onQueryChange={setAddBoatQuery}
                onResolve={resolveAddBoat}
                resolving={addBoatLoading}
                results={addBoatResults}
                onConnect={connectAddBoatAsset}
                connectingId={addBoatConnectingId}
                relationshipPurpose={addBoatPurpose}
                onPurposeChange={setRelationshipPurpose}
                operatingStates={addBoatStates}
                onToggleState={toggleAddBoatState}
                createDraft={newBoatDraft}
                onDraftChange={setNewBoatDraft}
                onPickPhotos={async () => {
                  const photos = await pickActivatorBoatPhotos();
                  if (photos) setNewBoatDraft((current) => ({ ...current, photos }));
                }}
                onCreate={createAddBoat}
                creating={creatingBoat}
                organizationName={copy.name}
              />
            ) : mode === "templates" ? (
              <CatalogPanel
                templates={catalogTemplates}
                templateMediaById={catalogTemplateMediaById}
                loading={catalogLoading}
                onOpen={openCatalogTemplate}
                onOpenSourceReview={openTemplateSourceReview}
                query={search}
                canAuthor={canAuthorCatalog}
                modelDraft={modelDraft}
                onModelDraftChange={setModelDraft}
                onCreateModel={createCatalogModel}
                creatingModel={creatingModel}
              />
            ) : mode === "builds" ? (
              <ProductionBuildsPanel
                templates={catalogTemplates}
                loading={catalogLoading}
                drafts={exactBuildDrafts}
                onBuild={openExactBuild}
                onOpenDraft={openTemplateDraft}
                workspaceKindValue={currentKind}
                onOpenAsset={openBoat}
                onAddBoat={() => setMode("addBoat")}
              />
            ) : mode === "network" ? (
              <NetworkPanel data={data} copy={copy} workspace={currentWorkspace} projectionMode={activeProjection} />
            ) : loading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.brandBlue} />
                <Text style={styles.mutedText}>Preparing your workspace...</Text>
              </View>
            ) : error ? (
              <FoundationPending error={error} />
            ) : boats.length ? (
              mode === "fleet" ? (
                <View style={styles.resultList}>
                  <View style={styles.resultListHeader}>
                    <Text style={styles.sectionKicker}>Results</Text>
                    <Text style={styles.mutedText}>{fleetResults.length} of {boats.length} visible</Text>
                  </View>
                  {fleetResults.length ? fleetResults.map((boat, index) => {
                    const cardAssetId = assetIdForBoat(boat) || `boat-${index}`;
                    return (
                      <BoatResultRow
                        key={cardAssetId}
                        boat={boat}
                        onPress={() => openBoat(boat)}
                        heroUri={assetHeroUrls[cardAssetId] || null}
                      />
                    );
                  }) : (
                    <View style={styles.emptyPanel}>
                      <Text style={styles.emptyTitle}>No boats match this filter</Text>
                      <Text style={styles.mutedText}>Clear the filter or search by HIN, Keepr code, model, owner, or dealer.</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.cardGrid}>
                  {boats.map((boat, index) => {
                  const cardAssetId = assetIdForBoat(boat) || `boat-${index}`;
                  return (
                    <BoatCard
                      key={cardAssetId}
                      boat={boat}
                      onPress={() => openBoat(boat)}
                      view={activeProjection === "service" ? "service" : "default"}
                      heroUri={assetHeroUrls[cardAssetId] || null}
                    />
                  );
                  })}
                </View>
              )
            ) : (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="boat-outline" size={24} color={colors.brandBlue} />
                </View>
                <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
                <Text style={styles.mutedText}>{copy.emptyBody}</Text>
              </View>
            )}
          </View>
        </View>
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
  hero: {
    alignSelf: "stretch",
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    minHeight: 292,
    overflow: "hidden",
    width: "100%",
    ...shadows.sm,
  },
  heroEmpty: {
    backgroundColor: "#111827",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  heroImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  heroOverlay: {
    backgroundColor: "rgba(5, 10, 24, 0.46)",
    flex: 1,
    justifyContent: "flex-end",
    minHeight: 292,
    padding: spacing.xl,
  },
  oemLogo: {
    alignItems: "center",
    backgroundColor: "#050505",
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 78,
    justifyContent: "center",
    position: "absolute",
    right: spacing.xl,
    top: spacing.xl,
    width: 78,
  },
  dealerLogoFallback: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0,
  },
  heroCopy: {
    maxWidth: 760,
  },
  eyebrow: {
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.onPrimary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 39,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 660,
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  workspaceBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    maxWidth: 280,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  workspaceBadgeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "800",
  },
  workspaceShell: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  workAreaRail: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 290,
    flexGrow: 0,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  railHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingBottom: spacing.md,
  },
  railKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  railTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  projectionSwitch: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 4,
  },
  projectionSwitchCompact: {
    marginTop: spacing.md,
  },
  projectionButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.md,
  },
  projectionButtonActive: {
    backgroundColor: colors.brandNavy,
  },
  projectionButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  projectionButtonTextActive: {
    color: colors.onPrimary,
  },
  railList: {
    gap: spacing.sm,
  },
  workAreaButton: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 82,
    padding: spacing.md,
  },
  workAreaButtonActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  workAreaIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  workAreaIconActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  workAreaTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  workAreaTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  workAreaLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  workAreaLabelActive: {
    color: colors.brandNavy,
  },
  workAreaDescription: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  workAreaDescriptionActive: {
    color: colors.textSecondary,
  },
  authorityPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  authorityPillText: {
    color: colors.brandBlue,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusPanel: {
    backgroundColor: "#0F172A",
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  statusPanelKicker: {
    color: "#BFDBFE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusMetric: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 96,
  },
  statusMetricValue: {
    color: colors.onPrimary,
    fontSize: 19,
    fontWeight: "900",
  },
  statusMetricLabel: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 2,
  },
  workspaceMain: {
    flex: 1,
    gap: spacing.lg,
    minWidth: 420,
  },
  commandBar: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  commandHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  commandProjectionRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  projectionHint: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  commandKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  commandTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  commandBadge: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  commandBadgeText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    outlineStyle: "none",
  },
  cxLanding: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  cxLandingHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  cxJobGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  cxJobCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: "31%",
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 64,
    minWidth: 190,
    padding: spacing.md,
  },
  cxJobIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  cxJobText: {
    flex: 1,
    minWidth: 0,
  },
  cxJobTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  cxJobMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  modeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.lg,
  },
  modeButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  modeButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  modeButtonTextActive: {
    color: colors.onPrimary,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metricTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 148,
    padding: spacing.md,
    ...shadows.sm,
  },
  metricIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "900",
    marginTop: spacing.md,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  networkPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  servicePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  serviceList: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  serviceRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 74,
    padding: spacing.md,
  },
  serviceRowIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  serviceRowBody: {
    flex: 1,
    minWidth: 0,
  },
  serviceRowKicker: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  serviceRowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  serviceRowMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  emptyPanelCompact: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
  },
  segmentedControl: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: 4,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  segmentButtonActive: {
    backgroundColor: colors.brandNavy,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: colors.onPrimary,
  },
  addBoatSection: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  photoPickButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  photoPickText: {
    color: colors.brandBlue,
    fontSize: 13,
    fontWeight: "900",
  },
  photoPreviewRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  photoPreviewWrap: {
    borderRadius: radius.sm,
    height: 72,
    overflow: "hidden",
    width: 96,
  },
  photoPreview: {
    height: "100%",
    width: "100%",
  },
  photoHeroBadge: {
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderRadius: radius.xs,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: "absolute",
    top: 6,
  },
  photoHeroBadgeText: {
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: "900",
  },
  optionChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  optionChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  optionChipSelected: {
    backgroundColor: "#EFF6FF",
    borderColor: colors.brandBlue,
  },
  optionChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  optionChipTextSelected: {
    color: colors.brandBlue,
  },
  addKacSearch: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  addKacButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  addKacButtonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  addKacButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  addKacButtonTextSecondary: {
    color: colors.textSecondary,
  },
  addKacResult: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  createBoatCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  createBoatButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  createBoatButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  catalogPanel: {
    backgroundColor: "transparent",
    borderRadius: radius.sm,
    paddingTop: spacing.sm,
  },
  networkHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "space-between",
  },
  sectionKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  networkCount: {
    alignItems: "flex-end",
  },
  networkCountValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
  },
  networkCountLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  networkText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
    maxWidth: 760,
  },
  inlineChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  catalogGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  createModelPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  createModelGrid: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  createModelInput: {
    backgroundColor: "#fff",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    flexGrow: 1,
    flexBasis: 180,
    fontWeight: "700",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  createModelButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  createModelButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  catalogStageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  catalogFilterGroups: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  catalogFilterGroup: {
    gap: spacing.xs,
  },
  catalogFilterLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  catalogStageChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 112,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  catalogStageValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  catalogStageLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
    textTransform: "uppercase",
  },
  catalogCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: 460,
    minWidth: 310,
    overflow: "hidden",
    ...shadows.sm,
  },
  catalogDraftCard: {
    justifyContent: "center",
    minHeight: 286,
    paddingTop: spacing.lg,
  },
  catalogDraftIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 44,
    justifyContent: "center",
    marginHorizontal: spacing.lg,
    width: 44,
  },
  catalogImage: {
    backgroundColor: "#0B1220",
    height: 178,
    width: "100%",
  },
  catalogImageEmpty: {
    alignItems: "flex-start",
    backgroundColor: colors.brandNavy,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  catalogImageAsset: {
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center bottom",
  },
  catalogShade: {
    alignItems: "flex-start",
    backgroundColor: "rgba(10,17,35,0.08)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  catalogBadge: {
    alignItems: "center",
    backgroundColor: "rgba(19,26,68,0.86)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  catalogBadgeText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  catalogBody: {
    padding: spacing.lg,
  },
  catalogKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  catalogTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  catalogStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  catalogStatusPill: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  catalogStatus_active: {
    backgroundColor: "#ECFDF5",
    borderColor: "#BBF7D0",
  },
  catalogStatus_previous: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  catalogStatus_retired: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
  },
  catalogStatus_review: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  catalogStatusText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  catalogText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  catalogSpecs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  catalogSpec: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  catalogFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  catalogFooterText: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  catalogFooterActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  catalogActionButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  catalogActionText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  centeredSmall: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 90,
  },
  mutedTextLeft: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.lg,
  },
  productionPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  newBuildCatalog: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  newBuildHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  newBuildKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  newBuildTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  newBuildCount: {
    alignItems: "flex-end",
  },
  newBuildCountValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  newBuildCountLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  seriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  seriesColumn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 180,
    padding: spacing.md,
  },
  seriesTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  modelList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modelOption: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  modelOptionReady: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  modelOptionDraft: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  modelOptionText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  modelOptionTextReady: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  modelOptionTextDraft: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  modelOptionState: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modelOptionStateReady: {
    color: colors.brandBlue,
  },
  modelOptionStateDraft: {
    color: "#B45309",
  },
  draftNotice: {
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  draftNoticeIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  draftNoticeText: {
    flex: 1,
  },
  draftNoticeTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  draftNoticeBody: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  draftNoticeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  draftNoticeButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  templateWorkPanel: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  templateWorkHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  templateWorkGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  templateWorkCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.md,
    minHeight: 76,
    minWidth: 280,
    padding: spacing.md,
  },
  templateWorkIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  templateWorkText: {
    flex: 1,
    minWidth: 0,
  },
  templateWorkTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  templateWorkMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  brandMatrix: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  brandOption: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 42,
    minWidth: 150,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  brandOptionActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  brandOptionText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  brandOptionTextActive: {
    color: colors.brandNavy,
  },
  brandOptionState: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 3,
    textTransform: "uppercase",
  },
  brandOptionStateActive: {
    color: colors.brandBlue,
  },
  stageStrip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  stageItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 28,
  },
  stageDot: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 15,
    width: 15,
  },
  stageDotActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  stageText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  stageTextActive: {
    color: colors.textPrimary,
  },
  buildQueue: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  currentBuildsPanel: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  currentBuildsHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  currentBuildsCount: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  buildQueueRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    minHeight: 78,
    padding: spacing.md,
  },
  buildQueueIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  buildQueueText: {
    flex: 1,
    minWidth: 220,
  },
  buildQueueTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  buildQueueTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  buildQueueMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  buildQueueButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  buildQueueButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  buildQueueSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  buildQueueSecondaryButtonText: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  layerMap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  layerMapItem: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    minWidth: 180,
    padding: spacing.md,
  },
  layerMapLabel: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  layerMapValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 3,
  },
  smallChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    maxWidth: 240,
    minWidth: 160,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  smallChipText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  smallChipMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    textTransform: "capitalize",
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  fleetFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  fleetFilterChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fleetFilterChipActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
  },
  fleetFilterText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  fleetFilterTextActive: {
    color: colors.brandBlue,
  },
  resultList: {
    gap: spacing.sm,
  },
  resultListHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  resultRow: {
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 118,
    overflow: "hidden",
    padding: spacing.sm,
    ...shadows.sm,
  },
  resultThumb: {
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    height: 96,
    justifyContent: "flex-end",
    overflow: "hidden",
    width: 144,
  },
  resultThumbImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
  },
  resultImageBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(19,26,68,0.84)",
    borderRadius: radius.sm,
    margin: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  resultImageBadgeText: {
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  resultMain: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minWidth: 0,
  },
  resultTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  resultTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  resultSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  resultMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  resultMetaCell: {
    minWidth: 128,
  },
  resultOpen: {
    alignItems: "center",
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minWidth: 120,
    paddingHorizontal: spacing.sm,
  },
  boatCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: 460,
    minWidth: 310,
    overflow: "hidden",
    ...shadows.sm,
  },
  cardImage: {
    backgroundColor: "#0B1220",
    height: 176,
    width: "100%",
  },
  cardImageAsset: {
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  cardShade: {
    alignItems: "flex-start",
    backgroundColor: "rgba(10,17,35,0.16)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  statusRibbon: {
    alignItems: "center",
    backgroundColor: "rgba(19,26,68,0.84)",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusRibbonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  cardBody: {
    padding: spacing.lg,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  statePill: {
    borderRadius: radius.sm,
    maxWidth: 132,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statePill_good: {
    backgroundColor: "#ECFDF5",
  },
  statePill_watch: {
    backgroundColor: "#FFFBEB",
  },
  statePill_neutral: {
    backgroundColor: colors.surfaceSubtle,
  },
  statePillText: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  statePillText_good: {
    color: colors.accentGreen,
  },
  statePillText_watch: {
    color: "#B45309",
  },
  statePillText_neutral: {
    color: colors.textSecondary,
  },
  identityStrip: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  stripLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stripValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  openTwinText: {
    color: colors.brandBlue,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "900",
  },
  relationshipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  serviceRelationshipStrip: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  serviceRelationshipRow: {
    flexDirection: "row",
    gap: spacing.xl,
  },
  serviceRelationshipOpen: {
    alignItems: "center",
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  serviceRelationshipOpenText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  relationshipCell: {
    flexBasis: "47%",
    minWidth: 130,
  },
  relationshipCellWide: {
    flexBasis: "100%",
  },
  relationshipLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  relationshipValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  oemProfilePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  oemPreviewHero: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  oemPreviewCover: {
    backgroundColor: "#0B1220",
    minHeight: 260,
  },
  brandPreviewEmpty: {
    backgroundColor: "#111827",
  },
  oemPreviewCoverImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  oemPreviewShade: {
    alignItems: "flex-end",
    backgroundColor: "rgba(5,10,24,0.46)",
    flex: 1,
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 260,
    padding: spacing.xl,
  },
  oemPreviewLogo: {
    alignItems: "center",
    backgroundColor: "#050505",
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 92,
    justifyContent: "center",
    overflow: "hidden",
    width: 92,
  },
  oemPreviewLogoImage: {
    height: "100%",
    width: "100%",
  },
  oemPreviewCopy: {
    flex: 1,
    minWidth: 220,
  },
  oemPreviewKicker: {
    color: "#BFDBFE",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  oemPreviewTitle: {
    color: colors.onPrimary,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: spacing.xs,
  },
  oemPreviewText: {
    color: "#E5E7EB",
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    maxWidth: 720,
  },
  oemUploadGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  oemUploadTile: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 170,
    minWidth: 220,
    padding: spacing.lg,
  },
  oemUploadTileWide: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    borderWidth: 1,
    flex: 2,
    justifyContent: "center",
    minHeight: 170,
    minWidth: 320,
    overflow: "hidden",
    padding: spacing.lg,
  },
  oemUploadLogoPreview: {
    height: 76,
    width: 120,
  },
  oemUploadHeaderPreview: {
    borderRadius: radius.sm,
    height: 92,
    marginBottom: spacing.sm,
    width: "100%",
  },
  oemUploadTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  oemUploadText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
    maxWidth: 420,
    textAlign: "center",
  },
  oemFormGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  oemField: {
    flexGrow: 1,
    minWidth: 260,
    width: "31%",
  },
  oemFieldWide: {
    flexBasis: "100%",
  },
  oemFieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: spacing.xs,
  },
  oemInput: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 42,
    outlineStyle: "none",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  oemTextArea: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  oemFlowCard: {
    alignItems: "flex-start",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
  },
  oemFlowCopy: {
    flex: 1,
  },
  oemFlowTitle: {
    color: colors.brandNavy,
    fontSize: 14,
    fontWeight: "900",
  },
  oemFlowText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  profileSaveButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  profileSaveButtonDisabled: {
    opacity: 0.55,
  },
  profileSaveButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  adminTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  adminTab: {
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
  adminTabActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  adminTabText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  adminTabTextActive: {
    color: colors.onPrimary,
  },
  adminSection: {
    gap: spacing.lg,
  },
  adminList: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  adminRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminRowContent: {
    flex: 1,
    minWidth: 0,
  },
  adminRowActions: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  adminRowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  adminRowMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  adminStatus: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  adminNote: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.md,
  },
  adminForm: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  adminFormHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  adminFormTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
  },
  adminFormHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  adminResetText: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  adminMiniActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  adminMiniButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  adminMiniButtonDanger: {
    borderColor: "#FCA5A5",
  },
  adminMiniButtonPrimary: {
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
  },
  adminMiniButtonText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
  },
  adminMiniButtonDangerText: {
    color: "#DC2626",
  },
  adminMiniButtonPrimaryText: {
    color: colors.brandBlue,
  },
  adminChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  adminChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  adminChipActive: {
    backgroundColor: "#EFF6FF",
    borderColor: colors.brandBlue,
  },
  adminChipText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
  },
  adminChipTextActive: {
    color: colors.brandBlue,
  },
  centered: {
    alignItems: "center",
    gap: spacing.md,
    justifyContent: "center",
    minHeight: 180,
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
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
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
    maxWidth: 720,
    textAlign: "center",
  },
  microText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
    maxWidth: 720,
    textAlign: "center",
  },
});
