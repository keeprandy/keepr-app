import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { getActivatorBoatWorkspace } from "../lib/activatorApi";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

const BOAT_HERO = require("../assets/boats/boat_bennington_hero.jpg");

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

const OPERATING_MODES = [
  { key: "overview", label: "Overview", icon: "compass-outline" },
  { key: "sales", label: "Sales", icon: "pricetag-outline" },
  { key: "service", label: "Service", icon: "construct-outline" },
];

const NODE_FILTERS = [
  { key: "all", label: "All nodes", icon: "layers-outline" },
  { key: "attention", label: "Attention", icon: "warning-outline" },
  { key: "ready", label: "Ready", icon: "shield-checkmark-outline" },
  { key: "options", label: "Selected options", icon: "options-outline" },
];

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
  if (value.value !== undefined) return compact([value.value, value.unit]);
  return JSON.stringify(value);
}

function currentFactValue(facts, key) {
  const value = facts?.[key];
  return valueText(value);
}

function mediaAsset(media) {
  return SHOWCASE_ASSETS[media?.metadata?.local_asset_key] || SHOWCASE_ASSETS[media?.local_asset_key] || BOAT_HERO;
}

function modelMedia(workspace) {
  return (workspace?.resources || []).filter((resource) =>
    resource.resource_type === "photo" &&
    resource.metadata?.media_scope === "model_template"
  );
}

function mediaLayerCopy(projection) {
  if (projection === "dealer") {
    return {
      eyebrow: "Dealer media layer",
      title: "Exact boat photos",
      body: "SkipperBud's adds delivery, dock, commissioning, and evidence photos for this specific HIN. These sit above OEM catalog imagery and flow to the owner when appropriate.",
      empty: ["Delivery dock photos", "Commissioning evidence", "Dealer-installed options"],
    };
  }

  if (projection === "owner") {
    return {
      eyebrow: "Owner media layer",
      title: "HappyOwner showcase",
      body: "The owner inherits factory and dealer context, then adds personal moments: at the helm, at the marina, trips, family use, and ownership story media.",
      empty: ["HappyOwner at the helm", "Marina moments", "Ownership story photos"],
    };
  }

  if (projection === "transfer") {
    return {
      eyebrow: "Handoff media layer",
      title: "Transfer-ready evidence",
      body: "The handoff view favors provenance and continuity: factory catalog media, exact-hull condition photos, records, and owner-approved showcase media.",
      empty: ["Condition set", "Approved showcase", "Transfer evidence"],
    };
  }

  return {
    eyebrow: "OEM media layer",
    title: "Catalog and model truth",
    body: "Tiara's catalog photos belong to the reusable model template. Exact hulls inherit them until dealer delivery photos and owner media are added.",
    empty: [],
  };
}

function stateForNode(node) {
  if (node?.selected) return "verified";
  if (node?.item?.item_type === "option" && node?.item?.applicability?.standard_state === "optional") return "available";
  if (node?.item?.applicability?.standard_state === "standard") return "ready";
  if (node?.item?.item_type === "playbook") return "ready";
  if (node?.item?.item_type === "section" || node?.type === "vessel") return "active";
  return "review";
}

function stateCopy(state) {
  if (state === "verified") return "Installed";
  if (state === "ready") return "Ready";
  if (state === "available") return "Option";
  if (state === "active") return "Active";
  return "Review";
}

function nodeTypeLabel(node) {
  if (node.type === "vessel") return "Boat identity";
  if (node.type === "relationship") return "Relationship";
  if (node.type === "resource") return "Resource";
  if (node.type === "fact") return "Vessel fact";
  return labelize(node.item?.item_type || node.type);
}

