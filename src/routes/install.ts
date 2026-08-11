import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { installBodySchema } from "../schemas/install.js";

export async function installRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      installationId: string;
    };
  }>(
    "/install",
    {
      schema: {
        body: installBodySchema,
      },
    },
    async (request, reply) => {
      const { installationId } = request.body;

      if (!installationId) {
        return reply.code(400).send({
          error: "installationId is required",
        });
      }

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.installationId, installationId))
        .limit(1);

      if (existingUser) {
        return {
          created: false,
          userId: existingUser.id,
          installationId: existingUser.installationId,
        };
      }

      const [newUser] = await db
        .insert(users)
        .values({
          installationId,
        })
        .returning({
          id: users.id,
          installationId: users.installationId,
        });

      return reply.code(201).send({
        created: true,
        userId: newUser.id,
        installationId: newUser.installationId,
      });
    },
  );
}
