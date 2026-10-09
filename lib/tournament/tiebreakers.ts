/**
 * Cohort-based group-stage ranking helpers.
 *
 * Phase 2 splits the old single-pass `.sort()` comparator into a recursive
 * *cohort* resolver so that tiebreakers which need the set of tied participants
 * (head-to-head mini-table, manual admin ordering) can be applied correctly.
 *
 * The resolver is pure and persistence-free; `calculateStandings` in
 * `standings.ts` builds the per-participant statistics and then delegates
 * position assignment + unresolved-flagging to `rankRows` here.
 */

import type {
  GroupId,
  ManualTiebreakResolution,
  Match,
  ParticipantId,
  ScoringConfig,
  StandingRow,
  TiebreakerOrder,
} from "./types";

// ---------------------------------------------------------------------------
// Mini-table (head-to-head) statistics
// ---------------------------------------------------------------------------

/** Head-to-head mini-table row for a single participant within a cohort. */
interface MiniStats {
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

function pairKey(a: ParticipantId, b: ParticipantId): string {
  // Deterministic unordered key.
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds a head-to-head mini-table for a tied cohort, considering only the
 * completed group-stage matches played *between* the cohort's members.
 *
 * Returns `null` when the mini-table cannot be used to fairly rank the cohort:
 * every unordered pair of members must have at least one completed match. If
 * any pair is missing (incomplete fixtures), no winner is manufactured and the
 * caller falls through to the next tiebreaker.
 */
export function buildHeadToHeadMiniStandings(
  cohortIds: ParticipantId[],
  matches: Match[],
  scoring: ScoringConfig,
): Map<ParticipantId, MiniStats> | null {
  const idSet = new Set(cohortIds);
  if (cohortIds.length < 2) return null;

  const stats = new Map<ParticipantId, MiniStats>();
  for (const id of cohortIds) {
    stats.set(id, { points: 0, goalsFor: 0, goalsAgainst: 0 });
  }

  // Track which unordered pairs have at least one completed match so we can
  // require a complete mini-league before trusting head-to-head.
  const completedPairs = new Set<string>();

  for (const match of matches) {
    if (match.stage !== "group") continue;
    if (match.score == null) continue;
    const homeId = match.homeParticipantId;
    const awayId = match.awayParticipantId;
    if (homeId == null || awayId == null) continue;
    if (!idSet.has(homeId) || !idSet.has(awayId)) continue;
    if (homeId === awayId) continue;

    const home = stats.get(homeId)!;
    const away = stats.get(awayId)!;
    const { home: homeGoals, away: awayGoals } = match.score;

    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.points += scoring.winPoints;
      away.points += scoring.lossPoints;
    } else if (homeGoals < awayGoals) {
      away.points += scoring.winPoints;
      home.points += scoring.lossPoints;
    } else {
      home.points += scoring.drawPoints;
      away.points += scoring.drawPoints;
    }

    completedPairs.add(pairKey(homeId, awayId));
  }

  // Require every pair to have been played.
  for (let i = 0; i < cohortIds.length; i++) {
    for (let j = i + 1; j < cohortIds.length; j++) {
      if (!completedPairs.has(pairKey(cohortIds[i], cohortIds[j]))) {
        return null;
      }
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Cohort resolver
// ---------------------------------------------------------------------------

/**
 * Deterministic key for a tied cohort: the cohort's participant ids, sorted and
 * joined by ",". Two cohorts with the same members (regardless of input order)
 * produce the same key, so a stored manual resolution targets exactly one
 * cohort. The resolver keys manual resolutions by the composite
 * `groupId + NUL + cohortKey`, which keeps cohorts from different groups (and
 * different cohorts within a group) distinct.
 */
export function cohortKeyOf(ids: ParticipantId[]): string {
  return [...ids].sort().join(",");
}

/** Separator guaranteed not to appear in ids/cohort keys. */
const MANUAL_KEY_SEP = "\u0000";

function manualResolutionMapKey(groupId: GroupId, cohortKey: string): string {
  return `${groupId}${MANUAL_KEY_SEP}${cohortKey}`;
}

/** An ordered bucket of participant ids that share a rank. */
interface Bucket {
  ids: ParticipantId[];
  unresolved: boolean;
}

interface ResolveContext {
  /** row stats keyed by participant id */
  rows: Map<ParticipantId, StandingRow>;
  drawOrderById: Map<ParticipantId, number>;
  matches: Match[];
  scoring: ScoringConfig;
  tiebreakerOrder: TiebreakerOrder;
  /** manual orders keyed by `groupId + NUL + cohortKey` */
  manualOrderById: Map<string, ParticipantId[]>;
  groupId: GroupId | null;
}

/** Returns true when every id in `ids` appears in `order`. */
function coversAll(order: ParticipantId[], ids: ParticipantId[]): boolean {
  const set = new Set(order);
  for (const id of ids) {
    if (!set.has(id)) return false;
  }
  return true;
}

/** Splits a cohort into singletons by draw order ascending. */
function splitByDrawOrder(ids: ParticipantId[], ctx: ResolveContext): Bucket[] {
  const sorted = [...ids].sort((a, b) => {
    const aDraw = ctx.drawOrderById.get(a) ?? Number.POSITIVE_INFINITY;
    const bDraw = ctx.drawOrderById.get(b) ?? Number.POSITIVE_INFINITY;
    return aDraw - bDraw;
  });
  return sorted.map((id) => ({ ids: [id], unresolved: false }));
}

/**
 * Splits a cohort into sub-cohorts by a numeric stat, ordering the sub-cohorts
 * best-first (descending when `descending`, ascending otherwise), then resolves
 * each sub-cohort with the next tiebreaker.
 */
function splitByStat(
  ids: ParticipantId[],
  stat: (id: ParticipantId) => number,
  tiebreakerIndex: number,
  ctx: ResolveContext,
  descending: boolean,
): Bucket[] {
  const groups = new Map<number, ParticipantId[]>();
  for (const id of ids) {
    const value = stat(id);
    const list = groups.get(value);
    if (list) {
      list.push(id);
    } else {
      groups.set(value, [id]);
    }
  }
  const sortedValues = [...groups.keys()].sort((a, b) =>
    descending ? b - a : a - b,
  );
  const buckets: Bucket[] = [];
  for (const value of sortedValues) {
    const subCohort = groups.get(value)!;
    buckets.push(...resolveCohort(subCohort, tiebreakerIndex + 1, ctx));
  }
  return buckets;
}

/**
 * Recursively resolves a tied cohort into ordered buckets.
 *
 * At each step the current tiebreaker (indexed by `tiebreakerIndex`) splits the
 * cohort into sub-cohorts; each sub-cohort is then resolved with the next
 * tiebreaker. When all configured tiebreakers are exhausted, the cohort is
 * split into singletons by original draw order (the deterministic fallback).
 */
function resolveCohort(
  ids: ParticipantId[],
  tiebreakerIndex: number,
  ctx: ResolveContext,
): Bucket[] {
  if (ids.length <= 1) {
    return [{ ids, unresolved: false }];
  }

  if (tiebreakerIndex >= ctx.tiebreakerOrder.length) {
    // Final deterministic fallback: draw order ascending (lower = earlier).
    return splitByDrawOrder(ids, ctx);
  }

  const key = ctx.tiebreakerOrder[tiebreakerIndex];

  if (key === "goal_difference") {
    return splitByStat(
      ids,
      (id) => ctx.rows.get(id)!.goalDifference,
      tiebreakerIndex,
      ctx,
      true, // descending: better GD first
    );
  }

  if (key === "goals_for") {
    return splitByStat(
      ids,
      (id) => ctx.rows.get(id)!.goalsFor,
      tiebreakerIndex,
      ctx,
      true,
    );
  }

  if (key === "head_to_head") {
    const mini = buildHeadToHeadMiniStandings(ids, ctx.matches, ctx.scoring);
    if (mini == null) {
      // Not enough completed head-to-head matches; skip to the next tiebreaker
      // without splitting the cohort.
      return resolveCohort(ids, tiebreakerIndex + 1, ctx);
    }
    return splitByStat(
      ids,
      (id) => mini.get(id)!.points,
      tiebreakerIndex,
      ctx,
      true,
    );
  }

  if (key === "manual") {
    // Manual is terminal: an explicit admin ordering fully resolves the cohort,
    // or — when no/invalid resolution is stored — the cohort is unresolved.
    // Resolutions are cohort-scoped: the cohort's deterministic key selects the
    // matching stored order (if any) for this group.
    const cohortKey = cohortKeyOf(ids);
    const order =
      ctx.groupId != null
        ? ctx.manualOrderById.get(
            manualResolutionMapKey(ctx.groupId, cohortKey),
          )
        : undefined;
    if (order == null || !coversAll(order, ids)) {
      return [{ ids, unresolved: true }];
    }
    const indexById = new Map<ParticipantId, number>();
    order.forEach((id, i) => indexById.set(id, i));
    const sorted = [...ids].sort(
      (a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0),
    );
    return sorted.map((id) => ({ ids: [id], unresolved: false }));
  }

  // Unknown keys are treated as no-ops (filtered out before reaching here in
  // practice, but this keeps the resolver total).
  return resolveCohort(ids, tiebreakerIndex + 1, ctx);
}
// ---------------------------------------------------------------------------
// Top-level ranking entry point
// ---------------------------------------------------------------------------

/**
 * Ranks the given `StandingRow`s (whose stats are already computed and whose
 * `position` is 0 / `unresolved` is false) and mutates each row in place with
 * its final `position` and `unresolved` flag. Returns the rows in ranked order.
 *
 * Ranking is always points-first (descending). Within each equal-points cohort
 * the configured `tiebreakerOrder` is applied recursively; the original draw
 * order is the final deterministic fallback unless `manual` intervenes.
 */
export function rankRows(
  rows: StandingRow[],
  ctx: {
    drawOrderById: Map<ParticipantId, number>;
    matches: Match[];
    scoring: ScoringConfig;
    tiebreakerOrder: TiebreakerOrder;
    manualResolutions?: ManualTiebreakResolution[];
    groupId?: GroupId | null;
  },
): StandingRow[] {
  const rowsById = new Map<ParticipantId, StandingRow>();
  for (const row of rows) rowsById.set(row.participantId, row);

  const manualOrderById = new Map<string, ParticipantId[]>();
  for (const resolution of ctx.manualResolutions ?? []) {
    // Legacy group-scoped rows (no cohort key) are ignored — only cohort-scoped
    // resolutions participate in ranking.
    if (!resolution.cohortKey) continue;
    manualOrderById.set(
      manualResolutionMapKey(resolution.groupId, resolution.cohortKey),
      resolution.participantOrder,
    );
  }

  const resolveCtx: ResolveContext = {
    rows: rowsById,
    drawOrderById: ctx.drawOrderById,
    matches: ctx.matches,
    scoring: ctx.scoring,
    tiebreakerOrder: ctx.tiebreakerOrder,
    manualOrderById,
    groupId: ctx.groupId ?? null,
  };

  // Points are always the primary sort (descending). Start "before" the first
  // configured tiebreaker (index -1 -> splitByStat advances to index 0).
  const buckets = splitByStat(
    rows.map((r) => r.participantId),
    (id) => rowsById.get(id)!.points,
    -1,
    resolveCtx,
    true,
  );

  // Assign positions: each bucket's members share a position; the next bucket
  // starts after the previous bucket's size (1224-style for shared positions).
  let position = 1;
  const ordered: StandingRow[] = [];
  for (const bucket of buckets) {
    for (const id of bucket.ids) {
      const row = rowsById.get(id)!;
      row.position = position;
      row.unresolved = bucket.unresolved;
      ordered.push(row);
    }
    position += bucket.ids.length;
  }

  return ordered;
}