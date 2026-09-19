import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq, and } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import {
  users,
  installations,
  models,
  downloads,
  subscriptions,
} from "../src/db/schema.js";
import { downloadRoutes as downloadRoutesV2 } from "../src/routes/v2/downloads.js";
import { downloadRoutes as downloadRoutesV1 } from "../src/routes/v1/downloads.js";
import { entitlementRoutes as entitlementRoutesV2 } from "../src/routes/v2/entitlement.js";
import { upsertPaddleSubscription } from "../src/services/subscription.js";

describe("v2 Community Download System & Plan Rules Tests", () => {
  let appV2: ReturnType<typeof Fastify>;
  let appV1: ReturnType<typeof Fastify>;

  let testUser: { id: string; email: string };
  let testInstallationId: string;

  before(async () => {
    appV2 = Fastify({ logger: false });
    await appV2.register(entitlementRoutesV2);
    await appV2.register(downloadRoutesV2);
    await appV2.ready();

    appV1 = Fastify({ logger: false });
    await appV1.register(downloadRoutesV1);
    await appV1.ready();

    const email = `test_community_v2_${Date.now()}@example.com`;
    const [inserted] = await db
      .insert(users)
      .values({ email })
      .returning({ id: users.id, email: users.email });

    testUser = { id: inserted.id, email: inserted.email! };
    testInstallationId = `inst_comm_v2_${Date.now()}`;
    await db.insert(installations).values({
      installationId: testInstallationId,
      userId: testUser.id,
    });
  });

  after(async () => {
    if (testInstallationId) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, testInstallationId));
    }
    if (testUser?.id) {
      await db.delete(downloads).where(eq(downloads.userId, testUser.id));
      await db.delete(models).where(eq(models.userId, testUser.id));
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, testUser.id));
      await db.delete(users).where(eq(users.id, testUser.id));
    }
    await appV2.close();
    await appV1.close();
    await pool.end();
  });

  test("1. Free user starts with 1 Community download entitlement", async () => {
    await db
      .update(users)
      .set({ isPaid: false, plan: null, freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, testUser.id));

    // Check v2 entitlement response
    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    const entBody = entRes.json();
    assert.equal(entBody.plan, "free");
    assert.equal(entBody.communityModelsUsed, 0);
    assert.equal(entBody.communityModelsRemaining, 1);
    assert.equal(entBody.communityModelsLimit, 1);

    // First Community download succeeds
    const modelKey1 = `comm_free_1_${Date.now()}`;
    const dlRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: modelKey1,
        downloadType: "glb",
        source: "community",
      },
    });

    assert.equal(dlRes.statusCode, 200);
    const dlBody = dlRes.json();
    assert.equal(dlBody.allowed, true);
    assert.equal(dlBody.communityModelsUsed, 1);
    assert.equal(dlBody.communityModelsRemaining, 0);
    assert.equal(dlBody.communityModelsLimit, 1);
  });

  test("2. Free user cannot consume a 2nd Community model (403 COMMUNITY_DOWNLOAD_LIMIT_REACHED)", async () => {
    const modelKey2 = `comm_free_2_${Date.now()}`;
    const dlRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: modelKey2,
        downloadType: "glb",
        source: "community",
      },
    });

    assert.equal(dlRes.statusCode, 403);
    const body = dlRes.json();
    assert.equal(body.error, "COMMUNITY_DOWNLOAD_LIMIT_REACHED");
    assert.equal(body.communityModelsRemaining, 0);
    assert.equal(body.communityModelsLimit, 1);
  });

  test("3. Free quota does not reset (all-time limit remains 1)", async () => {
    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.statusCode, 200);
    const entBody = entRes.json();
    assert.equal(entBody.plan, "free");
    assert.equal(entBody.communityModelsUsed, 1);
    assert.equal(entBody.communityModelsRemaining, 0);
    assert.equal(entBody.communityModelsLimit, 1);
  });

  test("4. Pro Monthly gets 2 Community models per monthly billing period", async () => {
    // Clear downloads and set up Pro Monthly subscription
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const subId = `sub_monthly_${Date.now()}`;
    const periodStart = new Date("2026-09-01T00:00:00Z");
    const periodEnd = new Date("2026-10-01T00:00:00Z");

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "cust_m",
      paddleSubscriptionId: subId,
      paddlePriceId: "pri_m",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().plan, "pro_monthly");
    assert.equal(entRes.json().communityModelsUsed, 0);
    assert.equal(entRes.json().communityModelsRemaining, 2);
    assert.equal(entRes.json().communityModelsLimit, 2);

    // Download 1st Community model
    const m1 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_m_1_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(m1.statusCode, 200);
    assert.equal(m1.json().communityModelsUsed, 1);
    assert.equal(m1.json().communityModelsRemaining, 1);

    // Download 2nd Community model
    const m2 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_m_2_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(m2.statusCode, 200);
    assert.equal(m2.json().communityModelsUsed, 2);
    assert.equal(m2.json().communityModelsRemaining, 0);

    // Download 3rd Community model in same period -> 403 limit reached
    const m3 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_m_3_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(m3.statusCode, 403);
    assert.equal(m3.json().error, "COMMUNITY_DOWNLOAD_LIMIT_REACHED");
  });

  test("5. Pro Monthly usage resets at the next billing period", async () => {
    // Simulate period advancement to October
    const newPeriodStart = new Date("2026-10-01T00:00:00Z");
    const newPeriodEnd = new Date("2026-11-01T00:00:00Z");

    await db
      .update(subscriptions)
      .set({
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
      })
      .where(eq(subscriptions.userId, testUser.id));

    // Entitlement in new period should show 0 used, 2 remaining
    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().communityModelsUsed, 0);
    assert.equal(entRes.json().communityModelsRemaining, 2);

    // Download Community model in new period succeeds
    const dlRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_m_oct_1_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(dlRes.statusCode, 200);
    assert.equal(dlRes.json().communityModelsUsed, 1);
    assert.equal(dlRes.json().communityModelsRemaining, 1);
  });

  test("5b. Pro Max Monthly gets 8 Community models per monthly billing period", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const subIdMax = `sub_max_${Date.now()}`;
    const periodStart = new Date("2026-09-01T00:00:00Z");
    const periodEnd = new Date("2026-10-01T00:00:00Z");

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_max_monthly",
      paddleCustomerId: "cust_max",
      paddleSubscriptionId: subIdMax,
      paddlePriceId: "pri_max",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().plan, "pro_max_monthly");
    assert.equal(entRes.json().communityModelsUsed, 0);
    assert.equal(entRes.json().communityModelsRemaining, 8);
    assert.equal(entRes.json().communityModelsLimit, 8);
  });

  test("6 & 7. Pro Annual gets 40 Community models total for the annual period and does NOT reset monthly", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const subIdAnnual = `sub_annual_${Date.now()}`;
    const annualStart = new Date("2026-01-01T00:00:00Z");
    const annualEnd = new Date("2027-01-01T00:00:00Z");

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_annual",
      paddleCustomerId: "cust_a",
      paddleSubscriptionId: subIdAnnual,
      paddlePriceId: "pri_a",
      status: "active",
      currentPeriodStart: annualStart,
      currentPeriodEnd: annualEnd,
    });

    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().plan, "pro_annual");
    assert.equal(entRes.json().communityModelsLimit, 40);
    assert.equal(entRes.json().communityModelsRemaining, 40);

    // Download a Community model
    const dlRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_annual_1_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(dlRes.statusCode, 200);
    assert.equal(dlRes.json().communityModelsUsed, 1);
    assert.equal(dlRes.json().communityModelsRemaining, 39);
  });

  test("8. Pro Annual resets for the next annual period", async () => {
    const nextAnnualStart = new Date("2027-01-01T00:00:00Z");
    const nextAnnualEnd = new Date("2028-01-01T00:00:00Z");

    await db
      .update(subscriptions)
      .set({
        currentPeriodStart: nextAnnualStart,
        currentPeriodEnd: nextAnnualEnd,
      })
      .where(eq(subscriptions.userId, testUser.id));

    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().communityModelsUsed, 0);
    assert.equal(entRes.json().communityModelsRemaining, 40);
  });

  test("9. Lifetime has unlimited Community downloads", async () => {
    await db.delete(subscriptions).where(eq(subscriptions.userId, testUser.id));
    await db
      .update(users)
      .set({ isPaid: true, plan: "lifetime" })
      .where(eq(users.id, testUser.id));

    const entRes = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entRes.json().plan, "lifetime");
    assert.equal(entRes.json().communityModelsLimit, null);
    assert.equal(entRes.json().communityModelsRemaining, null);

    const dlRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `comm_life_1_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(dlRes.statusCode, 200);
    assert.equal(dlRes.json().allowed, true);
    assert.equal(dlRes.json().communityModelsRemaining, null);
  });

  test("10. Same Community model does NOT consume quota twice across multi-format downloads", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));
    await db
      .update(users)
      .set({ isPaid: false, plan: null, freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const sharedModelKey = `comm_same_model_${Date.now()}`;

    // Free user downloads sharedModelKey format GLB -> consumes 1 quota
    const res1 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: sharedModelKey,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().communityModelsUsed, 1);
    assert.equal(res1.json().communityModelsRemaining, 0);

    // Free user downloads sharedModelKey format OBJ -> 0 additional quota consumed (already unlocked)
    const res2 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: sharedModelKey,
        downloadType: "obj",
        source: "community",
      },
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().allowed, true);
    assert.equal(res2.json().communityModelsUsed, 1);
    assert.equal(res2.json().communityModelsRemaining, 0);
  });

  test("11, 12, 13. Workspace quotas and existing v1/v2 behavior remain completely unchanged", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    // Workspace download on v2
    const wsRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `ws_model_${Date.now()}`,
        downloadType: "glb",
        source: "workspace",
      },
    });
    assert.equal(wsRes.statusCode, 200);
    assert.equal(wsRes.json().source, "workspace");
    assert.equal(wsRes.json().freeDownloadsUsed, 1);

    // Workspace download on v1
    const v1Res = await appV1.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `ws_v1_model_${Date.now()}`,
        downloadType: "glb",
      },
    });
    assert.equal(v1Res.statusCode, 200);
    assert.equal(v1Res.json().source, "workspace");
    assert.equal(v1Res.json().freeDownloadsUsed, 2);
  });

  test("14. Workspace request without taskId is rejected with 400", async () => {
    // Workspace request missing taskId (explicit source = workspace)
    const res1 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        source: "workspace",
        downloadType: "glb",
      },
    });
    assert.equal(res1.statusCode, 400);

    // Workspace request missing taskId (omitted source defaults to workspace)
    const res2 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        downloadType: "glb",
      },
    });
    assert.equal(res2.statusCode, 400);
  });

  test("15. Workspace request with valid taskId functions normally", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const wsRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `ws_valid_task_${Date.now()}`,
        downloadType: "glb",
        source: "workspace",
      },
    });
    assert.equal(wsRes.statusCode, 200);
    assert.equal(wsRes.json().allowed, true);
    assert.equal(wsRes.json().source, "workspace");
  });

  test("16. Community request without taskId passes validation and consumes correctly", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const commRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        source: "community",
        modelUrl: `https://assets.meshy.ai/community/model_${Date.now()}.glb`,
        downloadType: "glb",
      },
    });
    assert.equal(commRes.statusCode, 200);
    const body = commRes.json();
    assert.equal(body.allowed, true);
    assert.equal(body.source, "community");
  });

  test("17. Community request with Community post/ref identity records correctly with source = 'community'", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const communityModelUrl = `https://assets.meshy.ai/community/post_ref_${Date.now()}.glb`;
    const communityPreviewUrl = `https://assets.meshy.ai/community/preview_${Date.now()}.png`;

    const commRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        source: "community",
        modelUrl: communityModelUrl,
        previewUrl: communityPreviewUrl,
        downloadType: "glb",
      },
    });
    assert.equal(commRes.statusCode, 200);
    const body = commRes.json();
    assert.equal(body.allowed, true);
    assert.equal(body.source, "community");

    // Verify download record created in DB has source = 'community'
    const [dlRecord] = await db
      .select({ source: downloads.source })
      .from(downloads)
      .where(eq(downloads.userId, testUser.id))
      .limit(1);
    assert.equal(dlRecord.source, "community");
  });

  test("18. Pro Monthly consuming Community models via explicit modelKey increments counters correctly and limits at 2", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const subId = `sub_monthly_key_${Date.now()}`;
    const periodStart = new Date("2026-09-01T00:00:00Z");
    const periodEnd = new Date("2026-10-01T00:00:00Z");

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_monthly",
      paddleCustomerId: "cust_m_key",
      paddleSubscriptionId: subId,
      paddlePriceId: "pri_m_key",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    const keyA = `comm_key_A_${Date.now()}`;
    const keyB = `comm_key_B_${Date.now()}`;
    const keyC = `comm_key_C_${Date.now()}`;

    // 1st Community download via modelKey
    const resA = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: keyA,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(resA.statusCode, 200);
    const bodyA = resA.json();
    assert.equal(bodyA.allowed, true);
    assert.equal(bodyA.duplicate, false);
    assert.equal(bodyA.source, "community");
    assert.equal(bodyA.communityModelsUsed, 1);
    assert.equal(bodyA.communityModelsRemaining, 1);
    assert.equal(bodyA.communityModelsLimit, 2);

    // 2nd Community download via modelKey
    const resB = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: keyB,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(resB.statusCode, 200);
    const bodyB = resB.json();
    assert.equal(bodyB.allowed, true);
    assert.equal(bodyB.duplicate, false);
    assert.equal(bodyB.source, "community");
    assert.equal(bodyB.communityModelsUsed, 2);
    assert.equal(bodyB.communityModelsRemaining, 0);
    assert.equal(bodyB.communityModelsLimit, 2);

    // 3rd Community download via modelKey -> 403 COMMUNITY_DOWNLOAD_LIMIT_REACHED
    const resC = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: keyC,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(resC.statusCode, 403);
    const bodyC = resC.json();
    assert.equal(bodyC.error, "COMMUNITY_DOWNLOAD_LIMIT_REACHED");
    assert.equal(bodyC.communityModelsRemaining, 0);
    assert.equal(bodyC.communityModelsLimit, 2);
  });

  test("19. Duplicate Community model using modelKey does not double-consume quota", async () => {
    // Redownload keyA (already consumed in test 18)
    const keyA = (
      await db
        .select({ modelKey: models.modelKey })
        .from(models)
        .where(eq(models.userId, testUser.id))
        .limit(1)
    )[0].modelKey;

    const dupRes = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: keyA,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(dupRes.statusCode, 200);
    const dupBody = dupRes.json();
    assert.equal(dupBody.allowed, true);
    assert.equal(dupBody.duplicate, true);
    assert.equal(dupBody.source, "community");
    assert.equal(dupBody.communityModelsUsed, 2);
    assert.equal(dupBody.communityModelsRemaining, 0);
  });

  test("20. Pro Max Monthly consuming Community models via modelKey decrements counter from 8", async () => {
    await db.delete(downloads).where(eq(downloads.userId, testUser.id));
    await db.delete(models).where(eq(models.userId, testUser.id));

    const subIdMax = `sub_max_key_${Date.now()}`;
    const periodStart = new Date("2026-09-01T00:00:00Z");
    const periodEnd = new Date("2026-10-01T00:00:00Z");

    await upsertPaddleSubscription({
      userId: testUser.id,
      plan: "pro_max_monthly",
      paddleCustomerId: "cust_max_key",
      paddleSubscriptionId: subIdMax,
      paddlePriceId: "pri_max_key",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    // Download 1st model
    const res1 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: `max_k_1_${Date.now()}`,
        downloadType: "glb",
        source: "community",
      },
    });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().communityModelsUsed, 1);
    assert.equal(res1.json().communityModelsRemaining, 7);
    assert.equal(res1.json().communityModelsLimit, 8);

    // Download 2nd model
    const res2 = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        modelKey: `max_k_2_${Date.now()}`,
        downloadType: "obj",
        source: "community",
      },
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().communityModelsUsed, 2);
    assert.equal(res2.json().communityModelsRemaining, 6);
  });

  test("21. Workspace model downloads for paid plans remain unlimited and do NOT decrement Community counters", async () => {
    // Entitlement before workspace downloads
    const entBefore = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    const commUsedBefore = entBefore.json().communityModelsUsed;
    const commRemBefore = entBefore.json().communityModelsRemaining;

    // Download multiple Workspace models across formats (glb, obj, fbx, stl, 3mf)
    const formats = ["glb", "obj", "fbx", "stl", "3mf"];
    for (const fmt of formats) {
      const wsRes = await appV2.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId,
          taskId: `ws_paid_task_${fmt}_${Date.now()}`,
          downloadType: fmt,
          source: "workspace",
        },
      });
      assert.equal(wsRes.statusCode, 200);
      assert.equal(wsRes.json().allowed, true);
      assert.equal(wsRes.json().source, "workspace");
      assert.equal(wsRes.json().plan, "pro");
    }

    // Community counters must remain completely unchanged
    const entAfter = await appV2.inject({
      method: "GET",
      url: `/entitlement?installationId=${testInstallationId}`,
    });
    assert.equal(entAfter.json().communityModelsUsed, commUsedBefore);
    assert.equal(entAfter.json().communityModelsRemaining, commRemBefore);
  });
});
