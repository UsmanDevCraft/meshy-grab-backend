import { FastifyPluginAsync } from "fastify";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { and, eq } from "drizzle-orm";

import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { installations, users } from "../../db/schema.js";

const paddle = new Paddle(env.PADDLE_API_KEY, {
  // environment: Environment.production,
  environment: Environment.sandbox,
});

export const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/checkout", async (request, reply) => {
    const body = request.body as {
      priceId?: string;
      userId?: string;
      email?: string;
      installationId?: string;
    };

    const { priceId, userId, email, installationId } = body || {};

    if (
      !priceId ||
      !userId ||
      typeof email !== "string" ||
      !email.trim() ||
      !installationId
    ) {
      return reply.status(400).send({
        error: "priceId, userId, email, and installationId are required",
      });
    }

    if (priceId !== env.PADDLE_PRICE_ID) {
      return reply.status(400).send({
        error: "Invalid priceId",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Look up user in database by userId
    let user;
    try {
      const [foundUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      user = foundUser;
    } catch (dbError: any) {
      fastify.log.warn(
        { userId, error: dbError?.message },
        "Invalid userId or database query failed during checkout",
      );
      return reply.status(400).send({
        error: "Invalid userId or user not found",
      });
    }

    if (!user || !user.email) {
      fastify.log.warn(
        { userId },
        "Checkout attempt for non-existent user or user without email",
      );
      return reply.status(404).send({
        error: "User not found or has no email",
      });
    }

    // 2. Verify email matches Meshy user account
    const userEmailNormalized = user.email.trim().toLowerCase();
    if (userEmailNormalized !== normalizedEmail) {
      fastify.log.warn(
        { userId },
        "Checkout email mismatch with Meshy account email",
      );
      return reply.status(403).send({
        error: "Email does not match the Meshy account",
      });
    }

    // 2b. Verify installationId belongs to this user
    const [installation] = await db
      .select()
      .from(installations)
      .where(
        and(
          eq(installations.installationId, installationId),
          eq(installations.userId, userId),
        ),
      );

    if (!installation) {
      fastify.log.warn(
        { userId },
        "Checkout attempt with installationId not owned by user",
      );
      return reply.status(403).send({
        error: "installationId does not belong to this user",
      });
    }

    // 3. Obtain or create Paddle Customer ID to lock email on checkout
    let paddleCustomerId = user.paddleCustomerId;

    try {
      if (!paddleCustomerId) {
        const existingCustomers = await paddle.customers
          .list({ email: [normalizedEmail] })
          .next();

        if (existingCustomers.length > 0) {
          paddleCustomerId = existingCustomers[0].id;
        } else {
          try {
            const newCustomer = await paddle.customers.create({
              email: normalizedEmail,
            });
            paddleCustomerId = newCustomer.id;
          } catch (createErr: any) {
            const retryExisting = await paddle.customers
              .list({ email: [normalizedEmail] })
              .next();
            if (retryExisting.length > 0) {
              paddleCustomerId = retryExisting[0].id;
            } else {
              throw createErr;
            }
          }
        }

        // Persist paddleCustomerId to database
        await db
          .update(users)
          .set({
            paddleCustomerId,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }

      // 4. Create Paddle transaction with locked customer email & customData.userId
      const transaction = await paddle.transactions.create({
        items: [
          {
            priceId,
            quantity: 1,
          },
        ],
        customerId: paddleCustomerId,
        customData: {
          userId,
          installationId,
        },
      });

      const paddleCheckoutUrl = transaction.checkout?.url;

      if (!paddleCheckoutUrl) {
        fastify.log.error(
          {
            transactionId: transaction.id,
            userId,
          },
          "Paddle transaction created but no checkout URL was returned",
        );

        return reply.status(500).send({
          error: "Failed to generate checkout URL",
        });
      }

      const checkoutUrl = new URL(paddleCheckoutUrl);
      checkoutUrl.searchParams.set("installationId", installationId);

      fastify.log.info(
        {
          transactionId: transaction.id,
          userId,
          paddleCustomerId,
          installationId,
        },
        "Paddle checkout transaction created successfully",
      );

      return reply.status(201).send({
        url: checkoutUrl.toString(),
        transactionId: transaction.id,
      });
    } catch (error: any) {
      fastify.log.error(
        {
          error,
          message: error?.message,
          code: error?.code,
          userId,
        },
        "Failed to create Paddle checkout transaction",
      );

      return reply.status(502).send({
        error: "Failed to create Paddle checkout transaction",
      });
    }
  });
};
