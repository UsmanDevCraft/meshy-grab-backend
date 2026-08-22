import { FastifyInstance } from "fastify";
import { FREE_DOWNLOAD_LIMIT } from "../config/constants.js";

import {
  getFreeDownloadsRemaining,
  getUserAndSubscription,
  isProSubscription,
} from "../services/entitlement.js";
import {
  entitlementQuerySchema,
  entitlementResponseSchema,
} from "../schemas/entitlement.js";

interface EntitlementQuery {
  installationId?: string;
  userId?: string;
}

async function handleEntitlementStatus(query: EntitlementQuery) {
  const { installationId, userId } = query;

  if (!installationId && !userId) {
    return {
      error: "installationId or userId is required",
      statusCode: 400,
    };
  }

  const user = await getUserAndSubscription({ userId, installationId });

  if (!user) {
    return {
      statusCode: 200,
      body: {
        exists: false,
        isPaid: false,
        plan: "free",
        freeDownloadsUsed: 0,
        freeDownloadsRemaining: FREE_DOWNLOAD_LIMIT,
        subscriptionStatus: "inactive",
        paddleCustomerId: null,
        paddleSubscriptionId: null,
        paidAt: null,
      },
    };
  }

  const isPro = user.isPaid || isProSubscription(user.subStatus, user.isPaid);

  return {
    statusCode: 200,
    body: {
      exists: true,
      userId: user.id,
      email: user.email,
      isPaid: user.isPaid ?? false,
      plan: isPro ? "pro" : "free",
      freeDownloadsUsed: user.freeDownloadsUsed,
      freeDownloadsRemaining: isPro
        ? null
        : getFreeDownloadsRemaining(user.freeDownloadsUsed),
      subscriptionStatus:
        user.subStatus ?? (user.isPaid ? "active" : "inactive"),
      paddleCustomerId:
        user.paddleCustomerId ?? user.subPaddleCustomerId ?? null,
      paddleSubscriptionId:
        user.paddleSubscriptionId ?? user.subPaddleSubscriptionId ?? null,
      paidAt: user.paidAt ? user.paidAt.toISOString() : null,
    },
  };
}

export async function entitlementRoutes(app: FastifyInstance) {
  // GET /entitlement
  app.get<{ Querystring: EntitlementQuery }>(
    "/entitlement",
    {
      schema: {
        querystring: entitlementQuerySchema,
        response: entitlementResponseSchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {});
      if (result.error) {
        return reply.code(result.statusCode).send({ error: result.error });
      }
      return reply.code(result.statusCode).send(result.body);
    },
  );

  // GET /api/user/status
  app.get<{ Querystring: EntitlementQuery }>(
    "/api/user/status",
    {
      schema: {
        querystring: entitlementQuerySchema,
        response: entitlementResponseSchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {});
      if (result.error) {
        return reply.code(result.statusCode).send({ error: result.error });
      }
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
