import { FastifyInstance } from "fastify";
import { sql as drizzleSql } from "drizzle-orm";
import { db } from "../../db/index.js";

const STATS_CACHE_TTL_MS = 60 * 60 * 1000;

interface Stats {
  users: number;
  downloads: number;
  installations: number;
  updatedAt: string;
}

let cachedStats: Stats | null = null;
let cacheExpiresAt = 0;
let refreshInFlight: Promise<Stats> | null = null;

async function refreshStats(): Promise<Stats> {
  console.log("[Stats] Refreshing database snapshot");
  const result = await db.execute(drizzleSql`
    SELECT 'Users' AS key, COUNT(*)::text AS value
    FROM users

    UNION ALL

    SELECT 'Downloads' AS key, COUNT(*)::text AS value
    FROM downloads

    UNION ALL

    SELECT 'Installations' AS key, COUNT(*)::text AS value
    FROM installations
  `);

  const rows = result.rows;

  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (typeof row.key !== "string" || typeof row.value !== "string") {
      throw new Error("Invalid statistics row returned from database");
    }

    counts[row.key] = Number(row.value);
  }

  const snapshot: Stats = {
    users: counts.Users,
    downloads: counts.Downloads,
    installations: counts.Installations,
    updatedAt: new Date().toISOString(),
  };

  // Only replace the cache after a successful query.
  cachedStats = snapshot;
  cacheExpiresAt = Date.now() + STATS_CACHE_TTL_MS;

  return snapshot;
}

async function getStats(): Promise<Stats> {
  if (cachedStats && Date.now() < cacheExpiresAt) {
    return cachedStats;
  }

  // Share one database refresh across concurrent requests.
  if (!refreshInFlight) {
    refreshInFlight = refreshStats().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats", async (_request, reply) => {
    try {
      const stats = await getStats();

      return reply
        .header("Cache-Control", "public, max-age=0, s-maxage=3600")
        .send(stats);
    } catch (error) {
      app.log.error({ err: error }, "Failed to fetch MeshyGrab stats");

      // Keep any previous successful snapshot intact.
      // Do not return stale data as a successful response here.
      return reply.code(503).send({
        error: "STATS_UNAVAILABLE",
      });
    }
  });
}
