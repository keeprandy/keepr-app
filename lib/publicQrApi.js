// lib/publicQrApi.js
// Public QR endpoints (Edge Functions). Uses anon key for auth headers.
// IMPORTANT: Service role key never goes in the app.

import { SUPABASE_ANON_KEY, postSupabaseFunction } from "./supabaseRuntimeConfig";

export const PUBLIC_ANON_KEY = SUPABASE_ANON_KEY;

async function post(path, body) {
  return postSupabaseFunction(path, body);
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
