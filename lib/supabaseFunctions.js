const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

export function getSupabaseFunctionsBaseUrl() {
  const baseUrl = String(SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");
  }
  return `${baseUrl}/functions/v1`;
}

export function getSupabaseFunctionUrl(functionName) {
  const name = String(functionName || "").replace(/^\/+/, "");
  if (!name) {
    throw new Error("Missing Supabase function name");
  }
  return `${getSupabaseFunctionsBaseUrl()}/${name}`;
}
