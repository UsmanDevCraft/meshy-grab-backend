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
import { downloadRoutes } from "../src/routes/downloads.js";
import {
  DOWNLOAD_TYPES,
  ALLOWED_DOWNLOAD_TYPES,
} from "../src/config/constants.js";
import { upsertPaddleSubscription } from "../src/services/subscription.js";
import { getUserSubscription } from "../src/services/entitlement.js";
import { consumeTexture } from "../src/services/textures.js";

describe("Download Types Configuration", () => {
  test("DOWNLOAD_TYPES contains glb, obj, fbx, stl, and 3mf", () => {
    assert.equal(DOWNLOAD_TYPES.GLB, "glb");
    assert.equal(DOWNLOAD_TYPES.OBJ, "obj");
    assert.equal(DOWNLOAD_TYPES.FBX, "fbx");
    assert.equal(DOWNLOAD_TYPES.STL, "stl");
    assert.equal(DOWNLOAD_TYPES.THREE_MF, "3mf");
  });

  test("ALLOWED_DOWNLOAD_TYPES contains glb, obj, fbx, stl, and 3mf", () => {
    assert.deepEqual(Array.from(ALLOWED_DOWNLOAD_TYPES), [
      "glb",
      "obj",
      "fbx",
      "stl",
      "3mf",
    ]);
  });
});

