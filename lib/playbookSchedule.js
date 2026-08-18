function getActionMetadata(action) {
  const candidates = [
    action?.extra_metadata,
    action?.metadata,
    action?.reminder?.extra_metadata,
    action?.reminder?.metadata,
  ];
  return candidates.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

export function isPlaybookDueDatePending(action) {
  const meta = getActionMetadata(action);
  return meta.playbook_due_date_pending === true || meta.playbook_due_date_pending === "true";
}

export function getActionEstimatedDueAt(action) {
  if (!isPlaybookDueDatePending(action)) return null;
  const meta = getActionMetadata(action);
  return meta.playbook_estimated_date || meta.estimated_due_at || null;
}

export function getActionScheduleLabel(action, formatter) {
  if (isPlaybookDueDatePending(action)) {
    const estimatedDueAt = getActionEstimatedDueAt(action);
    if (estimatedDueAt) {
      const label =
        typeof formatter === "function" ? formatter(estimatedDueAt) : String(estimatedDueAt);
      return `Estimated ${label}`;
    }
    return "No estimated date";
  }
  if (!action?.due_at) return "Unscheduled";
  return typeof formatter === "function" ? formatter(action.due_at) : String(action.due_at);
}

export function getActionScheduledDueAt(action) {
  return isPlaybookDueDatePending(action) ? null : action?.due_at || null;
}
