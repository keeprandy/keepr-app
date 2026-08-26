import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { getCatalogTemplateDetail, getCatalogTemplates } from "../lib/activatorApi";
import {
  connectKeeprSpaceBoat,
  createKeeprSpaceBoat,
  getKeeprSpacePortfolio,
  resolveKeeprSpaceKac,
} from "../lib/keeprspaceApi";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

const EMPTY_BOAT = {
  year: "",
  make: "",
  model: "",
  kac: "",
  hin: "",
  name: "",
  lengthFeet: "",
  location: "",
  stockNumber: "",
  listingUrl: "",
  externalAssetId: "",
  customerExternalSystem: "g2",
  customerExternalId: "",
  customerDisplayName: "",
  customerEmail: "",
  customerPhone: "",
  ownerName: "",
  ownerEmail: "",
  dealerName: "",
  dealerContact: "",
  dealerCrmUrl: "",
  oemContactName: "",
  oemContactEmail: "",
  oemDepartment: "Customer Relations",
  factoryResourceTitle: "",
  factoryResourceUrl: "",
  factoryResourceType: "build_sheet",
  warrantyReference: "",
  lifecycleState: "Unclaimed",
  engine: "",
  engineHours: "",
  hullMaterial: "",
  registrationNumber: "",
  notes: "",
  assetMode: "commercial",
  commercialEntity: "",
  purchasePrice: "",
  estimatedValue: "",
  purchaseDate: "",
  newUsed: "",
  photos: [],
};

const OPERATING_STATES = [
  "Unclaimed",
  "Owner Connected",
  "Dealer Connected",
  "Enriched",
  "Active",
  "Owner Ready",
  "In Inventory",
  "For Sale",
  "Delivery Prep",
  "Owned / Connected",
  "Under Stewardship",
  "In Service",
  "Stored",
  "Spring Commissioning",
];

const PURPOSES = [
  {
    key: "oem_factory",
    rpcPurpose: "selling_dealer",
    label: "OEM / Factory Context",
    description: "Connect the manufacturer workspace to model, build, resources, and owner handoff context.",
    icon: "business-outline",
    types: ["keeproem"],
    capabilities: ["oem", "manufacturer", "catalog"],
    defaultState: "Owner Ready",
  },
  {
    key: "our_boat",
    rpcPurpose: "selling_dealer",
    label: "Inventory / Selling Dealer",
    description: "Connect this boat as workspace inventory or represented sales stock.",
    icon: "storefront-outline",
    types: ["keeprpro", "keeprdealer"],
    capabilities: ["inventory", "sales"],
    defaultState: "For Sale",
  },
  {
    key: "service",
    label: "Service",
    description: "Connect this boat for service continuity and customer follow-through.",
    icon: "construct-outline",
    types: ["keeprpro", "keeprdealer"],
    capabilities: ["service", "services", "fleet"],
    defaultState: "In Service",
  },
  {
    key: "stewardship",
    label: "Stewardship",
    description: "Connect this boat as an actively stewarded vessel.",
    icon: "shield-checkmark-outline",
    types: ["keeprpro"],
    capabilities: ["stewardship"],
    defaultState: "Under Stewardship",
  },
  {
    key: "storage",
    label: "Storage",
    description: "Connect this boat for storage or custody operations.",
    icon: "cube-outline",
    types: ["keeprpro", "keeprdealer"],
    capabilities: ["storage"],
    defaultState: "Stored",
  },
  {
    key: "sales",
    label: "Selling Dealer",
    description: "Connect this boat into a dealer sales or inventory projection.",
    icon: "pricetag-outline",
    types: ["keeprdealer"],
    capabilities: ["sales", "inventory"],
    defaultState: "For Sale",
  },
  {
    key: "delivery",
    label: "Delivery Dealer",
    description: "Connect this boat for dealer delivery and handoff.",
    icon: "trail-sign-outline",
    types: ["keeprpro", "keeprdealer"],
    capabilities: ["delivery"],
    defaultState: "Delivery Prep",
  },
];

function compact(parts) {
  return parts.filter(Boolean).join(" • ");
}

function workspaceName(workspace) {
  return workspace?.display_name || workspace?.name || workspace?.label || "KeeprSpace";
}

