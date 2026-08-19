import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { entitlementRoutes } from "./routes/entitlement.js";
import { installRoutes } from "./routes/install.js";
import { downloadRoutes } from "./routes/downloads.js";
import { billingRoutes } from "./routes/billing.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { webhookRoutes } from "./routes/webhook.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

await app.register(fastifyRawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
});

await app.register(cors, {
  origin: true,
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await app.register(healthRoutes);
await app.register(entitlementRoutes);
await app.register(installRoutes);
await app.register(downloadRoutes);
await app.register(billingRoutes);
await app.register(checkoutRoutes);
await app.register(webhookRoutes);

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
