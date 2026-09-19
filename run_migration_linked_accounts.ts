import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Creating linked_accounts table if not exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "linked_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "meshy_email" varchar(255) NOT NULL UNIQUE,
        "meshy_user_id" varchar(255),
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "linked_accounts_owner_user_id_idx" ON "linked_accounts" ("owner_user_id");
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "linked_accounts_meshy_email_idx" ON "linked_accounts" ("meshy_email");
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "linked_accounts_owner_user_id_meshy_email_unique" ON "linked_accounts" ("owner_user_id", "meshy_email");
    `);

    console.log("linked_accounts migration completed successfully!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
