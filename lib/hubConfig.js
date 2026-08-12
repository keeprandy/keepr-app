export const HUB_PARTICIPATION_PRESETS = {
  membership_club: {
    key: "membership_club",
    participation_model: "moderated",
    submission_status: "pending",
    default_cta_label: "Add Your Car",
    primary_asset_type: "vehicle",
    can_quick_activate: false,
  },
  open_event: {
    key: "open_event",
    participation_model: "public",
    submission_status: "approved",
    default_cta_label: "Add Your Car",
    primary_asset_type: "vehicle",
    can_quick_activate: true,
  },
};

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

function labelClean(value) {
  const text = clean(value);
  return text ? text.replace(/\s+/g, " ") : null;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function hubText(hub) {
  return [hub?.slug, hub?.name].filter(Boolean).join(" ").toLowerCase();
}

export function getHubPresetKey(hub) {
  const settings = hub?.settings || {};
  const configured =
    settings.participation_preset ||
    settings.hub_preset ||
    settings.preset ||
    hub?.participation_preset ||
    hub?.hub_preset;
  const key = normalized(configured);

  if (HUB_PARTICIPATION_PRESETS[key]) return key;

  const text = hubText(hub);
  if (text.includes("rally-sport") || text.includes("rally sport")) {
    return "membership_club";
  }
  if (text.includes("depot-town-cruise") || text.includes("depot town cruise")) {
    return "open_event";
  }

  const hubType = normalized(hub?.hub_type);
  const participation = normalized(
    settings.participation_model || hub?.participation_model
  );

  if (hubType === "event" && participation === "public") return "open_event";
  if (participation === "moderated") return "membership_club";

  return null;
}

export function getHubParticipationConfig(hub) {
  const settings = hub?.settings || {};
  const presetKey = getHubPresetKey(hub);
  const preset = HUB_PARTICIPATION_PRESETS[presetKey] || {};
  const participation = normalized(
    settings.participation_model ||
      hub?.participation_model ||
      preset.participation_model ||
      "moderated"
  );
  const primaryAssetType = normalized(
    settings.primary_asset_type ||
      hub?.primary_asset_type ||
      preset.primary_asset_type ||
      "asset"
  );
  const eligibleMake =
    labelClean(settings.eligible_make) ||
    labelClean(settings.asset_make) ||
    labelClean(settings.make) ||
    labelClean(hub?.eligible_make);
  const eligibleModel =
    labelClean(settings.eligible_model) ||
    labelClean(settings.asset_model) ||
    labelClean(settings.model) ||
    labelClean(hub?.eligible_model);
  const eligibleYear =
    labelClean(settings.eligible_year) ||
    labelClean(settings.asset_year) ||
    labelClean(settings.year) ||
    labelClean(hub?.eligible_year);
  const configuredAssetLabel =
    labelClean(settings.asset_label) ||
    [eligibleYear, eligibleMake, eligibleModel].filter(Boolean).join(" ") ||
    (eligibleMake ? eligibleMake : null);
  const ctaLabel =
    clean(settings.cta_label) ||
    clean(settings.add_asset_cta_label) ||
    clean(settings.primary_asset_label) ||
    clean(hub?.cta_label) ||
    (configuredAssetLabel ? `Add Your ${configuredAssetLabel}` : null) ||
    preset.default_cta_label ||
    (primaryAssetType === "vehicle" ? "Add Your Car" : "Add Your Asset");
  const submissionStatus =
    clean(settings.submission_status) ||
    clean(hub?.submission_status) ||
    preset.submission_status ||
    (participation === "public" ? "approved" : "pending");

  return {
    presetKey,
    participation,
    primaryAssetType,
    eligibleMake,
    eligibleModel,
    eligibleYear,
    assetLabel:
      configuredAssetLabel ||
      (primaryAssetType === "vehicle" ? "Car" : "Asset"),
    ctaLabel,
    submissionStatus,
    canQuickActivate:
      settings.can_quick_activate === true ||
      preset.can_quick_activate === true,
    eventIdentity:
      clean(settings.event_identity) ||
      clean(settings.event_name) ||
      clean(hub?.event_identity) ||
      clean(hub?.name),
    eventDate:
      clean(settings.event_date) ||
      clean(settings.starts_at) ||
      clean(hub?.event_date) ||
      clean(hub?.starts_at),
  };
}

export function assetMatchesHubParticipation(asset, hub) {
  const config = getHubParticipationConfig(hub);
  const assetType = normalized(asset?.type);

  if (config.primaryAssetType && config.primaryAssetType !== "asset") {
    if (assetType !== config.primaryAssetType) return false;
  }

  if (
    config.eligibleMake &&
    normalizedText(asset?.make) !== normalizedText(config.eligibleMake)
  ) {
    return false;
  }

  if (
    config.eligibleModel &&
    normalizedText(asset?.model) !== normalizedText(config.eligibleModel)
  ) {
    return false;
  }

  if (
    config.eligibleYear &&
    String(asset?.year || "").trim() !== String(config.eligibleYear).trim()
  ) {
    return false;
  }

  return true;
}

export function buildHubParticipationMetadata(hub) {
  const config = getHubParticipationConfig(hub);

  return {
    participation_preset: config.presetKey,
    participation_model: config.participation,
    submitted_at: new Date().toISOString(),
    event_identity: config.eventIdentity,
    event_date: config.eventDate,
  };
}
