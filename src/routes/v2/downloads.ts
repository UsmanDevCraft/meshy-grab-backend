import { FastifyInstance } from "fastify";

import { getUserByInstallationId } from "../../services/entitlement.js";

import { consumeDownload } from "../../services/downloads.js";

import { ERROR_CODES } from "../../config/errors.js";
import {
  consumeDownloadBodySchema,
  consumeDownloadResponseSchema,
} from "../../schemas/downloads.js";

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
      const {
        installationId,
        taskId,
        previewUrl,
        modelUrl,
        downloadType,
        source,
      } = request.body as {
        installationId: string;
        taskId: string;
        previewUrl?: string | null;
        modelUrl?: string | null;
        downloadType?: string | null;
        source?: string | null;
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
        downloadType,
        source,
      );

      if (!result.allowed) {
        if (
          result.source === "community" ||
          result.error === "COMMUNITY_DOWNLOAD_LIMIT_REACHED"
        ) {
          return reply.code(403).send({
            error: "COMMUNITY_DOWNLOAD_LIMIT_REACHED",
            message: "Community download limit reached.",
            communityModelsRemaining: 0,
            communityModelsLimit: (result as any).communityModelsLimit ?? null,
            communityModelsUsed: (result as any).communityModelsUsed ?? null,
          });
        }

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
          downloadType: downloadType ?? null,
          source: result.source ?? "workspace",
          duplicate: result.duplicate,
          plan: result.plan,
        },
        "Download consumption recorded",
      );

      return result;
    },
  );
}
