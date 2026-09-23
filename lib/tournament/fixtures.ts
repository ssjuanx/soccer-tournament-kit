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