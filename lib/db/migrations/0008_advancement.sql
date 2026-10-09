ALTER TABLE "tournaments" ADD COLUMN "advancement" text;--> statement-breakpoint
-- Backfill advancement from the legacy qualifiers_per_group so existing
-- tournaments keep their Championship (top N) + Consolation (the rest) layout.
UPDATE "tournaments"
SET "advancement" =
  '[{"name":"Championship","playersPerGroup":' || "qualifiers_per_group" ||
  '},{"name":"Consolation","playersPerGroup":null}]';--> statement-breakpoint
-- Re-namespace existing Championship match ids so every bracket uses the
-- consistent `${tournamentId}:${slug}:ko:...` scheme. Consolation ids already
-- follow this pattern; only Championship used the bare `${tournamentId}:ko:...`
-- form. The regex prepends "championship" between the tournament id and ":ko:".
UPDATE "matches"
SET "id" = regexp_replace("id", '^([^:]+):ko:', '\1:championship:ko:')
WHERE "stage" = 'knockout' AND "bracket_kind" = 'championship';