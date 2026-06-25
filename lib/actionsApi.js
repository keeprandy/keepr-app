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