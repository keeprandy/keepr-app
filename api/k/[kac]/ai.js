import { createClient } from "@supabase/supabase-js";
import {
  decorateKeeprLinkProjection,
  isPublicKeeprLinkPurpose,
  normalizeKeeprLinkAddress,
} from "../../../lib/keeprLinkContext";
import { renderKeeprLinkAiDocument } from "../../../lib/keeprLinkAiDocument";

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

function absoluteUrl(req, path) {
  const proto = safeString(req.headers["x-forwarded-proto"]) || "https";
  const host = safeString(req.headers["x-forwarded-host"] || req.headers.host);
  if (!host) return path;
  return `${proto}://${host}${path}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("method_not_allowed");
  }

  const address = normalizeKeeprLinkAddress(firstQueryValue(req.query?.kac));
  const systemId = safeString(firstQueryValue(req.query?.systemId)) || null;
  const purpose = "llm_context";

  if (!address) return res.status(400).send("missing_keeprlink_address");

  const supabase = getSupabase(req);
  if (!supabase) return res.status(503).send("keeprlink_context_unavailable");

  try {
    const bearer = getBearer(req);
    const { data: authData } = bearer
      ? await supabase.auth.getUser(bearer)
      : { data: { user: null } };
    const authenticated = !!authData?.user?.id;

    if (!isPublicKeeprLinkPurpose(purpose) && !authenticated) {
      return res.status(401).send("authentication_required");
    }

    const { data, error } = await supabase.rpc("resolve_keeprlink_context", {
      p_address: address,
      p_purpose: purpose,
      p_system_id: systemId,
      p_authorized: authenticated,
    });

    if (error) {
      if (error.code === "PGRST202") return res.status(503).send("keeprlink_context_rpc_missing");
      throw error;
    }

    if (!data || data?.ok === false) {
      return res.status(data?.error === "not_found" ? 404 : 400).send(data?.error || "not_found");
    }

    const projection = decorateKeeprLinkProjection(data, { purpose, authenticated });
    const canonicalJsonPath = `/api/k/${encodeURIComponent(address)}/context?purpose=llm_context`;
    const canonicalPagePath = `/k/${encodeURIComponent(address)}`;
    const html = renderKeeprLinkAiDocument(projection, {
      canonicalJsonUrl: absoluteUrl(req, canonicalJsonPath),
      canonicalPageUrl: absoluteUrl(req, canonicalPagePath),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send(error?.message || "server_error");
  }
}
