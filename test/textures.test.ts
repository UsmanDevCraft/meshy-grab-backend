import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  FREE_TEXTURE_DOWNLOAD_LIMIT,
  FREE_DOWNLOAD_LIMIT,
} from "../src/config/constants.js";
import {
  getFreeTextureDownloadsRemaining,
  getFreeDownloadsRemaining,
  isProSubscription,
} from "../src/services/entitlement.js";

describe("Texture Downloads Allowance & Entitlement Unit Tests", () => {
  test("FREE_TEXTURE_DOWNLOAD_LIMIT should equal 8", () => {
    assert.equal(FREE_TEXTURE_DOWNLOAD_LIMIT, 8);
  });

  test("FREE_DOWNLOAD_LIMIT should remain 2 for GLB models", () => {
    assert.equal(FREE_DOWNLOAD_LIMIT, 2);
  });

  test("getFreeTextureDownloadsRemaining returns 8 for 0 used", () => {
    assert.equal(getFreeTextureDownloadsRemaining(0), 8);
  });

  test("getFreeTextureDownloadsRemaining decrements correctly", () => {
    assert.equal(getFreeTextureDownloadsRemaining(1), 7);
    assert.equal(getFreeTextureDownloadsRemaining(5), 3);
    assert.equal(getFreeTextureDownloadsRemaining(8), 0);
  });

  test("getFreeTextureDownloadsRemaining caps at 0", () => {
    assert.equal(getFreeTextureDownloadsRemaining(10), 0);
  });

  test("GLB getFreeDownloadsRemaining remains unchanged (limit 2)", () => {
    assert.equal(getFreeDownloadsRemaining(0), 2);
    assert.equal(getFreeDownloadsRemaining(1), 1);
    assert.equal(getFreeDownloadsRemaining(2), 0);
    assert.equal(getFreeDownloadsRemaining(3), 0);
  });

  test("isProSubscription evaluates paid and active statuses correctly", () => {
    assert.equal(isProSubscription("active", false), true);
    assert.equal(isProSubscription("inactive", true), true);
    assert.equal(isProSubscription("inactive", false), false);
    assert.equal(isProSubscription(null, false), false);
  });
});

describe("Texture API Routes - /entitlement and /textures/consume", () => {
  let app: any;

  before(async () => {
    const { pool } = await import("../src/db/client.js");
    await pool.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "texture_downloads_used" integer DEFAULT 0 NOT NULL;',
    );

    const Fastify = (await import("fastify")).default;
    const { entitlementRoutes } = await import("../src/routes/entitlement.js");
    const { textureRoutes } = await import("../src/routes/textures.js");

    app = Fastify({ logger: false });
    await app.register(entitlementRoutes);
    await app.register(textureRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    const { pool } = await import("../src/db/client.js");
    await pool.end();
  });

  test("GET /entitlement returns texture fields for unknown installation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/entitlement?installationId=non_existent_inst_12345",
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.exists, false);
    assert.equal(body.freeDownloadsUsed, 0);
    assert.equal(body.freeDownloadsRemaining, 2);
    assert.equal(body.textureDownloadsUsed, 0);
    assert.equal(body.textureDownloadsRemaining, 8);
  });

  test("POST /textures/consume returns 404 for unknown installationId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/textures/consume",
      payload: {
        installationId: "non_existent_inst_12345",
      },
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error, "INSTALLATION_NOT_FOUND");
  });

  test("Free User: 8 texture downloads allowed, 9th returns 403 limit reached", async () => {
    const { db } = await import("../src/db/client.js");
    const { users, installations } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const instId = `inst_test_texture_${Date.now()}`;
    const email = `test_texture_${Date.now()}@example.com`;

    // 1. Create test user and installation
    const [user] = await db
      .insert(users)
      .values({ email })
      .returning({ id: users.id });

    await db.insert(installations).values({
      installationId: instId,
      userId: user.id,
    });

    try {
      // 2. Initial entitlement check -> 8 texture remaining
      const initRes = await app.inject({
        method: "GET",
        url: `/entitlement?installationId=${instId}`,
      });
      assert.equal(initRes.statusCode, 200);
      assert.equal(initRes.json().textureDownloadsUsed, 0);
      assert.equal(initRes.json().textureDownloadsRemaining, 8);

      // 3. Consume 8 texture downloads sequentially
      for (let i = 1; i <= 8; i++) {
        const consumeRes = await app.inject({
          method: "POST",
          url: "/textures/consume",
          payload: { installationId: instId },
        });

        assert.equal(consumeRes.statusCode, 200);
        const body = consumeRes.json();
        assert.equal(body.allowed, true);
        assert.equal(body.plan, "free");
        assert.equal(body.textureDownloadsUsed, i);
        assert.equal(body.textureDownloadsRemaining, 8 - i);
      }

      // 4. 9th download attempt -> 403 limit reached
      const blockedRes = await app.inject({
        method: "POST",
        url: "/textures/consume",
        payload: { installationId: instId },
      });

      assert.equal(blockedRes.statusCode, 403);
      const blockedBody = blockedRes.json();
      assert.equal(blockedBody.error, "FREE_TEXTURE_DOWNLOAD_LIMIT_REACHED");
      assert.equal(blockedBody.textureDownloadsRemaining, 0);

      // 5. Final entitlement check -> 0 remaining
      const finalRes = await app.inject({
        method: "GET",
        url: `/entitlement?installationId=${instId}`,
      });
      assert.equal(finalRes.json().textureDownloadsUsed, 8);
      assert.equal(finalRes.json().textureDownloadsRemaining, 0);
      // GLB free downloads should remain untouched at 2 remaining
      assert.equal(finalRes.json().freeDownloadsUsed, 0);
      assert.equal(finalRes.json().freeDownloadsRemaining, 2);
    } finally {
      // Cleanup
      await db
        .delete(installations)
        .where(eq(installations.installationId, instId));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  test("Pro User: unlimited texture downloads without incrementing counter", async () => {
    const { db } = await import("../src/db/client.js");
    const { users, installations } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const instId = `inst_test_pro_texture_${Date.now()}`;
    const email = `test_pro_texture_${Date.now()}@example.com`;

    // Create pro user
    const [user] = await db
      .insert(users)
      .values({ email, isPaid: true })
      .returning({ id: users.id });

    await db.insert(installations).values({
      installationId: instId,
      userId: user.id,
    });

    try {
      const entitlementRes = await app.inject({
        method: "GET",
        url: `/entitlement?installationId=${instId}`,
      });
      assert.equal(entitlementRes.json().plan, "pro");
      assert.equal(entitlementRes.json().textureDownloadsRemaining, null);

      // Consume texture download as pro user
      const consumeRes = await app.inject({
        method: "POST",
        url: "/textures/consume",
        payload: { installationId: instId },
      });

      assert.equal(consumeRes.statusCode, 200);
      const body = consumeRes.json();
      assert.equal(body.allowed, true);
      assert.equal(body.plan, "pro");
      assert.equal(body.textureDownloadsRemaining, null);
    } finally {
      await db
        .delete(installations)
        .where(eq(installations.installationId, instId));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
