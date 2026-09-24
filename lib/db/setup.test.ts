import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupRecords,
  compareGroupLabels,
  entriesHaveData,
  groupRecordId,
  groupIdForDrawOrder,
  manualResolutionIdFor,
  mapSetupToEntries,
  normalizeEntriesForSave,
  normalizeParticipantOrder,
  normalizeTiebreakerOrder,
  participantIdFor,
  parseParticipantOrder,
  parseScoringRules,
  parseTiebreakerOrder,
  serializeParticipantOrder,
  serializeTiebreakerOrder,
  teamIdFor,
  uniqueTeamNames,
  type TournamentSetupSnapshot,
} from "./setup.ts";

// ---------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------

test("groupRecordId: deterministic, label-derived", () => {
  assert.equal(groupRecordId("t1", 0), "t1:group:A");
  assert.equal(groupRecordId("t1", 1), "t1:group:B");
  assert.equal(groupRecordId("t1", 26), "t1:group:AA");
});

test("participantIdFor / teamIdFor: deterministic", () => {
  assert.equal(participantIdFor("t1", 1), "t1:participant:1");
  assert.equal(participantIdFor("t1", 14), "t1:participant:14");
  assert.equal(teamIdFor("t1", "Barca"), "t1:team:Barca");
  assert.equal(teamIdFor("t1", "Barca"), teamIdFor("t1", "Barca"));
  assert.notEqual(teamIdFor("t1", "Barca"), teamIdFor("t2", "Barca"));
});

// ---------------------------------------------------------------------------
// buildGroupRecords
// ---------------------------------------------------------------------------

test("buildGroupRecords: one record per group, ordered A..", () => {
  const records = buildGroupRecords("t1", 4);
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.map((r) => r.label),
    ["A", "B", "C", "D"],
  );
  assert.deepEqual(
    records.map((r) => r.id),
    ["t1:group:A", "t1:group:B", "t1:group:C", "t1:group:D"],
  );
});

test("buildGroupRecords: handles labels past Z", () => {
  const records = buildGroupRecords("t1", 28);
  assert.equal(records.length, 28);
  assert.equal(records[25].label, "Z");
  assert.equal(records[26].label, "AA");
  assert.equal(records[27].label, "AB");
});

// ---------------------------------------------------------------------------
// groupIdForDrawOrder
// ---------------------------------------------------------------------------

test("groupIdForDrawOrder: matches draw-order assignment (14/4)", () => {
  const sizes = [4, 4, 3, 3];
  assert.equal(groupIdForDrawOrder("t1", 1, sizes), "t1:group:A");
  assert.equal(groupIdForDrawOrder("t1", 4, sizes), "t1:group:A");
  assert.equal(groupIdForDrawOrder("t1", 5, sizes), "t1:group:B");
  assert.equal(groupIdForDrawOrder("t1", 12, sizes), "t1:group:D");
});

// ---------------------------------------------------------------------------
// compareGroupLabels
// ---------------------------------------------------------------------------

test("compareGroupLabels: orders single letters A < B < Z", () => {
  assert.equal(compareGroupLabels("A", "B"), -1);
  assert.equal(compareGroupLabels("Z", "A"), 1);
  assert.equal(compareGroupLabels("M", "M"), 0);
});

test("compareGroupLabels: shorter before longer (Z < AA)", () => {
  assert.equal(compareGroupLabels("Z", "AA"), -1);
  assert.equal(compareGroupLabels("AA", "Z"), 1);
});

test("compareGroupLabels: orders multi-letter labels correctly", () => {
  assert.equal(compareGroupLabels("AA", "AB"), -1);
  assert.equal(compareGroupLabels("AZ", "BA"), -1);
  assert.equal(compareGroupLabels("BA", "AZ"), 1);
});

test("compareGroupLabels: sorts a mixed list by index order", () => {
  const labels = ["Z", "A", "BA", "AA", "B"];
  labels.sort(compareGroupLabels);
  assert.deepEqual(labels, ["A", "B", "Z", "AA", "BA"]);
});

