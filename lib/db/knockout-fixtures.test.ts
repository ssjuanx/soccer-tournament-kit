import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateStandings } from "../tournament/standings.ts";
import { getGroupSizes } from "../tournament/groups.ts";
import type { Match, Participant } from "../tournament/types.ts";
import {
  buildConsolationQualifiers,
  buildKnockoutQualifiers,
  buildKnockoutStageMatches,
  isGroupStageComplete,
  type KnockoutMatchInsertRow,
} from "./fixtures.ts";

const TID = "active";

function p(id: string, drawOrder: number, groupId: string): Participant {
  return { id, name: id, drawOrder, assignedTeamId: null, groupId };
}

function gm(
  groupId: string,
  home: string,
  away: string,
  hg: number,
  ag: number,
): Match {
  return {
    id: `${groupId}-${home}-${away}`,
    stage: "group",
    groupId,
    knockoutRound: null,
    homeParticipantId: home,
    awayParticipantId: away,
    score: { home: hg, away: ag },
  };
}

// Group A: a 1st, b 2nd, c 3rd, d 4th.
function standingsA() {
  const parts = [p("a", 1, "gA"), p("b", 2, "gA"), p("c", 3, "gA"), p("d", 4, "gA")];
  const matches = [
    gm("gA", "a", "b", 2, 0),
    gm("gA", "a", "c", 3, 0),
    gm("gA", "a", "d", 1, 0),
    gm("gA", "b", "c", 1, 0),
    gm("gA", "b", "d", 0, 0),
    gm("gA", "c", "d", 0, 2),
  ];
  return calculateStandings(matches, parts, { groupId: "gA" });
}

// Group B: e 1st, f 2nd, g 3rd.
function standingsB() {
  const parts = [p("e", 1, "gB"), p("f", 2, "gB"), p("g", 3, "gB")];
  const matches = [
    gm("gB", "e", "f", 1, 0),
    gm("gB", "e", "g", 2, 0),
    gm("gB", "f", "g", 1, 0),
  ];
  return calculateStandings(matches, parts, { groupId: "gB" });
}

const GROUPS = [
  { id: "gA", label: "A" },
  { id: "gB", label: "B" },
];

test("isGroupStageComplete: false when no matches", () => {
  assert.equal(isGroupStageComplete([]), false);
});

test("isGroupStageComplete: false when any match unplayed", () => {
  const matches = [gm("g", "a", "b", 1, 0), { ...gm("g", "a", "c", 1, 0), score: null }];
  assert.equal(isGroupStageComplete(matches), false);
});

test("isGroupStageComplete: true when every match scored", () => {
  const matches = [gm("g", "a", "b", 1, 0), gm("g", "a", "c", 2, 0)];
  assert.equal(isGroupStageComplete(matches), true);
});

test("buildKnockoutQualifiers: top 2 per group, winners tier first by label", () => {
  const byGroup = new Map([
    ["gA", standingsA()],
    ["gB", standingsB()],
  ]);
  const q = buildKnockoutQualifiers(GROUPS, byGroup, 2);
  // Group A runner-up is d (better goal difference than b).
  assert.deepEqual(
    q.map((x) => x.participantId),
    ["a", "e", "d", "f"],
  );
  assert.equal(q[0].groupPosition, 1);
  assert.equal(q[2].groupPosition, 2);
});

test("buildKnockoutQualifiers: respects qualifiersPerGroup", () => {
  const byGroup = new Map([
    ["gA", standingsA()],
    ["gB", standingsB()],
  ]);
  const q = buildKnockoutQualifiers(GROUPS, byGroup, 1);
  assert.deepEqual(
    q.map((x) => x.participantId),
    ["a", "e"],
  );
});

test("buildConsolationQualifiers: includes every non-qualifier", () => {
  const byGroup = new Map([
    ["gA", standingsA()],
    ["gB", standingsB()],
  ]);
  const participants = [
    p("a", 1, "gA"),
    p("b", 2, "gA"),
    p("c", 3, "gA"),
    p("d", 4, "gA"),
    p("e", 5, "gB"),
    p("f", 6, "gB"),
    p("g", 7, "gB"),
  ];
  const q = buildConsolationQualifiers(GROUPS, byGroup, 2, participants);

  // Both third-place finishers precede the fourth-place participant. Within
  // the third-place tier, b's points-per-game ranks above g's.
  assert.deepEqual(
    q.map((x) => x.participantId),
    ["b", "g", "c"],
  );
  assert.deepEqual(
    q.map((x) => x.groupPosition),
    [3, 3, 4],
  );
});

test("buildConsolationQualifiers: compares rates across unequal group sizes", () => {
  const row = (
    participantId: string,
    played: number,
    points: number,
    goalDifference: number,
    goalsFor: number,
  ) => ({
    participantId,
    position: 3,
    played,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor,
    goalsAgainst: goalsFor - goalDifference,
    goalDifference,
    points,
    unresolved: false,
  });
  const byGroup = new Map([
    ["gA", [row("three-games", 3, 4, 1, 3)]],
    ["gB", [row("two-games", 2, 3, 0, 2)]],
  ]);
  const q = buildConsolationQualifiers(GROUPS, byGroup, 2, [
    p("three-games", 1, "gA"),
    p("two-games", 2, "gB"),
  ]);

  assert.deepEqual(
    q.map((x) => x.participantId),
    ["two-games", "three-games"],
  );
});

