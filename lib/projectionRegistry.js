export const PROJECTION_PURPOSES = {
  SHARE: "share",
  EVENT: "event",
  CUSTOM: "custom",
  FOR_SALE: "for_sale",
  IF_FOUND: "if_found",
  FOR_RENT: "for_rent",
};

export const PROJECTION_TEMPLATES = {
  share: {
    key: "share",
    label: "Share",
    operational: true,
    exposed: true,
    supportedAssetTypes: ["vehicle", "boat", "home", "other", "asset"],
    fields: ["story.enabled", "story.showHero", "story.showGallery", "story.showTimeline"],
    cardDefinitions: ["hero", "story_context", "timeline", "showcase", "actions"],
    defaultCardOrder: ["hero", "story_context", "timeline", "showcase", "actions"],
    supportedActions: ["request_info", "request_service", "submit_quote"],
    ctaLabels: { primary: "Open Story", askOwner: "Ask Owner" },
    privacyDefaults: {
      showOwnerName: false,
      showFinancials: false,
      showLocation: false,
    },
    contentDefaults: {
      includeShowcase: true,
      includeStoryHighlights: true,
      includeSystems: true,
      includeProofOfCare: true,
    },
    capabilityMaturity: "operational",
    legacyModes: ["inquiry", "current_story", "system_story"],
  },
  event: {
    key: "event",
    label: "Event",
    operational: true,
    exposed: true,
    supportedAssetTypes: ["vehicle", "boat", "other", "asset"],
    fields: [
      "event.eventName",
      "event.eventDate",
      "event.eventLocation",
      "event.hubName",
      "event.classOrCategory",
      "event.displayHeadline",
      "event.description",
      "event.featuredImage",
      "event.showOwnerName",
      "event.includeEventShowcase",
      "event.includeStoryHighlights",
      "event.includeVehicleHighlights",
      "event.includeProofOfCare",
      "event.allowAskOwner",
      "event.activeFrom",
      "event.activeUntil",
    ],
    cardDefinitions: ["event_showcase", "vehicle_highlights", "message_owner"],
    defaultCardOrder: ["event_showcase", "vehicle_highlights", "message_owner"],
    supportedActions: ["request_info"],
    ctaLabels: { primary: "Ask Owner", askOwner: "Ask Owner" },
    privacyDefaults: {
      showOwnerName: false,
      showFinancials: false,
      showLocation: true,
    },
    contentDefaults: {
      includeEventShowcase: true,
      includeStoryHighlights: true,
      includeSystems: true,
      includeProofOfCare: true,
    },
    capabilityMaturity: "operational",
    legacyModes: ["event"],
  },
  custom: {
    key: "custom",
    label: "Custom",
    operational: true,
    exposed: true,
    supportedAssetTypes: ["vehicle", "boat", "home", "other", "asset"],
    fields: ["cards", "actions", "privacy"],
    cardDefinitions: ["hero", "story_context", "showcase", "actions"],
    defaultCardOrder: ["hero", "story_context", "showcase", "actions"],
    supportedActions: ["request_info", "request_service", "submit_quote", "submit_proposal"],
    ctaLabels: { primary: "Open Story", askOwner: "Ask Owner" },
    privacyDefaults: {
      showOwnerName: false,
      showFinancials: false,
      showLocation: false,
    },
    contentDefaults: {
      includeShowcase: true,
      includeStoryHighlights: true,
      includeSystems: true,
      includeProofOfCare: true,
    },
    capabilityMaturity: "operational",
    legacyModes: ["custom"],
  },
  for_sale: {
    key: "for_sale",
    label: "For Sale",
    operational: false,
    exposed: false,
    supportedAssetTypes: ["vehicle", "boat", "home", "other", "asset"],
    fields: ["askingPrice", "externalUrl", "allowOffers"],
    cardDefinitions: ["sale_summary", "story_context", "actions"],
    defaultCardOrder: ["sale_summary", "story_context", "actions"],
    supportedActions: ["request_info", "submit_quote"],
    ctaLabels: { primary: "Request Info", askOwner: "Ask Seller" },
    privacyDefaults: { showFinancials: true },
    contentDefaults: {},
    capabilityMaturity: "modeled",
    legacyModes: ["for_sale"],
  },
  if_found: {
    key: "if_found",
    label: "If Found",
    operational: false,
    exposed: false,
    supportedAssetTypes: ["vehicle", "boat", "home", "other", "asset"],
    fields: ["returnInstructions", "contactPreference"],
    cardDefinitions: ["return_instructions"],
    defaultCardOrder: ["return_instructions"],
    supportedActions: ["request_info"],
    ctaLabels: { primary: "Contact Owner", askOwner: "Contact Owner" },
    privacyDefaults: { showOwnerName: false, showLocation: false },
    contentDefaults: {},
    capabilityMaturity: "modeled",
    legacyModes: ["if_found"],
  },
  for_rent: {
    key: "for_rent",
    label: "For Rent",
    operational: false,
    exposed: false,
    supportedAssetTypes: ["vehicle", "boat", "home", "other", "asset"],
    fields: ["rentalRate", "termsUrl", "paymentUrl"],
    cardDefinitions: ["rental_summary", "actions"],
    defaultCardOrder: ["rental_summary", "actions"],
    supportedActions: ["request_info", "request_service", "pay_rent"],
    ctaLabels: { primary: "Request Rental", askOwner: "Ask Owner" },
    privacyDefaults: { showFinancials: true },
    contentDefaults: {},
    capabilityMaturity: "hidden",
    legacyModes: ["for_rent"],
  },
};

