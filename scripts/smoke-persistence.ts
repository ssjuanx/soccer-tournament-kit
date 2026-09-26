/**
 * End-to-end smoke test for the persistence layer against live Neon.
 *
 * Runs the REAL repository functions (saveTournamentSetup -> saveParticipants
 * -> getTournamentSetup), asserts the round-trip, then cleans up so no smoke
 * data is left in the database. Not part of the unit test suite.
 *
 * Run with:  node --experimental-strip-types scripts/smoke-persistence.ts
 */

import { eq } from "drizzle-orm";

import { db } from "../lib/db/client.ts";
import { tournaments } from "../lib/db/schema.ts";
import {
  getTournamentSetup,
  saveParticipants,
  saveTournamentSetup,
} from "../lib/db/tournaments.ts";
import {
  buildGroupStageMatches,
  isReadyForFixtures,
  isStructurallyLocked,
} from "../lib/db/fixtures.ts";
import {
  clearGroupFixtures,
  getGroupMatches,
  saveGroupFixtures,
  saveMatchScore,
} from "../lib/db/matches.ts";

async function main() {
  if (
    process.env.CONFIRM_DESTRUCTIVE_SMOKE !== "DELETE_ACTIVE_TOURNAMENT"
  ) {
    throw new Error(
      "Refusing to run: this legacy smoke test deletes the active tournament. Run it only on an isolated Neon branch and set CONFIRM_DESTRUCTIVE_SMOKE=DELETE_ACTIVE_TOURNAMENT explicitly.",
    );
  }

  // Clean slate in case a previous run left data.
  await db.delete(tournaments).where(eq(tournaments.id, "active"));

  // 1. Generate + persist the setup (14 participants, 4 groups -> [4,4,3,3]).
  await saveTournamentSetup({ participantCount: 14, groupCount: 4 });

  // 2. Save participants: a blank-name slot (4) and a blank-team slot (3) are
  //    included to exercise normalization. Two participants share "Barca".
  const entries: Record<number, { name: string; team: string }> = {
    1: { name: "Alice", team: "Barca" },
    2: { name: "Bob", team: "Barca" },
    3: { name: "Carol", team: "" },
    4: { name: "   ", team: "Real" }, // blank name -> dropped
    14: { name: "Dan", team: "Ajax" },
  };
  await saveParticipants(entries);

  // 3. Read it back and assert.
  const snap = await getTournamentSetup();
  if (!snap.tournament) throw new Error("tournament missing after save");
  if (snap.tournament.participantCount !== 14 || snap.tournament.groupCount !== 4) {
    throw new Error(`tournament counts wrong: ${JSON.stringify(snap.tournament)}`);
  }
  if (snap.groups.length !== 4) {
    throw new Error(`expected 4 groups, got ${snap.groups.length}`);
  }
  if (snap.groups.map((g) => g.label).join(",") !== "A,B,C,D") {
    throw new Error(`group labels wrong: ${JSON.stringify(snap.groups)}`);
  }
  if (snap.participants.length !== 4) {
    throw new Error(`expected 4 participants, got ${snap.participants.length}`);
  }

  const alice = snap.participants.find((p) => p.name === "Alice");
  if (!alice || alice.teamName !== "Barca" || alice.groupId !== "active:group:A") {
    throw new Error(`Alice wrong: ${JSON.stringify(alice)}`);
  }
  const carol = snap.participants.find((p) => p.name === "Carol");
  if (!carol || carol.teamName !== null || carol.groupId !== "active:group:A") {
    throw new Error(`Carol wrong: ${JSON.stringify(carol)}`);
  }
  const dan = snap.participants.find((p) => p.name === "Dan");
  if (!dan || dan.teamName !== "Ajax" || dan.groupId !== "active:group:D") {
    throw new Error(`Dan wrong: ${JSON.stringify(dan)}`);
  }
  // Draw order ordering.
  if (snap.participants.map((p) => p.drawOrder).join(",") !== "1,2,3,14") {
    throw new Error(`draw order wrong: ${JSON.stringify(snap.participants)}`);
  }

  // 4. Fixture + score round-trip. The partial draw above is NOT ready (groups
  //    B/C are empty, D has 1), so save a full 14-participant draw first to make
  //    every group have at least 2 players (14/4 -> [4,4,3,3]).
  const fullEntries: Record<number, { name: string; team: string }> = {};
  for (let i = 1; i <= 14; i++) {
    fullEntries[i] = { name: `Player ${i}`, team: i % 2 === 0 ? "Barca" : "Ajax" };
  }
  await saveParticipants(fullEntries);

  const readySnap = await getTournamentSetup();
  if (!isReadyForFixtures(readySnap)) {
    throw new Error("expected setup to be ready for fixtures after full draw");
  }

  const rows = buildGroupStageMatches(readySnap);
  if (rows.length !== 6 + 6 + 3 + 3) {
    throw new Error(`expected 18 fixture rows, got ${rows.length}`);
  }

  await saveGroupFixtures(rows);
  let fixtureMatches = await getGroupMatches();
  if (fixtureMatches.length !== 18) {
    throw new Error(`expected 18 matches, got ${fixtureMatches.length}`);
  }
  if (!isStructurallyLocked(fixtureMatches)) {
    throw new Error("expected structure to be locked once fixtures exist");
  }
  for (const m of fixtureMatches) {
    if (m.score != null) throw new Error(`fresh match should be unscored: ${m.id}`);
  }

  // Idempotent re-save produces the same rows and keeps null scores.
  await saveGroupFixtures(rows);
  fixtureMatches = await getGroupMatches();
  if (fixtureMatches.length !== 18) {
    throw new Error(`re-save changed match count: ${fixtureMatches.length}`);
  }

  // 5. Score a match, then assert a re-generation preserves the score.
  const firstId = fixtureMatches[0].id;
  await saveMatchScore(firstId, { home: 2, away: 1 });
  let scored = await getGroupMatches();
  const scoredRow = scored.find((m) => m.id === firstId);
  if (!scoredRow || scoredRow.score?.home !== 2 || scoredRow.score?.away !== 1) {
    throw new Error(`score not persisted: ${JSON.stringify(scoredRow)}`);
  }

  // Re-running saveGroupFixtures must NOT wipe the entered score.
  await saveGroupFixtures(rows);
  scored = await getGroupMatches();
  const preserved = scored.find((m) => m.id === firstId);
  if (!preserved || preserved.score?.home !== 2 || preserved.score?.away !== 1) {
    throw new Error(`score wiped by re-save: ${JSON.stringify(preserved)}`);
  }

  // 6. Clearing the score sets it back to null.
  await saveMatchScore(firstId, null);
  const cleared = await getGroupMatches();
  const clearedRow = cleared.find((m) => m.id === firstId);
  if (clearedRow?.score != null) {
    throw new Error(`score not cleared: ${JSON.stringify(clearedRow)}`);
  }

  // 7. Clear fixtures -> empty list, structure unlocked.
  await clearGroupFixtures();
  const afterClear = await getGroupMatches();
  if (afterClear.length !== 0) {
    throw new Error(`expected 0 matches after clear, got ${afterClear.length}`);
  }
  if (isStructurallyLocked(afterClear)) {
    throw new Error("expected structure unlocked after clearing fixtures");
  }

  console.log("SMOKE OK");
  console.log("  tournament:", snap.tournament);
  console.log("  groups:", snap.groups);
  console.log("  participants:", snap.participants);

  // 4. Cleanup: cascade-deleting the tournament removes all children.
  await db.delete(tournaments).where(eq(tournaments.id, "active"));
  const after = await getTournamentSetup();
  if (after.tournament) throw new Error("cleanup failed: tournament still present");
  console.log("CLEANUP OK");
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
});
