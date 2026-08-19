ALTER TABLE "subscriptions" RENAME COLUMN "stripe_customer_id" TO "creem_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_subscription_id" TO "creem_product_id";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "creem_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creem_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creem_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "stripe_price_id";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creem_subscription_id_unique" UNIQUE("creem_subscription_id");