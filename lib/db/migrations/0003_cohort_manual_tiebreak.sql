DROP INDEX "manual_tiebreak_resolutions_group_id_unique";--> statement-breakpoint
ALTER TABLE "manual_tiebreak_resolutions" ADD COLUMN "cohort_key" text;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "edition" text;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "date" text;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "description" text;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_tiebreak_resolutions_cohort_unique" ON "manual_tiebreak_resolutions" USING btree ("tournament_id","group_id","cohort_key");