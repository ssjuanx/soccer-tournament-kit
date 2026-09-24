/**
 * Soccer group-stage standings calculation.
 *
 * Standings are derived from completed group-stage matches. Nothing here is
 * persisted; these values are recomputed from the stored match scores.
 */

import type {
  Match,
  MatchScore,
  Participant,
  ParticipantId,
  ScoringConfig,
  Standing,
  StandingRow,
  TiebreakerKey,
  TiebreakerOrder,
} from "./types";

// ---------------------------------------------------------------------------
// Soccer scoring
// ---------------------------------------------------------------------------

/**
 * Default soccer group-stage points: Win = 3, Draw = 1, Loss = 0.
 *
 * This is the single source of truth for the default scoring and the only
 * runtime constant in the tournament domain. It lives here because standings
 * are the only place these rules are applied. The actual values are now
 * tournament-owned configuration (see `ScoringConfig`); `calculateStandings`
 * accepts an override and falls back to these defaults.
 */
export const POINTS = {
  win: 3,
  draw: 1,
  loss: 0,
} as const;

/** The default scoring config, derived from `POINTS`. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  winPoints: POINTS.win,
  drawPoints: POINTS.draw,
  lossPoints: POINTS.loss,
};

/**
 * The default tiebreaker order applied after points:
 *   1. Goal difference (descending)
 *   2. Goals for (descending)
 * (Original draw order is always the final fallback and is not listed here.)
 */
export const DEFAULT_TIEBREAKER_ORDER: TiebreakerOrder = [
  "goal_difference",
  "goals_for",
];

/** All configurable tiebreaker keys (used for validation/normalization). */
export const ALL_TIEBREAKER_KEYS: readonly TiebreakerKey[] = [
  "goal_difference",
  "goals_for",
];

// ---------------------------------------------------------------------------
// Score validation
// ---------------------------------------------------------------------------

/**
 * Validates a completed match score.
 *
 * A completed soccer score must have non-negative integer goals for both
 * sides. Malformed scores (negative or fractional goals) are rejected rather
 * than silently accepted, which would otherwise corrupt the derived standings.
 */
export function validateScore(score: MatchScore): void {
  if (!Number.isInteger(score.home) || !Number.isInteger(score.away)) {
    throw new Error(
      `Score goals must be integers (got ${score.home}-${score.away}).`,
    );
  }
  if (score.home < 0 || score.away < 0) {
    throw new Error(
      `Score goals must be non-negative (got ${score.home}-${score.away}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tiebreaker order (configurable via `TiebreakerOrder`)
// ---------------------------------------------------------------------------

/**
 * Group-stage ranking order:
 *
 *   1. Points (descending) — always primary, never configurable.
 *   2. The configured `TiebreakerOrder` (descending for each key). Only the
 *      relative order of `goal_difference` and `goals_for` is configurable;
 *      defaults to goal difference, then goals for.
 *   3. Original draw order (ascending) — always the final deterministic
 *      fallback (lower drawOrder = drawn earlier = higher rank).
 *
 * Head-to-head is intentionally NOT implemented yet (not required by the
 * current product context). If participants are still tied after points and
 * all configured tiebreakers, the participant drawn earlier ranks higher.
 */

interface Accumulator {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

function createAccumulator(): Accumulator {
  return { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
}

/**
 * Calculates standings for a single group from its group-stage matches.
 *
 * `participants` must be the group's participants; their `drawOrder` is used as
 * the deterministic final tiebreaker (lower drawOrder = drawn earlier = higher
 * rank) and also determines which participants appear in the table, so a
 * participant with no completed matches still shows up with zeros.
 *
 * Incomplete matches (no score) and non-group matches are ignored. Only
 * completed group-stage matches involving two known participants count.
 *
 * `options.scoring` overrides the points awarded per result (defaults to
 * standard soccer 3/1/0). `options.tiebreakerOrder` overrides the order of
 * tiebreakers applied after points (defaults to goal difference, then goals
 * for). Points are always the primary sort and draw order is always the final
 * fallback, regardless of the config. Both options default so existing call
 * sites and tests remain backward-compatible.
 */
export function calculateStandings(
  matches: Match[],
  participants: Participant[],
  options?: {
    scoring?: ScoringConfig;
    tiebreakerOrder?: TiebreakerOrder;
  },
): Standing {
  const scoring = options?.scoring ?? DEFAULT_SCORING_CONFIG;
  const tiebreakerOrder =
    options?.tiebreakerOrder ?? DEFAULT_TIEBREAKER_ORDER;

  const stats = new Map<ParticipantId, Accumulator>();
  const drawOrderByParticipant = new Map<ParticipantId, number>();

  for (const participant of participants) {
    if (stats.has(participant.id)) {
      throw new Error(`Duplicate participant id in standings input: ${participant.id}.`);
    }
    stats.set(participant.id, createAccumulator());
    drawOrderByParticipant.set(participant.id, participant.drawOrder);
  }

  for (const match of matches) {
    if (match.stage !== "group") continue;
    if (match.score == null) continue;
    validateScore(match.score);
    const homeId = match.homeParticipantId;
    const awayId = match.awayParticipantId;
    if (homeId == null || awayId == null) continue;

    const home = stats.get(homeId);
    const away = stats.get(awayId);
    // Only count matches between known participants of this group.
    if (home == null || away == null) continue;

    const { home: homeGoals, away: awayGoals } = match.score;
    home.played++;
    away.played++;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.wins++;
      away.losses++;
    } else if (homeGoals < awayGoals) {
      away.wins++;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
    }
  }

  const rows: StandingRow[] = participants.map((participant) => {
    const acc = stats.get(participant.id)!;
    return {
      participantId: participant.id,
      position: 0,
      played: acc.played,
      wins: acc.wins,
      draws: acc.draws,
      losses: acc.losses,
      goalsFor: acc.goalsFor,
      goalsAgainst: acc.goalsAgainst,
      goalDifference: acc.goalsFor - acc.goalsAgainst,
      points:
        acc.wins * scoring.winPoints +
        acc.draws * scoring.drawPoints +
        acc.losses * scoring.lossPoints,
    };
  });

  rows.sort((a, b) => {
    // Points are always the primary sort (descending).
    if (a.points !== b.points) return b.points - a.points;
    // Apply each configured tiebreaker in order (all descending).
    for (const key of tiebreakerOrder) {
      if (key === "goal_difference") {
        if (a.goalDifference !== b.goalDifference) {
          return b.goalDifference - a.goalDifference;
        }
      } else if (key === "goals_for") {
        if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      }
    }
    // Deterministic fallback: earlier draw order ranks first.
    const aDraw = drawOrderByParticipant.get(a.participantId);
    const bDraw = drawOrderByParticipant.get(b.participantId);
    return (aDraw ?? Number.POSITIVE_INFINITY) - (bDraw ?? Number.POSITIVE_INFINITY);
  });

  rows.forEach((row, index) => {
    row.position = index + 1;
  });

  return rows;
}