import { supabase } from "./supabaseClient";

export async function createAction({
  type,
  title,
  body = null,
  priority = 50,
  createdByUserId = null,
  assignedToUserId = null,
  assignedToEmail = null,
  sourceTable = null,
  sourceId = null,
  payload = {},
  dueAt = null,
}) {
  const cleanEmail = assignedToEmail
  ? String(assignedToEmail).trim().toLowerCase()
  : null;

console.log("INSERTING ACTION", {
  type,
  title,
  assignedToUserId,
  assignedToEmail: cleanEmail,
  createdByUserId,
  sourceTable,
  sourceId,
});

const { data, error } = await supabase
  .from("actions")
    .insert({
      type,
      title,
      body,
      priority,
      created_by_user_id: createdByUserId,
      assigned_to_user_id: assignedToUserId,
      assigned_to_email: cleanEmail,
      source_table: sourceTable,
      source_id: sourceId,
      payload,
      due_at: dueAt,
      status: "open",
      claimable: true,
    })
    .select("*")
    .single();

  if (error) {
  console.error("ACTION INSERT ERROR", error);
  throw error;
}

console.log("ACTION INSERTED", data?.id);

return data;
}

export async function claimActionsForEmail({ userId, email }) {
  if (!userId || !email) return [];

  const cleanEmail = String(email).trim().toLowerCase();

  const { data, error } = await supabase
  
    .from("actions")
    .update({
      assigned_to_user_id: userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("assigned_to_email", cleanEmail)
    .is("assigned_to_user_id", null)
    .eq("claimable", true)
    .in("status", ["open", "pending"])
    .select("*");

  if (error) throw error;
  return data || [];
}

export async function getOpenActions(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("actions")
    .select("*")
    .eq("assigned_to_user_id", userId)
    .in("status", ["open", "pending"])
    .order("priority", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function completeAction(actionId) {
  const { data, error } = await supabase
    .from("actions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function dismissAction(actionId) {
  const { data, error } = await supabase
    .from("actions")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getAction(actionId) {
  if (!actionId) throw new Error("Missing action id.");

  const { data, error } = await supabase
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .single();

  if (error) throw error;
  return data;
}

export function getActionContext(action) {
  if (!action) return null;

  const payload = action.payload || {};

  switch (action.type) {
    case "hub_invite":
      return {
        mode: "reception",
        reason: "hub_invite",
        title: `Welcome to ${payload.hub_name || "this KeeprHub"}`,
        body:
          payload.personal_note ||
          "You were invited to join this Hub. Accept the invite, then add your first Keepr Story.",
        completedAction: "Hub invitation accepted",
        primaryAction: {
          label: "Add your first Story",
          route: "AddAssetChat",
          params: {
            source: "hub_invite",
            hubId: payload.hub_id || null,
            hubSlug: payload.hub_slug || null,
            hubMemberId: payload.hub_member_id || null,
          },
        },
        secondaryActions: [
          {
            label: "Browse Hub",
            route: "KeeprHub",
            params: {
              slug: payload.hub_slug || null,
            },
          },
          {
            label: "View Actions",
            route: "Notifications",
            params: {},
          },
        ],
        context: payload,
      };

    case "add_asset_to_hub":
      return {
        mode: "reception",
        reason: "add_asset_to_hub",
        title: `Add your first Story to ${payload.hub_name || "this Hub"}`,
        body: "Choose an asset and make it visible to the Hub so you can participate.",
        completedAction: null,
        primaryAction: {
          label: "Add Asset Story",
          route: "AddAssetChat",
          params: {
            source: "add_asset_to_hub",
            hubId: payload.hub_id || null,
            hubSlug: payload.hub_slug || null,
            hubMemberId: payload.hub_member_id || null,
          },
        },
        secondaryActions: [
          {
            label: "Browse Hub",
            route: "KeeprHub",
            params: {
              slug: payload.hub_slug || null,
            },
          },
        ],
        context: payload,
      };

    default:
      return {
        mode: "actions",
        reason: action.type,
        title: action.title || "Keepr Action",
        body: action.body || "This action needs your attention.",
        completedAction: null,
        primaryAction: null,
        secondaryActions: [],
        context: payload,
      };
  }
}

export async function createFollowUpActions(action) {
  if (!action) return [];

  const payload = action.payload || {};

  switch (action.type) {
    case "hub_invite": {
      if (!action.assigned_to_user_id) return [];

      const followUp = await createAction({
        type: "add_asset_to_hub",
        title: `Add your first Keepr Story to ${payload.hub_name || "this Hub"}`,
        body: "Join the community by adding an asset story and making it visible to the Hub.",
        priority: 15,
        createdByUserId: action.created_by_user_id || null,
        assignedToUserId: action.assigned_to_user_id,
        assignedToEmail: action.assigned_to_email || null,
        sourceTable: "hub_members",
        sourceId: payload.hub_member_id || action.source_id || null,
        payload: {
          hub_id: payload.hub_id || null,
          hub_slug: payload.hub_slug || null,
          hub_name: payload.hub_name || null,
          hub_member_id: payload.hub_member_id || action.source_id || null,
          source_action_id: action.id,
        },
      });

      return [followUp];
    }

    default:
      return [];
  }
}

export async function executeAction(actionId) {
  const action = await getAction(actionId);

  const completedAction = await completeAction(actionId);

  const followUpActions = await createFollowUpActions(completedAction);

  const reception = getActionContext({
    ...completedAction,
    payload: {
      ...(completedAction.payload || {}),
      follow_up_actions: followUpActions,
    },
  });

  return {
    action: completedAction,
    followUpActions,
    reception,
  };
}

export async function getSuggestedActions(userId) {
  const actions = await getOpenActions(userId);

  return actions.map((action) => ({
    ...action,
    kaiContext: getActionContext(action),
  }));
}