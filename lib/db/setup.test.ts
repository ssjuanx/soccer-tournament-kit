import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupRecords,
  compareGroupLabels,
  entriesHaveData,
  groupRecordId,
  groupIdForDrawOrder,
  mapSetupToEntries,
  normalizeEntriesForSave,
  participantIdFor,
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
    },
    groups: [
      { id: "active:group:A", label: "A" },
      { id: "active:group:B", label: "B" },
    ],
    participants: [
      { id: "active:participant:1", name: "Alice", drawOrder: 1, teamName: "Barca", groupId: "active:group:A" },
      { id: "active:participant:2", name: "Bob", drawOrder: 2, teamName: null, groupId: "active:group:B" },
    ],
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