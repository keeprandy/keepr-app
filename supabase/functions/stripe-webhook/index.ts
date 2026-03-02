import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.25.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function planFromPriceId(priceId: string) {
  const plusM = Deno.env.get("STRIPE_PRICE_PLUS_MONTHLY");
  const plusY = Deno.env.get("STRIPE_PRICE_PLUS_YEARLY");
  const teamM = Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY");
  const teamY = Deno.env.get("STRIPE_PRICE_TEAM_YEARLY");

  if (priceId === plusM) return { plan: "plus", cycle: "monthly" };
  if (priceId === plusY) return { plan: "plus", cycle: "yearly" };
  if (priceId === teamM) return { plan: "team", cycle: "monthly" };
  if (priceId === teamY) return { plan: "team", cycle: "yearly" };
  return null;
}

function toIsoFromUnix(seconds: number | null | undefined) {
  if (!seconds || typeof seconds !== "number") return null;
  return new Date(seconds * 1000).toISOString();
}

async function ensureTeamOrg(userId: string) {
  const { data: existing, error } = await supabaseAdmin
    .from("orgs")
    .select("id")
    .eq("owner_user_id", userId)
    .limit(1);

  if (error) throw error;
  if (existing && existing.length > 0) return;

  const { error: insErr } = await supabaseAdmin.from("orgs").insert({
    name: "My Team",
    org_type: "family",
    owner_user_id: userId,
  });

  if (insErr) throw insErr;
}

async function findUserIdByCustomerId(customerId: string) {
  const { data: prof, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (error) return null;
  return prof?.id ?? null;
}

async function applySubscriptionToProfile(sub: Stripe.Subscription, eventType: string) {
  let userId = (sub.metadata?.user_id as string) || null;

  if (!userId) {
    const customerId = String(sub.customer || "");
    if (customerId) userId = await findUserIdByCustomerId(customerId);
  }

  if (!userId) {
    console.log("[stripe-webhook] no userId resolved", {
      eventType,
      subId: sub.id,
      customer: sub.customer,
      metadata: sub.metadata,
    });
    return;
  }

  const priceId = String(sub.items?.data?.[0]?.price?.id || "");
  const mapped = planFromPriceId(priceId);
  if (!mapped) {
    console.log("[stripe-webhook] priceId not mapped", { eventType, priceId });
    return;
  }

  const isActive = sub.status === "active" || sub.status === "trialing";
  const billing_status =
    eventType === "customer.subscription.deleted"
      ? "canceled"
      : isActive
      ? "active"
      : sub.status === "past_due"
      ? "past_due"
      : "inactive";

  // IMPORTANT: some Stripe event payloads include current_period_end only on the subscription item
  const itemPeriodEnd = sub.items?.data?.[0]?.current_period_end;
  const currentPeriodEndIso = toIsoFromUnix(
    (sub.current_period_end ?? itemPeriodEnd) as number | undefined
  );

  console.log("[stripe-webhook] applySubscription", {
    eventType,
    userId,
    subId: sub.id,
    status: sub.status,
    current_period_end_sub: sub.current_period_end,
    current_period_end_item: itemPeriodEnd,
    current_period_end_iso: currentPeriodEndIso,
    mapped,
  });

  const { error: updErr } = await supabaseAdmin
    .from("profiles")
    .update({
      plan: mapped.plan,
      billing_cycle: mapped.cycle,
      billing_status,
      stripe_customer_id: String(sub.customer || "") || null,
      stripe_subscription_id: sub.id,
      current_period_end: currentPeriodEndIso,
    })
    .eq("id", userId);

  if (updErr) throw updErr;

  if (mapped.plan === "team" && billing_status === "active") {
    await ensureTeamOrg(userId);
  }
}

Deno.serve(async (req) => {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return new Response("Missing stripe-signature", { status: 400 });

    const rawBody = await req.text();
    const event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);

    console.log("[stripe-webhook] received", { type: event.type, id: event.id });

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      await applySubscriptionToProfile(sub, event.type);
      return new Response("ok", { status: 200 });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId =
        (session.client_reference_id as string) ||
        (session.metadata?.user_id as string) ||
        null;

      const customerId = String(session.customer || "");
      const subscriptionId = String(session.subscription || "");

      console.log("[stripe-webhook] checkout.session.completed", {
        userId,
        customerId,
        subscriptionId,
      });

      if (userId) {
        const { error: updErr } = await supabaseAdmin
          .from("profiles")
          .update({
            stripe_customer_id: customerId || null,
            stripe_subscription_id: subscriptionId || null,
          })
          .eq("id", userId);

        if (updErr) throw updErr;
      }

      // Optional backfill (safe): pulls full subscription object from Stripe
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscriptionToProfile(sub, "customer.subscription.updated");
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(`Webhook error: ${String((e as any)?.message || e)}`, {
      status: 400,
    });
  }
});