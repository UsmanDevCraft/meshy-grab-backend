import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";

import {
  FREE_TEXTURE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

import { ERROR_CODES } from "../config/errors.js";

export async function consumeTexture(userId: string) {
  // 1. Fetch user & subscription entitlement status
  const [userWithSub] = await db
    .select({
      id: users.id,
      isPaid: users.isPaid,
      textureDownloadsUsed: users.textureDownloadsUsed,
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

  // PRO plan: unlimited textures, counter is NOT decremented
  if (isPro) {
    return {
      allowed: true,
      duplicate: false,
      plan: "pro",
      textureDownloadsRemaining: null,
    };
  }

  // FREE plan quota check
  if (userWithSub.textureDownloadsUsed >= FREE_TEXTURE_DOWNLOAD_LIMIT) {
    return {
      allowed: false,
      duplicate: false,
      plan: "free",
      error: ERROR_CODES.FREE_TEXTURE_DOWNLOAD_LIMIT_REACHED,
      textureDownloadsRemaining: 0,
    };
  }

  // Atomic texture quota increment
  const [updatedUser] = await db
    .update(users)
    .set({
      textureDownloadsUsed: sql`${users.textureDownloadsUsed} + 1`,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        lt(users.textureDownloadsUsed, FREE_TEXTURE_DOWNLOAD_LIMIT),
      ),
    )
    .returning({
      textureDownloadsUsed: users.textureDownloadsUsed,
    });

  if (!updatedUser) {
    return {
      allowed: false,
      duplicate: false,
      plan: "free",
      error: ERROR_CODES.FREE_TEXTURE_DOWNLOAD_LIMIT_REACHED,
      textureDownloadsRemaining: 0,
    };
  }

  return {
    allowed: true,
    duplicate: false,
    plan: "free",
    textureDownloadsUsed: updatedUser.textureDownloadsUsed,
    textureDownloadsRemaining:
      FREE_TEXTURE_DOWNLOAD_LIMIT - updatedUser.textureDownloadsUsed,
  };
}
