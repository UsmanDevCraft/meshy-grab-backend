import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, models, subscriptions, users } from "../db/schema.js";

import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

import { ERROR_CODES } from "../config/errors.js";

export function normalizeDownloadType(type?: string | null): string {
  if (!type || !type.trim()) {
    return "glb";
  }
  return type.trim().toLowerCase();
}

export async function consumeDownload(
  userId: string,
  taskId: string,
  previewUrl?: string | null,
  modelUrl?: string | null,
  downloadType?: string | null,
) {
  const modelKey = taskId;
  const normalizedType = normalizeDownloadType(downloadType);

  return await db.transaction(async (tx) => {
    // 1. Single round-trip field-projected query for user & subscription entitlement status
    const [userWithSub] = await tx
      .select({
        id: users.id,
        isPaid: users.isPaid,
        plan: users.plan,
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

    // 2. Ensure canonical model record exists (one row per model per user)
    const [modelRecord] = await tx
      .insert(models)
      .values({
        userId,
        modelKey,
        previewUrl: previewUrl ?? null,
        modelUrl: modelUrl ?? null,
      })
      .onConflictDoUpdate({
        target: [models.userId, models.modelKey],
        set: {
          updatedAt: new Date(),
        },
      })
      .returning({ id: models.id });

    const modelId = modelRecord.id;

    // 3. Check if (modelId, normalizedType) already exists in downloads
    const [existingDownload] = await tx
      .select({ id: downloads.id })
      .from(downloads)
      .where(
        and(
          eq(downloads.modelId, modelId),
          eq(downloads.downloadType, normalizedType),
        ),
      )
      .limit(1);

    if (existingDownload) {
      // Format already downloaded for this model -> duplicate, consumes 0 exports
      return {
        allowed: true,
        duplicate: true,
        plan: isPro ? "pro" : "free",
        freeDownloadsUsed: isPro ? null : userWithSub.freeDownloadsUsed,
        freeDownloadsRemaining: isPro
          ? null
          : Math.max(0, FREE_DOWNLOAD_LIMIT - userWithSub.freeDownloadsUsed),
      };
    }

    // 4. PRO Plan User: unlimited entitlement
    if (isPro) {
      await tx
        .insert(downloads)
        .values({
          userId,
          modelId,
          downloadType: normalizedType,
        })
        .onConflictDoNothing();

      return {
        allowed: true,
        duplicate: false,
        plan: "pro",
        freeDownloadsUsed: null,
        freeDownloadsRemaining: null,
      };
    }

    // 5. FREE Plan User: Quota check
    if (userWithSub.freeDownloadsUsed >= FREE_DOWNLOAD_LIMIT) {
      return {
        allowed: false,
        duplicate: false,
        plan: "free",
        error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
        freeDownloadsRemaining: 0,
      };
    }

    // Atomic insert of format download record with DB unique constraint conflict handling
    const [insertedDownload] = await tx
      .insert(downloads)
      .values({
        userId,
        modelId,
        downloadType: normalizedType,
      })
      .onConflictDoNothing()
      .returning({ id: downloads.id });

    if (!insertedDownload) {
      // Concurrent request inserted exact same (modelId, normalizedType) first -> duplicate!
      const [currentUser] = await tx
        .select({ freeDownloadsUsed: users.freeDownloadsUsed })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const currentUsed =
        currentUser?.freeDownloadsUsed ?? userWithSub.freeDownloadsUsed;

      return {
        allowed: true,
        duplicate: true,
        plan: "free",
        freeDownloadsUsed: currentUsed,
        freeDownloadsRemaining: Math.max(0, FREE_DOWNLOAD_LIMIT - currentUsed),
      };
    }

    // Atomic free export quota increment
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

    if (!updatedUser) {
      // Quota reached concurrently: delete inserted format download record
      await tx.delete(downloads).where(eq(downloads.id, insertedDownload.id));

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
      freeDownloadsRemaining:
        FREE_DOWNLOAD_LIMIT - updatedUser.freeDownloadsUsed,
    };
  });
}
