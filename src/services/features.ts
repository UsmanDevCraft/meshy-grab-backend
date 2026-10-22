import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { featureUsages, users } from "../db/schema.js";
import { ERROR_CODES } from "../config/errors.js";
import { ALLOWED_DOWNLOAD_TYPES } from "../config/constants.js";
import { getUserAndSubscription } from "./entitlement.js";

export type FeatureType = "upscale" | "format_conversion";
export type FeaturePeriod = "monthly" | "annual" | "lifetime";

export interface FeatureEntitlementItem {
  available: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  period: FeaturePeriod | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface FeaturesEntitlementResult {
  upscaling: FeatureEntitlementItem;
  formatConversion: FeatureEntitlementItem;
}

export interface ResolvedPlanInfo {
  eligible: boolean;
  plan: "pro_max_monthly" | "pro_annual" | "lifetime" | "pro_monthly" | "free";
  period: FeaturePeriod | null;
  upscaleLimit: number | null;
  conversionLimit: number | null;
  unlimited: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Authoritatively resolves feature eligibility, plan type, allowances, and billing period boundaries.
 *
 * Rules:
 * - Upscaling and format conversions are ONLY available to Pro Max, Annual, and Lifetime users.
 * - Free and regular Pro Monthly users MUST NOT receive access to either feature.
 * - Do not infer eligibility from isPaid alone.
 * - Subscriptions must have an active status ("active" or "trialing") and must not be expired.
 * - Monthly and annual limits follow the actual subscription billing period when reliable.
 * - Safe fallback: if subscription-period information is missing or inconsistent, do not silently reset.
 */
export function resolveFeaturePlan(userWithSub: {
  isPaid?: boolean | null;
  plan?: string | null;
  subPlan?: string | null;
  subStatus?: string | null;
  effectivePlan?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}): ResolvedPlanInfo {
  const isPaid = userWithSub.isPaid === true;
  const rawPlan = (
    userWithSub.effectivePlan ||
    userWithSub.plan ||
    userWithSub.subPlan ||
    "free"
  ).toLowerCase();

  // 1. Lifetime check
  if (rawPlan === "lifetime" || rawPlan.includes("lifetime")) {
    if (isPaid) {
      return {
        eligible: true,
        plan: "lifetime",
        period: "lifetime",
        upscaleLimit: null,
        conversionLimit: null,
        unlimited: true,
        periodStart: null,
        periodEnd: null,
      };
    }
  }

  // 2. Non-lifetime users require isPaid = true AND an active/trialing subscription status
  if (!isPaid) {
    return {
      eligible: false,
      plan: rawPlan === "pro_monthly" ? "pro_monthly" : "free",
      period: null,
      upscaleLimit: null,
      conversionLimit: null,
      unlimited: false,
      periodStart: null,
      periodEnd: null,
    };
  }

  const subStatus = (userWithSub.subStatus || "").toLowerCase();
  const isSubActive = subStatus === "active" || subStatus === "trialing";

  if (!isSubActive) {
    return {
      eligible: false,
      plan: rawPlan === "pro_monthly" ? "pro_monthly" : "free",
      period: null,
      upscaleLimit: null,
      conversionLimit: null,
      unlimited: false,
      periodStart: null,
      periodEnd: null,
    };
  }

  // Check if subscription period has expired (currentPeriodEnd in the past)
  const now = new Date();
  if (userWithSub.currentPeriodEnd) {
    const end = new Date(userWithSub.currentPeriodEnd);
    if (!isNaN(end.getTime()) && end < now) {
      return {
        eligible: false,
        plan: rawPlan === "pro_monthly" ? "pro_monthly" : "free",
        period: null,
        upscaleLimit: null,
        conversionLimit: null,
        unlimited: false,
        periodStart: null,
        periodEnd: null,
      };
    }
  }

  // Determine period boundaries with safe fallback
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  if (userWithSub.currentPeriodStart) {
    const start = new Date(userWithSub.currentPeriodStart);
    // Reliable start date must be a valid date and not in the future
    if (!isNaN(start.getTime()) && start <= now) {
      periodStart = start;
      if (userWithSub.currentPeriodEnd) {
        const end = new Date(userWithSub.currentPeriodEnd);
        if (!isNaN(end.getTime()) && end > start) {
          periodEnd = end;
        }
      }
    }
  }

  // 3. Pro Max Monthly: 3 upscales, 5 format conversions per month
  if (rawPlan === "pro_max_monthly" || rawPlan.includes("pro_max")) {
    return {
      eligible: true,
      plan: "pro_max_monthly",
      period: "monthly",
      upscaleLimit: 3,
      conversionLimit: 5,
      unlimited: false,
      periodStart,
      periodEnd,
    };
  }

  // 4. Pro Annual: 40 upscales, 75 format conversions per year
  if (rawPlan === "pro_annual" || rawPlan.includes("annual")) {
    return {
      eligible: true,
      plan: "pro_annual",
      period: "annual",
      upscaleLimit: 40,
      conversionLimit: 75,
      unlimited: false,
      periodStart,
      periodEnd,
    };
  }

  // 5. Pro Monthly or other plan: strictly NO access to upscaling or format conversion
  return {
    eligible: false,
    plan: "pro_monthly",
    period: null,
    upscaleLimit: null,
    conversionLimit: null,
    unlimited: false,
    periodStart: null,
    periodEnd: null,
  };
}

/**
 * Returns the usage count for a user in the applicable quota period.
 */
export async function getPeriodUsageCount(
  userId: string,
  featureType: FeatureType,
  periodStart: Date | null,
  tx?: any,
): Promise<number> {
  const runner = tx ?? db;

  const conditions = [
    eq(featureUsages.userId, userId),
    eq(featureUsages.featureType, featureType),
  ];

  if (periodStart) {
    conditions.push(gte(featureUsages.createdAt, periodStart));
  }

  const [res] = await runner
    .select({ count: count() })
    .from(featureUsages)
    .where(and(...conditions));

  return Number(res?.count ?? 0);
}

/**
 * Computes the full feature entitlements for upscaling and format conversion.
 */
export async function getFeaturesEntitlement(
  userWithSub: {
    id: string;
    ownerUserId?: string | null;
    isPaid?: boolean | null;
    plan?: string | null;
    subPlan?: string | null;
    subStatus?: string | null;
    effectivePlan?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    upscalesUsed?: number;
    formatConversionsUsed?: number;
  },
  tx?: any,
): Promise<FeaturesEntitlementResult> {
  const runner = tx ?? db;
  const actualUserId = userWithSub.ownerUserId ?? userWithSub.id;
  const planInfo = resolveFeaturePlan(userWithSub);

  if (!planInfo.eligible) {
    return {
      upscaling: {
        available: false,
        limit: null,
        used: 0,
        remaining: null,
        unlimited: false,
        period: null,
        periodStart: null,
        periodEnd: null,
      },
      formatConversion: {
        available: false,
        limit: null,
        used: 0,
        remaining: null,
        unlimited: false,
        period: null,
        periodStart: null,
        periodEnd: null,
      },
    };
  }

  // Query usage counts for upscaling and format conversion
  const upscaleUsed = await getPeriodUsageCount(
    actualUserId,
    "upscale",
    planInfo.periodStart,
    runner,
  );

  const conversionUsed = await getPeriodUsageCount(
    actualUserId,
    "format_conversion",
    planInfo.periodStart,
    runner,
  );

  const pStartIso = planInfo.periodStart
    ? planInfo.periodStart.toISOString()
    : null;
  const pEndIso = planInfo.periodEnd ? planInfo.periodEnd.toISOString() : null;

  if (planInfo.unlimited) {
    return {
      upscaling: {
        available: true,
        limit: null,
        used: upscaleUsed,
        remaining: null,
        unlimited: true,
        period: "lifetime",
        periodStart: null,
        periodEnd: null,
      },
      formatConversion: {
        available: true,
        limit: null,
        used: conversionUsed,
        remaining: null,
        unlimited: true,
        period: "lifetime",
        periodStart: null,
        periodEnd: null,
      },
    };
  }

  const upscaleLimit = planInfo.upscaleLimit!;
  const conversionLimit = planInfo.conversionLimit!;

  return {
    upscaling: {
      available: true,
      limit: upscaleLimit,
      used: upscaleUsed,
      remaining: Math.max(0, upscaleLimit - upscaleUsed),
      unlimited: false,
      period: planInfo.period,
      periodStart: pStartIso,
      periodEnd: pEndIso,
    },
    formatConversion: {
      available: true,
      limit: conversionLimit,
      used: conversionUsed,
      remaining: Math.max(0, conversionLimit - conversionUsed),
      unlimited: false,
      period: planInfo.period,
      periodStart: pStartIso,
      periodEnd: pEndIso,
    },
  };
}

export interface ConsumeUpscaleParams {
  installationId: string;
  resolution: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  status?: string | null;
  success?: boolean | null;
}

export interface ConsumeConversionParams {
  installationId: string;
  inputFormat: string;
  outputFormat: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  status?: string | null;
  success?: boolean | null;
}

/**
 * Concurrency-safe backend consumption of 4K/8K upscaling quota.
 */
export async function consumeUpscale(params: ConsumeUpscaleParams) {
  const {
    installationId,
    resolution,
    requestId,
    idempotencyKey: rawIdemp,
    status,
    success,
  } = params;

  if (!installationId || !installationId.trim()) {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.VALIDATION_ERROR,
      message: "body must have required property 'installationId'",
    };
  }

