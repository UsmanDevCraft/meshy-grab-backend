import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { installations, users } from "../db/schema.js";
import { installBodySchema } from "../schemas/install.js";

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

      const result = await db.transaction(async (tx) => {
        /*
         * 1. Check whether this installation already exists.
         */
        const [existingInstallation] = await tx
          .select({
            installation: installations,
            user: users,
          })
          .from(installations)
          .innerJoin(users, eq(installations.userId, users.id))
          .where(eq(installations.installationId, installationId))
          .limit(1);

        /*
         * 2. Existing installation.
         *
         * The installation is already permanently associated
         * with a user. Never silently move it to another user.
         */
        if (existingInstallation) {
          const existingUser = existingInstallation.user;

          /*
           * Same installation + same email = normal reconnect.
           */
          if (existingUser.email === normalizedEmail) {
            const now = new Date();

            await tx
              .update(installations)
              .set({
                lastSeenAt: now,
                updatedAt: now,
              })
              .where(
                eq(installations.id, existingInstallation.installation.id),
              );

            await tx
              .update(users)
              .set({
                lastSeenAt: now,
                updatedAt: now,
              })
              .where(eq(users.id, existingUser.id));

            return {
              created: false,
              newUser: false,
              newInstallation: false,
              userId: existingUser.id,
              installationId,
            };
          }

          /*
           * Same installation ID but different email.
           *
           * This should never silently reassign the installation.
           */
          return {
            conflict: true as const,
            userId: existingUser.id,
          };
        }

        /*
         * 3. Installation is new.
         *
         * Now recover the user using email.
         */
        const [existingUser] = await tx
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1);

        let user: typeof users.$inferSelect;
        let isNewUser = false;

        if (existingUser) {
          /*
           * Existing user found by email.
           *
           * This is the reinstall/recovery path.
           */
          user = existingUser;
        } else {
          /*
           * Completely new user.
           */
          const [newUser] = await tx
            .insert(users)
            .values({
              email: normalizedEmail,
            })
            .returning();

          user = newUser;
          isNewUser = true;
        }

        /*
         * 4. Attach this new installation to the user.
         */
        const now = new Date();

        await tx.insert(installations).values({
          installationId,
          userId: user.id,
          lastSeenAt: now,
          updatedAt: now,
        });

        /*
         * 5. Update user's activity.
         */
        await tx
          .update(users)
          .set({
            lastSeenAt: now,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));

        return {
          conflict: false as const,
          created: true,
          newUser: isNewUser,
          newInstallation: true,
          userId: user.id,
          installationId,
        };
      });

      /*
       * Installation identity conflict.
       */
      if ("conflict" in result && result.conflict) {
        return reply.code(409).send({
          error: "INSTALLATION_ID_CONFLICT",
          message:
            "This installation ID is already associated with another user.",
        });
      }

      /*
       * New user OR new installation.
       */
      if (result.created) {
        return reply.code(201).send({
          created: true,
          userId: result.userId,
          installationId: result.installationId,
        });
      }

      /*
       * Existing installation reconnect.
       */
      return {
        created: false,
        userId: result.userId,
        installationId: result.installationId,
      };
    },
  );
}
