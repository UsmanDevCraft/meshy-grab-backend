CREATE TABLE IF NOT EXISTS "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model_key" varchar(128) NOT NULL,
	"preview_url" varchar(2048),
	"image_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_user_model_key_unique" UNIQUE("user_id","model_key")
);

ALTER TABLE "models" ADD CONSTRAINT "models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "models_user_id_idx" ON "models" ("user_id");
CREATE INDEX IF NOT EXISTS "models_model_key_idx" ON "models" ("model_key");

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan" varchar(50);

INSERT INTO "models" ("user_id", "model_key", "preview_url", "image_url", "created_at", "updated_at")
SELECT DISTINCT ON ("user_id", "task_id")
  "user_id",
  "task_id",
  "preview_url",
  "model_url",
  "created_at",
  "created_at"
FROM "downloads"
WHERE "task_id" IS NOT NULL
ON CONFLICT ("user_id", "model_key") DO NOTHING;

ALTER TABLE "downloads" ADD COLUMN IF NOT EXISTS "model_id" uuid;

UPDATE "downloads" d
SET "model_id" = m."id"
FROM "models" m
WHERE d."user_id" = m."user_id" AND d."task_id" = m."model_key";

DELETE FROM "downloads" WHERE "model_id" IS NULL;

ALTER TABLE "downloads" ALTER COLUMN "model_id" SET NOT NULL;
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "downloads_model_id_idx" ON "downloads" ("model_id");

ALTER TABLE "downloads" DROP CONSTRAINT IF EXISTS "downloads_user_task_unique";
DROP INDEX IF EXISTS "downloads_task_id_idx";
ALTER TABLE "downloads" DROP COLUMN IF EXISTS "task_id";
ALTER TABLE "downloads" DROP COLUMN IF EXISTS "preview_url";
ALTER TABLE "downloads" DROP COLUMN IF EXISTS "model_url";
ALTER TABLE "downloads" DROP COLUMN IF EXISTS "plan";
