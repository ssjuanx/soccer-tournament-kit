ALTER TABLE "matches" ADD COLUMN "knockout_seed" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "qualifiers_per_group" integer DEFAULT 2 NOT NULL;