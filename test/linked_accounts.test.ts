import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { eq, inArray } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import {
  installations,
  linkedAccounts,
  subscriptions,
  users,
} from "../src/db/schema.js";
import { v2Routes } from "../src/routes/v2/index.ts";
import { getAccountSlotsForPlan } from "../src/services/accounts.js";

describe("Attached Accounts Backend Foundation", () => {
  let app: ReturnType<typeof Fastify>;

  let primaryProMaxUser: { id: string; email: string };
  let primaryProMaxInst: string;

  let primaryLifetimeUser: { id: string; email: string };
  let primaryLifetimeInst: string;

  let primaryFreeUser: { id: string; email: string };
  let primaryFreeInst: string;

  let primaryProUser: { id: string; email: string };
  let primaryProInst: string;

  let otherUser: { id: string; email: string };
  let createdUserIds: string[] = [];
  let createdInstIds: string[] = [];

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(v2Routes, { prefix: "/v2" });
    await app.ready();

    const timestamp = Date.now();

    // 1. Pro Max User (2 slots)
    const proMaxEmail = `promax_owner_${timestamp}@example.com`;
    const [insertedProMax] = await db
      .insert(users)
      .values({ email: proMaxEmail, isPaid: true, plan: "pro_max_monthly" })
      .returning();
    primaryProMaxUser = { id: insertedProMax.id, email: insertedProMax.email! };
    createdUserIds.push(insertedProMax.id);

    primaryProMaxInst = `inst_promax_${timestamp}`;
    await db.insert(installations).values({
      installationId: primaryProMaxInst,
      userId: primaryProMaxUser.id,
    });
    createdInstIds.push(primaryProMaxInst);

    // 2. Lifetime User (4 slots)
    const lifetimeEmail = `lifetime_owner_${timestamp}@example.com`;
    const [insertedLifetime] = await db
      .insert(users)
      .values({ email: lifetimeEmail, isPaid: true, plan: "lifetime" })
      .returning();
    primaryLifetimeUser = {
      id: insertedLifetime.id,
      email: insertedLifetime.email!,
    };
    createdUserIds.push(insertedLifetime.id);

    primaryLifetimeInst = `inst_lifetime_${timestamp}`;
    await db.insert(installations).values({
      installationId: primaryLifetimeInst,
      userId: primaryLifetimeUser.id,
    });
    createdInstIds.push(primaryLifetimeInst);

    // 3. Free User (0 slots)
    const freeEmail = `free_owner_${timestamp}@example.com`;
    const [insertedFree] = await db
      .insert(users)
      .values({ email: freeEmail, isPaid: false, plan: null })
      .returning();
    primaryFreeUser = { id: insertedFree.id, email: insertedFree.email! };
    createdUserIds.push(insertedFree.id);

    primaryFreeInst = `inst_free_${timestamp}`;
    await db.insert(installations).values({
      installationId: primaryFreeInst,
      userId: primaryFreeUser.id,
    });
    createdInstIds.push(primaryFreeInst);

    // 4. Pro Monthly User (0 slots)
    const proEmail = `pro_owner_${timestamp}@example.com`;
    const [insertedPro] = await db
      .insert(users)
      .values({ email: proEmail, isPaid: true, plan: "pro_monthly" })
      .returning();
    primaryProUser = { id: insertedPro.id, email: insertedPro.email! };
    createdUserIds.push(insertedPro.id);

    primaryProInst = `inst_pro_${timestamp}`;
    await db.insert(installations).values({
      installationId: primaryProInst,
      userId: primaryProUser.id,
    });
    createdInstIds.push(primaryProInst);

    // 5. Other User
    const otherEmail = `other_user_${timestamp}@example.com`;
    const [insertedOther] = await db
      .insert(users)
      .values({ email: otherEmail, isPaid: false })
      .returning();
    otherUser = { id: insertedOther.id, email: insertedOther.email! };
    createdUserIds.push(insertedOther.id);
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await db
        .delete(linkedAccounts)
        .where(inArray(linkedAccounts.ownerUserId, createdUserIds));
    }
    if (createdInstIds.length > 0) {
      await db
        .delete(installations)
        .where(inArray(installations.installationId, createdInstIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await app.close();
    await pool.end();
  });

  describe("1. Plan Slots Allocation", () => {
    test("free → 0 slots", () => {
      assert.equal(getAccountSlotsForPlan("free", false), 0);
      assert.equal(getAccountSlotsForPlan(null, false), 0);
    });

    test("pro_monthly → 0 slots", () => {
      assert.equal(getAccountSlotsForPlan("pro_monthly", true), 0);
    });

    test("pro_annual → 0 slots", () => {
      assert.equal(getAccountSlotsForPlan("pro_annual", true), 0);
    });

    test("pro_max_monthly → 2 slots", () => {
      assert.equal(getAccountSlotsForPlan("pro_max_monthly", true), 2);
    });

    test("lifetime → 4 slots", () => {
      assert.equal(getAccountSlotsForPlan("lifetime", true), 4);
    });
  });

  describe("2. Account Linking (POST /v2/accounts/link)", () => {
    const ts = Date.now();
    const attached1Email = `attached1_${ts}@example.com`;
    const attached2Email = `attached2_${ts}@example.com`;
    const attached3Email = `attached3_${ts}@example.com`;

    test("Eligible owner (Pro Max) + available slot → success (201)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: `  ${attached1Email.toUpperCase()}  `,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.accountType, "primary");
      assert.equal(body.ownerUserId, primaryProMaxUser.id);
      assert.equal(body.accountSlots, 2);
      assert.equal(body.linkedAccountsCount, 1);
      assert.equal(body.linkedAccountsRemaining, 1);
      assert.equal(body.accounts.length, 1);
      assert.equal(body.accounts[0].meshyEmail, attached1Email);
    });

    test("Re-linking same email twice → rejected (409)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: attached1Email,
        },
      });

      assert.equal(res.statusCode, 409);
      const body = res.json();
      assert.equal(body.error, "EMAIL_ALREADY_LINKED");
    });

    test("Linking owner's own primary email → rejected (400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: primaryProMaxUser.email,
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.error, "CANNOT_LINK_PRIMARY_EMAIL");
    });

    test("Linking email already owned by another primary MeshyGrab user → rejected (409)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: otherUser.email,
        },
      });

      assert.equal(res.statusCode, 409);
      const body = res.json();
      assert.equal(body.error, "EMAIL_BELONGS_TO_OTHER_USER");
    });

    test("Link second email on Pro Max → success (slot 2/2)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: attached2Email,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.linkedAccountsCount, 2);
      assert.equal(body.linkedAccountsRemaining, 0);
    });

    test("Exceeding slot limit on Pro Max (3rd email) → rejected (403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProMaxInst,
          meshyEmail: attached3Email,
        },
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.error, "SLOT_LIMIT_REACHED");
    });

    test("Owner on plan with 0 slots (Pro Monthly) → rejected (403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryProInst,
          meshyEmail: `attached_pro_${ts}@example.com`,
        },
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.error, "PLAN_HAS_NO_SLOTS");
    });

    test("Owner on Free plan (0 slots) → rejected (403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryFreeInst,
          meshyEmail: `attached_free_${ts}@example.com`,
        },
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.error, "PLAN_HAS_NO_SLOTS");
    });

    test("Lifetime owner can attach up to 4 accounts", async () => {
      for (let i = 1; i <= 4; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/v2/accounts/link",
          payload: {
            installationId: primaryLifetimeInst,
            meshyEmail: `lifetime_child_${i}_${ts}@example.com`,
          },
        });
        assert.equal(res.statusCode, 201);
        const body = res.json();
        assert.equal(body.accountSlots, 4);
        assert.equal(body.linkedAccountsCount, i);
        assert.equal(body.linkedAccountsRemaining, 4 - i);
      }

      // 5th attempt should be rejected
      const failRes = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryLifetimeInst,
          meshyEmail: `lifetime_child_5_${ts}@example.com`,
        },
      });
      assert.equal(failRes.statusCode, 403);
    });
  });

  describe("3. Entitlement & Resolution (GET /v2/entitlement)", () => {
    test("Primary account entitlement status returns owner subscription & slot counts", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v2/entitlement?installationId=${primaryProMaxInst}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.exists, true);
      assert.equal(body.accountType, "primary");
      assert.equal(body.ownerUserId, primaryProMaxUser.id);
      assert.equal(body.isPaid, true);
      assert.equal(body.plan, "pro_max_monthly");
      assert.equal(body.accountSlots, 2);
      assert.equal(body.linkedAccountsCount, 2);
      assert.equal(body.linkedAccountsRemaining, 0);
    });

    test("Attached account inherits primary owner's entitlement", async () => {
      // Create a fresh Pro Max owner user
      const ts = Date.now();
      const freshOwnerEmail = `fresh_owner_${ts}@example.com`;
      const [freshOwner] = await db
        .insert(users)
        .values({
          email: freshOwnerEmail,
          isPaid: true,
          plan: "pro_max_monthly",
        })
        .returning();
      createdUserIds.push(freshOwner.id);

      const freshInst = `inst_fresh_${ts}`;
      await db.insert(installations).values({
        installationId: freshInst,
        userId: freshOwner.id,
      });
      createdInstIds.push(freshInst);

      const attachedEmail = `attached_inherit_${ts}@example.com`;

      const linkRes = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: freshInst,
          meshyEmail: attachedEmail,
        },
      });
      assert.equal(linkRes.statusCode, 201);

      // Install using attached email
      const attachedInst = `inst_attached_child_${ts}`;
      createdInstIds.push(attachedInst);

      const installRes = await app.inject({
        method: "POST",
        url: "/v2/install",
        payload: {
          installationId: attachedInst,
          email: attachedEmail,
        },
      });
      assert.equal(installRes.statusCode, 201);

      // Query entitlement for attached installation
      const res = await app.inject({
        method: "GET",
        url: `/v2/entitlement?installationId=${attachedInst}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.exists, true);
      assert.equal(body.accountType, "attached");
      assert.equal(body.ownerUserId, freshOwner.id);
      assert.equal(body.email, attachedEmail);
      assert.equal(body.isPaid, true);
      assert.equal(body.plan, "pro_max_monthly");
    });
  });

  describe("4. Accounts Listing Endpoint (GET /v2/accounts)", () => {
    test("GET /v2/accounts for primary owner", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v2/accounts?installationId=${primaryProMaxInst}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.accountType, "primary");
      assert.equal(body.ownerUserId, primaryProMaxUser.id);
      assert.equal(body.accountSlots, 2);
      assert.equal(body.linkedAccountsCount, 2);
      assert.equal(body.linkedAccountsRemaining, 0);
      assert.equal(body.accounts.length, 2);
    });
  });

  describe("5. Plan Changes / Downgrade", () => {
    test("Downgrade Pro Max user to Pro Monthly retains rows but sets slots/remaining to 0", async () => {
      // Update plan to pro_monthly
      await db
        .update(users)
        .set({ plan: "pro_monthly" })
        .where(eq(users.id, primaryProMaxUser.id));

      const res = await app.inject({
        method: "GET",
        url: `/v2/accounts?installationId=${primaryProMaxInst}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.accountSlots, 0);
      assert.equal(body.linkedAccountsCount, 2); // 2 stored rows remain!
      assert.equal(body.linkedAccountsRemaining, 0);
      assert.equal(body.accounts.length, 2);

      // Restore plan back to pro_max_monthly for cleanup/consistency
      await db
        .update(users)
        .set({ plan: "pro_max_monthly" })
        .where(eq(users.id, primaryProMaxUser.id));
    });
  });

  describe("6. Security Requirements", () => {
    test("Client cannot pass fake/unowned userId or client fields to spoof entitlement", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v2/accounts/link",
        payload: {
          installationId: primaryFreeInst, // Free user's installation!
          userId: primaryProMaxUser.id, // Trying to spoof Pro Max user ID!
          meshyEmail: "spoofed_link@example.com",
        },
      });

      // The server rejects spoofed request with 403 Forbidden!
      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.ok(
        body.error === "UNAUTHORIZED" || body.error === "PLAN_HAS_NO_SLOTS",
      );
    });
  });

  describe("7. Concurrency Protection", () => {
    test("Simultaneous parallel link requests enforce slot limits atomically", async () => {
      // Create a fresh Pro Max user (2 slots)
      const ts = Date.now();
      const concEmail = `conc_owner_${ts}@example.com`;
      const [concOwner] = await db
        .insert(users)
        .values({ email: concEmail, isPaid: true, plan: "pro_max_monthly" })
        .returning();
      createdUserIds.push(concOwner.id);

      const concInst = `inst_conc_${ts}`;
      await db.insert(installations).values({
        installationId: concInst,
        userId: concOwner.id,
      });
      createdInstIds.push(concInst);

      // Launch 4 concurrent link requests at the exact same time
      const requests = [1, 2, 3, 4].map((i) =>
        app.inject({
          method: "POST",
          url: "/v2/accounts/link",
          payload: {
            installationId: concInst,
            meshyEmail: `concurrent_child_${i}_${ts}@example.com`,
          },
        }),
      );

      const results = await Promise.all(requests);
      const statusCodes = results.map((r) => r.statusCode);
      const successCount = statusCodes.filter((code) => code === 201).length;
      const rejectedCount = statusCodes.filter((code) => code === 403).length;

      // Exactly 2 requests must succeed (2 slots max), and 2 must be rejected with 403!
      assert.equal(successCount, 2);
      assert.equal(rejectedCount, 2);
    });
  });
});
