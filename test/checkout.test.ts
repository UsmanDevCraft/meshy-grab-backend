import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { env } from "../src/config/env.js";
import { db, pool } from "../src/db/client.js";
import { installations, users } from "../src/db/schema.js";
import { checkoutRoutes } from "../src/routes/paddle/checkout.js";

import { paddle } from "../src/lib/paddle.js";

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

  test("1d. plan: pro_max_monthly + valid user/installation/email → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        plan: "pro_max_monthly",
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

  describe("Fav Lifetime Price Selection Security Tests", () => {
    let favUser: { id: string; email: string };
    let favInstallationId: string;
    let nonFavUser: { id: string; email: string };
    let nonFavInstallationId: string;
    const favEmail = `fav_security_test_${Date.now()}@example.com`;
    const nonFavEmail = `nonfav_security_test_${Date.now()}@example.com`;

    before(async () => {
      // In Sandbox mode, use a valid Sandbox price ID distinct from normal/discounted lifetime
      if (env.PADDLE_CLIENT_TOKEN.startsWith("test_")) {
        (env as any).PADDLE_FAV_LIFETIME_PRICE_ID =
          env.PADDLE_PRICE_ID_ANNUALLY_DISCOUNTED;
      }

      env.FAV_LIFETIME_EMAILS.push(favEmail.toLowerCase());

      const [insertedFav] = await db
        .insert(users)
        .values({ email: favEmail })
        .returning({ id: users.id, email: users.email });
      favUser = { id: insertedFav.id, email: insertedFav.email! };
      favInstallationId = `inst_fav_${Date.now()}`;
      await db.insert(installations).values({
        installationId: favInstallationId,
        userId: favUser.id,
      });

      const [insertedNonFav] = await db
        .insert(users)
        .values({ email: nonFavEmail })
        .returning({ id: users.id, email: users.email });
      nonFavUser = { id: insertedNonFav.id, email: insertedNonFav.email! };
      nonFavInstallationId = `inst_nonfav_${Date.now()}`;
      await db.insert(installations).values({
        installationId: nonFavInstallationId,
        userId: nonFavUser.id,
      });
    });

    after(async () => {
      if (favInstallationId) {
        await db
          .delete(installations)
          .where(eq(installations.installationId, favInstallationId));
      }
      if (favUser?.id) {
        await db.delete(users).where(eq(users.id, favUser.id));
      }
      if (nonFavInstallationId) {
        await db
          .delete(installations)
          .where(eq(installations.installationId, nonFavInstallationId));
      }
      if (nonFavUser?.id) {
        await db.delete(users).where(eq(users.id, nonFavUser.id));
      }
    });

    test("Security Test 1: Fav user + Lifetime with isFavLifetime: true -> selects FAV_LIFETIME_PRICE_ID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/checkout",
        payload: {
          plan: "lifetime",
          isFavLifetime: true,
          userId: favUser.id,
          email: favUser.email,
          installationId: favInstallationId,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.transactionId);
      const txn = await paddle.transactions.get(body.transactionId);
      assert.equal(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
    });

    test("Security Test 2: Fav user + Lifetime with isFavLifetime omitted/false -> selects FAV_LIFETIME_PRICE_ID based on backend allowlist", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/checkout",
        payload: {
          plan: "lifetime",
          isFavLifetime: false,
          userId: favUser.id,
          email: favUser.email,
          installationId: favInstallationId,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.transactionId);
      const txn = await paddle.transactions.get(body.transactionId);
      assert.equal(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
    });

    test("Security Test 3: Non-Fav user attempts to force isFavLifetime: true -> falls back to normal Lifetime price", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/checkout",
        payload: {
          plan: "lifetime",
          isFavLifetime: true,
          userId: nonFavUser.id,
          email: nonFavUser.email,
          installationId: nonFavInstallationId,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.transactionId);
      const txn = await paddle.transactions.get(body.transactionId);
      assert.notEqual(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
      assert.equal(txn.items[0].price?.id, env.PADDLE_PRICE_ID_LIFETIME);
    });

    test("Security Test 4: Non-Fav discounted user -> selects discounted Lifetime price, NOT FAV_LIFETIME_PRICE_ID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/checkout",
        payload: {
          plan: "lifetime",
          isDiscounted: true,
          userId: nonFavUser.id,
          email: nonFavUser.email,
          installationId: nonFavInstallationId,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.transactionId);
      const txn = await paddle.transactions.get(body.transactionId);
      assert.notEqual(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
      assert.equal(
        txn.items[0].price?.id,
        env.PADDLE_PRICE_ID_LIFETIME_DISCOUNTED,
      );
    });

    test("Security Test 5: Fav user buying another plan (pro_monthly) -> selects normal plan price, NOT FAV_LIFETIME_PRICE_ID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/checkout",
        payload: {
          plan: "pro_monthly",
          isFavLifetime: true,
          userId: favUser.id,
          email: favUser.email,
          installationId: favInstallationId,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.transactionId);
      const txn = await paddle.transactions.get(body.transactionId);
      assert.notEqual(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
      assert.equal(txn.items[0].price?.id, env.PADDLE_PRICE_ID_MONTHLY);
    });

    test("Security Test 6: Email normalization (spaces, mixed case) resolves to allowlisted user", async () => {
      const normEmail = `norm_user_${Date.now()}@example.com`;
      env.FAV_LIFETIME_EMAILS.push(normEmail.toLowerCase());

      const [insertedNorm] = await db
        .insert(users)
        .values({ email: normEmail })
        .returning({ id: users.id, email: users.email });
      const normInstallationId = `inst_norm_${Date.now()}`;
      await db.insert(installations).values({
        installationId: normInstallationId,
        userId: insertedNorm.id,
      });

      try {
        const res = await app.inject({
          method: "POST",
          url: "/api/checkout",
          payload: {
            plan: "lifetime",
            userId: insertedNorm.id,
            email: `  ${normEmail.toUpperCase()}  `,
            installationId: normInstallationId,
          },
        });

        assert.equal(res.statusCode, 201);
        const body = res.json();
        assert.ok(body.transactionId);
        const txn = await paddle.transactions.get(body.transactionId);
        assert.equal(txn.items[0].price?.id, env.PADDLE_FAV_LIFETIME_PRICE_ID);
      } finally {
        await db
          .delete(installations)
          .where(eq(installations.installationId, normInstallationId));
        await db.delete(users).where(eq(users.id, insertedNorm.id));
      }
    });
  });
});