// ---------------------------------------------------------------------------
// mapSetupToEntries
// ---------------------------------------------------------------------------

test("mapSetupToEntries: empty snapshot yields blank state", () => {
  const snap: TournamentSetupSnapshot = {
    tournament: null,
    groups: [],
    participants: [],
    manualResolutions: [],
  };
  assert.deepEqual(mapSetupToEntries(snap), {
    participantCount: 0,
    groupCount: 0,
    entries: {},
  });
});

test("mapSetupToEntries: maps participants to entries keyed by draw order", () => {
  const snap: TournamentSetupSnapshot = {
    tournament: {
      id: "active",
      name: "FC Tournament",
      participantCount: 2,
      groupCount: 2,
      status: "draft",
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tiebreakerOrder: ["goal_difference", "goals_for"],
    },
    groups: [
      { id: "active:group:A", label: "A" },
      { id: "active:group:B", label: "B" },
    ],
    participants: [
      { id: "active:participant:1", name: "Alice", drawOrder: 1, teamName: "Barca", groupId: "active:group:A" },
      { id: "active:participant:2", name: "Bob", drawOrder: 2, teamName: null, groupId: "active:group:B" },
    ],
    manualResolutions: [],
  };
  const result = mapSetupToEntries(snap);
  assert.equal(result.participantCount, 2);
  assert.equal(result.groupCount, 2);
  assert.deepEqual(result.entries[1], { name: "Alice", team: "Barca" });
  assert.deepEqual(result.entries[2], { name: "Bob", team: "" });
});

// ---------------------------------------------------------------------------
// entriesHaveData
// ---------------------------------------------------------------------------

test("entriesHaveData: false when empty / only blanks", () => {
  assert.equal(entriesHaveData({}), false);
  assert.equal(entriesHaveData({ 1: { name: "   ", team: "" } }), false);
});

test("entriesHaveData: true when a name or team is present", () => {
  assert.equal(entriesHaveData({ 1: { name: "Alice", team: "" } }), true);
  assert.equal(entriesHaveData({ 1: { name: "", team: "Barca" } }), true);
});

// ---------------------------------------------------------------------------
// normalizeEntriesForSave
// ---------------------------------------------------------------------------

test("normalizeEntriesForSave: keeps non-blank names, trims, respects range", () => {
  const entries = {
    1: { name: "  Alice ", team: " Barca " },
    2: { name: "Bob", team: "" },
    3: { name: "   ", team: "Real" },
  };
  assert.deepEqual(normalizeEntriesForSave(entries, 3), [
    { drawOrder: 1, name: "Alice", team: "Barca" },
    { drawOrder: 2, name: "Bob", team: "" },
  ]);
});

test("normalizeEntriesForSave: ignores entries beyond participantCount", () => {
  const entries = {
    1: { name: "Alice", team: "" },
    2: { name: "Bob", team: "" },
    3: { name: "Carol", team: "" },
  };
  assert.deepEqual(normalizeEntriesForSave(entries, 2), [
    { drawOrder: 1, name: "Alice", team: "" },
    { drawOrder: 2, name: "Bob", team: "" },
  ]);
});

test("normalizeEntriesForSave: empty when no slots have names", () => {
  assert.deepEqual(normalizeEntriesForSave({ 1: { name: "", team: "" } }, 1), []);
});

// ---------------------------------------------------------------------------
// uniqueTeamNames
// ---------------------------------------------------------------------------

test("uniqueTeamNames: dedupes, sorts, excludes blank", () => {
  const normalized = [
    { drawOrder: 1, name: "Alice", team: "Barca" },
    { drawOrder: 2, name: "Bob", team: "Barca" },
    { drawOrder: 3, name: "Carol", team: "" },
    { drawOrder: 4, name: "Dan", team: "Ajax" },
  ];
  assert.deepEqual(uniqueTeamNames(normalized), ["Ajax", "Barca"]);
});

