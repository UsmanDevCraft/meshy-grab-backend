import { FastifyInstance } from "fastify";
import { consumeTripoDownload } from "../../services/tripo.js";
import {
  consumeTripoDownloadBodySchema,
  consumeTripoDownloadResponseSchema,
} from "../../schemas/tripo.js";

export async function tripoRoutes(app: FastifyInstance) {
  // POST /v2/tripo/download
  app.post(
    "/tripo/download",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: consumeTripoDownloadBodySchema,
        response: consumeTripoDownloadResponseSchema,
      },
    },
    async (request, reply) => {
      const {
        installationId,
        tripoModelId,
        modelId,
        modelKey,
        downloadType,
        entitlementOrigin,
      } = request.body as {
        installationId: string;
        tripoModelId?: string | null;
        modelId?: string | null;
        modelKey?: string | null;
        downloadType?: string | null;
        entitlementOrigin?: string | null;
      };

      const result = await consumeTripoDownload({
        installationId,
        tripoModelId,
        modelId,
        modelKey,
        downloadType,
        entitlementOrigin,
      });

      if (!result.success) {
        const errorResponse: Record<string, any> = {
          error: result.error,
          message: result.message,
        };
        if ("tripo" in result && result.tripo) {
          errorResponse.tripo = result.tripo;
        }
        return reply
          .code(result.statusCode as 400 | 403 | 404)
          .send(errorResponse);
      }

      const data = (result as any).data;

      request.log.info(
        {
          installationId,
          tripoModelId: tripoModelId ?? modelId ?? modelKey ?? null,
          downloadId: data.downloadId,
          plan: data.plan,
        },
        "Tripo download consumption recorded",
      );

      return reply.code(200).send(data);
    },
  );
}
