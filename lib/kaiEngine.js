export function getKaiTriggerContext({
  routeName,
  params = {},
  query = {},
  userId,
  hub,
  inviteRecord,
  currentMember,
  hasAssets = false,
  hasHubStories = false,
}) {
  const src = query?.src || params?.src;
  const inviteToken = query?.invite || params?.invite || params?.inviteToken;

  if (src === "hub_invite" || inviteToken) {
    return getHubInviteKaiContext({
      userId,
      hub,
      inviteToken,
      inviteRecord,
      currentMember,
      hasAssets,
      hasHubStories,
    });
  }

  return null;
}

export function getHubInviteKaiContext({
  userId,
  hub,
  inviteToken,
  inviteRecord,
  currentMember,
  hasAssets = false,
  hasHubStories = false,
}) {
  const hubName = hub?.name || "this Keepr Hub";

  if (!userId) {
    return {
      trigger: "hub_invite",
      journey: "hub_activation",
      gate: "auth",
      mode: "signin_required",
      title: `Welcome to ${hubName}`,
      body: "Sign in or create an account to accept your invitation and add your Story.",
      primaryLabel: "Continue with Keepr",
      secondaryLabel: "Explore Member Stories",
    };
  }

  if (currentMember || inviteRecord?.status === "active") {
    if (hasHubStories) {
      return {
        trigger: "hub_invite",
        journey: "hub_activation",
        gate: "complete",
        mode: "complete",
        title: `You're active in ${hubName}`,
        body: "You're a member and your Story is part of this Hub.",
        primaryLabel: "Explore Hub",
        secondaryLabel: "Add Another Story",
      };
    }

    return {
      trigger: "hub_invite",
      journey: "hub_activation",
      gate: "story_optional",
      mode: "member_no_story",
      title: `You're in ${hubName}`,
      body: "You're now a member. You can explore the Hub now, or add your Story when you're ready.",
      primaryLabel: "Explore Hub",
      secondaryLabel: "Add Your Story",
    };
  }

  if (inviteToken && inviteRecord?.status !== "active") {
    return {
      trigger: "hub_invite",
      journey: "hub_activation",
      gate: "membership",
      mode: "accept_invite",
      title: `You're invited to ${hubName}`,
      body: "Accept your invitation to join this Hub. You can add your Story later when you're ready.",
      primaryLabel: "Accept Invite",
      secondaryLabel: "Explore Member Stories",
    };
  }

  if (!hasAssets) {
    return {
      trigger: "hub_invite",
      journey: "hub_activation",
      gate: "asset",
      mode: "create_asset",
      title: `Add your first Story to ${hubName}`,
      body: "Create an asset, build its public Story, and share it with this Hub.",
      primaryLabel: "Create Asset Story",
      secondaryLabel: "Explore Member Stories",
    };
  }

  return {
    trigger: "hub_invite",
    journey: "hub_activation",
    gate: "story",
    mode: "add_story",
    title: `Add your Story to ${hubName}`,
    body: "Choose an existing public Story or create a new one for this Hub.",
    primaryLabel: "Add Your Story",
    secondaryLabel: "Explore Member Stories",
  };
}