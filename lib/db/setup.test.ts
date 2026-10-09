import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupRecords,
  compareGroupLabels,
  DEFAULT_ADVANCEMENT,
  DEFAULT_TOURNAMENT_NAME,
  entriesHaveData,
  groupRecordId,
  groupIdForDrawOrder,
  manualResolutionIdFor,
  mapSetupToEntries,
  normalizeAdvancement,
  normalizeEntriesForSave,
  normalizeParticipantOrder,
  normalizeTiebreakerOrder,
  normalizeTournamentMetadata,
  participantIdFor,
  parseAdvancement,
  parseParticipantOrder,
  parseScoringRules,
  parseTiebreakerOrder,
  serializeAdvancement,
  serializeParticipantOrder,
  serializeTiebreakerOrder,
  slugifyBracketName,
  teamIdFor,
  uniqueTeamNames,
  validateAdvancement,
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
      edition: null,
      date: null,
      description: null,
      participantCount: 2,
      groupCount: 2,
      status: "draft",
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tiebreakerOrder: ["goal_difference", "goals_for"],
      advancement: [
        { name: "Championship", fromPosition: 1, toPosition: 2 },
      ],
      qualifiersPerGroup: 2,
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
    serializeTiebreakerOrder(["goal_difference", "goals_for", "manual"]),
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
    "manual",
  ]);
  assert.deepEqual(parseTiebreakerOrder(""), [
    "goal_difference",
    "goals_for",
    "manual",
  ]);
  assert.deepEqual(parseTiebreakerOrder(undefined), [
    "goal_difference",
    "goals_for",
    "manual",
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
    "manual",
  ]);
  assert.deepEqual(parseTiebreakerOrder("{"), [
    "goal_difference",
    "goals_for",
    "manual",
  ]);
});

test("parseTiebreakerOrder: non-array -> default", () => {
  assert.deepEqual(parseTiebreakerOrder('"goal_difference"'), [
    "goal_difference",
    "goals_for",
    "manual",
  ]);
  assert.deepEqual(parseTiebreakerOrder("42"), [
    "goal_difference",
    "goals_for",
    "manual",
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
    ["goal_difference", "goals_for", "manual"],
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
    "manual",
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

test("manualResolutionIdFor: deterministic, group + cohort derived", () => {
  assert.equal(
    manualResolutionIdFor("active", "active:group:A", "p1,p2,p3"),
    "active:resolution:active:group:A:p1,p2,p3",
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

test("normalizeTournamentMetadata: blank name falls back to default", () => {
  assert.deepEqual(
    normalizeTournamentMetadata({
      name: "   ",
      edition: "",
      date: "",
      description: "",
    }),
    {
      name: DEFAULT_TOURNAMENT_NAME,
      edition: null,
      date: null,
      description: null,
    },
  );
});

test("normalizeTournamentMetadata: trims fields, keeps blanks as null", () => {
  assert.deepEqual(
    normalizeTournamentMetadata({
      name: "  Summer Cup  ",
      edition: " 2026 Edition ",
      date: "2026-06-01",
      description: "  Friendly round-robin ",
    }),
    {
      name: "Summer Cup",
      edition: "2026 Edition",
      date: "2026-06-01",
      description: "Friendly round-robin",
    },
  );
});

// ---------------------------------------------------------------------------
// Advancement configuration (explicit position ranges)
// ---------------------------------------------------------------------------

test("DEFAULT_ADVANCEMENT: single Championship bracket covering positions 1–2", () => {
  assert.deepEqual(DEFAULT_ADVANCEMENT, [
    { name: "Championship", fromPosition: 1, toPosition: 2 },
  ]);
});

test("serializeAdvancement: null for the default, JSON otherwise", () => {
  assert.equal(serializeAdvancement(DEFAULT_ADVANCEMENT), null);
  assert.equal(
    serializeAdvancement([{ name: "Championship", fromPosition: 1, toPosition: 2 }]),
    null,
  );
  assert.equal(
    serializeAdvancement([
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Plate", fromPosition: 3, toPosition: 4 },
    ]),
    '[{"name":"Championship","fromPosition":1,"toPosition":2},{"name":"Plate","fromPosition":3,"toPosition":4}]',
  );
});

test("parseAdvancement: default when empty/malformed", () => {
  assert.deepEqual(parseAdvancement(null), DEFAULT_ADVANCEMENT);
  assert.deepEqual(parseAdvancement(""), DEFAULT_ADVANCEMENT);
  assert.deepEqual(parseAdvancement("not-json"), DEFAULT_ADVANCEMENT);
  assert.deepEqual(parseAdvancement("[]"), DEFAULT_ADVANCEMENT);
  assert.deepEqual(parseAdvancement("[{}]"), DEFAULT_ADVANCEMENT);
});

test("parseAdvancement: reads the new explicit-range format", () => {
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"Championship","fromPosition":1,"toPosition":2},{"name":"Plate","fromPosition":3,"toPosition":4}]',
    ),
    [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Plate", fromPosition: 3, toPosition: 4 },
    ],
  );
});

test("parseAdvancement: converts legacy playersPerGroup format to ranges", () => {
  // Championship top-2 + Consolation "the rest" (maxGroupSize = 4).
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"Championship","playersPerGroup":2},{"name":"Consolation","playersPerGroup":null}]',
      4,
    ),
    [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Consolation", fromPosition: 3, toPosition: 4 },
    ],
  );
});

