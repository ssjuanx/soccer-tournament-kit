ALTER TABLE "matches" ADD COLUMN "bracket_kind" text;--> statement-breakpoint
UPDATE "matches"
SET "bracket_kind" = 'championship'
WHERE "stage" = 'knockout';
