import { getActionScheduledDueAt } from "./playbookSchedule";
import {
  enrichPlaybookActions,
  getPlaybookStepPosition,
} from "./playbookActionContext";

export const WHAT_NEXT_MAX_VISIBLE_ACTIONS = 5;

export function isWhatNextActionOverdue(action, now = new Date()) {
  const dueAt = getActionScheduledDueAt(action);
  return Boolean(action?.status === "open" && dueAt && new Date(dueAt) < now);
}

function getDueSortValue(action) {
  const dueAt = getActionScheduledDueAt(action);
  if (!dueAt) return Number.POSITIVE_INFINITY;
  const time = new Date(dueAt).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function sortWhatNextActions(actions, now = new Date()) {
  return [...(actions || [])].sort((a, b) => {
    const aOverdue = isWhatNextActionOverdue(a, now);
    const bOverdue = isWhatNextActionOverdue(b, now);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    const aNextPlaybook = Boolean(a?.playbook_context?.is_next_playbook_step);
    const bNextPlaybook = Boolean(b?.playbook_context?.is_next_playbook_step);
    if (aNextPlaybook !== bNextPlaybook) return aNextPlaybook ? -1 : 1;

    const aDue = getDueSortValue(a);
    const bDue = getDueSortValue(b);
    if (aDue !== bDue) return aDue - bDue;

    const aPlaybookId = a?.playbook_context?.playbook_id;
    const bPlaybookId = b?.playbook_context?.playbook_id;
    if (aPlaybookId && aPlaybookId === bPlaybookId) {
      const aPosition = getPlaybookStepPosition(a);
      const bPosition = getPlaybookStepPosition(b);
      if (aPosition !== bPosition) return aPosition - bPosition;
    }

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
  const sorted = sortWhatNextActions(enrichPlaybookActions(scoped), now).map((action) => ({
    ...action,
    what_next: {
      ...(action.what_next || {}),
      ...(action.playbook_context || {}),
    },
  }));
  const visibleActions = sorted.slice(0, maxVisible);

  return {
    actions: sorted,
    visibleActions,
    hiddenCount: Math.max(sorted.length - visibleActions.length, 0),
  };
}
