import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header.");

    const admin = createClient(supabaseUrl, serviceKey);

    const userClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user?.id) {
      throw new Error("You must be signed in to accept this invite.");
    }

    const { inviteToken } = await req.json();

    if (!inviteToken) throw new Error("Missing invite token.");

    const { data: invite, error: inviteError } = await admin
      .from("hub_members")
      .select("*")
      .eq("invite_token", inviteToken)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) throw new Error("Invite not found.");

    if (invite.status === "active" && invite.user_id === user.id) {
      return new Response(JSON.stringify({ ok: true, membership: invite }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invite.status !== "invited") {
      throw new Error("Invite is no longer pending.");
    }

    const now = new Date().toISOString();

    const { data: membership, error: updateError } = await admin
      .from("hub_members")
      .update({
        user_id: user.id,
        status: "active",
        accepted_at: now,
      })
      .eq("id", invite.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    await admin
      .from("inbox_items")
      .update({ status: "complete", completed_at: now })
      .eq("type", "hub_invite")
      .eq("payload->>invite_token", inviteToken);

    await admin
      .from("actions")
      .update({ status: "complete", completed_at: now })
      .eq("type", "hub_invite")
      .eq("payload->>invite_token", inviteToken);

    await admin
      .from("notifications")
      .update({ read_at: now })
      .eq("type", "hub_invite")
      .eq("payload->>invite_token", inviteToken);

    return new Response(JSON.stringify({ ok: true, membership }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Could not accept invite." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});