function buildNodeGroups({ workspace, query }) {
  const templateItems = workspace?.template?.items || [];
  const facts = workspace?.facts || [];
  const resources = workspace?.resources || [];
  const relationships = workspace?.relationship_details || workspace?.relationships || [];
  const selectedTemplateItemIds = new Set(
    facts
      .filter((fact) => fact.fact_key === "option.selected" && fact.fact_value === true && fact.template_item_id)
      .map((fact) => fact.template_item_id)
  );
  const childrenByParent = new Map();

  templateItems.forEach((item) => {
    const key = item.parent_item_id || "root";
    childrenByParent.set(key, [...(childrenByParent.get(key) || []), item]);
  });

  const asset = workspace?.asset || {};
  const template = workspace?.template || {};
  const identity = compact([
    asset.year || template.model_year,
    asset.make || template.manufacturer,
    asset.model || template.model,
  ]);
  const groups = [
    {
      key: "vessel",
      eyebrow: "Boat -> Vessel",
      title: "Owner Passport Navigation",
      nodes: [
        {
          id: "vessel-root",
          type: "vessel",
          label: asset.name || "Boat",
          summary: compact([identity, asset.kac_id]),
          state: "active",
          facts,
          relationships,
          resources,
        },
      ],
    },
  ];

  const sections = (childrenByParent.get("root") || [])
    .filter((item) => item.item_type === "section")
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  sections.forEach((section) => {
    const nodes = (childrenByParent.get(section.id) || [])
      .filter((item) => item.item_type !== "option_group")
      .map((item) => ({
        id: item.id,
        type: "template_item",
        label: item.label,
        summary: valueText(item.expected_value) || labelize(item.applicability?.standard_state || item.item_type),
        state: null,
        item,
        selected: selectedTemplateItemIds.has(item.id),
        resources: resources.filter((resource) => resource.id === item.source_resource_id || resource.applies_to_id === item.id),
        facts: facts.filter((fact) => fact.template_item_id === item.id),
      }));

    const optionGroups = (childrenByParent.get(section.id) || [])
      .filter((item) => item.item_type === "option_group")
      .flatMap((group) => (childrenByParent.get(group.id) || []).map((item) => ({
        id: item.id,
        type: "template_item",
        label: item.label,
        summary: compact([group.label, valueText(item.expected_value)]) || labelize(item.applicability?.selection_rule),
        state: null,
        item: { ...item, group_label: group.label },
        selected: selectedTemplateItemIds.has(item.id),
        resources: resources.filter((resource) => resource.id === item.source_resource_id || resource.applies_to_id === item.id),
        facts: facts.filter((fact) => fact.template_item_id === item.id),
      })));

    const allNodes = [...nodes, ...optionGroups];
    if (allNodes.length) {
      groups.push({
        key: section.id,
        eyebrow: "Boat -> System -> Component -> Resource",
        title: section.label,
        nodes: allNodes,
      });
    }
  });

  if (relationships.length) {
    groups.push({
      key: "relationships",
      eyebrow: "Boat -> Relationships",
      title: "People and organizations",
      nodes: relationships.map((relationship) => ({
        id: `relationship-${relationship.id}`,
        type: "relationship",
        label: relationship.organization_name || relationship.location_name || labelize(relationship.relationship_type),
        summary: compact([
          labelize(relationship.relationship_type),
          relationship.location_name,
          relationship.access_scope,
        ]),
        state: relationship.status === "active" ? "active" : "review",
        relationship,
      })),
    });
  }

  if (resources.length) {
    groups.push({
      key: "resources",
      eyebrow: "Boat -> Resources",
      title: "Manuals and provenance",
      nodes: resources.map((resource) => ({
        id: `resource-${resource.id}`,
        type: "resource",
        label: resource.title || resource.source_name || "Resource",
        summary: compact([resource.source_name, resource.source_type || resource.type]),
        state: "ready",
        resource,
      })),
    });
  }

  const showcase = modelMedia(workspace).filter((resource) => resource.metadata?.role !== "hero");
  if (showcase.length) {
    groups.splice(1, 0, {
      key: "showcase",
      eyebrow: "Template -> Showcase Media",
      title: "Model imagery inherited from Tiara",
      nodes: showcase.map((resource) => ({
        id: `showcase-${resource.id}`,
        type: "resource",
        label: resource.title || labelize(resource.metadata?.role),
        summary: compact([labelize(resource.metadata?.role), resource.metadata?.source_document_title]),
        state: "ready",
        resource,
      })),
    });
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return groups;

  return groups
    .map((group) => ({
      ...group,
      nodes: group.nodes.filter((node) =>
        [node.label, node.summary, nodeTypeLabel(node)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      ),
    }))
    .filter((group) => group.nodes.length);
}

function filterGroups(groups, filter) {
  if (filter === "all") return groups;
  return groups
    .map((group) => ({
      ...group,
      nodes: group.nodes.filter((node) => {
        const state = stateForNode(node);
        if (filter === "attention") return state === "review" || state === "available";
        if (filter === "ready") return state === "ready" || state === "verified" || state === "active";
        if (filter === "options") return node.selected || node.item?.item_type === "option";
        return true;
      }),
    }))
    .filter((group) => group.nodes.length);
}

function OperatingModeButton({ mode, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.projectionButton, active && styles.projectionButtonActive]}
    >
      <Ionicons name={mode.icon} size={14} color={active ? colors.onPrimary : colors.textSecondary} />
      <Text style={[styles.projectionText, active && styles.projectionTextActive]} numberOfLines={1}>
        {mode.label}
      </Text>
    </TouchableOpacity>
  );
}

function FilterButton({ item, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.filterButton, active && styles.filterButtonActive]}>
      <Ionicons name={item.icon} size={14} color={active ? colors.onPrimary : colors.textSecondary} />
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
    </TouchableOpacity>
  );
}

function StatusPill({ state }) {
  const normalized = state || "review";
  return (
    <View style={[styles.statusPill, styles[`status_${normalized}`] || styles.status_review]}>
      <Text style={[styles.statusText, styles[`statusText_${normalized}`] || styles.statusText_review]}>
        {stateCopy(normalized)}
      </Text>
    </View>
  );
}

