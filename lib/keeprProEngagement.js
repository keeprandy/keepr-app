function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export const KEEPRPRO_SYSTEM_CONNECTOR_TYPE = "services_system";
export const KEEPRPRO_CONNECTOR_CAPABILITIES = [
  "organization",
  "operational",
  "action",
];

export function buildKeeprProProviderTarget({
  keeprProId,
  keeprProLabel,
  assignmentScope = "asset",
  assetId = null,
  systemId = null,
}) {
  const id = clean(keeprProId);
  if (!id) return null;

  const scope = assignmentScope === "system" && systemId ? "system" : "asset";
  return {
    type: "keepr_pro",
    id,
    label: clean(keeprProLabel) || "KeeprPro",
    scope,
    asset_id: assetId || null,
    system_id: scope === "system" ? systemId || null : null,
    connector_type: scope === "system" ? KEEPRPRO_SYSTEM_CONNECTOR_TYPE : "services_asset",
    capabilities: KEEPRPRO_CONNECTOR_CAPABILITIES,
  };
}

export function buildPrivateKeeprProActionPrefill({
  actionTitle,
  actionMessage,
  assetId = null,
  assetName = null,
  systemId = null,
  systemName = null,
  keeprProId = null,
  keeprProLabel = null,
  assignmentScope = "asset",
  sourceScreen = "private_keeprpro_request",
  sourceUrl = null,
  contact = null,
  dueAt = null,
}) {
  const providerTarget = buildKeeprProProviderTarget({
    keeprProId,
    keeprProLabel,
    assignmentScope,
    assetId,
    systemId,
  });

  const subjectLine = systemName
    ? `Subject system: ${systemName}`
    : assetName
    ? `Subject asset: ${assetName}`
    : null;
  const parentLine = systemName && assetName ? `Parent asset: ${assetName}` : null;
  const providerLine = providerTarget?.label ? `KeeprPro: ${providerTarget.label}` : null;
  const message = clean(actionMessage);
  const notes = [
    providerLine,
    subjectLine,
    parentLine,
    message ? `Request: ${message}` : "Request service through KeeprPro.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title:
      clean(actionTitle) ||
      (systemName
        ? `Request service: ${systemName}`
        : assetName
        ? `Request service: ${assetName}`
        : "Request KeeprPro service"),
    notes,
    due_at: dueAt || new Date().toISOString(),
    has_time: true,
    is_urgent: false,
    repeat_rule: null,
    status: "open",
    asset_id: assetId || null,
    system_id: systemId || null,
    extra_metadata: {
      source: "keeprpro_private_request",
      provider_target: providerTarget,
      keeprpro_connector: {
        type: providerTarget?.connector_type || null,
        source_node: providerTarget
          ? {
              type: "keepr_pro",
              id: providerTarget.id,
              label: providerTarget.label,
            }
          : null,
        target_node: systemId
          ? {
              type: "system",
              id: systemId,
              label: systemName || null,
            }
          : {
              type: "asset",
              id: assetId || null,
              label: assetName || null,
            },
        context_asset: {
          id: assetId || null,
          label: assetName || null,
        },
        capabilities: KEEPRPRO_CONNECTOR_CAPABILITIES,
        assignment_scope: providerTarget?.scope || assignmentScope || null,
        source_screen: sourceScreen || null,
        source_url: sourceUrl || null,
        contact: contact || null,
      },
    },
  };
}
