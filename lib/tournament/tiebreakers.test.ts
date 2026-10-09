import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateStandings, DEFAULT_SCORING_CONFIG } from "./standings.ts";
import { buildHeadToHeadMiniStandings, cohortKeyOf } from "./tiebreakers.ts";
import type {
  Match,
  ManualTiebreakResolution,
  Participant,
  ScoringConfig,
} from "./types.ts";

function participant(
  id: string,
  drawOrder: number,
  groupId: string | null = null,
): Participant {
  return { id, name: id, drawOrder, assignedTeamId: null, groupId };
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

function unplayedMatch(groupId: string, home: string, away: string): Match {
  return {
    id: `${groupId}-${home}-${away}`,
    stage: "group",
    groupId,
    knockoutRound: null,
    homeParticipantId: home,
    awayParticipantId: away,
    score: null,
  };
}

const SCORING: ScoringConfig = DEFAULT_SCORING_CONFIG;

// ---------------------------------------------------------------------------
// buildHeadToHeadMiniStandings
// ---------------------------------------------------------------------------

test("buildHeadToHeadMiniStandings: two-player mini-table points", () => {
  const matches = [groupMatch("A", "a", "b", 2, 0)];
  const mini = buildHeadToHeadMiniStandings(["a", "b"], matches, SCORING);
  assert.notEqual(mini, null);
  assert.equal(mini!.get("a")!.points, 3);
  assert.equal(mini!.get("b")!.points, 0);
});

test("buildHeadToHeadMiniStandings: three-player round-robin", () => {
  // a beats b, b beats c, a beats c -> a 6, b 3, c 0
  const matches = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "b", "c", 2, 0),
    groupMatch("A", "a", "c", 3, 0),
  ];
  const mini = buildHeadToHeadMiniStandings(["a", "b", "c"], matches, SCORING);
  assert.notEqual(mini, null);
  assert.equal(mini!.get("a")!.points, 6);
  assert.equal(mini!.get("b")!.points, 3);
  assert.equal(mini!.get("c")!.points, 0);
});

test("buildHeadToHeadMiniStandings: null when a pair is unplayed", () => {
  // a-b and b-c played, a-c missing -> incomplete mini-league.
  const matches = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "b", "c", 2, 0),
  ];
  const mini = buildHeadToHeadMiniStandings(["a", "b", "c"], matches, SCORING);
  assert.equal(mini, null);
});

test("buildHeadToHeadMiniStandings: ignores matches with non-cohort members", () => {
  // a-b-c form the cohort; d's matches against them must not count toward the
  // mini stats, and the a-c pair is played so coverage is complete.
  const matches = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "b", "c", 0, 0),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "a", "d", 5, 0), // d not in cohort -> ignored
  ];
  const mini = buildHeadToHeadMiniStandings(["a", "b", "c"], matches, SCORING);
  assert.notEqual(mini, null);
  assert.equal(mini!.get("a")!.goalsFor, 1); // only the a-b goal counts
});

test("buildHeadToHeadMiniStandings: draw yields equal mini points", () => {
  const matches = [groupMatch("A", "a", "b", 1, 1)];
  const mini = buildHeadToHeadMiniStandings(["a", "b"], matches, SCORING);
  assert.notEqual(mini, null);
  assert.equal(mini!.get("a")!.points, 1);
  assert.equal(mini!.get("b")!.points, 1);
});

// ---------------------------------------------------------------------------
// Head-to-head tiebreaker via calculateStandings
// ---------------------------------------------------------------------------

test("calculateStandings: head_to_head breaks a two-player points tie", () => {
  // a & b tied at 6 pts (a beat b head-to-head); c & d tied at 3 pts (c beat d).
  const pp = [
    participant("a", 2, "A"),
    participant("b", 1, "A"),
    participant("c", 3, "A"),
    participant("d", 4, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 0), // a beats b (H2H decider)
    groupMatch("A", "a", "c", 1, 0), // a beats c
    groupMatch("A", "b", "c", 1, 0), // b beats c
    groupMatch("A", "a", "d", 0, 1), // d beats a
    groupMatch("A", "b", "d", 1, 0), // b beats d
    groupMatch("A", "c", "d", 1, 0), // c beats d
  ];
  // a: W2 L1 = 6; b: W2 L1 = 6; c: W1 L2 = 3; d: W1 L2 = 3.
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["head_to_head"],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["a", "b", "c", "d"],
  );
  assert.equal(standings[0].unresolved, false);
  assert.equal(standings[1].unresolved, false);
});

