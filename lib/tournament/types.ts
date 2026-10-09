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
 * Identifies an independent knockout bracket. Widened from the legacy
 * `"championship" | "consolation"` union to free-form `string` so a tournament
 * can define arbitrarily many named brackets (e.g. "Championship", "Plate",
 * "Shield"). The stored value is the *slugified* advancement-destination name
 * (see `slugifyBracketName` in `setup.ts`), which keeps it stable across
 * display-name edits and safe for use in match-id namespacing.
 */
export type BracketKind = string;

/**
 * How a knockout destination selects its qualifiers.
 *
 *   - `"positions"` (default) — take a per-group standing-position range
 *     `[fromPosition, toPosition]` from every group. This is the legacy model
 *     and the behaviour of every tournament whose storage predates the
 *     cross-group feature.
 *   - `"bestX"` — take the `count` best finishers at a given standing
 *     `position` across the configured `groups`, ranked by `strategy` (see
 *     `CrossGroupStrategy`). The cross-group ranking is implemented in
 *     `lib/tournament/cross-group.ts`.
 *
 * Omitting `mode` is equivalent to `"positions"`, which keeps the on-disk
 * representation of existing tournaments unchanged (retrocompatible).
 */
export type AdvancementMode = "positions" | "bestX";

/**
 * The ranking strategy for a `"bestX"` cross-group destination.
 *
 *   - `"per-game"` — rank by average points per game (points / played), then
 *     goal difference per game, then goals for per game. Fair across groups
 *     that have played a different number of matches (e.g. uneven group sizes).
 *   - `"raw"` — rank by raw standings totals: points, then goal difference,
 *     then goals for. Simple but unfair when groups have played a different
 *     number of matches.
 *   - `"gate"` — block selection while any candidate group is unresolved or
 *     tied at the selection boundary, then require a cross-group manual
 *     resolution before the slot is filled.
 *   - `"playoff"` — resolve a tie at the selection boundary with a single
 *     head-to-head match, but only when the point gap between the tied
 *     finishers is within `playoffThreshold`.
 */
export type CrossGroupStrategy = "per-game" | "raw" | "gate" | "playoff";

/**
 * One knockout destination in the advancement configuration.
 *
 *   - `name` — the human-readable bracket name (e.g. "Championship", "Plate").
 *   - `fromPosition` / `toPosition` — the inclusive 1-based standing-position
 *     range (within each group) that qualifies for this bracket in
 *     `"positions"` mode. e.g. `fromPosition: 1, toPosition: 2` takes the top 2
 *     from every group. Ignored in `"bestX"` mode (kept as positive integers
 *     only so the type stays backward-compatible with stored data).
 *
 * In `"positions"` mode (the default), a standing position that falls outside
 * every destination's range is *eliminated* (no knockout bracket). There is no
 * "rest" wildcard — uncovered positions are simply implicit eliminations. The
 * upper bound for `toPosition` is the largest group size in the tournament
 * (`maxGroupSize`), provided by the persistence layer so the admin UI can bound
 * the input and the standings view can tell which positions are eliminated.
 *
 * In `"bestX"` mode the destination instead takes the `count` best finishers at
 * standing `position` across the configured `groups` (all groups when `groups`
 * is omitted), ranked by `strategy`. `allowOverlap` lets a `"bestX"` destination pick finishers
 * already claimed by a `"positions"` destination (e.g. a repechaje that may
 * reuse a group winner under unusual configs). `playoffThreshold` configures
 * the `"playoff"` strategy.
 */
export interface AdvancementDestination {
  name: string;
  fromPosition: number;
  toPosition: number;
  /** Selection mode; omit for the legacy `"positions"` behaviour. */
  mode?: AdvancementMode;
  /**
   * `"bestX"` mode: the single standing position (in each group) that
   * candidates must finish in (e.g. `3` = each group's 3rd-place finisher).
   * Ignored in `"positions"` mode.
   */
  position?: number;
  /** `"bestX"` mode: how many finishers to take across the configured groups. */
  count?: number;
  /** `"bestX"` mode: ranking strategy (defaults to `"per-game"`). */
  strategy?: CrossGroupStrategy;
  /** `"bestX"` mode: group labels to consider; omit for all groups. */
  groups?: string[];
  /** `"bestX"` mode: allow picking finishers already claimed by another bracket. */
  allowOverlap?: boolean;
  /** `"playoff"` strategy: max point gap that triggers a head-to-head match. */
  playoffThreshold?: number;
}

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
  /** Null for group matches; identifies the independent knockout bracket. */
  bracketKind?: BracketKind | null;
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
