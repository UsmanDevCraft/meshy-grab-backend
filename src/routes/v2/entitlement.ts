import { FastifyInstance } from "fastify";
import {
  FREE_DOWNLOAD_LIMIT,
  FREE_TEXTURE_DOWNLOAD_LIMIT,
} from "../../config/constants.js";

import {
  getFreeDownloadsRemaining,
  getFreeTextureDownloadsRemaining,
  getUserAndSubscription,
  isProSubscription,
} from "../../services/entitlement.js";
import { getCommunityEntitlement } from "../../services/community.js";
import {
  entitlementQuerySchema,
  entitlementResponseSchema,
} from "../../schemas/entitlement.js";

interface EntitlementQuery {
  installationId?: string;
  userId?: string;
}

async function handleEntitlementStatus(query: EntitlementQuery) {
  const { installationId, userId } = query;

  if (!installationId && !userId) {
    return {
      error: "installationId or userId is required",
      statusCode: 400,
    };
  }

  const user = await getUserAndSubscription({ userId, installationId });

  if (!user) {
    return {
      statusCode: 200,
      body: {
        exists: false,
        isPaid: false,
        plan: "free",
        freeDownloadsUsed: 0,
        freeDownloadsRemaining: FREE_DOWNLOAD_LIMIT,
        textureDownloadsUsed: 0,
        textureDownloadsRemaining: FREE_TEXTURE_DOWNLOAD_LIMIT,
        communityModelsUsed: 0,
        communityModelsRemaining: 1,
        communityModelsLimit: 1,
        subscriptionStatus: "inactive",
        paddleCustomerId: null,
        paddleSubscriptionId: null,
        paidAt: null,
        accountType: "primary",
        ownerUserId: null,
        accountSlots: 0,
        linkedAccountsCount: 0,
        linkedAccountsRemaining: 0,
      },
    };
  }

  const isPro = user.isPaid || isProSubscription(user.subStatus, user.isPaid);
  const communityEntitlement = await getCommunityEntitlement(user);

  return {
    statusCode: 200,
    body: {
      exists: true,
      userId: user.id,
      email: user.identityEmail ?? user.email,
      isPaid: user.isPaid ?? false,
      plan: isPro ? (user.plan ?? user.subPlan ?? "pro_monthly") : "free",
      freeDownloadsUsed: user.freeDownloadsUsed,
      freeDownloadsRemaining: isPro
        ? null
        : getFreeDownloadsRemaining(user.freeDownloadsUsed),
      textureDownloadsUsed: user.textureDownloadsUsed ?? 0,
      textureDownloadsRemaining: isPro
        ? null
        : getFreeTextureDownloadsRemaining(user.textureDownloadsUsed ?? 0),
      communityModelsUsed: communityEntitlement.communityModelsUsed,
      communityModelsRemaining: communityEntitlement.communityModelsRemaining,
      communityModelsLimit: communityEntitlement.communityModelsLimit,
      subscriptionStatus:
        user.subStatus ?? (user.isPaid ? "active" : "inactive"),
      paddleCustomerId:
        user.paddleCustomerId ?? user.subPaddleCustomerId ?? null,
      paddleSubscriptionId:
        user.paddleSubscriptionId ?? user.subPaddleSubscriptionId ?? null,
      paidAt: user.paidAt ? user.paidAt.toISOString() : null,
      accountType: user.accountType ?? "primary",
      ownerUserId: user.ownerUserId ?? user.id,
      accountSlots: user.accountSlots ?? 0,
      linkedAccountsCount: user.linkedAccountsCount ?? 0,
      linkedAccountsRemaining: user.linkedAccountsRemaining ?? 0,
    },
  };
}

export async function entitlementRoutes(app: FastifyInstance) {
  // GET /entitlement
  app.get<{ Querystring: EntitlementQuery }>(
    "/entitlement",
    {
      schema: {
        querystring: entitlementQuerySchema,
        response: entitlementResponseSchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {});
      if (result.error) {
        return reply.code(result.statusCode).send({ error: result.error });
      }
      return reply.code(result.statusCode).send(result.body);
    },
  );

  // GET /api/user/status
  app.get<{ Querystring: EntitlementQuery }>(
    "/api/user/status",
    {
      schema: {
        querystring: entitlementQuerySchema,
        response: entitlementResponseSchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {});
      if (result.error) {
        return reply.code(result.statusCode).send({ error: result.error });
      }
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
