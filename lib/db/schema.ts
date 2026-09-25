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

import { integer, text, pgTable, index, uniqueIndex } from "drizzle-orm/pg-core";

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
export const BRACKET_KINDS = ["championship", "consolation"] as const;

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
  // Tournament identity metadata. All optional except `name`; a fresh setup
  // keeps the default name and leaves edition/date/description blank until the
  // administrator fills them in. Stored as plain `text` to stay consistent with
  // the text-based pattern used elsewhere (and to avoid date/timezone friction
  // with the Neon HTTP driver); `date` holds an ISO `YYYY-MM-DD` string.
  edition: text("edition"),
  date: text("date"),
  description: text("description"),
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
  // How many participants qualify from each group into the knockout stage
  // (default 2 = group winner + runner-up). Tournament-owned so an organizer
  // can tune the bracket size; editable via the rules form.
  qualifiersPerGroup: integer("qualifiers_per_group").notNull().default(2),
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
    bracketKind: text("bracket_kind", { enum: BRACKET_KINDS }),
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
    // For knockout matches: the home (higher) bracket seed of the match, used
    // for stable ordering and seed display. Null for group-stage matches and
    // for knockout matches whose home slot is still TBD.
    knockoutSeed: integer("knockout_seed"),
  },
  (table) => [
    index("matches_tournament_id_idx").on(table.tournamentId),
    index("matches_group_id_idx").on(table.groupId),
  ],
);

// Administrator's manual tiebreak ordering, one row per (tournament, group,
// cohort). `participant_order` is a JSON-encoded `ParticipantId[]` (best
// first), used by the `manual` tiebreaker when a tied cohort is reached. Stored
// as plain `text` to stay consistent with the text-based pattern used for
// `tiebreaker_order`. The deterministic id keeps saves idempotent (one row per
// cohort). `cohort_key` is `cohortKeyOf(participantIds)` (sorted ids joined by
// ",") so a single group can hold one resolution per distinct tied cohort; it
// is nullable so the group-scoped -> cohort-scoped migration can add the column
// without backfilling (legacy NULL rows are ignored by the resolver).
export const manualTiebreakResolutions = pgTable(
  "manual_tiebreak_resolutions",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    participantOrder: text("participant_order").notNull(),
    cohortKey: text("cohort_key"),
  },
  (table) => [
    uniqueIndex("manual_tiebreak_resolutions_cohort_unique").on(
      table.tournamentId,
      table.groupId,
      table.cohortKey,
    ),
  ],
);
