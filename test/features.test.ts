import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq, and } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import {
  users,
  installations,
  subscriptions,
  featureUsages,
} from "../src/db/schema.js";
import { v3Routes } from "../src/routes/v3/index.js";
import {
  resolveFeaturePlan,
  getFeaturesEntitlement,
  consumeUpscale,
  consumeFormatConversion,
} from "../src/services/features.js";
import { ERROR_CODES } from "../src/config/errors.js";

describe("MeshyGrab 4K/8K Upscaling and 3D Format Conversion Tests", () => {
  let app: ReturnType<typeof Fastify>;
  const createdUserIds: string[] = [];
  const createdInstallationIds: string[] = [];

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(v3Routes, { prefix: "/v3" });
    await app.ready();
  });

  after(async () => {
    // Clean up all created test users and related records
    for (const instId of createdInstallationIds) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, instId));
    }
    for (const userId of createdUserIds) {
      await db.delete(featureUsages).where(eq(featureUsages.userId, userId));
      await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await app.close();
    await pool.end();
  });

  async function createTestUserWithPlan(params: {
    plan:
      | "free"
      | "pro_monthly"
      | "pro_max_monthly"
      | "pro_annual"
      | "lifetime";
    isPaid?: boolean;
    subStatus?: string;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
  }) {
    const email = `test_feat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}@example.com`;
    const instId = `inst_feat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const isPaid = params.isPaid ?? params.plan !== "free";

    const [user] = await db
      .insert(users)
      .values({
        email,
        isPaid,
        plan: params.plan === "free" ? null : params.plan,
        upscalesUsed: 0,
        formatConversionsUsed: 0,
      })
      .returning();

    createdUserIds.push(user.id);

    await db.insert(installations).values({
      installationId: instId,
      userId: user.id,
    });
    createdInstallationIds.push(instId);

    if (params.plan !== "free" && params.plan !== "lifetime") {
      const now = new Date();
      const pStart =
        params.currentPeriodStart !== undefined
          ? params.currentPeriodStart
          : new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const pEnd =
        params.currentPeriodEnd !== undefined
          ? params.currentPeriodEnd
          : new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);

      await db.insert(subscriptions).values({
        userId: user.id,
        plan: params.plan,
        status: params.subStatus ?? "active",
        currentPeriodStart: pStart,
        currentPeriodEnd: pEnd,
      });
    } else if (params.plan === "free" && params.subStatus) {
      await db.insert(subscriptions).values({
        userId: user.id,
        plan: "free",
        status: params.subStatus,
        currentPeriodStart: params.currentPeriodStart ?? null,
        currentPeriodEnd: params.currentPeriodEnd ?? null,
      });
    }

    return { user, installationId: instId };
  }

  // 1. New and existing users receive valid entitlement responses
  test("1. Entitlement returns valid feature fields for both new/nonexistent and existing users", async () => {
    // Nonexistent installation
    const unknownRes = await app.inject({
      method: "GET",
      url: "/v3/entitlement?installationId=nonexistent_unknown_12345",
    });
    assert.equal(unknownRes.statusCode, 200);
    const unknownBody = unknownRes.json();
    assert.equal(unknownBody.exists, false);
    assert.ok(unknownBody.features);
    assert.deepEqual(unknownBody.features.upscaling, {
      available: false,
      limit: null,
      used: 0,
      remaining: null,
      unlimited: false,
      period: null,
      periodStart: null,
      periodEnd: null,
    });
    assert.deepEqual(unknownBody.features.formatConversion, {
      available: false,
      limit: null,
      used: 0,
      remaining: null,
      unlimited: false,
      period: null,
      periodStart: null,
      periodEnd: null,
    });

    // Check alias /v3/api/user/status works identically
    const aliasRes = await app.inject({
      method: "GET",
      url: "/v3/api/user/status?installationId=nonexistent_unknown_12345",
    });
    assert.equal(aliasRes.statusCode, 200);
    assert.deepEqual(aliasRes.json().features, unknownBody.features);

    // Existing Pro Max user
    const { installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
    });

    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    const entBody = entRes.json();
    assert.equal(entBody.exists, true);
    assert.equal(entBody.features.upscaling.available, true);
    assert.equal(entBody.features.upscaling.limit, 3);
    assert.equal(entBody.features.upscaling.used, 0);
    assert.equal(entBody.features.upscaling.remaining, 3);
    assert.equal(entBody.features.upscaling.unlimited, false);
    assert.equal(entBody.features.upscaling.period, "monthly");
    assert.ok(entBody.features.upscaling.periodStart);
    assert.ok(entBody.features.upscaling.periodEnd);

    assert.equal(entBody.features.formatConversion.available, true);
    assert.equal(entBody.features.formatConversion.limit, 5);
    assert.equal(entBody.features.formatConversion.used, 0);
    assert.equal(entBody.features.formatConversion.remaining, 5);
    assert.equal(entBody.features.formatConversion.unlimited, false);
    assert.equal(entBody.features.formatConversion.period, "monthly");
  });

  // 2. Free users cannot consume either feature
  test("2. Free users cannot consume upscaling or format conversion", async () => {
    const { installationId } = await createTestUserWithPlan({
      plan: "free",
      isPaid: false,
    });

    // Upscale attempt
    const upRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "4k",
      },
    });
    assert.equal(upRes.statusCode, 403);
    const upBody = upRes.json();
    assert.equal(upBody.error, ERROR_CODES.FEATURE_ACCESS_DENIED);

    // Format conversion attempt
    const convRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: {
        installationId,
        inputFormat: "glb",
        outputFormat: "obj",
      },
    });
    assert.equal(convRes.statusCode, 403);
    const convBody = convRes.json();
    assert.equal(convBody.error, ERROR_CODES.FEATURE_ACCESS_DENIED);

    // Entitlement status reflects available: false
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.json().features.upscaling.available, false);
    assert.equal(entRes.json().features.formatConversion.available, false);
  });

  // 3. Pro Monthly users cannot consume either feature
  test("3. Pro Monthly users cannot consume either feature even though isPaid is true", async () => {
    const { installationId } = await createTestUserWithPlan({
      plan: "pro_monthly",
      isPaid: true,
      subStatus: "active",
    });

    // Upscale attempt
    const upRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "8k",
      },
    });
    assert.equal(upRes.statusCode, 403);
    assert.equal(upRes.json().error, ERROR_CODES.FEATURE_ACCESS_DENIED);

    // Format conversion attempt
    const convRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: {
        installationId,
        inputFormat: "obj",
        outputFormat: "fbx",
      },
    });
    assert.equal(convRes.statusCode, 403);
    assert.equal(convRes.json().error, ERROR_CODES.FEATURE_ACCESS_DENIED);

    // Entitlement status reflects available: false
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.json().features.upscaling.available, false);
    assert.equal(entRes.json().features.formatConversion.available, false);
  });

  // 4. Pro Max permits exactly 3 upscales and 5 conversions per monthly period
  test("4. Pro Max permits exactly 3 upscales and 5 conversions per monthly period", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    // Perform 3 successful upscales
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v3/upscales/consume",
        payload: {
          installationId,
          resolution: i % 2 === 0 ? "8k" : "4k",
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.allowed, true);
      assert.equal(body.used, i);
      assert.equal(body.limit, 3);
      assert.equal(body.remaining, 3 - i);
      assert.equal(body.period, "monthly");
    }

    // 4th upscale attempt must be rejected with 403
    const blockedUpRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "4k",
      },
    });
    assert.equal(blockedUpRes.statusCode, 403);
    assert.equal(
      blockedUpRes.json().error,
      ERROR_CODES.UPSCALING_QUOTA_EXHAUSTED,
    );
    assert.equal(blockedUpRes.json().used, 3);
    assert.equal(blockedUpRes.json().remaining, 0);

    // Perform 5 successful format conversions
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v3/conversions/consume",
        payload: {
          installationId,
          inputFormat: "glb",
          outputFormat: "stl",
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.allowed, true);
      assert.equal(body.used, i);
      assert.equal(body.limit, 5);
      assert.equal(body.remaining, 5 - i);
      assert.equal(body.period, "monthly");
    }

    // 6th conversion attempt must be rejected with 403
    const blockedConvRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: {
        installationId,
        inputFormat: "stl",
        outputFormat: "obj",
      },
    });
    assert.equal(blockedConvRes.statusCode, 403);
    assert.equal(
      blockedConvRes.json().error,
      ERROR_CODES.CONVERSION_QUOTA_EXHAUSTED,
    );
    assert.equal(blockedConvRes.json().used, 5);
    assert.equal(blockedConvRes.json().remaining, 0);

    // Check user table counters match
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(updatedUser.upscalesUsed, 3);
    assert.equal(updatedUser.formatConversionsUsed, 5);
  });

  // 5. Annual permits exactly 40 upscales and 75 conversions per annual period
  test("5. Annual plan permits exactly 40 upscales and 75 conversions", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_annual",
      isPaid: true,
      subStatus: "active",
    });

    // Check initial entitlement
    const initialEnt = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    const entBody = initialEnt.json();
    assert.equal(entBody.features.upscaling.limit, 40);
    assert.equal(entBody.features.upscaling.remaining, 40);
    assert.equal(entBody.features.upscaling.period, "annual");
    assert.equal(entBody.features.formatConversion.limit, 75);
    assert.equal(entBody.features.formatConversion.remaining, 75);
    assert.equal(entBody.features.formatConversion.period, "annual");

    // Consume 1 upscale and 1 conversion
    const upRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId, resolution: "4k" },
    });
    assert.equal(upRes.statusCode, 200);
    assert.equal(upRes.json().used, 1);
    assert.equal(upRes.json().remaining, 39);

    const convRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: { installationId, inputFormat: "glb", outputFormat: "3mf" },
    });
    assert.equal(convRes.statusCode, 200);
    assert.equal(convRes.json().used, 1);
    assert.equal(convRes.json().remaining, 74);
  });

  // 6. Lifetime can exceed both finite plan limits without being blocked
  test("6. Lifetime users have unlimited access and can exceed finite limits", async () => {
    const { installationId } = await createTestUserWithPlan({
      plan: "lifetime",
      isPaid: true,
    });

    // Check entitlement response
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    const entBody = entRes.json();
    assert.equal(entBody.features.upscaling.available, true);
    assert.equal(entBody.features.upscaling.limit, null);
    assert.equal(entBody.features.upscaling.remaining, null);
    assert.equal(entBody.features.upscaling.unlimited, true);
    assert.equal(entBody.features.upscaling.period, "lifetime");

    assert.equal(entBody.features.formatConversion.available, true);
    assert.equal(entBody.features.formatConversion.limit, null);
    assert.equal(entBody.features.formatConversion.remaining, null);
    assert.equal(entBody.features.formatConversion.unlimited, true);
    assert.equal(entBody.features.formatConversion.period, "lifetime");

    // Consume 4 upscales (exceeding Pro Max limit of 3)
    for (let i = 1; i <= 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v3/upscales/consume",
        payload: { installationId, resolution: "8k" },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.allowed, true);
      assert.equal(body.used, i);
      assert.equal(body.limit, null);
      assert.equal(body.remaining, null);
      assert.equal(body.unlimited, true);
    }

    // Consume 6 conversions (exceeding Pro Max limit of 5)
    for (let i = 1; i <= 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v3/conversions/consume",
        payload: { installationId, inputFormat: "obj", outputFormat: "stl" },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().allowed, true);
      assert.equal(res.json().used, i);
      assert.equal(res.json().limit, null);
      assert.equal(res.json().remaining, null);
      assert.equal(res.json().unlimited, true);
    }
  });

  // 7. Both 4K and 8K consume the same upscale quota
  test("7. Both 4K and 8K consume from the same shared upscale counter", async () => {
    const { installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    const res4k = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId, resolution: "4k" },
    });
    assert.equal(res4k.statusCode, 200);
    assert.equal(res4k.json().used, 1);
    assert.equal(res4k.json().resolution, "4k");

    const res8k = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId, resolution: "8k" },
    });
    assert.equal(res8k.statusCode, 200);
    assert.equal(res8k.json().used, 2);
    assert.equal(res8k.json().remaining, 1);
    assert.equal(res8k.json().resolution, "8k");
  });

  // 8. Input/output formats are recorded correctly and validated
  test("8. Input/output formats are validated and recorded correctly", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    // Unsupported input format
    const badFmtRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: { installationId, inputFormat: "exe", outputFormat: "obj" },
    });
    assert.equal(badFmtRes.statusCode, 400);

    // Identical input and output format (no-op conversion)
    const identicalRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: { installationId, inputFormat: "glb", outputFormat: "glb" },
    });
    assert.equal(identicalRes.statusCode, 400);
    assert.equal(identicalRes.json().error, ERROR_CODES.INVALID_CONVERSION);

    // Valid conversion
    const validRes = await app.inject({
      method: "POST",
      url: "/v3/conversions/consume",
      payload: { installationId, inputFormat: "glb", outputFormat: "3mf" },
    });
    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.json().inputFormat, "glb");
    assert.equal(validRes.json().outputFormat, "3mf");

    // Check DB record in feature_usages
    const [usageRecord] = await db
      .select()
      .from(featureUsages)
      .where(
        and(
          eq(featureUsages.userId, user.id),
          eq(featureUsages.featureType, "format_conversion"),
        ),
      );
    assert.ok(usageRecord);
    assert.equal(usageRecord.inputFormat, "glb");
    assert.equal(usageRecord.outputFormat, "3mf");
  });

  // 9. Failed operations do not incorrectly consume quota where failure can be established
  test("9. Failed operations (client error or invalid params) do not consume quota", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    // Client-reported failure
    const failRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "4k",
        status: "failed",
        success: false,
      },
    });
    assert.equal(failRes.statusCode, 400);

    // Invalid resolution
    const badRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "16k",
      },
    });
    assert.equal(badRes.statusCode, 400);

    // Ensure 0 quota was consumed
    const [currentUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(currentUser.upscalesUsed, 0);

    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.json().features.upscaling.used, 0);
    assert.equal(entRes.json().features.upscaling.remaining, 3);
  });

  // 10. Duplicate retries do not double-count operations (Idempotency)
  test("10. Duplicate retries with same idempotencyKey do not double count", async () => {
    const { installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    const key = `idemp_test_${Date.now()}`;

    // First request
    const firstRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "4k",
        idempotencyKey: key,
      },
    });
    assert.equal(firstRes.statusCode, 200);
    const firstBody = firstRes.json();
    assert.equal(firstBody.duplicate, false);
    assert.equal(firstBody.used, 1);
    assert.equal(firstBody.remaining, 2);

    // Retry request with same key
    const retryRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId,
        resolution: "4k",
        idempotencyKey: key,
      },
    });
    assert.equal(retryRes.statusCode, 200);
    const retryBody = retryRes.json();
    assert.equal(retryBody.duplicate, true);
    assert.equal(retryBody.operationId, firstBody.operationId);
    assert.equal(retryBody.used, 1);
    assert.equal(retryBody.remaining, 2);
  });

  // 11. Concurrent requests cannot exceed finite limits
  test("11. Concurrent parallel requests cannot exceed finite quota limit", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
    });

    // Send 5 parallel requests on a plan with limit 3
    const promises = Array.from({ length: 5 }).map(() =>
      app.inject({
        method: "POST",
        url: "/v3/upscales/consume",
        payload: {
          installationId,
          resolution: "4k",
        },
      }),
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.statusCode === 200).length;
    const blockedCount = results.filter((r) => r.statusCode === 403).length;

    assert.equal(successCount, 3, "Exactly 3 requests should succeed");
    assert.equal(
      blockedCount,
      2,
      "Remaining 2 requests should be blocked with 403",
    );

    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(updatedUser.upscalesUsed, 3);
  });

  // 12. Usage resets correctly at billing-period boundaries, including subscription renewal
  test("12. Usage resets correctly when subscription period renews", async () => {
    const now = new Date();
    // Prior billing period: 35 days ago to 5 days ago
    const oldPeriodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const oldPeriodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
      currentPeriodStart: oldPeriodStart,
      currentPeriodEnd: oldPeriodEnd,
    });

    // Add 3 feature usages in the old period (e.g. 10 days ago)
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      await db.insert(featureUsages).values({
        userId: user.id,
        featureType: "upscale",
        resolution: "4k",
        createdAt: oldDate,
      });
    }

    // Now subscription renews: new period starts 2 days ago
    const newPeriodStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const newPeriodEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);

    await db
      .update(subscriptions)
      .set({
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
      })
      .where(eq(subscriptions.userId, user.id));

    // Entitlement should now show 0 used, 3 remaining in the new period!
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    const entBody = entRes.json();
    assert.equal(entBody.features.upscaling.used, 0);
    assert.equal(entBody.features.upscaling.remaining, 3);

    // Consuming upscale in new period succeeds
    const upRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId, resolution: "4k" },
    });
    assert.equal(upRes.statusCode, 200);
    assert.equal(upRes.json().used, 1);
    assert.equal(upRes.json().remaining, 2);
  });

  // 13. Expired, canceled, past-due subscriptions do not accidentally gain feature access
  test("13. Canceled, past-due, or expired subscriptions cannot consume features", async () => {
    // A: Canceled subscription
    const canceled = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: false,
      subStatus: "canceled",
    });
    const cancelRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId: canceled.installationId, resolution: "4k" },
    });
    assert.equal(cancelRes.statusCode, 403);

    // B: Past-due subscription
    const pastDue = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "past_due",
    });
    const pastDueRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId: pastDue.installationId, resolution: "4k" },
    });
    assert.equal(pastDueRes.statusCode, 403);

    // C: Expired subscription (currentPeriodEnd in the past)
    const expired = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
      currentPeriodStart: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const expiredRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId: expired.installationId, resolution: "4k" },
    });
    assert.equal(expiredRes.statusCode, 403);
  });

  // 14. Missing or invalid subscription-period dates do not grant extra quota
  test("14. Missing or invalid subscription-period dates use safe fallback and do not grant extra quota", async () => {
    const { user, installationId } = await createTestUserWithPlan({
      plan: "pro_max_monthly",
      isPaid: true,
      subStatus: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    // Consume 3 operations
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v3/upscales/consume",
        payload: { installationId, resolution: "4k" },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().used, i);
    }

    // 4th operation must still be blocked (it must NOT reset merely because period info is missing!)
    const fourthRes = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: { installationId, resolution: "4k" },
    });
    assert.equal(fourthRes.statusCode, 403);
    assert.equal(fourthRes.json().error, ERROR_CODES.UPSCALING_QUOTA_EXHAUSTED);

    // Entitlement also reflects 3 used, 0 remaining
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${installationId}`,
    });
    assert.equal(entRes.json().features.upscaling.used, 3);
    assert.equal(entRes.json().features.upscaling.remaining, 0);
  });

  // 15. Unknown installation ID rejection
  test("15. Unknown installation ID returns 404 INSTALLATION_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/upscales/consume",
      payload: {
        installationId: "unknown_inst_999999",
        resolution: "4k",
      },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, ERROR_CODES.INSTALLATION_NOT_FOUND);
  });
});
