import type { ManifestCollectorStatus, ManifestDiagnostic, ManifestAssociation } from "./kacManifestTypes.ts";
import type { ResolvedKacAsset } from "./kacResolve.ts";

export interface ResolvedAssetContext {
  kac: string;
  asset: ResolvedKacAsset;
  access?: "owner" | "direct_steward" | "org_steward" | "viewer" | "unauthorized" | "admin";
}

export interface CollectorResult {
  associations: ManifestAssociation[];
  diagnostics: ManifestDiagnostic[];
  status?: ManifestCollectorStatus;
}

export function emptyCollectorResult(): CollectorResult {
  return { associations: [], diagnostics: [], status: "complete_empty" };
}

export function diagnostic(
  code: string,
  severity: ManifestDiagnostic["severity"],
  message: string,
  detail?: Pick<ManifestDiagnostic, "source" | "object_type" | "object_id">,
): ManifestDiagnostic {
  return { code, severity, message, ...detail };
}

export function mergeCollectorResults(results: CollectorResult[]): CollectorResult {
  return {
    associations: results.flatMap((result) => result.associations),
    diagnostics: results.flatMap((result) => result.diagnostics),
  };
}

export async function runQuery<T>(
  diagnostics: ManifestDiagnostic[],
  source: string,
  queryFactory: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  try {
    const { data, error } = await queryFactory();
    if (error) {
      diagnostics.push(
        diagnostic(
          "partial_query_failure",
          "warning",
          `Could not collect ${source}; manifest output may be incomplete.`,
          { source },
        ),
      );
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch {
    diagnostics.push(
      diagnostic(
        "partial_query_failure",
        "warning",
        `Could not collect ${source}; manifest output may be incomplete.`,
        { source },
      ),
    );
    return [];
  }
}

export function collectorStatus(
  associations: ManifestAssociation[],
  diagnostics: ManifestDiagnostic[],
  explicitStatus?: ManifestCollectorStatus,
): ManifestCollectorStatus {
  if (explicitStatus) return explicitStatus;
  if (diagnostics.some((d) => d.code === "partial_query_failure")) return "failed";
  if (diagnostics.some((d) => d.code === "unsupported_legacy_surface")) return "unsupported";
  if (diagnostics.some((d) => d.code === "association_surface_not_visible")) return "not_visible";
  if (!associations.length) return "complete_empty";
  return "complete";
}

export function finalizeCollectorResult(
  associations: ManifestAssociation[],
  diagnostics: ManifestDiagnostic[],
  explicitStatus?: ManifestCollectorStatus,
): CollectorResult {
  return {
    associations,
    diagnostics,
    status: collectorStatus(associations, diagnostics, explicitStatus),
  };
}

export function addNotVisibleDiagnostic(
  diagnostics: ManifestDiagnostic[],
  domain: string,
  objectId?: string,
) {
  diagnostics.push(
    diagnostic(
      "association_surface_not_visible",
      "warning",
      `Some ${domain} associations may be hidden for this caller.`,
      { source: domain, object_type: "asset", object_id: objectId },
    ),
  );
}

export function compactMetadata(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}
