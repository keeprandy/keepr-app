const SUPABASE_URL_ENV = "EXPO_PUBLIC_SUPABASE_URL";
const SUPABASE_ANON_KEY_ENV = "EXPO_PUBLIC_SUPABASE_ANON_KEY";

function cleanEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

const supabaseUrl = cleanEnvValue(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const supabaseProjectRef = projectRefFromUrl(supabaseUrl);
const anonProjectRef = decodeJwtPayload(supabaseAnonKey)?.ref || null;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    `Missing ${SUPABASE_URL_ENV} or ${SUPABASE_ANON_KEY_ENV}; Supabase runtime config is incomplete.`
  );
}

if (supabaseProjectRef && anonProjectRef && supabaseProjectRef !== anonProjectRef) {
  throw new Error(
    `Supabase runtime config mismatch: ${SUPABASE_URL_ENV} points to ${supabaseProjectRef}, but ${SUPABASE_ANON_KEY_ENV} belongs to ${anonProjectRef}.`
  );
}

export const SUPABASE_URL = supabaseUrl.replace(/\/+$/, "");
export const SUPABASE_ANON_KEY = supabaseAnonKey;
export const SUPABASE_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

export function getSupabaseFunctionHeaders(accessToken) {
  const bearer = cleanEnvValue(accessToken) || SUPABASE_ANON_KEY;
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${bearer}`,
  };
}

export async function postSupabaseFunction(path, payload, options = {}) {
  const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/${path}`, {
    method: "POST",
    credentials: options.credentials || "omit",
    headers: getSupabaseFunctionHeaders(options.accessToken),
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Leave json null; error handling below can use the raw text.
  }

  if (!res.ok) {
    throw new Error((json && (json.error || json.message)) || text || `HTTP ${res.status}`);
  }

  return json ?? {};
}
