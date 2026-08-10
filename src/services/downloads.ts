import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, users } from "../db/schema.js";

import { FREE_DOWNLOAD_LIMIT } from "../config/constants.js";

import { getUserSubscription, isProSubscription } from "./entitlement.js";

export async function consumeDownload(userId: string, downloadId: string) {
  return db.transaction(async (tx) => {
    const [existingDownload] = await tx
      .select()
      .from(downloads)
      .where(eq(downloads.downloadId, downloadId))
      .limit(1);

    if (existingDownload) {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      const subscription = await getUserSubscription(userId);

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

    const subscription = await getUserSubscription(userId);

    const isPro = isProSubscription(subscription?.status);

    if (isPro) {
      await tx.insert(downloads).values({
        downloadId,
        userId,
      });

      return {
        allowed: true,
        duplicate: false,
        plan: "pro",
        freeDownloadsRemaining: null,
      };
    }

    const [updatedUser] = await tx
      .update(users)
      .set({
        freeDownloadsUsed: sql`${users.freeDownloadsUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, userId),
          lt(users.freeDownloadsUsed, FREE_DOWNLOAD_LIMIT),
        ),
      )
      .returning({
        freeDownloadsUsed: users.freeDownloadsUsed,
      });

    if (!updatedUser) {
      return {
        allowed: false,
        duplicate: false,
        plan: "free",
        error: "FREE_DOWNLOAD_LIMIT_REACHED",
        freeDownloadsRemaining: 0,
      };
    }

    await tx.insert(downloads).values({
      downloadId,
      userId,
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