  const normRes = (resolution || "").trim().toLowerCase();
  if (normRes !== "4k" && normRes !== "8k") {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.INVALID_RESOLUTION,
      message: "Unsupported resolution. Only '4k' and '8k' are supported.",
    };
  }

  // Handle client-reported failure without consuming quota
  if (success === false || status === "failed") {
    return {
      success: false,
      statusCode: 400,
      error: "OPERATION_FAILED",
      message: "Operation reported as failed. Quota was not consumed.",
    };
  }

  const effectiveIdempotencyKey =
    (rawIdemp || requestId || null)?.trim() || null;

  return await db.transaction(async (tx) => {
    // 1. Resolve user and subscription by installationId
    const userWithSub = await getUserAndSubscription({ installationId }, tx);
    if (!userWithSub) {
      return {
        success: false,
        statusCode: 404,
        error: ERROR_CODES.INSTALLATION_NOT_FOUND,
        message: "Installation not found.",
      };
    }

    const actualUserId = userWithSub.ownerUserId ?? userWithSub.id;

    // 2. Lock user row FOR UPDATE to prevent simultaneous race conditions
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actualUserId))
      .for("update");

    // 3. Resolve plan eligibility
    const planInfo = resolveFeaturePlan(userWithSub);
    if (!planInfo.eligible) {
      return {
        success: false,
        statusCode: 403,
        error: ERROR_CODES.FEATURE_ACCESS_DENIED,
        message:
          "Upscaling is only available on Pro Max, Annual, and Lifetime plans.",
        plan: planInfo.plan,
      };
    }

