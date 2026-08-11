import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, subscriptions, users } from "../db/schema.js";

import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

import { ERROR_CODES } from "../config/errors.js";

export async function consumeDownload(userId: string, taskId: string) {
  return db.transaction(async (tx) => {
    // Check whether this user already consumed
    // a download for this specific Meshy task.
    const [existingDownload] = await tx
      .select()
      .from(downloads)
      .where(and(eq(downloads.userId, userId), eq(downloads.taskId, taskId)))
      .limit(1);

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    const isPro =
      subscription?.status === SUBSCRIPTION_STATUSES.ACTIVE ||
      subscription?.status === SUBSCRIPTION_STATUSES.TRIALING;

    // Duplicate request / same model already consumed.
    if (existingDownload) {
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

    // PRO
    if (isPro) {
      await tx.insert(downloads).values({
        taskId,
        userId,
      });

      return {
        allowed: true,
        duplicate: false,
        plan: "pro",
        freeDownloadsRemaining: null,
      };
    }

    // FREE
    //
    // Increment happens atomically inside SQL.

    const [updatedUser] = await tx
      .update(users)
      .set({
        freeDownloadsUsed: sql`${users.freeDownloadsUsed} + 1`,
        lastSeenAt: new Date(),
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

    // Limit reached.
    if (!updatedUser) {
      return {
        allowed: false,
        duplicate: false,
        plan: "free",
        error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
        freeDownloadsRemaining: 0,
      };
    }

    // Record successful consumption.
    await tx.insert(downloads).values({
      taskId,
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
