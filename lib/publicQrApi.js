// lib/publicQrApi.js
// Public QR endpoints (Edge Functions). Uses anon key for auth headers.
// IMPORTANT: Service role key never goes in the app.

const PROJECT_REF = "jjzjuqxysucqutgjnrkk";
const FUNCTIONS_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

// Put your anon key in app config (recommended).
// For now, paste it directly or load from process.env / Constants.
export const PUBLIC_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqemp1cXh5c3VjcXV0Z2pucmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwNzk4NzIsImV4cCI6MjA3OTY1NTg3Mn0.cNztcxhiBUJ58zZxzDB__8IMi3F-GWMHPpAisqAP_PI";

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: PUBLIC_ANON_KEY,
    Authorization: `Bearer ${PUBLIC_ANON_KEY}`,
  };
}

async function post(path, body) {
  const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
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
