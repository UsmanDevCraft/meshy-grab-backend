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
import { getCommunityModelsUsed } from "../src/services/community.js";

describe("v2 Community Download System Tests", () => {
  let appV2: ReturnType<typeof Fastify>;
  let appV1: ReturnType<typeof Fastify>;

  let testUser: { id: string; email: string };
  let testInstallationId: string;

  before(async () => {
    appV2 = Fastify({ logger: false });
    await appV2.register(downloadRoutesV2);
    await appV2.ready();

    appV1 = Fastify({ logger: false });
    await appV1.register(downloadRoutesV1);
    await appV1.ready();

    const email = `test_community_user_${Date.now()}@example.com`;
    const [inserted] = await db
      .insert(users)
      .values({ email })
      .returning({ id: users.id, email: users.email });

    testUser = { id: inserted.id, email: inserted.email! };
    testInstallationId = `inst_community_${Date.now()}`;
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

  test("1. Default v2 download without source defaults to workspace download", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const modelKeyDefault = `model_default_${Date.now()}`;

    const res = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: modelKeyDefault,
        downloadType: "glb",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.source, "workspace");
    assert.equal(body.freeDownloadsUsed, 1);

    const [dlRow] = await db
      .select()
      .from(downloads)
      .where(eq(downloads.userId, testUser.id));
    assert.equal(dlRow.source, "workspace");
    assert.equal(dlRow.downloadType, "glb");
  });

  test("2. Downloading Community model consumes Community quota and NOT workspace freeDownloadsUsed", async () => {
    // Reset workspace freeDownloadsUsed to 0
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const communityModel1 = `comm_model_1_${Date.now()}`;

    const res = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: communityModel1,
        downloadType: "glb",
        source: "community",
      },
    });

    if (res.statusCode !== 200) {
      console.error("Test 2 failed response body:", res.json());
    }
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.source, "community");
    assert.equal(body.communityModelsUsed, 1);

    // Verify workspace counter freeDownloadsUsed remains 0
    const [u] = await db
      .select({ freeDownloadsUsed: users.freeDownloadsUsed })
      .from(users)
      .where(eq(users.id, testUser.id));
    assert.equal(u.freeDownloadsUsed, 0, "freeDownloadsUsed must NOT be incremented for community models");
  });

  test("3. Downloading SAME Community model in multiple formats (GLB + OBJ + FBX) consumes only ONE Community entitlement", async () => {
    const communityModelMulti = `comm_model_multi_${Date.now()}`;

    // 1st format: GLB -> communityModelsUsed becomes +1
    const resGLB = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: communityModelMulti,
        downloadType: "glb",
        source: "community",
      },
    });

    assert.equal(resGLB.statusCode, 200);
    assert.equal(resGLB.json().allowed, true);
    assert.equal(resGLB.json().duplicate, false);
    assert.equal(resGLB.json().source, "community");
    const countAfterFirst = resGLB.json().communityModelsUsed;

    // 2nd format for SAME model: OBJ -> consumes 0 additional Community quota
    const resOBJ = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: communityModelMulti,
        downloadType: "obj",
        source: "community",
      },
    });

    assert.equal(resOBJ.statusCode, 200);
    assert.equal(resOBJ.json().allowed, true);
    assert.equal(resOBJ.json().duplicate, false);
    assert.equal(resOBJ.json().communityModelsUsed, countAfterFirst, "Community models used count must remain unchanged for additional formats of same model");

    // 3rd format for SAME model: FBX -> consumes 0 additional Community quota
    const resFBX = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: communityModelMulti,
        downloadType: "fbx",
        source: "community",
      },
    });

    assert.equal(resFBX.statusCode, 200);
    assert.equal(resFBX.json().allowed, true);
    assert.equal(resFBX.json().duplicate, false);
    assert.equal(resFBX.json().communityModelsUsed, countAfterFirst);

    // Re-download GLB -> format duplicate, consumes 0 additional Community quota
    const resGLBDup = await appV2.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: communityModelMulti,
        downloadType: "glb",
        source: "community",
      },
    });

    assert.equal(resGLBDup.statusCode, 200);
    assert.equal(resGLBDup.json().allowed, true);
    assert.equal(resGLBDup.json().duplicate, true);
    assert.equal(resGLBDup.json().communityModelsUsed, countAfterFirst);

    // Check database analytics records: 3 format download rows for this model with source = 'community'
    const [modelRecord] = await db
      .select()
      .from(models)
      .where(and(eq(models.userId, testUser.id), eq(models.modelKey, communityModelMulti)));
    
    assert.ok(modelRecord, "Model record exists");

    const formatDownloads = await db
      .select()
      .from(downloads)
      .where(and(eq(downloads.userId, testUser.id), eq(downloads.modelId, modelRecord.id)));
    
    assert.equal(formatDownloads.length, 3, "3 distinct format download rows created for analytics");
    const downloadTypes = formatDownloads.map((d) => d.downloadType).sort();
    assert.deepEqual(downloadTypes, ["fbx", "glb", "obj"], "Format downloadType values remain unencoded");
    
    for (const d of formatDownloads) {
      assert.equal(d.source, "community");
    }
  });

  test("4. Concurrent requests for same Community model consume quota only once", async () => {
    const concurrentCommModel = `comm_conc_${Date.now()}`;

    const initialUsed = await getCommunityModelsUsed(testUser.id);

    const [res1, res2] = await Promise.all([
      appV2.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId,
          taskId: concurrentCommModel,
          downloadType: "glb",
          source: "community",
        },
      }),
      appV2.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId,
          taskId: concurrentCommModel,
          downloadType: "obj",
          source: "community",
        },
      }),
    ]);

    assert.equal(res1.statusCode, 200);
    assert.equal(res2.statusCode, 200);

    const finalUsed = await getCommunityModelsUsed(testUser.id);
    assert.equal(finalUsed, initialUsed + 1, "Exactly 1 community model consumed for concurrent requests of same model");
  });

  test("5. v1 endpoint does not support community parameter and executes workspace logic", async () => {
    const v1ModelKey = `v1_test_model_${Date.now()}`;

    const res = await appV1.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: v1ModelKey,
        downloadType: "glb",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.source, "workspace");
  });
});
