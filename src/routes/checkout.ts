import { FastifyInstance } from "fastify";
import { creem } from "../lib/creem.js";

interface CheckoutRequestBody {
  productId: string;
  userId: string;
  email: string;
}

export async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Body: CheckoutRequestBody }>(
    "/api/checkout",
    async (req, reply) => {
      const { productId, userId, email } = req.body;

      try {
        // Create checkout session via CREEM SDK
        const checkout = await creem.checkouts.create({
          productId: productId || process.env.CREEM_PRODUCT_ID!,
          successUrl: `${process.env.FRONTEND_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
          customer: {
            email: email,
          },
          metadata: {
            userId: userId, // Pass internal user ID to map webhook back to user
          },
        });

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