test("parseAdvancement: legacy rest without maxGroupSize collapses to empty range", () => {
  // No maxGroupSize available: the rest bucket becomes [line+1, line] (empty).
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"Championship","playersPerGroup":2},{"name":"Consolation","playersPerGroup":null}]',
    ),
    [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Consolation", fromPosition: 3, toPosition: 2 },
    ],
  );
});

test("parseAdvancement: converts a single legacy playersPerGroup entry", () => {
  assert.deepEqual(
    parseAdvancement('[{"name":"Championship","playersPerGroup":1}]', 3),
    [{ name: "Championship", fromPosition: 1, toPosition: 1 }],
  );
});

test("validateAdvancement: accepts a valid range configuration", () => {
  const ok = validateAdvancement(
    [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Plate", fromPosition: 3, toPosition: 4 },
    ],
    4,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.advancement, [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Plate", fromPosition: 3, toPosition: 4 },
    ]);
  }
});

test("validateAdvancement: rejects empty list", () => {
  const bad = validateAdvancement([]);
  assert.equal(bad.ok, false);
});

test("validateAdvancement: rejects blank name and duplicate slugs", () => {
  assert.equal(
    validateAdvancement([{ name: "  ", fromPosition: 1, toPosition: 2 }]).ok,
    false,
  );
  assert.equal(
    validateAdvancement([
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Championship", fromPosition: 3, toPosition: 4 },
    ]).ok,
    false,
  );
});

test("validateAdvancement: rejects from > to and non-positive positions", () => {
  assert.equal(
    validateAdvancement([{ name: "X", fromPosition: 3, toPosition: 2 }]).ok,
    false,
  );
  assert.equal(
    validateAdvancement([{ name: "X", fromPosition: 0, toPosition: 2 }]).ok,
    false,
  );
});

test("validateAdvancement: rejects toPosition beyond maxGroupSize", () => {
  const bad = validateAdvancement(
    [{ name: "X", fromPosition: 1, toPosition: 5 }],
    4,
  );
  assert.equal(bad.ok, false);
});

test("validateAdvancement: rejects overlapping ranges", () => {
  const bad = validateAdvancement(
    [
      { name: "A", fromPosition: 1, toPosition: 3 },
      { name: "B", fromPosition: 3, toPosition: 4 },
    ],
    4,
  );
  assert.equal(bad.ok, false);
});

test("validateAdvancement: allows a gap (eliminated positions) between ranges", () => {
  const ok = validateAdvancement(
    [
      { name: "A", fromPosition: 1, toPosition: 2 },
      { name: "B", fromPosition: 4, toPosition: 5 },
    ],
    5,
  );
  assert.equal(ok.ok, true);
});

test("normalizeAdvancement: trims names, coerces positions, drops blanks", () => {
  assert.deepEqual(
    normalizeAdvancement([
      { name: "  A  ", fromPosition: 1, toPosition: 2 },
      { name: "", fromPosition: 1, toPosition: 1 },
      { name: "B", fromPosition: 0, toPosition: 3 },
    ]),
    [
      { name: "A", fromPosition: 1, toPosition: 2 },
      { name: "B", fromPosition: 1, toPosition: 3 },
    ],
  );
  assert.deepEqual(normalizeAdvancement([]), DEFAULT_ADVANCEMENT);
});

test("parseAdvancement: reads bestX destinations with mode/count/strategy", () => {
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"Best Thirds","fromPosition":1,"toPosition":1,"mode":"bestX","position":3,"count":2,"strategy":"per-game","groups":["A","B"]}]',
    ),
    [
      {
        name: "Best Thirds",
        fromPosition: 1,
        toPosition: 1,
        mode: "bestX",
        position: 3,
        count: 2,
        strategy: "per-game",
        groups: ["A", "B"],
      },
    ],
  );
});

