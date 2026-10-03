import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { tripoDownloads, users } from "../db/schema.js";
import { ERROR_CODES } from "../config/errors.js";
import { getUserAndSubscription, isProSubscription } from "./entitlement.js";

export function getStartOfCalendarMonth(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

export interface TripoStudioModelsEntitlement {
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

export interface TripoEntitlementResult {
  plan: "free" | "pro_monthly" | "pro_annual" | "pro_max_monthly" | "lifetime";
  allowed: boolean;
  studioModels: TripoStudioModelsEntitlement;
}

export function resolveTripoPlan(userWithSub: {
  isPaid?: boolean | null;
  plan?: string | null;
  subPlan?: string | null;
  subStatus?: string | null;
  effectivePlan?: string | null;
  currentPeriodStart?: Date | null;
}) {
  const isPro =
    userWithSub.isPaid === true ||
    userWithSub.subStatus === "active" ||
    userWithSub.subStatus === "trialing" ||
    isProSubscription(userWithSub.subStatus, userWithSub.isPaid ?? undefined);

  if (!isPro) {
    return {
      plan: "free" as const,
      allowed: false,
      limit: 0,
      unlimited: false,
      periodStart: null,
    };
  }

  const rawPlan = (
    userWithSub.effectivePlan ||
    userWithSub.plan ||
    userWithSub.subPlan ||
    "pro_monthly"
  ).toLowerCase();

  if (rawPlan.includes("lifetime")) {
    return {
      plan: "lifetime" as const,
      allowed: true,
      limit: null,
      unlimited: true,
      periodStart: null,
    };
  }

  if (rawPlan.includes("annual")) {
    return {
      plan: "pro_annual" as const,
      allowed: true,
      limit: 50,
      unlimited: false,
      periodStart: null,
    };
  }

  if (
    rawPlan === "pro_max_monthly" ||
    rawPlan.includes("pro_max") ||
    rawPlan.includes("max")
  ) {
    const periodStart =
      userWithSub.currentPeriodStart ?? getStartOfCalendarMonth();
    return {
      plan: "pro_max_monthly" as const,
      allowed: true,
      limit: 12,
      unlimited: false,
      periodStart,
    };
  }

  return {
    plan: "pro_monthly" as const,
    allowed: false,
    limit: 0,
    unlimited: false,
    periodStart: null,
  };
}

export async function getTripoEntitlement(
  userWithSub: {
    id: string;
    isPaid?: boolean | null;
    plan?: string | null;
    subPlan?: string | null;
    subStatus?: string | null;
    effectivePlan?: string | null;
    currentPeriodStart?: Date | null;
  },
  tx?: any,
): Promise<TripoEntitlementResult> {
  const runner = tx ?? db;
  const planInfo = resolveTripoPlan(userWithSub);

  const conditions = [eq(tripoDownloads.userId, userWithSub.id)];
  if (planInfo.periodStart) {
    conditions.push(gte(tripoDownloads.createdAt, planInfo.periodStart));
  }

  const [res] = await runner
    .select({ count: count() })
    .from(tripoDownloads)
    .where(and(...conditions));

  const used = Number(res?.count ?? 0);

  let remaining: number | null = null;
  if (planInfo.unlimited) {
    remaining = null;
  } else if (
    planInfo.limit === 0 ||
    planInfo.limit === null ||
    !planInfo.allowed
  ) {
    remaining = 0;
  } else {
    remaining = Math.max(0, planInfo.limit - used);
  }

  return {
    plan: planInfo.plan,
    allowed: planInfo.allowed,
    studioModels: {
      limit: planInfo.limit,
      used,
      remaining,
      unlimited: planInfo.unlimited,
    },
  };
}

export interface ConsumeTripoDownloadParams {
  installationId: string;
  tripoModelId?: string | null;
  modelId?: string | null;
  modelKey?: string | null;
  downloadType?: string | null;
  entitlementOrigin?: string | null;
}

export async function consumeTripoDownload(params: ConsumeTripoDownloadParams) {
  const {
    installationId,
    tripoModelId,
    modelId,
    modelKey,
    downloadType,
    entitlementOrigin,
  } = params;

  if (!installationId || !installationId.trim()) {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.VALIDATION_ERROR,
      message: "body must have required property 'installationId'",
    };
  }

  return await db.transaction(async (tx) => {
    // 1. Resolve user & subscription by installationId
    const userWithSub = await getUserAndSubscription({ installationId }, tx);
    if (!userWithSub) {
      return {
        success: false,
        statusCode: 404,
        error: ERROR_CODES.INSTALLATION_NOT_FOUND,
        message: "Installation not found.",
      };
    }

    // 2. Lock user row FOR UPDATE to prevent simultaneous double consumption
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userWithSub.id))
      .for("update");

    // 3. Resolve entitlement & quota
    const entitlement = await getTripoEntitlement(userWithSub, tx);

    if (!entitlement.allowed) {
      return {
        success: false,
        statusCode: 403,
        error: ERROR_CODES.TRIPO_ACCESS_NOT_ALLOWED,
        message: "Tripo Studio models are not available on your current plan.",
        tripo: {
          studioModels: entitlement.studioModels,
        },
      };
    }

    if (
      !entitlement.studioModels.unlimited &&
      entitlement.studioModels.remaining !== null &&
      entitlement.studioModels.remaining <= 0
    ) {
      return {
        success: false,
        statusCode: 403,
        error: ERROR_CODES.TRIPO_QUOTA_EXHAUSTED,
        message: "Tripo download quota exhausted for your plan.",
        tripo: {
          studioModels: entitlement.studioModels,
        },
      };
    }

    // 4. Record consumption into tripo_downloads table
    const resolvedModelId =
      (tripoModelId || modelId || modelKey || null)?.trim() || null;
    const normalizedType = downloadType?.trim().toLowerCase() || "glb";

    const [inserted] = await tx
      .insert(tripoDownloads)
      .values({
        userId: userWithSub.id,
        installationId,
        tripoModelId: resolvedModelId,
        downloadType: normalizedType,
        entitlementOrigin: entitlementOrigin ?? null,
      })
      .returning({
        id: tripoDownloads.id,
        createdAt: tripoDownloads.createdAt,
      });

    // 5. Fetch updated entitlement state
    const updatedEntitlement = await getTripoEntitlement(userWithSub, tx);

    return {
      success: true,
      statusCode: 200,
      data: {
        allowed: true,
        downloadId: inserted.id,
        plan: entitlement.plan,
        tripo: {
          studioModels: updatedEntitlement.studioModels,
        },
      },
    };
  });
}
