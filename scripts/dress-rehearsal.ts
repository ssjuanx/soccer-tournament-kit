/**
 * Full 18-player rehearsal against an empty database branch.
 *
 * Safety rules:
 * - Refuses to start if an active tournament already exists.
 * - Marks its own tournament with a unique name.
 * - Deletes only that marked tournament in cleanup.
 */

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "../lib/db/client.ts";
import {
  buildConsolationQualifiers,
  buildGroupStageMatches,
  buildKnockoutQualifiers,
  buildKnockoutStageMatches,
  computeKnockoutView,
} from "../lib/db/fixtures.ts";
import {
  getGroupMatches,
  getKnockoutMatches,
  saveGroupFixtures,
  saveKnockoutFixtures,
  saveKnockoutMatchScore,
  saveMatchScore,
} from "../lib/db/matches.ts";
import { tournaments } from "../lib/db/schema.ts";
import {
  createTournamentRule,
  deleteTournamentRule,
  getTournamentRules,
  updateTournamentRule,
} from "../lib/db/rules.ts";
import {
  ACTIVE_TOURNAMENT_ID,
  getTournamentSetup,
  saveParticipants,
  saveTournamentMetadata,
  saveTournamentSetup,
} from "../lib/db/tournaments.ts";
import { calculateStandings } from "../lib/tournament/standings.ts";
import type { BracketKind, Standing } from "../lib/tournament/types.ts";

const REHEARSAL_NAME = "__FC_TOURNAMENT_DRESS_REHEARSAL__";
const BASE_URL = process.env.REHEARSAL_BASE_URL;

async function standingsForCurrentTournament() {
  const [setup, matches] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
  ]);
  assert.ok(setup.tournament);

  const scoring = {
    winPoints: setup.tournament.winPoints,
    drawPoints: setup.tournament.drawPoints,
    lossPoints: setup.tournament.lossPoints,
  };
  const standingsByGroup = new Map<string, Standing>();
  for (const group of setup.groups) {
    const participants = setup.participants
      .filter((participant) => participant.groupId === group.id)
      .map((participant) => ({
        id: participant.id,
        name: participant.name,
        drawOrder: participant.drawOrder,
        assignedTeamId: null,
        groupId: participant.groupId,
      }));
    standingsByGroup.set(
      group.id,
      calculateStandings(matches, participants, {
        scoring,
        tiebreakerOrder: setup.tournament.tiebreakerOrder,
        manualResolutions: setup.manualResolutions,
        groupId: group.id,
      }),
    );
  }
  return { setup, matches, standingsByGroup };
}

async function playBracket(kind: BracketKind): Promise<string> {
  for (let pass = 0; pass < 8; pass++) {
    const [setup, groupMatches, knockoutMatches] = await Promise.all([
      getTournamentSetup(),
      getGroupMatches(),
      getKnockoutMatches(kind),
    ]);
    const view = computeKnockoutView(
      setup,
      groupMatches,
      knockoutMatches,
      kind,
    );
    assert.equal(view.status, "bracket");
    if (view.status !== "bracket") throw new Error(`${kind} not generated`);
    if (view.champion) return view.champion;

    const playable = view.bracket.filter(
      (match) =>
        match.score == null &&
        match.home.participantId != null &&
        match.away.participantId != null,
    );
    assert.ok(playable.length > 0, `${kind} did not advance`);
    for (const match of playable) {
      await saveKnockoutMatchScore(kind, match.id, { home: 2, away: 1 });
    }
  }
  throw new Error(`${kind} did not produce a winner`);
}

async function verifyPage(pathname: string, expected: string[]) {
  if (!BASE_URL) return;
  const response = await fetch(`${BASE_URL}${pathname}`);
  assert.equal(response.status, 200, `${pathname} returned ${response.status}`);
  const html = await response.text();
  for (const text of expected) {
    assert.ok(html.includes(text), `${pathname} is missing ${text}`);
  }
}

