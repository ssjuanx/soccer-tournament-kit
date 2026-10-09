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
import { getGroupSizes } from "../tournament/groups.ts";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { calculateStandings } from "../tournament/standings.ts";
import type { Match } from "../tournament/types.ts";

import {
  buildGroupStageMatches,
  buildQualifiers,
  buildKnockoutStageMatches,
  isGroupStageComplete,
  isReadyForFixtures,
  isStructurallyLocked,
  hasUnresolvedStandings,
  parseScore,
  type ParsedScore,
} from "./fixtures.ts";
import {
  clearGroupFixtures,
  clearKnockoutFixtures,
  getGroupMatches,
  getKnockoutMatches,
  hasAnyKnockoutMatches,
  saveGroupFixtures,
  saveKnockoutFixtures,
  saveKnockoutMatchScore,
  saveMatchScore,
} from "./matches.ts";
import {
  createTournament,
  getTournamentSetup,
  saveManualTiebreakResolution,
  saveParticipants,
  saveTournamentMetadata,
  saveTournamentRules,
  saveTournamentSetup,
  saveAdvancement,
} from "./tournaments.ts";
import {
  type Entry,
  normalizeTiebreakerOrder,
  parseScoringRules,
  slugifyBracketName,
  validateAdvancement,
  type AdvancementDestination,
} from "./setup.ts";
import {
  createTournamentRule,
  deleteTournamentRule,
  getTournamentRules,
  updateTournamentRule,
  type TournamentRule,
} from "./rules.ts";
import type {
  GroupId,
  ParticipantId,
  TiebreakerKey,
} from "../tournament/types.ts";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type RulesActionResult =
  | { ok: true; rules: TournamentRule[] }
  | { ok: false; error: string };

function normalizeRuleInput(
  title: string,
  body: string,
): { ok: true; title: string; body: string } | { ok: false; error: string } {
  if (typeof title !== "string" || typeof body !== "string") {
    return { ok: false, error: "Invalid rule input." };
  }
  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  if (!normalizedTitle || !normalizedBody) {
    return { ok: false, error: "A rule needs both a title and description." };
  }
  if (normalizedTitle.length > 120 || normalizedBody.length > 2000) {
    return { ok: false, error: "Keep the title under 120 characters and the description under 2,000." };
  }
  return { ok: true, title: normalizedTitle, body: normalizedBody };
}

async function isAdminActionAuthorized(): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return process.env.NODE_ENV === "development";
  const authorization = (await headers()).get("authorization");
  const expected = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  return authorization === expected;
}

export async function createTournamentRuleAction(
  title: string,
  body: string,
): Promise<RulesActionResult> {
  if (!(await isAdminActionAuthorized())) {
    return { ok: false, error: "Administrator authentication required." };
  }
  const input = normalizeRuleInput(title, body);
  if (!input.ok) return input;
  try {
    await createTournamentRule(input.title, input.body);
    return { ok: true, rules: await getTournamentRules() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to create the rule.",
    };
  }
}

export async function updateTournamentRuleAction(
  id: string,
  title: string,
  body: string,
): Promise<RulesActionResult> {
  if (!(await isAdminActionAuthorized())) {
    return { ok: false, error: "Administrator authentication required." };
  }
  if (typeof id !== "string" || id === "") {
    return { ok: false, error: "Invalid rule." };
  }
  const input = normalizeRuleInput(title, body);
  if (!input.ok) return input;
  try {
    await updateTournamentRule(id, input.title, input.body);
    return { ok: true, rules: await getTournamentRules() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update the rule.",
    };
  }
}

export async function deleteTournamentRuleAction(
  id: string,
): Promise<RulesActionResult> {
  if (!(await isAdminActionAuthorized())) {
    return { ok: false, error: "Administrator authentication required." };
  }
  if (typeof id !== "string" || id === "") {
    return { ok: false, error: "Invalid rule." };
  }
  try {
    await deleteTournamentRule(id);
    return { ok: true, rules: await getTournamentRules() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete the rule.",
    };
  }
}

/**
 * Updates several public rules in a single request. Each entry is a full
 * title/body pair for an existing rule id; only rules whose draft differs from
 * the saved value need to be sent. All inputs are validated up front so nothing
 * is persisted on a partial failure. Returns the refreshed rule list.
 */
