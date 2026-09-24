import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupStageMatches,
  isReadyForFixtures,
  isStructurallyLocked,
  parseScore,
  type MatchInsertRow,
} from "./fixtures.ts";
import type { TournamentSetupSnapshot } from "./setup.ts";

// ---------------------------------------------------------------------------
// Snapshot fixtures
// ---------------------------------------------------------------------------

function snapshot(
  participantCount: number,
  groupCount: number,
  participantNames: string[],
): TournamentSetupSnapshot {
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    id: `t:group:${String.fromCharCode(65 + i)}`,
    label: String.fromCharCode(65 + i),
  }));
  // Even distribution: larger groups first, matching getGroupSizes semantics.
  const base = Math.floor(participantCount / groupCount);
  const remainder = participantCount % groupCount;
  const sizes = Array.from(
    { length: groupCount },
    (_, i) => base + (i < remainder ? 1 : 0),
  );
  const participants = participantNames.map((name, index) => {
    const drawOrder = index + 1;
    let cumulative = 0;
    let groupIndex = 0;
    for (let i = 0; i < sizes.length; i++) {
      cumulative += sizes[i];
      if (drawOrder <= cumulative) {
        groupIndex = i;
        break;
      }
    }
    return {
      id: `t:participant:${drawOrder}`,
      name,
      drawOrder,
      teamName: null,
      groupId: groups[groupIndex].id,
    };
  });
  return {
    tournament: {
      id: "t",
      name: "T",
      edition: null,
      date: null,
      description: null,
      participantCount,
      groupCount,
      status: "draft",
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tiebreakerOrder: ["goal_difference", "goals_for"],
    },
    groups,
    participants,
    manualResolutions: [],
  };
}

// ---------------------------------------------------------------------------
// isReadyForFixtures
// ---------------------------------------------------------------------------

test("isReadyForFixtures: false when no tournament", () => {
  const snap: TournamentSetupSnapshot = {
    tournament: null,
    groups: [],
    participants: [],
    manualResolutions: [],
  };
  assert.equal(isReadyForFixtures(snap), false);
});

test("isReadyForFixtures: false when a group has fewer than 2 participants", () => {
  // 4 participants, 4 groups -> [1,1,1,1]: every group has 1.
  const snap = snapshot(4, 4, ["A", "B", "C", "D"]);
  assert.equal(isReadyForFixtures(snap), false);
});

test("isReadyForFixtures: true when every group has at least 2", () => {
  // 4 participants, 2 groups -> [2,2].
  const snap = snapshot(4, 2, ["A", "B", "C", "D"]);
  assert.equal(isReadyForFixtures(snap), true);
});

test("isReadyForFixtures: true for a realistic 14/4 setup", () => {
  const names = Array.from({ length: 14 }, (_, i) => `P${i + 1}`);
  const snap = snapshot(14, 4, names);
  assert.equal(isReadyForFixtures(snap), true);
// ---------------------------------------------------------------------------
// buildGroupStageMatches
// ---------------------------------------------------------------------------

test("buildGroupStageMatches: empty when no tournament", () => {
  assert.deepEqual(
    buildGroupStageMatches({
      tournament: null,
      groups: [],
      participants: [],
      manualResolutions: [],
    }),
    [],
  );
});

test("buildGroupStageMatches: produces n*(n-1)/2 matches per group", () => {
  // 4 participants, 2 groups -> [2,2]: 1 match per group = 2 total.
  const snap = snapshot(4, 2, ["A", "B", "C", "D"]);
  const rows = buildGroupStageMatches(snap);
  assert.equal(rows.length, 2);
});

test("buildGroupStageMatches: 14/4 produces 6+6+3+3 = 18 matches", () => {
  const names = Array.from({ length: 14 }, (_, i) => `P${i + 1}`);
  const snap = snapshot(14, 4, names);
  const rows = buildGroupStageMatches(snap);
  assert.equal(rows.length, 6 + 6 + 3 + 3);
});

test("buildGroupStageMatches: rows are group-stage, unscored, knockoutRound null", () => {
  const snap = snapshot(4, 2, ["A", "B", "C", "D"]);
  const rows = buildGroupStageMatches(snap);
  for (const row of rows) {
    assert.equal(row.stage, "group");
    assert.equal(row.knockoutRound, null);
    assert.equal(row.homeScore, null);
    assert.equal(row.awayScore, null);
    assert.equal(row.tournamentId, "t");
    assert.ok(typeof row.groupId === "string");
    assert.ok(typeof row.homeParticipantId === "string");
    assert.ok(typeof row.awayParticipantId === "string");
  }
});

test("buildGroupStageMatches: ids are stable and index-based", () => {
  // Group A has participants [t:participant:1, t:participant:2] -> id t:group:A-0-1
  const snap = snapshot(4, 2, ["A", "B", "C", "D"]);
  const rows = buildGroupStageMatches(snap);
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ["t:group:A-0-1", "t:group:B-0-1"]);
});

test("buildGroupStageMatches: deterministic for the same snapshot (idempotent)", () => {
  const names = Array.from({ length: 14 }, (_, i) => `P${i + 1}`);
  const snap = snapshot(14, 4, names);
  const a = buildGroupStageMatches(snap);
  const b = buildGroupStageMatches(snap);
  assert.deepEqual(a, b);
});

test("buildGroupStageMatches: rows satisfy the MatchInsertRow shape", () => {
  const snap = snapshot(3, 1, ["A", "B", "C"]);
  const rows = buildGroupStageMatches(snap);
  // 3 participants -> 3 matches, all in group A.
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const _: MatchInsertRow = row; // type-level check
    void _;
    assert.equal(row.groupId, "t:group:A");
  }
});

// ---------------------------------------------------------------------------
// parseScore
// ---------------------------------------------------------------------------

test("parseScore: both blank -> null", () => {
  assert.equal(parseScore("", ""), null);
  assert.equal(parseScore("  ", "\t"), null);
});

test("parseScore: valid non-negative integers -> MatchScore", () => {
  assert.deepEqual(parseScore("2", "1"), { home: 2, away: 1 });
  assert.deepEqual(parseScore(" 0 ", "0 "), { home: 0, away: 0 });
  assert.deepEqual(parseScore("10", "7"), { home: 10, away: 7 });
});

test("parseScore: rejects a partial score", () => {
  assert.throws(() => parseScore("2", ""), /both sides/);
  assert.throws(() => parseScore("", "2"), /both sides/);
});

test("parseScore: rejects negatives", () => {
  assert.throws(() => parseScore("-1", "2"), /non-negative|whole number/);
  assert.throws(() => parseScore("2", "-3"), /non-negative|whole number/);
});

test("parseScore: rejects fractions and non-numeric text", () => {
  assert.throws(() => parseScore("1.5", "2"), /whole number/);
  assert.throws(() => parseScore("foo", "2"), /whole number/);
});

// ---------------------------------------------------------------------------
// isStructurallyLocked
// ---------------------------------------------------------------------------

test("isStructurallyLocked: false when no matches", () => {
  assert.equal(isStructurallyLocked([]), false);
});

test("isStructurallyLocked: true when any matches exist", () => {
  const match = {
    id: "g-0-1",
    stage: "group" as const,
    groupId: "g",
    knockoutRound: null,
    homeParticipantId: "a",
    awayParticipantId: "b",
    score: null,
  };
  assert.equal(isStructurallyLocked([match]), true);
});
});