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
import { calculateStandings, validateScore } from "../tournament/standings.ts";
import {
  advanceBracket,
  applyScores,
  bracketToMatches,
  generateBracket,
  getChampion,
  type BracketMatch,
  type Qualifier,
} from "../tournament/knockout.ts";
import { getQualifiedParticipants } from "../tournament/qualification.ts";
import { compareGroupLabels } from "./setup.ts";
import type {
  BracketKind,
  GroupId,
  KnockoutRound,
  Match,
  MatchScore,
  ParticipantId,
  Standing,
} from "../tournament/types.ts";
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
  bracketKind: null;
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
        bracketKind: null,
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

// ---------------------------------------------------------------------------
// Knockout stage
// ---------------------------------------------------------------------------

/**
 * A knockout match row ready to be inserted by `saveKnockoutFixtures`.
 *
 * `homeScore` / `awayScore` are always `null` here: a freshly generated bracket
 * has no scores. Existing scores are preserved by the upsert, so this only
 * ever writes nulls for *new* rows. `knockoutSeed` is the home (higher) seed,
 * or null when the home slot is still TBD (later rounds).
 */
export interface KnockoutMatchInsertRow {
  id: string;
  tournamentId: string;
  stage: "knockout";
  bracketKind: BracketKind;
  groupId: null;
  knockoutRound: KnockoutRound;
  knockoutSeed: number | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeScore: null;
  awayScore: null;
}

/**
 * Whether the group stage is complete: every group-stage fixture has been
 * played (a score entered). Knockout generation is only allowed once the group
 * stage is complete so the qualifiers are final.
 */
export function isGroupStageComplete(groupMatches: Match[]): boolean {
  return (
    groupMatches.length > 0 &&
    groupMatches.every((m) => m.score != null)
  );
}

/**
 * Whether any group's standings still contain an unresolved tiebreak cohort.
 * Knockout generation is blocked while any group is unresolved, since the
 * qualified participants (and their seeds) would be ambiguous.
 */
export function hasUnresolvedStandings(standingsByGroup: Standing[]): boolean {
  return standingsByGroup.some((rows) => rows.some((r) => r.unresolved));
}

/**
 * Builds the ordered seed list of knockout qualifiers from each group's
 * (already sorted) standings.
 *
 * Qualifiers are organized in tiers by their within-group position (group
 * winners first, then runners-up, …). Within a tier, groups are ordered by
 * label (A, B, …) so the global seed list is deterministic. The returned list is
 * in global seed order (seed 1 first), ready for `generateBracket`.
 */
export function buildKnockoutQualifiers(
  groups: { id: string; label: string }[],
  standingsByGroup: Map<string, Standing>,
  qualifiersPerGroup: number,
): Qualifier[] {
  const orderedGroups = [...groups].sort((a, b) =>
    compareGroupLabels(a.label, b.label),
  );

  // tier.get(position) -> qualifiers at that within-group position, in group
  // label order.
  const tiers = new Map<number, Qualifier[]>();
  for (const group of orderedGroups) {
    const standings = standingsByGroup.get(group.id);
    if (!standings) continue;
    const qualified = getQualifiedParticipants(standings, qualifiersPerGroup);
    for (const row of qualified) {
      const list = tiers.get(row.position);
      if (list) {
        list.push({
          participantId: row.participantId,
          groupId: group.id as GroupId,
          groupPosition: row.position,
        });
      } else {
        tiers.set(row.position, [
          {
            participantId: row.participantId,
            groupId: group.id as GroupId,
            groupPosition: row.position,
          },
        ]);
      }
    }
  }

  const positions = [...tiers.keys()].sort((a, b) => a - b);
  const seedList: Qualifier[] = [];
  for (const position of positions) {
    seedList.push(...(tiers.get(position) ?? []));
  }
  return seedList;
}

/**
 * Builds the Consolation seed list from everyone below the qualification line.
 * Finish position is the primary tier. Within a tier, per-game rates make
 * groups of three and four comparable; draw order is the deterministic final
 * fallback. Ratio comparisons use cross multiplication instead of floats.
 */