    // 4. Idempotency check: if already processed with this key, return existing state
    if (effectiveIdempotencyKey) {
      const [existing] = await tx
        .select()
        .from(featureUsages)
        .where(
          and(
            eq(featureUsages.userId, actualUserId),
            eq(featureUsages.featureType, "upscale"),
            eq(featureUsages.idempotencyKey, effectiveIdempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        const currentUsed = await getPeriodUsageCount(
          actualUserId,
          "upscale",
          planInfo.periodStart,
          tx,
        );

        return {
          success: true,
          statusCode: 200,
          data: {
            allowed: true,
            duplicate: true,
            plan: planInfo.plan,
            feature: "upscale",
            operationId: existing.id,
            resolution: existing.resolution,
            used: currentUsed,
            limit: planInfo.upscaleLimit,
            remaining: planInfo.unlimited
              ? null
              : Math.max(0, planInfo.upscaleLimit! - currentUsed),
            unlimited: planInfo.unlimited,
            period: planInfo.period,
            periodStart: planInfo.periodStart?.toISOString() ?? null,
            periodEnd: planInfo.periodEnd?.toISOString() ?? null,
          },
        };
      }
    }

    // 5. Check remaining quota in current billing period
    const currentUsed = await getPeriodUsageCount(
      actualUserId,
      "upscale",
      planInfo.periodStart,
      tx,
    );

    if (!planInfo.unlimited && planInfo.upscaleLimit !== null) {
      if (currentUsed >= planInfo.upscaleLimit) {
        return {
          success: false,
          statusCode: 403,
          error: ERROR_CODES.UPSCALING_QUOTA_EXHAUSTED,
          message: "Upscaling quota exhausted for your plan.",
          plan: planInfo.plan,
          used: currentUsed,
          limit: planInfo.upscaleLimit,
          remaining: 0,
        };
      }
    }

    // 6. Record operation into feature_usages table
    const [inserted] = await tx
      .insert(featureUsages)
      .values({
        userId: actualUserId,
        featureType: "upscale",
        resolution: normRes,
        idempotencyKey: effectiveIdempotencyKey,
      })
      .returning();

    const newUsed = currentUsed + 1;

    // 7. Update persistent upscales_used counter on users table
    await tx
      .update(users)
      .set({
        upscalesUsed: newUsed,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, actualUserId));

    const remaining = planInfo.unlimited
      ? null
      : Math.max(0, planInfo.upscaleLimit! - newUsed);

    return {
      success: true,
      statusCode: 200,
      data: {
        allowed: true,
        duplicate: false,
        plan: planInfo.plan,
        feature: "upscale",
        operationId: inserted.id,
        resolution: inserted.resolution,
        used: newUsed,
        limit: planInfo.upscaleLimit,
        remaining,
        unlimited: planInfo.unlimited,
        period: planInfo.period,
        periodStart: planInfo.periodStart?.toISOString() ?? null,
        periodEnd: planInfo.periodEnd?.toISOString() ?? null,
      },
    };
  });
}

