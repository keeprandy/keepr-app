import { createClient } from "@supabase/supabase-js";
import {
  decorateKeeprLinkProjection,
  isPublicKeeprLinkPurpose,
  normalizeKeeprLinkAddress,
  normalizeKeeprLinkPurpose,
} from "../../../lib/keeprLinkContext";

// API surface: /api/k/:kac/context keeps the existing /k address pattern,
// but returns purpose-scoped Core Ontology context instead of a UI story.
function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getBearer(req) {
  const header = safeString(req.headers.authorization || req.headers.Authorization);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function getSupabase(req) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const bearer = getBearer(req);
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const address = normalizeKeeprLinkAddress(firstQueryValue(req.query?.kac));
  const purpose = normalizeKeeprLinkPurpose(firstQueryValue(req.query?.purpose));
  const systemId = safeString(firstQueryValue(req.query?.systemId)) || null;

  if (!address) return res.status(400).json({ error: "missing_keeprlink_address" });

  const supabase = getSupabase(req);
  if (!supabase) return res.status(503).json({ error: "keeprlink_context_unavailable" });

  try {
    const bearer = getBearer(req);
    const { data: authData } = bearer
      ? await supabase.auth.getUser(bearer)
      : { data: { user: null } };
    const authenticated = !!authData?.user?.id;

    if (!isPublicKeeprLinkPurpose(purpose) && !authenticated) {
      return res.status(401).json({
        ok: false,
        error: "authentication_required",
        purpose,
        address,
      });
    }

    const { data, error } = await supabase.rpc("resolve_keeprlink_context", {
      p_address: address,
      p_purpose: purpose,
      p_system_id: systemId,
      p_authorized: authenticated,
    });

    if (error) {
      if (error.code === "PGRST202") return res.status(503).json({ error: "keeprlink_context_rpc_missing" });
      throw error;
    }

    if (!data || data?.ok === false) {
      return res.status(data?.error === "not_found" ? 404 : 400).json(data || { error: "not_found" });
    }

    return res.status(200).json(decorateKeeprLinkProjection(data, { purpose, authenticated }));
  } catch (error) {
    return res.status(500).json({ error: error?.message || "server_error" });
  }
}
