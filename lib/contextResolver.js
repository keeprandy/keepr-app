export function resolveContext({
  hub,
  asset,
  currentUserId,
  assetOwnerId,
  currentMember,
}) {
  const isAuthenticated = !!currentUserId;
  const isOwner =
    String(currentUserId || "") ===
    String(assetOwnerId || "");

  const role = currentMember?.role || null;

  const isHubMember = !!currentMember;
  const isHubAdmin =
    role === "owner" ||
    role === "admin";

  return {
    isAuthenticated,
    isOwner,
    isHubMember,
    isHubAdmin,

    viewerLabel:
      isOwner
        ? "Owner"
        : isHubAdmin
        ? "Hub Admin"
        : isHubMember
        ? "Hub Member"
        : isAuthenticated
        ? "Keepr Member"
        : "Visitor",
  };
}