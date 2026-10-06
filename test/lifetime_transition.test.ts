import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import { subscriptions, users } from "../src/db/schema.js";
import { paddle } from "../src/lib/paddle.js";
import {
  revokePaddleSubscription,
  setUserLifetimePlan,
  upsertPaddleSubscription,
} from "../src/services/subscription.js";

describe("Lifetime Subscription Transition & Billing State Consistency", () => {
  let testUser: { id: string; email: string };
  let canceledSubIds: string[] = [];
  const originalCancel = paddle.subscriptions.cancel;

  before(async () => {
    // Override Paddle SDK cancel method for testing
    paddle.subscriptions.cancel = async (subId: string, options?: any) => {
      canceledSubIds.push(subId);
      return {} as any;
    };

    const testEmail = `test_lifetime_${Date.now()}@example.com`;
    const [inserted] = await db
      .insert(users)
      .values({
        email: testEmail,
      })
      .returning({
        id: users.id,
        email: users.email,
      });

    testUser = {
      id: inserted.id,
      email: inserted.email!,
    };
  });

  after(async () => {
    paddle.subscriptions.cancel = originalCancel;

    if (testUser?.id) {
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, testUser.id));
      await db.delete(users).where(eq(users.id, testUser.id));
    }
    await pool.end();
  });

  beforeEach(async () => {
    canceledSubIds = [];
    // Reset user state to clean free user
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

  test("Test 1 — Direct Lifetime Purchase (Free → Lifetime)", async () => {
    await setUserLifetimePlan(testUser.id, "ctm_direct_123");

    const [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));

    assert.equal(u.plan, "lifetime");
    assert.equal(u.isPaid, true);
    assert.equal(u.paddleSubscriptionId, null);
    assert.equal(u.paddleCustomerId, "ctm_direct_123");

    // No recurring subscription row should be created for direct lifetime
    assert.equal(sub, undefined);
    // Paddle cancel should NOT have been called
    assert.equal(canceledSubIds.length, 0);
  });

  test("Test 2 — Pro Monthly → Lifetime Transition", async () => {
    const oldSubId = `sub_monthly_${Date.now()}`;
    const priceId = "pri_monthly_123";

    // Setup active Pro Monthly subscription
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_monthly_123",
      paddleSubscriptionId: oldSubId,
      paddlePriceId: priceId,
      status: "active",
    });

    // Verify initial active state
    let [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    assert.equal(u.plan, "pro_monthly");
    assert.equal(u.paddleSubscriptionId, oldSubId);

    // Transition to Lifetime
    await setUserLifetimePlan(testUser.id, "ctm_monthly_123");

    [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));

    // User table asserts
    assert.equal(u.plan, "lifetime");
    assert.equal(u.isPaid, true);
    assert.equal(u.paddleSubscriptionId, null);

    // Subscriptions table asserts
    assert.equal(sub.plan, "pro_monthly"); // Historical plan preserved
    assert.equal(sub.status, "canceled");
    assert.equal(sub.paddleSubscriptionId, oldSubId);

    // Paddle SDK cancel asserts
    assert.deepEqual(canceledSubIds, [oldSubId]);
  });

  test("Test 3 — Pro Max Monthly → Lifetime Transition", async () => {
    const oldSubId = `sub_promax_${Date.now()}`;

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_max_monthly",
      paddleCustomerId: "ctm_promax_123",
      paddleSubscriptionId: oldSubId,
      status: "active",
    });

    await setUserLifetimePlan(testUser.id, "ctm_promax_123");

    const [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));

    assert.equal(u.plan, "lifetime");
    assert.equal(u.paddleSubscriptionId, null);
    assert.equal(sub.plan, "pro_max_monthly"); // Historical plan preserved
    assert.equal(sub.status, "canceled");
    assert.deepEqual(canceledSubIds, [oldSubId]);
  });

  test("Test 4 — Annual → Lifetime Transition", async () => {
    const oldSubId = `sub_annual_${Date.now()}`;

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_annual",
      paddleCustomerId: "ctm_annual_123",
      paddleSubscriptionId: oldSubId,
      status: "active",
    });

    await setUserLifetimePlan(testUser.id, "ctm_annual_123");

    const [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, testUser.id));

    assert.equal(u.plan, "lifetime");
    assert.equal(u.paddleSubscriptionId, null);
    assert.equal(sub.plan, "pro_annual"); // Historical plan preserved
    assert.equal(sub.status, "canceled");
    assert.deepEqual(canceledSubIds, [oldSubId]);
  });

  test("Test 5 — Old subscription.canceled webhook after Lifetime", async () => {
    const oldSubId = `sub_cancel_test_${Date.now()}`;

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_cancel_123",
      paddleSubscriptionId: oldSubId,
      status: "active",
    });

    await setUserLifetimePlan(testUser.id, "ctm_cancel_123");

    // Simulate delayed subscription.canceled webhook
    await revokePaddleSubscription({
      userId: testUser.id,
      paddleSubscriptionId: oldSubId,
    });

    const [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    assert.equal(u.plan, "lifetime");
    assert.equal(u.isPaid, true);
    assert.equal(u.paddleSubscriptionId, null);
  });

  test("Test 6 — Old subscription.updated webhook after Lifetime", async () => {
    const oldSubId = `sub_update_test_${Date.now()}`;

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_update_123",
      paddleSubscriptionId: oldSubId,
      status: "active",
    });

    await setUserLifetimePlan(testUser.id, "ctm_update_123");

    // Simulate out-of-order subscription.updated webhook
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_update_123",
      paddleSubscriptionId: oldSubId,
      status: "active",
    });

    const [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    assert.equal(u.plan, "lifetime");
    assert.equal(u.isPaid, true);
    assert.equal(u.paddleSubscriptionId, null);
  });

  test("Test 7 — Recurring → Recurring Transition Unchanged", async () => {
    const subId1 = `sub_rec_1_${Date.now()}`;

    // 1. User signs up for Pro Monthly
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "ctm_rec_123",
      paddleSubscriptionId: subId1,
      status: "active",
    });

    let [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    assert.equal(u.plan, "pro_monthly");
    assert.equal(u.paddleSubscriptionId, subId1);

    // 2. User upgrades to Pro Max Monthly
    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_max_monthly",
      paddleCustomerId: "ctm_rec_123",
      paddleSubscriptionId: subId1,
      status: "active",
    });

    [u] = await db.select().from(users).where(eq(users.id, testUser.id));
    assert.equal(u.plan, "pro_max_monthly");
    assert.equal(u.paddleSubscriptionId, subId1);
  });
});
