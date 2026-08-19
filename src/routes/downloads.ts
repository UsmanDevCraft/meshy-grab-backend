import { FastifyInstance } from "fastify";

import { getUserByInstallationId } from "../services/entitlement.js";

import { consumeDownload } from "../services/downloads.js";

import { ERROR_CODES } from "../config/errors.js";
import {
  consumeDownloadBodySchema,
  consumeDownloadResponseSchema,
} from "../schemas/downloads.js";

export async function downloadRoutes(app: FastifyInstance) {
  app.post(
    "/downloads/consume",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },

      schema: {
        body: consumeDownloadBodySchema,
        response: consumeDownloadResponseSchema,
      },
    },

    async (request, reply) => {
      const { installationId, taskId, previewUrl, modelUrl } = request.body as {
        installationId: string;
        taskId: string;
        previewUrl?: string | null;
        modelUrl?: string | null;
      };

      const user = await getUserByInstallationId(installationId);

      if (!user) {
        return reply.code(404).send({
          error: ERROR_CODES.INSTALLATION_NOT_FOUND,
          message: "Installation not found.",
        });
      }

      const result = await consumeDownload(
        user.id,
        taskId,
        previewUrl,
        modelUrl,
      );

      if (!result.allowed) {
        return reply.code(403).send({
          error: ERROR_CODES.FREE_DOWNLOAD_LIMIT_REACHED,
          message: "Free download limit reached.",
          freeDownloadsRemaining: 0,
        });
      }

      request.log.info(
        {
          installationId,
          taskId,
          duplicate: result.duplicate,
          plan: result.plan,
        },
        "Download consumption recorded",
      );

      return result;
    },
  );
}
