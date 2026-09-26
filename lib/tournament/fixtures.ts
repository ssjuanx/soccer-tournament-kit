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
 * the pair indices (`${groupId}-${i}-${j}`). Scores start as `null`.
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

  const matches: Match[] = [];
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
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
  }
  return matches;
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
