import { FastifyPluginAsync } from "fastify";
import { Environment, EventName, Paddle } from "@paddle/paddle-node-sdk";

import { env } from "../../config/env.js";
import {
  revokePaddleSubscription,
  setUserLifetimePlan,
  upsertPaddleSubscription,
} from "../../services/subscription.js";

const paddleEnvironment = env.PADDLE_CLIENT_TOKEN.startsWith("live_")
  ? Environment.production
  : Environment.sandbox;

const paddle = new Paddle(env.PADDLE_API_KEY, {
  environment: paddleEnvironment,
});

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/paddle/webhook",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const signature = request.headers["paddle-signature"];

      const rawBody = (request as any).rawBody;

      if (!signature || !rawBody) {
        return reply.status(400).send({
          error: "Missing Paddle signature or raw body",
        });
      }

      let event;

      try {
        event = await paddle.webhooks.unmarshal(
          rawBody,
          env.PADDLE_WEBHOOK_SECRET,
          signature as string,
        );
      } catch (error: any) {
        fastify.log.warn(
          {
            message: error?.message,
          },
          "Invalid Paddle webhook signature",
        );

        return reply.status(400).send({
          error: "Invalid webhook signature",
        });
      }

      fastify.log.info(
        {
          eventType: event.eventType,
          eventId: event.eventId,
        },
        "Received Paddle webhook",
      );

      try {
        switch (event.eventType) {
          /**
           * ---------------------------------------------------------
           * TRANSACTION COMPLETED
           * ---------------------------------------------------------
           *
           * Paddle has successfully completed processing the payment.
           * Handles lifetime purchases (one-time payment) as well as recurring items.
           */
          case EventName.TransactionCompleted: {
            const data = event.data;

            const userId = data.customData?.userId;
            const plan = data.customData?.plan;

            if (!userId) {
              fastify.log.error(
                {
                  transactionId: data.id,
                },
                "transaction.completed missing customData.userId",
              );

              break;
            }

            const firstItem = data.items?.[0];
            const priceId = firstItem?.price?.id;

            const isLifetime =
              plan === "lifetime" || priceId === env.PADDLE_PRICE_ID_LIFETIME;

            if (isLifetime) {
              await setUserLifetimePlan(userId, data.customerId ?? null);

              fastify.log.info(
                {
                  userId,
                  transactionId: data.id,
                  customerId: data.customerId,
                  plan: "lifetime",
                },
                "Lifetime transaction completed and activated",
              );
            } else {
              fastify.log.info(
                {
                  userId,
                  transactionId: data.id,
                  customerId: data.customerId,
                  subscriptionId: data.subscriptionId,
                  plan,
                },
                "Paddle transaction completed",
              );
            }

            break;
          }

          /**
           * ---------------------------------------------------------
           * SUBSCRIPTION CREATED
           * ---------------------------------------------------------
           */
          case EventName.SubscriptionCreated: {
            const data = event.data;

            const userId = data.customData?.userId;
            const plan = data.customData?.plan;

            if (!userId) {
              fastify.log.error(
                {
                  subscriptionId: data.id,
                },
                "subscription.created missing customData.userId",
              );

              break;
            }

            const firstItem = data.items?.[0];

            await upsertPaddleSubscription({
              userId,
              plan,
              paddleCustomerId: data.customerId ?? null,
              paddleSubscriptionId: data.id,
              paddleTransactionId: data.transactionId ?? null,
              paddlePriceId: firstItem?.price?.id ?? null,
              status: data.status,
              currentPeriodStart: data.currentBillingPeriod?.startsAt
                ? new Date(data.currentBillingPeriod.startsAt)
                : null,
              currentPeriodEnd: data.currentBillingPeriod?.endsAt
                ? new Date(data.currentBillingPeriod.endsAt)
                : null,
            });

            fastify.log.info(
              {
                userId,
                subscriptionId: data.id,
                status: data.status,
                plan,
              },
              "Paddle subscription created and synced",
            );

            break;
          }

          /**
           * ---------------------------------------------------------
           * SUBSCRIPTION ACTIVATED
           * ---------------------------------------------------------
           */
          case EventName.SubscriptionActivated: {
            const data = event.data;

            const userId = data.customData?.userId;
            const plan = data.customData?.plan;

            if (!userId) {
              fastify.log.error(
                {
                  subscriptionId: data.id,
                },
                "subscription.activated missing customData.userId",
              );

              break;
            }

            const firstItem = data.items?.[0];

            await upsertPaddleSubscription({
              userId,
              plan,
              paddleCustomerId: data.customerId ?? null,
              paddleSubscriptionId: data.id,
              paddleTransactionId: null,
              paddlePriceId: firstItem?.price?.id ?? null,
              status: data.status,
              currentPeriodStart: data.currentBillingPeriod?.startsAt
                ? new Date(data.currentBillingPeriod.startsAt)
                : null,
              currentPeriodEnd: data.currentBillingPeriod?.endsAt
                ? new Date(data.currentBillingPeriod.endsAt)
                : null,
            });

            fastify.log.info(
              {
                userId,
                subscriptionId: data.id,
                plan,
              },
              "Paddle subscription activated",
            );

            break;
          }

          /**
           * ---------------------------------------------------------
           * SUBSCRIPTION UPDATED
           * ---------------------------------------------------------
           */
          case EventName.SubscriptionUpdated: {
            const data = event.data;

            const userId = data.customData?.userId;
            const plan = data.customData?.plan;

            if (!userId) {
              fastify.log.error(
                {
                  subscriptionId: data.id,
                },
                "subscription.updated missing customData.userId",
              );

              break;
            }

            const firstItem = data.items?.[0];

            await upsertPaddleSubscription({
              userId,
              plan,
              paddleCustomerId: data.customerId ?? null,
              paddleSubscriptionId: data.id,
              paddleTransactionId: null,
              paddlePriceId: firstItem?.price?.id ?? null,
              status: data.status,
              currentPeriodStart: data.currentBillingPeriod?.startsAt
                ? new Date(data.currentBillingPeriod.startsAt)
                : null,
              currentPeriodEnd: data.currentBillingPeriod?.endsAt
                ? new Date(data.currentBillingPeriod.endsAt)
                : null,
            });

            fastify.log.info(
              {
                userId,
                subscriptionId: data.id,
                status: data.status,
              },
              "Paddle subscription updated",
            );

            break;
          }

          /**
           * ---------------------------------------------------------
           * SUBSCRIPTION CANCELED
           * ---------------------------------------------------------
           */
          case EventName.SubscriptionCanceled: {
            const data = event.data;

            const userId = data.customData?.userId;

            if (!userId) {
              fastify.log.error(
                {
                  subscriptionId: data.id,
                },
                "subscription.canceled missing customData.userId",
              );

              break;
            }

            await revokePaddleSubscription({
              userId,
              paddleSubscriptionId: data.id,
            });

            fastify.log.info(
              {
                userId,
                subscriptionId: data.id,
              },
              "Paddle subscription canceled",
            );

            break;
          }

          default: {
            fastify.log.debug(
              {
                eventType: event.eventType,
              },
              "Unhandled Paddle webhook event",
            );
          }
        }

        return reply.status(200).send({
          received: true,
        });
      } catch (error: any) {
        fastify.log.error(
          {
            error,
            eventType: event.eventType,
            eventId: event.eventId,
          },
          "Failed to process Paddle webhook",
        );

        return reply.status(500).send({
          error: "Webhook processing failed",
        });
      }
    },
  );
};
