import { FastifyInstance } from "fastify";
import { and, eq, lt } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, users } from "../db/schema.js";

import { FREE_DOWNLOAD_LIMIT } from "../config/constants.js";

import {
  getUserByInstallationId,
  getUserSubscription,
  isProSubscription,
} from "../services/entitlement.js";

export async function downloadRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      installationId: string;
      downloadId: string;
    };
  }>("/downloads/consume", async (request, reply) => {
    const { installationId, downloadId } = request.body;

    if (!installationId) {
      return reply.code(400).send({
        error: "installationId is required",
      });
    }

    if (!downloadId) {
      return reply.code(400).send({
        error: "downloadId is required",
      });
    }

    const user = await getUserByInstallationId(installationId);

    if (!user) {
      return reply.code(404).send({
        error: "INSTALLATION_NOT_FOUND",
      });
    }

    // 1. Check whether this download was already
    //    processed.

    const [existingDownload] = await db
      .select()
      .from(downloads)
      .where(eq(downloads.downloadId, downloadId))
      .limit(1);

    if (existingDownload) {
      const subscription = await getUserSubscription(user.id);

      const isPro = isProSubscription(subscription?.status);

      return {
        allowed: true,
        duplicate: true,
        plan: isPro ? "pro" : "free",
        freeDownloadsUsed: user.freeDownloadsUsed,
        freeDownloadsRemaining: isPro
          ? null
          : Math.max(0, FREE_DOWNLOAD_LIMIT - user.freeDownloadsUsed),
      };
    }

    // 2. Check subscription

    const subscription = await getUserSubscription(user.id);

    const isPro = isProSubscription(subscription?.status);

    // 3. PRO = unlimited

    if (isPro) {
      await db.insert(downloads).values({
        downloadId,
        userId: user.id,
      });

      return {
        allowed: true,
        duplicate: false,
        plan: "pro",
        freeDownloadsRemaining: null,
      };
    }

    // 4. FREE = atomically consume one download

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

    // 5. Limit reached

    if (!updatedUser) {
      return reply.code(403).send({
        allowed: false,
        plan: "free",
        error: "FREE_DOWNLOAD_LIMIT_REACHED",
        freeDownloadsRemaining: 0,
      });
    }

    // 6. Record successful consumption

    await db.insert(downloads).values({
      downloadId,
      userId: user.id,
    });

    return {
      allowed: true,
      duplicate: false,
      plan: "free",
      freeDownloadsUsed: updatedUser.freeDownloadsUsed,

      freeDownloadsRemaining:
        FREE_DOWNLOAD_LIMIT - updatedUser.freeDownloadsUsed,
    };
  });
}
