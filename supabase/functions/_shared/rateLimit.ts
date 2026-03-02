export async function checkRateLimit(
  supabase: any,
  public_link_id: string,
  limit = 25
) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("public_intake_events")
    .select("*", { count: "exact", head: true })
    .eq("public_link_id", public_link_id)
    .gte("created_at", since);

  if (error) throw error;
  if ((count ?? 0) >= limit) throw new Error("Rate limit exceeded");
}
