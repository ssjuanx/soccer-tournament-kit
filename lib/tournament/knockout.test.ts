import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advanceBracket,
  applyScores,
  bracketSize,
  bracketToMatches,
  buildSeedList,
  generateBracket,
  getChampion,
  knockoutMatchId,
  nextPowerOfTwo,
  parseKnockoutMatchId,
  roundNameForMatchCount,
  seedOrdering,
  type Qualifier,
} from "./knockout.ts";

const TOURNAMENT_ID = "active";

function qualifier(
  id: string,
  groupId: string,
  groupPosition: number,
): Qualifier {
  return { participantId: id, groupId, groupPosition };
}

// ---------------------------------------------------------------------------
// Bracket size & power of two
// ---------------------------------------------------------------------------

test("nextPowerOfTwo: rounds up to the next power of two", () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(3), 4);
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(8), 8);
  assert.equal(nextPowerOfTwo(9), 16);
  assert.equal(nextPowerOfTwo(12), 16);
  assert.equal(nextPowerOfTwo(16), 16);
});

test("nextPowerOfTwo: rejects non-positive / non-integer", () => {
  assert.throws(() => nextPowerOfTwo(0), /positive integer/);
  assert.throws(() => nextPowerOfTwo(-3), /positive integer/);
  assert.throws(() => nextPowerOfTwo(2.5), /positive integer/);
});

test("bracketSize: derives next power of two of qualifier count", () => {
  assert.equal(bracketSize(2), 2);
  assert.equal(bracketSize(4), 4);
  assert.equal(bracketSize(6), 8);
  assert.equal(bracketSize(11), 16);
  assert.equal(bracketSize(16), 16);
  assert.equal(bracketSize(33), 64);
});

