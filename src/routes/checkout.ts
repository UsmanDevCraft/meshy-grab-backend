import { FastifyInstance } from "fastify";
import { creem } from "../lib/creem.js";
import { env } from "../config/env.js";

interface CheckoutRequestBody {
  productId?: string;
  userId: string;
  email: string;
}

export async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Body: CheckoutRequestBody }>(
    "/api/checkout",
    async (req, reply) => {
      const { productId, userId, email } = req.body || {};

      if (!userId || !email) {
        return reply.status(400).send({
          error: "Missing required fields: userId and email are required",
        });
      }

      req.log.info(
        `[Checkout Debug] Creating CREEM checkout session for userId: ${userId}, email: ${email}`,
      );

      try {
        // Create checkout session via CREEM SDK with metadata
        const checkout = await creem.checkouts.create({
          productId: productId || env.CREEM_PRODUCT_ID,
          successUrl: `${env.FRONTEND_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
          customer: {
            email: email,
          },
          metadata: {
            userId: userId, // Pass internal user ID to map webhook back to user
          },
        });

        req.log.info(
          `[Checkout Debug] CREEM checkout session created successfully for userId: ${userId}`,
        );

        return reply.send({ checkoutUrl: checkout.checkoutUrl });
      } catch (error) {
        req.log.error(error, "Failed to create CREEM checkout session");
        return reply
          .status(500)
          .send({ error: "Could not create checkout session" });
      }
    },
  );
}
