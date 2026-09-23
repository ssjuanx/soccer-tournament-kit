/**
 * Group-stage qualification.
 *
 * Selects the top N participants from a group based on its (already sorted)
 * standings. The number of qualifiers per group is chosen by the caller, not
 * hardcoded. Knockout bracket generation is deferred to a later step.
 */

import type { Standing } from "./types";

/**
 * Returns the top `count` participants from a group's standings, preserving
 * the standings' ranking order.
 *
 * `standings` is expected to be sorted by `position` (as produced by
 * `calculateStandings`). This function sorts a copy by `position` defensively
 * before slicing, so it never depends on the caller having sorted the input.
 *
 * If `count` exceeds the number of rows, all rows are returned. `count` must be
 * a non-negative integer.
 */
export function getQualifiedParticipants(
  standings: Standing,
  count: number,
): Standing {
  if (!Number.isInteger(count)) {
    throw new Error(`count must be an integer (got ${count}).`);
  }
  if (count < 0) {
    throw new Error(`count must be non-negative (got ${count}).`);
  }

  return [...standings]
    .sort((a, b) => a.position - b.position)
    .slice(0, count);
}