function actionMetadata(action) {
  return action?.extra_metadata && typeof action.extra_metadata === "object"
    ? action.extra_metadata
    : {};
}

export function getPlaybookStepPosition(action) {
  const meta = actionMetadata(action);
  const raw = meta.playbook_step_position;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

export function getPlaybookId(action) {
  const meta = actionMetadata(action);
  return meta.playbook_id ? String(meta.playbook_id) : null;
}

export function getPlaybookName(action) {
  const meta = actionMetadata(action);
  return meta.playbook_name || meta.service_template_name || null;
}

export function isPlaybookAction(action) {
  const meta = actionMetadata(action);
  return Boolean(
    meta.playbook_id ||
      meta.playbook_step_id ||
      meta.source === "keeprspace_playbook"
  );
}

export function enrichPlaybookActions(actions) {
  const playbookGroups = new Map();

  (actions || []).forEach((action) => {
    const playbookId = getPlaybookId(action);
    if (!playbookId || String(action?.status || "").toLowerCase() === "completed") return;
    const position = getPlaybookStepPosition(action);
    if (!playbookGroups.has(playbookId)) {
      playbookGroups.set(playbookId, {
        minOpenPosition: Number.POSITIVE_INFINITY,
        maxKnownPosition: 0,
        count: 0,
      });
    }
    const group = playbookGroups.get(playbookId);
    group.count += 1;
    if (Number.isFinite(position)) {
      group.minOpenPosition = Math.min(group.minOpenPosition, position);
      group.maxKnownPosition = Math.max(group.maxKnownPosition, position);
    }
  });

  return (actions || []).map((action) => {
    const playbookId = getPlaybookId(action);
    const position = getPlaybookStepPosition(action);
    const group = playbookId ? playbookGroups.get(playbookId) : null;
    const totalSteps = group?.maxKnownPosition || group?.count || null;
    const finitePosition = Number.isFinite(position) ? position : null;
    const isCompleted = String(action?.status || "").toLowerCase() === "completed";

    return {
      ...action,
      playbook_context: {
        ...(action.playbook_context || {}),
        is_playbook_action: isPlaybookAction(action),
        is_next_playbook_step: Boolean(
          !isCompleted &&
            playbookId &&
            finitePosition &&
            finitePosition === group?.minOpenPosition
        ),
        playbook_id: playbookId,
        playbook_name: getPlaybookName(action),
        playbook_step_position: finitePosition,
        playbook_total_steps: totalSteps,
      },
    };
  });
}
