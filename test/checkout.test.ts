import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { env } from "../src/config/env.js";
import { db, pool } from "../src/db/client.js";
import { installations, users } from "../src/db/schema.js";
import { checkoutRoutes } from "../src/routes/paddle/checkout.js";

describe("Paddle Checkout Route - /api/checkout", () => {
  let app: ReturnType<typeof Fastify>;
  let testUser: { id: string; email: string };
  let testInstallationId: string;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(checkoutRoutes);
    await app.ready();

    // Create a temporary test user in database
    const testEmail = `test_checkout_${Date.now()}@example.com`;
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

    testInstallationId = `inst_test_checkout_${Date.now()}`;
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
      await db.delete(users).where(eq(users.id, testUser.id));
    }
    await app.close();
    await pool.end();
  });

  test("1a. plan: pro_monthly + valid user/installation/email → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_monthly",
        userId: testUser.id,
        email: ` ${testUser.email.toUpperCase()} `,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.url, "Response should include checkout URL");
    assert.ok(body.transactionId, "Response should include transactionId");
    assert.ok(body.url.includes(`installationId=${testInstallationId}`));
  });

  test("1b. plan: pro_annual + valid user/installation/email → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_annual",
        userId: testUser.id,
        email: testUser.email,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.url);
    assert.ok(body.transactionId);
  });

  test("1c. plan: lifetime + valid user/installation/email → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "lifetime",
        userId: testUser.id,
        email: testUser.email,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.url);
    assert.ok(body.transactionId);
  });

  test("2. invalid plan string → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "super_ultimate_plan",
        userId: testUser.id,
        email: testUser.email,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error, "Invalid plan");
  });

  test("3. correct userId + wrong email → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_monthly",
        userId: testUser.id,
        email: "wrongemail@example.com",
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, "Email does not match the Meshy account");
  });

  test("4. unowned installationId → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_monthly",
        userId: testUser.id,
        email: testUser.email,
        installationId: "unowned_installation_12345",
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, "installationId does not belong to this user");
  });

  test("5. missing plan and priceId → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        userId: testUser.id,
        email: testUser.email,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(
      body.error,
      "plan, userId, email, and installationId are required",
    );
  });

  test("6. unknown userId → 404", async () => {
    const unknownUuid = "00000000-0000-0000-0000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_monthly",
        userId: unknownUuid,
        email: testUser.email,
        installationId: testInstallationId,
      },
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error, "User not found or has no email");
  });
});
