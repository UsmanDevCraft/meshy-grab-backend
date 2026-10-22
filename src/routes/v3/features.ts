import { FastifyInstance } from "fastify";
import {
  consumeUpscale,
  consumeFormatConversion,
} from "../../services/features.js";
import {
  consumeUpscaleBodySchema,
  consumeConversionBodySchema,
  featureConsumeResponseSchema,
} from "../../schemas/features.js";

export async function featureRoutes(app: FastifyInstance) {
  // POST /upscales/consume
  app.post(
    "/upscales/consume",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: consumeUpscaleBodySchema,
        response: featureConsumeResponseSchema,
      },
    },
    async (request, reply) => {
      const {
        installationId,
        resolution,
        requestId,
        idempotencyKey,
        status,
        success,
      } = request.body as {
        installationId: string;
        resolution: string;
        requestId?: string | null;
        idempotencyKey?: string | null;
        status?: string | null;
        success?: boolean | null;
      };

      const result = await consumeUpscale({
        installationId,
        resolution,
        requestId,
        idempotencyKey,
        status,
        success,
      });

      if (!result.success) {
        const errorBody: Record<string, any> = {
          error: result.error,
          message: result.message,
        };
        if ("plan" in result) {
          errorBody.plan = (result as any).plan;
        }
        if ("used" in result) {
          errorBody.used = (result as any).used;
          errorBody.limit = (result as any).limit;
          errorBody.remaining = (result as any).remaining;
        }
        return reply.code(result.statusCode as 400 | 403 | 404).send(errorBody);
      }

      const data = (result as any).data;

      request.log.info(
        {
          installationId,
          resolution,
          operationId: data.operationId,
          plan: data.plan,
          duplicate: data.duplicate,
        },
        "Upscale consumption recorded",
      );

      return reply.code(200).send(data);
    },
  );

  // POST /conversions/consume
  const handleConversion = async (request: any, reply: any) => {
    const {
      installationId,
      inputFormat,
      outputFormat,
      requestId,
      idempotencyKey,
      status,
      success,
    } = request.body as {
      installationId: string;
      inputFormat: string;
      outputFormat: string;
      requestId?: string | null;
      idempotencyKey?: string | null;
      status?: string | null;
      success?: boolean | null;
    };

    const result = await consumeFormatConversion({
      installationId,
      inputFormat,
      outputFormat,
      requestId,
      idempotencyKey,
      status,
      success,
    });

    if (!result.success) {
      const errorBody: Record<string, any> = {
        error: result.error,
        message: result.message,
      };
      if ("plan" in result) {
        errorBody.plan = (result as any).plan;
      }
      if ("used" in result) {
        errorBody.used = (result as any).used;
        errorBody.limit = (result as any).limit;
        errorBody.remaining = (result as any).remaining;
      }
      return reply.code(result.statusCode as 400 | 403 | 404).send(errorBody);
    }

    const data = (result as any).data;

    request.log.info(
      {
        installationId,
        inputFormat,
        outputFormat,
        operationId: data.operationId,
        plan: data.plan,
        duplicate: data.duplicate,
      },
      "Format conversion consumption recorded",
    );

    return reply.code(200).send(data);
  };

  app.post(
    "/conversions/consume",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: consumeConversionBodySchema,
        response: featureConsumeResponseSchema,
      },
    },
    handleConversion,
  );

  // Alias /format-conversions/consume
  app.post(
    "/format-conversions/consume",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: consumeConversionBodySchema,
        response: featureConsumeResponseSchema,
      },
    },
    handleConversion,
  );
}
