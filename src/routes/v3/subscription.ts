import { FastifyInstance } from "fastify";
import {
  CancellationError,
  generateSubscriptionCancellationUrl,
} from "../../services/subscription.js";
import {
  cancelSubscriptionBodySchema,
  cancelSubscriptionQuerySchema,
  cancelSubscriptionResponseSchema,
} from "../../schemas/subscription.js";

interface CancelSubscriptionInput {
  email?: string;
  installationId?: string;
  userId?: string;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  const cancelHandler = async (request: any, reply: any) => {
    const body = (request.body || {}) as CancelSubscriptionInput;
    const query = (request.query || {}) as CancelSubscriptionInput;

    const email = body.email || query.email;
    const installationId = body.installationId || query.installationId;
    const userId = body.userId || query.userId;
    const providedCustomerId = body.paddleCustomerId || query.paddleCustomerId;
    const providedSubscriptionId =
      body.paddleSubscriptionId || query.paddleSubscriptionId;

    try {
      /**
       * Note: email + installation ID are additional matching checks, not proof of
       * authentication. Server-side account verification and database records are strictly enforced.
       */
      const result = await generateSubscriptionCancellationUrl({
        email,
        installationId,
        userId,
        providedCustomerId,
        providedSubscriptionId,
      });

      return reply.code(200).send(result);
    } catch (error: any) {
      if (error instanceof CancellationError) {
        return reply.code(error.statusCode).send({
          error: error.code,
          message: error.message,
        });
      }

      app.log.error(
        error,
        "Unexpected error while generating Paddle cancellation URL",
      );
      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected error occurred while generating cancellation URL.",
      });
    }
  };

  const postRouteOptions = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    preValidation: async (request: any) => {
      if (request.body && typeof request.body.email === "string") {
        request.body.email = request.body.email.trim();
      }
      if (request.body && typeof request.body.installationId === "string") {
        request.body.installationId = request.body.installationId.trim();
      }
    },
    schema: {
      querystring: cancelSubscriptionQuerySchema,
      body: cancelSubscriptionBodySchema,
      response: cancelSubscriptionResponseSchema,
    },
  };

  const getRouteOptions = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      querystring: cancelSubscriptionQuerySchema,
      response: cancelSubscriptionResponseSchema,
    },
  };

  // Primary endpoint: POST /v3/subscription/cancel
  app.post("/subscription/cancel", postRouteOptions, cancelHandler);

  // Aliases for convenience and compatibility
  app.post("/subscriptions/cancel", postRouteOptions, cancelHandler);
  app.post("/subscription/cancel-url", postRouteOptions, cancelHandler);
  app.post("/subscription/cancel-portal", postRouteOptions, cancelHandler);
  app.get("/subscription/cancel", getRouteOptions, cancelHandler);
  app.get("/subscriptions/cancel", getRouteOptions, cancelHandler);
}
