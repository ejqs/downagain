ALTER TYPE "public"."source_kind" ADD VALUE 'gcp';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'aws';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'azure';--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "regions" text[];