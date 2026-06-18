export function getHubUserCapabilities({
  hub,
  user,
  currentMember,
  isInternal = false,
}) {
  const settings = hub?.settings || {};

  const hubType = String(hub?.hub_type || "community").toLowerCase();

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

  const canShowAddAssetCTA =
    isPublicHub &&
    !ownerControlled &&
    !["dealer", "builder", "oem"].includes(hubType);

  const addAssetAction =
    ownerControlled
      ? "hidden"
      : inviteOnly && !isHubMember
      ? "invite_required"
      : moderated
      ? "request"
      : "add";

  return {
    hubType,
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
    canAddAssetDirect,
    canRequestAddAsset,
    canManageHub,
    canManageMembers,
    canApproveRequests,

    addAssetAction,
  };
}