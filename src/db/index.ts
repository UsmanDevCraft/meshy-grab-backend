import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import * as schema from "./schema.js";
import { env } from "../config/env.js";

// Enable WebSocket constructor for persistent connection pooling
neonConfig.webSocketConstructor = ws;

const connectionString = env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

// Global cached connection pool to eliminate SSL/TLS handshake latency
export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, {
  schema,
});
