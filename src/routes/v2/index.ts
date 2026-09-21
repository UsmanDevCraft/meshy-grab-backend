import { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { entitlementRoutes } from "./entitlement.js";
import { installRoutes } from "./install.js";
import { downloadRoutes } from "./downloads.js";
import { textureRoutes } from "./textures.js";
import { accountRoutes } from "./accounts.js";

export async function v2Routes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(entitlementRoutes);
  await app.register(installRoutes);
  await app.register(downloadRoutes);
  await app.register(textureRoutes);
  await app.register(accountRoutes);
}