test("bracketSize: rejects counts exceeding the max bracket", () => {
  assert.throws(() => bracketSize(65), /maximum supported size/);
// ---------------------------------------------------------------------------
// Round names
// ---------------------------------------------------------------------------

test("roundNameForMatchCount: maps match counts to round names", () => {
  assert.equal(roundNameForMatchCount(32), "round_of_64");
  assert.equal(roundNameForMatchCount(16), "round_of_32");
  assert.equal(roundNameForMatchCount(8), "round_of_16");
  assert.equal(roundNameForMatchCount(4), "quarter_final");
  assert.equal(roundNameForMatchCount(2), "semi_final");
  assert.equal(roundNameForMatchCount(1), "final");
});

test("roundNameForMatchCount: throws for unsupported counts", () => {
  assert.throws(() => roundNameForMatchCount(3), /Unsupported/);
});

// ---------------------------------------------------------------------------
// Seed ordering
// ---------------------------------------------------------------------------

test("seedOrdering: standard recursive seeding", () => {
  assert.deepEqual(seedOrdering(2), [1, 2]);
  assert.deepEqual(seedOrdering(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrdering(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("seedOrdering: home slot is always the lower (better) seed", () => {
  const order = seedOrdering(16);
  for (let i = 0; i < order.length; i += 2) {
    assert.ok(
      order[i] < order[i + 1],
      `slot ${i} (seed ${order[i]}) should be lower than slot ${i + 1} (seed ${order[i + 1]})`,
    );
  }
});

test("seedOrdering: rejects non-power-of-two sizes", () => {
  assert.throws(() => seedOrdering(3), /power of two/);
  assert.throws(() => seedOrdering(6), /power of two/);
});

// ---------------------------------------------------------------------------
// Seed list
// ---------------------------------------------------------------------------

test("buildSeedList: orders tiers by groupPosition, preserving intra-tier order", () => {
  const qualifiers = [
    qualifier("A2", "A", 2),
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("B2", "B", 2),
  ];
  const seeded = buildSeedList(qualifiers);
  assert.deepEqual(
    seeded.map((q) => q.participantId),
    ["A1", "B1", "A2", "B2"],
  );
});

// ---------------------------------------------------------------------------
// Match ids
// ---------------------------------------------------------------------------

test("knockoutMatchId / parseKnockoutMatchId: round-trip", () => {
  const id = knockoutMatchId(TOURNAMENT_ID, 2, 3);
  assert.equal(id, "active:ko:r2:m3");
  assert.deepEqual(parseKnockoutMatchId(id), { roundIndex: 2, matchIndex: 3 });
});

test("parseKnockoutMatchId: rejects non-knockout ids", () => {
  assert.throws(() => parseKnockoutMatchId("active:group:A-0-1"), /Not a knockout/);
});
// ---------------------------------------------------------------------------
// generateBracket: structure
// ---------------------------------------------------------------------------

test("generateBracket: 4 qualifiers -> 2 rounds (semi + final), 3 matches", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  assert.equal(bracket.length, 3);
  assert.equal(bracket.filter((m) => m.roundIndex === 0).length, 2);
  assert.equal(bracket.filter((m) => m.roundIndex === 1).length, 1);
  assert.equal(bracket[0].knockoutRound, "semi_final");
  assert.equal(bracket[2].knockoutRound, "final");
  assert.ok(bracket.every((m) => m.score === null));
});

test("generateBracket: every round-0 participant is filled (no TBD in round 0)", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
    qualifier("D1", "D", 1),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  for (const m of bracket.filter((x) => x.roundIndex === 0)) {
    assert.ok(m.home.participantId != null, "round-0 home should be filled");
    assert.ok(m.away.participantId != null, "round-0 away should be filled");
  }
});

test("generateBracket: later rounds start fully TBD", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const final = bracket.find((m) => m.roundIndex === 1)!;
  assert.equal(final.home.participantId, null);
  assert.equal(final.away.participantId, null);
  assert.equal(final.home.seed, null);
});

test("generateBracket: home is always the higher (lower-numbered) seed", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  for (const m of bracket.filter((x) => x.roundIndex === 0)) {
    if (m.home.seed != null && m.away.seed != null) {
      assert.ok(m.home.seed < m.away.seed, "home should be the better seed");
    }
  }
});

test("generateBracket: rejects fewer than 2 qualifiers", () => {
  assert.throws(
    () => generateBracket([qualifier("A1", "A", 1)], TOURNAMENT_ID),
    /at least 2/,
  );
});
// ---------------------------------------------------------------------------
// Byes
// ---------------------------------------------------------------------------

test("generateBracket: byes go to the highest seeds", () => {
  // 3 qualifiers -> bracket size 4 -> 1 bye, awarded to seed 1.
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const round0 = bracket.filter((m) => m.roundIndex === 0);
  const byes = round0.filter(
    (m) =>
      (m.home.participantId == null) !== (m.away.participantId == null),
  );
  assert.equal(byes.length, 1);
  const bye = byes[0];
  const realSeed =
    bye.home.participantId != null ? bye.home.seed : bye.away.seed;
  assert.equal(realSeed, 1);
});

test("generateBracket: 5 qualifiers -> bracket 8 -> 3 byes to seeds 1, 2, 3", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
    qualifier("D1", "D", 1),
    qualifier("E1", "E", 1),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const round0 = bracket.filter((m) => m.roundIndex === 0);
  const byeSeeds = round0
    .filter(
      (m) =>
        (m.home.participantId == null) !== (m.away.participantId == null),
    )
    .map((m) =>
      m.home.participantId != null ? m.home.seed! : m.away.seed!,
    )
    .sort((a, b) => a - b);
  assert.deepEqual(byeSeeds, [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Same-group round-1 rematch avoidance
// ---------------------------------------------------------------------------

test("generateBracket: no same-group round-1 rematch (2 groups x 2 qualifiers)", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  for (const m of bracket.filter((x) => x.roundIndex === 0)) {
    if (m.home.participantId == null || m.away.participantId == null) continue;
    assert.notEqual(
      m.home.groupId,
      m.away.groupId,
      `round-1 rematch within group ${m.home.groupId}`,
    );
  }
});

test("generateBracket: no same-group round-1 rematch (3 groups x 2 qualifiers)", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
    qualifier("C2", "C", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  for (const m of bracket.filter((x) => x.roundIndex === 0)) {
    if (m.home.participantId == null || m.away.participantId == null) continue;
    assert.notEqual(m.home.groupId, m.away.groupId, "round-1 rematch");
  }
});

test("generateBracket: rematch avoidance keeps byes with the top seeds", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
    qualifier("D1", "D", 1),
    qualifier("A2", "A", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const round0 = bracket.filter((m) => m.roundIndex === 0);
  const byeSeeds = round0
    .filter(
      (m) =>
        (m.home.participantId == null) !== (m.away.participantId == null),
    )
    .map((m) =>
      m.home.participantId != null ? m.home.seed! : m.away.seed!,
    )
    .sort((a, b) => a - b);
  assert.deepEqual(byeSeeds, [1, 2, 3]);
});
// ---------------------------------------------------------------------------
// Advancement
// ---------------------------------------------------------------------------

test("advanceBracket: bye auto-advances the real side without a score", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const advanced = advanceBracket(bracket);
  const final = advanced.find((m) => m.roundIndex === 1)!;
  assert.equal(final.home.seed, 1);
  assert.equal(final.home.participantId, "A1");
});

test("advanceBracket: winner of a played match feeds the next round", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const semi0 = bracket.find((m) => m.roundIndex === 0 && m.matchIndex === 0)!;
  const semi1 = bracket.find((m) => m.roundIndex === 0 && m.matchIndex === 1)!;
  const scored = applyScores(
    bracket,
    new Map([
      [semi0.id, { home: 2, away: 0 }],
      [semi1.id, { home: 1, away: 3 }],
    ]),
  );
  const advanced = advanceBracket(scored);
  const final = advanced.find((m) => m.roundIndex === 1)!;
  assert.equal(final.home.participantId, "A1");
  assert.equal(final.away.participantId, "A2");
});

test("advanceBracket: TBD slots stay null until the feeding match is decided", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const advanced = advanceBracket(bracket); // no scores
  const final = advanced.find((m) => m.roundIndex === 1)!;
  assert.equal(final.home.participantId, null);
  assert.equal(final.away.participantId, null);
});

test("advanceBracket: does not mutate the input", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("C1", "C", 1),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const snapshot = JSON.stringify(bracket);
  advanceBracket(bracket);
  assert.equal(JSON.stringify(bracket), snapshot);
});

// ---------------------------------------------------------------------------
// Champion
// ---------------------------------------------------------------------------

test("getChampion: null until the final is decided", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  assert.equal(getChampion(advanceBracket(bracket)), null);
});

