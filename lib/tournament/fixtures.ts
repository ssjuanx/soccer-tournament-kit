/**
 * Group-stage fixture generation.
 *
 * Generates a single round-robin schedule for one group: every participant in
 * the group plays every other participant exactly once. This module produces
 * match *pairings* only — scheduling by time, court, or console is deferred.
 */

import type { GroupId, Match } from "./types";

/**
 * Generates all group-stage match pairings for a single group.
 *
 * For `n` participants this produces exactly `n * (n - 1) / 2` matches:
 *   3 participants -> 3 matches
 *   4 participants -> 6 matches
 *   5 participants -> 10 matches
 *
 * Output is deterministic: each unordered pair appears exactly once, there are
 * no self-matches, and the home participant is the one that appears earlier in
 * `participantIds`. Match ids are derived deterministically from the group and
 * the pair indices (`${groupId}-${i}-${j}` with `i < j`). Scores start as
 * `null`.
 *
 * The *order* of matches follows the circle method (a.k.a. polygon method):
 * participants are arranged around a polygon and rotated one position per
 * round, so that in each round every participant plays at most once. This
 * produces a fairer play schedule than the naive double loop (which makes one
 * participant play all their matches before the next starts) and pairs better
 * with `orderGroupMatchesForPlay`, which interleaves rounds across groups.
 *
 * Fixtures are independent between groups — call this once per group with that
 * group's participant ids.
 */
export function generateGroupFixtures(
  participantIds: string[],
  groupId: GroupId,
): Match[] {
  if (!Array.isArray(participantIds)) {
    throw new Error("participantIds must be an array.");
  }
  if (groupId == null || groupId === "") {
    throw new Error("groupId must be a non-empty string.");
  }

  const seen = new Set<string>();
  for (const id of participantIds) {
    if (typeof id !== "string" || id === "") {
      throw new Error("participantIds must contain non-empty strings.");
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate participant id in group ${groupId}: ${id}.`);
    }
    seen.add(id);
  }

  const pairs = circleMethodPairs(participantIds.length);
  const matches: Match[] = [];
  for (const [i, j] of pairs) {
    matches.push({
      id: `${groupId}-${i}-${j}`,
      stage: "group",
      groupId,
      knockoutRound: null,
      homeParticipantId: participantIds[i],
      awayParticipantId: participantIds[j],
      score: null,
    });
  }
  return matches;
}

/**
 * Produces the list of `[i, j]` index pairs (with `i < j`) for a round-robin
 * of `n` participants, ordered by round using the circle method.
 *
 * If `n` is odd, a dummy bye (represented internally as -1) is appended so the
 * polygon has an even number of vertices; pairs involving the bye are skipped.
 * The rotation keeps vertex 0 fixed and rotates the rest clockwise, so each
 * round pairs vertex 0 with a different opponent and every other pair shifts
 * by one.
 */
function circleMethodPairs(n: number): Array<[number, number]> {
  if (n < 2) return [];
  const size = n % 2 === 0 ? n : n + 1;
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(i);
  if (n % 2 !== 0) arr.push(-1); // bye

  const rounds = size - 1;
  const half = size / 2;
  const pairs: Array<[number, number]> = [];

  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < half; k++) {
      const a = arr[k];
      const b = arr[size - 1 - k];
      if (a === -1 || b === -1) continue; // skip bye
      pairs.push(a < b ? [a, b] : [b, a]);
    }
    // Rotate: keep arr[0] fixed, move the last element to position 1.
    const last = arr.pop()!;
    arr.splice(1, 0, last);
  }
  return pairs;
}

/**
 * Produces one simple event-wide play order by taking the next match from each
 * group in turn. No times or courts are assigned: this is only the sequence in
 * which matches should be called. Matches whose group is not in
 * `orderedGroupIds` are appended so malformed/legacy data is never hidden.
 */
export function orderGroupMatchesForPlay(
  matches: Match[],
  orderedGroupIds: GroupId[],
): Match[] {
  const byGroup = new Map<GroupId, Match[]>();
  const knownGroupIds = new Set(orderedGroupIds);
  const remaining: Match[] = [];

  for (const match of matches) {
    if (match.groupId == null || !knownGroupIds.has(match.groupId)) {
      remaining.push(match);
      continue;
    }
    const groupMatches = byGroup.get(match.groupId) ?? [];
    groupMatches.push(match);
    byGroup.set(match.groupId, groupMatches);
  }

  const ordered: Match[] = [];
  const longestGroup = Math.max(
    0,
    ...orderedGroupIds.map((groupId) => byGroup.get(groupId)?.length ?? 0),
  );

  for (let matchIndex = 0; matchIndex < longestGroup; matchIndex++) {
    for (const groupId of orderedGroupIds) {
      const match = byGroup.get(groupId)?.[matchIndex];
      if (match) ordered.push(match);
    }
  }

  return [...ordered, ...remaining];
}
