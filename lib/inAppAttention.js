export const KEEPR_ATTENTION_EVENTS = {
  MESSAGE_RECEIVED: "message_received",
  ACTION_ASSIGNED: "action_assigned",
  ATTACHMENT_RECEIVED: "attachment_received",
  PROVIDER_UPDATE: "provider_update",
  GOVERNANCE_ALERT: "governance_alert",
};

export function buildKeeprAttentionEvent({
  type = KEEPR_ATTENTION_EVENTS.MESSAGE_RECEIVED,
  thread,
  message,
  senderLabel,
} = {}) {
  const systemName = thread?.system?.name || null;
  const assetName = thread?.asset?.name || "this asset";
  const context = systemName || assetName;
  const sender =
    senderLabel ||
    message?.sender_name ||
    (message?.sender_type === "public_visitor" ? "Public visitor" : "Someone");

  return {
    type,
    title: `New message about ${context}`,
    body: `${sender} sent an update.`,
    threadId: thread?.id || message?.thread_id || null,
    assetId: thread?.asset_id || null,
    systemId: thread?.system_id || null,
  };
}

export function shouldShowMessageAttention({ message, currentUserId, selectedThreadId } = {}) {
  if (!message?.thread_id) return false;
  if (selectedThreadId && String(message.thread_id) === String(selectedThreadId)) return false;
  if (message.from_user_id && String(message.from_user_id) === String(currentUserId)) return false;
  return true;
}
