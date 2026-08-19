import { FastifyInstance } from "fastify";
import { verifyWebhookSignature } from "creem/webhooks";
import { env } from "../config/env.js";

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
        event = verifyWebhookSignature(
          rawBody,
          {
            "creem-signature": signature,
          },
          env.CREEM_WEBHOOK_SECRET,
        );
      } catch (err) {
        req.log.error(err, "CREEM Webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      switch (event.type) {
        case "checkout.completed": {
          const session = event.data;
          const userId = session?.metadata?.userId;

          if (userId) {
            req.log.info(`Payment succeeded for user ${userId}`);
            // TODO: Update user state in DB (e.g. set plan active)
          } else {
            req.log.warn(
              "checkout.completed received without userId in metadata",
            );
          }
          break;
        }

        case "subscription.canceled": {
          const subscription = event.data;
          const customerId = subscription?.customerId;

          req.log.info(`Subscription canceled for customer ${customerId}`);
          // TODO: Revoke access in DB
          break;
        }

        default:
          req.log.info(`Unhandled event type: ${event.type}`);
      }

      return reply.status(200).send({ received: true });
    },
  );
}
