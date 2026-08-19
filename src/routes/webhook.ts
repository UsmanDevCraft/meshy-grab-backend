import { FastifyInstance } from "fastify";
import { verifyWebhookSignature } from "creem/webhooks";
import { eq, or } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users, subscriptions } from "../db/schema.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post(
    "/api/webhooks/creem",
    {
      config: {
        rawBody: true,
      },
    },
    async (req, reply) => {
      const signature = req.headers["creem-signature"] as string;
      const rawBody = req.rawBody;

      if (!signature || !rawBody) {
        return reply.status(400).send({ error: "Missing signature or body" });
      }

      let event: any;
      try {
        event = await verifyWebhookSignature(
          rawBody,
          {
            "creem-signature": signature,
          },
          env.CREEM_WEBHOOK_SECRET,
        );
        if (!event) {
          event = rawBody;
        }
      } catch (err) {
        req.log.error(err, "CREEM Webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      console.log(
        "[DEBUG] Raw Verified Event:",
        JSON.stringify(event, null, 2),
      );

      const payload = typeof event === "string" ? JSON.parse(event) : event;

      // CREEM event field fallbacks
      const eventType =
        payload.event || payload.type || payload.eventType || payload.action;

      // CREEM data field fallbacks
      const data = payload.data || payload.object || payload.payload || payload;

      req.log.info(`[CREEM Webhook Received] Raw Event Type: ${eventType}`);

      switch (eventType) {
        case "checkout.completed": {
          console.log("[CREEM Webhook] Entering case 'checkout.completed'");

          // Robust userId extraction across potential fields
          const userId =
            data.metadata?.userId ||
            data.metadata?.user_id ||
            data.custom_fields?.userId ||
            data.custom_fields?.user_id ||
            data.userId ||
            data.user_id ||
            null;

          const customerEmail =
            data.customer?.email ||
            data.customer_email ||
            data.email ||
            data.user?.email ||
            null;

          const customerId = data.customerId
            ? String(data.customerId)
            : data.customer?.id
              ? String(data.customer.id)
              : null;

          const subscriptionId = data.subscriptionId
            ? String(data.subscriptionId)
            : data.subscription?.id
              ? String(data.subscription.id)
              : data.id
                ? String(data.id)
                : null;

          const productId = data.productId
            ? String(data.productId)
            : data.product?.id
              ? String(data.product.id)
              : null;

          console.log("[Webhook Debug] Payload metadata:", data.metadata);
          console.log("[Webhook Debug] Target userId:", userId);
          console.log("[Webhook Debug] Customer email:", customerEmail);

          req.log.info(
            { metadata: data.metadata, userId, customerEmail },
            "[Webhook Debug]",
          );

          let targetUserId: string | null = null;

          // Primary strategy: Match by userId from metadata
          if (userId) {
            const [userRecord] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1);

            if (userRecord) {
              targetUserId = userRecord.id;
            } else {
              req.log.warn(
                `[Webhook Warning] No user found in DB matching userId: ${userId}`,
              );
            }
          }

          // Fallback 1: Match by customer email
          if (!targetUserId && customerEmail) {
            req.log.info(
              `[Webhook Fallback] Attempting user lookup by email: ${customerEmail}`,
            );

            const [userRecord] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, customerEmail))
              .limit(1);

            if (userRecord) {
              targetUserId = userRecord.id;
            } else {
              req.log.warn(
                `[Webhook Warning] No user found in DB matching email: ${customerEmail}`,
              );
            }
          }

          // Fallback 2: Match by existing customerId or subscriptionId
          if (!targetUserId && (customerId || subscriptionId)) {
            req.log.warn(
              "checkout.completed attempting fallback lookup by customerId/subscriptionId",
            );
            const conditions = [];
            if (customerId)
              conditions.push(eq(users.creemCustomerId, customerId));
            if (subscriptionId)
              conditions.push(eq(users.creemSubscriptionId, subscriptionId));

            if (conditions.length > 0) {
              const [userRecord] = await db
                .select({ id: users.id })
                .from(users)
                .where(or(...conditions))
                .limit(1);

              if (userRecord) {
                targetUserId = userRecord.id;
              }
            }
          }

          if (targetUserId) {
            // 1. Update user record
            const userUpdate = await db
              .update(users)
              .set({
                isPaid: true,
                creemCustomerId: customerId,
                creemSubscriptionId: subscriptionId,
                paidAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(users.id, targetUserId))
              .returning();

            console.log("[DB SUCCESS] Updated User Record:", userUpdate);

            // 2. Upsert subscription record
            const subUpsert = await db
              .insert(subscriptions)
              .values({
                userId: targetUserId,
                creemCustomerId: customerId,
                creemSubscriptionId: subscriptionId,
                creemProductId: productId,
                status: "active",
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: subscriptions.userId,
                set: {
                  creemCustomerId: customerId,
                  creemSubscriptionId: subscriptionId,
                  creemProductId: productId,
                  status: "active",
                  updatedAt: new Date(),
                },
              })
              .returning();

            console.log(
              "[DB SUCCESS] Upserted Subscription Record:",
              subUpsert,
            );
          } else {
            console.error(
              "[DB ERROR] Failed to resolve targetUserId from metadata, email, or IDs.",
            );
          }
          break;
        }

        case "subscription.canceled":
        case "subscription.expired": {
          console.log(`[CREEM Webhook] Entering case '${eventType}'`);
          const userId =
            data.metadata?.userId ||
            data.metadata?.user_id ||
            data.custom_fields?.userId ||
            data.custom_fields?.user_id ||
            data.userId ||
            data.user_id ||
            null;

          const customerId = data.customerId
            ? String(data.customerId)
            : data.customer?.id
              ? String(data.customer.id)
              : null;

          const subscriptionId = data.subscriptionId
            ? String(data.subscriptionId)
            : data.id
              ? String(data.id)
              : data.subscription?.id
                ? String(data.subscription.id)
                : null;

          req.log.info(
            { customerId, subscriptionId, userId, eventType },
            `Handling subscription cancellation/expiration`,
          );

          // Locate user by userId, creemSubscriptionId, or creemCustomerId
          const userConditions = [];
          if (userId) userConditions.push(eq(users.id, userId));
          if (subscriptionId)
            userConditions.push(eq(users.creemSubscriptionId, subscriptionId));
          if (customerId)
            userConditions.push(eq(users.creemCustomerId, customerId));

          if (userConditions.length > 0) {
            await db
              .update(users)
              .set({
                isPaid: false,
                updatedAt: new Date(),
              })
              .where(or(...userConditions));
          }

          // Update subscription status in subscriptions table
          const subConditions = [];
          if (userId) subConditions.push(eq(subscriptions.userId, userId));
          if (subscriptionId)
            subConditions.push(
              eq(subscriptions.creemSubscriptionId, subscriptionId),
            );
          if (customerId)
            subConditions.push(eq(subscriptions.creemCustomerId, customerId));

          if (subConditions.length > 0) {
            await db
              .update(subscriptions)
              .set({
                status:
                  eventType === "subscription.canceled"
                    ? "canceled"
                    : "expired",
                updatedAt: new Date(),
              })
              .where(or(...subConditions));
          }
          break;
        }

        default:
          req.log.info(`Unhandled CREEM event type: ${eventType}`);
      }

      return reply.status(200).send({ received: true });
    },
  );
}
