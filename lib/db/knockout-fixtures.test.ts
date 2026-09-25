import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateStandings } from "../tournament/standings.ts";
import type { Match, Participant } from "../tournament/types.ts";
import {
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