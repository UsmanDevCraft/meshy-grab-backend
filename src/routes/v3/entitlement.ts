import { FastifyInstance } from "fastify";
import {
  FREE_DOWNLOAD_LIMIT,
  FREE_TEXTURE_DOWNLOAD_LIMIT,
} from "../../config/constants.js";

import {
  getFreeDownloadsRemaining,
  getFreeTextureDownloadsRemaining,
  getLatestInstallationIdForUser,
  getUserAndSubscription,
  isProSubscription,
} from "../../services/entitlement.js";
import { getCommunityEntitlement } from "../../services/community.js";
import { getTripoEntitlement } from "../../services/tripo.js";
import { getFeaturesEntitlement } from "../../services/features.js";
import {
  entitlementQuerySchema,
  v3EntitlementResponseSchema,
} from "../../schemas/entitlement.js";

interface EntitlementQuery {
  installationId?: string;
  userId?: string;
  email?: string;
}

async function handleEntitlementStatus(
  query: EntitlementQuery,
  allowEmail = false,
) {
  const { installationId, userId, email } = query;

  if (!installationId && !userId && (!allowEmail || !email)) {
    return {
      statusCode: 400,
      error: "installationId, userId or email is required",
    };
  }

  const user = await getUserAndSubscription({
    installationId,
    userId,
    email: allowEmail ? email : undefined,
  });

  if (installationId && userId && user) {
    if (user.id !== userId && user.ownerUserId !== userId) {
      return {
        statusCode: 403,
        error: "UNAUTHORIZED",
        message: "installationId does not match provided userId.",
      };
    }
  }

  // Email status lookup: don't reveal default entitlement information
  // when the supplied email does not belong to an existing user.
  if (allowEmail && email && !user) {
    return {
      statusCode: 404,
      error: "User not found",
    };
  }

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
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        accountType: "primary",
        ownerUserId: null,
        accountSlots: 0,
        linkedAccountsCount: 0,
        linkedAccountsRemaining: 0,
        tripo: {
          studioModels: {
            limit: 0,
            used: 0,
            remaining: 0,
            unlimited: false,
          },
        },
        features: {
          upscaling: {
            available: false,
            limit: null,
            used: 0,
            remaining: null,
            unlimited: false,
            period: null,
            periodStart: null,
            periodEnd: null,
          },
          formatConversion: {
            available: false,
            limit: null,
            used: 0,
            remaining: null,
            unlimited: false,
            period: null,
            periodStart: null,
            periodEnd: null,
          },
        },
      },
    };
  }

  const isPro = user.isPaid || isProSubscription(user.subStatus, user.isPaid);
  const communityEntitlement = await getCommunityEntitlement(user);
  const tripoEntitlement = await getTripoEntitlement(user);
  const featureEntitlement = await getFeaturesEntitlement(user);

  const fullResponse = {
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
    subscriptionStatus: user.subStatus ?? (user.isPaid ? "active" : "inactive"),
    paddleCustomerId: user.paddleCustomerId ?? user.subPaddleCustomerId ?? null,
    paddleSubscriptionId:
      user.paddleSubscriptionId ?? user.subPaddleSubscriptionId ?? null,
    paidAt: user.paidAt ? user.paidAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    currentPeriodStart: user.currentPeriodStart
      ? user.currentPeriodStart.toISOString()
      : null,
    currentPeriodEnd: user.currentPeriodEnd
      ? user.currentPeriodEnd.toISOString()
      : null,
    accountType: user.accountType ?? "primary",
    ownerUserId: user.ownerUserId ?? user.id,
    accountSlots: user.accountSlots ?? 0,
    linkedAccountsCount: user.linkedAccountsCount ?? 0,
    linkedAccountsRemaining: user.linkedAccountsRemaining ?? 0,
    tripo: {
      studioModels: tripoEntitlement.studioModels,
    },
    features: featureEntitlement,
  };

  // Keep the existing full entitlement response for /entitlement.
  if (!allowEmail) {
    return {
      statusCode: 200,
      body: fullResponse,
    };
  }

  let installationIdForStatus: string | null = null;
  if (email) {
    const ownerUserId = user.ownerUserId ?? user.id;
    installationIdForStatus = await getLatestInstallationIdForUser(ownerUserId);
  }

  // Minimal response for /api/user/status.
  return {
    statusCode: 200,
    body: {
      exists: true,
      ...(email ? { installationId: installationIdForStatus } : {}),
      isPaid: fullResponse.isPaid,
      plan: fullResponse.plan,
      subscriptionStatus: fullResponse.subscriptionStatus,
      paidAt: fullResponse.paidAt,
      cancelAtPeriodEnd: fullResponse.cancelAtPeriodEnd,
      currentPeriodStart: fullResponse.currentPeriodStart,
      currentPeriodEnd: fullResponse.currentPeriodEnd,
      accountType: fullResponse.accountType,
    },
  };
}

export async function entitlementRoutes(app: FastifyInstance) {
  // GET /entitlement - existing full entitlement response.
  app.get<{ Querystring: EntitlementQuery }>(
    "/entitlement",
    {
      schema: {
        querystring: entitlementQuerySchema,
        response: v3EntitlementResponseSchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {});

      if (result.error) {
        return reply.code(result.statusCode).send({
          error: result.error,
        });
      }

      return reply.code(result.statusCode).send(result.body);
    },
  );

  // GET /api/user/status - minimal account status response.
  app.get<{ Querystring: EntitlementQuery }>(
    "/api/user/status",
    {
      schema: {
        querystring: entitlementQuerySchema,
      },
    },
    async (request, reply) => {
      const result = await handleEntitlementStatus(request.query || {}, true);

      if (result.error) {
        return reply.code(result.statusCode).send({
          error: result.error,
        });
      }

      return reply.code(result.statusCode).send(result.body);
    },
  );
}
