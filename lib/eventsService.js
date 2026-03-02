// lib/eventsService.js
import { supabase } from "./supabaseClient";
import { addEventAttachment } from "./attachmentsEngine";

/**
 * Create an inbox event row.
 */
export async function createInboxEvent({
  ownerId,
  assetId,
  systemId,
  title,
  notes,
  amountCents,
  occurredAt,
}) {
  if (!ownerId) throw new Error("Missing ownerId");
  if (!title?.trim()) throw new Error("Title is required");

  const { data, error } = await supabase
    .from("event_inbox")
    .insert({
      owner_id: ownerId,
      title: title.trim(),
      notes: notes?.trim() || null,
      amount_cents: amountCents || null,
      occurred_at: occurredAt || null,
      asset_id: assetId || null,
      system_id: systemId || null,
      status: "draft",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[eventsService] createInboxEvent error", error);
    throw error;
  }

  return data;
}

/**
 * Attach any pending files/photos to the event.
 * `attachments` should be the list from your CreateEvent picker.
 */
export async function attachFilesToEvent({ ownerId, eventId, attachments }) {
  if (!eventId) throw new Error("Missing eventId");
  if (!ownerId) throw new Error("Missing ownerId");
  if (!attachments?.length) return;

  for (const a of attachments) {
    await addEventAttachment({
      ownerId,
      eventId,
      localUri: a.uri || a.localUri,
      webFile: a.webFile ?? null,
      mimeType: a.mimeType || "application/octet-stream",
      fileName: a.filename || a.name || null,
    });
  }
}
