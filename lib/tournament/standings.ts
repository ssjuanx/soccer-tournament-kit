/**
 * Soccer group-stage standings calculation.
 *
 * Standings are derived from completed group-stage matches. Nothing here is
 * persisted; these values are recomputed from the stored match scores.
 */

import type {
  Match,
  Participant,
  ParticipantId,
  Standing,
  StandingRow,
} from "./types";

// ---------------------------------------------------------------------------
// Soccer scoring
// ---------------------------------------------------------------------------

/**
 * Soccer group-stage points awarded for a match result.
 * Win = 3, Draw = 1, Loss = 0.
 *
 * This is the single source of truth for scoring and the only runtime constant
 * in the tournament domain. It lives here because standings are the only place
 * these rules are applied.
 */
export const POINTS = {
  win: 3,
  draw: 1,
  loss: 0,
} as const;

// ---------------------------------------------------------------------------
// Tiebreaker order (temporary, explicitly documented)
// ---------------------------------------------------------------------------

/**
 * Current tiebreaker order for ranking within a group:
 *
 *   1. Points (descending)
 *   2. Goal difference (descending)
 *   3. Goals for (descending)
 *   4. Original draw order (ascending) — deterministic fallback
 *
 * Head-to-head is intentionally NOT implemented yet (not required by the
 * current product context). If participants are still tied after points, goal
 * difference, and goals for, the participant drawn earlier ranks higher.
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
 */
export function calculateStandings(
  matches: Match[],
  participants: Participant[],
): Standing {
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
      points: acc.wins * POINTS.win + acc.draws * POINTS.draw,
    };
  });

  rows.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.goalDifference !== b.goalDifference) {
      return b.goalDifference - a.goalDifference;
    }
    if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
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