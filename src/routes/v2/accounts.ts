import { FastifyInstance } from "fastify";

import { getUserAndSubscription } from "../../services/entitlement.js";
import {
  getLinkedAccountsForOwner,
  linkAccount,
} from "../../services/accounts.js";
import {
  accountsQuerySchema,
  linkAccountBodySchema,
} from "../../schemas/accounts.js";

interface AccountsQuery {
  installationId?: string;
  userId?: string;
}

interface LinkAccountBody {
  meshyEmail: string;
  installationId?: string;
  userId?: string;
}

export async function accountRoutes(app: FastifyInstance) {
  // POST /v2/accounts/link (and aliases /accounts/link, /api/accounts/link)
  const linkHandler = async (request: any, reply: any) => {
    const body = (request.body || {}) as LinkAccountBody;
    const query = (request.query || {}) as AccountsQuery;

    const installationId = body.installationId || query.installationId;
    const userId = body.userId || query.userId;

    if (!installationId && !userId) {
      return reply.code(400).send({
        error: "AUTHENTICATION_REQUIRED",
        message: "installationId or userId is required to authenticate owner.",
      });
    }

    let user;
    if (installationId) {
      user = await getUserAndSubscription({ installationId });
      if (user && userId && user.id !== userId && user.ownerUserId !== userId) {
        return reply.code(403).send({
          error: "UNAUTHORIZED",
          message: "installationId does not match provided userId.",
        });
      }
    } else if (userId) {
      user = await getUserAndSubscription({ userId });
    }

    if (!user) {
      return reply.code(404).send({
        error: "USER_NOT_FOUND",
        message: "User or installation not found.",
      });
    }

    const result = await linkAccount({
      ownerUserId: user.ownerUserId,
      meshyEmail: body.meshyEmail,
    });

    if (!result.success) {
      return reply.code(result.statusCode).send({
        error: result.error,
        message: result.message,
      });
    }

    return reply.code(201).send({
      accountType: user.accountType,
      ownerUserId: user.ownerUserId,
      ...result.data,
    });
  };

  app.post<{ Body: LinkAccountBody; Querystring: AccountsQuery }>(
    "/accounts/link",
    {
      schema: {
        body: linkAccountBodySchema,
        querystring: accountsQuerySchema,
      },
    },
    linkHandler,
  );

  app.post<{ Body: LinkAccountBody; Querystring: AccountsQuery }>(
    "/api/accounts/link",
    {
      schema: {
        body: linkAccountBodySchema,
        querystring: accountsQuerySchema,
      },
    },
    linkHandler,
  );

  // GET /v2/accounts (and aliases /accounts, /api/accounts)
  const getAccountsHandler = async (request: any, reply: any) => {
    const query = (request.query || {}) as AccountsQuery;
    const { installationId, userId } = query;

    if (!installationId && !userId) {
      return reply.code(400).send({
        error: "AUTHENTICATION_REQUIRED",
        message: "installationId or userId is required.",
      });
    }

    let user;
    if (installationId) {
      user = await getUserAndSubscription({ installationId });
      if (user && userId && user.id !== userId && user.ownerUserId !== userId) {
        return reply.code(403).send({
          error: "UNAUTHORIZED",
          message: "installationId does not match provided userId.",
        });
      }
    } else if (userId) {
      user = await getUserAndSubscription({ userId });
    }

    if (!user) {
      return reply.code(404).send({
        error: "USER_NOT_FOUND",
        message: "User or installation not found.",
      });
    }

    const details = await getLinkedAccountsForOwner(
      user.ownerUserId,
      user.effectivePlan,
      user.isPaid,
    );

    return reply.code(200).send({
      accountType: user.accountType,
      ownerUserId: user.ownerUserId,
      accountSlots: details.accountSlots,
      linkedAccountsCount: details.linkedAccountsCount,
      linkedAccountsRemaining: details.linkedAccountsRemaining,
      accounts: details.accounts,
    });
  };

  app.get<{ Querystring: AccountsQuery }>(
    "/accounts",
    {
      schema: {
        querystring: accountsQuerySchema,
      },
    },
    getAccountsHandler,
  );

  app.get<{ Querystring: AccountsQuery }>(
    "/api/accounts",
    {
      schema: {
        querystring: accountsQuerySchema,
      },
    },
    getAccountsHandler,
  );
}