test("uniqueTeamNames: empty when no teams assigned", () => {
  assert.deepEqual(
    uniqueTeamNames([{ drawOrder: 1, name: "Alice", team: "" }]),
    [],
  );
});

// ---------------------------------------------------------------------------
// Tournament rules: tiebreaker order serialization & parsing
// ---------------------------------------------------------------------------

test("serializeTiebreakerOrder: default order -> null (canonical)", () => {
  assert.equal(
    serializeTiebreakerOrder(["goal_difference", "goals_for"]),
    null,
  );
});

test("serializeTiebreakerOrder: empty -> null", () => {
  assert.equal(serializeTiebreakerOrder([]), null);
});

test("serializeTiebreakerOrder: custom order -> JSON text", () => {
  assert.equal(
    serializeTiebreakerOrder(["goals_for", "goal_difference"]),
    '["goals_for","goal_difference"]',
  );
  assert.equal(
    serializeTiebreakerOrder(["goal_difference"]),
    '["goal_difference"]',
  );
});

test("parseTiebreakerOrder: null/empty -> default order", () => {
  assert.deepEqual(parseTiebreakerOrder(null), [
    "goal_difference",
    "goals_for",
  ]);
  assert.deepEqual(parseTiebreakerOrder(""), [
    "goal_difference",
    "goals_for",
  ]);
  assert.deepEqual(parseTiebreakerOrder(undefined), [
    "goal_difference",
    "goals_for",
  ]);
});

test("parseTiebreakerOrder: valid JSON -> parsed order", () => {
  assert.deepEqual(
    parseTiebreakerOrder('["goals_for","goal_difference"]'),
    ["goals_for", "goal_difference"],
  );
  assert.deepEqual(
    parseTiebreakerOrder('["goal_difference"]'),
    ["goal_difference"],
  );
});

test("parseTiebreakerOrder: malformed JSON -> default", () => {
  assert.deepEqual(parseTiebreakerOrder("not json"), [
    "goal_difference",
    "goals_for",
  ]);
  assert.deepEqual(parseTiebreakerOrder("{"), [
    "goal_difference",
    "goals_for",
  ]);
});

test("parseTiebreakerOrder: non-array -> default", () => {
  assert.deepEqual(parseTiebreakerOrder('"goal_difference"'), [
    "goal_difference",
    "goals_for",
  ]);
  assert.deepEqual(parseTiebreakerOrder("42"), [
    "goal_difference",
    "goals_for",
  ]);
});

test("parseTiebreakerOrder: unknown keys filtered, duplicates removed", () => {
  assert.deepEqual(
    parseTiebreakerOrder(
      '["goals_for","fair_play","goals_for","goal_difference"]',
    ),
    ["goals_for", "goal_difference"],
  );
});

test("parseTiebreakerOrder: head_to_head and manual are valid keys", () => {
  assert.deepEqual(
    parseTiebreakerOrder('["head_to_head","manual","goal_difference"]'),
    ["head_to_head", "manual", "goal_difference"],
  );
});

test("parseTiebreakerOrder: all-unknown -> default", () => {
  assert.deepEqual(
    parseTiebreakerOrder('["fair_play","coin_toss"]'),
    ["goal_difference", "goals_for"],
  );
});

// ---------------------------------------------------------------------------
// normalizeTiebreakerOrder
// ---------------------------------------------------------------------------

test("normalizeTiebreakerOrder: keeps known, preserves order, dedupes", () => {
  assert.deepEqual(
    normalizeTiebreakerOrder(["goals_for", "goal_difference"]),
    ["goals_for", "goal_difference"],
  );
  assert.deepEqual(
    normalizeTiebreakerOrder(["goal_difference", "goal_difference"]),
    ["goal_difference"],
  );
});

