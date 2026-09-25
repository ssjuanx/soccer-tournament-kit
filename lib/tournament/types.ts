/**
 * Domain model for a soccer tournament.
 *
 * The model keeps stored facts (participant identity, team assignment, group
 * placement, match pairings, scores) separate from derived values (standings,
 * qualification, knockout advancement). Derived values are computed from the
 * facts rather than stored in the core model.
 *
 * The participant count and group count are both configurable, so the model is
 * not limited to a fixed number of players or a fixed number of groups.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Stable identifier for a tournament. */
export type TournamentId = string;
export type ParticipantId = string;
export type GroupId = string;
export type MatchId = string;
export type TeamId = string;

// ---------------------------------------------------------------------------
// Soccer scoring
// ---------------------------------------------------------------------------

/** A match score entered by the administrator. Null until the match is played. */
export interface MatchScore {
  home: number;
  away: number;
}

// Soccer group-stage default points (Win = 3, Draw = 1, Loss = 0) live in
// `standings.ts`, the only module that applies them. The actual values are now
// tournament-owned configuration (see `ScoringConfig` below); `standings.ts`
// holds the defaults. Keeping this file limited to types only.

/**
 * Points awarded for a match result. Tournament-owned so an organizer can
 * tune scoring (e.g. win = 2 for a league that de-emphasizes winning). Values
 * are integers; defaults are 3 / 1 / 0.
 */
export interface ScoringConfig {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
}

/**
 * A configurable group-stage tiebreaker key.
 *
 *   - `goal_difference` / `goals_for` — statistical, applied to the whole
 *     group's accumulated numbers.
 *   - `head_to_head` — re-ranks a tied cohort using a mini-table built only
 *     from the matches played between the cohort's members (requires every
 *     pair in the cohort to have a completed match, otherwise it is skipped).
 *   - `manual` — the administrator's explicit ordering of a group. It is
 *     terminal: when reached, either the stored manual order fully resolves
 *     the cohort, or the cohort is left *unresolved* (shared positions) until
 *     the admin provides one. It should therefore be configured last.
 *
 * Points are always the primary sort and original draw order is always the
 * final deterministic fallback (when no `manual` tiebreaker intervenes).
 */
export type TiebreakerKey =
  | "goal_difference"
  | "goals_for"
  | "head_to_head"
  | "manual";

/**
 * The ordered list of tiebreakers applied (after points, before draw order).
 * A subset/permutation of `TiebreakerKey[]`; the engine applies them in the
 * given order and falls back to draw order if still tied (unless `manual` is
 * reached without a stored resolution, in which case the tie is unresolved).
 */
export type TiebreakerOrder = TiebreakerKey[];

/**
 * An administrator's manual tiebreak resolution for one tied cohort within a
 * group: an explicit ordered list of the cohort's participant ids, best first.
 * `cohortKey` is `cohortKeyOf(cohortParticipantIds)` (sorted ids joined by ",")
 * and identifies exactly which tied cohort this resolution targets, so a group
 * can hold several resolutions — one per distinct tied cohort. When the
 * `manual` tiebreaker is reached for a cohort, the cohort's members are ordered
 * by their position in the matching resolution. If no resolution is stored for
 * that cohort (or any cohort member is missing from the order), the cohort is
 * marked unresolved.
 */
export interface ManualTiebreakResolution {
  groupId: GroupId;
  cohortKey: string;
  participantOrder: ParticipantId[];
}

// ---------------------------------------------------------------------------
// Tournament lifecycle
// ---------------------------------------------------------------------------

export type TournamentStatus =
  | "draft"
  | "check_in"
  | "group_stage"
  | "knockout_stage"
  | "completed";

// ---------------------------------------------------------------------------
// Tournament and configuration
// ---------------------------------------------------------------------------

/**
 * Tournament sizing. Both values are configurable and are not limited to the
 * default 12–16 players or 4 groups.
 */
export interface TournamentConfig {
  participantCount: number;
  groupCount: number;
}

export interface Tournament {
  id: TournamentId;
  name: string;
  config: TournamentConfig;
  status: TournamentStatus;
}

// ---------------------------------------------------------------------------
// Teams and participants
// ---------------------------------------------------------------------------

/** A soccer team that a participant can be assigned during the team draw. */
export interface Team {
  id: TeamId;
  name: string;
}

/**
 * A single player in the tournament.
 *
 * Stored facts only:
 * - `drawOrder` is the position in the manual participant draw.
 * - `assignedTeamId` is null until the administrator completes the team draw.
 * - `groupId` is null until the participant is placed into a group.
 */
export interface Participant {
  id: ParticipantId;
  name: string;
  drawOrder: number;
  assignedTeamId: TeamId | null;
  groupId: GroupId | null;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** A round-robin group in the group stage (e.g. label "A", "B"). */
export interface Group {
  id: GroupId;
  label: string;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export type MatchStage = "group" | "knockout";

/**
 * A round within the single-elimination knockout stage. Enumerated from the
 * largest supported bracket down to the final, so the model scales beyond the
 * default small tournament.
 */
export type KnockoutRound =
  | "round_of_64"
  | "round_of_32"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "final";

/**
 * A single match in either stage.
 *
 * Stored facts only:
 * - `groupId` is set for group-stage matches, null for knockout matches.
 * - `knockoutRound` is set for knockout matches, null for group-stage matches.
 * - `homeParticipantId` / `awayParticipantId` are null when a knockout slot is
 *   still to be determined (TBD).
 * - `score` is null until the match is played.
 */
export interface Match {
  id: MatchId;
  stage: MatchStage;
  groupId: GroupId | null;
  knockoutRound: KnockoutRound | null;
  homeParticipantId: ParticipantId | null;
  awayParticipantId: ParticipantId | null;
  score: MatchScore | null;
  /**
   * For knockout matches: the home (higher) bracket seed of the match, used for
   * stable ordering and seed display. Null when the home slot is still TBD.
   * Always null/undefined for group-stage matches.
   */
  knockoutSeed?: number | null;
}

// ---------------------------------------------------------------------------
// Derived standings
// ---------------------------------------------------------------------------

/**
 * One row of a group's standings. Every field is derived from match scores and
 * is never stored in the core model.
 */
export interface StandingRow {
  participantId: ParticipantId;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /**
   * `true` when this row is part of a tied cohort that could not be ordered
   * (the `manual` tiebreaker was reached but no valid resolution was stored).
   * Such rows share a position with the other unresolved cohort members and
   * are displayed as "tiebreak pending" until the administrator resolves them.
   * Always `false` when no `manual` tiebreaker is configured.
   */
  unresolved: boolean;
}

/** A full group standings table, ordered by `position`. */
export type Standing = StandingRow[];