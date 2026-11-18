import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq, inArray } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import {
  users,
  installations,
  subscriptions,
  linkedAccounts,
} from "../src/db/schema.js";
import { v3Routes } from "../src/routes/v3/index.js";

describe("Email-based User Status Lookup (/api/user/status)", () => {
  let app: ReturnType<typeof Fastify>;
  const createdUserIds: string[] = [];
  const createdInstallationIds: string[] = [];

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(v3Routes, { prefix: "/v3" });
    await app.ready();
  });

  after(async () => {
    if (createdInstallationIds.length > 0) {
      await db
        .delete(installations)
        .where(inArray(installations.installationId, createdInstallationIds));
    }
    if (createdUserIds.length > 0) {
      await db
        .delete(linkedAccounts)
        .where(inArray(linkedAccounts.ownerUserId, createdUserIds));
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await app.close();
    await pool.end();
  });

  test("1. Unknown email address returns 404 User not found", async () => {
    const unknownEmail = `unknown_status_${Date.now()}@example.com`;
    const res = await app.inject({
      method: "GET",
      url: `/v3/api/user/status?email=${encodeURIComponent(unknownEmail)}`,
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error, "User not found");
  });

  test("2. User with no installations returns installationId: null", async () => {
    const email = `no_inst_${Date.now()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        isPaid: false,
        plan: "free",
      })
      .returning();
    createdUserIds.push(user.id);

    const res = await app.inject({
      method: "GET",
      url: `/v3/api/user/status?email=${encodeURIComponent(email)}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.exists, true);
    assert.equal(body.installationId, null);
    assert.equal(body.isPaid, false);
    assert.equal(body.plan, "free");
    assert.equal(body.subscriptionStatus, "inactive");
    assert.equal(body.accountType, "primary");
  });

  test("3. User with single installation returns that installationId", async () => {
    const email = `single_inst_${Date.now()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        isPaid: true,
        plan: "lifetime",
      })
      .returning();
    createdUserIds.push(user.id);

    const instId = `inst_single_${Date.now()}`;
    await db.insert(installations).values({
      installationId: instId,
      userId: user.id,
    });
    createdInstallationIds.push(instId);

    const res = await app.inject({
      method: "GET",
      url: `/v3/api/user/status?email=${encodeURIComponent(email)}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.exists, true);
    assert.equal(body.installationId, instId);
    assert.equal(body.isPaid, true);
    assert.equal(body.plan, "lifetime");
    assert.equal(body.subscriptionStatus, "active");
    assert.equal(body.accountType, "primary");
  });

  test("4. User with multiple installations selects the most recent one by createdAt", async () => {
    const email = `multi_inst_${Date.now()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        isPaid: true,
        plan: "pro_monthly",
      })
      .returning();
    createdUserIds.push(user.id);

    const olderInstId = `inst_older_${Date.now()}`;
    const newerInstId = `inst_newer_${Date.now()}`;

    // Insert older installation with past createdAt
    await db.insert(installations).values({
      installationId: olderInstId,
      userId: user.id,
      createdAt: new Date(Date.now() - 3600000), // 1 hour ago
    });
    createdInstallationIds.push(olderInstId);

    // Insert newer installation with more recent createdAt
    await db.insert(installations).values({
      installationId: newerInstId,
      userId: user.id,
      createdAt: new Date(Date.now()), // now
    });
    createdInstallationIds.push(newerInstId);

    const res = await app.inject({
      method: "GET",
      url: `/v3/api/user/status?email=${encodeURIComponent(email)}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.exists, true);
    assert.equal(body.installationId, newerInstId);
    assert.equal(body.isPaid, true);
    assert.equal(body.plan, "pro_monthly");
  });

  test("5. Linked-account email resolves installations through the owner user ID", async () => {
    const timestamp = Date.now();
    const ownerEmail = `owner_${timestamp}@example.com`;
    const [owner] = await db
      .insert(users)
      .values({
        email: ownerEmail,
        isPaid: true,
        plan: "pro_max_monthly",
      })
      .returning();
    createdUserIds.push(owner.id);

    // Owner has an installation
    const ownerInstId = `inst_owner_${timestamp}`;
    await db.insert(installations).values({
      installationId: ownerInstId,
      userId: owner.id,
    });
    createdInstallationIds.push(ownerInstId);

    // Attached linked account
    const attachedEmail = `attached_${timestamp}@example.com`;
    await db.insert(linkedAccounts).values({
      ownerUserId: owner.id,
      meshyEmail: attachedEmail,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v3/api/user/status?email=${encodeURIComponent(attachedEmail)}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.exists, true);
    // Installation ID should be the owner's installation ID!
    assert.equal(body.installationId, ownerInstId);
    assert.equal(body.isPaid, true);
    assert.equal(body.plan, "pro_max_monthly");
    assert.equal(body.accountType, "attached");
  });

  test("6. Critical: GET /v3/entitlement remains completely unchanged", async () => {
    const email = `entitlement_check_${Date.now()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        isPaid: true,
        plan: "lifetime",
      })
      .returning();
    createdUserIds.push(user.id);

    const instId = `inst_ent_${Date.now()}`;
    await db.insert(installations).values({
      installationId: instId,
      userId: user.id,
    });
    createdInstallationIds.push(instId);

    const entRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?installationId=${instId}`,
    });

    assert.equal(entRes.statusCode, 200);
    const entBody = entRes.json();
    // Verify full entitlement response structure remains intact
    assert.equal(entBody.exists, true);
    assert.equal(entBody.userId, user.id);
    assert.equal(entBody.email, email);
    assert.equal(entBody.isPaid, true);
    assert.equal(entBody.plan, "lifetime");
    assert.ok("features" in entBody);
    assert.ok("tripo" in entBody);
    assert.ok("communityModelsLimit" in entBody);
    assert.ok("accountSlots" in entBody);
    // /entitlement query with email alone should return 400
    const invalidEntRes = await app.inject({
      method: "GET",
      url: `/v3/entitlement?email=${encodeURIComponent(email)}`,
    });
    assert.equal(invalidEntRes.statusCode, 400);
  });
});
