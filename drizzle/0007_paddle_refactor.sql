ALTER TABLE "users" RENAME COLUMN "creem_customer_id" TO "paddle_customer_id";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "creem_subscription_id" TO "paddle_subscription_id";--> statement-breakpoint
DROP INDEX IF EXISTS "users_creem_customer_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "users_creem_subscription_id_idx";--> statement-breakpoint
CREATE INDEX "users_paddle_customer_id_idx" ON "users" USING btree ("paddle_customer_id");--> statement-breakpoint
CREATE INDEX "users_paddle_subscription_id_idx" ON "users" USING btree ("paddle_subscription_id");--> statement-breakpoint

ALTER TABLE "subscriptions" RENAME COLUMN "creem_customer_id" TO "paddle_customer_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "creem_subscription_id" TO "paddle_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "creem_product_id" TO "paddle_price_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "status" TO "subscription_status";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "paddle_transaction_id" varchar(255);--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_creem_customer_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_creem_subscription_id_idx";--> statement-breakpoint
CREATE INDEX "subscriptions_paddle_customer_id_idx" ON "subscriptions" USING btree ("paddle_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_paddle_subscription_id_idx" ON "subscriptions" USING btree ("paddle_subscription_id");