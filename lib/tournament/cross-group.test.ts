import { test } from "node:test";
import assert from "node:assert/strict";

import { selectBestX } from "./cross-group.ts";
import type {
  AdvancementDestination,
  ParticipantId,
  Standing,
  StandingRow,
} from "./types.ts";

function row(
  participantId: string,
  over: Partial<StandingRow> & { position: number },
): StandingRow {
  return {
    participantId: participantId as ParticipantId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    unresolved: false,
    ...over,
  };
}

const GROUPS = [
  { id: "gA", label: "A" },
  { id: "gB", label: "B" },
];

test("selectBestX: per-game ranks by averages so fewer games with higher ppg wins", () => {
  // pA: 4 pts over 4 games (1.0 ppg); pB: 3 pts over 2 games (1.5 ppg).
  // Per-game says pB > pA even though pA has more raw points.
  const byGroup = new Map<string, Standing>([
    [
      "gA",
      [
        row("pA", {
          position: 3,
          played: 4,
          wins: 1,
          draws: 1,
          losses: 2,
          goalsFor: 5,
          goalsAgainst: 6,
          goalDifference: -1,
          points: 4,
        }),
      ],
    ],
    [
      "gB",
      [
        row("pB", {
          position: 3,
          played: 2,
          wins: 1,
          draws: 0,
          losses: 1,
          goalsFor: 2,
          goalsAgainst: 3,
          goalDifference: -1,
          points: 3,
        }),
      ],
    ],
  ]);
  const dest: AdvancementDestination = {
    name: "Best Thirds",
    fromPosition: 1,
    toPosition: 1,
    mode: "bestX",
    position: 3,
    count: 2,
    strategy: "per-game",
  };
  assert.deepEqual(
    selectBestX(GROUPS, byGroup, dest).map((q) => q.participantId),
    ["pB", "pA"],
  );
});

test("selectBestX: raw ranks by totals so more raw points wins regardless of games played", () => {
  // Same data as above; raw totals rank pA (4 pts) ahead of pB (3 pts).
  const byGroup = new Map<string, Standing>([
    [
      "gA",
      [
        row("pA", {
          position: 3,
          played: 4,
          wins: 1,
          draws: 1,
          losses: 2,
          goalsFor: 5,
          goalsAgainst: 6,
          goalDifference: -1,
          points: 4,
        }),
      ],
    ],
    [
      "gB",
      [
        row("pB", {
          position: 3,
          played: 2,
          wins: 1,
          draws: 0,
          losses: 1,
          goalsFor: 2,
          goalsAgainst: 3,
          goalDifference: -1,
          points: 3,
        }),
      ],
    ],
  ]);
  const dest: AdvancementDestination = {
    name: "Best Thirds",
    fromPosition: 1,
    toPosition: 1,
    mode: "bestX",
    position: 3,
    count: 2,
    strategy: "raw",
  };
  assert.deepEqual(
    selectBestX(GROUPS, byGroup, dest).map((q) => q.participantId),
    ["pA", "pB"],
  );
});

test("selectBestX: draw order is the final deterministic fallback", () => {
  const byGroup = new Map<string, Standing>([
    ["gA", [row("pA", { position: 3, played: 2, points: 3, goalDifference: 0, goalsFor: 2 })]],
    ["gB", [row("pB", { position: 3, played: 2, points: 3, goalDifference: 0, goalsFor: 2 })]],
  ]);
  const drawOrder = new Map<ParticipantId, number>([
    ["pA" as ParticipantId, 5],
    ["pB" as ParticipantId, 2],
  ]);
  const dest: AdvancementDestination = {
    name: "Best Thirds",
    fromPosition: 1,
    toPosition: 1,
    mode: "bestX",
    position: 3,
    count: 2,
    strategy: "per-game",
  };
  assert.deepEqual(
    selectBestX(GROUPS, byGroup, dest, drawOrder).map((q) => q.participantId),
    ["pB", "pA"],
  );
});

test("selectBestX: groups filter restricts candidates", () => {
  const byGroup = new Map<string, Standing>([
    ["gA", [row("pA", { position: 3, played: 2, points: 3 })]],
    ["gB", [row("pB", { position: 3, played: 2, points: 0 })]],
  ]);
  const dest: AdvancementDestination = {
    name: "Best Thirds",
    fromPosition: 1,
    toPosition: 1,
    mode: "bestX",
    position: 3,
    count: 2,
    strategy: "per-game",
    groups: ["A"],
  };
  assert.deepEqual(
    selectBestX(GROUPS, byGroup, dest).map((q) => q.participantId),
    ["pA"],
  );
});

test("selectBestX: groups with no row at the position are skipped", () => {
  // gB only has a position-1 row, so it contributes no position-3 candidate.
  const byGroup = new Map<string, Standing>([
    ["gA", [row("pA", { position: 3, played: 2, points: 3 })]],
    ["gB", [row("pB", { position: 1, played: 2, points: 6 })]],
  ]);
  const dest: AdvancementDestination = {
    name: "Best Thirds",
    fromPosition: 1,
    toPosition: 1,
    mode: "bestX",
    position: 3,
    count: 2,
    strategy: "per-game",
  };
  assert.deepEqual(
    selectBestX(GROUPS, byGroup, dest).map((q) => q.participantId),
    ["pA"],
  );
});

test("selectBestX: gate and playoff select nothing until their phases land", () => {
  const byGroup = new Map<string, Standing>([
    ["gA", [row("pA", { position: 3, played: 2, points: 3 })]],
  ]);
  for (const strategy of ["gate", "playoff"] as const) {
    const dest: AdvancementDestination = {
      name: "X",
      fromPosition: 1,
      toPosition: 1,
      mode: "bestX",
      position: 3,
      count: 1,
      strategy,
    };
    assert.deepEqual(selectBestX(GROUPS, byGroup, dest), []);
  }
});