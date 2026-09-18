import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { downloads } from "../db/schema.js";

export function normalizeSource(
  source?: string | null,
): "workspace" | "community" {
  if (!source || !source.trim()) {
    return "workspace";
  }
  const normalized = source.trim().toLowerCase();
  if (normalized === "community") {
    return "community";
  }
  return "workspace";
}

export interface UserSubInfo {
  id: string;
  isPaid?: boolean | null;
  plan?: string | null;
  subPlan?: string | null;
  subStatus?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}

export interface CommunityEntitlementResult {
  plan: "free" | "pro_monthly" | "pro_annual" | "lifetime";
  communityModelsUsed: number;
  communityModelsRemaining: number | null;
  communityModelsLimit: number | null;
}

export function resolveCommunityPlan(userWithSub: UserSubInfo): {
  plan: "free" | "pro_monthly" | "pro_annual" | "lifetime";
  limit: number | null;
  periodStart: Date | null;
} {
  const isPro =
    userWithSub.isPaid === true ||
    userWithSub.subStatus === "active" ||
    userWithSub.subStatus === "trialing";

  if (!isPro) {
    return {
      plan: "free",
      limit: 1,
      periodStart: null,
    };
  }

  const rawPlan = (
    userWithSub.plan ||
    userWithSub.subPlan ||
    "pro_monthly"
  ).toLowerCase();

  if (rawPlan.includes("lifetime")) {
    return {
      plan: "lifetime",
      limit: null,
      periodStart: null,
    };
  }

  if (rawPlan.includes("annual")) {
    return {
      plan: "pro_annual",
      limit: 40,
      periodStart: userWithSub.currentPeriodStart ?? null,
    };
  }

  return {
    plan: "pro_monthly",
    limit: 2,
    periodStart: userWithSub.currentPeriodStart ?? null,
  };
}

export async function getCommunityEntitlement(
  userWithSub: UserSubInfo,
  tx?: any,
): Promise<CommunityEntitlementResult> {
  const runner = tx ?? db;
  const { plan, limit, periodStart } = resolveCommunityPlan(userWithSub);

  const conditions = [
    eq(downloads.userId, userWithSub.id),
    eq(downloads.source, "community"),
  ];

  if (periodStart) {
    conditions.push(gte(downloads.createdAt, periodStart));
  }

  const [result] = await runner
    .select({
      count: sql<number>`count(distinct ${downloads.modelId})::int`,
    })
    .from(downloads)
    .where(and(...conditions));

  const communityModelsUsed = result?.count ?? 0;
  const communityModelsRemaining =
    limit === null ? null : Math.max(0, limit - communityModelsUsed);

  return {
    plan,
    communityModelsUsed,
    communityModelsRemaining,
    communityModelsLimit: limit,
  };
}

export async function getCommunityModelsUsed(
  userId: string,
  tx?: any,
): Promise<number> {
  const runner = tx ?? db;
  const [result] = await runner
    .select({
      count: sql<number>`count(distinct ${downloads.modelId})::int`,
    })
    .from(downloads)
    .where(
      and(eq(downloads.userId, userId), eq(downloads.source, "community")),
    );

  return result?.count ?? 0;
}
