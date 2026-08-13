import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";
import { stripe } from "../lib/stripe.js";
import { env } from "../config/env.js";

export async function createCheckoutSession(installationId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.installationId, installationId))
    .limit(1);

  if (!user) {
    return {
      success: false as const,
      error: "USER_NOT_FOUND",
    };
  }

  let stripeCustomerId: string | null = null;

  const [existingSubscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  if (existingSubscription?.stripeCustomerId) {
    stripeCustomerId = existingSubscription.stripeCustomerId;
  }

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      metadata: {
        userId: user.id,
        installationId: user.installationId,
      },
    });

    stripeCustomerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",

    customer: stripeCustomerId,

    line_items: [
      {
        price: env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],

    metadata: {
      userId: user.id,
      installationId: user.installationId,
    },

    subscription_data: {
      metadata: {
        userId: user.id,
        installationId: user.installationId,
      },
    },

    success_url: "https://example.com/meshygrab/success",
    cancel_url: "https://example.com/meshygrab/cancel",
  });

  return {
    success: true as const,
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}
