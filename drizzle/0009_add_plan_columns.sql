ALTER TABLE "downloads" ADD COLUMN IF NOT EXISTS "plan" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" varchar(50);
