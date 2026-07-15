import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isBuild3ACallablePurpose,
  buildKacIntelligenceOrchestration,
} from "../_shared/kacIntelligenceOrchestration.ts";
import type { KacIntelligenceManifest, KnowledgeGap, ManifestAssociation, ManifestCollectorStatus, ManifestDiagnostic } from "../_shared/kacManifestTypes.ts";
import { getJwt, getAuthenticatedUserId, authorizeKacAsset } from "../_shared/kacAuth.ts";
import { resolveKacAsset, resolveKacAssetForManifestAdmin, type ResolvedKacAsset } from "../_shared/kacResolve.ts";
import { collectAssetIdentityAssociations } from "../_shared/kacManifestIdentity.ts";
import { collectSystemAssociations } from "../_shared/kacManifestSystems.ts";
import { collectTimelineAssociations } from "../_shared/kacManifestTimeline.ts";
import { collectAttachmentAssociations } from "../_shared/kacManifestAttachments.ts";
import type { CollectorResult, ResolvedAssetContext } from "../_shared/kacManifestCollectorUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ManifestAccess = "owner" | "direct_steward" | "org_steward" | "viewer" | "unauthorized" | "admin";

interface CollectorSummary {
  collector: string;
  status: ManifestCollectorStatus;
  association_count: number;
  diagnostics: ManifestDiagnostic[];
  duration_ms: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseUserClient(jwt: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Missing Supabase configuration");

  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function getPlatformAdminAccess(client: any, userId: string) {
  const { data } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return data?.role === "admin" || data?.role === "superkeepr";
}

function maskSerial(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  const suffix = raw.slice(-4);
  return `${"*".repeat(Math.max(4, Math.min(8, raw.length - suffix.length)))}${suffix}`;
}

function sanitizeAssociation(association: ManifestAssociation): ManifestAssociation {
  const safe_metadata = { ...(association.safe_metadata || {}) };
  if (safe_metadata.kind === "serial_number" && safe_metadata.value) safe_metadata.value = maskSerial(safe_metadata.value);
  if (safe_metadata.serial_number) safe_metadata.serial_number = maskSerial(safe_metadata.serial_number);
  for (const key of [
    "extracted_text",
    "url",
    "signed_url",
    "signedUrl",
    "storage_path",
    "email",
    "phone",
    "address",
    "home_address",
    "work_address",
    "dealer_phone",
    "dealer_address",
    "access_token",
    "refresh_token",
    "secret",
    "service_role",
  ]) {
    delete (safe_metadata as any)[key];
  }
  return { ...association, safe_metadata };
}

function sanitizeDiagnostics(diagnostics: ManifestDiagnostic[]) {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source,
    object_type: diagnostic.object_type,
    object_id: diagnostic.object_id,
  }));
}

function groupAssociations(associations: ManifestAssociation[]) {
  const groups: Record<string, ManifestAssociation[]> = { identity: [], systems: [], timeline: [], attachments: [] };
  for (const association of associations) {
    if (association.source_table === "assets" || association.source_table === "master_assets" || association.source_table === "asset_identifiers") groups.identity.push(association);
    else if (["systems", "vehicle_systems", "boat_systems", "home_systems"].includes(association.source_table || "")) groups.systems.push(association);
    else if (["service_records", "story_events", "maintenance_events", "service_entries"].includes(association.source_table || "")) groups.timeline.push(association);
    else if (["attachments", "attachment_placements", "attachment_links"].includes(association.source_table || "")) groups.attachments.push(association);
  }
  return groups;
}

async function runCollector(name: string, fn: () => Promise<CollectorResult>): Promise<{ result: CollectorResult; summary: CollectorSummary }> {
  const start = Date.now();
  try {
    const result = await fn();
    const diagnostics = sanitizeDiagnostics(result.diagnostics || []);
    return {
      result: { associations: result.associations || [], diagnostics, status: result.status },
      summary: {
        collector: name,
        status: result.status || (diagnostics.some((d) => d.code === "partial_query_failure") ? "failed" : result.associations?.length ? "complete" : "complete_empty"),
        association_count: result.associations?.length || 0,
        diagnostics,
        duration_ms: Date.now() - start,
      },
    };
  } catch {
    const diagnostics = sanitizeDiagnostics([{ code: "partial_query_failure", severity: "warning", message: `Could not collect ${name}; manifest output may be incomplete.`, source: name }]);
    return {
      result: { associations: [], diagnostics, status: "failed" },
      summary: { collector: name, status: "failed", association_count: 0, diagnostics, duration_ms: Date.now() - start },
    };
  }
}

function generateKnowledgeGaps(associations: ManifestAssociation[], diagnostics: ManifestDiagnostic[]): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const bySource = new Set(associations.map((association) => association.source_table));
  const systems = associations.filter((association) => ["systems", "vehicle_systems", "boat_systems", "home_systems"].includes(association.source_table || ""));
  const maintenance = associations.filter((association) => association.event_roles?.includes("maintenance") || association.event_role === "maintenance");
  if (!systems.length) gaps.push({ id: "gap:no_systems", category: "systems", question: "No systems are associated with this KAC yet.", priority: "high" });
  for (const system of systems) {
    if (!system.safe_metadata?.model || !system.safe_metadata?.serial_number) {
      gaps.push({ id: `gap:system_identity:${system.association_id}`, category: "systems", question: "A system is missing model or serial identity.", priority: "medium", related_association_ids: [system.association_id] });
    }
  }
  for (const record of maintenance) {
    if (record.proof_state !== "evidence_attached" && record.proof_state !== "verified") {
      gaps.push({ id: `gap:maintenance_evidence:${record.association_id}`, category: "evidence", question: "A maintenance record lacks attached evidence.", priority: "medium", related_association_ids: [record.association_id] });
    }
  }
  if (!bySource.has("asset_identifiers")) gaps.push({ id: "gap:no_asset_identifiers", category: "identity", question: "No supplemental asset identifier rows were found.", priority: "low" });
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "conflicting_identity") gaps.push({ id: `gap:identity_conflict:${diagnostic.object_id || "unknown"}`, category: "conflict", question: "An identity conflict needs review.", priority: "high" });
    if (diagnostic.code === "orphaned_placement") gaps.push({ id: `gap:orphaned_placement:${diagnostic.object_id || "unknown"}`, category: "evidence", question: "An attachment placement is orphaned.", priority: "medium" });
    if (diagnostic.code === "unresolved_system_reference") gaps.push({ id: `gap:unresolved_system:${diagnostic.object_id || "unknown"}`, category: "systems", question: "A record references a system that was not resolved.", priority: "medium" });
  }
  return gaps;
}

