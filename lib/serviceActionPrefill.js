function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildServiceActionPrefill({
  assetId = null,
  assetName = null,
  systemId = null,
  systemName = null,
  assetType = null,
  sourceScreen = null,
  organizationId = null,
} = {}) {
  const cleanAssetName = clean(assetName);
  const cleanSystemName = clean(systemName);
  const subjectName = cleanSystemName || cleanAssetName;
  const scope = systemId ? "system" : assetId ? "asset" : "general";

  const notes = [
    cleanSystemName ? `Subject system: ${cleanSystemName}` : null,
    cleanSystemName && cleanAssetName ? `Parent asset: ${cleanAssetName}` : null,
    !cleanSystemName && cleanAssetName ? `Subject asset: ${cleanAssetName}` : null,
    "Service Action created from Keepr.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: subjectName ? `Service: ${subjectName}` : "Service",
    notes,
    status: "open",
    asset_id: assetId || null,
    system_id: systemId || null,
    extra_metadata: {
      action_type: "service",
      service_action: true,
      source: sourceScreen || "add_service",
      source_screen: sourceScreen || "add_service",
      assignment_scope: scope,
      asset_type: assetType || null,
      asset_id: assetId || null,
      system_id: systemId || null,
      visibility_org_id: organizationId || null,
      service_template_org_id: organizationId || null,
      subject_label: subjectName || null,
    },
  };
}

export function buildServiceActionRouteParams(options = {}) {
  const prefill = buildServiceActionPrefill(options);
  return {
    prefill,
    assetId: prefill.asset_id,
    systemId: prefill.system_id,
    organizationId: options.organizationId || null,
    afterSave: options.afterSave || "Notifications",
    afterSaveParams: options.afterSaveParams || null,
  };
}
