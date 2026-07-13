import type { ManifestDiagnostic, ManifestAssociation } from "./kacManifestTypes.ts";
import type { ResolvedKacAsset } from "./kacResolve.ts";

export interface ResolvedAssetContext {
  kac: string;
  asset: ResolvedKacAsset;
}

export interface CollectorResult {
  associations: ManifestAssociation[];
  diagnostics: ManifestDiagnostic[];
}

export function emptyCollectorResult(): CollectorResult {
  return { associations: [], diagnostics: [] };
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

export function compactMetadata(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}
