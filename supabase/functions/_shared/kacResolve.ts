export interface ResolvedKacAsset {
  id: string;
  kac_id: string;
  owner_id: string | null;
  name?: string;
  type?: string;
  status?: string | null;
  asset_mode?: string | null;
  lifecycle_state: "active" | "archived" | "transfer_ready" | "unclaimed" | "disputed" | "unknown";
  manifest_availability: "available" | "admin_review_required";
}

export type KacResolveResult =
  | { ok: true; kac: string; asset: ResolvedKacAsset }
  | { ok: false; kac: string | null; error: "missing_kac" | "malformed_kac" | "asset_not_found" };

const KAC_PATTERN = /^KPR-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function normalizeKac(kac: unknown) {
  const normalized = String(kac ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  return normalized || null;
}

export function isValidNormalizedKac(kac: string | null) {
  return Boolean(kac && KAC_PATTERN.test(kac));
}

function classifyAssetLifecycle(status: unknown): Pick<
  ResolvedKacAsset,
  "lifecycle_state" | "manifest_availability"
> {
  if (status === "active") {
    return { lifecycle_state: "active", manifest_availability: "available" };
  }
  if (status === "archived") {
    return { lifecycle_state: "archived", manifest_availability: "available" };
  }
  if (status === "transfer_ready") {
    return { lifecycle_state: "transfer_ready", manifest_availability: "available" };
  }
  if (status === "unclaimed") {
    return { lifecycle_state: "unclaimed", manifest_availability: "available" };
  }
  if (status === "disputed") {
    return { lifecycle_state: "disputed", manifest_availability: "admin_review_required" };
  }

  return { lifecycle_state: "unknown", manifest_availability: "available" };
}

export async function resolveKacAsset(admin: any, kacInput: unknown): Promise<KacResolveResult> {
  const kac = normalizeKac(kacInput);
  if (!kac) return { ok: false, kac: null, error: "missing_kac" };
  if (!isValidNormalizedKac(kac)) return { ok: false, kac, error: "malformed_kac" };

  const { data: asset, error } = await admin
    .from("assets")
    .select("id, kac_id, owner_id, name, type, status, asset_mode")
    .eq("kac_id", kac)
    .is("deleted_at", null)
    .single();

  if (error || !asset) return { ok: false, kac, error: "asset_not_found" };

  const lifecycle = classifyAssetLifecycle(asset.status);

  return {
    ok: true,
    kac,
    asset: {
      id: asset.id,
      kac_id: asset.kac_id,
      owner_id: asset.owner_id ?? null,
      name: asset.name,
      type: asset.type,
      status: asset.status ?? null,
      asset_mode: asset.asset_mode ?? null,
      ...lifecycle,
    },
  };
}
