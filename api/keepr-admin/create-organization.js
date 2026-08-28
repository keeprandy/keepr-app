import { createClient } from "@supabase/supabase-js";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function getSupabase(service = false, jwt = null) {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = service
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined,
  });
}

async function findAuthUserByEmail(service, email) {
  const normalized = safeString(email).toLowerCase();
  if (!normalized) return null;

  let page = 1;
  const perPage = 1000;
  while (page <= 10) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = (data?.users || []).find((item) => safeString(item.email).toLowerCase() === normalized);
    if (user) return user;
    if (!data?.users?.length || data.users.length < perPage) return null;
    page += 1;
  }

  return null;
}

async function ensureAdminUser(service, { email, password, organizationName }) {
  const normalizedEmail = safeString(email).toLowerCase();
  if (!normalizedEmail) {
    const error = new Error("admin_email_required");
    error.status = 400;
    throw error;
  }

  let user = await findAuthUserByEmail(service, normalizedEmail);
  let created = false;
  let invited = false;

  if (!user) {
    if (safeString(password)) {
      const { data, error } = await service.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: `${organizationName} Admin`,
          full_name: `${organizationName} Admin`,
        },
      });
      if (error) throw error;
      user = data?.user;
      created = true;
    } else {
      const { data, error } = await service.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: {
          display_name: `${organizationName} Admin`,
          full_name: `${organizationName} Admin`,
        },
      });
      if (error) throw error;
      user = data?.user;
      invited = true;
    }
  }

  if (!user?.id) {
    const error = new Error("admin_user_unresolved");
    error.status = 500;
    throw error;
  }

  const displayName = `${organizationName} Admin`;
  const { error: profileError } = await service
    .from("profiles")
    .upsert({
      id: user.id,
      email: normalizedEmail,
      display_name: displayName,
      full_name: displayName,
      role: "consumer",
      plan: "team",
      account_status: "active",
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (profileError) throw profileError;

  return {
    user,
    created,
    invited,
  };
}

async function assertKeeprAdmin(service, userId) {
  const { data, error } = await service
    .from("keepr_internal_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.user_id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authHeader = safeString(req.headers.authorization || req.headers.Authorization);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return res.status(401).json({ error: "auth_required" });

  const service = getSupabase(true);
  if (!service) return res.status(503).json({ error: "admin_service_unavailable" });

  const { data: authData, error: authError } = await service.auth.getUser(jwt);
  if (authError || !authData?.user?.id) return res.status(401).json({ error: "auth_required" });

  try {
    const isAdmin = await assertKeeprAdmin(service, authData.user.id);
    if (!isAdmin) return res.status(403).json({ error: "not_authorized_for_keepr_admin" });

    const body = parseBody(req.body);
    const organizationName = safeString(body.organization_name || body.organizationName || body.company_name || body.companyName);
    const preset = safeString(body.preset || body.organizationPreset || body.org_preset || "org").toLowerCase();
    const adminEmail = safeString(body.admin_email || body.adminEmail).toLowerCase();
    const password = safeString(body.password || body.adminPassword);
    const brand = body.brand && typeof body.brand === "object" ? body.brand : {};
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : null;

    if (!organizationName) return res.status(400).json({ error: "organization_name_required" });
    if (!adminEmail) return res.status(400).json({ error: "admin_email_required" });

    const adminUser = await ensureAdminUser(service, { email: adminEmail, password, organizationName });
    const { data, error } = await service.rpc("create_keepr_organization", {
      p_org_name: organizationName,
      p_org_preset: preset,
      p_admin_user_id: adminUser.user.id,
      p_admin_email: adminEmail,
      p_brand: brand,
      p_capabilities: capabilities,
    });

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      ...data,
      admin_auth_user: {
        id: adminUser.user.id,
        email: adminEmail,
        created: adminUser.created,
        invited: adminUser.invited,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error?.message || "create_organization_failed",
    });
  }
}
