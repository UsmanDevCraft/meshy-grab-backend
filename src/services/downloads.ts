import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { downloads, models, subscriptions, users } from "../db/schema.js";

import {
  FREE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";

import { ERROR_CODES } from "../config/errors.js";
import { getCommunityEntitlement, normalizeSource } from "./community.js";

export function normalizeDownloadType(type?: string | null): string {
  if (!type || !type.trim()) {
    return "glb";
  }
  return type.trim().toLowerCase();
}

export async function consumeDownload(
  userId: string,
  taskId?: string | null,
  previewUrl?: string | null,
  modelUrl?: string | null,
  downloadType?: string | null,
  sourceRaw?: string | null,
  modelKeyRaw?: string | null,
) {
  const source = normalizeSource(sourceRaw);
  const modelKey = (
    modelKeyRaw?.trim() ||
    taskId?.trim() ||
    modelUrl?.trim() ||
    previewUrl?.trim() ||
    "community-model"
  ).slice(0, 128);
  const normalizedType = normalizeDownloadType(downloadType);

  if (source === "community") {
    return await db.transaction(async (tx) => {
      // 1. Fetch user & subscription entitlement status
      const [userWithSub] = await tx
        .select({
          id: users.id,
          isPaid: users.isPaid,
          plan: users.plan,
          subPlan: subscriptions.plan,
          subStatus: subscriptions.status,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);

      if (!userWithSub) {
        throw new Error("USER_NOT_FOUND");
      }

      // Compute current Community entitlement status based on plan rules
      const entitlement = await getCommunityEntitlement(userWithSub, tx);

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

      // 3. Check if user already unlocked this Community model
      const [existingCommunityDownload] = await tx
        .select({ id: downloads.id })
        .from(downloads)
        .where(
          and(
            eq(downloads.modelId, modelId),
            eq(downloads.source, "community"),
          ),
        )
        .limit(1);

      const modelAlreadyUnlocked = !!existingCommunityDownload;

      // 4. Check if exact format download record already exists
      const [existingFormatDownload] = await tx
        .select({ id: downloads.id })
        .from(downloads)
        .where(
          and(
            eq(downloads.modelId, modelId),
            eq(downloads.downloadType, normalizedType),
          ),
        )
        .limit(1);

      if (modelAlreadyUnlocked) {
        // Additional format or re-download of an already unlocked Community model consumes 0 new entitlement
        if (!existingFormatDownload) {
          await tx
            .insert(downloads)
            .values({
              userId,
              modelId,
              downloadType: normalizedType,
              source: "community",
            })
            .onConflictDoNothing();
        }

        return {
          allowed: true,
          duplicate: !!existingFormatDownload,
          plan: entitlement.plan,
          source: "community",
          freeDownloadsUsed: null,
          freeDownloadsRemaining: null,
          communityModelsUsed: entitlement.communityModelsUsed,
          communityModelsRemaining: entitlement.communityModelsRemaining,
          communityModelsLimit: entitlement.communityModelsLimit,
        };
      }

      // FIRST format download for a NEW Community model
      // Check quota limit
      if (
        entitlement.communityModelsLimit !== null &&
        entitlement.communityModelsUsed >= entitlement.communityModelsLimit
      ) {
        return {
          allowed: false,
          duplicate: false,
          plan: entitlement.plan,
          source: "community",
          error: "COMMUNITY_DOWNLOAD_LIMIT_REACHED",
          freeDownloadsRemaining: null,
          communityModelsUsed: entitlement.communityModelsUsed,
          communityModelsRemaining: 0,
          communityModelsLimit: entitlement.communityModelsLimit,
        };
      }

      // Quota is available: insert format download record with source = "community"
      await tx
        .insert(downloads)
        .values({
          userId,
          modelId,
          downloadType: normalizedType,
          source: "community",
        })
        .onConflictDoNothing();

      const updatedUsed = entitlement.communityModelsUsed + 1;
      const updatedRemaining =
        entitlement.communityModelsLimit === null
          ? null
          : Math.max(0, entitlement.communityModelsLimit - updatedUsed);

      return {
        allowed: true,
        duplicate: false,
        plan: entitlement.plan,
        source: "community",
        freeDownloadsUsed: null,
        freeDownloadsRemaining: null,
        communityModelsUsed: updatedUsed,
        communityModelsRemaining: updatedRemaining,
        communityModelsLimit: entitlement.communityModelsLimit,
      };
    });
  }

  // Workspace download logic (source = "workspace")
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
        source: "workspace",
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
          source: "workspace",
        })
        .onConflictDoNothing();

      return {
        allowed: true,
        duplicate: false,
        plan: "pro",
        source: "workspace",
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
        source: "workspace",
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
        source: "workspace",
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
        source: "workspace",
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
        source: "workspace",
        error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
        freeDownloadsRemaining: 0,
      };
    }

    return {
      allowed: true,
      duplicate: false,
      plan: "free",
      source: "workspace",
      freeDownloadsUsed: updatedUser.freeDownloadsUsed,
      freeDownloadsRemaining:
        FREE_DOWNLOAD_LIMIT - updatedUser.freeDownloadsUsed,
    };
  });
}
