import { FastifyInstance } from "fastify";
import { FREE_DOWNLOAD_LIMIT } from "../config/constants.js";

import {
  getFreeDownloadsRemaining,
  getUserByInstallationId,
  getUserSubscription,
  isProSubscription,
} from "../services/entitlement.js";
import { entitlementQuerySchema } from "../schemas/entitlement.js";

export async function entitlementRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      installationId: string;
    };
  }>(
    "/entitlement",
    {
      schema: {
        querystring: entitlementQuerySchema,
      },
    },
    async (request, reply) => {
      const { installationId } = request.query;

      if (!installationId) {
        return reply.code(400).send({
          error: "installationId is required",
        });
      }

      const user = await getUserByInstallationId(installationId);

      if (!user) {
        return {
          exists: false,
          plan: "free",
          freeDownloadsUsed: 0,
          freeDownloadsRemaining: FREE_DOWNLOAD_LIMIT,
          subscriptionStatus: "inactive",
        };
      }

      const subscription = await getUserSubscription(user.id);

      const isPro = isProSubscription(subscription?.status);

      return {
        exists: true,

        plan: isPro ? "pro" : "free",

        freeDownloadsUsed: user.freeDownloadsUsed,

        freeDownloadsRemaining: isPro
          ? null
          : getFreeDownloadsRemaining(user.freeDownloadsUsed),

        subscriptionStatus: subscription?.status ?? "inactive",
      };
    },
  );
}