test("getChampion: the final winner once decided", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const semi0 = bracket.find((m) => m.roundIndex === 0 && m.matchIndex === 0)!;
  const semi1 = bracket.find((m) => m.roundIndex === 0 && m.matchIndex === 1)!;
  const afterSemis = advanceBracket(
    applyScores(
      bracket,
      new Map([
        [semi0.id, { home: 2, away: 0 }],
        [semi1.id, { home: 1, away: 3 }],
      ]),
    ),
  );
  const final = afterSemis.find((m) => m.roundIndex === 1)!;
  const afterFinal = advanceBracket(
    applyScores(afterSemis, new Map([[final.id, { home: 0, away: 1 }]])),
  );
  // final home = A1, away = A2; away wins 0-1.
  assert.equal(getChampion(afterFinal), "A2");
});

// ---------------------------------------------------------------------------
// Conversion to persisted Match[]
// ---------------------------------------------------------------------------

test("bracketToMatches: flattens to knockout domain matches", () => {
  const qualifiers = [
    qualifier("A1", "A", 1),
    qualifier("B1", "B", 1),
    qualifier("A2", "A", 2),
    qualifier("B2", "B", 2),
  ];
  const bracket = generateBracket(qualifiers, TOURNAMENT_ID);
  const matches = bracketToMatches(bracket);
  assert.ok(matches.every((m) => m.stage === "knockout"));
  assert.ok(matches.every((m) => m.groupId === null));
  assert.ok(matches.every((m) => m.knockoutRound !== null));
  const semi = matches.find(
    (m) => m.knockoutRound === "semi_final" && m.homeParticipantId === "A1",
  );
  assert.ok(semi);
  assert.equal(semi!.knockoutSeed, 1);
});
});