async function main() {
  const initial = await getTournamentSetup();
  if (initial.tournament) {
    throw new Error(
      "Refusing rehearsal: an active tournament already exists in this database.",
    );
  }

  let ownsActiveTournament = false;
  const ownedRuleIds: string[] = [];
  try {
    await saveTournamentSetup({ participantCount: 18, groupCount: 4 });
    ownsActiveTournament = true;
    await saveTournamentMetadata({
      name: REHEARSAL_NAME,
      edition: "18-player test",
      date: "2026-09-26",
      description: "Temporary end-to-end rehearsal",
    });

    ownedRuleIds.push(
      await createTournamentRule(
        "__DRESS_REHEARSAL_MATCH_FORMAT__",
        "Play every group opponent once.",
      ),
    );
    ownedRuleIds.push(
      await createTournamentRule(
        "__DRESS_REHEARSAL_DELETE__",
        "This rule tests deletion.",
      ),
    );
    let rules = (await getTournamentRules()).filter((rule) =>
      ownedRuleIds.includes(rule.id),
    );
    assert.equal(rules.length, 2);
    await updateTournamentRule(
      rules[0].id,
      "__DRESS_REHEARSAL_MATCH_FORMAT__",
      "Updated: play every group opponent once.",
    );
    await deleteTournamentRule(rules[1].id);
    ownedRuleIds.splice(ownedRuleIds.indexOf(rules[1].id), 1);
    rules = (await getTournamentRules()).filter((rule) =>
      ownedRuleIds.includes(rule.id),
    );
    assert.equal(rules.length, 1);
    assert.match(rules[0].body, /^Updated:/);

    const entries: Record<number, { name: string; team: string }> = {};
    for (let drawOrder = 1; drawOrder <= 18; drawOrder++) {
      entries[drawOrder] = {
        name: `Player ${drawOrder}`,
        team: `Club ${drawOrder}`,
      };
    }
    await saveParticipants(entries);

    let setup = await getTournamentSetup();
    assert.deepEqual(
      setup.groups.map(
        (group) =>
          setup.participants.filter((participant) => participant.groupId === group.id)
            .length,
      ),
      [5, 5, 4, 4],
    );

    const groupRows = buildGroupStageMatches(setup);
    assert.equal(groupRows.length, 32);
    await saveGroupFixtures(groupRows);
    let groupMatches = await getGroupMatches();
    for (let index = 0; index < groupMatches.length; index++) {
      await saveMatchScore(groupMatches[index].id, {
        home: 1 + (index % 3),
        away: index % 2,
      });
    }

    const current = await standingsForCurrentTournament();
    setup = current.setup;
    groupMatches = current.matches;
    assert.equal(groupMatches.filter((match) => match.score != null).length, 32);

    const championship = buildKnockoutQualifiers(
      setup.groups,
      current.standingsByGroup,
      2,
    );
    const consolation = buildConsolationQualifiers(
      setup.groups,
      current.standingsByGroup,
      2,
      setup.participants,
    );
    assert.equal(championship.length, 8);
    assert.equal(consolation.length, 10);

    await saveKnockoutFixtures(
      buildKnockoutStageMatches(championship, ACTIVE_TOURNAMENT_ID, "championship"),
    );
    await saveKnockoutFixtures(
      buildKnockoutStageMatches(consolation, ACTIVE_TOURNAMENT_ID, "consolation"),
    );

    const unplayedConsolation = computeKnockoutView(
      setup,
      groupMatches,
      await getKnockoutMatches("consolation"),
      "consolation",
    );
    assert.equal(unplayedConsolation.status, "bracket");
    if (unplayedConsolation.status === "bracket") {
      assert.equal(
        unplayedConsolation.champion,
        null,
        "byes must not create a champion before later rounds are played",
      );
    }

    const championshipWinner = await playBracket("championship");
    const consolationWinner = await playBracket("consolation");
    assert.notEqual(championshipWinner, consolationWinner);

    await verifyPage("/standings", ["Player 1", "Standings", "Pts"]);
    await verifyPage("/matches", ["Player 1", "Championship", "Consolation"]);
    await verifyPage("/bracket", [
      "Championship winner",
      "Consolation winner",
    ]);
    await verifyPage("/rules", ["__DRESS_REHEARSAL_MATCH_FORMAT__", "Updated:"]);

    console.log("DRESS REHEARSAL OK");
    console.log("  participants: 18");
    console.log("  group sizes: 5, 5, 4, 4");
    console.log("  group matches: 32/32 completed");
    console.log("  championship: 8 players, winner decided");
    console.log("  consolation: 10 players, 6 byes, winner decided");
    console.log("  rules: create, edit, and delete verified");
    if (BASE_URL) console.log("  public pages, including rules: verified");
  } finally {
    for (const ruleId of ownedRuleIds) {
      await deleteTournamentRule(ruleId);
    }
    if (ownsActiveTournament) {
      const current = await getTournamentSetup();
      if (current.tournament?.name !== REHEARSAL_NAME) {
        throw new Error(
          "Safety stop: active tournament is not owned by this rehearsal; cleanup skipped.",
        );
      }
      await db
        .delete(tournaments)
        .where(eq(tournaments.id, ACTIVE_TOURNAMENT_ID));
      console.log("  cleanup: temporary tournament removed");
    }
  }
}

main().catch((error) => {
  console.error("DRESS REHEARSAL FAILED", error);
  process.exitCode = 1;
});
