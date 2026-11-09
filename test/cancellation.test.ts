import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import { installations, subscriptions, users } from "../src/db/schema.js";
import { paddle } from "../src/lib/paddle.js";
import { v3Routes } from "../src/routes/v3/index.js";
import {
  revokePaddleSubscription,
  upsertPaddleSubscription,
} from "../src/services/subscription.js";

describe("Self-Service Subscription Cancellation — MeshyGrab", () => {
  let app: ReturnType<typeof Fastify>;
  let testUser: { id: string; email: string };
  let otherUser: { id: string; email: string };
  let testInstallationId: string;
  let otherInstallationId: string;

  const mockPaddleSession = {
    id: "cpt_session_123",
    customerId: "ctm_test_customer_1",
    urls: {
      general: {
        overview: "https://customer-portal.paddle.com/overview",
      },
      subscriptions: [
        {
          id: "sub_test_123",
          cancelSubscription:
            "https://customer-portal.paddle.com/sub_test_123/cancel",
          updateSubscriptionPaymentMethod:
            "https://customer-portal.paddle.com/sub_test_123/update-payment",
        },
      ],
    },
    createdAt: new Date().toISOString(),
  };

  const originalPortalCreate = paddle.customerPortalSessions?.create;
  let portalCreateCalls: Array<{
    customerId: string;
    subscriptionIds: string[];
  }> = [];
  let shouldPortalFail = false;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(v3Routes, { prefix: "/v3" });
    await app.ready();

    // Mock Paddle customer portal session creation
    if (!paddle.customerPortalSessions) {
      (paddle as any).customerPortalSessions = {};
    }
    paddle.customerPortalSessions.create = (async (
      customerId: string,
      subscriptionIds: string[],
    ) => {
      portalCreateCalls.push({ customerId, subscriptionIds });
      if (shouldPortalFail) {
        throw new Error("Paddle API Gateway Timeout");
      }
      return {
        ...mockPaddleSession,
        customerId,
        urls: {
          ...mockPaddleSession.urls,
          subscriptions: subscriptionIds.map((subId) => ({
            id: subId,
            cancelSubscription: `https://customer-portal.paddle.com/${subId}/cancel`,
            updateSubscriptionPaymentMethod: `https://customer-portal.paddle.com/${subId}/update`,
          })),
        },
      } as any;
    }) as any;

    const timestamp = Date.now();

    // Create primary test user
    const [inserted] = await db
      .insert(users)
      .values({
        email: `test_cancel_${timestamp}@example.com`,
      })
      .returning({ id: users.id, email: users.email });

    testUser = { id: inserted.id, email: inserted.email! };
    testInstallationId = `inst_cancel_${timestamp}`;
    await db.insert(installations).values({
      installationId: testInstallationId,
      userId: testUser.id,
    });

    // Create a secondary user for cross-account mismatch tests
    const [insertedOther] = await db
      .insert(users)
      .values({
        email: `other_cancel_${timestamp}@example.com`,
      })
      .returning({ id: users.id, email: users.email });

    otherUser = { id: insertedOther.id, email: insertedOther.email! };
    otherInstallationId = `inst_other_${timestamp}`;
    await db.insert(installations).values({
      installationId: otherInstallationId,
      userId: otherUser.id,
    });
  });

  after(async () => {
    if (originalPortalCreate) {
      paddle.customerPortalSessions.create = originalPortalCreate;
    }

    if (testInstallationId) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, testInstallationId));
    }
    if (otherInstallationId) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, otherInstallationId));
    }

    if (testUser?.id) {
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, testUser.id));
      await db.delete(users).where(eq(users.id, testUser.id));
    }

    if (otherUser?.id) {
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, otherUser.id));
      await db.delete(users).where(eq(users.id, otherUser.id));
    }

    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    portalCreateCalls = [];
    shouldPortalFail = false;

    // Reset testUser DB state
    await db.delete(subscriptions).where(eq(subscriptions.userId, testUser.id));
    await db
      .update(users)
      .set({
        isPaid: false,
        plan: null,
        paddleCustomerId: null,
        paddleSubscriptionId: null,
      })
      .where(eq(users.id, testUser.id));
  });

  test("1. Pro Monthly cancellation generates valid Paddle portal session URL", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_monthly_001",
      paddleSubscriptionId: "sub_monthly_001",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(
      body.url,
      "https://customer-portal.paddle.com/sub_monthly_001/cancel",
    );
    assert.equal(body.cancelSubscriptionUrl, body.url);
    assert.equal(portalCreateCalls.length, 1);
    assert.equal(portalCreateCalls[0].customerId, "ctm_monthly_001");
    assert.deepEqual(portalCreateCalls[0].subscriptionIds, ["sub_monthly_001"]);
  });

  test("2. Pro Max cancellation generates valid Paddle portal session URL", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_max_monthly",
      paddleCustomerId: "ctm_promax_001",
      paddleSubscriptionId: "sub_promax_001",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(
      body.url,
      "https://customer-portal.paddle.com/sub_promax_001/cancel",
    );
    assert.equal(portalCreateCalls.length, 1);
    assert.equal(portalCreateCalls[0].customerId, "ctm_promax_001");
    assert.deepEqual(portalCreateCalls[0].subscriptionIds, ["sub_promax_001"]);
  });

  test("3. Annual cancellation generates valid Paddle portal session URL", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_annual",
      paddleCustomerId: "ctm_annual_001",
      paddleSubscriptionId: "sub_annual_001",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(
      body.url,
      "https://customer-portal.paddle.com/sub_annual_001/cancel",
    );
    assert.equal(portalCreateCalls.length, 1);
    assert.equal(portalCreateCalls[0].customerId, "ctm_annual_001");
    assert.deepEqual(portalCreateCalls[0].subscriptionIds, ["sub_annual_001"]);
  });

  test("4. Free and Lifetime rejection (400 INVALID_PLAN)", async () => {
    // 4a. Free user (no subscription)
    const resFree = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });
    assert.equal(resFree.statusCode, 400);
    assert.equal(resFree.json().error, "INVALID_PLAN");

    // 4b. Lifetime user
    await db
      .update(users)
      .set({
        isPaid: true,
        plan: "lifetime",
        paddleCustomerId: "ctm_lifetime_999",
      })
      .where(eq(users.id, testUser.id));

    const resLifetime = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });
    assert.equal(resLifetime.statusCode, 400);
    assert.equal(resLifetime.json().error, "INVALID_PLAN");
  });

  test("5. Already scheduled cancellation rejection (400 CANCELLATION_ALREADY_SCHEDULED)", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_sched_001",
      paddleSubscriptionId: "sub_sched_001",
      status: "active",
      cancelAtPeriodEnd: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "CANCELLATION_ALREADY_SCHEDULED");
    assert.equal(portalCreateCalls.length, 0);
  });

  test("6. Already canceled and inactive subscription rejection (400)", async () => {
    // 6a. Explicit canceled status
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_canc_001",
      paddleSubscriptionId: "sub_canc_001",
      status: "canceled",
      cancelAtPeriodEnd: false,
    });

    const resCanceled = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });
    assert.equal(resCanceled.statusCode, 400);
    assert.equal(resCanceled.json().error, "SUBSCRIPTION_ALREADY_CANCELED");

    // 6b. Inactive status
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_inact_001",
      paddleSubscriptionId: "sub_inact_001",
      status: "past_due",
      cancelAtPeriodEnd: false,
    });

    const resInactive = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });
    assert.equal(resInactive.statusCode, 400);
    assert.equal(resInactive.json().error, "SUBSCRIPTION_NOT_ACTIVE");
  });

  test("7. Invalid or mismatched subscription ownership & client IDs", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_legit_001",
      paddleSubscriptionId: "sub_legit_001",
      status: "active",
    });

    // 7a. Mismatched paddleCustomerId supplied by frontend -> 403
    const resMismatchedCust = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
        paddleCustomerId: "ctm_hacker_evil",
      },
    });
    assert.equal(resMismatchedCust.statusCode, 403);
    assert.equal(resMismatchedCust.json().error, "UNAUTHORIZED");

    // 7b. Mismatched paddleSubscriptionId supplied by frontend -> 403
    const resMismatchedSub = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
        paddleSubscriptionId: "sub_someone_else_001",
      },
    });
    assert.equal(resMismatchedSub.statusCode, 403);
    assert.equal(resMismatchedSub.json().error, "UNAUTHORIZED");

    // 7c. Mismatched userId and installationId -> 403
    const resCrossUser = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: otherUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });
    assert.equal(resCrossUser.statusCode, 403);
    assert.equal(resCrossUser.json().error, "MISMATCHED_INSTALLATION");
  });

  test("7d. Missing email in request body -> 400 Bad Request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        installationId: testInstallationId,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test("7e. Missing installationId in request body -> 400 Bad Request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        email: testUser.email,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test("7f. Invalid email format in request body -> 400 Bad Request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        installationId: testInstallationId,
        email: "invalid-email-not-an-address",
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test("7g. Mismatched email (does not match installation user) -> 403 EMAIL_MISMATCH", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        installationId: testInstallationId,
        email: "completely_unrelated@example.com",
      },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, "EMAIL_MISMATCH");
  });

  test("7h. Mismatched installation (unknown installationId) -> 404 INSTALLATION_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        installationId: "inst_non_existent_random_id",
        email: testUser.email,
      },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "INSTALLATION_NOT_FOUND");
  });

  test("7i. Valid request with case-insensitive email comparison succeeds -> 200", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_case_001",
      paddleSubscriptionId: "sub_case_001",
      status: "active",
      cancelAtPeriodEnd: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        installationId: testInstallationId,
        email: ` ${testUser.email.toUpperCase()} `,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(
      body.url,
      "https://customer-portal.paddle.com/sub_case_001/cancel",
    );
    assert.equal(body.cancelSubscriptionUrl, body.url);
  });

  test("8. Paddle portal session failure returns 502 without crashing", async () => {
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_fail_001",
      paddleSubscriptionId: "sub_fail_001",
      status: "active",
    });

    shouldPortalFail = true;

    const res = await app.inject({
      method: "POST",
      url: "/v3/subscription/cancel",
      payload: {
        userId: testUser.id,
        installationId: testInstallationId,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error, "PADDLE_PORTAL_SESSION_FAILED");
  });

  test("9. Webhook synchronization after cancellation scheduling (cancelAtPeriodEnd)", async () => {
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    // Initial active subscription without cancellation
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_sync_001",
      paddleSubscriptionId: "sub_sync_001",
      status: "active",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    // Verify initial entitlement
    let entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?userId=${testUser.id}&installationId=${testInstallationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    let ent = entRes.json();
    assert.equal(ent.plan, "pro_monthly");
    assert.equal(ent.isPaid, true);
    assert.equal(ent.cancelAtPeriodEnd, false);

    // Webhook receives SubscriptionUpdated with scheduledChange.action = 'cancel'
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_sync_001",
      paddleSubscriptionId: "sub_sync_001",
      status: "active",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });

    // User is STILL paid and plan is preserved while current billing period is active
    const [dbSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, testUser.id));

    assert.equal(dbSub.cancelAtPeriodEnd, true);
    assert.equal(dbSub.status, "active");
    assert.equal(dbUser.isPaid, true);
    assert.equal(dbUser.plan, "pro_monthly");

    // Entitlement returns cancellation scheduled status and billing period end date
    entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?userId=${testUser.id}&installationId=${testInstallationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    ent = entRes.json();
    assert.equal(ent.plan, "pro_monthly");
    assert.equal(ent.isPaid, true);
    assert.equal(ent.cancelAtPeriodEnd, true);
    assert.ok(ent.currentPeriodEnd);

    // If cancellation is resumed (action !== 'cancel'), cancelAtPeriodEnd resets to false
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_sync_001",
      paddleSubscriptionId: "sub_sync_001",
      status: "active",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    const [resumedSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));
    assert.equal(resumedSub.cancelAtPeriodEnd, false);
  });

  test("10. Actual cancellation at billing-period expiration (revokePaddleSubscription)", async () => {
    // Start with scheduled cancellation active
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_expire_001",
      paddleSubscriptionId: "sub_expire_001",
      status: "active",
      cancelAtPeriodEnd: true,
    });

    // Revoke at period expiration
    await revokePaddleSubscription({
      userId: testUser.id,
      paddleSubscriptionId: "sub_expire_001",
    });

    const [finalSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));
    const [finalUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, testUser.id));

    // Subscription status marked canceled, cancelAtPeriodEnd reset to false, historical sub kept
    assert.ok(finalSub, "Historical subscription record must be preserved");
    assert.equal(finalSub.status, "canceled");
    assert.equal(finalSub.cancelAtPeriodEnd, false);
    assert.equal(finalSub.plan, "pro_monthly"); // preserved historical plan

    // User entitlement reverted to Free only upon actual cancellation
    assert.equal(finalUser.isPaid, false);
    assert.equal(finalUser.plan, null);

    // Entitlement endpoint returns free status
    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?userId=${testUser.id}&installationId=${testInstallationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    const ent = entRes.json();
    assert.equal(ent.plan, "free");
    assert.equal(ent.isPaid, false);
    assert.equal(ent.subscriptionStatus, "canceled");
    assert.equal(ent.cancelAtPeriodEnd, false);
  });
});
