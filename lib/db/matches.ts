/**
 * Repository for the active tournament's group-stage matches on Neon Postgres.
 *
 * Like `tournaments.ts`, this module imports the Drizzle `db` client and only
 * runs on the server (Server Components, Server Actions). It is never imported
 * from client code. The Neon HTTP driver has no interactive transactions, so
 * writes run as ordered, idempotent statements.
 *
 * Fixture upserts are idempotent and score-preserving: `saveGroupFixtures`
 * updates only the pairing columns (`homeParticipantId`, `awayParticipantId`,
 * `groupId`) on conflict, never `homeScore` / `awayScore`, so re-generating
 * fixtures after a participant edit cannot wipe entered scores. Scores are
 * written only by `saveMatchScore`.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "./client.ts";
import { matches } from "./schema.ts";
import { ACTIVE_TOURNAMENT_ID } from "./tournaments.ts";
import { validateScore } from "../tournament/standings.ts";
import type { Match, MatchScore } from "../tournament/types.ts";
import type { MatchInsertRow } from "./fixtures.ts";

/**
 * Upserts group-stage fixtures for the active tournament.
 *
 * New rows are inserted with null scores. Existing rows (same id) are updated
 * on the pairing columns only — scores are intentionally left out of the
 * `onConflictDoUpdate` set so already-entered scores survive a re-generation.
 * Rows that belong to a participant/group no longer in the setup are not
 * removed here; call `clearGroupFixtures` first to force a clean regeneration.
 */
export async function saveGroupFixtures(rows: MatchInsertRow[]): Promise<void> {
  if (rows.length === 0) return;

  await db
    .insert(matches)
    .values(
      rows.map((row) => ({
        id: row.id,
        tournamentId: row.tournamentId,
        stage: row.stage,
        groupId: row.groupId,
        knockoutRound: row.knockoutRound,
        homeParticipantId: row.homeParticipantId,
        awayParticipantId: row.awayParticipantId,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
      })),
    )
    .onConflictDoUpdate({
      target: matches.id,
      set: {
        homeParticipantId: sql`excluded.home_participant_id`,
        awayParticipantId: sql`excluded.away_participant_id`,
        groupId: sql`excluded.group_id`,
      },
    });
}

/**
 * Deletes all group-stage matches for the active tournament.
 *
 * This is the only way to unlock participant/group editing once fixtures exist.
 * Knockout matches (none generated yet) are intentionally left untouched.
 */
export async function clearGroupFixtures(): Promise<void> {
  await db
    .delete(matches)
    .where(
      and(
        eq(matches.tournamentId, ACTIVE_TOURNAMENT_ID),
        eq(matches.stage, "group"),
      ),
    );
}

/**
 * Loads all group-stage matches for the active tournament, ordered by id so the
 * fixture list is stable across reads. Scores are flattened back into the
 * domain `MatchScore` shape (null when the match is unplayed).
 */
export async function getGroupMatches(): Promise<Match[]> {
  const rows = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, ACTIVE_TOURNAMENT_ID),
        eq(matches.stage, "group"),
      ),
    )
    .orderBy(asc(matches.id));

  return rows.map((row) => ({
    id: row.id,
    stage: "group",
    groupId: row.groupId,
    knockoutRound: row.knockoutRound,
    homeParticipantId: row.homeParticipantId,
    awayParticipantId: row.awayParticipantId,
    score:
      row.homeScore == null || row.awayScore == null
        ? null
        : { home: row.homeScore, away: row.awayScore },
  }));
}

/**
 * Persists a single match's score.
 *
 * A `null` score clears the stored score (both columns set to null). A non-null
 * score is validated with `validateScore` before writing. The match is scoped
 * to the active tournament so a stray id from another tournament can't be
 * updated.
 */
export async function saveMatchScore(
  matchId: string,
  score: MatchScore | null,
): Promise<void> {
  if (score != null) {
    validateScore(score);
  }

  await db
    .update(matches)
    .set({ homeScore: score?.home ?? null, awayScore: score?.away ?? null })
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.tournamentId, ACTIVE_TOURNAMENT_ID),
      ),
    );
}