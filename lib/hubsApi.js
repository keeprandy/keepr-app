// lib/hubsApi.js
import { supabase } from "./supabaseClient";

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
    .eq("status", "active")
    .order("created_at");

  if (memberError) throw memberError;

  return memberRows || [];
}

export async function inviteHubMember({
  hubId,
  email,
  role = "member",
  invitedBy,
}) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!hubId) throw new Error("Missing hub id.");
  if (!cleanEmail) throw new Error("Email is required.");

  const { data: targetUserId, error: lookupError } = await supabase.rpc(
    "find_user_id_by_email",
    { p_email: cleanEmail }
  );

  if (lookupError) throw lookupError;

  console.log("INVITE USER LOOKUP", {
    cleanEmail,
    targetUserId,
  });

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
    })
    .select("*")
    .single();

  if (error) throw error;

if (targetUserId) {
  const { error: inboxError } = await supabase
    .from("inbox_items")
    .insert({
      to_user_id: targetUserId,
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
      },
    });

  if (inboxError) {
    console.error("Hub invite inbox error", inboxError);
    throw inboxError;
  }
} else {
  console.log("No Keepr user found for invite email", cleanEmail);
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