ALTER TABLE "users" DROP COLUMN "chrome_account_id";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");