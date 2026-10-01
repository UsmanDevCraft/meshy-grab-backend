CREATE TABLE IF NOT EXISTS "tripo_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" varchar(128) NOT NULL,
	"tripo_model_id" varchar(255),
	"download_type" varchar(128) DEFAULT 'glb' NOT NULL,
	"entitlement_origin" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "tripo_downloads" ADD CONSTRAINT "tripo_downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "tripo_downloads_user_id_idx" ON "tripo_downloads" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "tripo_downloads_installation_id_idx" ON "tripo_downloads" USING btree ("installation_id");
CREATE INDEX IF NOT EXISTS "tripo_downloads_created_at_idx" ON "tripo_downloads" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "tripo_downloads_user_id_created_at_idx" ON "tripo_downloads" USING btree ("user_id","created_at");
