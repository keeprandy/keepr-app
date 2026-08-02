export const WHAT_NEXT_MAX_VISIBLE_ACTIONS = 5;

export function isWhatNextActionOverdue(action, now = new Date()) {
  return Boolean(action?.status === "open" && action?.due_at && new Date(action.due_at) < now);
}

function getDueSortValue(action) {
  if (!action?.due_at) return Number.POSITIVE_INFINITY;
  const time = new Date(action.due_at).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function sortWhatNextActions(actions, now = new Date()) {
  return [...(actions || [])].sort((a, b) => {
    const aOverdue = isWhatNextActionOverdue(a, now);
    const bOverdue = isWhatNextActionOverdue(b, now);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    const aDue = getDueSortValue(a);
    const bDue = getDueSortValue(b);
    if (aDue !== bDue) return aDue - bDue;

    return new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
  });
}

export function projectWhatNextActions(actions, assetId, options = {}) {
  if (!assetId) return { actions: [], visibleActions: [], hiddenCount: 0 };

  const maxVisible = options.maxVisible ?? WHAT_NEXT_MAX_VISIBLE_ACTIONS;
  const now = options.now || new Date();
  const scoped = (actions || []).filter(
    (action) =>
      String(action?.status || "").toLowerCase() !== "completed" &&
      String(action?.asset_id || "") === String(assetId)
  );
  const sorted = sortWhatNextActions(scoped, now);
  const visibleActions = sorted.slice(0, maxVisible);

  return {
    actions: sorted,
    visibleActions,
    hiddenCount: Math.max(sorted.length - visibleActions.length, 0),
  };
}
