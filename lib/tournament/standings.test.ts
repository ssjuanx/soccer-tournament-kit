import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateStandings, POINTS } from "./standings.ts";
import type { Match, Participant, Standing } from "./types.ts";

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

test("POINTS: standard soccer scoring (3/1/0)", () => {
  assert.equal(POINTS.win, 3);
  assert.equal(POINTS.draw, 1);
  assert.equal(POINTS.loss, 0);
});

test("calculateStandings: win/draw/loss and goal totals", () => {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
  ];
  const matches = [
    groupMatch("A", "a", "b", 2, 0),
    groupMatch("A", "b", "c", 1, 1),
    groupMatch("A", "a", "c", 0, 3),
  ];
  const standings = calculateStandings(matches, participants);
  const row = (id: string) => standings.find((r) => r.participantId === id)!;

  // a: W1 D0 L1, GF2 GA3, GD -1, 3 pts
  assert.deepEqual(row("a"), {
    participantId: "a",
    position: 2,
    played: 2,
    wins: 1,
    draws: 0,
    losses: 1,
    goalsFor: 2,
    goalsAgainst: 3,
    goalDifference: -1,
    points: 3,
  });
  assert.equal(row("b").points, 1);
  assert.equal(row("b").draws, 1);
  assert.equal(row("c").points, 4);
  assert.equal(row("c").position, 1);
});

test("calculateStandings: incomplete matches do not affect standings", () => {
  const participants = [participant("a", 1), participant("b", 2)];
  const matches: Match[] = [
    {
      id: "A-a-b",
      stage: "group",
      groupId: "A",
      knockoutRound: null,
      homeParticipantId: "a",
      awayParticipantId: "b",
      score: null,
    },
  ];
  const standings = calculateStandings(matches, participants);
  assert.equal(standings[0].played, 0);
  assert.equal(standings[0].points, 0);
  assert.equal(standings[1].played, 0);
});

test("calculateStandings: participant with no completed matches still appears", () => {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
  ];
  const matches = [groupMatch("A", "a", "b", 1, 0)];
  const standings = calculateStandings(matches, participants);
  const row = (id: string) => standings.find((r) => r.participantId === id)!;
  assert.equal(row("c").played, 0);
  assert.equal(row("c").points, 0);
  assert.equal(row("c").goalsFor, 0);
  // c has GD 0 while b (lost 0-1) has GD -1, so c ranks above b -> position 2.
  assert.equal(row("c").position, 2);
  assert.equal(row("b").position, 3);
});
test("calculateStandings: ignores non-group matches", () => {
  const participants = [participant("a", 1), participant("b", 2)];
  const knockout: Match = {
    id: "KO-a-b",
    stage: "knockout",
    groupId: null,
    knockoutRound: "quarter_final",
    homeParticipantId: "a",
    awayParticipantId: "b",
    score: { home: 5, away: 0 },
  };
  const standings = calculateStandings([knockout], participants);
  assert.equal(standings[0].played, 0);
});

test("calculateStandings: ignores matches with unknown participants", () => {
  const participants = [participant("a", 1), participant("b", 2)];
  const stranger = groupMatch("A", "a", "z", 3, 0);
  const standings = calculateStandings([stranger], participants);
  assert.equal(standings[0].played, 0);
});

test("calculateStandings: positions are 1..n contiguous", () => {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
    participant("d", 4),
  ];
  const matches = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "c", "d", 2, 2),
    groupMatch("A", "a", "c", 0, 1),
    groupMatch("A", "b", "d", 3, 0),
  ];
  const standings = calculateStandings(matches, participants);
  assert.deepEqual(
    standings.map((r) => r.position),
    [1, 2, 3, 4],
  );
});

test("calculateStandings: tiebreaker is points > goal difference > goals for", () => {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
  ];
  // a: W0 D1 L1, GF3 GA4, GD -1, pts1
  // b: W2 D0 L0, GF4 GA1, GD +3, pts6
  // c: W0 D1 L1, GF2 GA4, GD -2, pts1
  const matches = [
    groupMatch("A", "a", "b", 1, 2),
    groupMatch("A", "a", "c", 2, 2),
    groupMatch("A", "b", "c", 2, 0),
  ];
  const standings = calculateStandings(matches, participants);
  assert.equal(standings[0].participantId, "b");
  assert.equal(standings[1].participantId, "a");
  assert.equal(standings[2].participantId, "c");
});

test("calculateStandings: exact tie uses original draw order as fallback", () => {
  const participants = [
    participant("a", 3),
    participant("b", 1),
    participant("c", 2),
  ];
  // Everyone: 1 draw, GF1, GA1, GD0, pts1 -> tie on points/GD/GF.
  // Fallback: drawOrder ascending => b(1), c(2), a(3).
  const matches = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "b", "c", 1, 1),
    groupMatch("A", "a", "c", 1, 1),
  ];
  const standings = calculateStandings(matches, participants);
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["b", "c", "a"],
  );
});

test("calculateStandings: is sorted by position ascending", () => {
  const participants = [
    participant("a", 1),
    participant("b", 2),
    participant("c", 3),
  ];
  const matches = [
    groupMatch("A", "a", "b", 2, 0),
    groupMatch("A", "b", "c", 0, 2),
    groupMatch("A", "a", "c", 1, 1),
  ];
  const standings: Standing = calculateStandings(matches, participants);
  for (let i = 1; i < standings.length; i++) {
    assert.ok(standings[i - 1].position < standings[i].position);
  }
});