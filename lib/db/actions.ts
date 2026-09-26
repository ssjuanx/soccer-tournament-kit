"use server";

/**
 * Server Actions bridging the admin UI to the persistence repository.
 *
 * These are the only entry points the client calls; the `db` client is never
 * imported from client code. Each action validates input at the boundary
 * (reusing the persistence-free `validateSetupInput`) and returns a tagged
 * result so the UI can show errors without throwing into the render path.
 */

import { validateSetupInput } from "../tournament/draw.ts";
import { calculateStandings } from "../tournament/standings.ts";
import type { Match } from "../tournament/types.ts";

import {
  buildGroupStageMatches,
  buildConsolationQualifiers,
  buildKnockoutQualifiers,
  buildKnockoutStageMatches,
  isGroupStageComplete,
  isReadyForFixtures,
  isStructurallyLocked,
  hasUnresolvedStandings,
  parseScore,
} from "./fixtures.ts";
import {
  clearGroupFixtures,
  clearKnockoutFixtures,
  getGroupMatches,
  getKnockoutMatches,
  saveGroupFixtures,
  saveKnockoutFixtures,
  saveKnockoutMatchScore,
  saveMatchScore,
} from "./matches.ts";
import {
  getTournamentSetup,
  saveManualTiebreakResolution,
  saveParticipants,
  saveTournamentMetadata,
  saveTournamentRules,
  saveTournamentSetup,
} from "./tournaments.ts";
import {
  type Entry,
  normalizeTiebreakerOrder,
  parseScoringRules,
} from "./setup.ts";
import type {
  BracketKind,
  GroupId,
  ParticipantId,
  TiebreakerKey,
} from "../tournament/types.ts";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Result of an action that also returns the updated group-stage matches, so the
 * admin UI can refresh its in-memory fixture list without a separate fetch.
 */
export type MatchActionResult =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

function isBracketKind(value: unknown): value is BracketKind {
  return value === "championship" || value === "consolation";
}

async function hasAnyKnockoutFixtures(): Promise<boolean> {
  const [championship, consolation] = await Promise.all([
    getKnockoutMatches("championship"),
    getKnockoutMatches("consolation"),
  ]);
  return championship.length > 0 || consolation.length > 0;
}

/**
 * Generates and persists the tournament setup (participant + group counts and
 * the derived groups). Participants are not touched here. Validates the raw
 * string inputs from the form before persisting.
 */
export async function generateSetupAction(
  participantCountRaw: string,
  groupCountRaw: string,
): Promise<ActionResult> {
  const validation = validateSetupInput(participantCountRaw, groupCountRaw);
  if (!validation.ok) {
    return { ok: false, error: validation.message };
  }

  try {
    await saveTournamentSetup({
      participantCount: validation.participantCount,
      groupCount: validation.groupCount,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save the tournament setup.",
    };
  }
}

/**
 * Persists the edited participants and their assigned teams for the active
 * tournament. The setup must already exist (generate first). Blank-name slots
 * are dropped by the repository; blank teams are stored as unassigned.
 */
export async function saveParticipantsAction(
  entries: Record<number, Entry>,
): Promise<ActionResult> {
  try {
    await saveParticipants(entries);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to save participants.",
    };
  }
}

/**
 * Generates and persists group-stage fixtures for the active tournament.
 *
 * Hard-blocks regeneration while fixtures already exist (the structure is
 * locked) — the administrator must clear fixtures first. Also refuses when the
 * saved setup is not ready (every group needs at least 2 participants). Returns
 * the updated match list so the UI can refresh without a separate fetch.
 */
export async function generateFixturesAction(): Promise<MatchActionResult> {
  try {
    const existing = await getGroupMatches();
    if (isStructurallyLocked(existing)) {
      return {
        ok: false,
        error: "Fixtures already exist. Clear them first to regenerate.",
      };
    }

    const snapshot = await getTournamentSetup();
    if (!snapshot.tournament) {
      return {
        ok: false,
        error: "Generate the tournament setup before generating fixtures.",
      };
    }
    if (!isReadyForFixtures(snapshot)) {
      return {
        ok: false,
        error: "Every group needs at least 2 participants before fixtures can be generated.",
      };
    }

    const rows = buildGroupStageMatches(snapshot);
    await saveGroupFixtures(rows);

    const matches = await getGroupMatches();
    return { ok: true, matches };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate fixtures.",
    };
  }
}

/**
 * Clears all group-stage fixtures (and their scores) for the active tournament.
 * This unlocks participant/group editing. Returns an empty match list.
 */
