import Fastify from "fastify";
import cors from "@fastify/cors";

import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { entitlementRoutes } from "./routes/entitlement.js";
import { installRoutes } from "./routes/install.js";
import { downloadRoutes } from "./routes/downloads.js";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

await app.register(healthRoutes);
await app.register(entitlementRoutes);
await app.register(installRoutes);
await app.register(downloadRoutes);

app.get("/", async () => {
  return {
    name: "MeshyGrab API",
    status: "running",
  };
});

try {
  await app.listen({
    port: env.PORT,
    host: "0.0.0.0",
  });

  console.log(`🚀 MeshyGrab API running on port ${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
