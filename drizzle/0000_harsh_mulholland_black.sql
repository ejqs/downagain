CREATE TYPE "public"."impact" AS ENUM('none', 'minor', 'major', 'critical');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('statuspage', 'railway', 'heroku');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "component_surfaces" (
	"provider_id" integer NOT NULL,
	"component_name" text NOT NULL,
	"surface" text NOT NULL,
	CONSTRAINT "component_surfaces_provider_id_component_name_pk" PRIMARY KEY("provider_id","component_name")
);
--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"impact" "impact" NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"monitoring_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"url" text,
	"components" text[] DEFAULT '{}' NOT NULL,
	"worst_component_status" "status",
	"postmortem" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"origin" text NOT NULL,
	"tier" integer,
	"area_tiers" jsonb,
	"surfaces" text[],
	"security" boolean DEFAULT false NOT NULL,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"reason" text,
	"tier_override" integer,
	"override_note" text,
	"classifier_version" integer,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_status" (
	"provider_id" integer PRIMARY KEY NOT NULL,
	"status" "status" NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_ok_at" timestamp with time zone,
	"fetch_error" text,
	"state_hash" text,
	"etags" jsonb,
	"components" jsonb
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category_id" integer NOT NULL,
	"kind" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"history_from" timestamp with time zone,
	"homepage_url" text,
	"status_page_url" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"source_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "raw_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hash" text NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"status" "status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "component_surfaces" ADD CONSTRAINT "component_surfaces_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_status" ADD CONSTRAINT "provider_status_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD CONSTRAINT "raw_snapshots_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_changes" ADD CONSTRAINT "status_changes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "updates_incident_external" ON "incident_updates" USING btree ("incident_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_provider_external" ON "incidents" USING btree ("provider_id","external_id");--> statement-breakpoint
CREATE INDEX "incidents_started" ON "incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "raw_snapshots_provider" ON "raw_snapshots" USING btree ("provider_id","fetched_at");--> statement-breakpoint
CREATE INDEX "status_changes_provider" ON "status_changes" USING btree ("provider_id","changed_at");