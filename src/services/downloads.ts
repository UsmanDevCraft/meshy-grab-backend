import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, subscriptions, users } from "../db/schema.js";

import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

import { ERROR_CODES } from "../config/errors.js";

export async function consumeDownload(
  userId: string,
  taskId: string,
  previewUrl?: string | null,
  modelUrl?: string | null,
) {
  // 1. Single round-trip field-projected query for user & subscription entitlement status
  const [userWithSub] = await db
    .select({
      id: users.id,
      isPaid: users.isPaid,
      freeDownloadsUsed: users.freeDownloadsUsed,
      subStatus: subscriptions.status,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!userWithSub) {
    throw new Error("USER_NOT_FOUND");
  }

  const isPro =
    userWithSub.isPaid === true ||
    userWithSub.subStatus === SUBSCRIPTION_STATUSES.ACTIVE ||
    userWithSub.subStatus === SUBSCRIPTION_STATUSES.TRIALING;

  // 2. Single-statement atomic insert with onConflictDoNothing
  const [downloadRecord] = await db
    .insert(downloads)
    .values({
      taskId,
      userId,
      previewUrl: previewUrl ?? null,
      modelUrl: modelUrl ?? null,
    })
    .onConflictDoNothing({
      target: [downloads.userId, downloads.taskId],
    })
    .returning();

  const isDuplicate = !downloadRecord;

  // Duplicate request
  if (isDuplicate) {
    return {
      allowed: true,
      duplicate: true,
      plan: isPro ? "pro" : "free",
      freeDownloadsUsed: userWithSub.freeDownloadsUsed,
      freeDownloadsRemaining: isPro
        ? null
        : Math.max(0, FREE_DOWNLOAD_LIMIT - userWithSub.freeDownloadsUsed),
    };
  }

  // PRO plan
  if (isPro) {
    return {
      allowed: true,
      duplicate: false,
      plan: "pro",
      freeDownloadsRemaining: null,
    };
  }

  // FREE plan quota check
  if (userWithSub.freeDownloadsUsed >= FREE_DOWNLOAD_LIMIT) {
    // Delete newly created download record if quota exceeded
    await db
      .delete(downloads)
      .where(and(eq(downloads.userId, userId), eq(downloads.taskId, taskId)));

    return {
      allowed: false,
      duplicate: false,
      plan: "free",
      error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
      freeDownloadsRemaining: 0,
    };
  }

  // Atomic quota increment
  const [updatedUser] = await db
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

  if (!updatedUser) {
    await db
      .delete(downloads)
      .where(and(eq(downloads.userId, userId), eq(downloads.taskId, taskId)));

    return {
      allowed: false,
      duplicate: false,
      plan: "free",
      error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
      freeDownloadsRemaining: 0,
    };
  }

  return {
    allowed: true,
    duplicate: false,
    plan: "free",
    freeDownloadsUsed: updatedUser.freeDownloadsUsed,
    freeDownloadsRemaining: FREE_DOWNLOAD_LIMIT - updatedUser.freeDownloadsUsed,
  };
}
