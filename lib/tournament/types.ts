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

// Soccer group-stage points (Win = 3, Draw = 1, Loss = 0) live in `standings.ts`,
// the only module that applies them. Keeping this file limited to types only.

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
}

/** A full group standings table, ordered by `position`. */
export type Standing = StandingRow[];