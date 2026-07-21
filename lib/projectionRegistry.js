export const PROJECTION_PURPOSES = {
  SHARE: "share",
  EVENT: "event",
  CUSTOM: "custom",
  FOR_SALE: "for_sale",
  FOR_RENT: "for_rent",
  SERVICE_READY: "service_ready",
};

export const PROJECTION_TEMPLATES = {
  share: {
    key: "share",
    label: "Share",
    scope: "asset",
    operational: true,
    exposed: true,
    supportedActions: ["request_info", "request_service", "submit_quote"],
    legacyModes: ["inquiry", "current_story", "system_story"],
  },
  event: {
    key: "event",
    label: "Event",
    scope: "asset",
    operational: true,
    exposed: true,
    supportedActions: ["request_info"],
    legacyModes: ["event"],
  },
  custom: {
    key: "custom",
    label: "Custom",
    scope: "asset",
    operational: true,
    exposed: true,
    supportedActions: ["request_info", "request_service", "submit_quote", "submit_proposal"],
    legacyModes: ["custom"],
  },
  for_sale: {
    key: "for_sale",
    label: "For Sale",
    scope: "asset",
    operational: false,
    exposed: false,
    supportedActions: ["request_info", "submit_quote"],
    legacyModes: ["for_sale"],
  },
  for_rent: {
    key: "for_rent",
    label: "For Rent",
    scope: "asset",
    operational: false,
    exposed: false,
    supportedActions: ["request_info", "request_service", "pay_rent"],
    legacyModes: ["for_rent"],
  },
  service_ready: {
    key: "service_ready",
    label: "Service Ready",
    scope: "system",
    operational: true,
    exposed: true,
    supportedActions: ["request_service"],
    cardDefinitions: ["system_identity", "assigned_provider", "service_history", "proof", "readiness_status", "actions"],
    legacyModes: ["service_ready"],
  },
};

export function getProjectionTemplate(key) {
  return PROJECTION_TEMPLATES[String(key || "").trim()] || PROJECTION_TEMPLATES.share;
}

export function getOperationalProjectionOptions({ scope = null } = {}) {
  return Object.values(PROJECTION_TEMPLATES).filter((template) => {
    if (!template.operational || !template.exposed) return false;
    if (!scope) return true;
    return template.scope === scope;
  });
}

export function mapLegacyModeToProjectionPurpose(mode) {
  const clean = String(mode || "").trim();
  if (!clean) return "share";

  for (const template of Object.values(PROJECTION_TEMPLATES)) {
    if ((template.legacyModes || []).includes(clean)) return template.key;
  }

  return "share";
}

export function normalizeProjectionConfig(publicConfig = {}) {
  const actionMode = publicConfig?.actions?.mode;
  const rawProjection =
    publicConfig?.projection && typeof publicConfig.projection === "object"
      ? publicConfig.projection
      : {};
  const purpose = rawProjection.purpose || mapLegacyModeToProjectionPurpose(actionMode);
  const template = getProjectionTemplate(purpose);

  return {
    purpose: template.key,
    template,
    cardOrder: Array.isArray(rawProjection.cardOrder) && rawProjection.cardOrder.length
      ? rawProjection.cardOrder
      : template.cardDefinitions || [],
  };
}

export function getProjectionActionsForPurpose(purpose) {
  return [...(getProjectionTemplate(purpose).supportedActions || [])];
}
