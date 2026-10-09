/**
 * Cross-group qualifier selection for `"bestX"` advancement destinations.
 *
 * A `"bestX"` destination takes the `count` best finishers at a single standing
 * `position` across the configured `groups`, ranked by a `CrossGroupStrategy`.
 * This module implements the pure ranking/selection logic; the persistence
 * layer (`lib/db/fixtures.ts`) wires it into `buildQualifiers`.
 *
 * Kept free of persistence/UI imports per the project's purity rule
 * (context.md): it depends only on the tournament domain types and the
 * `Qualifier` shape from the knockout engine.
 */

import type { Qualifier } from "./knockout";
import type {
  AdvancementDestination,
  CrossGroupStrategy,
  GroupId,
  ParticipantId,
  Standing,
  StandingRow,
} from "./types";

/**
 * Mirrors `compareGroupLabels` in `lib/db/setup.ts` so this module stays free
 * of persistence-layer imports. Shorter labels sort first, then lexicographic.
 */
function compareLabels(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Candidate {
  row: StandingRow;
  groupId: GroupId;
  groupLabel: string;
  drawOrder: number;
}

/** Per-game averages, guarded against a zero `played` denominator. */
function perGame(row: StandingRow): {
  ppg: number;
  gdpg: number;
  gfpg: number;
} {
  if (row.played <= 0) return { ppg: 0, gdpg: 0, gfpg: 0 };
  return {
    ppg: row.points / row.played,
    gdpg: row.goalDifference / row.played,
    gfpg: row.goalsFor / row.played,
  };
}

/**
 * Builds the ascending sort key for a candidate under `strategy`. Each
 * "higher is better" metric is negated so a plain ascending compare ranks the
 * best finisher first. `drawOrder` is the spec's final deterministic fallback
 * (lower draw order = earlier draw = ranks first).
 */
function rankKey(c: Candidate, strategy: CrossGroupStrategy): number[] {
  const r = c.row;
  if (strategy === "raw") {
    return [-r.points, -r.goalDifference, -r.goalsFor, c.drawOrder];
  }
  // "per-game" (also the fallback for any strategy not yet wired here)
  const { ppg, gdpg, gfpg } = perGame(r);
  return [-ppg, -gdpg, -gfpg, c.drawOrder];
}

/**
 * Selects the `count` best finishers at standing `position` across the
 * configured groups for a `"bestX"` advancement destination, in global seed
 * order (best first, ready for `generateBracket`).
 *
 *   - `dest.position` — the 1-based standing position each candidate must hold
 *     in its group (e.g. `3` = each group's 3rd-place finisher). A group with
 *     no row at that position (it is smaller than `position`) contributes no
 *     candidate.
 *   - `dest.count` — how many of the ranked candidates to take.
 *   - `dest.strategy` — `"per-game"` (default) or `"raw"`. The `"gate"` and
 *     `"playoff"` strategies are resolved by later phases; until then they
 *     select nothing (return `[]`) rather than silently producing a wrong
 *     bracket.
 *   - `dest.groups` — optional set of group labels to consider; omit for all.
 *   - `drawOrderByParticipant` — participant id → original draw order, used as
 *     the final deterministic tiebreaker. When omitted (or a participant is
 *     unknown), draw order is treated as `Infinity` and ties fall through to
 *     group label then participant id.
 *
 * Returns `[]` when `dest.mode !== "bestX"` or the configuration is incomplete.
 */
export function selectBestX(
  groups: { id: string; label: string }[],
  standingsByGroup: Map<string, Standing>,
  dest: AdvancementDestination,
  drawOrderByParticipant?: Map<ParticipantId, number>,
): Qualifier[] {
  if (dest.mode !== "bestX") return [];

  const count =
    Number.isInteger(dest.count) && (dest.count as number) >= 1
      ? (dest.count as number)
      : 0;
  if (count === 0) return [];

  const position =
    Number.isInteger(dest.position) && (dest.position as number) >= 1
      ? (dest.position as number)
      : 0;
  if (position === 0) return [];

  const strategy: CrossGroupStrategy = dest.strategy ?? "per-game";
  // gate / playoff are resolved by later phases; until then select nothing.
  if (strategy !== "per-game" && strategy !== "raw") return [];

  const allowedLabels =
    dest.groups && dest.groups.length > 0 ? new Set(dest.groups) : null;

  const candidates: Candidate[] = [];
  for (const group of groups) {
    if (allowedLabels && !allowedLabels.has(group.label)) continue;
    const standings = standingsByGroup.get(group.id);
    if (!standings) continue;
    const row = standings.find((r) => r.position === position);
    if (!row) continue;
    candidates.push({
      row,
      groupId: group.id as GroupId,
      groupLabel: group.label,
      drawOrder: drawOrderByParticipant?.get(row.participantId) ?? Infinity,
    });
  }

  candidates.sort((a, b) => {
    const ka = rankKey(a, strategy);
    const kb = rankKey(b, strategy);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    const lc = compareLabels(a.groupLabel, b.groupLabel);
    if (lc !== 0) return lc;
    return a.row.participantId < b.row.participantId
      ? -1
      : a.row.participantId > b.row.participantId
        ? 1
        : 0;
  });

  return candidates.slice(0, count).map((c) => ({
    participantId: c.row.participantId,
    groupId: c.groupId,
    groupPosition: c.row.position,
  }));
}