export async function clearFixturesAction(): Promise<MatchActionResult> {
  try {
    await clearGroupFixtures();
    return { ok: true, matches: [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to clear fixtures.",
    };
  }
}

/**
 * Generates and persists the knockout bracket for the active tournament.
 *
 * Allowed only once the group stage is fully played (so the qualifiers are
 * final) and no group has an unresolved tiebreak. The bracket is seeded from
 * each group's top `qualifiersPerGroup` standings, with byes to the highest
 * seeds and same-group round-1 rematch avoidance. Hard-blocks regeneration
 * while a bracket already exists — clear it first with
 * `clearKnockoutFixturesAction`. Returns the knockout match list.
 */
export async function generateKnockoutFixturesAction(
  bracketKind: BracketKind = "championship",
): Promise<MatchActionResult> {
  if (!isBracketKind(bracketKind)) {
    return { ok: false, error: "Invalid bracket type." };
  }
  try {
    const setup = await getTournamentSetup();
    if (!setup.tournament) {
      return { ok: false, error: "No active tournament found. Generate the setup first." };
    }

    const existing = await getKnockoutMatches(bracketKind);
    if (existing.length > 0) {
      return {
        ok: false,
        error: `The ${bracketKind} bracket has already been generated. Clear it first to regenerate.`,
      };
    }

    const groupMatches = await getGroupMatches();
    if (!isGroupStageComplete(groupMatches)) {
      return {
        ok: false,
        error: "The group stage is not complete yet. Play every group match before generating the knockout bracket.",
      };
    }

    const scoring = {
      winPoints: setup.tournament.winPoints,
      drawPoints: setup.tournament.drawPoints,
      lossPoints: setup.tournament.lossPoints,
    };
    const tiebreakerOrder = setup.tournament.tiebreakerOrder;

    const standingsByGroup = new Map<string, ReturnType<typeof calculateStandings>>();
    const standingsList: ReturnType<typeof calculateStandings>[] = [];
    for (const group of setup.groups) {
      const groupParticipants = setup.participants
        .filter((p) => p.groupId === group.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          drawOrder: p.drawOrder,
          assignedTeamId: null,
          groupId: p.groupId,
        }));
      const standings = calculateStandings(groupMatches, groupParticipants, {
        scoring,
        tiebreakerOrder,
        manualResolutions: setup.manualResolutions,
        groupId: group.id,
      });
      standingsByGroup.set(group.id, standings);
      standingsList.push(standings);
    }

    if (hasUnresolvedStandings(standingsList)) {
      return {
        ok: false,
        error: "Some groups still have unresolved tiebreaks. Resolve them before generating the knockout bracket.",
      };
    }

    const qualifiers =
      bracketKind === "championship"
        ? buildKnockoutQualifiers(
            setup.groups,
            standingsByGroup,
            setup.tournament.qualifiersPerGroup,
          )
        : buildConsolationQualifiers(
            setup.groups,
            standingsByGroup,
            setup.tournament.qualifiersPerGroup,
            setup.participants,
          );
    if (qualifiers.length < 2) {
      return {
        ok: false,
        error: "Not enough qualifiers to build a knockout bracket (need at least 2).",
      };
    }

    const rows = buildKnockoutStageMatches(
      qualifiers,
      setup.tournament.id,
      bracketKind,
    );
    await saveKnockoutFixtures(rows);

    const matches = await getKnockoutMatches(bracketKind);
    return { ok: true, matches };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate the knockout bracket.",
    };
  }
}

/**
 * Clears the knockout bracket (and its scores) for the active tournament.
 * The group stage is untouched. Use this to regenerate the bracket after a
 * rules change. Returns an empty knockout match list.
 */
export async function clearKnockoutFixturesAction(
  bracketKind: BracketKind = "championship",
): Promise<MatchActionResult> {
  if (!isBracketKind(bracketKind)) {
    return { ok: false, error: "Invalid bracket type." };
  }
  try {
    await clearKnockoutFixtures(bracketKind);
    return { ok: true, matches: [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to clear the knockout bracket.",
    };
  }
}

/**
 * Persists a single match's score from raw string inputs.
 *
 * Both blank -> clears the score. Invalid scores (partial, non-integer,
 * negative) are rejected with a friendly error. The repository validates again
 * before writing.
 */
export async function saveMatchScoreAction(
  matchId: string,
  homeRaw: string,
  awayRaw: string,
): Promise<ActionResult> {
  let score;
  try {
    score = parseScore(homeRaw, awayRaw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid score.",
    };
  }

  try {
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error:
          "Clear both knockout brackets before changing a group-stage score.",
      };
    }
    await saveMatchScore(matchId, score);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the score.",
    };
  }
}

