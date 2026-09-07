ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "texture_downloads_used" integer DEFAULT 0 NOT NULL;