test("parseAdvancement: explicit mode 'positions' is dropped (treated as default)", () => {
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"Championship","fromPosition":1,"toPosition":2,"mode":"positions"}]',
    ),
    [{ name: "Championship", fromPosition: 1, toPosition: 2 }],
  );
});

test("parseAdvancement: bestX without count keeps mode but omits count", () => {
  assert.deepEqual(
    parseAdvancement(
      '[{"name":"X","fromPosition":1,"toPosition":1,"mode":"bestX","strategy":"raw"}]',
    ),
    [
      { name: "X", fromPosition: 1, toPosition: 1, mode: "bestX", strategy: "raw" },
    ],
  );
});

test("serializeAdvancement: bestX destination is not the default", () => {
  assert.notEqual(
    serializeAdvancement([
      {
        name: "Championship",
        fromPosition: 1,
        toPosition: 2,
        mode: "bestX",
        count: 2,
        strategy: "per-game",
      },
    ]),
    null,
  );
});

test("validateAdvancement: bestX requires a positive integer count", () => {
  assert.equal(
    validateAdvancement([
      { name: "X", fromPosition: 1, toPosition: 1, mode: "bestX" },
    ]).ok,
    false,
  );
  assert.equal(
    validateAdvancement([
      { name: "X", fromPosition: 1, toPosition: 1, mode: "bestX", count: 0 },
    ]).ok,
    false,
  );
});

test("validateAdvancement: bestX requires a positive integer position", () => {
  assert.equal(
    validateAdvancement([
      { name: "X", fromPosition: 1, toPosition: 1, mode: "bestX", count: 2 },
    ]).ok,
    false,
  );
  assert.equal(
    validateAdvancement([
      { name: "X", fromPosition: 1, toPosition: 1, mode: "bestX", count: 2, position: 0 },
    ]).ok,
    false,
  );
  assert.equal(
    validateAdvancement(
      [{ name: "X", fromPosition: 1, toPosition: 1, mode: "bestX", count: 2, position: 5 }],
      4,
    ).ok,
    false,
  );
});

test("validateAdvancement: bestX accepts a valid config and defaults strategy", () => {
  const ok = validateAdvancement([
    {
      name: "Best Thirds",
      fromPosition: 1,
      toPosition: 1,
      mode: "bestX",
      position: 3,
      count: 2,
    },
  ]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.advancement, [
      {
        name: "Best Thirds",
        fromPosition: 1,
        toPosition: 1,
        mode: "bestX",
        position: 3,
        count: 2,
        strategy: "per-game",
      },
    ]);
  }
});

test("validateAdvancement: bestX destinations are exempt from the positions overlap check", () => {
  const ok = validateAdvancement(
    [
      { name: "Championship", fromPosition: 1, toPosition: 2 },
      { name: "Best Thirds", fromPosition: 1, toPosition: 1, mode: "bestX", position: 3, count: 2 },
    ],
    4,
  );
  assert.equal(ok.ok, true);
});

test("validateAdvancement: bestX preserves groups/allowOverlap/playoffThreshold", () => {
  const ok = validateAdvancement([
    {
      name: "X",
      fromPosition: 1,
      toPosition: 1,
      mode: "bestX",
      position: 3,
      count: 1,
      strategy: "playoff",
      groups: ["A", "A", "B"],
      allowOverlap: true,
      playoffThreshold: 3,
    },
  ]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.advancement[0].groups, ["A", "B"]);
    assert.equal(ok.advancement[0].allowOverlap, true);
    assert.equal(ok.advancement[0].playoffThreshold, 3);
  }
});

test("normalizeAdvancement: preserves bestX fields", () => {
  assert.deepEqual(
    normalizeAdvancement([
      {
        name: "  X  ",
        fromPosition: 1,
        toPosition: 1,
        mode: "bestX",
        position: 3,
        count: 3,
        strategy: "raw",
        groups: ["A", " B "],
        allowOverlap: true,
        playoffThreshold: 2,
      },
    ]),
    [
      {
        name: "X",
        fromPosition: 1,
        toPosition: 1,
        mode: "bestX",
        position: 3,
        count: 3,
        strategy: "raw",
        groups: ["A", "B"],
        allowOverlap: true,
        playoffThreshold: 2,
      },
    ],
  );
});

test("slugifyBracketName: lowercases and hyphenates", () => {
  assert.equal(slugifyBracketName("Championship"), "championship");
  assert.equal(slugifyBracketName("Plate / Shield"), "plate-shield");
  assert.equal(slugifyBracketName("   "), "");
});
