// lib/hubsApi.js
import { supabase } from "./supabaseClient";
import { createAction } from "./actionsApi";

export async function fetchMyHubs(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("hub_members")
    .select(`
      role,
      hub:hubs (
        id,
        name,
        slug,
        description,
        hero_image_url,
        visibility,
        created_at
      )
    `)
    .eq("user_id", userId);

  if (error) throw error;

  return (data || []).map((row) => ({
    ...row.hub,
    role: row.role,
  }));
}

export async function fetchPublicHubBySlug(slug) {
  const { data, error } = await supabase
    .from("hubs")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchHubStoryLinks(hubId) {
  if (!hubId) return [];

  const { data, error } = await supabase.rpc(
    "get_hub_stories_for_view",
    { p_hub_id: hubId }
  );

  if (error) throw error;

  return (data || []).map((row) => ({
    ...row,
    asset: row.asset || null,
    ownerProfile: row.owner_profile || null,
  }));
}

export async function createHub({
  name,
  slug,
  description,
  createdBy,
  hubType = "community",
  visibility = "public",
}) {
  const insertPayload = {
    name,
    slug,
    description,
    created_by: createdBy,
    hub_type: hubType,
    visibility,
  };

  console.log("CREATE HUB INSERT PAYLOAD", insertPayload);

  const { data, error } = await supabase
    .from("hubs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.log("CREATE HUB INSERT ERROR", error);
    throw error;
  }

  const memberPayload = {
    hub_id: data.id,
    user_id: createdBy,
    role: "owner",
    status: "active",
  };

  console.log("CREATE HUB MEMBER PAYLOAD", memberPayload);

  const { error: memberError } = await supabase
    .from("hub_members")
    .insert(memberPayload);

  if (memberError) {
    console.log("CREATE HUB MEMBER ERROR", memberError);
    throw memberError;
  }

  return data;
}

export async function addStoryToHub({ hubId, assetId, userId }) {
  const { data, error } = await supabase
    .from("hub_story_links")
    .insert({
      hub_id: hubId,
      asset_id: assetId,
      created_by: userId,
      status: "approved",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPublicHubs() {
  const { data, error } = await supabase
    .from("hubs")
    .select("id, name, slug, description, visibility")
    .eq("visibility", "public")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}
export async function fetchAssetHubLinks(assetId) {
  if (!assetId) return [];

  const { data, error } = await supabase
    .from("hub_story_links")
    .select(`
      id,
      featured,
      status,
      created_at,
      hub:hubs (
        id,
        name,
        slug
      )
    `)
    .eq("asset_id", assetId)
    .eq("status", "approved");

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    featured: row.featured,
    status: row.status,
    created_at: row.created_at,
    ...row.hub,
  }));
}
export async function fetchHub(hubId) {
  const { data, error } = await supabase
    .from("hubs")
    .select("*")
    .eq("id", hubId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchHubMembers(hubId) {
  const { data: memberRows, error: memberError } = await supabase
    .from("hub_members")
    .select(`
      id,
      role,
      user_id,
      email,
      display_name,
      avatar_url,
      status,
      invited_by,
      invited_at,
      accepted_at,
      created_at
    `)
    .eq("hub_id", hubId)
    .order("created_at", { ascending: false })

  if (memberError) throw memberError;

  return memberRows || [];
}

export async function inviteHubMember({
  hubId,
  email,
  role = "member",
  invitedBy,
  sendEmail = false,
}) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!hubId) throw new Error("Missing hub id.");
  if (!cleanEmail) throw new Error("Email is required.");

  const { data: targetUserId, error: lookupError } = await supabase.rpc(
    "find_user_id_by_email",
    { p_email: cleanEmail }
  );

  if (lookupError) throw lookupError;

  const inviteToken =
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  console.log("INVITE USER LOOKUP", {
    cleanEmail,
    targetUserId,
  });

let existingQuery = supabase
  .from("hub_members")
  .select("id, role, status, user_id, email")
  .eq("hub_id", hubId);

if (targetUserId) {
  existingQuery = existingQuery.or(
    `user_id.eq.${targetUserId},email.eq.${cleanEmail}`
  );
} else {
  existingQuery = existingQuery.eq("email", cleanEmail);
}

const { data: existingMembership, error: existingError } =
  await existingQuery.maybeSingle();

if (existingError) throw existingError;

if (existingMembership) {
  const status = existingMembership.status || "active";
  const roleLabel = existingMembership.role || "member";

  if (status === "invited") {
    throw new Error(`This email already has a pending invite as ${roleLabel}.`);
  }

  throw new Error(`This person is already a ${roleLabel} of this Hub.`);
}

console.log("CREATING HUB INVITE INBOX", {
  to_user_id: targetUserId,
  to_email: cleanEmail,
});

const { data: hubRecord } = await supabase
  .from("hubs")
  .select("id, name, slug, description")
  .eq("id", hubId)
  .maybeSingle();

  const { data, error } = await supabase
    .from("hub_members")
    .insert({
      hub_id: hubId,
      user_id: targetUserId,
      email: cleanEmail,
      role,
      status: "invited",
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),

      invite_token: inviteToken,
    })
    .select("*")
    .single();

  if (error) throw error;

  const inviteUrl =
  hubRecord?.slug
    ? `https://app.keeprhome.com/h/${hubRecord.slug}?src=hub_invite&hub=${hubRecord.slug}&invite=${inviteToken}`
    : null;

const { error: inboxError } = await supabase
  .from("inbox_items")
  .insert({
    to_user_id: targetUserId || null,
    to_email: cleanEmail,
    from_user_id: invitedBy,
    type: "hub_invite",
    status: "pending",
    payload: {
      hub_id: hubId,
      hub_member_id: data.id,
      hub_name: hubRecord?.name || "KeeprHub",
      hub_slug: hubRecord?.slug || null,
      hub_description: hubRecord?.description || null,
      role,
      email: cleanEmail,
      invite_token: inviteToken,
      invite_url: inviteUrl,
    },
  });

if (inboxError) {
  console.error("Hub invite inbox error", inboxError);
  throw inboxError;
}

try {
  await createAction({
    type: "hub_invite",
    title: `You were invited to ${hubRecord?.name || "a Keepr Hub"}`,
    body: "Accept the invitation and add your Keepr Story.",
    priority: 10,
    createdByUserId: invitedBy || null,
    assignedToUserId: targetUserId || null,
    assignedToEmail: cleanEmail,
    sourceTable: "hub_members",
    sourceId: data.id,
    payload: {
      hub_id: hubId,
      hub_slug: hubRecord?.slug || null,
      hub_name: hubRecord?.name || null,
      hub_description: hubRecord?.description || null,
      hub_member_id: data.id,
      invite_token: inviteToken,
      invite_url: inviteUrl,
      role,
      email: cleanEmail,
    },
  });
} catch (actionError) {
  console.error("Hub invite action failed", actionError);
}

try {
  await createNotification({
    userId: targetUserId,
    type: "hub_invite",
    title: `You were invited to ${hubRecord?.name || "a Keepr Hub"}`,
    body: "Accept the invitation and add your Keepr Story.",
    payload: {
      hub_id: hubId,
      hub_slug: hubRecord?.slug || null,
      hub_name: hubRecord?.name || null,
      invite_token: inviteToken,
      hub_member_id: data.id,
      invite_url: inviteUrl,
      role,
    },
  });
} 
catch (notificationError) {
  console.error(
    "Hub invite notification failed",
    JSON.stringify(notificationError, null, 2)
  );
}

console.log("HUB INVITE EMAIL CHECK", {
  sendEmail,
  cleanEmail,
  inviteUrl,
  hubName: hubRecord?.name,
});

if (sendEmail) {
  try {
    console.log("CALLING send-hub-invite FUNCTION", {
      to: cleanEmail,
      inviteUrl,
    });

    const { data: functionData, error: emailError } =
      await supabase.functions.invoke("send-hub-invite", {
        body: {
          to: cleanEmail,
          hubName: hubRecord?.name || "Keepr Hub",
          hubSlug: hubRecord?.slug || null,
          inviteUrl,
          role,
          invitedBy,
          hubMemberId: data.id,
          inviteToken,
        },
      });

    console.log("send-hub-invite RESULT", {
      functionData,
      emailError,
    });

    if (emailError) {
      console.error("Hub invite email error", emailError);
    }
  } catch (emailSendError) {
    console.error("Hub invite email failed", emailSendError);
  }
}
  return data;
}