test("buildKnockoutStageMatches: knockout rows for all rounds", () => {
  const byGroup = new Map([
    ["gA", standingsA()],
    ["gB", standingsB()],
  ]);
  const q = buildKnockoutQualifiers(GROUPS, byGroup, 2);
  const rows = buildKnockoutStageMatches(q, TID);
  // 4 qualifiers -> bracket 4 -> 2 semis + 1 final.
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.stage === "knockout" && r.groupId === null));
  assert.ok(rows.every((r) => r.bracketKind === "championship"));
  assert.ok(rows.every((r) => r.homeScore === null && r.awayScore === null));
  const semis = rows.filter((r) => r.knockoutRound === "semi_final");
  assert.equal(semis.length, 2);
  for (const r of semis) {
    assert.ok(r.homeParticipantId != null && r.awayParticipantId != null);
    assert.ok(r.knockoutSeed != null);
  }
  const final = rows.find((r) => r.knockoutRound === "final")!;
  assert.equal(final.homeParticipantId, null);
  assert.equal(final.awayParticipantId, null);
  assert.equal(final.knockoutSeed, null);
});

test("buildKnockoutStageMatches: ids deterministic and stable", () => {
  const byGroup = new Map([
    ["gA", standingsA()],
    ["gB", standingsB()],
  ]);
  const q = buildKnockoutQualifiers(GROUPS, byGroup, 2);
  const r1 = buildKnockoutStageMatches(q, TID);
  const r2 = buildKnockoutStageMatches(q, TID);
  assert.deepEqual(
    r1.map((r: KnockoutMatchInsertRow) => r.id),
    r2.map((r: KnockoutMatchInsertRow) => r.id),
  );
  assert.ok(r1.every((r) => r.id.startsWith("active:ko:r")));
});

test("buildKnockoutStageMatches: consolation has independent ids and kind", () => {
  const qualifiers = [
    { participantId: "a", groupId: "gA", groupPosition: 3 },
    { participantId: "b", groupId: "gB", groupPosition: 3 },
    { participantId: "c", groupId: "gC", groupPosition: 3 },
    { participantId: "d", groupId: "gD", groupPosition: 3 },
    { participantId: "e", groupId: "gA", groupPosition: 4 },
  ];
  const rows = buildKnockoutStageMatches(qualifiers, TID, "consolation");

  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.bracketKind === "consolation"));
  assert.ok(rows.every((row) => row.id.startsWith("active:consolation:ko:r")));
});

test("Los pibes: 12-18 players produce correct consolation fields and byes", () => {
  for (let totalPlayers = 12; totalPlayers <= 18; totalPlayers++) {
    const groupSizes = getGroupSizes(totalPlayers, 4);

    const groups = groupSizes.map((_, index) => ({
      id: `g${index}`,
      label: String.fromCharCode(65 + index),
    }));
    const standingsByGroup = new Map<string, ReturnType<typeof standingsA>>();
    const participants: Participant[] = [];
    let drawOrder = 1;

    groups.forEach((group, groupIndex) => {
      const rows = Array.from({ length: groupSizes[groupIndex] }, (_, index) => {
        const id = `${group.id}p${index + 1}`;
        participants.push(p(id, drawOrder++, group.id));
        return {
          participantId: id,
          position: index + 1,
          played: groupSizes[groupIndex] - 1,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
          unresolved: false,
        };
      });
      standingsByGroup.set(group.id, rows);
    });

    const consolation = buildConsolationQualifiers(
      groups,
      standingsByGroup,
      2,
      participants,
    );
    assert.equal(consolation.length, totalPlayers - 8);

    const rows = buildKnockoutStageMatches(
      consolation,
      TID,
      "consolation",
    );
    let bracketSize = 1;
    while (bracketSize < consolation.length) bracketSize *= 2;
    assert.equal(rows.length, bracketSize - 1);

    const firstRound = rows.filter((row) => row.id.includes(":ko:r0:"));
    const byes = firstRound.filter(
      (row) =>
        (row.homeParticipantId == null) !== (row.awayParticipantId == null),
    );
    assert.equal(byes.length, bracketSize - consolation.length);

    const groupByParticipant = new Map(
      participants.map((participant) => [participant.id, participant.groupId]),
    );
    for (const row of firstRound) {
      if (row.homeParticipantId && row.awayParticipantId) {
        assert.notEqual(
          groupByParticipant.get(row.homeParticipantId),
          groupByParticipant.get(row.awayParticipantId),
        );
      }
    }
  }
});

test("buildKnockoutStageMatches: empty when fewer than 2 qualifiers", () => {
  assert.deepEqual(buildKnockoutStageMatches([], TID), []);
  assert.deepEqual(
    buildKnockoutStageMatches(
      [{ participantId: "a", groupId: "g", groupPosition: 1 }],
      TID,
    ),
    [],
  );
});
