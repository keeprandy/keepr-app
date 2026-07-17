// lib/publicQrApi.js
// Public QR endpoints (Edge Functions). Uses anon key for auth headers.
// IMPORTANT: Service role key never goes in the app.

import { getSupabaseFunctionUrl } from "./supabaseFunctions";

export const PUBLIC_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

function headers() {
  if (!PUBLIC_ANON_KEY) throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY");

  return {
    "Content-Type": "application/json",
    apikey: PUBLIC_ANON_KEY,
    Authorization: `Bearer ${PUBLIC_ANON_KEY}`,
  };
}

async function post(path, body) {
  const res = await fetch(getSupabaseFunctionUrl(path), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave json null
  }

  if (!res.ok) {
    const message =
      (json && (json.message || json.error)) || text || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json ?? {};
}

export async function publicResolve(token) {
  return post("public-resolve", { token });
}

export async function publicCreateServiceRecord(token, { title, notes, performed_at }) {
  return post("public-create-service-record", {
    token,
    title,
    notes,
    performed_at,
  });
}
