import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { env } from "../src/config/env.js";
import { db, pool } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { checkoutRoutes } from "../src/routes/paddle/checkout.js";

describe("Paddle Checkout Route - /api/checkout", () => {
  let app: ReturnType<typeof Fastify>;
  let testUser: { id: string; email: string };

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
  });

  after(async () => {
    if (testUser?.id) {
      await db.delete(users).where(eq(users.id, testUser.id));
    }
    await app.close();
    await pool.end();
  });

  test("1. correct userId + correct Meshy email → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        priceId: env.PADDLE_PRICE_ID,
        userId: testUser.id,
        email: ` ${testUser.email.toUpperCase()} `, // test normalization trim & toLowerCase
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.url, "Response should include checkout URL");
    assert.ok(body.transactionId, "Response should include transactionId");
    assert.ok(typeof body.url === "string");
    assert.ok(typeof body.transactionId === "string");
  });

  test("2. correct userId + wrong email → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        priceId: env.PADDLE_PRICE_ID,
        userId: testUser.id,
        email: "wrongemail@example.com",
      },
    });

    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, "Email does not match the Meshy account");
  });

  test("3. missing email → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        priceId: env.PADDLE_PRICE_ID,
        userId: testUser.id,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error, "priceId, userId, and email are required");
  });

  test("4. invalid priceId → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        priceId: "pri_invalid_price_12345",
        userId: testUser.id,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error, "Invalid priceId");
  });

  test("5. unknown userId → appropriate error (404/400)", async () => {
    const unknownUuid = "00000000-0000-0000-0000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        priceId: env.PADDLE_PRICE_ID,
        userId: unknownUuid,
        email: testUser.email,
      },
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error, "User not found or has no email");
  });
});
