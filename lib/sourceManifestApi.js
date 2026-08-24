import { keeprApiRequest } from "./keeprApi";
import { supabase } from "./supabaseClient";

export async function fetchSourceManifestByKac(kac) {
  const cleanKac = String(kac || "").trim();
  if (!cleanKac) throw new Error("Missing KAC");

  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token || null;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  return keeprApiRequest(`/api/k/${encodeURIComponent(cleanKac)}/source`, {
    method: "GET",
    headers,
  });
}
