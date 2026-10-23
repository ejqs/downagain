CREATE TABLE "user_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporter" text NOT NULL,
	"slot" integer NOT NULL,
	"country" text
);
--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_reports_once" ON "user_reports" USING btree ("provider_id","reporter","slot");--> statement-breakpoint
CREATE INDEX "user_reports_provider" ON "user_reports" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "user_reports_reporter" ON "user_reports" USING btree ("reporter","created_at");