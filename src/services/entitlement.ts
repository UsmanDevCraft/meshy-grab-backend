import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { installations, subscriptions, users } from "../db/schema.js";
import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

export async function getUserByInstallationId(installationId: string) {
  const [result] = await db
    .select({ user: users })
    .from(installations)
    .innerJoin(users, eq(installations.userId, users.id))
    .where(eq(installations.installationId, installationId))
    .limit(1);

  return result?.user ?? null;
}

export async function getUserSubscription(userId: string) {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return subscription ?? null;
}

export function isProSubscription(status: string | undefined) {
  return (
    status === SUBSCRIPTION_STATUSES.ACTIVE ||
    status === SUBSCRIPTION_STATUSES.TRIALING
  );
}

export function getFreeDownloadsRemaining(freeDownloadsUsed: number) {
  return Math.max(0, FREE_DOWNLOAD_LIMIT - freeDownloadsUsed);
}
