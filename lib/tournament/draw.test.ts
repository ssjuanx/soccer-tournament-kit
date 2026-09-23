import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSetup,
  getGroupLabel,
  validateSetupInput,
} from "./draw.ts";
import { getGroupSizes } from "./groups.ts";

// ---------------------------------------------------------------------------
// getGroupLabel
// ---------------------------------------------------------------------------

test("getGroupLabel: maps indices to A..Z", () => {
  assert.equal(getGroupLabel(0), "A");
  assert.equal(getGroupLabel(1), "B");
  assert.equal(getGroupLabel(25), "Z");
});

test("getGroupLabel: continues past Z", () => {
  assert.equal(getGroupLabel(26), "AA");
  assert.equal(getGroupLabel(27), "AB");
  assert.equal(getGroupLabel(51), "AZ");
  assert.equal(getGroupLabel(52), "BA");
});

test("getGroupLabel: rejects invalid indices", () => {
  assert.throws(() => getGroupLabel(-1), /non-negative/);
  assert.throws(() => getGroupLabel(2.5), /integer/);
});

// ---------------------------------------------------------------------------
// buildSetup
// ---------------------------------------------------------------------------

test("buildSetup: produces one slot per participant, ordered by draw", () => {
  const plan = buildSetup(14, 4);
  assert.equal(plan.slots.length, 14);
  for (let i = 0; i < plan.slots.length; i++) {
    assert.equal(plan.slots[i].drawOrder, i + 1, `slot ${i} draw order`);
  }
});

test("buildSetup: group assignment matches the existing draw-order logic", () => {
  // 14 participants / 4 groups -> sizes [4, 4, 3, 3]
  const plan = buildSetup(14, 4);
  assert.deepEqual(plan.groupSizes, [4, 4, 3, 3]);

  const expected: Array<[number, number, string]> = [
    [1, 0, "A"],
    [4, 0, "A"],
    [5, 1, "B"],
    [8, 1, "B"],
    [9, 2, "C"],
    [11, 2, "C"],
    [12, 3, "D"],
    [14, 3, "D"],
  ];
  for (const [draw, group, label] of expected) {
    const slot = plan.slots[draw - 1];
    assert.equal(slot.groupIndex, group, `draw ${draw} group`);
    assert.equal(slot.groupLabel, label, `draw ${draw} label`);
  }
});

test("buildSetup: even distribution labels each group correctly", () => {
  const plan = buildSetup(16, 4);
  assert.deepEqual(plan.groupSizes, [4, 4, 4, 4]);
  assert.equal(plan.slots[0].groupLabel, "A");
  assert.equal(plan.slots[3].groupLabel, "A");
  assert.equal(plan.slots[4].groupLabel, "B");
  assert.equal(plan.slots[15].groupLabel, "D");
});

test("buildSetup: larger groups come first when uneven (uses getGroupSizes)", () => {
  const plan = buildSetup(13, 4);
  // getGroupSizes(13, 4) -> [4, 3, 3, 3], so the first group has 4 slots.
  assert.deepEqual(plan.groupSizes, getGroupSizes(13, 4));
  assert.equal(plan.slots[3].groupIndex, 0); // last of group A
  assert.equal(plan.slots[4].groupIndex, 1); // first of group B
});

test("buildSetup: single group holds everyone", () => {
  const plan = buildSetup(8, 1);
  assert.deepEqual(plan.groupSizes, [8]);
  assert.equal(plan.slots.length, 8);
  for (const slot of plan.slots) {
    assert.equal(slot.groupIndex, 0);
    assert.equal(slot.groupLabel, "A");
  }
});

test("buildSetup: supports large tournaments (64 / 8)", () => {
// ---------------------------------------------------------------------------
// validateSetupInput
// ---------------------------------------------------------------------------

function messageOf(res: ReturnType<typeof validateSetupInput>): string {
  if (res.ok) {
    throw new Error("expected validation failure, got success");
  }
  return res.message;
}

test("validateSetupInput: accepts valid whole numbers", () => {
  assert.deepEqual(validateSetupInput("16", "4"), {
    ok: true,
    participantCount: 16,
    groupCount: 4,
  });
  assert.deepEqual(validateSetupInput(" 32 ", " 8 "), {
    ok: true,
    participantCount: 32,
    groupCount: 8,
  });
});

test("validateSetupInput: rejects empty values", () => {
  assert.match(messageOf(validateSetupInput("", "4")), /number of participants/);
  assert.match(messageOf(validateSetupInput("16", "")), /number of groups/);
  assert.match(messageOf(validateSetupInput("   ", "4")), /number of participants/);
});

test("validateSetupInput: rejects decimals", () => {
  assert.match(messageOf(validateSetupInput("8.5", "2")), /whole number/);
  assert.match(messageOf(validateSetupInput("8", "2.5")), /whole number/);
});

test("validateSetupInput: rejects zero and negatives", () => {
  assert.match(messageOf(validateSetupInput("0", "2")), /at least 1/);
  assert.match(messageOf(validateSetupInput("-5", "2")), /at least 1/);
  assert.match(messageOf(validateSetupInput("8", "0")), /at least 1/);
  assert.match(messageOf(validateSetupInput("8", "-1")), /at least 1/);
});

test("validateSetupInput: rejects more groups than participants", () => {
  assert.match(messageOf(validateSetupInput("2", "3")), /cannot exceed/);
});

test("validateSetupInput: rejects non-numeric text", () => {
  assert.match(messageOf(validateSetupInput("abc", "2")), /whole number/);
});
  const plan = buildSetup(64, 8);
  assert.deepEqual(plan.groupSizes, [8, 8, 8, 8, 8, 8, 8, 8]);
  assert.equal(plan.slots.length, 64);
  assert.equal(plan.slots[0].groupLabel, "A");
  assert.equal(plan.slots[7].groupLabel, "A");
  assert.equal(plan.slots[8].groupLabel, "B");
  assert.equal(plan.slots[63].groupLabel, "H");
});

test("buildSetup: throws for invalid inputs (delegates to getGroupSizes)", () => {
  assert.throws(() => buildSetup(0, 2), /positive/);
  assert.throws(() => buildSetup(-1, 2), /positive/);
  assert.throws(() => buildSetup(8, 0), /positive/);
  assert.throws(() => buildSetup(8, -1), /positive/);
  assert.throws(() => buildSetup(8.5, 2), /integer/);
  assert.throws(() => buildSetup(8, 2.5), /integer/);
  assert.throws(() => buildSetup(2, 3), /cannot exceed/);
});