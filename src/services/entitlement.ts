import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { installations, subscriptions, users } from "../db/schema.js";
import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

export async function getUserById(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isPaid: users.isPaid,
      freeDownloadsUsed: users.freeDownloadsUsed,
      paddleCustomerId: users.paddleCustomerId,
      paddleSubscriptionId: users.paddleSubscriptionId,
      paidAt: users.paidAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function getUserByInstallationId(installationId: string) {
  const [result] = await db
    .select({
      id: users.id,
      email: users.email,
      isPaid: users.isPaid,
      freeDownloadsUsed: users.freeDownloadsUsed,
      paddleCustomerId: users.paddleCustomerId,
      paddleSubscriptionId: users.paddleSubscriptionId,
      paidAt: users.paidAt,
    })
    .from(installations)
    .innerJoin(users, eq(installations.userId, users.id))
    .where(eq(installations.installationId, installationId))
    .limit(1);

  return result ?? null;
}

export async function getUserSubscription(userId: string) {
  const [subscription] = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      status: subscriptions.status,
      paddleCustomerId: subscriptions.paddleCustomerId,
      paddleSubscriptionId: subscriptions.paddleSubscriptionId,
      paddleTransactionId: subscriptions.paddleTransactionId,
      paddlePriceId: subscriptions.paddlePriceId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return subscription ?? null;
}

/**
 * Single round-trip field-projected query for user and subscription details.
 */
export async function getUserAndSubscription(query: {
  userId?: string;
  installationId?: string;
}) {
  const { userId, installationId } = query;

  const selectFields = {
    id: users.id,
    email: users.email,
    isPaid: users.isPaid,
    freeDownloadsUsed: users.freeDownloadsUsed,
    paddleCustomerId: users.paddleCustomerId,
    paddleSubscriptionId: users.paddleSubscriptionId,
    paidAt: users.paidAt,
    subStatus: subscriptions.status,
    subPaddleCustomerId: subscriptions.paddleCustomerId,
    subPaddleSubscriptionId: subscriptions.paddleSubscriptionId,
  };

  if (userId) {
    const [result] = await db
      .select(selectFields)
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    return result ?? null;
  }

  if (installationId) {
    const [result] = await db
      .select(selectFields)
      .from(installations)
      .innerJoin(users, eq(installations.userId, users.id))
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(installations.installationId, installationId))
      .limit(1);

    return result ?? null;
  }

  return null;
}

export function isProSubscription(status?: string | null, isPaid?: boolean) {
  return (
    isPaid === true ||
    status === "active" ||
    status === SUBSCRIPTION_STATUSES.ACTIVE
  );
}

export function getFreeDownloadsRemaining(freeDownloadsUsed: number) {
  return Math.max(0, FREE_DOWNLOAD_LIMIT - freeDownloadsUsed);
}

export {
  upsertPaddleSubscription,
  revokePaddleSubscription,
} from "./subscription.js";