export function buildConsolationQualifiers(
  groups: { id: string; label: string }[],
  standingsByGroup: Map<string, Standing>,
  qualifiersPerGroup: number,
  participants: { id: string; drawOrder: number }[],
): Qualifier[] {
  const drawOrderById = new Map(
    participants.map((participant) => [participant.id, participant.drawOrder]),
  );
  const entries: Array<{ row: Standing[number]; groupId: string }> = [];

  for (const group of groups) {
    for (const row of standingsByGroup.get(group.id) ?? []) {
      if (row.position > qualifiersPerGroup) {
        entries.push({ row, groupId: group.id });
      }
    }
  }

  const compareRateDescending = (
    aValue: number,
    aPlayed: number,
    bValue: number,
    bPlayed: number,
  ) => bValue * aPlayed - aValue * bPlayed;

  entries.sort((a, b) => {
    if (a.row.position !== b.row.position) {
      return a.row.position - b.row.position;
    }

    const points = compareRateDescending(
      a.row.points,
      a.row.played,
      b.row.points,
      b.row.played,
    );
    if (points !== 0) return points;

    const goalDifference = compareRateDescending(
      a.row.goalDifference,
      a.row.played,
      b.row.goalDifference,
      b.row.played,
    );
    if (goalDifference !== 0) return goalDifference;

    const goalsFor = compareRateDescending(
      a.row.goalsFor,
      a.row.played,
      b.row.goalsFor,
      b.row.played,
    );
    if (goalsFor !== 0) return goalsFor;

    return (
      (drawOrderById.get(a.row.participantId) ?? Number.MAX_SAFE_INTEGER) -
      (drawOrderById.get(b.row.participantId) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return entries.map(({ row, groupId }) => ({
    participantId: row.participantId,
    groupId: groupId as GroupId,
    groupPosition: row.position,
  }));
}

/**
 * Builds the full set of knockout match rows for a seeded qualifier list.
 *
 * Uses the persistence-free `generateBracket` engine, so the persisted knockout
 * pairings are exactly the ones the bracket page later recomputes. Match ids
 * are deterministic (`${tournamentId}:ko:r${round}:m${index}`), which keeps the
 * upsert idempotent and lets re-generation preserve existing scores.
 */
export function buildKnockoutStageMatches(
  qualifiers: Qualifier[],
  tournamentId: string,
  bracketKind: BracketKind = "championship",
): KnockoutMatchInsertRow[] {
  if (qualifiers.length < 2) return [];
  const bracketId =
    bracketKind === "championship"
      ? tournamentId
      : `${tournamentId}:consolation`;
  const bracket = generateBracket(qualifiers, bracketId);
  return bracketToMatches(bracket).map((m) => ({
    id: m.id,
    tournamentId,
    stage: "knockout",
    bracketKind,
    groupId: null,
    knockoutRound: m.knockoutRound!,
    knockoutSeed: m.knockoutSeed ?? null,
    homeParticipantId: m.homeParticipantId,
    awayParticipantId: m.awayParticipantId,
    homeScore: null,
    awayScore: null,
  }));
}

// ---------------------------------------------------------------------------
// Knockout view (shared by the bracket page and the admin)
// ---------------------------------------------------------------------------

/**
 * The knockout bracket view derived from the persisted setup, the group-stage
 * matches, and the saved knockout scores.
 *
 *   - `none`                  — no tournament / no group fixtures yet.
 *   - `groupStageIncomplete`  — group stage in progress.
 *   - `ready`                 — group stage complete, bracket not yet generated.
 *   - `bracket`               — the bracket is generated; `bracket` holds the
 *                               advanced in-memory bracket and `champion` the
 *                               decided winner (null until the final is played).
 *
 * The bracket is recomputed from the qualifiers (final once the group stage is
 * complete) and the saved knockout scores, so the view always reflects the
 * latest scores. This helper is pure (no db import) and safe to call from both
 * server and client components.
 */
export type KnockoutView =
  | { status: "none" }
  | { status: "groupStageIncomplete"; played: number; total: number }
  | { status: "ready" }
  | {
      status: "bracket";
      bracket: BracketMatch[];
      champion: ParticipantId | null;
    };

export function computeKnockoutView(
  snapshot: TournamentSetupSnapshot,
  groupMatches: Match[],
  knockoutMatches: Match[],
  bracketKind: BracketKind = "championship",
): KnockoutView {
  if (!snapshot.tournament || groupMatches.length === 0) {
    return { status: "none" };
  }

  const played = groupMatches.filter((m) => m.score != null).length;
  if (played < groupMatches.length) {
    return { status: "groupStageIncomplete", played, total: groupMatches.length };
  }

  const tournament = snapshot.tournament;
  const scoring = {
    winPoints: tournament.winPoints,
    drawPoints: tournament.drawPoints,
    lossPoints: tournament.lossPoints,
  };
  const tiebreakerOrder = tournament.tiebreakerOrder;

  const standingsByGroup = new Map<string, Standing>();
  for (const group of snapshot.groups) {
    const groupParticipants = snapshot.participants
      .filter((p) => p.groupId === group.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        drawOrder: p.drawOrder,
        assignedTeamId: null,
        groupId: p.groupId,
      }));
    standingsByGroup.set(
      group.id,
      calculateStandings(groupMatches, groupParticipants, {
        scoring,
        tiebreakerOrder,
        manualResolutions: snapshot.manualResolutions,
        groupId: group.id,
      }),
    );
  }

  const qualifiers =
    bracketKind === "championship"
      ? buildKnockoutQualifiers(
          snapshot.groups,
          standingsByGroup,
          tournament.qualifiersPerGroup,
        )
      : buildConsolationQualifiers(
          snapshot.groups,
          standingsByGroup,
          tournament.qualifiersPerGroup,
          snapshot.participants,
        );

  if (knockoutMatches.length === 0) {
    return { status: "ready" };
  }

  if (qualifiers.length < 2) {
    return { status: "ready" };
  }

  const bracketId =
    bracketKind === "championship"
      ? tournament.id
      : `${tournament.id}:consolation`;
  const bracket = generateBracket(qualifiers, bracketId);
  const scoreById = new Map<string, MatchScore>();
  for (const m of knockoutMatches) {
    if (m.score != null) scoreById.set(m.id, m.score);
  }
  const advanced = advanceBracket(applyScores(bracket, scoreById));
  const champion = getChampion(advanced);
  return { status: "bracket", bracket: advanced, champion };
}
