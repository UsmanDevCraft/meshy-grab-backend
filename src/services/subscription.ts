import { eq } from "drizzle-orm";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { installations, subscriptions, users } from "../db/schema.js";
import { paddle } from "../lib/paddle.js";
import { Plan } from "../types/plan.js";
import { getUserAndSubscription } from "./entitlement.js";

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
  cancelAtPeriodEnd?: boolean | null;
}

export function resolvePlanFromPriceOrCustomData(
  customDataPlan?: string | null,
  paddlePriceId?: string | null,
): Plan {
  if (
    customDataPlan === "pro_monthly" ||
    customDataPlan === "pro_annual" ||
    customDataPlan === "pro_max_monthly" ||
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
    if (paddlePriceId === env.PADDLE_PRICE_PRO_MAX_MONTHLY) {
      return "pro_max_monthly";
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

  // 1. Retrieve current user and subscription records to check for active recurring sub ID
  const [currentUser] = await db
    .select({
      paddleSubscriptionId: users.paddleSubscriptionId,
      paddleCustomerId: users.paddleCustomerId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [currentSub] = await db
    .select({
      paddleSubscriptionId: subscriptions.paddleSubscriptionId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const existingSubId =
    currentUser?.paddleSubscriptionId || currentSub?.paddleSubscriptionId;

  // 2. If user has an existing recurring subscription ID, cancel it at Paddle & mark local sub canceled
  if (existingSubId) {
    try {
      await paddle.subscriptions.cancel(existingSubId, {
        effectiveFrom: "immediately",
      });
    } catch (error: any) {
      const errorMessage = (error?.message || "").toLowerCase();
      const errorCode = (error?.code || "").toLowerCase();
      const status = error?.status || error?.statusCode;

      const isAlreadyCanceled =
        errorMessage.includes("already canceled") ||
        errorMessage.includes("already cancelled") ||
        errorMessage.includes("cannot be canceled") ||
        errorMessage.includes("not found") ||
        errorCode.includes("already_canceled") ||
        status === 409 ||
        status === 404;

      if (!isAlreadyCanceled) {
        throw error;
      }
    }

    // Update local subscription row to canceled status (preserves historical plan)
    await db
      .update(subscriptions)
      .set({
        status: "canceled",
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, userId));
  }

  // 3. Activate Lifetime on users table and clear paddleSubscriptionId
  const effectiveCustomerId =
    paddleCustomerId ?? currentUser?.paddleCustomerId ?? null;

  await db
    .update(users)
    .set({
      isPaid: true,
      plan: "lifetime",
      paddleCustomerId: effectiveCustomerId ?? undefined,
      paddleSubscriptionId: null,
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
    cancelAtPeriodEnd,
  } = params;

  const now = new Date();
  const isActive = status === "active" || status === "trialing";
  const subPlan = resolvePlanFromPriceOrCustomData(
    customDataPlan,
    paddlePriceId,
  );
  const resolvedUserPlan = isActive ? subPlan : null;

  // 1. Upsert subscription record in subscriptions table by userId
  await db
    .insert(subscriptions)
    .values({
      userId,
      paddleCustomerId: paddleCustomerId ?? null,
      paddleSubscriptionId: paddleSubscriptionId ?? null,
      paddleTransactionId: paddleTransactionId ?? null,
      paddlePriceId: paddlePriceId ?? null,
      plan: subPlan ?? null,
      status,
      currentPeriodStart: currentPeriodStart ?? null,
      currentPeriodEnd: currentPeriodEnd ?? null,
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        paddleCustomerId: paddleCustomerId ?? undefined,
        paddleSubscriptionId: paddleSubscriptionId ?? undefined,
        paddleTransactionId: paddleTransactionId ?? undefined,
        paddlePriceId: paddlePriceId ?? undefined,
        plan: subPlan ?? undefined,
        status,
        currentPeriodStart: currentPeriodStart ?? undefined,
        currentPeriodEnd: currentPeriodEnd ?? undefined,
        ...(cancelAtPeriodEnd !== undefined
          ? { cancelAtPeriodEnd: cancelAtPeriodEnd ?? false }
          : {}),
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
      plan: resolvedUserPlan,
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
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .where(eq(subscriptions.paddleSubscriptionId, paddleSubscriptionId));
  } else {
    await db
      .update(subscriptions)
      .set({
        status: "canceled",
        cancelAtPeriodEnd: false,
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

export class CancellationError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CancellationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const CANCELLABLE_PLANS = [
  "pro_monthly",
  "pro_max_monthly",
  "pro_annual",
] as const;

export type CancellablePlan = (typeof CANCELLABLE_PLANS)[number];

export interface GenerateCancellationUrlParams {
  email?: string;
  installationId?: string;
  userId?: string;
  providedCustomerId?: string;
  providedSubscriptionId?: string;
}

export async function generateSubscriptionCancellationUrl(
  params: GenerateCancellationUrlParams,
) {
  const {
    email,
    installationId,
    userId,
    providedCustomerId,
    providedSubscriptionId,
  } = params;

  // 1. Require BOTH installationId and email in the request. Both must be present, non-empty, and valid.
  if (
    !installationId ||
    typeof installationId !== "string" ||
    !installationId.trim()
  ) {
    throw new CancellationError(
      400,
      "MISSING_INSTALLATION_ID",
      "installationId is required and must be a non-empty string.",
    );
  }

  if (!email || typeof email !== "string" || !email.trim()) {
    throw new CancellationError(
      400,
      "MISSING_EMAIL",
      "email is required and must be a non-empty string.",
    );
  }

  const trimmedEmail = email.trim();
  const trimmedInstallationId = installationId.trim();

  // Basic RFC 5322 compatible email pattern check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new CancellationError(
      400,
      "INVALID_EMAIL",
      "email must be a valid email address.",
    );
  }

  // 2. Look up the installation in the database
  const [installationRecord] = await db
    .select({
      id: installations.id,
      installationId: installations.installationId,
      userId: installations.userId,
    })
    .from(installations)
    .where(eq(installations.installationId, trimmedInstallationId))
    .limit(1);

  if (!installationRecord) {
    throw new CancellationError(
      404,
      "INSTALLATION_NOT_FOUND",
      "Installation record not found.",
    );
  }

  // If userId is provided, ensure it matches the installation's user
  if (userId && userId.trim() && installationRecord.userId !== userId.trim()) {
    throw new CancellationError(
      403,
      "MISMATCHED_INSTALLATION",
      "installationId does not match the provided userId.",
    );
  }

  // 3. Look up user and subscription records in the database
  const user = await getUserAndSubscription({
    installationId: trimmedInstallationId,
    userId: userId?.trim() || installationRecord.userId,
  });

  if (!user) {
    throw new CancellationError(
      404,
      "USER_NOT_FOUND",
      "User associated with this installation not found.",
    );
  }

  // 4. Verify that the supplied email exactly matches the email associated with that installation/user (case-insensitive)
  // Important: email + installation ID are additional matching checks, not proof of authentication.
  // Proper server-side account verification and database records are strictly enforced.
  const normalizedSuppliedEmail = trimmedEmail.toLowerCase();
  const dbUserEmail = user.email ? user.email.trim().toLowerCase() : null;
  const dbIdentityEmail = user.identityEmail
    ? user.identityEmail.trim().toLowerCase()
    : null;

  const emailMatches =
    (dbUserEmail && normalizedSuppliedEmail === dbUserEmail) ||
    (dbIdentityEmail && normalizedSuppliedEmail === dbIdentityEmail);

  if (!emailMatches) {
    throw new CancellationError(
      403,
      "EMAIL_MISMATCH",
      "The supplied email does not match the account associated with this installation.",
    );
  }

  // 5. Determine effective owner user ID (for linked Meshy accounts)
  const targetUserId = user.ownerUserId || user.id;

  // 6. Retrieve user and subscription records from existing database
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, targetUserId))
    .limit(1);

  const [userRecord] = await db
    .select({
      id: users.id,
      email: users.email,
      plan: users.plan,
      isPaid: users.isPaid,
      paddleCustomerId: users.paddleCustomerId,
      paddleSubscriptionId: users.paddleSubscriptionId,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  // 7. Plan verification: Allow cancellation ONLY for pro_monthly, pro_max_monthly, pro_annual
  const effectivePlan =
    subscription?.plan || userRecord?.plan || user.effectivePlan || user.plan;

  if (effectivePlan === "lifetime") {
    throw new CancellationError(
      400,
      "INVALID_PLAN",
      "Lifetime subscriptions cannot be canceled.",
    );
  }

  if (!effectivePlan || effectivePlan === "free") {
    throw new CancellationError(
      400,
      "INVALID_PLAN",
      "Free accounts do not have an active subscription to cancel.",
    );
  }

  if (!CANCELLABLE_PLANS.includes(effectivePlan as CancellablePlan)) {
    throw new CancellationError(
      400,
      "INVALID_PLAN",
      `Cancellation is not supported for plan: ${effectivePlan}.`,
    );
  }

  // 8. Verify subscription status: must be active and not already scheduled for cancellation
  const status =
    subscription?.status || (userRecord?.isPaid ? "active" : "inactive");

  if (status === "canceled") {
    throw new CancellationError(
      400,
      "SUBSCRIPTION_ALREADY_CANCELED",
      "This subscription is already canceled.",
    );
  }

  if (status !== "active" && status !== "trialing") {
    throw new CancellationError(
      400,
      "SUBSCRIPTION_NOT_ACTIVE",
      `Subscription is not active (status: ${status}).`,
    );
  }

  if (subscription?.cancelAtPeriodEnd || user.cancelAtPeriodEnd) {
    throw new CancellationError(
      400,
      "CANCELLATION_ALREADY_SCHEDULED",
      "Subscription is already scheduled for cancellation at the end of the billing period.",
    );
  }

  // 9. Never trust client-supplied Paddle customer or subscription IDs;
  // Retrieve them exclusively from verified database records.
  const effectiveCustomerId =
    subscription?.paddleCustomerId ||
    userRecord?.paddleCustomerId ||
    user.paddleCustomerId ||
    user.subPaddleCustomerId;

  const effectiveSubscriptionId =
    subscription?.paddleSubscriptionId ||
    userRecord?.paddleSubscriptionId ||
    user.paddleSubscriptionId ||
    user.subPaddleSubscriptionId;

  if (!effectiveCustomerId || !effectiveSubscriptionId) {
    throw new CancellationError(
      400,
      "MISSING_PADDLE_DATA",
      "No active Paddle subscription found for this user.",
    );
  }

  if (providedCustomerId && providedCustomerId !== effectiveCustomerId) {
    throw new CancellationError(
      403,
      "UNAUTHORIZED",
      "Provided customerId does not match the authenticated subscription.",
    );
  }

  if (
    providedSubscriptionId &&
    providedSubscriptionId !== effectiveSubscriptionId
  ) {
    throw new CancellationError(
      403,
      "UNAUTHORIZED",
      "Provided subscriptionId does not match the authenticated subscription.",
    );
  }

  // 10. Generate a fresh Paddle Customer Portal Session using verified customer ID and subscription ID
  let portalSession;
  try {
    portalSession = await paddle.customerPortalSessions.create(
      effectiveCustomerId,
      [effectiveSubscriptionId],
    );
  } catch (error: any) {
    throw new CancellationError(
      502,
      "PADDLE_PORTAL_SESSION_FAILED",
      error?.message || "Failed to create Paddle customer portal session.",
    );
  }

  // 11. Return matching cancel_subscription URL
  const subUrls = portalSession?.urls?.subscriptions || [];
  const matchingSub =
    subUrls.find((s: any) => s.id === effectiveSubscriptionId) || subUrls[0];
  const cancelSubscriptionUrl = matchingSub?.cancelSubscription;

  if (!cancelSubscriptionUrl) {
    throw new CancellationError(
      502,
      "PADDLE_PORTAL_SESSION_FAILED",
      "Paddle customer portal did not return a cancellation URL.",
    );
  }

  return {
    url: cancelSubscriptionUrl,
    cancelSubscriptionUrl,
  };
}
