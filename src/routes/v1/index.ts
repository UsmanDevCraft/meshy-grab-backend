import { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { entitlementRoutes } from "./entitlement.js";
import { installRoutes } from "./install.js";
import { downloadRoutes } from "./downloads.js";
import { textureRoutes } from "./textures.js";

export async function v1Routes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(entitlementRoutes);
  await app.register(installRoutes);
  await app.register(downloadRoutes);
  await app.register(textureRoutes);
}
