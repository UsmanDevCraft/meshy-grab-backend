ALTER TABLE "downloads" ADD COLUMN IF NOT EXISTS "preview_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "downloads" ADD COLUMN IF NOT EXISTS "model_url" varchar(2048);