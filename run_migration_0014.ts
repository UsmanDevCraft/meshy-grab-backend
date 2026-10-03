import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import fs from "fs";
import path from "path";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Running migration 0014: tripo_downloads table...");
    const sqlPath = path.join(
      process.cwd(),
      "drizzle",
      "0014_add_tripo_downloads.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf-8");

    await client.query(sql);
    console.log("Migration 0014 executed successfully!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
