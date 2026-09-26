CREATE TABLE "tournament_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_rules" ADD CONSTRAINT "tournament_rules_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_rules_tournament_id_idx" ON "tournament_rules" USING btree ("tournament_id");