test("calculateStandings: head_to_head three-way mini-table splits cohort", () => {
  // a,b,c all finish on 7 pts; their mutual results give mini a6 b3 c0.
  const P = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
    participant("d", 4, "A"),
    participant("e", 5, "A"),
    participant("f", 6, "A"),
  ];
  const G = [
    // mutual: a>b, a>c, b>c  (mini among {a,b,c}: a6 b3 c0)
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
    // a,b,c all lose to d
    groupMatch("A", "a", "d", 0, 1),
    groupMatch("A", "b", "d", 0, 1),
    groupMatch("A", "c", "d", 0, 1),
    // a,b,c all beat e
    groupMatch("A", "a", "e", 1, 0),
    groupMatch("A", "b", "e", 1, 0),
    groupMatch("A", "c", "e", 1, 0),
    // a,b,c all draw f
    groupMatch("A", "a", "f", 0, 0),
    groupMatch("A", "b", "f", 0, 0),
    groupMatch("A", "c", "f", 0, 0),
    // d,e,f among themselves (do not interfere with the a,b,c tier)
    groupMatch("A", "d", "e", 1, 0),
    groupMatch("A", "d", "f", 1, 0),
    groupMatch("A", "e", "f", 1, 0),
  ];
  // a,b,c each: mutual 1W1L = 3, loss to d = 0, win over e = 3, draw f = 1 -> 7 pts.
  const st = calculateStandings(G, P, {
    tiebreakerOrder: ["head_to_head"],
  });
  const abc = st.filter((r) => ["a", "b", "c"].includes(r.participantId));
  assert.deepEqual(abc.map((r) => r.participantId), ["a", "b", "c"]);
  assert.ok(abc[0].position < abc[1].position);
  assert.ok(abc[1].position < abc[2].position);
});

test("calculateStandings: head_to_head cycle falls through to draw order", () => {
  // a>b, b>c, c>a -> all 3 pts; mini points all 3 -> H2H can't split.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
    groupMatch("A", "c", "a", 1, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["head_to_head"],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["a", "b", "c"], // draw order fallback
  );
});

test("calculateStandings: head_to_head skipped when mini-league incomplete", () => {
  // a & b tied on points but their mutual match is unplayed -> H2H skipped.
  const pp = [
    participant("a", 2, "A"),
    participant("b", 1, "A"),
    participant("c", 3, "A"),
  ];
  const gg: Match[] = [
    unplayedMatch("A", "a", "b"),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["head_to_head"],
  });
  // H2H skipped -> draw order: b(1) before a(2).
  assert.equal(standings[0].participantId, "b");
  assert.equal(standings[1].participantId, "a");
});
// ---------------------------------------------------------------------------
// Manual tiebreaker
// ---------------------------------------------------------------------------

test("calculateStandings: manual resolution orders a tied cohort", () => {
  // a,b,c all draw each other -> all 2 pts; manual order says b, a, c.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b,c", participantOrder: ["b", "a", "c"] },
    ],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["b", "a", "c"],
  );
  assert.equal(standings.every((r) => !r.unresolved), true);
});

test("calculateStandings: manual without resolution leaves cohort unresolved", () => {
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [],
  });
  assert.equal(standings.length, 3);
  for (const row of standings) {
    assert.equal(row.unresolved, true);
    assert.equal(row.position, 1);
  }
});

test("calculateStandings: manual resolution missing a cohort member -> unresolved", () => {
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b,c", participantOrder: ["b", "a"] },
    ],
  });
  for (const row of standings) {
    assert.equal(row.unresolved, true);
    assert.equal(row.position, 1);
  }
});

test("calculateStandings: unresolved cohort shares position (1224-style)", () => {
  // a & b tied top (4 pts, unresolved); c clear last (0 pts).
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [],
  });
  const row = (id: string) => standings.find((r) => r.participantId === id)!;
  assert.equal(row("a").position, 1);
  assert.equal(row("b").position, 1);
  assert.equal(row("a").unresolved, true);
  assert.equal(row("b").unresolved, true);
  assert.equal(row("c").position, 3); // skipped past the shared 1-1
  assert.equal(row("c").unresolved, false);
});

test("calculateStandings: manual resolution for a different group is ignored", () => {
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "B", cohortKey: "a,b,c", participantOrder: ["b", "a", "c"] },
    ],
  });
  for (const row of standings) {
    assert.equal(row.unresolved, true);
  }
});
test("calculateStandings: no manual tiebreaker -> never unresolved", () => {
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["goal_difference", "goals_for"],
    manualResolutions: [],
  });
  assert.equal(standings.every((r) => !r.unresolved), true);
  assert.deepEqual(
    [...standings.map((r) => r.position)].sort((a, b) => a - b),
    [1, 2, 3],
  );
});

