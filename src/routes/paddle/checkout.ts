import { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";

import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { installations, users } from "../../db/schema.js";
import { paddle } from "../../lib/paddle.js";

export const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/checkout", async (request, reply) => {
    const body = request.body as {
      plan?: string;
      priceId?: string;
      isDiscounted?: boolean;
      isFavLifetime?: boolean;
      userId?: string;
      email?: string;
      installationId?: string;
    };

    const {
      plan: rawPlan,
      priceId: rawPriceId,
      isDiscounted,
      isFavLifetime,
      userId,
      email,
      installationId,
    } = body || {};

    if (
      (!rawPlan && !rawPriceId) ||
      !userId ||
      typeof email !== "string" ||
      !email.trim() ||
      !installationId
    ) {
      return reply.status(400).send({
        error: "plan, userId, email, and installationId are required",
      });
    }

    const discounted = isDiscounted === true;

    let plan: "pro_monthly" | "pro_annual" | "pro_max_monthly" | "lifetime";
    let priceId: string;

    if (rawPlan) {
      if (rawPlan === "pro_monthly") {
        plan = "pro_monthly";

        // Discounts are NOT supported for Pro Monthly.
        priceId = env.PADDLE_PRICE_ID_MONTHLY;
      } else if (rawPlan === "pro_max_monthly") {
        plan = "pro_max_monthly";

        priceId = discounted
          ? env.PADDLE_PRICE_PRO_MAX_MONTHLY_DISCOUNTED
          : env.PADDLE_PRICE_PRO_MAX_MONTHLY;
      } else if (rawPlan === "pro_annual") {
        plan = "pro_annual";

        priceId = discounted
          ? env.PADDLE_PRICE_ID_ANNUALLY_DISCOUNTED
          : env.PADDLE_PRICE_ID_ANNUALLY;
      } else if (rawPlan === "lifetime") {
        plan = "lifetime";

        priceId = discounted
          ? env.PADDLE_PRICE_ID_LIFETIME_DISCOUNTED
          : env.PADDLE_PRICE_ID_LIFETIME;
      } else {
        return reply.status(400).send({
          error: "Invalid plan",
        });
      }
    } else {
      // Legacy/direct priceId flow.
      // Keep existing behavior for callers that do not send a plan.
      if (rawPriceId === env.PADDLE_PRICE_ID_MONTHLY) {
        plan = "pro_monthly";
        priceId = env.PADDLE_PRICE_ID_MONTHLY;
      } else if (rawPriceId === env.PADDLE_PRICE_PRO_MAX_MONTHLY) {
        plan = "pro_max_monthly";
        priceId = env.PADDLE_PRICE_PRO_MAX_MONTHLY;
      } else if (rawPriceId === env.PADDLE_PRICE_ID_ANNUALLY) {
        plan = "pro_annual";
        priceId = env.PADDLE_PRICE_ID_ANNUALLY;
      } else if (
        rawPriceId === env.PADDLE_PRICE_ID_LIFETIME ||
        rawPriceId === env.PADDLE_PRICE_ID_LIFETIME_DISCOUNTED ||
        rawPriceId === env.PADDLE_FAV_LIFETIME_PRICE_ID
      ) {
        plan = "lifetime";
        priceId = env.PADDLE_PRICE_ID_LIFETIME;
      } else {
        return reply.status(400).send({
          error: "Invalid priceId",
        });
      }
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

    // 2c. Authoritative backend price resolution for Lifetime checkout:
    // Only plan === "lifetime" enters the Fav Lifetime check.
    // The backend allowlist env.FAV_LIFETIME_EMAILS is the strict source of truth.
    if (plan === "lifetime") {
      const isFavLifetimeUser =
        env.FAV_LIFETIME_EMAILS.includes(normalizedEmail);

      if (isFavLifetimeUser) {
        priceId = env.PADDLE_FAV_LIFETIME_PRICE_ID;
      } else if (discounted) {
        priceId = env.PADDLE_PRICE_ID_LIFETIME_DISCOUNTED;
      } else {
        priceId = env.PADDLE_PRICE_ID_LIFETIME;
      }
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

      // 4. Create Paddle transaction.
      // The server-selected priceId is authoritative.
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
          plan,
        },
      });

      const paddleCheckoutUrl = transaction.checkout?.url;

      if (!paddleCheckoutUrl) {
        fastify.log.error(
          {
            transactionId: transaction.id,
            userId,
            plan,
            priceId,
            discounted,
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
          plan,
          priceId,
          discounted,
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
          plan,
          priceId,
          discounted,
        },
        "Failed to create Paddle checkout transaction",
      );

      return reply.status(502).send({
        error: "Failed to create Paddle checkout transaction",
      });
    }
  });
};
