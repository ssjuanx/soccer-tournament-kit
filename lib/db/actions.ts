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
import type { Match } from "../tournament/types.ts";

import {
  buildGroupStageMatches,
  isReadyForFixtures,
  isStructurallyLocked,
  parseScore,
} from "./fixtures.ts";
import {
  clearGroupFixtures,
  getGroupMatches,
  saveGroupFixtures,
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
import type { GroupId, ParticipantId, TiebreakerKey } from "../tournament/types.ts";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Result of an action that also returns the updated group-stage matches, so the
 * admin UI can refresh its in-memory fixture list without a separate fetch.
 */
export type MatchActionResult =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

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
 * Persists the active tournament's scoring rules and tiebreaker order.
 *
 * Accepts the raw string scoring inputs from the admin form and the
 * tiebreaker order chosen in the UI. Scoring values are parsed and validated
 * (integers, blanks fall back to defaults) before persisting; the tiebreaker
 * order is normalized (unknown/duplicate keys dropped). Rules are editable
 * even after fixtures are locked.
 */
export async function saveTournamentRulesAction(
  winRaw: string,
  drawRaw: string,
  lossRaw: string,
  tiebreakerOrder: TiebreakerKey[],
): Promise<ActionResult> {
  const parsed = parseScoringRules(winRaw, drawRaw, lossRaw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.message };
  }

  try {
    await saveTournamentRules(
      parsed.config,
      normalizeTiebreakerOrder(tiebreakerOrder),
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
 * Persists (or clears, when `participantOrder` is empty) the administrator's
 * manual tiebreak ordering for one group. Used by the manual-resolution panel
 * in the admin UI. The order is normalized (de-duplicated, non-empty ids) by
 * the repository before upserting.
 */
export async function saveManualTiebreakResolutionAction(
  groupId: GroupId,
  participantOrder: ParticipantId[],
): Promise<ActionResult> {
  if (typeof groupId !== "string" || groupId === "") {
    return { ok: false, error: "A group is required." };
  }
  if (!Array.isArray(participantOrder)) {
    return { ok: false, error: "Participant order must be a list." };
  }
  try {
    await saveManualTiebreakResolution(groupId, participantOrder);
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