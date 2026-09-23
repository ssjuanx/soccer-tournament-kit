import { test } from "node:test";
import assert from "node:assert/strict";

import { getGroupSizes, getGroupIndexForDrawOrder } from "./groups.ts";

// ---------------------------------------------------------------------------
// getGroupSizes
// ---------------------------------------------------------------------------

test("getGroupSizes: splits evenly when divisible", () => {
  assert.deepEqual(getGroupSizes(8, 2), [4, 4]);
  assert.deepEqual(getGroupSizes(16, 4), [4, 4, 4, 4]);
  assert.deepEqual(getGroupSizes(64, 8), [8, 8, 8, 8, 8, 8, 8, 8]);
});

test("getGroupSizes: puts larger groups first when uneven", () => {
  assert.deepEqual(getGroupSizes(13, 4), [4, 3, 3, 3]);
  assert.deepEqual(getGroupSizes(14, 4), [4, 4, 3, 3]);
  assert.deepEqual(getGroupSizes(15, 4), [4, 4, 4, 3]);
});

test("getGroupSizes: single group holds everyone", () => {
  assert.deepEqual(getGroupSizes(7, 1), [7]);
});

test("getGroupSizes: sum of sizes equals participant count", () => {
  const cases: Array<[number, number]> = [
    [13, 4],
    [14, 4],
    [15, 4],
    [10, 3],
    [37, 6],
  ];
  for (const [n, g] of cases) {
    const sizes = getGroupSizes(n, g);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `sum for (${n}, ${g})`);
    assert.equal(sizes.length, g);
    // Sizes differ by at most 1.
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    assert.ok(max - min <= 1, `sizes differ by at most 1 for (${n}, ${g})`);
  }
});

test("getGroupSizes: rejects invalid inputs", () => {
  assert.throws(() => getGroupSizes(0, 2), /positive/);
  assert.throws(() => getGroupSizes(-1, 2), /positive/);
  assert.throws(() => getGroupSizes(8, 0), /positive/);
  assert.throws(() => getGroupSizes(8, -1), /positive/);
  assert.throws(() => getGroupSizes(8.5, 2), /integer/);
  assert.throws(() => getGroupSizes(8, 2.5), /integer/);
  // More groups than participants would create empty groups.
  assert.throws(() => getGroupSizes(2, 3), /cannot exceed/);
});

// ---------------------------------------------------------------------------
// getGroupIndexForDrawOrder
// ---------------------------------------------------------------------------

test("getGroupIndexForDrawOrder: assigns slots in order", () => {
  const sizes = getGroupSizes(14, 4); // [4, 4, 3, 3]
  const expected: Array<[number, number]> = [
    [1, 0],
    [4, 0],
    [5, 1],
    [8, 1],
    [9, 2],
    [11, 2],
    [12, 3],
    [14, 3],
  ];
  for (const [draw, group] of expected) {
    assert.equal(
      getGroupIndexForDrawOrder(draw, sizes),
      group,
      `draw ${draw} -> group ${group}`,
    );
  }
});

test("getGroupIndexForDrawOrder: works for evenly split groups", () => {
  const sizes = getGroupSizes(8, 2); // [4, 4]
  assert.equal(getGroupIndexForDrawOrder(1, sizes), 0);
  assert.equal(getGroupIndexForDrawOrder(4, sizes), 0);
  assert.equal(getGroupIndexForDrawOrder(5, sizes), 1);
  assert.equal(getGroupIndexForDrawOrder(8, sizes), 1);
});

test("getGroupIndexForDrawOrder: rejects out-of-range and invalid draw orders", () => {
  const sizes = getGroupSizes(14, 4); // total 14
  assert.throws(() => getGroupIndexForDrawOrder(0, sizes), /at least 1/);
  assert.throws(() => getGroupIndexForDrawOrder(15, sizes), /out of range/);
  assert.throws(() => getGroupIndexForDrawOrder(2.5, sizes), /integer/);
  assert.throws(() => getGroupIndexForDrawOrder(1, []), /at least one group/);
});

test("getGroupIndexForDrawOrder: every slot maps to a valid group", () => {
  const sizes = getGroupSizes(13, 4); // [4, 3, 3, 3]
  for (let draw = 1; draw <= 13; draw++) {
    const group = getGroupIndexForDrawOrder(draw, sizes);
    assert.ok(group >= 0 && group < sizes.length, `draw ${draw} in range`);
  }
});