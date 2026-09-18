import { eq, count, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { linkedAccounts, subscriptions, users } from "../db/schema.js";
import { isProSubscription } from "./entitlement.js";

export function getAccountSlotsForPlan(
  plan?: string | null,
  isPaid?: boolean,
): number {
  if (!isPaid) return 0;
  if (plan === "pro_max_monthly") return 2;
  if (plan === "lifetime") return 4;
  return 0;
}

export async function getLinkedAccountsForOwner(
  ownerUserId: string,
  effectivePlan: string,
  isPaid: boolean,
) {
  const accountSlots = getAccountSlotsForPlan(effectivePlan, isPaid);

  const accountsList = await db
    .select({
      id: linkedAccounts.id,
      meshyEmail: linkedAccounts.meshyEmail,
      createdAt: linkedAccounts.createdAt,
    })
    .from(linkedAccounts)
    .where(eq(linkedAccounts.ownerUserId, ownerUserId))
    .orderBy(linkedAccounts.createdAt);

  const linkedAccountsCount = accountsList.length;
  const linkedAccountsRemaining = Math.max(
    0,
    accountSlots - linkedAccountsCount,
  );

  return {
    accountSlots,
    linkedAccountsCount,
    linkedAccountsRemaining,
    accounts: accountsList.map((acc) => ({
      id: acc.id,
      meshyEmail: acc.meshyEmail,
      createdAt: acc.createdAt.toISOString(),
    })),
  };
}

export interface LinkAccountResult {
  success: boolean;
  statusCode: number;
  error?: string;
  message?: string;
  data?: {
    accountSlots: number;
    linkedAccountsCount: number;
    linkedAccountsRemaining: number;
    accounts: Array<{
      id: string;
      meshyEmail: string;
      createdAt: string;
    }>;
  };
}

export async function linkAccount(params: {
  ownerUserId: string;
  meshyEmail: string;
}): Promise<LinkAccountResult> {
  const { ownerUserId, meshyEmail } = params;

  const normalizedEmail = meshyEmail.trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      success: false,
      statusCode: 400,
      error: "INVALID_EMAIL",
      message: "meshyEmail is required",
    };
  }

  return await db.transaction(async (tx) => {
    // Lock the primary owner's user row for the duration of transaction to prevent concurrent link race conditions
    const [owner] = await tx
      .select({
        id: users.id,
        email: users.email,
        isPaid: users.isPaid,
        plan: users.plan,
      })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .for("update");

    if (!owner) {
      return {
        success: false,
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Owner user not found",
      };
    }

    const [sub] = await tx
      .select({
        plan: subscriptions.plan,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ownerUserId))
      .limit(1);

    const isPro = owner.isPaid || isProSubscription(sub?.status, owner.isPaid);
    const effectivePlan = isPro
      ? (owner.plan ?? sub?.plan ?? "pro_monthly")
      : "free";
    const accountSlots = getAccountSlotsForPlan(effectivePlan, isPro);

    if (accountSlots === 0) {
      return {
        success: false,
        statusCode: 403,
        error: "PLAN_HAS_NO_SLOTS",
        message: "Your current plan does not include additional account slots.",
      };
    }

    const existingAccounts = await tx
      .select({ id: linkedAccounts.id })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.ownerUserId, ownerUserId));

    if (existingAccounts.length >= accountSlots) {
      return {
        success: false,
        statusCode: 403,
        error: "SLOT_LIMIT_REACHED",
        message: "All account slots for your plan are already in use.",
      };
    }

    // 8. Reject if target email equals owner's primary email
    if (owner.email && owner.email.trim().toLowerCase() === normalizedEmail) {
      return {
        success: false,
        statusCode: 400,
        error: "CANNOT_LINK_PRIMARY_EMAIL",
        message:
          "Cannot link your primary account email as an additional account.",
      };
    }

    // 9 & 10. Reject if email is already linked to this owner or another owner
    const [alreadyLinked] = await tx
      .select({
        id: linkedAccounts.id,
        ownerUserId: linkedAccounts.ownerUserId,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.meshyEmail, normalizedEmail))
      .limit(1);

    if (alreadyLinked) {
      if (alreadyLinked.ownerUserId === ownerUserId) {
        return {
          success: false,
          statusCode: 409,
          error: "EMAIL_ALREADY_LINKED",
          message: "This Meshy email is already linked to your account.",
        };
      } else {
        return {
          success: false,
          statusCode: 409,
          error: "EMAIL_LINKED_TO_OTHER_OWNER",
          message:
            "This Meshy email is already linked to another MeshyGrab owner.",
        };
      }
    }

    // Reject if email is the primary email of another MeshyGrab user
    const [primaryUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (primaryUser && primaryUser.id !== ownerUserId) {
      return {
        success: false,
        statusCode: 409,
        error: "EMAIL_BELONGS_TO_OTHER_USER",
        message: "This email belongs to another primary MeshyGrab user.",
      };
    }

    // 11. Insert the linked account
    const now = new Date();
    await tx.insert(linkedAccounts).values({
      ownerUserId,
      meshyEmail: normalizedEmail,
      createdAt: now,
      updatedAt: now,
    });

    // 12. Return updated account/entitlement state
    const allLinked = await tx
      .select({
        id: linkedAccounts.id,
        meshyEmail: linkedAccounts.meshyEmail,
        createdAt: linkedAccounts.createdAt,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.ownerUserId, ownerUserId))
      .orderBy(linkedAccounts.createdAt);

    const linkedAccountsCount = allLinked.length;
    const linkedAccountsRemaining = Math.max(
      0,
      accountSlots - linkedAccountsCount,
    );

    return {
      success: true,
      statusCode: 201,
      data: {
        accountSlots,
        linkedAccountsCount,
        linkedAccountsRemaining,
        accounts: allLinked.map((acc) => ({
          id: acc.id,
          meshyEmail: acc.meshyEmail,
          createdAt: acc.createdAt.toISOString(),
        })),
      },
    };
  });
}
