ALTER TABLE "tournament_rules" DROP CONSTRAINT "tournament_rules_tournament_id_tournaments_id_fk";
--> statement-breakpoint
DROP INDEX "tournament_rules_tournament_id_idx";--> statement-breakpoint
ALTER TABLE "tournament_rules" DROP COLUMN "tournament_id";