function capabilitiesForWorkspace(workspace) {
  const raw =
    workspace?.workspace_capabilities ||
    workspace?.capabilities ||
    workspace?.metadata?.capabilities ||
    [];
  if (Array.isArray(raw)) return raw.map((item) => String(item).toLowerCase());
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).toLowerCase());
  }
  return [];
}

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanObject(obj) {
  return Object.entries(obj).reduce((next, [key, value]) => {
    if (value === null || value === undefined || value === "") return next;
    if (Array.isArray(value) && !value.length) return next;
    if (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return next;
    next[key] = value;
    return next;
  }, {});
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

async function addFactoryResourceForBoat({ assetId, organizationId, workspace, boat }) {
  const title = cleanText(boat.factoryResourceTitle);
  const url = cleanText(boat.factoryResourceUrl);
  const warrantyReference = cleanText(boat.warrantyReference);
  if (!assetId || !organizationId || (!title && !url && !warrantyReference)) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const resourceType = cleanText(boat.factoryResourceType) || "build_sheet";
  const safeResourceType = [
    "oem_catalog",
    "model_page",
    "manual",
    "dealer_listing",
    "build_sheet",
    "survey",
    "title",
    "registration",
    "photo",
    "service_document",
    "source_snapshot",
    "other",
  ].includes(resourceType)
    ? resourceType
    : "other";
  const resourceTitle = title || warrantyReference || "Factory context";

  const { data, error } = await supabase
    .from("asset_resources")
    .insert({
      resource_type: safeResourceType,
      title: resourceTitle,
      url,
      source_name: workspaceName(workspace),
      source_platform: "Keepr OEM Activator",
      source_url: url,
      captured_at: new Date().toISOString(),
      authority_state: "oem_as_built",
      rights_status: "private",
      applies_to_type: "asset",
      applies_to_id: assetId,
      created_by: userData?.user?.id || null,
      metadata: cleanObject({
        asset_id: assetId,
        organization_id: organizationId,
        source_context: "oem_activator_factory_context",
        warranty_reference: warrantyReference,
        oem_contact_name: cleanText(boat.oemContactName),
        oem_contact_email: cleanText(boat.oemContactEmail),
        oem_department: cleanText(boat.oemDepartment),
      }),
    })
    .select("id,title,resource_type")
    .single();

  if (error) throw error;
  return data || null;
}

function relationshipMetadataForBoat(boat, selectedPurpose, operatingStates) {
  const stockNumber = cleanText(boat.stockNumber);
  const externalAssetId = cleanText(boat.externalAssetId) || stockNumber;
  const inventory = cleanObject({
    stock_number: stockNumber,
    listing_url: cleanText(boat.listingUrl),
    location: cleanText(boat.location),
    external_asset_id: externalAssetId,
  });
  const customer = cleanObject({
    external_system: cleanText(boat.customerExternalSystem),
    external_customer_id: cleanText(boat.customerExternalId),
    display_name: cleanText(boat.customerDisplayName),
    email: cleanText(boat.customerEmail),
    phone: cleanText(boat.customerPhone),
  });
  const owner = cleanObject({
    display_name: cleanText(boat.ownerName) || cleanText(boat.customerDisplayName),
    email: cleanText(boat.ownerEmail) || cleanText(boat.customerEmail),
    connection_state: cleanText(boat.lifecycleState),
  });
  const dealer = cleanObject({
    display_name: cleanText(boat.dealerName),
    contact: cleanText(boat.dealerContact),
    external_crm_url: cleanText(boat.dealerCrmUrl),
  });
  const oemContact = cleanObject({
    display_name: cleanText(boat.oemContactName),
    email: cleanText(boat.oemContactEmail),
    department: cleanText(boat.oemDepartment),
  });
  const factoryContext = cleanObject({
    source: selectedPurpose?.key === "oem_factory" ? "oem_activator" : null,
    lifecycle_state: cleanText(boat.lifecycleState),
    warranty_reference: cleanText(boat.warrantyReference),
    resource_title: cleanText(boat.factoryResourceTitle),
    resource_url: cleanText(boat.factoryResourceUrl),
    resource_type: cleanText(boat.factoryResourceType),
  });
  const storageIntent =
    selectedPurpose?.key === "storage" ||
    operatingStates.includes("Stored") ||
    operatingStates.includes("Spring Commissioning");

  return cleanObject({
    inventory,
    customer,
    owner,
    dealer,
    oem_contact: oemContact,
    factory_context: factoryContext,
    projection: selectedPurpose?.key === "oem_factory"
      ? {
          role: "oem",
          relationship_label: "OEM / Factory Context",
          connect_owner_next: Boolean(owner.email),
          connect_dealer_next: Boolean(dealer.display_name || dealer.external_crm_url),
        }
      : {},
    intake: storageIntent
      ? {
          receive_for_storage: true,
          capture_condition_photos: "after_asset_create",
          spring_commissioning_ready: operatingStates.includes("Spring Commissioning"),
        }
      : {},
  });
}

function relationshipOptions(workspace) {
  const type = workspace?.workspace_type;
  const capabilities = capabilitiesForWorkspace(workspace);
  const supported = PURPOSES.filter((purpose) => {
    if (purpose.types.includes(type)) return true;
    return purpose.capabilities.some((capability) => capabilities.includes(capability));
  });

  if (supported.length) return supported;
  if (type === "keeproem") return [];
  return PURPOSES.filter((purpose) => purpose.key === "service");
}

function titleForMatch(match) {
  return compact([
    match?.year,
    match?.make,
    match?.model,
  ]) || match?.asset_name || match?.kac_id || "Existing boat";
}

function normalizeOrgBoat(boat, organizationId) {
  const identity = boat?.identity || {};
  return {
    asset_id: boat?.asset_id || boat?.id,
    asset_name: boat?.asset_name || boat?.name || compact([identity.year || boat?.year, identity.make || boat?.make, identity.model || boat?.model]),
    kac_id: boat?.kac_id,
    year: identity.year || boat?.year,
    make: identity.make || boat?.make,
    model: identity.model || boat?.model,
    organization_id: boat?.organization_id || organizationId,
    already_connected: true,
    source: "org",
    public_context: boat?.relationship_type || boat?.service_relationship?.relationship_type || boat?.dealer_relationship?.relationship_type || "Authorized workspace asset",
    stewardship_id: boat?.stewardship_id || boat?.service_relationship?.stewardship_id || null,
  };
}

function templateTitle(template) {
  return compact([
    template?.manufacturer || template?.brand_name || template?.make,
    template?.model || template?.model_name,
    template?.model_year || template?.year,
  ]) || template?.template_name || template?.name || template?.template_key || "Catalog template";
}

function activatorCopy(workspace) {
  if (workspace?.workspace_type === "keeprdealer") {
    return {
      eyebrow: "Dealer Sales",
      title: "Sales Activator",
      subtitle: "Resolve inventory, create canonical boats, connect buyers and dealers, and carry delivery into owner continuity.",
      badge: "Sales",
      current: "Sales",
    };
  }
  if (workspace?.workspace_type === "keeproem") {
    return {
      eyebrow: "OEM Activator",
      title: "Activator",
      subtitle: "Build from catalog, configure exact boats, connect dealers, and activate owner-ready KACs.",
      badge: "OEM",
      current: "Activator",
    };
  }
  return {
    eyebrow: "KeeprSpace Activator",
    title: "Activator",
    subtitle: "Resolve existing boats before create, capture configuration metadata, and connect the asset into this KeeprSpace.",
    badge: "Activator",
    current: "Activator",
  };
}

function capabilityItems(workspace) {
  const dealer = workspace?.workspace_type === "keeprdealer";
  const oem = workspace?.workspace_type === "keeproem";
  return [
    {
      key: "inventory",
      label: dealer ? "Inventory" : "Active Boats",
      icon: "boat-outline",
      status: "Fleet",
      active: false,
    },
    {
      key: "add",
      label: "Add Boat",
      icon: "add-circle-outline",
      status: "Ready",
      active: true,
    },
    {
      key: "configure",
      label: "Configure Boat",
      icon: "options-outline",
      status: "Next",
      active: false,
    },
    {
      key: "catalog",
      label: oem ? "Model Catalog" : "Catalog Selection",
      icon: "albums-outline",
      status: "Next",
      active: false,
    },
    {
      key: "customer",
      label: dealer ? "Buyer Association" : "Customer Association",
      icon: "people-outline",
      status: "Next",
      active: false,
    },
    {
      key: "delivery",
      label: dealer ? "Delivery / Activation" : "Relationship Activation",
      icon: "trail-sign-outline",
      status: "Next",
      active: false,
    },
  ];
}

function CapabilityRail({ items, onSelect }) {
  return (
    <View style={styles.capabilityRail}>
      {items.map((item) => {
        const content = (
          <>
            <View style={[styles.capabilityIcon, item.active && styles.capabilityIconActive]}>
              <Ionicons name={item.icon} size={18} color={item.active ? colors.onPrimary : colors.brandBlue} />
            </View>
            <View style={styles.capabilityTextWrap}>
              <Text style={[styles.capabilityLabel, item.active && styles.capabilityLabelActive]}>{item.label}</Text>
              <Text style={styles.capabilityStatus}>{item.status}</Text>
            </View>
          </>
        );
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.capabilityCard, item.active && styles.capabilityCardActive]}
            activeOpacity={0.86}
            onPress={() => onSelect?.(item)}
          >
            {content}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = "default" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

function LargeField({ label, value, onChangeText, placeholder }) {
  return (
    <View style={styles.fieldFull}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        style={[styles.input, styles.notesInput]}
      />
    </View>
  );
}

function PurposeCard({ purpose, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.purposeCard, selected && styles.purposeCardActive]}
      activeOpacity={0.86}
      onPress={onPress}
    >
      <View style={[styles.purposeIcon, selected && styles.purposeIconActive]}>
        <Ionicons name={purpose.icon} size={18} color={selected ? colors.onPrimary : colors.brandBlue} />
      </View>
      <View style={styles.purposeBody}>
        <Text style={[styles.purposeTitle, selected && styles.purposeTitleActive]}>{purpose.label}</Text>
        <Text style={styles.purposeDescription}>{purpose.description}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function KeeprSpaceAddBoatScreen({ navigation }) {
  const { currentWorkspace } = useWorkspace();
  const organizationId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
  const workspaceId = currentWorkspace?.workspace_id || null;
  const options = useMemo(() => relationshipOptions(currentWorkspace), [currentWorkspace]);
  const [relationshipPurpose, setRelationshipPurpose] = useState(options[0]?.key || "service");
  const selectedPurpose = options.find((option) => option.key === relationshipPurpose) || options[0] || null;
  const rpcRelationshipPurpose = selectedPurpose?.rpcPurpose || relationshipPurpose;
  const [operatingStates, setOperatingStates] = useState(selectedPurpose?.defaultState ? [selectedPurpose.defaultState] : []);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState("org");
  const [resolving, setResolving] = useState(false);
  const [orgSearchResult, setOrgSearchResult] = useState(null);
  const [networkResolveResult, setNetworkResolveResult] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [boat, setBoat] = useState(EMPTY_BOAT);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateDetail, setTemplateDetail] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [message, setMessage] = useState(null);
  const [showAllContext, setShowAllContext] = useState(false);

  useEffect(() => {
    if (!options.length) return;
    if (!options.some((option) => option.key === relationshipPurpose)) {
      setRelationshipPurpose(options[0].key);
      setOperatingStates(options[0].defaultState ? [options[0].defaultState] : []);
    }
  }, [options, relationshipPurpose]);

  useEffect(() => {
    let active = true;
    getCatalogTemplates(organizationId)
      .then((items) => {
        if (active) setTemplates(items || []);
      })
      .catch(() => {
        if (active) setTemplates([]);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  const updateBoat = (key, value) => {
    setBoat((prev) => ({ ...prev, [key]: value }));
    setConfirmCreate(false);
  };

  const toggleOperatingState = (state) => {
    setOperatingStates((prev) => (
      prev.includes(state)
        ? prev.filter((item) => item !== state)
        : [...prev, state]
    ));
  };

  const runOrgSearch = useCallback(async () => {
    if (!organizationId) return;
    setResolving(true);
    setMessage(null);
    setSelectedMatch(null);
    try {
      const result = await getKeeprSpacePortfolio({
        organizationId,
        search: query,
        limit: 50,
        offset: 0,
      });
      setOrgSearchResult({
        query,
        matches: (result?.boats || []).map((boat) => normalizeOrgBoat(boat, organizationId)),
      });
    } catch (err) {
      setOrgSearchResult(null);
      setMessage({ tone: "danger", text: err?.message || "Could not search this workspace." });
    } finally {
      setResolving(false);
    }
  }, [organizationId, query]);

  const runNetworkResolve = useCallback(async () => {
    if (!query.trim() || !organizationId) return;
    setResolving(true);
    setMessage(null);
    setSelectedMatch(null);
    try {
      const result = await resolveKeeprSpaceKac({
        query,
        organizationId,
      });
      setNetworkResolveResult(result || { matches: [] });
    } catch (err) {
      setNetworkResolveResult(null);
      setMessage({ tone: "danger", text: err?.message || "Could not resolve that boat." });
    } finally {
      setResolving(false);
    }
  }, [organizationId, query]);

  const runSearch = searchMode === "org" ? runOrgSearch : runNetworkResolve;

  const selectTemplate = async (template) => {
    setSelectedTemplate(template);
    setTemplateDetail(null);
    setTemplateLoading(true);
    setConfirmCreate(false);
    setBoat((prev) => ({
      ...prev,
      make: prev.make || template?.manufacturer || template?.brand_name || template?.make || "",
      model: prev.model || template?.model || template?.model_name || "",
      year: prev.year || String(template?.model_year || template?.year || ""),
    }));

    try {
      const detail = await getCatalogTemplateDetail({
        templateId: template?.template_id || template?.id || null,
        templateKey: template?.template_key || null,
      });
      setTemplateDetail(detail);
    } catch (_) {
      setTemplateDetail(null);
    } finally {
      setTemplateLoading(false);
    }
  };

  const openBoat = (result) => {
    const assetId = result?.asset_id || result?.asset?.id;
    if (!assetId) return;
    navigation.navigate("KeeprSpaceBoat", {
      assetId,
      kac: result?.kac_id,
      organizationId,
      stewardshipId: result?.stewardship_id || null,
      parentRoute: currentWorkspace?.workspace_type === "keeproem" ? "ActivatorHome" : "KeeprSpaceFleet",
      workspaceId,
      systemsRole: currentWorkspace?.workspace_type === "keeproem" ? "oem" : null,
    });
  };

  const connectSelected = async () => {
    const assetId = selectedMatch?.asset_id || selectedMatch?.id;
    if (!assetId || !organizationId || !selectedPurpose) return;
    setSubmitting(true);
    setMessage(null);
    try {
      if (selectedMatch?.already_connected || selectedMatch?.source === "org") {
        await addFactoryResourceForBoat({
          assetId,
          organizationId,
          workspace: currentWorkspace,
          boat,
        });
        openBoat(selectedMatch);
        return;
      }
      const result = await connectKeeprSpaceBoat({
        assetId,
        organizationId,
        relationshipPurpose: rpcRelationshipPurpose,
        operatingStates,
        relationshipMetadata: relationshipMetadataForBoat(boat, selectedPurpose, operatingStates),
      });
      await addFactoryResourceForBoat({
        assetId,
        organizationId,
        workspace: currentWorkspace,
        boat,
      });
      openBoat(result);
    } catch (err) {
      setMessage({ tone: "danger", text: err?.message || "Could not connect this boat." });
    } finally {
      setSubmitting(false);
    }
  };

  const createNew = async () => {
    if (!selectedPurpose) return;
    if (!boat.year.trim() || !boat.make.trim() || !boat.model.trim()) {
      setMessage({ tone: "danger", text: "Year, make, and model are required before creating a canonical boat." });
      return;
    }
    const yearNumber = Number.parseInt(boat.year.trim(), 10);
    const lengthNumber = boat.lengthFeet.trim() ? Number.parseFloat(boat.lengthFeet.trim()) : null;
    const hoursNumber = boat.engineHours.trim() ? Number.parseFloat(boat.engineHours.trim()) : null;
    if (Number.isNaN(yearNumber) || yearNumber < 1900 || yearNumber > 2100) {
      setMessage({ tone: "danger", text: "Enter a valid boat year." });
      return;
    }
    if (boat.lengthFeet.trim() && (Number.isNaN(lengthNumber) || lengthNumber <= 0)) {
      setMessage({ tone: "danger", text: "Length must be a number in feet." });
      return;
    }
    if (boat.engineHours.trim() && Number.isNaN(hoursNumber)) {
      setMessage({ tone: "danger", text: "Engine hours must be a number." });
      return;
    }
    if (!confirmCreate) {
      setConfirmCreate(true);
      const hasStrongIdentity = boat.kac.trim() || boat.hin.trim() || boat.externalAssetId.trim();
      setMessage({
        tone: "warning",
        text: hasStrongIdentity
          ? "Review once more. Keepr will check the KAC, HIN, stock, or listing identity before creating a new boat."
          : `No HIN or KAC was entered. That is okay for inventory. Confirm if ${workspaceName(currentWorkspace)}'s stock/listing details identify this boat.`,
      });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const result = await createKeeprSpaceBoat({
        organizationId,
        relationshipPurpose: rpcRelationshipPurpose,
        operatingStates,
        boat: {
          kac_id: boat.kac.trim() || null,
          hin: boat.hin.trim() || null,
          year: yearNumber,
          make: boat.make.trim(),
          model: boat.model.trim(),
          name: boat.name.trim() || null,
          length_feet: lengthNumber,
          location: boat.location.trim() || null,
          engine: boat.engine.trim() || null,
          engine_type: boat.engine.trim() || null,
          engine_hours: hoursNumber,
          hull_material: boat.hullMaterial.trim() || null,
          registration_number: boat.registrationNumber.trim() || null,
          notes: boat.notes.trim() || null,
          asset_mode: boat.assetMode,
          commercial_entity: boat.assetMode === "commercial" ? boat.commercialEntity.trim() || null : null,
          purchase_price: boat.purchasePrice.trim() || null,
          estimated_value: boat.estimatedValue.trim() || null,
          purchase_date: boat.purchaseDate.trim() || null,
          new_used: boat.newUsed.trim() || null,
          catalog_template_id: selectedTemplate?.template_id || selectedTemplate?.id || null,
          catalog_template_key: selectedTemplate?.template_key || null,
        },
        relationshipMetadata: relationshipMetadataForBoat(boat, selectedPurpose, operatingStates),
      });
      await uploadActivatorBoatPhotos({
        assetId: result?.asset_id || result?.asset?.id || result?.id || null,
        photos: boat.photos || [],
      });
      await addFactoryResourceForBoat({
        assetId: result?.asset_id || result?.asset?.id || result?.id || null,
        organizationId,
        workspace: currentWorkspace,
        boat,
      });
      openBoat(result);
    } catch (err) {
      setMessage({ tone: "danger", text: err?.message || "Could not create this boat." });
    } finally {
      setSubmitting(false);
    }
  };

  const activeResult = searchMode === "org" ? orgSearchResult : networkResolveResult;
  const matches = activeResult?.matches || [];
  const noSupportedPurpose = !options.length;
  const copy = useMemo(() => activatorCopy(currentWorkspace), [currentWorkspace]);
  const capabilities = useMemo(() => capabilityItems(currentWorkspace), [currentWorkspace]);
  const isOemWorkspace = currentWorkspace?.workspace_type === "keeproem";
  const selectedBoatLabel = selectedMatch?.asset_name || (selectedMatch ? titleForMatch(selectedMatch) : null);
  const activationState = boat.lifecycleState || operatingStates[0] || "Unclaimed";
  const ownerLabel = boat.ownerName || boat.ownerEmail || boat.customerDisplayName || boat.customerEmail || "Unclaimed / not connected yet";
  const dealerLabel = boat.dealerName || "Not connected yet";
  const oemContactLabel = compact([boat.oemContactName, boat.oemDepartment]) || "Not assigned yet";
  const factoryResourceLabel = boat.factoryResourceTitle || boat.warrantyReference || boat.factoryResourceUrl || "No factory resource added yet";
  const selectedKacLabel = selectedMatch?.kac_id || boat.kac || "Resolves after create";
  const workspaceRouteParams = useMemo(() => ({
    workspaceId: currentWorkspace?.workspace_id || null,
  }), [currentWorkspace?.workspace_id]);
  const openCapability = useCallback((item) => {
    const key = item?.key;
    if (key === "inventory") {
      if (isOemWorkspace) {
        navigation.navigate("ActivatorHome", { ...workspaceRouteParams, initialMode: "fleet", navSection: "ActivatorFind" });
        return;
      }
      navigation.navigate("KeeprSpaceFleet", workspaceRouteParams);
      return;
    }
    if (key === "configure") {
      navigation.navigate("ActivatorHome", { ...workspaceRouteParams, initialMode: "builds", navSection: "ActivatorWork" });
      return;
    }
    if (key === "catalog") {
      navigation.navigate("ActivatorHome", { ...workspaceRouteParams, initialMode: "templates", navSection: "ActivatorTemplates" });
      return;
    }
    if (key === "customer" || key === "delivery" || key === "add") {
      navigation.navigate("KeeprSpaceActivator", workspaceRouteParams);
      return;
    }
  }, [isOemWorkspace, navigation, workspaceRouteParams]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <ActivatorBreadcrumb
          navigation={navigation}
          homeRoute="KeeprSpaceHome"
          current={copy.current}
          right={(
            <View style={styles.breadcrumbWorkspace}>
              <Ionicons name="add-circle-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{workspaceName(currentWorkspace)}</Text>
            </View>
          )}
        />

        <View style={styles.headerPanel}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerCopyWrap}>
              <Text style={styles.headerKicker}>{copy.eyebrow}</Text>
              <Text style={styles.headerTitle}>{copy.title}</Text>
              <Text style={styles.headerText}>{copy.subtitle}</Text>
            </View>
            <View style={styles.headerBadge}>
              <Ionicons name="sparkles-outline" size={17} color={colors.brandNavy} />
              <Text style={styles.headerBadgeText}>{copy.badge}</Text>
            </View>
          </View>
          <CapabilityRail items={capabilities} onSelect={openCapability} />
        </View>

        {noSupportedPurpose ? (
          <View style={styles.gapPanel}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
            <View style={styles.gapTextWrap}>
              <Text style={styles.gapTitle}>Relationship purpose needs backend support</Text>
              <Text style={styles.gapText}>
                The current production connect RPC supports service, stewardship, storage, sales, and delivery purposes. It does not yet expose an OEM/manufacturer relationship purpose.
              </Text>
            </View>
          </View>
        ) : null}

        {isOemWorkspace ? (
          <View style={styles.crWorkflowPanel}>
            <View style={styles.crWorkflowHeader}>
              <View style={styles.crWorkflowTitleWrap}>
                <Text style={styles.panelKicker}>Customer Relations workflow</Text>
                <Text style={styles.crWorkflowTitle}>Activate ownership context</Text>
                <Text style={styles.panelText}>
                  Help the owner while they are on the phone: find the boat, connect the right people, add factory context, and activate the same KAC for their Keepr experience.
                </Text>
              </View>
              <View style={styles.crStatePill}>
                <Text style={styles.crStatePillText}>{activationState}</Text>
              </View>
            </View>

            <View style={styles.crStepGrid}>
              <View style={styles.crStepCard}>
                <View style={styles.crStepHeader}>
                  <View style={styles.crStepIcon}><Ionicons name="boat-outline" size={18} color={colors.brandBlue} /></View>
                  <Text style={styles.crStepTitle}>1. Find the boat</Text>
                </View>
                <Text style={styles.crStepValue}>{selectedBoatLabel || compact([boat.year, boat.make, boat.model]) || "Search first, or enter a new boat below"}</Text>
                <View style={styles.formGrid}>
                  <Field label="Keepr Code / KAC" value={boat.kac} onChangeText={(value) => updateBoat("kac", value)} placeholder="BOAT-..." />
                  <Field label="Serial / HIN" value={boat.hin} onChangeText={(value) => updateBoat("hin", value)} placeholder="Hull identification number" />
                  <Field label="Year" value={boat.year} onChangeText={(value) => updateBoat("year", value)} placeholder="2026" keyboardType="number-pad" />
                  <Field label="Make" value={boat.make} onChangeText={(value) => updateBoat("make", value)} placeholder="Make" />
                  <Field label="Model" value={boat.model} onChangeText={(value) => updateBoat("model", value)} placeholder="Model" />
                </View>
              </View>

              <View style={styles.crStepCard}>
                <View style={styles.crStepHeader}>
                  <View style={styles.crStepIcon}><Ionicons name="person-circle-outline" size={18} color={colors.brandBlue} /></View>
                  <Text style={styles.crStepTitle}>2. Connect owner</Text>
                </View>
                <Text style={styles.crStepValue}>{ownerLabel}</Text>
                <View style={styles.formGrid}>
                  <Field label="Owner name" value={boat.ownerName} onChangeText={(value) => updateBoat("ownerName", value)} placeholder="Current owner name" />
                  <Field label="Owner Keepr email" value={boat.ownerEmail} onChangeText={(value) => updateBoat("ownerEmail", value)} placeholder="owner@example.com" keyboardType="email-address" />
                  <Field label="Relationship state" value={boat.lifecycleState} onChangeText={(value) => updateBoat("lifecycleState", value)} placeholder="Unclaimed, Owner Connected, Active" />
                </View>
              </View>

              <View style={styles.crStepCard}>
                <View style={styles.crStepHeader}>
                  <View style={styles.crStepIcon}><Ionicons name="storefront-outline" size={18} color={colors.brandBlue} /></View>
                  <Text style={styles.crStepTitle}>3. Connect dealer</Text>
                </View>
                <Text style={styles.crStepValue}>{dealerLabel}</Text>
                <View style={styles.formGrid}>
                  <Field label="Dealer / service provider" value={boat.dealerName} onChangeText={(value) => updateBoat("dealerName", value)} placeholder="Current dealer or service provider" />
                  <Field label="Dealer contact" value={boat.dealerContact} onChangeText={(value) => updateBoat("dealerContact", value)} placeholder="Advisor, salesperson, or location contact" />
                  <Field label="External CRM reference" value={boat.dealerCrmUrl} onChangeText={(value) => updateBoat("dealerCrmUrl", value)} placeholder="https://crm.example.com/record/..." />
                </View>
              </View>

              <View style={styles.crStepCard}>
                <View style={styles.crStepHeader}>
                  <View style={styles.crStepIcon}><Ionicons name="people-outline" size={18} color={colors.brandBlue} /></View>
                  <Text style={styles.crStepTitle}>4. Assign OEM contact</Text>
                </View>
                <Text style={styles.crStepValue}>{oemContactLabel}</Text>
                <View style={styles.formGrid}>
                  <Field label="OEM contact" value={boat.oemContactName} onChangeText={(value) => updateBoat("oemContactName", value)} placeholder="Customer relations contact" />
                  <Field label="OEM contact email" value={boat.oemContactEmail} onChangeText={(value) => updateBoat("oemContactEmail", value)} placeholder="contact@example.com" keyboardType="email-address" />
                  <Field label="OEM department" value={boat.oemDepartment} onChangeText={(value) => updateBoat("oemDepartment", value)} placeholder="Customer Relations, Sales, Engineering" />
                </View>
              </View>

              <View style={styles.crStepCardWide}>
                <View style={styles.crStepHeader}>
                  <View style={styles.crStepIcon}><Ionicons name="document-attach-outline" size={18} color={colors.brandBlue} /></View>
                  <Text style={styles.crStepTitle}>5. Add factory context</Text>
                </View>
                <Text style={styles.crStepValue}>{factoryResourceLabel}</Text>
                <View style={styles.formGrid}>
                  <Field label="Resource title" value={boat.factoryResourceTitle} onChangeText={(value) => updateBoat("factoryResourceTitle", value)} placeholder="Build sheet, owner's manual, warranty packet" />
                  <Field label="Resource URL / reference" value={boat.factoryResourceUrl} onChangeText={(value) => updateBoat("factoryResourceUrl", value)} placeholder="https://... or internal reference" />
                  <Field label="Resource type" value={boat.factoryResourceType} onChangeText={(value) => updateBoat("factoryResourceType", value)} placeholder="build_sheet, manual, oem_catalog, other" />
                  <Field label="Warranty reference" value={boat.warrantyReference} onChangeText={(value) => updateBoat("warrantyReference", value)} placeholder="Warranty registration, hull warranty, transfer packet" />
                </View>
              </View>
            </View>

            <View style={styles.crActivationSummary}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryTitle}>Activation summary</Text>
                <Text style={styles.summaryLine}>OEM: {workspaceName(currentWorkspace)}</Text>
                <Text style={styles.summaryLine}>Boat: {selectedBoatLabel || compact([boat.year, boat.make, boat.model]) || "Not identified yet"}</Text>
                <Text style={styles.summaryLine}>Owner: {ownerLabel}</Text>
                <Text style={styles.summaryLine}>Dealer: {dealerLabel}</Text>
                <Text style={styles.summaryLine}>OEM contact: {oemContactLabel}</Text>
                <Text style={styles.summaryLine}>KAC: {selectedKacLabel}</Text>
                <Text style={styles.summaryState}>{activationState}</Text>
              </View>
              <View style={styles.crActionColumn}>
                <TouchableOpacity
                  style={[styles.primaryButton, (!selectedMatch || submitting || noSupportedPurpose) && styles.buttonDisabled]}
                  disabled={!selectedMatch || submitting || noSupportedPurpose}
                  onPress={connectSelected}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {selectedMatch?.already_connected || selectedMatch?.source === "org" ? "Save Context & Open Boat" : "Connect OEM Context"}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, (submitting || noSupportedPurpose) && styles.buttonDisabled]}
                  disabled={submitting || noSupportedPurpose}
                  onPress={createNew}
                >
                  <Text style={styles.secondaryButtonText}>{confirmCreate ? "Confirm Create New Boat" : "Create New Boat"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.panel}>
            <Text style={styles.panelKicker}>Step 1</Text>
            <Text style={styles.panelTitle}>Find or resolve boat</Text>
            <Text style={styles.panelText}>
              Org Search shows current inventory, relationships, and authorized/shared boats. Keepr Network Resolve looks up canonical identity by KAC, HIN, year, make, or model without exposing private owner history.
            </Text>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[styles.segmentButton, searchMode === "org" && styles.segmentButtonActive]}
                activeOpacity={0.86}
                onPress={() => {
                  setSearchMode("org");
                  setSelectedMatch(null);
                }}
              >
                <Text style={[styles.segmentText, searchMode === "org" && styles.segmentTextActive]}>Org Search</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentButton, searchMode === "network" && styles.segmentButtonActive]}
                activeOpacity={0.86}
                onPress={() => {
                  setSearchMode("network");
                  setSelectedMatch(null);
                }}
              >
                <Text style={[styles.segmentText, searchMode === "network" && styles.segmentTextActive]}>Keepr Network Resolve</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={runSearch}
                placeholder={searchMode === "org" ? "Search authorized workspace boats" : "KAC, HIN, boat name, year, make, model"}
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                style={styles.searchInput}
              />
              <TouchableOpacity style={styles.primarySmallButton} onPress={runSearch} disabled={resolving || (searchMode === "network" && !query.trim())}>
                {resolving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primarySmallButtonText}>Find</Text>}
              </TouchableOpacity>
            </View>

            {activeResult ? (
              <View style={styles.resultsWrap}>
                <Text style={styles.resultSummary}>
                  {matches.length
                    ? `${matches.length} ${searchMode === "org" ? "authorized" : "identity"} ${matches.length === 1 ? "match" : "matches"}`
                    : searchMode === "org"
                    ? "No authorized org asset found"
                    : "No canonical identity match found"}
                </Text>
                {matches.map((match) => {
                  const assetId = match.asset_id || match.id;
                  const selected = selectedMatch && (selectedMatch.asset_id || selectedMatch.id) === assetId;
                  return (
                    <TouchableOpacity
                      key={assetId}
                      style={[styles.matchCard, selected && styles.matchCardActive]}
                      activeOpacity={0.86}
                      onPress={() => setSelectedMatch(match)}
                    >
                      <View style={styles.matchIcon}>
                        <Ionicons name={match.already_connected ? "checkmark-circle-outline" : "boat-outline"} size={20} color={colors.brandBlue} />
                      </View>
                      <View style={styles.matchBody}>
                        <Text style={styles.matchTitle}>{match.asset_name || titleForMatch(match)}</Text>
                        <Text style={styles.matchMeta}>{compact([titleForMatch(match), match.kac_id, match.public_context])}</Text>
                      </View>
                      <Text style={styles.matchStatus}>
                        {match.source === "org" ? "Authorized" : match.already_connected ? "Connected" : "Identity"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelKicker}>Step 2</Text>
            <Text style={styles.panelTitle}>Relationship purpose</Text>
            <Text style={styles.panelText}>Choose why this workspace is connecting to the boat.</Text>
            <View style={styles.purposeGrid}>
              {options.map((purpose) => (
                <PurposeCard
                  key={purpose.key}
                  purpose={purpose}
                  selected={relationshipPurpose === purpose.key}
                  onPress={() => {
                    setRelationshipPurpose(purpose.key);
                    setOperatingStates(purpose.defaultState ? [purpose.defaultState] : []);
                  }}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Operating states</Text>
            <View style={styles.chipGrid}>
              {OPERATING_STATES.map((state) => {
                const selected = operatingStates.includes(state);
                return (
                  <TouchableOpacity
                    key={state}
                    style={[styles.chip, selected && styles.chipActive]}
                    activeOpacity={0.86}
                    onPress={() => toggleOperatingState(state)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{state}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {isOemWorkspace ? (
          <TouchableOpacity
            style={styles.advancedToggle}
            activeOpacity={0.86}
            onPress={() => setShowAllContext((value) => !value)}
          >
            <View style={styles.advancedToggleIcon}>
              <Ionicons name={showAllContext ? "chevron-up-outline" : "options-outline"} size={18} color={colors.brandBlue} />
            </View>
            <View style={styles.advancedToggleTextWrap}>
              <Text style={styles.advancedToggleTitle}>{showAllContext ? "Hide Advanced / All Context" : "Advanced / All Context"}</Text>
              <Text style={styles.panelText}>Open the complete asset, relationship, storage, value, photo, and catalog capture form.</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {(!isOemWorkspace || showAllContext) ? (
          <View style={styles.grid}>
          <View style={[styles.panel, styles.createPanel]}>
            <Text style={styles.panelKicker}>Create new</Text>
            <Text style={styles.panelTitle}>Add marine asset</Text>
            <Text style={styles.panelText}>Create only after resolving by KAC/HIN and confirming no existing asset should be connected. This follows the normal Keepr marine asset capture, then connects the canonical boat to this workspace.</Text>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Basics</Text>
              <Text style={styles.fieldLabel}>Asset use</Text>
              <View style={styles.modeRow}>
                {["personal", "commercial"].map((mode) => {
                  const selected = boat.assetMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.modeButton, selected && styles.modeButtonActive]}
                      activeOpacity={0.86}
                      onPress={() => updateBoat("assetMode", mode)}
                    >
                      <Text style={[styles.modeButtonText, selected && styles.modeButtonTextActive]}>
                        {mode === "commercial" ? "Commercial" : "Personal"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {boat.assetMode === "commercial" ? (
                <Field
                  label="Commercial entity"
                  value={boat.commercialEntity}
                  onChangeText={(value) => updateBoat("commercialEntity", value)}
                  placeholder={`${workspaceName(currentWorkspace)} or operating entity`}
                />
              ) : null}
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Boat details</Text>
            <View style={styles.formGrid}>
              <Field label="Year" value={boat.year} onChangeText={(value) => updateBoat("year", value)} placeholder="2026" keyboardType="number-pad" />
              <Field label="Make" value={boat.make} onChangeText={(value) => updateBoat("make", value)} placeholder="Make" />
              <Field label="Model" value={boat.model} onChangeText={(value) => updateBoat("model", value)} placeholder="39 LE" />
              <Field label="Length (ft)" value={boat.lengthFeet} onChangeText={(value) => updateBoat("lengthFeet", value)} placeholder="39" keyboardType="decimal-pad" />
              <Field label="KAC / Keepr code" value={boat.kac} onChangeText={(value) => updateBoat("kac", value)} placeholder="Optional existing KAC" />
              <Field label="Serial / HIN" value={boat.hin} onChangeText={(value) => updateBoat("hin", value)} placeholder="Optional but preferred" />
              <Field label="Boat name" value={boat.name} onChangeText={(value) => updateBoat("name", value)} placeholder="Optional" />
              <Field label="Hull material" value={boat.hullMaterial} onChangeText={(value) => updateBoat("hullMaterial", value)} placeholder="Fiberglass, aluminum" />
              <Field label="Engine type" value={boat.engine} onChangeText={(value) => updateBoat("engine", value)} placeholder="Twin Volvo Penta V8" />
              <Field label="Engine hours" value={boat.engineHours} onChangeText={(value) => updateBoat("engineHours", value)} placeholder="Optional" keyboardType="decimal-pad" />
              <Field label="Registration #" value={boat.registrationNumber} onChangeText={(value) => updateBoat("registrationNumber", value)} placeholder="State registration number" />
              <Field label="New / used" value={boat.newUsed} onChangeText={(value) => updateBoat("newUsed", value)} placeholder="New, used, certified" />
              <Field label="Primary location" value={boat.location} onChangeText={(value) => updateBoat("location", value)} placeholder="Dock, yard, showroom" />
            </View>
              <LargeField label="Notes" value={boat.notes} onChangeText={(value) => updateBoat("notes", value)} placeholder="Trips, storage notes, marina details..." />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>{workspaceName(currentWorkspace)} relationship metadata</Text>
              <Text style={styles.panelText}>These fields belong to this workspace's relationship with the boat, not the global boat identity.</Text>
              <View style={styles.formGrid}>
                <Field label="Stock #" value={boat.stockNumber} onChangeText={(value) => updateBoat("stockNumber", value)} placeholder="Stock number" />
                <Field label="Listing URL" value={boat.listingUrl} onChangeText={(value) => updateBoat("listingUrl", value)} placeholder="https://..." />
                <Field label="External / G2 asset ID" value={boat.externalAssetId} onChangeText={(value) => updateBoat("externalAssetId", value)} placeholder="Optional inventory system ID" />
                <Field label="Workspace location" value={boat.location} onChangeText={(value) => updateBoat("location", value)} placeholder="Showroom, storage yard, service bay" />
              </View>
            </View>

            {isOemWorkspace ? (
              <View style={styles.formSection}>
                <Text style={styles.sectionLabel}>OEM relationship activation</Text>
                <Text style={styles.panelText}>Capture who owns the boat, who supports it, and who inside this workspace owns the customer relationship.</Text>
                <View style={styles.formGrid}>
                  <Field label="Owner name" value={boat.ownerName} onChangeText={(value) => updateBoat("ownerName", value)} placeholder="Current owner name" />
                  <Field label="Owner Keepr email" value={boat.ownerEmail} onChangeText={(value) => updateBoat("ownerEmail", value)} placeholder="owner@example.com" keyboardType="email-address" />
                  <Field label="Dealer / service provider" value={boat.dealerName} onChangeText={(value) => updateBoat("dealerName", value)} placeholder="Current dealer or service provider" />
                  <Field label="Dealer contact" value={boat.dealerContact} onChangeText={(value) => updateBoat("dealerContact", value)} placeholder="Advisor, salesperson, or location contact" />
                  <Field label="External CRM reference" value={boat.dealerCrmUrl} onChangeText={(value) => updateBoat("dealerCrmUrl", value)} placeholder="https://crm.example.com/record/..." />
                  <Field label="Relationship state" value={boat.lifecycleState} onChangeText={(value) => updateBoat("lifecycleState", value)} placeholder="Unclaimed, Owner Connected, Active" />
                  <Field label="OEM contact" value={boat.oemContactName} onChangeText={(value) => updateBoat("oemContactName", value)} placeholder="Customer relations contact" />
                  <Field label="OEM contact email" value={boat.oemContactEmail} onChangeText={(value) => updateBoat("oemContactEmail", value)} placeholder="contact@example.com" keyboardType="email-address" />
                  <Field label="OEM department" value={boat.oemDepartment} onChangeText={(value) => updateBoat("oemDepartment", value)} placeholder="Customer Relations, Sales, Engineering" />
                </View>
              </View>
            ) : null}

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Existing customer / storage intake</Text>
              <Text style={styles.panelText}>Use this when this workspace knows the customer but the customer does not have a Keepr account yet. No fake user is created.</Text>
              <View style={styles.formGrid}>
                <Field label="Customer system" value={boat.customerExternalSystem} onChangeText={(value) => updateBoat("customerExternalSystem", value)} placeholder="g2" />
                <Field label="Customer ID" value={boat.customerExternalId} onChangeText={(value) => updateBoat("customerExternalId", value)} placeholder="Optional external customer ID" />
                <Field label="Customer name" value={boat.customerDisplayName} onChangeText={(value) => updateBoat("customerDisplayName", value)} placeholder="Customer display name" />
                <Field label="Customer email" value={boat.customerEmail} onChangeText={(value) => updateBoat("customerEmail", value)} placeholder="Optional email" keyboardType="email-address" />
                <Field label="Customer phone" value={boat.customerPhone} onChangeText={(value) => updateBoat("customerPhone", value)} placeholder="Optional phone" keyboardType="phone-pad" />
              </View>
              <View style={styles.publicLifecycleBox}>
                <View style={styles.publicLifecycleIcon}>
                  <Ionicons name="camera-outline" size={18} color={colors.brandBlue} />
                </View>
                <View style={styles.publicLifecycleTextWrap}>
                  <Text style={styles.publicLifecycleTitle}>Receive for Storage</Text>
                  <Text style={styles.panelText}>Choose Storage Provider plus Stored to receive the boat, then open the boat and use the normal photo/file tools for condition evidence.</Text>
                </View>
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Value & purchase</Text>
              <View style={styles.formGrid}>
                <Field label="Purchase price" value={boat.purchasePrice} onChangeText={(value) => updateBoat("purchasePrice", value)} placeholder="Optional" keyboardType="decimal-pad" />
                <Field label="Estimated value" value={boat.estimatedValue} onChangeText={(value) => updateBoat("estimatedValue", value)} placeholder="Optional" keyboardType="decimal-pad" />
                <Field label="Purchase date" value={boat.purchaseDate} onChangeText={(value) => updateBoat("purchaseDate", value)} placeholder="YYYY-MM-DD" />
              </View>
            </View>

            {isOemWorkspace ? (
              <View style={styles.formSection}>
                <Text style={styles.sectionLabel}>Factory records / resources</Text>
                <Text style={styles.panelText}>Attach a build sheet, manual, warranty reference, or source link as OEM factory context for this KAC.</Text>
                <View style={styles.formGrid}>
                  <Field label="Resource title" value={boat.factoryResourceTitle} onChangeText={(value) => updateBoat("factoryResourceTitle", value)} placeholder="Build sheet, owner's manual, warranty packet" />
                  <Field label="Resource URL / reference" value={boat.factoryResourceUrl} onChangeText={(value) => updateBoat("factoryResourceUrl", value)} placeholder="https://... or internal reference" />
                  <Field label="Resource type" value={boat.factoryResourceType} onChangeText={(value) => updateBoat("factoryResourceType", value)} placeholder="build_sheet, manual, oem_catalog, other" />
                  <Field label="Warranty reference" value={boat.warrantyReference} onChangeText={(value) => updateBoat("warrantyReference", value)} placeholder="Warranty registration, hull warranty, transfer packet" />
                </View>
              </View>
            ) : null}

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>Boat photos</Text>
              <TouchableOpacity
                style={styles.photoPickButton}
                activeOpacity={0.86}
                onPress={async () => {
                  const photos = await pickActivatorBoatPhotos();
                  if (photos) updateBoat("photos", photos);
                }}
              >
                <Ionicons name="images-outline" size={18} color={colors.brandBlue} />
                <Text style={styles.photoPickText}>
                  {boat.photos?.length ? `${boat.photos.length} selected` : "Select photo"}
                </Text>
              </TouchableOpacity>
              {boat.photos?.length ? (
                <View style={styles.photoPreviewRow}>
                  {boat.photos.slice(0, 4).map((photo, index) => (
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

            <View style={styles.templateSection}>
              <Text style={styles.fieldLabel}>Optional catalog template</Text>
              <Text style={styles.panelText}>Templates can prefill make/model context. Current production create RPC does not bind the template yet.</Text>
              <View style={styles.templateGrid}>
                {templates.slice(0, 8).map((template) => {
                  const key = template.template_id || template.id || template.template_key;
                  const selected = selectedTemplate && (selectedTemplate.template_id || selectedTemplate.id || selectedTemplate.template_key) === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.templateCard, selected && styles.templateCardActive]}
                      activeOpacity={0.86}
                      onPress={() => selectTemplate(template)}
                    >
                      <Text style={styles.templateTitle}>{templateTitle(template)}</Text>
                      <Text style={styles.templateMeta}>{template.template_key || template.status || "Template"}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {templateLoading ? <ActivityIndicator color={colors.brandBlue} /> : null}
              {selectedTemplate ? (
                <View style={styles.templateDetail}>
                  <Text style={styles.templateDetailText}>
                    Selected: {templateTitle(selectedTemplate)}
                    {templateDetail?.items?.length ? ` • ${templateDetail.items.length} template items` : ""}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.publicLifecycleBox}>
              <View style={styles.publicLifecycleIcon}>
                <Ionicons name="qr-code-outline" size={18} color={colors.brandBlue} />
              </View>
              <View style={styles.publicLifecycleTextWrap}>
                <Text style={styles.publicLifecycleTitle}>Public view and showroom QR happen after save</Text>
                <Text style={styles.panelText}>Once the boat exists, the normal Edit Asset public-view action can control sale/showroom visibility and generate QR codes.</Text>
              </View>
            </View>

            {confirmCreate ? (
              <View style={styles.confirmBox}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} />
                <Text style={styles.confirmText}>
                  Create this boat in Keepr? If Keepr finds an existing KAC, HIN, stock, or listing match, it will connect that boat instead of creating a duplicate.
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, (submitting || noSupportedPurpose) && styles.buttonDisabled]}
              disabled={submitting || noSupportedPurpose}
              onPress={createNew}
            >
              {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryButtonText}>{confirmCreate ? "Confirm Create Boat" : "Create New Boat"}</Text>}
            </TouchableOpacity>
          </View>

          <View style={[styles.panel, styles.connectPanel]}>
            <Text style={styles.panelKicker}>Connect existing</Text>
            <Text style={styles.panelTitle}>Connect selected boat</Text>
            <Text style={styles.panelText}>
              Authorized org assets open directly. Network identity matches can be requested/connected into this workspace through the production connect RPC.
            </Text>
            {isOemWorkspace ? (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryTitle}>Relationship summary</Text>
                <Text style={styles.summaryLine}>OEM: {workspaceName(currentWorkspace)}</Text>
                <Text style={styles.summaryLine}>Owner: {boat.ownerName || boat.ownerEmail || "Unclaimed / not connected yet"}</Text>
                <Text style={styles.summaryLine}>Dealer: {boat.dealerName || "Not connected yet"}</Text>
                <Text style={styles.summaryLine}>OEM contact: {compact([boat.oemContactName, boat.oemDepartment]) || "Not assigned yet"}</Text>
                <Text style={styles.summaryLine}>KAC: {(selectedMatch?.kac_id || boat.kac || "Resolves after create")}</Text>
                <Text style={styles.summaryState}>{boat.lifecycleState || "Unclaimed"}</Text>
              </View>
            ) : null}
            {selectedMatch ? (
              <View style={styles.selectedBox}>
                <Text style={styles.selectedTitle}>{selectedMatch.asset_name || titleForMatch(selectedMatch)}</Text>
                <Text style={styles.selectedMeta}>{compact([titleForMatch(selectedMatch), selectedMatch.kac_id])}</Text>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No existing boat selected</Text>
                <Text style={styles.panelText}>Run a search and choose the existing boat before connecting.</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, (!selectedMatch || submitting || noSupportedPurpose) && styles.buttonDisabled]}
              disabled={!selectedMatch || submitting || noSupportedPurpose}
              onPress={connectSelected}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isOemWorkspace
                    ? selectedMatch?.already_connected || selectedMatch?.source === "org"
                      ? "Save Context & Open Boat"
                      : "Connect OEM Context"
                    : selectedMatch?.already_connected || selectedMatch?.source === "org"
                    ? "Open Authorized Boat"
                    : "Connect Existing Boat"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          </View>
        ) : null}

        {message ? (
          <View style={[styles.messageBox, styles[`messageBox_${message.tone}`]]}>
            <Text style={styles.messageText}>{message.text}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  breadcrumbWorkspace: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  breadcrumbWorkspaceText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  headerPanel: {
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.xl,
    ...shadows.sm,
  },
  headerTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
  },
  headerCopyWrap: {
    flex: 1,
    minWidth: 320,
  },
  headerKicker: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: colors.onPrimary,
    fontSize: 30,
    fontWeight: "900",
  },
  headerText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    fontWeight: "700",
    maxWidth: 820,
  },
  headerBadge: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  headerBadgeText: {
    color: colors.brandNavy,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  capabilityRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  capabilityCard: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: 210,
  },
  capabilityCardActive: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  capabilityIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  capabilityIconActive: {
    backgroundColor: colors.brandNavy,
  },
  capabilityTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  capabilityLabel: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  capabilityLabelActive: {
    color: colors.brandNavy,
  },
  capabilityStatus: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
    textTransform: "uppercase",
  },
  grid: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 420,
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  createPanel: {
    flexBasis: 900,
  },
  connectPanel: {
    flexBasis: 420,
  },
  panelKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  panelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  crWorkflowPanel: {
    backgroundColor: colors.surface,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },
  crWorkflowHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  crWorkflowTitleWrap: {
    flex: 1,
    minWidth: 320,
  },
  crWorkflowTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  crStatePill: {
    backgroundColor: "#DBEAFE",
    borderColor: "#BFDBFE",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  crStatePillText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  crStepGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  crStepCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 420,
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  crStepCardWide: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 860,
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  crStepHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  crStepIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  crStepTitle: {
    color: colors.brandNavy,
    fontSize: 15,
    fontWeight: "900",
  },
  crStepValue: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  crActivationSummary: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  crActionColumn: {
    flexBasis: 280,
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  advancedToggle: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  advancedToggleIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  advancedToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  advancedToggleTitle: {
    color: colors.brandNavy,
    fontSize: 15,
    fontWeight: "900",
  },
  segmentedControl: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    padding: spacing.xs,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexGrow: 1,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
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
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    outlineStyle: "none",
  },
  primarySmallButton: {
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 72,
    paddingHorizontal: spacing.md,
  },
  primarySmallButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  resultsWrap: {
    gap: spacing.sm,
  },
  resultSummary: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  matchCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  matchCardActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  matchIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  matchBody: {
    flex: 1,
    minWidth: 0,
  },
  matchTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
  },
  matchMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  matchStatus: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  purposeGrid: {
    gap: spacing.sm,
  },
  purposeCard: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  purposeCardActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  purposeIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  purposeIconActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  purposeBody: {
    flex: 1,
    minWidth: 0,
  },
  purposeTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  purposeTitleActive: {
    color: colors.brandNavy,
  },
  purposeDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  chipTextActive: {
    color: colors.onPrimary,
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
  summaryBox: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 4,
    padding: spacing.md,
  },
  summaryTitle: {
    color: colors.brandNavy,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 2,
  },
  summaryLine: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  summaryState: {
    alignSelf: "flex-start",
    backgroundColor: "#DBEAFE",
    borderRadius: 999,
    color: colors.brandNavy,
    fontSize: 11,
    fontWeight: "900",
    marginTop: spacing.xs,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  selectedBox: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  selectedTitle: {
    color: colors.brandNavy,
    fontSize: 16,
    fontWeight: "900",
  },
  selectedMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  emptyBox: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.brandBlue,
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  formGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  formSection: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  modeButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 38,
    minWidth: 120,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  modeButtonActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  modeButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "900",
  },
  modeButtonTextActive: {
    color: colors.onPrimary,
  },
  field: {
    flexBasis: 260,
    flexGrow: 1,
    gap: spacing.xs,
  },
  fieldFull: {
    gap: spacing.xs,
    width: "100%",
  },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
    minHeight: 44,
    outlineStyle: "none",
    paddingHorizontal: spacing.md,
  },
  notesInput: {
    minHeight: 96,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  templateSection: {
    gap: spacing.sm,
  },
  templateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  templateCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 170,
    flexGrow: 1,
    minHeight: 76,
    padding: spacing.md,
  },
  templateCardActive: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  templateTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  templateMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
  },
  templateDetail: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  templateDetailText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  publicLifecycleBox: {
    alignItems: "flex-start",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  publicLifecycleIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  publicLifecycleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  publicLifecycleTitle: {
    color: colors.brandNavy,
    fontSize: 14,
    fontWeight: "900",
  },
  confirmBox: {
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  confirmText: {
    color: "#92400E",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  gapPanel: {
    alignItems: "flex-start",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  gapTextWrap: {
    flex: 1,
  },
  gapTitle: {
    color: "#92400E",
    fontSize: 14,
    fontWeight: "900",
  },
  gapText: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  messageBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  messageBox_danger: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  messageBox_warning: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  messageText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },
});
