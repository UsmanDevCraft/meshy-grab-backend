ALTER TABLE "models" RENAME COLUMN "image_url" TO "model_url";

UPDATE "downloads" SET "download_type" = LOWER(TRIM("download_type")) WHERE "download_type" IS NOT NULL;
UPDATE "downloads" SET "download_type" = 'glb' WHERE "download_type" IS NULL;

DELETE FROM "downloads"
WHERE id NOT IN (
  SELECT (MIN(id::text))::uuid
  FROM "downloads"
  GROUP BY "model_id", "download_type"
);

ALTER TABLE "downloads" ALTER COLUMN "download_type" SET DEFAULT 'glb';
ALTER TABLE "downloads" ALTER COLUMN "download_type" SET NOT NULL;

ALTER TABLE "downloads" ADD CONSTRAINT "downloads_model_id_download_type_unique" UNIQUE("model_id","download_type");