/**
 * Concurrency-safe backend consumption of 3D format conversion quota.
 */
export async function consumeFormatConversion(params: ConsumeConversionParams) {
  const {
    installationId,
    inputFormat,
    outputFormat,
    requestId,
    idempotencyKey: rawIdemp,
    status,
    success,
  } = params;

  if (!installationId || !installationId.trim()) {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.VALIDATION_ERROR,
      message: "body must have required property 'installationId'",
    };
  }

  const inFmt = (inputFormat || "").trim().toLowerCase();
  const outFmt = (outputFormat || "").trim().toLowerCase();

  const allowedFormats = Array.from(ALLOWED_DOWNLOAD_TYPES) as string[];

  if (!allowedFormats.includes(inFmt) || !allowedFormats.includes(outFmt)) {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.INVALID_FORMAT,
      message: `Unsupported format. Allowed formats: ${allowedFormats.join(", ")}`,
    };
  }

  if (inFmt === outFmt) {
    return {
      success: false,
      statusCode: 400,
      error: ERROR_CODES.INVALID_CONVERSION,
      message: "Input format and output format cannot be identical.",
    };
  }

  // Handle client-reported failure without consuming quota
  if (success === false || status === "failed") {
    return {
      success: false,
      statusCode: 400,
      error: "OPERATION_FAILED",
      message: "Operation reported as failed. Quota was not consumed.",
    };
  }

  const effectiveIdempotencyKey =
    (rawIdemp || requestId || null)?.trim() || null;

  return await db.transaction(async (tx) => {
    // 1. Resolve user and subscription by installationId
    const userWithSub = await getUserAndSubscription({ installationId }, tx);
    if (!userWithSub) {
      return {
        success: false,
        statusCode: 404,
        error: ERROR_CODES.INSTALLATION_NOT_FOUND,
        message: "Installation not found.",
      };
    }

    const actualUserId = userWithSub.ownerUserId ?? userWithSub.id;

    // 2. Lock user row FOR UPDATE to prevent simultaneous race conditions
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actualUserId))
      .for("update");

    // 3. Resolve plan eligibility
    const planInfo = resolveFeaturePlan(userWithSub);
    if (!planInfo.eligible) {
      return {
        success: false,
        statusCode: 403,
        error: ERROR_CODES.FEATURE_ACCESS_DENIED,
        message:
          "Format conversion is only available on Pro Max, Annual, and Lifetime plans.",
        plan: planInfo.plan,
      };
    }

    // 4. Idempotency check: if already processed with this key, return existing state
    if (effectiveIdempotencyKey) {
      const [existing] = await tx
        .select()
        .from(featureUsages)
        .where(
          and(
            eq(featureUsages.userId, actualUserId),
            eq(featureUsages.featureType, "format_conversion"),
            eq(featureUsages.idempotencyKey, effectiveIdempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        const currentUsed = await getPeriodUsageCount(
          actualUserId,
          "format_conversion",
          planInfo.periodStart,
          tx,
        );

        return {
          success: true,
          statusCode: 200,
          data: {
            allowed: true,
            duplicate: true,
            plan: planInfo.plan,
            feature: "format_conversion",
            operationId: existing.id,
            inputFormat: existing.inputFormat,
            outputFormat: existing.outputFormat,
            used: currentUsed,
            limit: planInfo.conversionLimit,
            remaining: planInfo.unlimited
              ? null
              : Math.max(0, planInfo.conversionLimit! - currentUsed),
            unlimited: planInfo.unlimited,
            period: planInfo.period,
            periodStart: planInfo.periodStart?.toISOString() ?? null,
            periodEnd: planInfo.periodEnd?.toISOString() ?? null,
          },
        };
      }
    }

    // 5. Check remaining quota in current billing period
    const currentUsed = await getPeriodUsageCount(
      actualUserId,
      "format_conversion",
      planInfo.periodStart,
      tx,
    );

    if (!planInfo.unlimited && planInfo.conversionLimit !== null) {
      if (currentUsed >= planInfo.conversionLimit) {
        return {
          success: false,
          statusCode: 403,
          error: ERROR_CODES.CONVERSION_QUOTA_EXHAUSTED,
          message: "Format conversion quota exhausted for your plan.",
          plan: planInfo.plan,
          used: currentUsed,
          limit: planInfo.conversionLimit,
          remaining: 0,
        };
      }
    }

    // 6. Record operation into feature_usages table
    const [inserted] = await tx
      .insert(featureUsages)
      .values({
        userId: actualUserId,
        featureType: "format_conversion",
        inputFormat: inFmt,
        outputFormat: outFmt,
        idempotencyKey: effectiveIdempotencyKey,
      })
      .returning();

    const newUsed = currentUsed + 1;

    // 7. Update persistent format_conversions_used counter on users table
    await tx
      .update(users)
      .set({
        formatConversionsUsed: newUsed,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, actualUserId));

    const remaining = planInfo.unlimited
      ? null
      : Math.max(0, planInfo.conversionLimit! - newUsed);

    return {
      success: true,
      statusCode: 200,
      data: {
        allowed: true,
        duplicate: false,
        plan: planInfo.plan,
        feature: "format_conversion",
        operationId: inserted.id,
        inputFormat: inserted.inputFormat,
        outputFormat: inserted.outputFormat,
        used: newUsed,
        limit: planInfo.conversionLimit,
        remaining,
        unlimited: planInfo.unlimited,
        period: planInfo.period,
        periodStart: planInfo.periodStart?.toISOString() ?? null,
        periodEnd: planInfo.periodEnd?.toISOString() ?? null,
      },
    };
  });
}
