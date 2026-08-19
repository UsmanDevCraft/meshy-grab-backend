import { FastifyInstance } from "fastify";

import { db } from "../db/client.js";
import { installations, users } from "../db/schema.js";
import {
  installBodySchema,
  installResponseSchema,
} from "../schemas/install.js";

export async function installRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      installationId: string;
      email: string;
    };
  }>(
    "/install",
    {
      schema: {
        body: installBodySchema,
        response: installResponseSchema,
      },
    },
    async (request, reply) => {
      const { installationId, email } = request.body;

      const normalizedEmail = email.trim().toLowerCase();

      if (!installationId.trim()) {
        return reply.code(400).send({
          error: "installationId is required",
        });
      }

      if (!normalizedEmail) {
        return reply.code(400).send({
          error: "email is required",
        });
      }

      const now = new Date();

      // 1. Single-statement atomic upsert for user by email
      const [user] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          lastSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        .returning({
          id: users.id,
          email: users.email,
        });

      // 2. Single-statement atomic upsert for installation by installationId
      const [inst] = await db
        .insert(installations)
        .values({
          installationId,
          userId: user.id,
          lastSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: installations.installationId,
          set: {
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        .returning({
          id: installations.id,
          userId: installations.userId,
          createdAt: installations.createdAt,
          updatedAt: installations.updatedAt,
        });

      // Conflict detection: installationId belongs to another user
      if (inst.userId !== user.id) {
        return reply.code(409).send({
          error: "INSTALLATION_ID_CONFLICT",
          message:
            "This installation ID is already associated with another user.",
        });
      }

      const isNewInstallation =
        Math.abs(inst.createdAt.getTime() - inst.updatedAt.getTime()) < 1000;

      if (isNewInstallation) {
        return reply.code(201).send({
          created: true,
          userId: user.id,
          installationId,
        });
      }

      return reply.code(200).send({
        created: false,
        userId: user.id,
        installationId,
      });
    },
  );
}
