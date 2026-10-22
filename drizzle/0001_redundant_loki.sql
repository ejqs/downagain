CREATE TABLE "incident_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"verdict" jsonb,
	"error" text,
	"rules_tier" integer,
	"tier" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "graded_by" text DEFAULT 'rules' NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "reviewed_hash" text;--> statement-breakpoint
ALTER TABLE "incident_reviews" ADD CONSTRAINT "incident_reviews_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_incident_hash" ON "incident_reviews" USING btree ("incident_id","input_hash");--> statement-breakpoint
CREATE INDEX "reviews_created" ON "incident_reviews" USING btree ("created_at");