CREATE TABLE "manual_tiebreak_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"group_id" text NOT NULL,
	"participant_order" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_tiebreak_resolutions" ADD CONSTRAINT "manual_tiebreak_resolutions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_tiebreak_resolutions" ADD CONSTRAINT "manual_tiebreak_resolutions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_tiebreak_resolutions_group_id_unique" ON "manual_tiebreak_resolutions" USING btree ("tournament_id","group_id");