function MediaLayerPanel({ workspace, projection }) {
  const copy = mediaLayerCopy(projection);
  const inheritedMedia = modelMedia(workspace).filter((resource) => resource.metadata?.role !== "hero").slice(0, 4);
  const shouldShowCatalog = projection === "oem" || projection === "transfer";
  const visibleMedia = shouldShowCatalog ? inheritedMedia : [];

  return (
    <View style={styles.mediaLayerPanel}>
      <View style={styles.mediaLayerHeader}>
        <View>
          <Text style={styles.mediaLayerKicker}>{copy.eyebrow}</Text>
          <Text style={styles.mediaLayerTitle}>{copy.title}</Text>
        </View>
        <View style={styles.mediaLayerPill}>
          <Text style={styles.mediaLayerPillText}>{projection === "owner" ? "Keepr view" : labelize(projection)}</Text>
        </View>
      </View>
      <Text style={styles.mediaLayerBody}>{copy.body}</Text>
      <View style={styles.mediaLayerGrid}>
        {visibleMedia.map((resource) => (
          <ImageBackground
            key={resource.id}
            source={mediaAsset(resource)}
            resizeMode="cover"
            style={styles.mediaThumb}
            imageStyle={styles.mediaThumbImage}
          >
            <View style={styles.mediaThumbShade}>
              <Text style={styles.mediaThumbLabel}>{resource.title || labelize(resource.metadata?.role)}</Text>
              <Text style={styles.mediaThumbMeta}>OEM catalog</Text>
            </View>
          </ImageBackground>
        ))}
        {copy.empty.map((label) => (
          <View key={label} style={styles.mediaPlaceholder}>
            <Ionicons
              name={projection === "owner" ? "camera-outline" : "image-outline"}
              size={20}
              color={colors.brandBlue}
            />
            <Text style={styles.mediaPlaceholderTitle}>{label}</Text>
            <Text style={styles.mediaPlaceholderText}>
              {projection === "dealer" ? "Add after dealer assignment" : projection === "owner" ? "Owner-added after activation" : "Add to handoff packet"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DealerPrepWorkspace({ workspace, onOpenBoatStory }) {
  const asset = workspace?.asset || {};
  const template = workspace?.template || {};
  const facts = workspace?.facts || [];
  const resources = workspace?.resources || [];
  const relationships = workspace?.relationship_details || workspace?.relationships || [];
  const currentFacts = workspace?.current_facts || {};
  const oem = relationships.find((item) => item.relationship_type === "oem");
  const dealer = relationships.find((item) =>
    ["delivery_dealer", "servicing_dealer", "selling_dealer", "service_provider"].includes(item.relationship_type)
  );
  const make = String(asset.make || template.manufacturer || "").toLowerCase();
  const isHarrisWilson = asset.kac_id === "BOAT-2008-3BOZ95" || (make.includes("harris") && dealer?.organization_name === "Wilson Marine");
  const hasFactoryOrigin = Boolean(oem?.organization_name || make.includes("tiara"));
  const selectedOptions = facts.filter((fact) => fact.fact_key === "option.selected" && fact.fact_value === true).length;
  const identity = compact([
    asset.year || template.model_year,
    asset.make || template.manufacturer,
    asset.model || template.model,
  ]);

  const salesOrigin = isHarrisWilson
    ? {
        kicker: "Wilson sales origin",
        title: "Sold by Wilson Marine",
        body: "This Harris did not begin as an OEM factory activation in Keepr. The sales origin is Wilson Marine, then the owner record accumulated systems, records, storage, and service continuity.",
        date: "June 5, 2020",
        amount: "$17,160",
        seller: "Wilson Marine",
        buyer: "Andy Drake",
        source: "Owner Keepr history",
      }
    : hasFactoryOrigin
      ? {
          kicker: `${dealer?.organization_name || "Dealer"} dealer continuation`,
          title: "Delivery prep for this exact boat",
          body: "The factory package is locked. Dealer work verifies the boat, adds delivery evidence, prepares the owner portal, and keeps the dealer connected for service.",
          date: null,
          amount: null,
          seller: dealer?.organization_name || "Dealer",
          buyer: "HappyOwner",
          source: oem?.organization_name ? `${oem.organization_name} factory package` : "Factory activation",
        }
      : {
          kicker: "Sales and relationship context",
          title: "Sales history for this boat",
          body: "Keepr shows the known sales and dealer context for this exact boat. If no OEM factory package exists, the boat still carries owner, dealer, service, and source-attributed history.",
          date: asset.purchase_date,
          amount: asset.purchase_price ? `$${Number(asset.purchase_price).toLocaleString()}` : null,
          seller: dealer?.organization_name || "Dealer not connected",
          buyer: "Owner",
          source: "Keepr asset history",
        };

  const dealerTasks = isHarrisWilson
    ? [
        {
          title: "Preserve sales origin",
          body: "Wilson Marine is the selling origin in the owner history. No Tiara/OEM factory layer should be shown for this Harris.",
          state: "Origin",
          icon: "receipt-outline",
        },
        {
          title: "Carry service continuity",
          body: "The same Wilson relationship continues after sale through storage, winterization, service, messages, invoices, and owner actions.",
          state: "Continuity",
          icon: "construct-outline",
        },
        {
          title: "Add dealer history",
          body: "Wilson can add or ingest DMS records, invoices, work orders, photos, and staff notes without recreating the boat.",
          state: "Additive",
          icon: "add-circle-outline",
        },
        {
          title: "Support the owner",
          body: "The owner sees Wilson as the connected service partner with one-click messaging and request service.",
          state: "Owner Keepr",
          icon: "person-circle-outline",
        },
      ]
    : [
        {
          title: "Verify factory build",
          body: `${selectedOptions || "Selected"} options inherited from ${oem?.organization_name || "OEM"} configuration.`,
          state: "In progress",
          icon: "shield-checkmark-outline",
        },
        {
          title: "Commission systems",
          body: "Confirm propulsion, helm electronics, stabilization, connectivity, batteries, and safety inventory.",
          state: "Dealer layer",
          icon: "construct-outline",
        },
        {
          title: "Add dealer-installed items",
          body: "Capture buyer-requested additions, installed accessories, serials, photos, invoices, and source evidence.",
          state: "Additive",
          icon: "add-circle-outline",
        },
        {
          title: "Prepare owner handoff",
          body: "Review what the owner will receive: systems, manuals, delivery documents, relationships, and next actions.",
          state: "Owner portal",
          icon: "person-circle-outline",
        },
      ];

  return (
    <View style={styles.dealerWorkspace}>
      <View style={styles.dealerIntro}>
        <View>
          <Text style={styles.dealerKicker}>{salesOrigin.kicker}</Text>
          <Text style={styles.dealerTitle}>{salesOrigin.title}</Text>
          <Text style={styles.dealerBody}>{salesOrigin.body}</Text>
        </View>
        <View style={styles.dealerKacCard}>
          <Text style={styles.dealerCardLabel}>Same boat</Text>
          <Text style={styles.dealerKac}>{asset.kac_id || "KAC pending"}</Text>
          <Text style={styles.dealerCardText}>{identity}</Text>
        </View>
      </View>

      <View style={styles.dealerGrid}>
        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.brandNavy} />
            <View>
              <Text style={styles.dealerPanelKicker}>{hasFactoryOrigin ? "Factory source" : "Asset origin"}</Text>
              <Text style={styles.dealerPanelTitle}>{hasFactoryOrigin ? "Factory package locked" : "Owner/dealer history"}</Text>
            </View>
          </View>
          <View style={styles.factoryRows}>
            <InspectorRow label="OEM" value={oem?.organization_name || (hasFactoryOrigin ? template.manufacturer : "No factory record")} />
            <InspectorRow label="Model" value={identity} />
            <InspectorRow label="HIN" value={currentFactValue(currentFacts, "hin")} />
            <InspectorRow label="Template version" value={`v${template.version || 1}`} />
            <InspectorRow label="Source" value={salesOrigin.source} />
          </View>
        </View>

        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="storefront-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Dealer relationship</Text>
              <Text style={styles.dealerPanelTitle}>{dealer?.organization_name || "SkipperBud's"}</Text>
            </View>
          </View>
          <View style={styles.factoryRows}>
            <InspectorRow label="Role" value={labelize(dealer?.relationship_type || (isHarrisWilson ? "servicing_dealer" : "delivery_dealer"))} />
            <InspectorRow label="Location" value={dealer?.location_name || (isHarrisWilson ? "Wilson Marine" : "Lake Fenton Marina")} />
            <InspectorRow label="Access" value={labelize(dealer?.access_scope || "service_workspace")} />
            <InspectorRow label="Status" value={dealer?.status || "active"} />
          </View>
        </View>
      </View>

      <View style={styles.dealerPanel}>
        <View style={styles.dealerPanelHeader}>
          <Ionicons name="receipt-outline" size={18} color={colors.brandBlue} />
          <View>
            <Text style={styles.dealerPanelKicker}>Known sale</Text>
            <Text style={styles.dealerPanelTitle}>{salesOrigin.seller}</Text>
          </View>
        </View>
        <View style={styles.salesOriginGrid}>
          <InspectorRow label="Sold by" value={salesOrigin.seller} />
          <InspectorRow label="Sold to" value={salesOrigin.buyer} />
          <InspectorRow label="Date" value={salesOrigin.date} />
          <InspectorRow label="Amount" value={salesOrigin.amount} />
        </View>
      </View>

      <View style={styles.dealerPanel}>
        <View style={styles.dealerPanelHeader}>
          <Ionicons name="clipboard-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Dealer workflow</Text>
            <Text style={styles.dealerPanelTitle}>
              {isHarrisWilson ? "Continue the relationship without recreating the boat" : "Prepare delivery without rewriting factory truth"}
            </Text>
            </View>
          </View>
        <View style={styles.dealerTaskGrid}>
          {dealerTasks.map((task) => (
            <View key={task.title} style={styles.dealerTask}>
              <View style={styles.dealerTaskTop}>
                <View style={styles.dealerTaskIcon}>
                  <Ionicons name={task.icon} size={17} color={colors.brandBlue} />
                </View>
                <View style={styles.dealerTaskState}>
                  <Text style={styles.dealerTaskStateText}>{task.state}</Text>
                </View>
              </View>
              <Text style={styles.dealerTaskTitle}>{task.title}</Text>
              <Text style={styles.dealerTaskBody}>{task.body}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.dealerGrid}>
        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="images-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Exact-hull media</Text>
              <Text style={styles.dealerPanelTitle}>Dealer photos and evidence</Text>
            </View>
          </View>
          <Text style={styles.dealerBody}>
            Delivery dock photos, commissioning images, dealer-installed option photos, and invoices belong to this exact hull. OEM catalog photos remain inherited template media.
          </Text>
        </View>
        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Owner portal</Text>
              <Text style={styles.dealerPanelTitle}>HappyOwner receives the operational boat</Text>
            </View>
          </View>
          <Text style={styles.dealerBody}>
            {isHarrisWilson
              ? "Andy opens Keepr into this Harris as an asset hub with real history, systems, records, next actions, and one-click service through Wilson Marine."
              : "When activated, the owner should open Keepr directly into this boat as an asset hub with systems, manuals, records, next actions, and one-click service through the connected dealer."}
          </Text>
          <TouchableOpacity style={styles.dealerPrimaryButton} activeOpacity={0.85} onPress={onOpenBoatStory}>
            <Ionicons name="eye-outline" size={15} color={colors.onPrimary} />
            <Text style={styles.dealerPrimaryButtonText}>Preview Owner Keepr Hub</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function OverviewWorkspace({ workspace, onModeChange, onOpenBoatStory }) {
  const asset = workspace?.asset || {};
  const template = workspace?.template || {};
  const facts = workspace?.facts || [];
  const resources = workspace?.resources || [];
  const relationships = workspace?.relationship_details || workspace?.relationships || [];
  const currentFacts = workspace?.current_facts || {};
  const systems = (workspace?.template?.items || []).filter((item) => item.item_type !== "section").slice(0, 6);
  const oem = relationships.find((item) => item.relationship_type === "oem");
  const dealer = relationships.find((item) => ["delivery_dealer", "selling_dealer"].includes(item.relationship_type));
  const service = relationships.find((item) => ["servicing_dealer", "service_provider"].includes(item.relationship_type));
  const identity = compact([
    asset.year || template.model_year,
    asset.make || template.manufacturer,
    asset.model || template.model,
  ]);
  const operatingState = asset.owner_state || workspace?.activation_workflow?.vessel_state || null;
  const visibleRelationships = [
    oem ? { label: "OEM", value: oem.organization_name } : null,
    dealer ? { label: "Dealer", value: dealer.organization_name } : null,
    service ? { label: "Service", value: service.organization_name } : null,
    dealer?.location_name || service?.location_name
      ? { label: "Location", value: dealer?.location_name || service?.location_name }
      : null,
  ].filter((item) => item?.value);
  const hasIdentityDetails = Boolean(
    currentFactValue(currentFacts, "hin") ||
      asset.serial_number ||
      operatingState ||
      resources.length ||
      facts.length
  );

  return (
    <View style={styles.dealerWorkspace}>
      <View style={styles.dealerIntro}>
        <View>
          <Text style={styles.dealerKicker}>Boat workspace</Text>
          <Text style={styles.dealerTitle}>{asset.name || identity || "Boat"}</Text>
          <Text style={styles.dealerBody}>
            Keepr is showing the production-backed context currently resolved for this boat.
          </Text>
        </View>
        {asset.kac_id ? (
          <View style={styles.dealerKacCard}>
            <Text style={styles.dealerCardLabel}>Keepr Code</Text>
            <Text style={styles.dealerKac}>{asset.kac_id}</Text>
            <Text style={styles.dealerCardText}>{identity}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.dealerGrid}>
        {hasIdentityDetails ? (
          <View style={styles.dealerPanel}>
            <View style={styles.dealerPanelHeader}>
              <Ionicons name="boat-outline" size={18} color={colors.brandBlue} />
              <View>
                <Text style={styles.dealerPanelKicker}>Boat identity</Text>
                <Text style={styles.dealerPanelTitle}>{identity || asset.name || "Boat"}</Text>
              </View>
            </View>
            <View style={styles.factoryRows}>
              <DataRow label="HIN" value={currentFactValue(currentFacts, "hin") || asset.serial_number} />
              <DataRow label="Operating state" value={operatingState} />
              {resources.length ? <InspectorRow label="Resources" value={`${resources.length} files and sources`} /> : null}
              {facts.length ? <InspectorRow label="Facts" value={`${facts.length} known facts`} /> : null}
            </View>
          </View>
        ) : null}

        {visibleRelationships.length ? (
          <View style={styles.dealerPanel}>
            <View style={styles.dealerPanelHeader}>
              <Ionicons name="git-network-outline" size={18} color={colors.brandBlue} />
              <View>
                <Text style={styles.dealerPanelKicker}>Connected organizations</Text>
                <Text style={styles.dealerPanelTitle}>{visibleRelationships.length} active connection{visibleRelationships.length === 1 ? "" : "s"}</Text>
              </View>
            </View>
            <View style={styles.factoryRows}>
              {visibleRelationships.map((item) => (
                <InspectorRow key={item.label} label={item.label} value={item.value} />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      {systems.length ? (
        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="albums-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Key systems</Text>
              <Text style={styles.dealerPanelTitle}>What Keepr understands about this boat</Text>
            </View>
          </View>
          <View style={styles.dealerTaskGrid}>
            {systems.map((system) => (
              <View key={system.id} style={styles.dealerTask}>
                <Text style={styles.dealerTaskTitle}>{system.label}</Text>
                <Text style={styles.dealerTaskBody}>{valueText(system.expected_value) || labelize(system.item_type)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.inlineModeActions}>
        {dealer ? (
          <TouchableOpacity style={styles.dealerSecondaryButton} activeOpacity={0.85} onPress={() => onModeChange("sales")}>
            <Ionicons name="pricetag-outline" size={15} color={colors.brandNavy} />
            <Text style={styles.dealerSecondaryButtonText}>Open Sales View</Text>
          </TouchableOpacity>
        ) : null}
        {service ? (
          <TouchableOpacity style={styles.dealerPrimaryButton} activeOpacity={0.85} onPress={() => onModeChange("service")}>
            <Ionicons name="construct-outline" size={15} color={colors.onPrimary} />
            <Text style={styles.dealerPrimaryButtonText}>Open Service View</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.dealerSecondaryButton} activeOpacity={0.85} onPress={onOpenBoatStory}>
          <Ionicons name="book-outline" size={15} color={colors.brandNavy} />
          <Text style={styles.dealerSecondaryButtonText}>Open Owner Keepr</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ServiceWorkspace({ workspace, navigation, onOpenBoatStory }) {
  const asset = workspace?.asset || {};
  const relationships = workspace?.relationship_details || workspace?.relationships || [];
  const service = relationships.find((item) => ["servicing_dealer", "service_provider"].includes(item.relationship_type)) ||
    relationships.find((item) => ["delivery_dealer", "selling_dealer"].includes(item.relationship_type));
  const organizationId = service?.organization_id || null;
  const openServiceWorkspace = () => {
    navigation.navigate("KeeprProStack", {
      screen: "KeeprProStewardshipView",
      params: {
        assetId: asset.id,
        kac: asset.kac_id,
        organizationId,
        stewardshipId: service?.stewardship_id || null,
      },
    });
  };

  return (
    <View style={styles.dealerWorkspace}>
      <View style={styles.dealerIntro}>
        <View>
          <Text style={styles.dealerKicker}>Service view</Text>
          <Text style={styles.dealerTitle}>{service?.organization_name ? `${service.organization_name} service relationship` : "Service relationship"}</Text>
          <Text style={styles.dealerBody}>
            Open the relationship workspace for current work, shared history, messages, files, and service context from the canonical relationship resolver.
          </Text>
        </View>
        {service?.organization_name ? (
          <View style={styles.dealerKacCard}>
            <Text style={styles.dealerCardLabel}>Service partner</Text>
            <Text style={styles.dealerKac}>{service.organization_name}</Text>
            <Text style={styles.dealerCardText}>{labelize(service.relationship_type || "service relationship")}</Text>
          </View>
        ) : null}
      </View>

      {service?.organization_name ? (
        <View style={styles.dealerPanel}>
          <View style={styles.dealerPanelHeader}>
            <Ionicons name="git-network-outline" size={18} color={colors.brandBlue} />
            <View>
              <Text style={styles.dealerPanelKicker}>Connected relationship</Text>
              <Text style={styles.dealerPanelTitle}>{compact([asset.owner_display_name || "Owner", service.organization_name])}</Text>
            </View>
          </View>
          <View style={styles.factoryRows}>
            <DataRow label="Boat" value={asset.name} />
            <DataRow label="Owner" value={asset.owner_display_name} />
            <DataRow label="Provider" value={service.organization_name} />
            <DataRow label="Role" value={labelize(service.relationship_type || "service")} />
            <DataRow label="Status" value={labelize(service.status || "active")} />
          </View>
        </View>
      ) : null}

      <View style={styles.inlineModeActions}>
        {service?.organization_name ? (
          <TouchableOpacity style={styles.dealerPrimaryButton} activeOpacity={0.85} onPress={openServiceWorkspace}>
            <Ionicons name="chatbubbles-outline" size={15} color={colors.onPrimary} />
            <Text style={styles.dealerPrimaryButtonText}>Open Relationship Workspace</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.dealerSecondaryButton} activeOpacity={0.85} onPress={onOpenBoatStory}>
          <Ionicons name="book-outline" size={15} color={colors.brandNavy} />
          <Text style={styles.dealerSecondaryButtonText}>Open Owner Keepr</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NodeCard({ node, selected, onPress }) {
  const state = stateForNode(node);
  const isPhoto = node.resource?.resource_type === "photo" && node.resource?.metadata?.media_scope === "model_template";
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={[styles.nodeCard, selected && styles.nodeCardSelected]}>
      {isPhoto ? (
        <ImageBackground source={mediaAsset(node.resource)} resizeMode="cover" style={styles.nodePhoto} imageStyle={styles.nodePhotoAsset}>
          <View style={styles.nodePhotoShade}>
            <StatusPill state={state} />
          </View>
        </ImageBackground>
      ) : null}
      <View style={styles.nodeHeader}>
        {isPhoto ? <Text style={styles.photoNodeLabel}>Model media</Text> : <StatusPill state={state} />}
        <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
      </View>
      <Text style={styles.nodeTitle} numberOfLines={2}>{node.label}</Text>
      <Text style={styles.nodeSummary} numberOfLines={2}>{node.summary || nodeTypeLabel(node)}</Text>
      <View style={styles.nodeActions}>
        <View style={styles.nodeAction}>
          <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.nodeActionText}>Manual</Text>
        </View>
        <View style={styles.nodeAction}>
          <Ionicons name="build-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.nodeActionText}>Playbook</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function NodeGroup({ group, selectedId, onSelect }) {
  return (
    <View style={styles.nodeGroup}>
      <View style={styles.groupHeader}>
        <View style={styles.groupIcon}>
          <Ionicons name="book-outline" size={17} color={colors.brandBlue} />
        </View>
        <View>
          <Text style={styles.groupEyebrow}>{group.eyebrow}</Text>
          <Text style={styles.groupTitle}>{group.title}</Text>
        </View>
      </View>
      <View style={styles.nodeGrid}>
        {group.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selectedId === node.id}
            onPress={() => onSelect(node)}
          />
        ))}
      </View>
    </View>
  );
}

function InspectorRow({ label, value }) {
  return (
    <View style={styles.inspectorRow}>
      <Text style={styles.inspectorLabel}>{label}</Text>
      <Text style={styles.inspectorValue}>{value || "Not set"}</Text>
    </View>
  );
}

function DataRow({ label, value }) {
  if (value === null || value === undefined || value === "" || value === "Not set") return null;
  return <InspectorRow label={label} value={value} />;
}

function Inspector({ node, workspace }) {
  if (!node) {
    return (
      <View style={styles.inspector}>
        <View style={styles.inspectorIcon}>
          <Ionicons name="open-outline" size={20} color={colors.brandBlue} />
        </View>
        <Text style={styles.inspectorTitle}>Selected node detail</Text>
        <Text style={styles.inspectorText}>Open a vessel node, component, resource, relationship, or playbook to inspect readiness and provenance.</Text>
      </View>
    );
  }

  const item = node.item;
  const relationship = node.relationship;
  const resource = node.resource;
  const facts = node.facts || [];
  const resources = node.resources?.length ? node.resources : workspace?.resources || [];
  const state = stateForNode(node);

  return (
    <View style={styles.inspector}>
      <View style={styles.inspectorTop}>
        <View style={styles.inspectorIcon}>
          <Ionicons name={node.type === "relationship" ? "git-network-outline" : "cube-outline"} size={20} color={colors.brandBlue} />
        </View>
        <Text style={styles.inspectorKicker}>Selected node detail</Text>
      </View>
      <Text style={styles.inspectorTitle}>{node.label}</Text>
      <StatusPill state={state} />

      <View style={styles.inspectorRows}>
        <InspectorRow label="Node type" value={nodeTypeLabel(node)} />
        <InspectorRow label="Status" value={stateCopy(state)} />
        <InspectorRow label="Confidence" value={facts[0]?.confidence ? `${Math.round(facts[0].confidence * 100)}%` : node.selected ? "95%" : "Model baseline"} />
        <InspectorRow label="Facts" value={facts.length ? facts.map((fact) => compact([labelize(fact.fact_key), valueText(fact.fact_value)])).join("\n") : node.summary} />
        <InspectorRow label="Resources" value={resources.slice(0, 4).map((res) => res.title || res.source_name).filter(Boolean).join("\n")} />
        <InspectorRow label="Source" value={resource?.source_name || item?.metadata?.source_context || relationship?.source_table || "Activator production foundation"} />
      </View>
    </View>
  );
}

export default function ActivatorBoatWorkspaceScreen({ navigation, route }) {
  const assetId = route?.params?.assetId;
  const [operatingMode, setOperatingMode] = useState(route?.params?.mode || "overview");
  const [projection, setProjection] = useState("oem");
  const [organizationId, setOrganizationId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [workspace, setWorkspace] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!assetId) return;
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const nextWorkspace = await getActivatorBoatWorkspace({
        assetId,
        projection,
        organizationId,
      });
      setWorkspace(nextWorkspace);
    } catch (err) {
      console.error("Activator workspace load failed:", err);
      setError(err?.message || "Could not load vessel workspace.");
      setWorkspace(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [assetId, organizationId, projection]);

  useEffect(() => {
    load();
  }, [load]);

  const relationships = workspace?.relationship_details || workspace?.relationships || [];
  const currentFacts = workspace?.current_facts || {};
  const template = workspace?.template || {};
  const asset = workspace?.asset || {};
  const workflow = workspace?.activation_workflow || {};
  const facts = workspace?.facts || [];
  const media = modelMedia(workspace);
  const heroMedia = media.find((item) => item.metadata?.role === "hero");
  const oemRelationship = relationships.find((item) => item.relationship_type === "oem");
  const dealerRelationship = relationships.find((item) =>
    ["delivery_dealer", "servicing_dealer", "selling_dealer", "service_provider"].includes(item.relationship_type)
  );
  const identity = compact([
    asset.year || template.model_year,
    asset.make || template.manufacturer,
    asset.model || template.model,
  ]);
  const selectedOptions = facts.filter((fact) => fact.fact_key === "option.selected" && fact.fact_value === true).length;
  const verifiedFacts = facts.filter((fact) => ["dealer_confirmed", "oem_as_built", "evidence_verified", "service_verified"].includes(fact.authority_state)).length;
  const readinessPercent = facts.length ? Math.round((verifiedFacts / facts.length) * 100) : 0;

  const groups = useMemo(() => filterGroups(buildNodeGroups({ workspace, query }), filter), [workspace, query, filter]);
  const flatNodes = useMemo(() => groups.flatMap((group) => group.nodes), [groups]);

  useEffect(() => {
    if (!workspace) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode((current) => {
      if (current && flatNodes.some((node) => node.id === current.id)) return current;
      return flatNodes[0] || null;
    });
  }, [workspace, flatNodes]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const switchOperatingMode = (nextMode) => {
    setOperatingMode(nextMode);
    if (nextMode === "sales") {
      setProjection("dealer");
      setOrganizationId(dealerRelationship?.organization_id || null);
    } else if (nextMode === "service") {
      setProjection("dealer");
      setOrganizationId(dealerRelationship?.organization_id || null);
    } else {
      setProjection("oem");
      setOrganizationId(null);
    }
  };

  const openBoatStory = () => {
    if (!asset?.id) return;
    navigation.navigate("BoatStory", {
      boatId: asset.id,
      boatName: asset.name || identity || "Boat",
    });
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
            { label: "Active Fleet", route: "ActivatorHome", params: { initialMode: "fleet" } },
          ]}
          current={asset.kac_id || "KAC-TIARA-39LS-BUILD-DEMO"}
          right={(
            <View style={styles.projectionRail}>
              {OPERATING_MODES.map((item) => (
                <OperatingModeButton
                  key={item.key}
                  mode={item}
                  active={operatingMode === item.key}
                  onPress={() => switchOperatingMode(item.key)}
                />
              ))}
            </View>
          )}
        />

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.mutedText}>Loading vessel workspace...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyPanel}>
            <Ionicons name="warning-outline" size={24} color={colors.danger} />
            <Text style={styles.emptyTitle}>Workspace unavailable</Text>
            <Text style={styles.mutedText}>{error}</Text>
          </View>
        ) : workspace ? (
          <>
            <View style={styles.heroPanel}>
              <ImageBackground source={mediaAsset(heroMedia)} resizeMode="cover" style={styles.heroImage} imageStyle={styles.heroImageAsset}>
                <View style={styles.heroShade}>
                  <View style={styles.poweredBadge}>
                    <Text style={styles.poweredBadgeText}>Powered by Keepr</Text>
                  </View>
                </View>
              </ImageBackground>
              <View style={styles.heroCopy}>
                <Text style={styles.eyebrow}>Keepr boat workspace</Text>
                <Text style={styles.title}>{asset.name || route?.params?.assetName || "Boat Passport"}</Text>
                <Text style={styles.subtitle}>{compact([identity, currentFactValue(currentFacts, "hin")])}</Text>
                <View style={styles.heroBadges}>
                  <View style={styles.heroBadge}>
                    <Ionicons name="key-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.heroBadgeText}>Keepr Code {asset.kac_id || "Pending"}</Text>
                  </View>
                  <View style={styles.heroBadgeGreen}>
                    <Text style={styles.heroBadgeGreenText}>{labelize(operatingMode)} view</Text>
                  </View>
                </View>
              </View>
            </View>

            {operatingMode === "overview" ? (
              <OverviewWorkspace workspace={workspace} onModeChange={switchOperatingMode} onOpenBoatStory={openBoatStory} />
            ) : operatingMode === "sales" ? (
              <DealerPrepWorkspace workspace={workspace} onOpenBoatStory={openBoatStory} />
            ) : operatingMode === "service" ? (
              <ServiceWorkspace workspace={workspace} navigation={navigation} onOpenBoatStory={openBoatStory} />
            ) : (
              <>
                <MediaLayerPanel workspace={workspace} projection={projection} />

                <View style={styles.advancedBanner}>
                  <View>
                    <Text style={styles.advancedKicker}>
                      {projection === "oem" ? "OEM advanced configuration" : projection === "owner" ? "Owner projection preview" : "Handoff projection preview"}
                    </Text>
                    <Text style={styles.advancedTitle}>
                      {projection === "oem" ? "Full configured operational package" : projection === "owner" ? "What flows into Keepr" : "Continuity packet"}
                    </Text>
                  </View>
                  <Text style={styles.advancedBody}>
                    {projection === "oem"
                      ? "Tiara can inspect every system, component, resource, manual, playbook, relationship, fact, and provenance item before the factory layer flows downstream."
                      : "This preview shows what the same KAC exposes after the factory and dealer layers have been scoped for the next participant."}
                  </Text>
                </View>

                <View style={styles.commandBar}>
                  <View style={styles.searchRow}>
                    <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search nodes, facts, resources..."
                      placeholderTextColor={colors.textMuted}
                      style={styles.searchInput}
                      returnKeyType="search"
                    />
                  </View>
                  <View style={styles.filterRow}>
                    {NODE_FILTERS.map((item) => (
                      <FilterButton key={item.key} item={item} active={filter === item.key} onPress={() => setFilter(item.key)} />
                    ))}
                    <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.85} onPress={openBoatStory}>
                      <Ionicons name="book-outline" size={14} color={colors.textSecondary} />
                      <Text style={styles.secondaryButtonText}>Open BoatStory</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.mainLayout}>
                  <View style={styles.nodeColumn}>
                    <View style={styles.intelligencePanel}>
                      <View style={styles.intelligenceIcon}>
                        <Ionicons name="sparkles-outline" size={18} color={colors.brandBlue} />
                      </View>
                      <View style={styles.intelligenceGrid}>
                        <View style={styles.intelligenceTile}>
                          <Text style={styles.tileTitle}>Current state</Text>
                          <Text style={styles.tileText}>{facts.length} facts · {workspace.resources?.length || 0} resources · {relationships.length} relationships</Text>
                        </View>
                        <View style={styles.intelligenceTile}>
                          <Text style={styles.tileTitle}>Readiness</Text>
                          <Text style={styles.tileText}>{readinessPercent}% evidenced · {workflow.status || "draft"} · {workflow.vessel_state || "unresolved"}</Text>
                        </View>
                        <View style={styles.intelligenceTile}>
                          <Text style={styles.tileTitle}>Configuration</Text>
                          <Text style={styles.tileText}>{selectedOptions} selected options · template v{template.version || 1}</Text>
                        </View>
                        <View style={styles.intelligenceTile}>
                          <Text style={styles.tileTitle}>Next actions</Text>
                          <Text style={styles.tileText}>Confirm manuals · assign care · prepare owner handoff</Text>
                        </View>
                      </View>
                    </View>

                    {groups.length ? groups.map((group) => (
                      <NodeGroup
                        key={group.key}
                        group={group}
                        selectedId={selectedNode?.id}
                        onSelect={setSelectedNode}
                      />
                    )) : (
                      <View style={styles.emptyPanel}>
                        <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                        <Text style={styles.emptyTitle}>No matching nodes</Text>
                        <Text style={styles.mutedText}>Try a different search or status filter.</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.inspectorColumn}>
                    <Inspector node={selectedNode} workspace={workspace} />
                  </View>
                </View>
              </>
            )}
          </>
        ) : (
          <View style={styles.emptyPanel}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No projection available</Text>
            <Text style={styles.mutedText}>This account does not have a readable owner, dealer, or OEM projection for the vessel.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  projectionRail: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  breadcrumb: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  breadcrumbActive: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  breadcrumbSpacer: {
    flex: 1,
    minWidth: 20,
  },
  projectionButton: {
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
  projectionButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  projectionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
  },
  projectionTextActive: {
    color: colors.onPrimary,
  },
  disabled: {
    opacity: 0.45,
  },
  heroPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    overflow: "hidden",
    ...shadows.sm,
  },
  heroImage: {
    flex: 1.15,
    minHeight: 285,
    minWidth: 320,
  },
  heroImageAsset: {
    borderBottomLeftRadius: radius.sm,
    borderTopLeftRadius: radius.sm,
  },
  heroShade: {
    backgroundColor: "rgba(10,17,35,0.12)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  poweredBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(19,26,68,0.88)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  poweredBadgeText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  heroCopy: {
    flex: 0.9,
    justifyContent: "center",
    minHeight: 285,
    minWidth: 330,
    padding: spacing.xl,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 36,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  heroBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  heroBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heroBadgeText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  heroBadgeGreen: {
    backgroundColor: "#DCFCE7",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heroBadgeGreenText: {
    color: "#166534",
    fontSize: 11,
    fontWeight: "900",
  },
  heroBadgeAmber: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heroBadgeAmberText: {
    color: "#92400E",
    fontSize: 11,
    fontWeight: "900",
  },
  selectedLine: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.lg,
  },
  advancedBanner: {
    alignItems: "flex-start",
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
    ...shadows.sm,
  },
  advancedKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  advancedTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  advancedBody: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    minWidth: 280,
    maxWidth: 640,
  },
  mediaLayerPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  mediaLayerHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  mediaLayerKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  mediaLayerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  mediaLayerPill: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  mediaLayerPillText: {
    color: colors.brandNavy,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  mediaLayerBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
    maxWidth: 880,
  },
  mediaLayerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  mediaThumb: {
    backgroundColor: "#0B1220",
    borderRadius: radius.sm,
    flexGrow: 1,
    height: 140,
    minWidth: 210,
    overflow: "hidden",
    width: "23%",
  },
  mediaThumbImage: {
    borderRadius: radius.sm,
    objectFit: "cover",
    objectPosition: "center center",
  },
  mediaThumbShade: {
    backgroundColor: "rgba(10,17,35,0.12)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  mediaThumbLabel: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(19,26,68,0.86)",
    borderRadius: radius.sm,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  mediaThumbMeta: {
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: "800",
    marginTop: spacing.xs,
    textShadowColor: "rgba(0,0,0,0.42)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    textTransform: "uppercase",
  },
  mediaPlaceholder: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 122,
    minWidth: 210,
    padding: spacing.md,
    width: "23%",
  },
  mediaPlaceholderTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  mediaPlaceholderText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  dealerWorkspace: {
    gap: spacing.lg,
  },
  dealerIntro: {
    alignItems: "stretch",
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
    ...shadows.sm,
  },
  dealerKicker: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  dealerTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 2,
  },
  dealerBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
    maxWidth: 680,
  },
  dealerKacCard: {
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    justifyContent: "center",
    minWidth: 260,
    padding: spacing.lg,
  },
  dealerCardLabel: {
    color: "#BFDBFE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  dealerKac: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  dealerCardText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  dealerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  dealerPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    minWidth: 320,
    padding: spacing.lg,
    ...shadows.sm,
  },
  dealerPanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  dealerPanelKicker: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  dealerPanelTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
  },
  factoryRows: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dealerTaskGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  dealerTask: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 156,
    minWidth: 260,
    padding: spacing.md,
    width: "23%",
  },
  dealerTaskTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dealerTaskIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  dealerTaskState: {
    backgroundColor: "#EEF2FF",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dealerTaskStateText: {
    color: colors.brandNavy,
    fontSize: 10,
    fontWeight: "900",
  },
  dealerTaskTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: spacing.md,
  },
  dealerTaskBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  dealerPrimaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  dealerSecondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  dealerPrimaryButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  dealerSecondaryButtonText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  inlineModeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  commandBar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 40,
    minWidth: 260,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    outlineStyle: "none",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  filterButtonActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  filterTextActive: {
    color: colors.onPrimary,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  mainLayout: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  nodeColumn: {
    flex: 1,
    gap: spacing.lg,
    minWidth: 340,
  },
  inspectorColumn: {
    maxWidth: 390,
    minWidth: 300,
    width: "32%",
  },
  intelligencePanel: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  intelligenceIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  intelligenceGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  intelligenceTile: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 210,
    padding: spacing.md,
    width: "45%",
  },
  tileTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  tileText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  nodeGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  groupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  groupIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  groupEyebrow: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  groupTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  nodeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  nodeCard: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 150,
    minWidth: 240,
    padding: spacing.md,
    width: "47%",
  },
  nodeCardSelected: {
    borderColor: colors.brandBlue,
    shadowColor: colors.brandBlue,
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  nodePhoto: {
    borderRadius: radius.sm,
    height: 132,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  nodePhotoAsset: {
    borderRadius: radius.sm,
  },
  nodePhotoShade: {
    alignItems: "flex-start",
    backgroundColor: "rgba(6,14,31,0.16)",
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.sm,
  },
  photoNodeLabel: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  nodeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusPill: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  status_verified: {
    backgroundColor: "#DCFCE7",
  },
  status_ready: {
    backgroundColor: "#DBEAFE",
  },
  status_available: {
    backgroundColor: "#FEF3C7",
  },
  status_active: {
    backgroundColor: "#DCFCE7",
  },
  status_review: {
    backgroundColor: "#FEE2E2",
  },
  statusText_verified: {
    color: "#166534",
  },
  statusText_ready: {
    color: colors.brandBlue,
  },
  statusText_available: {
    color: "#92400E",
  },
  statusText_active: {
    color: "#166534",
  },
  statusText_review: {
    color: "#991B1B",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "900",
  },
  nodeTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
    marginTop: spacing.md,
  },
  nodeSummary: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  nodeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: "auto",
    paddingTop: spacing.md,
  },
  nodeAction: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  nodeActionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
  },
  inspector: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  inspectorTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  inspectorIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  inspectorKicker: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  inspectorTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 24,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  inspectorText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  inspectorRows: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  inspectorRow: {
    borderTopColor: colors.borderSubtle,
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
    lineHeight: 19,
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
    fontSize: 17,
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
