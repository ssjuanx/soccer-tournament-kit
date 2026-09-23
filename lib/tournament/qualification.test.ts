import { test } from "node:test";
import assert from "node:assert/strict";

import { getQualifiedParticipants } from "./qualification.ts";
import { calculateStandings } from "./standings.ts";
import type { Match, Participant, StandingRow } from "./types.ts";

function participant(id: string, drawOrder: number): Participant {
  return { id, name: id, drawOrder, assignedTeamId: null, groupId: null };
}

function groupMatch(
  groupId: string,
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
): Match {
  return {
    id: `${groupId}-${home}-${away}`,
    stage: "group",
    groupId,
    knockoutRound: null,
    homeParticipantId: home,
    awayParticipantId: away,
    score: { home: homeGoals, away: awayGoals },
  };
}

function buildStandings(): StandingRow[] {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
    participant("d", 4),
  ];
  const matches = [
    groupMatch("A", "a", "b", 2, 0),
    groupMatch("A", "a", "c", 3, 0),
    groupMatch("A", "a", "d", 1, 0), // a wins all
    groupMatch("A", "b", "c", 1, 0),
    groupMatch("A", "b", "d", 0, 0),
    groupMatch("A", "c", "d", 0, 2), // d beats c
  ];
  return calculateStandings(matches, participants);
}

test("getQualifiedParticipants: returns top N by position", () => {
  const standings = buildStandings();
  const top2 = getQualifiedParticipants(standings, 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0].position, 1);
  assert.equal(top2[1].position, 2);
});

test("getQualifiedParticipants: count is configurable (not hardcoded to 2)", () => {
  const standings = buildStandings();
  assert.equal(getQualifiedParticipants(standings, 1).length, 1);
  assert.equal(getQualifiedParticipants(standings, 3).length, 3);
  assert.equal(getQualifiedParticipants(standings, 0).length, 0);
});

test("getQualifiedParticipants: count larger than field returns all", () => {
  const standings = buildStandings();
  assert.equal(getQualifiedParticipants(standings, 99).length, standings.length);
});

test("getQualifiedParticipants: does not mutate input", () => {
  const standings = buildStandings();
  const snapshot = standings.map((r) => r.position);
  getQualifiedParticipants(standings, 2);
  assert.deepEqual(
    standings.map((r) => r.position),
    snapshot,
  );
});

test("getQualifiedParticipants: rejects negative / non-integer count", () => {
  const standings = buildStandings();
  assert.throws(() => getQualifiedParticipants(standings, -1), /non-negative/);
  assert.throws(() => getQualifiedParticipants(standings, 1.5), /integer/);
});