describe("Format-Level Entitlement & Duplicate Architecture Tests", () => {
  let app: ReturnType<typeof Fastify>;
  let testUser1: { id: string; email: string };
  let testInstallationId1: string;

  let testUser2: { id: string; email: string };
  let testInstallationId2: string;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(downloadRoutes);
    await app.ready();

    // User 1 setup
    const email1 = `test_v4_dl_1_${Date.now()}@example.com`;
    const [inserted1] = await db
      .insert(users)
      .values({ email: email1 })
      .returning({ id: users.id, email: users.email });

    testUser1 = { id: inserted1.id, email: inserted1.email! };
    testInstallationId1 = `inst_v4_dl_1_${Date.now()}`;
    await db.insert(installations).values({
      installationId: testInstallationId1,
      userId: testUser1.id,
    });

    // User 2 setup
    const email2 = `test_v4_dl_2_${Date.now()}@example.com`;
    const [inserted2] = await db
      .insert(users)
      .values({ email: email2 })
      .returning({ id: users.id, email: users.email });

    testUser2 = { id: inserted2.id, email: inserted2.email! };
    testInstallationId2 = `inst_v4_dl_2_${Date.now()}`;
    await db.insert(installations).values({
      installationId: testInstallationId2,
      userId: testUser2.id,
    });
  });

  after(async () => {
    if (testInstallationId1) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, testInstallationId1));
    }
    if (testInstallationId2) {
      await db
        .delete(installations)
        .where(eq(installations.installationId, testInstallationId2));
    }
    if (testUser1?.id) {
      await db.delete(downloads).where(eq(downloads.userId, testUser1.id));
      await db.delete(models).where(eq(models.userId, testUser1.id));
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, testUser1.id));
      await db.delete(users).where(eq(users.id, testUser1.id));
    }
    if (testUser2?.id) {
      await db.delete(downloads).where(eq(downloads.userId, testUser2.id));
      await db.delete(models).where(eq(models.userId, testUser2.id));
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.userId, testUser2.id));
      await db.delete(users).where(eq(users.id, testUser2.id));
    }
    await app.close();
    await pool.end();
  });

  test("1-7. Format-level duplicate behavior and multi-format consumption", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser1.id));

    const modelKeyA = `model_A_${Date.now()}`;

    // 1. First Model A + GLB -> duplicate: false, consumes 1 export
    const res1 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId1,
        taskId: modelKeyA,
        downloadType: "GLB", // uppercase test for normalization
      },
    });
    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.allowed, true);
    assert.equal(body1.duplicate, false);
    assert.equal(body1.freeDownloadsUsed, 1);
    assert.equal(body1.freeDownloadsRemaining, 1);

    // 2. Second Model A + GLB -> duplicate: true, consumes 0 additional exports
    const res2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId1,
        taskId: modelKeyA,
        downloadType: "glb",
      },
    });
    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.allowed, true);
    assert.equal(body2.duplicate, true);
    assert.equal(body2.freeDownloadsUsed, 1);
    assert.equal(body2.freeDownloadsRemaining, 1);

    // 3. Model A + OBJ after GLB -> duplicate: false, consumes 1 export (uses 2nd free export)
    const res3 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId1,
        taskId: modelKeyA,
        downloadType: "obj",
      },
    });
    assert.equal(res3.statusCode, 200);
    const body3 = res3.json();
    assert.equal(body3.allowed, true);
    assert.equal(body3.duplicate, false);
    assert.equal(body3.freeDownloadsUsed, 2);
    assert.equal(body3.freeDownloadsRemaining, 0);

    // 4. Repeat Model A + OBJ -> duplicate: true, consumes 0
    const res4 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId1,
        taskId: modelKeyA,
        downloadType: "obj",
      },
    });
    assert.equal(res4.statusCode, 200);
    const body4 = res4.json();
    assert.equal(body4.allowed, true);
    assert.equal(body4.duplicate, true);
    assert.equal(body4.freeDownloadsUsed, 2);

    // 5. Attempting a 3rd new export format (Model A + FBX) for free user (quota limit 2) -> 403 limit reached
    const res5 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId1,
        taskId: modelKeyA,
        downloadType: "fbx",
      },
    });
    assert.equal(res5.statusCode, 403);
    assert.equal(res5.json().error, "FREE_DOWNLOAD_LIMIT_REACHED");

    // 10 & 11. Database structural check: Only 1 row in models, 2 rows in downloads for Model A
    const modelRows = await db
      .select()
      .from(models)
      .where(
        and(eq(models.userId, testUser1.id), eq(models.modelKey, modelKeyA)),
      );
    assert.equal(
      modelRows.length,
      1,
      "Only ONE canonical model row for Model A",
    );

    const downloadRows = await db
      .select()
      .from(downloads)
      .where(
        and(
          eq(downloads.userId, testUser1.id),
          eq(downloads.modelId, modelRows[0].id),
        ),
      );
    assert.equal(
      downloadRows.length,
      2,
      "Two format download records exist for Model A",
    );
    const formatTypes = downloadRows.map((d) => d.downloadType).sort();
    assert.deepEqual(formatTypes, ["glb", "obj"]);
  });

  test("8. Downloading Model B + GLB consumes another export", async () => {
    // Reset User 2 free downloads
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser2.id));

    const modelKey1 = `model_B1_${Date.now()}`;
    const modelKey2 = `model_B2_${Date.now()}`;

    // Model B1 + GLB -> consumes 1 export
    const res1 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId2,
        taskId: modelKey1,
        downloadType: "glb",
      },
    });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().duplicate, false);
    assert.equal(res1.json().freeDownloadsUsed, 1);

    // Model B2 + GLB -> consumes 2nd export
    const res2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId2,
        taskId: modelKey2,
        downloadType: "glb",
      },
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().duplicate, false);
    assert.equal(res2.json().freeDownloadsUsed, 2);
  });

  test("9. Same Meshy model downloaded by different user has independent entitlement", async () => {
    // Reset User 2 downloads to 0
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser2.id));

    const sharedModelKey = `shared_model_${Date.now()}`;

    const resUser2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId2,
        taskId: sharedModelKey,
        downloadType: "stl",
      },
    });

    assert.equal(resUser2.statusCode, 200);
    assert.equal(resUser2.json().allowed, true);
    assert.equal(resUser2.json().duplicate, false);
    assert.equal(resUser2.json().freeDownloadsUsed, 1);

    // Verify User 2 has their own independent model row in models
    const user2Models = await db
      .select()
      .from(models)
      .where(
        and(
          eq(models.userId, testUser2.id),
          eq(models.modelKey, sharedModelKey),
        ),
      );
    assert.equal(user2Models.length, 1);
  });

  test("12. Concurrent Model A + GLB requests consume only one entitlement", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser2.id));

    const concurrentModelKey = `model_conc_same_${Date.now()}`;

    const [resA, resB] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId2,
          taskId: concurrentModelKey,
          downloadType: "glb",
        },
      }),
      app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId2,
          taskId: concurrentModelKey,
          downloadType: "glb",
        },
      }),
    ]);

    assert.equal(resA.statusCode, 200);
    assert.equal(resB.statusCode, 200);

    const duplicates = [resA.json().duplicate, resB.json().duplicate].sort();
    assert.deepEqual(
      duplicates,
      [false, true],
      "Exactly one request must consume entitlement (false), and one duplicate (true)",
    );

    const [u2] = await db
      .select({ freeDownloadsUsed: users.freeDownloadsUsed })
      .from(users)
      .where(eq(users.id, testUser2.id));
    assert.equal(
      u2.freeDownloadsUsed,
      1,
      "Only 1 entitlement consumed for concurrent identical format requests",
    );
  });

  test("13. Concurrent Model A + GLB and Model A + OBJ requests consume two entitlements", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser2.id));

    const concurrentModelKey = `model_conc_diff_${Date.now()}`;

    const [resGLB, resOBJ] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId2,
          taskId: concurrentModelKey,
          downloadType: "glb",
        },
      }),
      app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId2,
          taskId: concurrentModelKey,
          downloadType: "obj",
        },
      }),
    ]);

    assert.equal(resGLB.statusCode, 200);
    assert.equal(resOBJ.statusCode, 200);

    assert.equal(resGLB.json().duplicate, false);
    assert.equal(resOBJ.json().duplicate, false);

    const [u2] = await db
      .select({ freeDownloadsUsed: users.freeDownloadsUsed })
      .from(users)
      .where(eq(users.id, testUser2.id));
    assert.equal(
      u2.freeDownloadsUsed,
      2,
      "Two entitlements consumed for concurrent different format requests",
    );
  });

  test("14. Texture downloads remain independent from model/export entitlement", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 1, textureDownloadsUsed: 0 })
      .where(eq(users.id, testUser2.id));

    const texResult = await consumeTexture(testUser2.id);
    assert.equal(texResult.allowed, true);
    assert.equal(texResult.textureDownloadsUsed, 1);

    // Check that model freeDownloadsUsed remained unchanged at 1
    const [u2] = await db
      .select({
        freeDownloadsUsed: users.freeDownloadsUsed,
        textureDownloadsUsed: users.textureDownloadsUsed,
      })
      .from(users)
      .where(eq(users.id, testUser2.id));

    assert.equal(u2.freeDownloadsUsed, 1);
    assert.equal(u2.textureDownloadsUsed, 1);
  });

  test("15 & 16. Pro plan users retain unlimited downloads and subscription behavior", async () => {
    const testSubscriptionId = `sub_pro_${Date.now()}`;

    await upsertPaddleSubscription({
      userId: testUser1.id,
      plan: "pro_monthly",
      paddleCustomerId: "cust_pro",
      paddleSubscriptionId: testSubscriptionId,
      paddlePriceId: "pri_pro",
      status: "active",
    });

    const sub = await getUserSubscription(testUser1.id);
    assert.equal(sub?.plan, "pro_monthly");
    assert.equal(sub?.status, "active");

    const modelKeyPro = `pro_multi_format_${Date.now()}`;
    const formats = ["glb", "obj", "fbx", "stl", "3mf"];

    for (const format of formats) {
      const res = await app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId1,
          taskId: modelKeyPro,
          downloadType: format,
        },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().allowed, true);
      assert.equal(res.json().plan, "pro");
      assert.equal(res.json().freeDownloadsRemaining, null);
    }
  });
});
