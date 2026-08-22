import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { healthRoutes } from "./routes/health.js";
import { entitlementRoutes } from "./routes/entitlement.js";
import { installRoutes } from "./routes/install.js";
import { downloadRoutes } from "./routes/downloads.js";
import { checkoutRoutes } from "./routes/paddle/checkout.js";
import { webhookRoutes } from "./routes/paddle/webhook.js";

const port = Number(process.env.PORT) || env.PORT || 3000;
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const loggerOptions =
  process.env.NODE_ENV === "production"
    ? { level: "error" }
    : { level: "info" };

const app = Fastify({
  logger: loggerOptions,
  keepAliveTimeout: 65000,
  connectionTimeout: 10000,
  bodyLimit: 1048576,
  pluginTimeout: 10000,
});

// Custom global error handler for fast, consistent JSON error responses
app.setErrorHandler((error: any, request, reply) => {
  request.log.error(error);
  const statusCode = error?.statusCode || error?.status || 500;
  reply.status(statusCode).send({
    error: error?.name || "InternalServerError",
    message: error?.message || "An unexpected error occurred",
  });
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
await app.register(checkoutRoutes);
await app.register(webhookRoutes);

app.get("/", async () => {
  return {
    name: "MeshyGrab API",
    status: "running",
  };
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  app.log.info(`Received ${signal}. Starting graceful shutdown...`);
  try {
    await app.close();
    await pool.end();
    app.log.info("Server and DB pool closed successfully.");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Error during graceful shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

try {
  await app.listen({
    port,
    host,
  });

  console.log(`🚀 MeshyGrab API running on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