function buildBaseManifest(purpose: "asset_overview", kac: string, asset: ResolvedKacAsset, access: ManifestAccess, userId: string): Omit<KacIntelligenceManifest, "associations" | "association_groups" | "knowledge_gaps" | "diagnostics" | "collector_summaries"> {
  return {
    manifest_version: "1.0",
    generated_at: new Date().toISOString(),
    status: "complete",
    purpose,
    kac,
    asset: {
      id: asset.id,
      kac_id: asset.kac_id,
      name: asset.name,
      type: asset.type,
      status: asset.status,
      asset_mode: asset.asset_mode,
      lifecycle_state: asset.lifecycle_state,
      availability: asset.manifest_availability,
    },
    authorization: {
      requester_user_id: userId,
      access,
      access_role: access === "admin" ? null : access === "owner" ? "owner" : access.includes("steward") ? "steward" : access === "viewer" ? "viewer" : null,
    },
  };
}

function manifestPurposeAllowed(access: ManifestAccess) {
  return ["owner", "direct_steward", "org_steward", "admin"].includes(access);
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const jwt = getJwt(req);
    if (!jwt) return json({ error: "Missing auth" }, 401);

    const client = getSupabaseUserClient(jwt);
    const auth = await getAuthenticatedUserId(client, jwt);
    if (auth.error || !auth.user_id) return json({ error: "Invalid user" }, 401);

    const body = await req.json().catch(() => ({}));
    const purpose = String(body?.purpose || "");
    if (!isBuild3ACallablePurpose(purpose)) return json({ error: "Unsupported purpose" }, 400);

    const isAdmin = await getPlatformAdminAccess(client, auth.user_id);
    const resolved = isAdmin ? await resolveKacAssetForManifestAdmin(client, body?.kac) : await resolveKacAsset(client, body?.kac);
    if (!resolved.ok) return json({ error: resolved.error }, resolved.error === "missing_kac" || resolved.error === "malformed_kac" ? 400 : 404);

    const authz = await authorizeKacAsset(client, resolved.asset, auth.user_id);
    const access: ManifestAccess = isAdmin ? "admin" : authz.access;
    if (!manifestPurposeAllowed(access)) return json({ error: access === "viewer" ? "Not authorized" : "asset_not_found" }, access === "viewer" ? 403 : 404);

    let manifest: KacIntelligenceManifest;
    if (resolved.asset.manifest_availability === "admin_review_required" && access !== "admin") {
      const diagnostic = sanitizeDiagnostics([{ code: "disputed_asset_requires_admin_review", severity: "warning", message: "This asset requires admin review before normal asset-overview manifestation.", source: "assets", object_type: "asset", object_id: resolved.asset.id }]);
      manifest = {
        ...buildBaseManifest("asset_overview", resolved.kac, resolved.asset, access, auth.user_id),
        status: "restricted",
        association_groups: { identity: [], systems: [], timeline: [], attachments: [] },
        associations: [],
        collector_summaries: [],
        knowledge_gaps: [],
        diagnostics: diagnostic,
      };
    } else {
      const context: ResolvedAssetContext = {
        kac: resolved.kac,
        asset: resolved.asset,
        access,
        association_visibility: isAdmin ? "admin_identity_only" : "caller_rls",
      };
      const collectors = await Promise.all([
        runCollector("identity", () => collectAssetIdentityAssociations(client, context)),
        runCollector("systems", () => collectSystemAssociations(client, context)),
        runCollector("timeline", () => collectTimelineAssociations(client, context)),
        runCollector("attachments", () => collectAttachmentAssociations(client, context)),
      ]);
      const diagnostics = sanitizeDiagnostics(collectors.flatMap((collector) => collector.result.diagnostics));
      const associations = collectors.flatMap((collector) => collector.result.associations).map(sanitizeAssociation);
      const summaries = collectors.map((collector) => collector.summary);
      const status = summaries.some((summary) => !["complete", "complete_empty"].includes(summary.status)) ? "partial" : "complete";
      manifest = {
        ...buildBaseManifest("asset_overview", resolved.kac, resolved.asset, access, auth.user_id),
        status,
        associations,
        association_groups: groupAssociations(associations),
        collector_summaries: summaries,
        knowledge_gaps: generateKnowledgeGaps(associations, diagnostics),
        diagnostics,
      };
    }

    const result = await buildKacIntelligenceOrchestration({
      request: {
        request_version: "3A.0",
        kac: resolved.kac,
        purpose,
        caller: { authenticated: true, user_id: auth.user_id, authorization_role: access },
        authorized_manifest: manifest,
        model_invocation: { enabled: Boolean(body?.model_invocation?.enabled) },
        generated_at: body?.generated_at,
        telemetry_id: body?.telemetry_id,
      },
    });
    return json(result);
  } catch {
    return json({ error: "Server error" }, 500);
  }
});
