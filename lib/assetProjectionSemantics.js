function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compact(parts, separator = " · ") {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(separator);
}

export function labelizeProjectionValue(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function hasActualOwner(asset = {}) {
  const displayName = String(asset.owner_display_name || asset.owner_name || "").trim();
  const placeholder = ["", "owner", "unknown owner", "pending owner", "unassigned owner"];
  return Boolean(
    asset.owner_id ||
      asset.owner_user_id ||
      asset.owner_email ||
      asset.owner_contact?.email ||
      (displayName && !placeholder.includes(displayName.toLowerCase()))
  );
}

export function assetProjectionSemantics({
  asset = {},
  relationship = {},
  workspace = {},
  providerName = "KeeprSpace",
} = {}) {
  const relationshipType = normalize(
    relationship.relationship_type ||
      relationship.relationship_purpose ||
      asset.relationship_type ||
      asset.service_relationship?.relationship_type ||
      asset.dealer_relationship?.relationship_type
  );
  const accessScope = normalize(
    relationship.access_scope ||
      asset.access_scope ||
      asset.service_relationship?.access_scope ||
      asset.dealer_relationship?.access_scope
  );
  const workspaceType = normalize(workspace.workspace_type || workspace.type);
  const ownerPresent = hasActualOwner(asset);

  const isOwner =
    relationshipType === "owner" ||
    accessScope === "owner_full" ||
    workspaceType === "keepr";
  const isInventory =
    ["assigned_dealer", "selling_dealer", "delivery_dealer"].includes(relationshipType) ||
    ["dealer_sales_workspace", "dealer_delivery_workspace"].includes(accessScope);
  const isService =
    ["servicing_dealer", "service_provider", "stewardship_provider", "storage_provider", "steward"].includes(relationshipType) ||
    ["service_workspace", "service_stewardship", "stewardship_workspace", "storage_workspace"].includes(accessScope);
  const projection = isOwner ? "owner" : isInventory ? "inventory" : isService ? "service" : "workspace";
  const relationshipLabel = labelizeProjectionValue(relationshipType || relationship.relationship_purpose || "workspace");
  const assetName = asset.name || asset.asset_name || compact([asset.year, asset.make, asset.model]) || asset.kac_id || "This asset";
  const boatIdentity = compact([asset.year, asset.make, asset.model]);

  if (projection === "owner") {
    const ownerName = asset.owner_display_name || asset.owner_name || "Owner";
    return {
      projection,
      relationshipType,
      accessScope,
      ownerPresent,
      modeLabel: "Ownership",
      workspaceRoleLabel: "Owner",
      workspaceRoleIcon: "person-circle-outline",
      relationshipLabel,
      relationshipTitle: `${ownerName}'s ${assetName}`,
      headerEyebrow: "Ownership",
      heroContext: "Owned asset",
      heroFallbackMeta: "Owner photo will appear here when shared",
      summaryLabel: "Ownership",
      summaryHint: "Ownership, history, systems, files, service, and continuity stay attached to this asset.",
      subtitle: compact([assetName, boatIdentity, "Owner projection"]),
      openLabel: "Open ownership",
      connectionLabel: "Owner connected",
      showOwnerPanel: true,
      showPlaybooks: true,
      showServiceActions: true,
      showContribution: false,
      showConversation: true,
      showInventoryActions: false,
      personPanelLabel: "Owner",
      providerPanelLabel: "Support relationship",
      systemsHint: "Systems and source context available to the owner.",
      playbookTitle: "Owner playbooks",
      playbookHint: "Ownership plans and recurring care stay attached to this asset.",
    };
  }

  if (projection === "inventory") {
    return {
      projection,
      relationshipType,
      accessScope,
      ownerPresent,
      modeLabel: relationshipType === "delivery_dealer" ? "Delivery" : "Inventory",
      workspaceRoleLabel: relationshipType === "assigned_dealer" ? "Assigned Dealer" : relationshipLabel || "Dealer",
      workspaceRoleIcon: "storefront-outline",
      relationshipLabel,
      relationshipTitle: `${assetName} · ${relationshipLabel || "Dealer inventory"}`,
      headerEyebrow: "Dealer inventory",
      heroContext: relationshipType === "delivery_dealer" ? "Delivery prep" : "Workspace inventory",
      heroFallbackMeta: "Inventory photo will appear here when added",
      summaryLabel: relationshipType === "delivery_dealer" ? "Delivery" : "Inventory",
      summaryHint: "This workspace can prepare, package, message, and maintain source context for this assigned boat.",
      subtitle: compact([assetName, boatIdentity, providerName, relationshipLabel]),
      openLabel: "Open inventory",
      connectionLabel: "Workspace inventory",
      showOwnerPanel: ownerPresent,
      showPlaybooks: false,
      showServiceActions: false,
      showContribution: false,
      showConversation: true,
      showInventoryActions: true,
      personPanelLabel: ownerPresent ? "Owner" : "Owner not assigned",
      providerPanelLabel: "Dealer assignment",
      systemsHint: "Build, package, systems, and source context available for inventory and delivery.",
      playbookTitle: "Playbooks not active for inventory",
      playbookHint: "Assign an owner or service relationship before using owner/service playbooks.",
    };
  }

  if (projection === "service") {
    return {
      projection,
      relationshipType,
      accessScope,
      ownerPresent,
      modeLabel: "Service",
      workspaceRoleLabel: relationshipLabel || "Service",
      workspaceRoleIcon: "briefcase-outline",
      relationshipLabel,
      relationshipTitle: ownerPresent
        ? `${asset.owner_display_name || "Owner"} ↔ ${providerName}`
        : `${assetName} · ${relationshipLabel || "Service relationship"}`,
      headerEyebrow: "Service relationship",
      heroContext: "Service relationship",
      heroFallbackMeta: "Service photo will appear here when shared",
      summaryLabel: "Service",
      summaryHint: "Service records, messages, files, systems, and playbooks stay attached to this relationship.",
      subtitle: compact([assetName, ownerPresent ? "Customer connected" : "Customer not assigned", providerName]),
      openLabel: "Open service",
      connectionLabel: ownerPresent ? "Customer connected" : "Service workspace",
      showOwnerPanel: ownerPresent,
      showPlaybooks: true,
      showServiceActions: true,
      showContribution: ownerPresent,
      showConversation: true,
      showInventoryActions: false,
      personPanelLabel: ownerPresent ? "Customer" : "Customer not assigned",
      providerPanelLabel: "Service role",
      systemsHint: "Systems and source context available for service work.",
      playbookTitle: "Service playbooks",
      playbookHint: "Recurring service plans for this relationship. Playbooks organize; Actions execute.",
    };
  }

  return {
    projection,
    relationshipType,
    accessScope,
    ownerPresent,
    modeLabel: "Workspace",
    workspaceRoleLabel: relationshipLabel || "Workspace",
    workspaceRoleIcon: "briefcase-outline",
    relationshipLabel,
    relationshipTitle: `${assetName} · Workspace projection`,
    headerEyebrow: "Workspace",
    heroContext: "Workspace projection",
    heroFallbackMeta: "Photo will appear here when shared",
    summaryLabel: "Workspace",
    summaryHint: "This object is visible because of a workspace relationship.",
    subtitle: compact([assetName, boatIdentity, relationshipLabel]),
    openLabel: "Open workspace",
    connectionLabel: "Workspace only",
    showOwnerPanel: ownerPresent,
    showPlaybooks: false,
    showServiceActions: false,
    showContribution: false,
    showConversation: true,
    showInventoryActions: false,
    personPanelLabel: ownerPresent ? "Owner" : "Owner not assigned",
    providerPanelLabel: "Workspace role",
    systemsHint: "Systems and source context available to this workspace.",
    playbookTitle: "Playbooks unavailable",
    playbookHint: "This relationship does not enable owner/service playbooks.",
  };
}
