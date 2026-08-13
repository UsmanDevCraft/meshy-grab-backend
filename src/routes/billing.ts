import { FastifyInstance } from "fastify";

import { createCheckoutSessionBodySchema } from "../schemas/billing.js";
import { createCheckoutSession } from "../services/billing.js";

export async function billingRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      installationId: string;
    };
  }>(
    "/billing/checkout",
    {
      schema: {
        body: createCheckoutSessionBodySchema,
      },
    },
    async (request, reply) => {
      const { installationId } = request.body;

      const result = await createCheckoutSession(installationId);

      if (!result.success) {
        return reply.code(404).send({
          error: result.error,
          message: "Installation not found",
        });
      }

      return {
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
      };
    },
  );
}
