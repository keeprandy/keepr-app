import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.25.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPriceId(plan: string, cycle: string) {
  if (plan === "plus" && cycle === "monthly")
    return Deno.env.get("STRIPE_PRICE_PLUS_MONTHLY");
  if (plan === "plus" && cycle === "yearly")
    return Deno.env.get("STRIPE_PRICE_PLUS_YEARLY");
  if (plan === "team" && cycle === "monthly")
    return Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY");
  if (plan === "team" && cycle === "yearly")
    return Deno.env.get("STRIPE_PRICE_TEAM_YEARLY");

  throw new Error("Invalid plan or billing cycle");
}

async function getUserFromJwt(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnon) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in Edge env");
  }

  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authHeader, // MUST be "Bearer <jwt>"
      apikey: supabaseAnon,
    },
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    return { ok: false as const, status: r.status, data };
  }

  return { ok: true as const, user: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization Bearer token" });
    }

    const auth = await getUserFromJwt(authHeader);
    if (!auth.ok) {
      // This will show the real reason instead of a generic 401
      return json(401, { error: "Unauthorized", details: auth });
    }

    const user = auth.user; // includes `id`
    const body = await req.json().catch(() => ({}));

    const plan = String(body?.plan || "").trim();
    const cycle = String(body?.cycle || "").trim();

    const priceId = getPriceId(plan, cycle);
    if (!priceId) return json(500, { error: "Missing Stripe price env var" });

    const siteUrl = Deno.env.get("SITE_URL");
    if (!siteUrl) return json(500, { error: "Missing SITE_URL env var" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      metadata: { user_id: user.id, plan, cycle },
      subscription_data: {
        metadata: { user_id: user.id, plan, cycle },
      },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/PlanUpgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/PlanUpgrade?canceled=true`,
      allow_promotion_codes: false,
    });

    return json(200, { url: session.url });
  } catch (err) {
    return json(500, { error: String(err?.message || err) });
  }
});