export async function removeHubMember(memberId) {
  const { error } = await supabase
    .from("hub_members")
    .delete()
    .eq("id", memberId);

  if (error) throw error;

  return true;
}

export async function updateHub(hubId, updates) {
  const { data, error } = await supabase
    .from("hubs")
    .update(updates)
    .eq("id", hubId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
export async function updateHubStoryLink(linkId, updates) {
  const { data, error } = await supabase
    .from("hub_story_links")
    .update(updates)
    .eq("id", linkId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function removeStoryFromHub(linkId) {
  const { error } = await supabase
    .from("hub_story_links")
    .delete()
    .eq("id", linkId);

  if (error) throw error;
  return true;
}
export async function fetchHubInviteByToken(inviteToken) {
  if (!inviteToken) return null;

  const { data, error } = await supabase
    .from("hub_members")
    .select("id, hub_id, email, role, status, invite_token")
    .eq("invite_token", inviteToken)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function acceptHubInvite({ inviteToken, userId }) {
  if (!inviteToken) throw new Error("Missing invite token.");
  if (!userId) throw new Error("You must be signed in to accept this invite.");

  const { data, error } = await supabase
    .from("hub_members")
    .update({
      user_id: userId,
      status: "active",
      accepted_at: new Date().toISOString(),
    })
    .eq("invite_token", inviteToken)
    .eq("status", "invited")
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
export async function acceptHubInviteByToken({ inviteToken, userId }) {
  if (!inviteToken) throw new Error("Missing invite token.");
  if (!userId) throw new Error("You must be signed in.");

  const { error } = await supabase
    .from("hub_members")
    .update({
      user_id: userId,
      status: "active",
      accepted_at: new Date().toISOString(),
    })
    .eq("invite_token", inviteToken)
    .eq("status", "invited");

  if (error) throw error;

  return true;
}

export async function createNotification({
  userId,
  type,
  title,
  body = null,
  payload = {},
}) {
  if (!userId) return null;
  if (!type || !title) throw new Error("Missing notification type or title.");

const { error } = await supabase
  .from("notifications")
  .insert({
    user_id: userId,
    type,
    title,
    body,
    payload,
  });

if (error) throw error;
return true;
}

export async function claimPendingActionsForEmail({ userId, email }) {
  if (!userId || !email) return null;

  const cleanEmail = String(email).trim().toLowerCase();

  // Claim pending hub member invites
  const { error: hubError } = await supabase
    .from("hub_members")
    .update({
      user_id: userId,
    })
    .eq("email", cleanEmail)
    .eq("status", "invited")
    .is("user_id", null);

  if (hubError) throw hubError;

  // Claim pending inbox items
  const { error: inboxError } = await supabase
    .from("inbox_items")
    .update({
      to_user_id: userId,
    })
    .eq("to_email", cleanEmail)
    .eq("status", "pending")
    .is("to_user_id", null);

  if (inboxError) throw inboxError;

    // Claim pending KAI actions
  const { error: actionsError } = await supabase
    .from("actions")
    .update({
      assigned_to_user_id: userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("assigned_to_email", cleanEmail)
    .is("assigned_to_user_id", null)
    .eq("claimable", true)
    .in("status", ["open", "pending"]);

  if (actionsError) throw actionsError;

  return true;
}
