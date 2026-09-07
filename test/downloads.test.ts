import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq, and } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import { users, installations, downloads } from "../src/db/schema.js";
import { downloadRoutes } from "../src/routes/downloads.js";
import {
  DOWNLOAD_TYPES,
  ALLOWED_DOWNLOAD_TYPES,
} from "../src/config/constants.js";

describe("Download Types Configuration", () => {
  test("DOWNLOAD_TYPES contains glb, obj, and fbx", () => {
    assert.equal(DOWNLOAD_TYPES.GLB, "glb");
    assert.equal(DOWNLOAD_TYPES.OBJ, "obj");
    assert.equal(DOWNLOAD_TYPES.FBX, "fbx");
  });

  test("ALLOWED_DOWNLOAD_TYPES contains glb, obj, and fbx", () => {
    assert.deepEqual(Array.from(ALLOWED_DOWNLOAD_TYPES), ["glb", "obj", "fbx"]);
  });
});

describe("Download-Type Tracking API & Service Integration Tests", () => {
  let app: ReturnType<typeof Fastify>;
  let testUser: { id: string; email: string };
  let testInstallationId: string;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(downloadRoutes);
    await app.ready();

    const testEmail = `test_dl_type_${Date.now()}@example.com`;
    const [inserted] = await db
      .insert(users)
      .values({ email: testEmail })
      .returning({ id: users.id, email: users.email });

    testUser = {
      id: inserted.id,
      email: inserted.email!,
    };

    testInstallationId = `inst_test_dl_type_${Date.now()}`;
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
      await db.delete(users).where(eq(users.id, testUser.id));
    }
    await app.close();
    await pool.end();
  });

  test("1. Valid downloadType 'glb' is accepted and persisted", async () => {
    const taskId = `task_glb_${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId,
        downloadType: "glb",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.duplicate, false);

    // Verify DB record
    const [record] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId)),
      );

    assert.ok(record);
    assert.equal(record.downloadType, "glb");
  });

  test("2. Valid downloadType 'obj' is accepted and persisted", async () => {
    // Reset freeDownloadsUsed for testing additional format types
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const taskId = `task_obj_${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId,
        downloadType: "obj",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);

    const [record] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId)),
      );

    assert.ok(record);
    assert.equal(record.downloadType, "obj");
  });

  test("3. Valid downloadType 'fbx' is accepted and persisted", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const taskId = `task_fbx_${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId,
        downloadType: "fbx",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.allowed, true);

    const [record] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId)),
      );

    assert.ok(record);
    assert.equal(record.downloadType, "fbx");
  });

  test("4. Various asset types (gltf, stl, png, texture, etc.) are accepted without restriction", async () => {
    const assetTypes = [
      "gltf",
      "stl",
      "blend",
      "zip",
      "png",
      "textures",
      "custom_format",
    ];

    for (const assetType of assetTypes) {
      await db
        .update(users)
        .set({ freeDownloadsUsed: 0 })
        .where(eq(users.id, testUser.id));

      const taskId = `task_asset_${assetType}_${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/downloads/consume",
        payload: {
          installationId: testInstallationId,
          taskId,
          downloadType: assetType,
        },
      });

      assert.equal(
        res.statusCode,
        200,
        `Expected 200 for downloadType '${assetType}'`,
      );
      assert.equal(res.json().allowed, true);

      const [record] = await db
        .select()
        .from(downloads)
        .where(
          and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId)),
        );

      assert.ok(record);
      assert.equal(record.downloadType, assetType);
    }
  });

  test("5. Omitted or null downloadType is accepted and stored as null", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    // Omitted downloadType
    const taskId1 = `task_omitted_${Date.now()}`;
    const res1 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: taskId1,
      },
    });

    assert.equal(res1.statusCode, 200);

    const [record1] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId1)),
      );

    assert.ok(record1);
    assert.equal(record1.downloadType, null);

    // Null downloadType
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const taskId2 = `task_null_${Date.now()}`;
    const res2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: taskId2,
        downloadType: null,
      },
    });

    assert.equal(res2.statusCode, 200);

    const [record2] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId2)),
      );

    assert.ok(record2);
    assert.equal(record2.downloadType, null);
  });

  test("6. Duplicate request preserves original download record and returns duplicate: true", async () => {
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    const taskId = `task_dup_${Date.now()}`;

    // First download call with glb
    const res1 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId,
        downloadType: "glb",
      },
    });

    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().duplicate, false);

    // Duplicate call with fbx
    const res2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId,
        downloadType: "fbx",
      },
    });

    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().duplicate, true);

    // DB record should still have initial 'glb' type
    const [record] = await db
      .select()
      .from(downloads)
      .where(
        and(eq(downloads.userId, testUser.id), eq(downloads.taskId, taskId)),
      );

    assert.equal(record.downloadType, "glb");
  });

  test("7. Quota enforcement and response shape remain unchanged", async () => {
    // Reset free user quota
    await db
      .update(users)
      .set({ freeDownloadsUsed: 0 })
      .where(eq(users.id, testUser.id));

    // Download 1
    const res1 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `quota_task_1_${Date.now()}`,
        downloadType: "glb",
      },
    });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().freeDownloadsUsed, 1);
    assert.equal(res1.json().freeDownloadsRemaining, 1);

    // Download 2
    const res2 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `quota_task_2_${Date.now()}`,
        downloadType: "obj",
      },
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().freeDownloadsUsed, 2);
    assert.equal(res2.json().freeDownloadsRemaining, 0);

    // Download 3 -> 403 Limit Reached
    const res3 = await app.inject({
      method: "POST",
      url: "/downloads/consume",
      payload: {
        installationId: testInstallationId,
        taskId: `quota_task_3_${Date.now()}`,
        downloadType: "fbx",
      },
    });
    assert.equal(res3.statusCode, 403);
    assert.equal(res3.json().error, "FREE_DOWNLOAD_LIMIT_REACHED");
    assert.equal(res3.json().freeDownloadsRemaining, 0);
  });
});
