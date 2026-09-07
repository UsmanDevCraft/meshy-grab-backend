import { eq } from "drizzle-orm";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";
import { Plan } from "../types/plan.js";

export interface UpsertPaddleSubscriptionParams {
  userId: string;
  plan?: string | null;
  paddleCustomerId?: string | null;
  paddleSubscriptionId?: string | null;
  paddleTransactionId?: string | null;
  paddlePriceId?: string | null;
  status: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}

export function resolvePlanFromPriceOrCustomData(
  customDataPlan?: string | null,
  paddlePriceId?: string | null,
): Plan {
  if (
    customDataPlan === "pro_monthly" ||
    customDataPlan === "pro_annual" ||
    customDataPlan === "lifetime"
  ) {
    return customDataPlan;
  }

  if (paddlePriceId) {
    if (paddlePriceId === env.PADDLE_PRICE_ID_MONTHLY) {
      return "pro_monthly";
    }
    if (paddlePriceId === env.PADDLE_PRICE_ID_ANNUALLY) {
      return "pro_annual";
    }
    if (paddlePriceId === env.PADDLE_PRICE_ID_LIFETIME) {
      return "lifetime";
    }
  }

  return "pro_monthly";
}

export async function setUserLifetimePlan(
  userId: string,
  paddleCustomerId?: string | null,
) {
  const now = new Date();
  await db
    .update(users)
    .set({
      isPaid: true,
      plan: "lifetime",
      paddleCustomerId: paddleCustomerId ?? undefined,
      paidAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

export async function upsertPaddleSubscription(
  params: UpsertPaddleSubscriptionParams,
) {
  const {
    userId,
    plan: customDataPlan,
    paddleCustomerId,
    paddleSubscriptionId,
    paddleTransactionId,
    paddlePriceId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
  } = params;

  const now = new Date();
  const isActive = status === "active" || status === "trialing";
  const resolvedPlan = isActive
    ? resolvePlanFromPriceOrCustomData(customDataPlan, paddlePriceId)
    : null;

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

  // 2. Update user status in users table (unless user is on active lifetime plan)
  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId));

  if (currentUser?.plan === "lifetime") {
    // Preserve lifetime status, but update paddleCustomerId if provided
    if (paddleCustomerId) {
      await db
        .update(users)
        .set({ paddleCustomerId, updatedAt: now })
        .where(eq(users.id, userId));
    }
    return;
  }

  await db
    .update(users)
    .set({
      isPaid: isActive,
      plan: isActive ? resolvedPlan : null,
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

  const [currentUser] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId));

  if (currentUser?.plan !== "lifetime") {
    await db
      .update(users)
      .set({
        isPaid: false,
        plan: null,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
  }
}
