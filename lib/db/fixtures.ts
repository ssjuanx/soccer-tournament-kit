/**
 * Pure helpers for group-stage fixture persistence.
 *
 * Like `setup.ts`, this module is framework-agnostic and free of any database
 * import, so it can be unit-tested with `node --test` and imported safely from
 * client code. The repository (`matches.ts`) and Server Actions (`actions.ts`)
 * build on these helpers; the React admin UI uses `isStructurallyLocked` and
 * `parseScore` to drive the structural-lock UX and score entry.
 *
 * Fixture generation reuses the persistence-free `generateGroupFixtures` engine,
 * so the persisted match pairings are exactly the ones the standings engine
 * later consumes. Match ids are derived deterministically from the group id and
 * the pair indices (`${groupId}-${i}-${j}`), which keeps the upsert in
 * `saveGroupFixtures` idempotent and lets re-generation preserve existing
 * scores via `onConflictDoUpdate` (scores are deliberately not in the update
 * set).
 */

import { generateGroupFixtures } from "../tournament/fixtures.ts";
import { validateScore } from "../tournament/standings.ts";
import type { Match, MatchScore } from "../tournament/types.ts";
import type { TournamentSetupSnapshot } from "./setup.ts";

// ---------------------------------------------------------------------------
// Persisted match row (the insert shape for the `matches` table)
// ---------------------------------------------------------------------------

/**
 * A group-stage match row ready to be inserted by `saveGroupFixtures`.
 *
 * `homeScore` / `awayScore` are always `null` here: a freshly generated fixture
 * has no score. Existing scores are preserved by the upsert, so this only ever
 * writes nulls for *new* rows.
 */
export interface MatchInsertRow {
  id: string;
  tournamentId: string;
  stage: "group";
  groupId: string;
  knockoutRound: null;
  homeParticipantId: string;
  awayParticipantId: string;
  homeScore: null;
  awayScore: null;
}

// ---------------------------------------------------------------------------
// Fixture readiness
// ---------------------------------------------------------------------------

/**
 * Whether the persisted setup is ready to generate group-stage fixtures.
 *
 * Ready when a tournament exists and every group has at least 2 participants.
 * A 1-player group produces no round-robin matches, so a partial draw (some
 * groups still empty or with a single player) is not ready. Participants are
 * always placed into a group by `saveParticipants`, so "placed" is implicit —
 * this only checks the saved participant counts per group.
 */
export function isReadyForFixtures(snapshot: TournamentSetupSnapshot): boolean {
  if (!snapshot.tournament) return false;
  if (snapshot.groups.length === 0) return false;

  const countByGroup = new Map<string, number>();
  for (const participant of snapshot.participants) {
    if (!participant.groupId) continue;
    countByGroup.set(
      participant.groupId,
      (countByGroup.get(participant.groupId) ?? 0) + 1,
    );
  }

  for (const group of snapshot.groups) {
    if ((countByGroup.get(group.id) ?? 0) < 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Snapshot -> match rows
// ---------------------------------------------------------------------------

/**
 * Builds the full set of group-stage match rows for a persisted snapshot.
 *
 * Participants are grouped by their `groupId` (preserving the snapshot's
 * draw-order ordering), then `generateGroupFixtures` is run per group. The
 * returned rows are deterministic for a given snapshot, so re-generation is
 * idempotent: the same snapshot always yields the same row ids, and the
 * `onConflictDoUpdate` in `saveGroupFixtures` preserves any scores already
 * stored against those ids.
 *
 * Returns an empty array when no tournament exists.
 */
export function buildGroupStageMatches(
  snapshot: TournamentSetupSnapshot,
): MatchInsertRow[] {
  if (!snapshot.tournament) return [];
  const tournamentId = snapshot.tournament.id;

  // snapshot.participants is ordered by draw order, so each group's list keeps
  // that order, which keeps fixture generation deterministic.
  const participantsByGroup = new Map<string, string[]>();
  for (const participant of snapshot.participants) {
    if (!participant.groupId) continue;
    const list = participantsByGroup.get(participant.groupId);
    if (list) {
      list.push(participant.id);
    } else {
      participantsByGroup.set(participant.groupId, [participant.id]);
    }
  }

  const rows: MatchInsertRow[] = [];
  for (const group of snapshot.groups) {
    const participantIds = participantsByGroup.get(group.id) ?? [];
    const groupMatches = generateGroupFixtures(participantIds, group.id);
    for (const match of groupMatches) {
      rows.push({
        id: match.id,
        tournamentId,
        stage: "group",
        groupId: group.id,
        knockoutRound: null,
        homeParticipantId: match.homeParticipantId as string,
        awayParticipantId: match.awayParticipantId as string,
        homeScore: null,
        awayScore: null,
      });
    }
  }
  return rows;
}
// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

/** A parsed score: `null` means the match is unplayed/cleared. */
export type ParsedScore = MatchScore | null;

/**
 * Parses raw score strings from the admin UI into a `MatchScore` or `null`.
 *
 * - Both blank -> `null` (the match is unplayed / the score is cleared).
 * - One blank -> throws (a partial score is not a valid soccer score).
 * - Non-integer, negative, or non-numeric values -> throws.
 *
 * Reuses `validateScore` for the integer/non-negative checks so the rules stay
 * in one place.
 */
export function parseScore(homeRaw: string, awayRaw: string): ParsedScore {
  const home = homeRaw.trim();
  const away = awayRaw.trim();

  if (home === "" && away === "") return null;
  if (home === "" || away === "") {
    throw new Error(
      "Enter a score for both sides, or leave both blank to clear the score.",
    );
  }

  const homeGoals = Number(home);
  const awayGoals = Number(away);
  if (!Number.isFinite(homeGoals) || !Number.isInteger(homeGoals)) {
    throw new Error(`Home score must be a whole number (got "${homeRaw}").`);
  }
  if (!Number.isFinite(awayGoals) || !Number.isInteger(awayGoals)) {
    throw new Error(`Away score must be a whole number (got "${awayRaw}").`);
  }

  const score: MatchScore = { home: homeGoals, away: awayGoals };
  validateScore(score);
  return score;
}

// ---------------------------------------------------------------------------
// Structural lock
// ---------------------------------------------------------------------------

/**
 * Whether the tournament structure is locked.
 *
 * Once group-stage fixtures exist in the database, participant and group
 * editing is hard-blocked until the administrator explicitly clears the
 * fixtures. This prevents silently invalidating already-generated pairings (and
 * any entered scores) by reshuffling groups or participants.
 */
export function isStructurallyLocked(existingMatches: Match[]): boolean {
  return existingMatches.length > 0;
}