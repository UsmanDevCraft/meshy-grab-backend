import { FastifyInstance } from "fastify";
import { and, eq, lt } from "drizzle-orm";

import { db } from "../db/client.js";
import { users, subscriptions } from "../db/schema.js";
import { env } from "../config/env.js";

const FREE_DOWNLOAD_LIMIT = env.FREE_DOWNLOAD_LIMIT;

export async function downloadRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      installationId: string;
    };
  }>("/downloads/consume", async (request, reply) => {
    const { installationId } = request.body;

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
      return reply.code(404).send({
        error: "Installation not found",
      });
    }

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id))
      .limit(1);

    const isPro =
      subscription?.status === "active" || subscription?.status === "trialing";

    // Pro users have unlimited downloads.
    if (isPro) {
      return {
        allowed: true,
        plan: "pro",
        freeDownloadsRemaining: null,
      };
    }

    // Atomically increment only if the user
    // still has a free download available.
    const [updatedUser] = await db
      .update(users)
      .set({
        freeDownloadsUsed: user.freeDownloadsUsed + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, user.id),
          lt(users.freeDownloadsUsed, FREE_DOWNLOAD_LIMIT),
        ),
      )
      .returning({
        freeDownloadsUsed: users.freeDownloadsUsed,
      });

    if (!updatedUser) {
      return reply.code(403).send({
        allowed: false,
        plan: "free",
        error: "FREE_DOWNLOAD_LIMIT_REACHED",
        freeDownloadsRemaining: 0,
      });
    }

    return {
      allowed: true,
      plan: "free",
      freeDownloadsUsed: updatedUser.freeDownloadsUsed,
      freeDownloadsRemaining:
        FREE_DOWNLOAD_LIMIT - updatedUser.freeDownloadsUsed,
    };
  });
}