export async function updateTournamentRulesBulkAction(
  changes: { id: string; title: string; body: string }[],
): Promise<RulesActionResult> {
  if (!(await isAdminActionAuthorized())) {
    return { ok: false, error: "Administrator authentication required." };
  }
  if (!Array.isArray(changes)) {
    return { ok: false, error: "Invalid changes." };
  }
  const normalized: { id: string; title: string; body: string }[] = [];
  for (const change of changes) {
    if (
      change == null ||
      typeof change !== "object" ||
      typeof change.id !== "string" ||
      change.id === ""
    ) {
      return { ok: false, error: "Invalid rule." };
    }
    const input = normalizeRuleInput(change.title, change.body);
    if (!input.ok) return input;
    normalized.push({ id: change.id, title: input.title, body: input.body });
  }
  try {
    for (const { id, title, body } of normalized) {
      await updateTournamentRule(id, title, body);
    }
    return { ok: true, rules: await getTournamentRules() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the rules.",
    };
  }
}

/**
 * Result of an action that also returns the updated group-stage matches, so the
 * admin UI can refresh its in-memory fixture list without a separate fetch.
 */
export type MatchActionResult =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

function isValidBracketSlug(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

async function hasAnyKnockoutFixtures(): Promise<boolean> {
  return hasAnyKnockoutMatches();
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
 * the advancement destination matching `bracketSlug` (the slugified bracket
 * name), with byes to the highest seeds and same-group round-1 rematch
 * avoidance. Hard-blocks regeneration while a bracket already exists — clear it
 * first with `clearKnockoutFixturesAction`. Returns the knockout match list.
 */
export async function generateKnockoutFixturesAction(
  bracketSlug: string,
): Promise<MatchActionResult> {
  if (!isValidBracketSlug(bracketSlug)) {
    return { ok: false, error: "Invalid bracket." };
  }
  try {
    const setup = await getTournamentSetup();
    if (!setup.tournament) {
      return { ok: false, error: "No active tournament found. Generate the setup first." };
    }

    const advancement = setup.tournament.advancement;
    const destIndex = advancement.findIndex(
      (d) => slugifyBracketName(d.name) === bracketSlug,
    );
    if (destIndex < 0) {
      return { ok: false, error: `No advancement destination matches "${bracketSlug}".` };
    }
    const destName = advancement[destIndex].name;

    const existing = await getKnockoutMatches(bracketSlug);
    if (existing.length > 0) {
      return {
        ok: false,
        error: `The ${destName} bracket has already been generated. Clear it first to regenerate.`,
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

    const drawOrderByParticipant = new Map<ParticipantId, number>();
    for (const p of setup.participants) {
      drawOrderByParticipant.set(p.id as ParticipantId, p.drawOrder);
    }
    const qualifiers = buildQualifiers(
      setup.groups,
      standingsByGroup,
      advancement,
      destIndex,
      drawOrderByParticipant,
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
      bracketSlug,
    );
    await saveKnockoutFixtures(rows);

    const matches = await getKnockoutMatches(bracketSlug);
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
  bracketSlug: string,
): Promise<MatchActionResult> {
  if (!isValidBracketSlug(bracketSlug)) {
    return { ok: false, error: "Invalid bracket." };
  }
  try {
    await clearKnockoutFixtures(bracketSlug);
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
          "Clear all knockout brackets before changing a group-stage score.",
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
  bracketSlug: string,
  matchId: string,
  homeRaw: string,
  awayRaw: string,
): Promise<MatchActionResult> {
  if (!isValidBracketSlug(bracketSlug)) {
    return { ok: false, error: "Invalid bracket." };
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
    await saveKnockoutMatchScore(bracketSlug, matchId, score);
    const matches = await getKnockoutMatches(bracketSlug);
    return { ok: true, matches };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the score.",
    };
  }
}

/**
 * Persists several group-stage scores in a single request. Each entry is a raw
 * score pair (strings straight from the admin inputs); both blank clears that
 * match's score. Same per-score rules as `saveMatchScoreAction`, and the same
 * guard: group-stage scores are frozen once either knockout bracket exists.
 *
 * Only matches whose inputs differ from their persisted scores need to be sent,
 * but re-sending an unchanged value is harmless. Returns the refreshed
 * group-stage match list so the admin UI can resync its inputs.
 */
export async function saveGroupScoresAction(
  scores: { matchId: string; home: string; away: string }[],
): Promise<MatchActionResult> {
  if (!Array.isArray(scores)) {
    return { ok: false, error: "Invalid scores." };
  }
  const parsed: { matchId: string; score: ParsedScore }[] = [];
  for (const entry of scores) {
    if (
      entry == null ||
      typeof entry !== "object" ||
      typeof entry.matchId !== "string" ||
      entry.matchId === "" ||
      typeof entry.home !== "string" ||
      typeof entry.away !== "string"
    ) {
      return { ok: false, error: "Invalid score entry." };
    }
    let score: ParsedScore;
    try {
      score = parseScore(entry.home, entry.away);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid score.",
      };
    }
    parsed.push({ matchId: entry.matchId, score });
  }

  try {
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error:
          "Clear all knockout brackets before changing a group-stage score.",
      };
    }
    for (const { matchId, score } of parsed) {
      await saveMatchScore(matchId, score);
    }
    return { ok: true, matches: await getGroupMatches() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to save the scores.",
    };
  }
}

/**
 * Persists several knockout scores for one bracket in a single request. Same
 * per-score rules as `saveKnockoutScoreAction` (knockout matches cannot draw).
 * Returns the refreshed knockout match list for that bracket so the admin UI
 * can recompute the advanced rounds (each winner feeds the next) without a
 * separate fetch.
 */
export async function saveKnockoutScoresAction(
  bracketSlug: string,
  scores: { matchId: string; home: string; away: string }[],
): Promise<MatchActionResult> {
  if (!isValidBracketSlug(bracketSlug)) {
    return { ok: false, error: "Invalid bracket." };
  }
  if (!Array.isArray(scores)) {
    return { ok: false, error: "Invalid scores." };
  }
  const parsed: { matchId: string; score: ParsedScore }[] = [];
  for (const entry of scores) {
    if (
      entry == null ||
      typeof entry !== "object" ||
      typeof entry.matchId !== "string" ||
      entry.matchId === "" ||
      typeof entry.home !== "string" ||
      typeof entry.away !== "string"
    ) {
      return { ok: false, error: "Invalid score entry." };
    }
    let score: ParsedScore;
    try {
      score = parseScore(entry.home, entry.away);
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
    parsed.push({ matchId: entry.matchId, score });
  }

  try {
    for (const { matchId, score } of parsed) {
      await saveKnockoutMatchScore(bracketSlug, matchId, score);
    }
    return { ok: true, matches: await getKnockoutMatches(bracketSlug) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to save the scores.",
    };
  }
}

/**
 * Creates the active tournament with identity metadata and zeroed participant/
 * group counts — the first step of the admin flow. Once this succeeds the admin
 * tabs are revealed (they require an existing tournament). The database primary
 * key on the deterministic active id rejects a second creation, so no code guard
 * is needed. Inputs are strings from the create form; the name is required
 * (rejected here if blank/whitespace), while edition/date/description are
 * optional and normalized to `null` when blank by the repository. Revalidates
 * `/admin` so the server component re-reads the setup and the tabs appear after
 * the client refreshes.
 */
export async function createTournamentAction(
  name: string,
  edition: string,
  date: string,
  description: string,
): Promise<ActionResult> {
  if (typeof name !== "string" || typeof edition !== "string" || typeof date !== "string" || typeof description !== "string") {
    return { ok: false, error: "Invalid metadata input." };
  }
  if (name.trim() === "") {
    return { ok: false, error: "Name is required." };
  }
  try {
    await createTournament({ name, edition, date, description });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create the tournament.",
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
 * Accepts the raw string scoring inputs from the admin form and the tiebreaker
 * order chosen in the UI. Scoring values are parsed and validated (integers,
 * blanks fall back to defaults); the tiebreaker order is normalized (unknown/
 * duplicate keys dropped). Scoring stays editable after group fixtures are
 * locked, but is frozen once any knockout bracket exists because changing the
 * tiebreaker order could change a bracket's participants.
 *
 * Advancement is persisted separately via {@link saveAdvancementAction} so the
 * "Scoring & tiebreakers" and "Knockout advancement" sections save independently.
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
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error: "Clear all knockout brackets before changing tournament rules.",
      };
    }
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
 * Persists only the active tournament's knockout advancement configuration.
 *
 * Accepts the advancement destination list edited in the "Knockout advancement"
 * section. The list is validated (unique slugs, positive integer position ranges
 * with `fromPosition <= toPosition`, no overlapping ranges, and `toPosition`
 * bounded by the tournament's largest group size). Like the scoring rules,
 * advancement stays editable after group fixtures are locked but is frozen once
 * any knockout bracket exists because changing it could change a bracket's
 * participants.
 */
export async function saveAdvancementAction(
  advancement: AdvancementDestination[],
): Promise<ActionResult> {
  // Bound `toPosition` inputs against the tournament's largest group size so a
  // bracket can't claim a standing position no group will ever have. Computed
  // from the persisted setup (advancement is editable only while no knockout
  // bracket exists, so the group sizes are already locked in).
  const setup = await getTournamentSetup();
  const tour = setup.tournament;
  const maxGroupSize =
    tour && tour.participantCount > 0 && tour.groupCount > 0
      ? Math.max(...getGroupSizes(tour.participantCount, tour.groupCount))
      : undefined;

  const validated = validateAdvancement(advancement, maxGroupSize);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  try {
    if (await hasAnyKnockoutFixtures()) {
      return {
        ok: false,
        error: "Clear all knockout brackets before changing advancement.",
      };
    }
    await saveAdvancement(validated.advancement);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save advancement.",
    };
  }
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
          "Clear all knockout brackets before changing a manual tiebreak.",
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
