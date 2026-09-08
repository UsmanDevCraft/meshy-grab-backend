import { FastifyInstance } from "fastify";

import { getUserByInstallationId } from "../services/entitlement.js";
import { consumeTexture } from "../services/textures.js";

import { ERROR_CODES } from "../config/errors.js";
import {
  consumeTextureBodySchema,
  consumeTextureResponseSchema,
} from "../schemas/textures.js";

async function handleTextureConsumption(
  installationId: string,
  log: FastifyInstance["log"],
) {
  const user = await getUserByInstallationId(installationId);

  if (!user) {
    return {
      statusCode: 404,
      body: {
        error: ERROR_CODES.INSTALLATION_NOT_FOUND,
        message: "Installation not found.",
      },
    };
  }

  const result = await consumeTexture(user.id);

  if (!result.allowed) {
    return {
      statusCode: 403,
      body: {
        error: ERROR_CODES.FREE_TEXTURE_DOWNLOAD_LIMIT_REACHED,
        message: "Free texture download limit reached.",
        textureDownloadsRemaining: 0,
      },
    };
  }

  log.info(
    {
      installationId,
      plan: result.plan,
    },
    "Texture consumption recorded",
  );

  return {
    statusCode: 200,
    body: result,
  };
}

export async function textureRoutes(app: FastifyInstance) {
  const consumeOptions = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      body: consumeTextureBodySchema,
      response: consumeTextureResponseSchema,
    },
  };

  const handler = async (request: any, reply: any) => {
    const { installationId } = request.body as {
      installationId: string;
    };

    const res = await handleTextureConsumption(installationId, request.log);
    return reply.code(res.statusCode as 200 | 403 | 404).send(res.body);
  };

  // POST /textures/consume
  app.post("/textures/consume", consumeOptions, handler);

  // POST /api/textures/consume
  app.post("/api/textures/consume", consumeOptions, handler);
}
