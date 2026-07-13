export type KacAccessKind =
  | "owner"
  | "direct_steward"
  | "org_steward"
  | "viewer"
  | "unauthorized";

export interface KacAuthorizationResult {
  access: KacAccessKind;
  access_role: "owner" | "steward" | "viewer" | null;
  user_id: string | null;
  via_org_id?: string;
}

export function getJwt(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

function activeStewardshipQuery(admin: any, assetId: string, nowIso: string) {
  return admin
    .from("asset_stewardships")
    .select("access_role, org_id, user_id")
    .eq("asset_id", assetId)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(1);
}

export async function authorizeKacAsset(
  admin: any,
  asset: { id: string; owner_id?: string | null },
  userId: string | null | undefined,
  now = new Date(),
): Promise<KacAuthorizationResult> {
  if (!userId) {
    return { access: "unauthorized", access_role: null, user_id: null };
  }

  if (asset.owner_id && asset.owner_id === userId) {
    return { access: "owner", access_role: "owner", user_id: userId };
  }

  const nowIso = now.toISOString();

  const { data: direct, error: dErr } = await activeStewardshipQuery(admin, asset.id, nowIso)
    .eq("user_id", userId);

  if (dErr) throw dErr;
  const directRole = direct?.[0]?.access_role;
  if (directRole === "steward") {
    return { access: "direct_steward", access_role: "steward", user_id: userId };
  }
  if (directRole === "viewer") {
    return { access: "viewer", access_role: "viewer", user_id: userId };
  }

  const { data: memberships, error: mErr } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId);

  if (mErr) throw mErr;

  const orgIds = (memberships || []).map((m: any) => m.org_id).filter(Boolean);
  if (!orgIds.length) {
    return { access: "unauthorized", access_role: null, user_id: userId };
  }

  const { data: orgStew, error: oErr } = await activeStewardshipQuery(admin, asset.id, nowIso)
    .in("org_id", orgIds);

  if (oErr) throw oErr;
  const orgMatch = orgStew?.[0];
  if (orgMatch?.access_role === "steward") {
    return {
      access: "org_steward",
      access_role: "steward",
      user_id: userId,
      via_org_id: orgMatch.org_id,
    };
  }
  if (orgMatch?.access_role === "viewer") {
    return {
      access: "viewer",
      access_role: "viewer",
      user_id: userId,
      via_org_id: orgMatch.org_id,
    };
  }

  return { access: "unauthorized", access_role: null, user_id: userId };
}

export async function getAuthenticatedUserId(admin: any, jwt: string | null) {
  if (!jwt) return { user_id: null, error: "Missing auth" as const };

  const { data: userData, error } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (error || !user?.id) return { user_id: null, error: "Invalid user" as const };

  return { user_id: user.id as string, error: null };
}