test("normalizeTiebreakerOrder: filters unknown keys", () => {
  assert.deepEqual(
    normalizeTiebreakerOrder([
      "goals_for",
      "fair_play" as never,
      "goal_difference",
    ]),
    ["goals_for", "goal_difference"],
  );
});

test("normalizeTiebreakerOrder: keeps head_to_head and manual", () => {
  assert.deepEqual(
    normalizeTiebreakerOrder(["head_to_head", "manual"]),
    ["head_to_head", "manual"],
  );
});

test("normalizeTiebreakerOrder: empty/all-unknown -> default", () => {
  assert.deepEqual(normalizeTiebreakerOrder([]), [
    "goal_difference",
    "goals_for",
  ]);
});

// ---------------------------------------------------------------------------
// parseScoringRules
// ---------------------------------------------------------------------------

test("parseScoringRules: valid integers -> config", () => {
  assert.deepEqual(parseScoringRules("3", "1", "0"), {
    ok: true,
    config: { winPoints: 3, drawPoints: 1, lossPoints: 0 },
  });
  assert.deepEqual(parseScoringRules("2", "1", "0"), {
    ok: true,
    config: { winPoints: 2, drawPoints: 1, lossPoints: 0 },
  });
});

test("parseScoringRules: blank values fall back to defaults", () => {
  assert.deepEqual(parseScoringRules("", "", ""), {
    ok: true,
    config: { winPoints: 3, drawPoints: 1, lossPoints: 0 },
  });
});

test("parseScoringRules: trims whitespace", () => {
  assert.deepEqual(parseScoringRules("  3 ", " 1 ", " 0 "), {
    ok: true,
    config: { winPoints: 3, drawPoints: 1, lossPoints: 0 },
  });
});

test("parseScoringRules: rejects non-integers", () => {
  assert.match(
    (parseScoringRules("1.5", "1", "0") as { ok: false; message: string })
      .message,
    /Win points/,
  );
  assert.match(
    (parseScoringRules("3", "two", "0") as { ok: false; message: string })
      .message,
    /Draw points/,
  );
  assert.match(
    (parseScoringRules("3", "1", "1.5") as { ok: false; message: string })
      .message,
    /Loss points/,
  );
});

// ---------------------------------------------------------------------------
// Manual tiebreak resolution: participant-order serialization & parsing
// ---------------------------------------------------------------------------

test("manualResolutionIdFor: deterministic, group-derived", () => {
  assert.equal(
    manualResolutionIdFor("active", "active:group:A"),
    "active:resolution:active:group:A",
  );
});

test("serializeParticipantOrder: JSON text", () => {
  assert.equal(
    serializeParticipantOrder(["a", "b", "c"]),
    '["a","b","c"]',
  );
});

test("parseParticipantOrder: round-trips a valid array", () => {
  assert.deepEqual(
    parseParticipantOrder(serializeParticipantOrder(["x", "y"])),
    ["x", "y"],
  );
});

test("parseParticipantOrder: malformed JSON -> empty", () => {
  assert.deepEqual(parseParticipantOrder("not json"), []);
  assert.deepEqual(parseParticipantOrder("{"), []);
});

test("parseParticipantOrder: non-array -> empty", () => {
  assert.deepEqual(parseParticipantOrder('"a"'), []);
  assert.deepEqual(parseParticipantOrder("42"), []);
});

test("parseParticipantOrder: drops non-string entries", () => {
  assert.deepEqual(
    parseParticipantOrder('["a",1,true,null,"b"]'),
    ["a", "b"],
  );
});

test("parseParticipantOrder: null/blank -> empty", () => {
  assert.deepEqual(parseParticipantOrder(null), []);
  assert.deepEqual(parseParticipantOrder(""), []);
});

test("normalizeParticipantOrder: dedupes, drops blanks, preserves order", () => {
  assert.deepEqual(
    normalizeParticipantOrder(["a", "", "b", "a", "c"]),
    ["a", "b", "c"],
  );
  assert.deepEqual(normalizeParticipantOrder([]), []);
});