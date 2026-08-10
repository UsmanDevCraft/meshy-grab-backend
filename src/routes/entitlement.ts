import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { users, subscriptions } from "../db/schema.js";

export async function entitlementRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      installationId: string;
    };
  }>("/entitlement", async (request, reply) => {
    const { installationId } = request.query;

    if (!installationId) {
      return reply.code(400).send({
        error: "installationId is required",
      });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.installationId, installationId))
      .limit(1);

    if (!user) {
      return {
        exists: false,
        plan: "free",
        freeDownloadsUsed: 0,
        freeDownloadsRemaining: 2,
      };
    }

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id))
      .limit(1);

    const isPro =
      subscription?.status === "active" || subscription?.status === "trialing";

    return {
      exists: true,
      plan: isPro ? "pro" : "free",
      freeDownloadsUsed: user.freeDownloadsUsed,
      freeDownloadsRemaining: isPro
        ? null
        : Math.max(0, 2 - user.freeDownloadsUsed),
      subscriptionStatus: subscription?.status ?? "inactive",
    };
  });
}
