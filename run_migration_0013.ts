import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Checking downloads table columns...");
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'downloads' AND column_name = 'source'
    `);

    if (colCheck.rows.length === 0) {
      console.log("Adding source column to downloads table...");
      await client.query(`
        ALTER TABLE "downloads" 
        ADD COLUMN "source" varchar(32) DEFAULT 'workspace' NOT NULL
      `);
      console.log("Column source added successfully.");
    } else {
      console.log("Column source already exists in downloads table.");
    }

    console.log("Migration 0013 completed successfully!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
