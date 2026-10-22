ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "upscales_used" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "format_conversions_used" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "feature_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature_type" varchar(32) NOT NULL,
	"resolution" varchar(16),
	"input_format" varchar(32),
	"output_format" varchar(32),
	"idempotency_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "feature_usages" ADD CONSTRAINT "feature_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "feature_usages_user_id_idx" ON "feature_usages" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "feature_usages_user_feature_created_idx" ON "feature_usages" USING btree ("user_id", "feature_type", "created_at");
CREATE INDEX IF NOT EXISTS "feature_usages_idempotency_idx" ON "feature_usages" USING btree ("user_id", "idempotency_key");
