import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // Check if migration already applied (column renamed?)
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'models' AND column_name IN ('image_url', 'model_url')
    `);
    const existingCols = colCheck.rows.map((r: any) => r.column_name);
    console.log("Existing columns in models:", existingCols);

    if (
      existingCols.includes("image_url") &&
      !existingCols.includes("model_url")
    ) {
      console.log("Renaming image_url -> model_url...");
      await client.query(
        `ALTER TABLE "models" RENAME COLUMN "image_url" TO "model_url"`,
      );
    } else if (existingCols.includes("model_url")) {
      console.log("model_url column already exists, skipping rename.");
    }

    // Normalize download_type
    console.log("Normalizing download_type values...");
    await client.query(
      `UPDATE "downloads" SET "download_type" = LOWER(TRIM("download_type")) WHERE "download_type" IS NOT NULL`,
    );
    await client.query(
      `UPDATE "downloads" SET "download_type" = 'glb' WHERE "download_type" IS NULL OR "download_type" = ''`,
    );

    // Deduplicate before adding unique constraint
    console.log("Deduplicating downloads...");
    await client.query(`
      DELETE FROM "downloads"
      WHERE id NOT IN (
        SELECT (MIN(id::text))::uuid
        FROM "downloads"
        GROUP BY "model_id", "download_type"
      )
    `);

    // Set NOT NULL default
    console.log("Setting download_type defaults...");
    try {
      await client.query(
        `ALTER TABLE "downloads" ALTER COLUMN "download_type" SET DEFAULT 'glb'`,
      );
    } catch (e: any) {
      console.log("Default already set:", e.message);
    }
    try {
      await client.query(
        `ALTER TABLE "downloads" ALTER COLUMN "download_type" SET NOT NULL`,
      );
    } catch (e: any) {
      console.log("NOT NULL already set:", e.message);
    }

    // Add unique constraint if not exists
    const constraintCheck = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'downloads' AND constraint_name = 'downloads_model_id_download_type_unique'
    `);
    if (constraintCheck.rows.length === 0) {
      console.log("Adding unique constraint on (model_id, download_type)...");
      await client.query(
        `ALTER TABLE "downloads" ADD CONSTRAINT "downloads_model_id_download_type_unique" UNIQUE("model_id","download_type")`,
      );
    } else {
      console.log("Unique constraint already exists.");
    }

    console.log("Migration 0012 completed successfully!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
