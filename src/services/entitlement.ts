import { eq, count } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  installations,
  linkedAccounts,
  subscriptions,
  users,
} from "../db/schema.js";
import {
  FREE_DOWNLOAD_LIMIT,
  FREE_TEXTURE_DOWNLOAD_LIMIT,
  SUBSCRIPTION_STATUSES,
} from "../config/constants.js";
import { getAccountSlotsForPlan } from "./accounts.js";

export async function getUserById(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isPaid: users.isPaid,
      plan: users.plan,
      freeDownloadsUsed: users.freeDownloadsUsed,
      textureDownloadsUsed: users.textureDownloadsUsed,
      paddleCustomerId: users.paddleCustomerId,
      paddleSubscriptionId: users.paddleSubscriptionId,
      paidAt: users.paidAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  if (user.email) {
    const normalizedEmail = user.email.trim().toLowerCase();
    const [linked] = await db
      .select({ ownerUserId: linkedAccounts.ownerUserId })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.meshyEmail, normalizedEmail))
      .limit(1);

    if (linked) {
      const [owner] = await db
        .select({
          id: users.id,
          email: users.email,
          isPaid: users.isPaid,
          plan: users.plan,
          freeDownloadsUsed: users.freeDownloadsUsed,
          textureDownloadsUsed: users.textureDownloadsUsed,
          paddleCustomerId: users.paddleCustomerId,
          paddleSubscriptionId: users.paddleSubscriptionId,
          paidAt: users.paidAt,
        })
        .from(users)
        .where(eq(users.id, linked.ownerUserId))
        .limit(1);

      if (owner) return owner;
    }
  }

  return user;
}

export async function getUserByInstallationId(installationId: string) {
  const [result] = await db
    .select({
      id: users.id,
      email: users.email,
      isPaid: users.isPaid,
      plan: users.plan,
      freeDownloadsUsed: users.freeDownloadsUsed,
      textureDownloadsUsed: users.textureDownloadsUsed,
      paddleCustomerId: users.paddleCustomerId,
      paddleSubscriptionId: users.paddleSubscriptionId,
      paidAt: users.paidAt,
    })
    .from(installations)
    .innerJoin(users, eq(installations.userId, users.id))
    .where(eq(installations.installationId, installationId))
    .limit(1);

  if (!result) return null;

  if (result.email) {
    const normalizedEmail = result.email.trim().toLowerCase();
    const [linked] = await db
      .select({ ownerUserId: linkedAccounts.ownerUserId })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.meshyEmail, normalizedEmail))
      .limit(1);

    if (linked) {
      const [owner] = await db
        .select({
          id: users.id,
          email: users.email,
          isPaid: users.isPaid,
          plan: users.plan,
          freeDownloadsUsed: users.freeDownloadsUsed,
          textureDownloadsUsed: users.textureDownloadsUsed,
          paddleCustomerId: users.paddleCustomerId,
          paddleSubscriptionId: users.paddleSubscriptionId,
          paidAt: users.paidAt,
        })
        .from(users)
        .where(eq(users.id, linked.ownerUserId))
        .limit(1);

      if (owner) return owner;
    }
  }

  return result;
}

export async function getUserSubscription(userId: string) {
  const [subscription] = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      plan: subscriptions.plan,
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

export interface UserAndSubQueryResult {
  id: string;
  email: string | null;
  isPaid: boolean;
  plan: string | null;
  freeDownloadsUsed: number;
  textureDownloadsUsed: number;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  paidAt: Date | null;
  subPlan: string | null;
  subStatus: string | null;
  subPaddleCustomerId: string | null;
  subPaddleSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Single round-trip field-projected query for user and subscription details.
 * Resolves attached Meshy accounts to their primary owner user & subscription.
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
    plan: users.plan,
    freeDownloadsUsed: users.freeDownloadsUsed,
    textureDownloadsUsed: users.textureDownloadsUsed,
    paddleCustomerId: users.paddleCustomerId,
    paddleSubscriptionId: users.paddleSubscriptionId,
    paidAt: users.paidAt,
    subPlan: subscriptions.plan,
    subStatus: subscriptions.status,
    subPaddleCustomerId: subscriptions.paddleCustomerId,
    subPaddleSubscriptionId: subscriptions.paddleSubscriptionId,
    currentPeriodStart: subscriptions.currentPeriodStart,
    currentPeriodEnd: subscriptions.currentPeriodEnd,
  };

  let initialUser: UserAndSubQueryResult | null = null;

  if (installationId) {
    const [result] = await db
      .select(selectFields)
      .from(installations)
      .innerJoin(users, eq(installations.userId, users.id))
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(installations.installationId, installationId))
      .limit(1);

    initialUser = (result as UserAndSubQueryResult) ?? null;
  } else if (userId) {
    const [result] = await db
      .select(selectFields)
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    initialUser = (result as UserAndSubQueryResult) ?? null;
  }

  if (!initialUser) {
    return null;
  }

  let effectiveUser: UserAndSubQueryResult = initialUser;
  let accountType: "primary" | "attached" = "primary";
  let identityEmail: string | null = initialUser.email;

  if (initialUser.email) {
    const normalizedEmail = initialUser.email.trim().toLowerCase();
    const [linked] = await db
      .select({
        ownerUserId: linkedAccounts.ownerUserId,
        meshyEmail: linkedAccounts.meshyEmail,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.meshyEmail, normalizedEmail))
      .limit(1);

    if (linked) {
      const [owner] = await db
        .select(selectFields)
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(eq(users.id, linked.ownerUserId))
        .limit(1);

      if (owner) {
        effectiveUser = owner as UserAndSubQueryResult;
        accountType = "attached";
        identityEmail = linked.meshyEmail;
      }
    }
  }

  const ownerUserId = effectiveUser.id;
  const isPro =
    effectiveUser.isPaid ||
    isProSubscription(effectiveUser.subStatus, effectiveUser.isPaid);
  const effectivePlan = isPro
    ? (effectiveUser.plan ?? effectiveUser.subPlan ?? "pro_monthly")
    : "free";
  const accountSlots = isPro ? getAccountSlotsForPlan(effectivePlan, isPro) : 0;

  const [linkedCountRes] = await db
    .select({ count: count() })
    .from(linkedAccounts)
    .where(eq(linkedAccounts.ownerUserId, ownerUserId));

  const linkedAccountsCount = Number(linkedCountRes?.count ?? 0);
  const linkedAccountsRemaining = Math.max(
    0,
    accountSlots - linkedAccountsCount,
  );

  return {
    ...effectiveUser,
    id: initialUser.id,
    accountType,
    ownerUserId,
    identityEmail,
    effectivePlan,
    accountSlots,
    linkedAccountsCount,
    linkedAccountsRemaining,
  };
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

export function getFreeTextureDownloadsRemaining(textureDownloadsUsed: number) {
  return Math.max(0, FREE_TEXTURE_DOWNLOAD_LIMIT - textureDownloadsUsed);
}

export {
  upsertPaddleSubscription,
  revokePaddleSubscription,
} from "./subscription.js";
