import type { EventRole, ManifestAssociation, ParticipantRole, WorkMode } from "./kacManifestTypes.ts";
import type { CollectorResult, ResolvedAssetContext } from "./kacManifestCollectorUtils.ts";
import { addNotVisibleDiagnostic, compactMetadata, diagnostic, finalizeCollectorResult, runQuery } from "./kacManifestCollectorUtils.ts";

interface ServiceRecordRow {
  id: string;
  asset_id: string;
  title: string | null;
  service_type: string | null;
  category: string | null;
  performed_at: string;
  odometer: number | null;
  system_id: string | null;
  keepr_pro_id: string | null;
  source_type: string | null;
  verification_status: string | null;
  record_scope: string | null;
  notes?: string | null;
  location?: string | null;
  cost?: number | null;
  price?: number | null;
  extra_metadata?: Record<string, unknown> | null;
  created_at: string | null;
}

interface StoryEventRow {
  id: string;
  asset_id: string;
  event_type: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string | null;
  source_type: string | null;
  service_record_id: string | null;
  system_id: string | null;
  created_at: string | null;
}

interface TimelineRecordRow {
  id: string;
  asset_id: string;
  occurred_on: string;
  type: string;
  title: string;
  source_type: string | null;
  source_ref_id: string | null;
  attachment_id: string | null;
  confidence: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface MaintenanceEventRow {
  id: string;
  asset_id: string;
  title: string;
  service_date: string;
  odometer_hours: number | null;
  provider: string | null;
  created_at: string | null;
}

interface ServiceEntryRow {
  id: string;
  asset_id: string;
  system_id: string | null;
  performed_by_role: string;
  ksc_code: string | null;
  created_at: string | null;
}

function storyServiceRecordId(row: StoryEventRow) {
  return row.service_record_id || String(row.metadata?.service_record_id || row.metadata?.serviceRecordId || "");
}

function sourceAuthority(sourceType: string | null) {
  if (sourceType === "manual") return "owner_reported" as const;
  if (sourceType === "import" || sourceType === "carfax") return "partner" as const;
  if (sourceType === "document" || sourceType === "photo") return "owner_reported" as const;
  return "unknown" as const;
}

function workMode(row: ServiceRecordRow): WorkMode {
  if (row.keepr_pro_id) return "pro";
  return "unknown";
}

function participantRoles(row: ServiceRecordRow): ParticipantRole[] {
  return row.keepr_pro_id ? ["keepr_pro"] : [];
}

const FORBIDDEN_METADATA_KEYS = new Set([
  "extracted_text",
  "signed_url",
  "signedUrl",
  "storage_path",
  "email",
  "phone",
  "address",
  "dealer_phone",
  "dealer_address",
  "access_token",
  "refresh_token",
  "secret",
  "service_role",
]);

function safeObject(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    if (/url$/i.test(key) || /phone/i.test(key) || /address/i.test(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = safeObject(value);
      if (nested && Object.keys(nested).length) out[key] = nested;
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function serviceRecordContext(row: ServiceRecordRow) {
  const metadata = safeObject(row.extra_metadata);
  return compactMetadata({
    notes: row.notes,
    location: row.location,
    cost: row.cost ?? row.price,
    source_metadata: metadata?.source,
    pricing_metadata: metadata?.pricing,
    stewardship_context: metadata?.stewardship_context,
    source_semantics: "service_record_reported_or_documented_context",
  });
}

function eventRolesForService(row: ServiceRecordRow, pairedStory?: StoryEventRow): EventRole[] {
  const roles: EventRole[] = [];
  if (pairedStory) roles.push("moment");
  if (row.service_type || row.category || row.system_id || row.keepr_pro_id) roles.push("maintenance");
  if (!roles.length) roles.push("maintenance");
  return [...new Set(roles)];
}

export async function collectTimelineAssociations(
  admin: any,
  context: ResolvedAssetContext,
): Promise<CollectorResult> {
  const diagnostics: CollectorResult["diagnostics"] = [];
  const associations: ManifestAssociation[] = [];
  const assetId = context.asset.id;

  const [serviceRecords, storyEvents, timelineRecords, maintenanceEvents, serviceEntries] = await Promise.all([
    runQuery<ServiceRecordRow>(diagnostics, "service_records", () =>
      admin
        .from("service_records")
        .select("id, asset_id, title, service_type, category, performed_at, odometer, system_id, keepr_pro_id, source_type, verification_status, record_scope, notes, location, cost, price, extra_metadata, created_at")
        .eq("asset_id", assetId)
    ),
    runQuery<StoryEventRow>(diagnostics, "story_events", () =>
      admin
        .from("story_events")
        .select("id, asset_id, event_type, title, metadata, occurred_at, source_type, service_record_id, system_id, created_at")
        .eq("asset_id", assetId)
    ),
    runQuery<TimelineRecordRow>(diagnostics, "timeline_records", () =>
      admin
        .from("timeline_records")
        .select("id, asset_id, occurred_on, type, title, source_type, source_ref_id, attachment_id, confidence, created_at, updated_at")
        .eq("asset_id", assetId)
    ),
    runQuery<MaintenanceEventRow>(diagnostics, "maintenance_events", () =>
      admin
        .from("maintenance_events")
        .select("id, asset_id, title, service_date, odometer_hours, provider, created_at")
        .eq("asset_id", assetId)
    ),
    runQuery<ServiceEntryRow>(diagnostics, "service_entries", () =>
      admin
        .from("service_entries")
        .select("id, asset_id, system_id, performed_by_role, ksc_code, created_at")
        .eq("asset_id", assetId)
    ),
  ]);

  const storyByServiceId = new Map<string, StoryEventRow[]>();
  for (const story of storyEvents) {
    const serviceId = storyServiceRecordId(story);
    if (!serviceId) continue;
    if (!storyByServiceId.has(serviceId)) storyByServiceId.set(serviceId, []);
    storyByServiceId.get(serviceId)?.push(story);
  }

  for (const row of serviceRecords) {
    const pairedStories = storyByServiceId.get(row.id) || [];
    const pairedStory = pairedStories[0];
    if (pairedStories.length > 1) {
      diagnostics.push(
        diagnostic(
          "duplicate_service_moment_pairing",
          "warning",
          "Multiple Moments reference the same service record; manifest collapsed the service event once.",
          { source: "story_events", object_type: "service_record", object_id: row.id },
        ),
      );
    }

    associations.push({
      association_id: `work_event:service_record:${row.id}`,
      object_id: row.id,
      object_type: "work_event",
      source_table: "service_records",
      relationship_type: pairedStory ? "service_record_with_moment" : "service_record",
      scope: "kac_specific",
      event_role: eventRolesForService(row, pairedStory)[0],
      event_roles: eventRolesForService(row, pairedStory),
      participant_roles: participantRoles(row),
      work_mode: workMode(row),
      work_modes: [workMode(row)],
      affected_system_id: row.system_id,
      source_authority: sourceAuthority(row.source_type),
      proof_state: row.verification_status === "verified" ? "verified" : "needs_review",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      effective_from: row.performed_at,
      created_at: row.created_at,
      safe_metadata: compactMetadata({
        title: row.title,
        service_type: row.service_type,
        category: row.category,
        odometer: row.odometer,
        record_scope: row.record_scope,
        paired_story_event_id: pairedStory?.id,
        ...serviceRecordContext(row),
      }),
      provenance: [
        { table: "service_records", row_id: row.id },
        ...(pairedStory ? [{ table: "story_events", row_id: pairedStory.id, note: "paired Moment" }] : []),
      ],
    });
  }

  const pairedStoryIds = new Set([...storyByServiceId.values()].flat().map((story) => story.id));
  for (const row of storyEvents) {
    if (pairedStoryIds.has(row.id)) continue;

    associations.push({
      association_id: `moment:story_event:${row.id}`,
      object_id: row.id,
      object_type: "moment",
      source_table: "story_events",
      relationship_type: "story_moment",
      scope: "kac_specific",
      event_role: "moment",
      event_roles: ["moment"],
      affected_system_id: row.system_id,
      source_authority: sourceAuthority(row.source_type),
      proof_state: "claimed",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      effective_from: row.occurred_at,
      created_at: row.created_at,
      safe_metadata: compactMetadata({ title: row.title, event_type: row.event_type }),
      provenance: [{ table: "story_events", row_id: row.id }],
    });
  }

  for (const row of timelineRecords) {
    associations.push({
      association_id: `timeline_record:${row.id}`,
      object_id: row.id,
      object_type: "timeline_record",
      source_table: "timeline_records",
      relationship_type: "timeline_record",
      scope: "kac_specific",
      event_role: row.type === "usage" ? "usage" : "moment",
      event_roles: [row.type === "usage" ? "usage" : "moment"],
      evidence_roles: row.attachment_id ? ["owner_report"] : undefined,
      source_authority: sourceAuthority(row.source_type),
      proof_state: row.attachment_id ? "evidence_attached" : "claimed",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      effective_from: row.occurred_on,
      created_at: row.created_at,
      updated_at: row.updated_at,
      safe_metadata: compactMetadata({
        title: row.title,
        type: row.type,
        source_ref_id: row.source_ref_id,
        attachment_id: row.attachment_id,
        confidence: row.confidence,
      }),
      provenance: [{ table: "timeline_records", row_id: row.id }],
    });
  }

  for (const row of maintenanceEvents) {
    associations.push({
      association_id: `maintenance_event:${row.id}`,
      object_id: row.id,
      object_type: "maintenance_event",
      source_table: "maintenance_events",
      relationship_type: "legacy_maintenance_event",
      scope: "kac_specific",
      event_role: "maintenance",
      event_roles: ["maintenance"],
      participant_roles: row.provider ? ["keepr_pro"] : undefined,
      proof_state: "claimed",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      effective_from: row.service_date,
      created_at: row.created_at,
      safe_metadata: compactMetadata({ title: row.title, odometer_hours: row.odometer_hours, has_provider: Boolean(row.provider) }),
      provenance: [{ table: "maintenance_events", row_id: row.id }],
    });
  }

  for (const row of serviceEntries) {
    associations.push({
      association_id: `service_entry:${row.id}`,
      object_id: row.id,
      object_type: "service_entry",
      source_table: "service_entries",
      relationship_type: "legacy_service_entry",
      scope: "kac_specific",
      event_role: "maintenance",
      event_roles: ["maintenance"],
      participant_roles: row.performed_by_role === "pro" ? ["keepr_pro"] : undefined,
      work_mode: row.performed_by_role === "owner" ? "diy" : row.performed_by_role === "pro" ? "pro" : "unknown",
      affected_system_id: row.system_id,
      proof_state: "claimed",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      created_at: row.created_at,
      safe_metadata: compactMetadata({ performed_by_role: row.performed_by_role, ksc_code: row.ksc_code }),
      provenance: [{ table: "service_entries", row_id: row.id }],
    });
  }

  if (context.access === "direct_steward" && !serviceRecords.length && !maintenanceEvents.length && !serviceEntries.length) {
    addNotVisibleDiagnostic(diagnostics, "timeline", assetId);
  }
  if ((context.access === "direct_steward" || context.access === "org_steward") && serviceRecords.length && !storyEvents.length) {
    addNotVisibleDiagnostic(diagnostics, "timeline", assetId);
  }
  if (context.association_visibility === "admin_identity_only" && !associations.length) {
    addNotVisibleDiagnostic(diagnostics, "timeline", assetId);
  }

  return finalizeCollectorResult(associations, diagnostics);
}
