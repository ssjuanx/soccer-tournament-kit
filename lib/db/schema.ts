/**
 * Drizzle schema for the FC Tournament database on Neon Postgres.
 *
 * The tables persist the "stored facts" of the domain model defined in
 * `lib/tournament/types.ts` (participant identity, team assignment, group
 * placement, match pairings, scores). Derived values (standings, qualification,
 * knockout advancement) are never stored here — they are recomputed by the
 * persistence-free engine in `lib/tournament/`.
 *
 * Scoping: a tournament owns its teams, participants, groups, and matches via a
 * `tournament_id` foreign key, so the database supports more than one tournament
 * over time. Child rows cascade-delete with their tournament.
 *
 * Identifiers are `text` to match the string IDs used throughout the domain
 * model. Enums are stored as `text` with TS-level union types (not native
 * Postgres enums) to avoid a migration every time a value is added; the value
 * lists below mirror the unions in `types.ts` and must stay in sync.
 */

import { integer, text, pgTable, index } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums (text columns with TS-level union types)
// ---------------------------------------------------------------------------

export const TOURNAMENT_STATUSES = [
  "draft",
  "check_in",
  "group_stage",
  "knockout_stage",
  "completed",
] as const;

export const MATCH_STAGES = ["group", "knockout"] as const;

export const KNOCKOUT_ROUNDS = [
  "round_of_64",
  "round_of_32",
  "round_of_16",
  "quarter_final",
  "semi_final",
  "final",
] as const;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const tournaments = pgTable("tournaments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  participantCount: integer("participant_count").notNull(),
  groupCount: integer("group_count").notNull(),
  status: text("status", { enum: TOURNAMENT_STATUSES })
    .notNull()
    .default("draft"),
  // Tournament-owned scoring rules. Defaults match standard soccer (3/1/0)
  // so existing rows and a fresh setup behave as before. Editable after
  // fixtures/participants are locked via `saveTournamentRules`.
  winPoints: integer("win_points").notNull().default(3),
  drawPoints: integer("draw_points").notNull().default(1),
  lossPoints: integer("loss_points").notNull().default(0),
  // JSON-encoded tiebreaker order (a subset of TiebreakerKey[], e.g.
  // `["goal_difference","goals_for"]`). Stored as plain `text` (not `jsonb`)
  // to stay consistent with the text-based-enum pattern and avoid Neon HTTP
  // driver friction. Null means "use the default order".
  tiebreakerOrder: text("tiebreaker_order"),
});

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (table) => [index("groups_tournament_id_idx").on(table.tournamentId)],
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [index("teams_tournament_id_idx").on(table.tournamentId)],
);

export const participants = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    drawOrder: integer("draw_order").notNull(),
    assignedTeamId: text("assigned_team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    groupId: text("group_id").references(() => groups.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("participants_tournament_id_idx").on(table.tournamentId),
    index("participants_group_id_idx").on(table.groupId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: MATCH_STAGES }).notNull(),
    groupId: text("group_id").references(() => groups.id, {
      onDelete: "set null",
    }),
    knockoutRound: text("knockout_round", { enum: KNOCKOUT_ROUNDS }),
    homeParticipantId: text("home_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    awayParticipantId: text("away_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    // Null until the match is played; flattened from the domain `MatchScore`.
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
  },
  (table) => [
    index("matches_tournament_id_idx").on(table.tournamentId),
    index("matches_group_id_idx").on(table.groupId),
  ],
);