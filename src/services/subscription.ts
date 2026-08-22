import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";

export interface UpsertPaddleSubscriptionParams {
  userId: string;
  paddleCustomerId?: string | null;
  paddleSubscriptionId?: string | null;
  paddleTransactionId?: string | null;
  paddlePriceId?: string | null;
  status: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}

export async function upsertPaddleSubscription(
  params: UpsertPaddleSubscriptionParams,
) {
  const {
    userId,
    paddleCustomerId,
    paddleSubscriptionId,
    paddleTransactionId,
    paddlePriceId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
  } = params;

  const now = new Date();
  const isActive = status === "active";

  // 1. Upsert subscription record in subscriptions table by userId
  await db
    .insert(subscriptions)
    .values({
      userId,
      paddleCustomerId: paddleCustomerId ?? null,
      paddleSubscriptionId: paddleSubscriptionId ?? null,
      paddleTransactionId: paddleTransactionId ?? null,
      paddlePriceId: paddlePriceId ?? null,
      status,
      currentPeriodStart: currentPeriodStart ?? null,
      currentPeriodEnd: currentPeriodEnd ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        paddleCustomerId: paddleCustomerId ?? undefined,
        paddleSubscriptionId: paddleSubscriptionId ?? undefined,
        paddleTransactionId: paddleTransactionId ?? undefined,
        paddlePriceId: paddlePriceId ?? undefined,
        status,
        currentPeriodStart: currentPeriodStart ?? undefined,
        currentPeriodEnd: currentPeriodEnd ?? undefined,
        updatedAt: now,
      },
    });

  // 2. Update user status in users table
  await db
    .update(users)
    .set({
      isPaid: isActive,
      paddleCustomerId: paddleCustomerId ?? undefined,
      paddleSubscriptionId: paddleSubscriptionId ?? undefined,
      paidAt: isActive ? now : undefined,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

export interface RevokePaddleSubscriptionParams {
  userId: string;
  paddleSubscriptionId?: string | null;
}

export async function revokePaddleSubscription(
  params: RevokePaddleSubscriptionParams,
) {
  const { userId, paddleSubscriptionId } = params;
  const now = new Date();

  if (paddleSubscriptionId) {
    await db
      .update(subscriptions)
      .set({
        status: "canceled",
        updatedAt: now,
      })
      .where(eq(subscriptions.paddleSubscriptionId, paddleSubscriptionId));
  } else {
    await db
      .update(subscriptions)
      .set({
        status: "canceled",
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, userId));
  }

  await db
    .update(users)
    .set({
      isPaid: false,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}
