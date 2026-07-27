import { supabase } from "./supabaseClient";
import { identifyUser, track } from "./analytics";

const contextByUserId = new Map();

export function normalizeAcquisitionContext(rowOrContext = {}) {
  if (!rowOrContext) return {};

  const acquisitionSourceSlug =
    rowOrContext.acquisition_source_slug ||
    rowOrContext.source_slug_snapshot ||
    rowOrContext.source_slug ||
    null;

  const acquisitionSourceId =
    rowOrContext.acquisition_source_id ||
    rowOrContext.activation_source_id ||
    null;

  const acquisitionSessionId =
    rowOrContext.acquisition_session_id ||
    rowOrContext.activation_session_id ||
    null;

  const acquisitionAttributionRecordId =
    rowOrContext.acquisition_attribution_record_id ||
    rowOrContext.attribution_record_id ||
    rowOrContext.id ||
    null;

  const acquisitionWorkflowIntent =
    rowOrContext.acquisition_workflow_intent ||
    rowOrContext.intended_action ||
    null;

  return {
    acquisition_source_slug: acquisitionSourceSlug,
    acquisition_source_id: acquisitionSourceId,
    acquisition_session_id: acquisitionSessionId,
    acquisition_attribution_record_id: acquisitionAttributionRecordId,
    acquisition_workflow_intent: acquisitionWorkflowIntent,
  };
}

export function hasAcquisitionContext(context = {}) {
  return !!(
    context.acquisition_source_slug ||
    context.acquisition_source_id ||
    context.acquisition_session_id ||
    context.acquisition_attribution_record_id
  );
}

export async function getDurableAcquisitionContext({ userId, refresh = false } = {}) {
  if (!userId) return {};
  if (!refresh && contextByUserId.has(userId)) {
    return contextByUserId.get(userId);
  }

  try {
    const { data, error } = await supabase
      .from("attribution_records")
      .select("id, activation_source_id, activation_session_id, source_slug_snapshot, intended_action")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    const context = normalizeAcquisitionContext(data);
    contextByUserId.set(userId, context);
    return context;
  } catch (e) {
    console.log("Acquisition context read failed", e?.message || e);
    return {};
  }
}

export async function identifyUserWithAcquisition(userId, properties = {}, options = {}) {
  if (!userId) return;

  const durableContext = await getDurableAcquisitionContext({
    userId,
    refresh: options.refresh,
  });

  await identifyUser(userId, {
    ...properties,
    ...durableContext,
  });
}

export async function trackWithAcquisition(event, properties = {}, { userId, refresh = false } = {}) {
  const durableContext = await getDurableAcquisitionContext({ userId, refresh });
  track(event, {
    ...properties,
    ...durableContext,
  });
}

export function rememberAcquisitionContext(userId, context) {
  if (!userId) return {};
  const normalized = normalizeAcquisitionContext(context);
  contextByUserId.set(userId, normalized);
  return normalized;
}