export function getProjectionTemplate(key) {
  return PROJECTION_TEMPLATES[String(key || "").trim()] || PROJECTION_TEMPLATES.share;
}

export function getOperationalProjectionOptions() {
  return Object.values(PROJECTION_TEMPLATES).filter((template) => template.operational && template.exposed);
}

export function mapLegacyModeToProjectionPurpose(mode) {
  const clean = String(mode || "").trim();
  if (!clean) return "share";

  for (const template of Object.values(PROJECTION_TEMPLATES)) {
    if ((template.legacyModes || []).includes(clean)) return template.key;
  }

  return "share";
}

export function getDefaultEventProjectionConfig() {
  return {
    eventName: "",
    eventDate: "",
    eventLocation: "",
    hubName: "",
    hubId: null,
    classOrCategory: "",
    displayHeadline: "",
    description: "",
    featuredImage: "",
    showOwnerName: false,
    includeEventShowcase: true,
    includeStoryHighlights: true,
    includeVehicleHighlights: true,
    includeProofOfCare: true,
    allowAskOwner: true,
    activeFrom: "",
    activeUntil: "",
    selectedStoryHighlights: "",
    selectedVehicleHighlights: "",
    selectedSystemHighlights: "",
    selectedProofOfCare: "",
  };
}

export function normalizeProjectionConfig(publicConfig = {}) {
  const actionMode = publicConfig?.actions?.mode;
  const rawProjection = publicConfig?.projection && typeof publicConfig.projection === "object"
    ? publicConfig.projection
    : {};
  const purpose = rawProjection.purpose || mapLegacyModeToProjectionPurpose(actionMode);
  const template = getProjectionTemplate(purpose);

  return {
    purpose: template.key,
    template,
    event: {
      ...getDefaultEventProjectionConfig(),
      ...(rawProjection.event || {}),
    },
    cardOrder: Array.isArray(rawProjection.cardOrder) && rawProjection.cardOrder.length
      ? rawProjection.cardOrder
      : template.defaultCardOrder,
  };
}

export function getProjectionActionsForPurpose(purpose) {
  return [...(getProjectionTemplate(purpose).supportedActions || [])];
}

export function isFinancialControlAllowedForProjection(purpose) {
  return getProjectionTemplate(purpose).key !== "event";
}

export function splitConfiguredHighlights(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}
