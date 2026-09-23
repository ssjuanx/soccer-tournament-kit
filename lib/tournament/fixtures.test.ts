import { test } from "node:test";
import assert from "node:assert/strict";

import { generateGroupFixtures } from "./fixtures.ts";
import type { Match } from "./types.ts";

function matchIds(matches: Match[]): string[] {
  return matches.map((m) => m.id);
}

test("generateGroupFixtures: counts follow n*(n-1)/2", () => {
  assert.equal(generateGroupFixtures(["a", "b", "c"], "A").length, 3);
  assert.equal(generateGroupFixtures(["a", "b", "c", "d"], "A").length, 6);
  assert.equal(
    generateGroupFixtures(["a", "b", "c", "d", "e"], "A").length,
    10,
  );
});

test("generateGroupFixtures: produces no self-matches and no duplicate pairings", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const matches = generateGroupFixtures(ids, "A");
    const pairs = matches.map((m) => [m.homeParticipantId, m.awayParticipantId]);
    // No self-matches.
    for (const [h, a] of pairs) {
      assert.notEqual(h, a);
    }
    // No duplicate unordered pairings.
    const seen = new Set<string>();
    for (const [h, a] of pairs) {
      const key = [h, a].sort().join("|");
      assert.ok(!seen.has(key), `duplicate pairing ${key}`);
      seen.add(key);
    }
    assert.equal(seen.size, (n * (n - 1)) / 2);
  }
});

test("generateGroupFixtures: every participant plays every other exactly once", () => {
  const ids = ["a", "b", "c", "d"];
  const matches = generateGroupFixtures(ids, "A");
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const found = matches.some(
        (m) =>
          (m.homeParticipantId === ids[i] && m.awayParticipantId === ids[j]) ||
          (m.homeParticipantId === ids[j] && m.awayParticipantId === ids[i]),
      );
      assert.ok(found, `${ids[i]} vs ${ids[j]} should be scheduled`);
    }
  }
});

test("generateGroupFixtures: matches are group-stage, unscored, knockoutRound null", () => {
  const matches = generateGroupFixtures(["a", "b", "c"], "B");
  for (const m of matches) {
    assert.equal(m.stage, "group");
    assert.equal(m.groupId, "B");
    assert.equal(m.knockoutRound, null);
    assert.equal(m.score, null);
    assert.ok(typeof m.homeParticipantId === "string");
    assert.ok(typeof m.awayParticipantId === "string");
  }
});

test("generateGroupFixtures: is deterministic for the same input", () => {
  const a = generateGroupFixtures(["x", "y", "z"], "A");
  const b = generateGroupFixtures(["x", "y", "z"], "A");
  assert.deepEqual(matchIds(a), matchIds(b));
});

test("generateGroupFixtures: ids differ across groups", () => {
  const a = generateGroupFixtures(["x", "y", "z"], "A");
  const b = generateGroupFixtures(["x", "y", "z"], "B");
  assert.notDeepEqual(matchIds(a), matchIds(b));
});

test("generateGroupFixtures: rejects duplicates and empty ids", () => {
  assert.throws(() => generateGroupFixtures(["a", "a"], "A"), /Duplicate/);
  assert.throws(() => generateGroupFixtures(["a", ""], "A"), /non-empty/);
  assert.throws(() => generateGroupFixtures(["a", "b"], ""), /groupId/);
});