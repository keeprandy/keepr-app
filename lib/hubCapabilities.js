export function getHubUserCapabilities({
  hub,
  user,
  currentMember,
  isInternal = false,
}) {
  const settings = hub?.settings || {};

  const hubType = String(hub?.hub_type || "community").toLowerCase();
  const primaryAssetType = String(
    settings.primary_asset_type || hub?.primary_asset_type || "asset"
  ).toLowerCase();

  const visibility = String(
    settings.visibility || hub?.visibility || "public"
  ).toLowerCase();

  const participation = String(
    settings.participation_model || hub?.participation_model || "moderated"
  ).toLowerCase();

  const role = String(currentMember?.role || "").toLowerCase();

  const isKeeprMember = !!user?.id;
  const isHubMember = !!currentMember?.id;
  const isHubAdmin = role === "admin" || role === "owner";
  const isHubOwner = role === "owner";

  const isPublicHub = visibility === "public";
  const isPrivateHub = visibility === "private";

  const ownerControlled = participation === "owner_controlled";
  const moderated = participation === "moderated";
  const inviteOnly = participation === "invite_only";
  const publicParticipation = participation === "public";

  const canViewHub =
    isPublicHub || isHubMember || isHubAdmin || isInternal;

  const canManageHub = isHubAdmin;
  const canManageMembers = isHubAdmin;
  const canApproveRequests = isHubAdmin;

  const canJoinHub =
    isPublicHub && isKeeprMember && !isHubMember && !ownerControlled;

  const canPromptSignIn =
    isPublicHub && !isKeeprMember && !ownerControlled;

  const canAddAssetDirect =
    isKeeprMember &&
    !ownerControlled &&
    (publicParticipation || isHubMember || isHubAdmin);

  const canRequestAddAsset =
    isKeeprMember &&
    !ownerControlled &&
    moderated &&
    !isHubAdmin;

  const eligibleOperationalHub = !["dealer", "builder", "oem", "portfolio"].includes(hubType);
  const canShowAddAssetCTA =
    isPublicHub &&
    eligibleOperationalHub &&
    (publicParticipation || moderated || inviteOnly);

  const hubText = [hub?.slug, hub?.name].filter(Boolean).join(" ").toLowerCase();
  const isRallySportRegion =
    hubText.includes("rally-sport") || hubText.includes("rally sport");

  const canOpenQuickActivation =
    isPublicHub &&
    primaryAssetType === "vehicle" &&
    ((hubType === "event" && publicParticipation) || isRallySportRegion);

  const addAssetAction =
    ownerControlled
      ? "hidden"
      : inviteOnly && !isHubMember
      ? "invite_required"
      : canOpenQuickActivation
      ? "add"
      : moderated
      ? "request"
      : "add";

  const assetNoun =
    primaryAssetType === "vehicle"
      ? "car"
      : primaryAssetType === "boat"
      ? "boat"
      : primaryAssetType === "home"
      ? "home"
      : "asset";

  const configuredAddAssetLabel =
    settings.cta_label ||
    settings.add_asset_cta_label ||
    settings.primary_asset_label ||
    hub?.cta_label ||
    null;

  const addAssetLabel =
    configuredAddAssetLabel ||
    (addAssetAction === "request"
      ? "Request to join"
      : addAssetAction === "invite_required"
      ? "Join with invite"
      : canOpenQuickActivation && assetNoun === "car"
      ? "Add your car"
      : "Add your asset");

  return {
    hubType,
    primaryAssetType,
    visibility,
    participation,
    role,

    isKeeprMember,
    isHubMember,
    isHubAdmin,
    isHubOwner,
    isPublicHub,
    isPrivateHub,

    canViewHub,
    canJoinHub,
    canPromptSignIn,
    canShowAddAssetCTA,
    canOpenQuickActivation,
    canAddAssetDirect,
    canRequestAddAsset,
    canManageHub,
    canManageMembers,
    canApproveRequests,

    addAssetAction,
    addAssetLabel,
  };
}
