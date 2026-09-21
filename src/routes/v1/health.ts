import { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "meshygrab-backend",
      timestamp: new Date().toISOString(),
    };
  });
}