test("calculateStandings: H2H resolves before manual is reached", () => {
  // Clean two-way setup: a & b tied at 6 (a beat b), c & d tied at 3 (c beat d).
  // H2H splits both cohorts, so manual is never reached and no unresolved flag
  // appears even with no manual resolution stored.
  const pp = [
    participant("a", 2, "A"),
    participant("b", 1, "A"),
    participant("c", 3, "A"),
    participant("d", 4, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 0),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
    groupMatch("A", "a", "d", 0, 1),
    groupMatch("A", "b", "d", 1, 0),
    groupMatch("A", "c", "d", 1, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["head_to_head", "manual"],
    manualResolutions: [],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["a", "b", "c", "d"],
  );
  assert.equal(standings.every((r) => !r.unresolved), true);
});

test("calculateStandings: manual after a failing statistical tiebreaker", () => {
  // a,b,c all 2 pts and identical GD -> GD fails -> manual decides.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "c", 1, 1),
    groupMatch("A", "b", "c", 1, 1),
    groupMatch("A", "a", "b", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["goal_difference", "manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b,c", participantOrder: ["c", "a", "b"] },
    ],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["c", "a", "b"],
  );
});

test("calculateStandings: manual fully resolves into positions 1..n", () => {
  // Two tiers: a,b tied top (4 pts), c,d tied bottom (1 pt).
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
    participant("d", 4, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "a", "d", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
    groupMatch("A", "b", "d", 1, 0),
    groupMatch("A", "c", "d", 1, 1),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b", participantOrder: ["b", "a"] },
      { groupId: "A", cohortKey: "c,d", participantOrder: ["d", "c"] },
    ],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["b", "a", "d", "c"],
  );
  assert.deepEqual(
    standings.map((r) => r.position),
    [1, 2, 3, 4],
  );
});

test("calculateStandings: groupId derived from participants for manual lookup", () => {
  const pp = [participant("a", 1, "A"), participant("b", 2, "A")];
  const gg = [groupMatch("A", "a", "b", 1, 1)]; // both 1 pt, equal -> manual decides
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b", participantOrder: ["b", "a"] },
    ],
  });
  assert.deepEqual(
    standings.map((r) => r.participantId),
    ["b", "a"],
  );
});

// ---------------------------------------------------------------------------
// Cohort-scoped manual tiebreak (Phase 3)
// ---------------------------------------------------------------------------

test("calculateStandings: manual resolution is cohort-scoped within a group", () => {
  // Two cohorts in group A: {a,b} tied top (4 pts), {c,d} tied bottom (1 pt).
  // Only the top cohort has a stored resolution; the bottom one stays unresolved.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
    participant("d", 4, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 1, 0),
    groupMatch("A", "a", "d", 1, 0),
    groupMatch("A", "b", "c", 1, 0),
    groupMatch("A", "b", "d", 1, 0),
    groupMatch("A", "c", "d", 1, 1),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "a,b", participantOrder: ["b", "a"] },
    ],
  });
  const row = (id: string) => standings.find((r) => r.participantId === id)!;
  // Top cohort resolved by the stored order.
  assert.equal(row("b").position, 1);
  assert.equal(row("a").position, 2);
  assert.equal(row("b").unresolved, false);
  assert.equal(row("a").unresolved, false);
  // Bottom cohort has no resolution -> unresolved, shared position 3.
  assert.equal(row("c").position, 3);
  assert.equal(row("d").position, 3);
  assert.equal(row("c").unresolved, true);
  assert.equal(row("d").unresolved, true);
});

test("calculateStandings: manual resolution with the wrong cohort key is ignored", () => {
  // a,b,c all draw -> one cohort {a,b,c}. A resolution stored under a different
  // cohort key (even in the right group) must not resolve it.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      // Wrong cohort key for the {a,b,c} cohort.
      { groupId: "A", cohortKey: "a,b", participantOrder: ["b", "a", "c"] },
    ],
  });
  for (const row of standings) {
    assert.equal(row.unresolved, true);
    assert.equal(row.position, 1);
  }
});

test("calculateStandings: manual resolution with an empty cohort key is ignored (legacy)", () => {
  // Legacy group-scoped rows carried no cohort key. The resolver must treat an
  // empty cohort key as "no resolution" so stale rows never resolve a cohort.
  const pp = [
    participant("a", 1, "A"),
    participant("b", 2, "A"),
    participant("c", 3, "A"),
  ];
  const gg = [
    groupMatch("A", "a", "b", 1, 1),
    groupMatch("A", "a", "c", 0, 0),
    groupMatch("A", "b", "c", 0, 0),
  ];
  const standings = calculateStandings(gg, pp, {
    tiebreakerOrder: ["manual"],
    manualResolutions: [
      { groupId: "A", cohortKey: "", participantOrder: ["b", "a", "c"] },
    ],
  });
  for (const row of standings) {
    assert.equal(row.unresolved, true);
    assert.equal(row.position, 1);
  }
});

test("calculateStandings: cohortKeyOf is order-independent and sorted", () => {
  // Exported helper: same members in any input order produce the same key.
  assert.equal(cohortKeyOf(["c", "a", "b"]), "a,b,c");
  assert.equal(cohortKeyOf(["a", "b", "c"]), "a,b,c");
  assert.equal(cohortKeyOf(["b"]), "b");
  assert.equal(cohortKeyOf([]), "");
});