/**
 * Persists a single knockout match's score and returns the refreshed knockout
 * match list, so the admin UI can recompute the advanced bracket (the winner
 * feeds the next round) without a separate fetch. Same score rules as
 * `saveMatchScoreAction`.
 */
export async function saveKnockoutScoreAction(
  bracketKind: BracketKind,
  matchId: string,
  homeRaw: string,
  awayRaw: string,
): Promise<MatchActionResult> {
  if (!isBracketKind(bracketKind)) {
    return { ok: false, error: "Invalid bracket type." };
  }
  let score;
  try {
    score = parseScore(homeRaw, awayRaw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid score.",
    };
  }

  if (score != null && score.home === score.away) {
    return {
      ok: false,
      error: "Knockout matches cannot end in a draw.",
    };
  }

  try {
    await saveKnockoutMatchScore(bracketKind, matchId, score);
    const matches = await getKnockoutMatches(bracketKind);
    return { ok: true, matches };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the score.",
    };
  }
}

/**
 * Persists the active tournament's identity metadata (name, edition, date,
 * description). Inputs are strings straight from the admin form; the repository
 * normalizes them (blank name falls back to the default, blank optional fields
 * become `null`). Metadata is editable at any time, even after fixtures are
 * locked.
 */
export async function saveTournamentMetadataAction(
  name: string,
  edition: string,
  date: string,
  description: string,
): Promise<ActionResult> {
  if (typeof name !== "string" || typeof edition !== "string" || typeof date !== "string" || typeof description !== "string") {
    return { ok: false, error: "Invalid metadata input." };
  }
  try {
    await saveTournamentMetadata({ name, edition, date, description });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save tournament metadata.",
    };
  }
}

/**
 * Persists the active tournament's scoring rules, tiebreaker order, and
 * qualifiers-per-group setting.
 *
 * Accepts the raw string scoring inputs from the admin form, the tiebreaker
 * order chosen in the UI, and the qualifiers-per-group count. Scoring values are
 * parsed and validated (integers, blanks fall back to defaults); the tiebreaker
 * order is normalized (unknown/duplicate keys dropped); the qualifiers count is
 * validated as a positive integer (blank falls back to the default of 2). Rules
 * stay editable after group fixtures are locked, but are frozen once either
 * knockout bracket exists because changing them could change its participants.
 */
export async function saveTournamentRulesAction(
  winRaw: string,
  drawRaw: string,
  lossRaw: string,
  tiebreakerOrder: TiebreakerKey[],
  qualifiersPerGroupRaw: string,
): Promise<ActionResult> {
  const parsed = parseScoringRules(winRaw, drawRaw, lossRaw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.message };
  }

  const qualifiersPerGroup = parseQualifiersPerGroup(qualifiersPerGroupRaw);
  if (qualifiersPerGroup == null) {
    return { ok: false, error: "Qualifiers per group must be a whole number of 1 or more." };
  }

  try {
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error: "Clear both knockout brackets before changing tournament rules.",
      };
    }
    await saveTournamentRules(
      parsed.config,
      normalizeTiebreakerOrder(tiebreakerOrder),
      qualifiersPerGroup,
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save tournament rules.",
    };
  }
}

/**
 * Parses the qualifiers-per-group form input into a positive integer.
 *
 * A blank value falls back to the default of 2. Non-integer or non-positive
 * values yield `null` (rejected by the caller with a friendly message).
 */
function parseQualifiersPerGroup(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 2;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Persists (or clears, when `participantOrder` is empty) the administrator's
 * manual tiebreak ordering for one tied cohort within a group. Used by the
 * manual-resolution panel in the admin UI. The order is normalized (de-duped,
 * non-empty ids) by the repository before upserting.
 */
export async function saveManualTiebreakResolutionAction(
  groupId: GroupId,
  cohortKey: string,
  participantOrder: ParticipantId[],
): Promise<ActionResult> {
  if (typeof groupId !== "string" || groupId === "") {
    return { ok: false, error: "A group is required." };
  }
  if (typeof cohortKey !== "string" || cohortKey === "") {
    return { ok: false, error: "A cohort is required." };
  }
  if (!Array.isArray(participantOrder)) {
    return { ok: false, error: "Participant order must be a list." };
  }
  try {
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error:
          "Clear both knockout brackets before changing a manual tiebreak.",
      };
    }
    await saveManualTiebreakResolution(groupId, cohortKey, participantOrder);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save the manual tiebreak.",
    };
  }
}
