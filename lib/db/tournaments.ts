/**
 * Repository for the active tournament's setup, groups, participants, and
 * assigned teams on Neon Postgres.
 *
 * The app persists a single "active" tournament identified by the constant
 * `ACTIVE_TOURNAMENT_ID`. This keeps the id deterministic (no timestamp) so
 * `getTournamentSetup()` can always load it without a lookup, and the
 * deterministic group/team/participant ids from `setup.ts` keep every save
 * idempotent.
 *
 * Persistence boundary: this module imports the Drizzle `db` client and must
 * only run on the server (Server Components, Server Actions). It is never
 * imported from client code. The Neon HTTP driver does not support
 * interactive transactions, so writes that span multiple tables run as
 * ordered, idempotent statements (upserts, on-conflict-do-nothing, and
 * targeted deletes); reads needed to drive writes happen before the writes.
 *
 * The `matches` table is intentionally untouched here — fixtures are not
 * generated or persisted by this layer.
 */

import { and, asc, eq, notInArray } from "drizzle-orm";

import { db } from "./client.ts";
import { groups, participants, teams, tournaments } from "./schema.ts";
import {
  buildGroupRecords,
  compareGroupLabels,
  getGroupSizes,
  groupIdForDrawOrder,
  normalizeEntriesForSave,
  participantIdFor,
  teamIdFor,
  uniqueTeamNames,
  type Entry,
  type SavedGroup,
  type SavedParticipant,
  type SavedTournament,
  type TournamentSetupSnapshot,
} from "./setup.ts";

/** Deterministic id of the single active tournament. */
export const ACTIVE_TOURNAMENT_ID = "active";

const DEFAULT_TOURNAMENT_NAME = "FC Tournament";

/**
 * Loads the full stored setup of the active tournament.
 *
 * Returns a snapshot with `tournament: null` (and empty groups/participants)
 * when no tournament has been created yet, so the admin UI can start blank.
 * Groups are sorted by their generating index via `compareGroupLabels`, and
 * participants are ordered by draw order. Team names are joined in from the
 * `teams` table (null when a participant has no assigned team).
 */
export async function getTournamentSetup(): Promise<TournamentSetupSnapshot> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, ACTIVE_TOURNAMENT_ID))
    .limit(1);

  if (!tournament) {
    return { tournament: null, groups: [], participants: [] };
  }

  const groupRows = await db
    .select({ id: groups.id, label: groups.label })
    .from(groups)
    .where(eq(groups.tournamentId, ACTIVE_TOURNAMENT_ID));

  const groupList: SavedGroup[] = groupRows
    .map((g) => ({ id: g.id, label: g.label }))
    .sort((a, b) => compareGroupLabels(a.label, b.label));

  const participantRows = await db
    .select({
      id: participants.id,
      name: participants.name,
      drawOrder: participants.drawOrder,
      groupId: participants.groupId,
      teamName: teams.name,
    })
    .from(participants)
    .leftJoin(teams, eq(participants.assignedTeamId, teams.id))
    .where(eq(participants.tournamentId, ACTIVE_TOURNAMENT_ID))
    .orderBy(asc(participants.drawOrder));

  const savedTournament: SavedTournament = {
    id: tournament.id,
    name: tournament.name,
    participantCount: tournament.participantCount,
    groupCount: tournament.groupCount,
    status: tournament.status,
  };

  const savedParticipants: SavedParticipant[] = participantRows.map((p) => ({
    id: p.id,
    name: p.name,
    drawOrder: p.drawOrder,
    teamName: p.teamName,
    groupId: p.groupId,
  }));

  return {
    tournament: savedTournament,
    groups: groupList,
    participants: savedParticipants,
  };
}

/**
 * Persists the active tournament's configuration (participant + group counts)
 * and its groups. Participants are intentionally left untouched so that names
 * and team assignments already entered survive a regenerate.
 *
 * Groups are synced rather than replaced: missing groups are inserted
 * (idempotent via `onConflictDoNothing`) and groups that no longer belong are
 * deleted. This avoids nulling `participants.group_id` for groups that persist
 * across a regenerate (e.g. regenerating with the same counts).
 */
export async function saveTournamentSetup(config: {
  participantCount: number;
  groupCount: number;
}): Promise<void> {
  const desiredGroups = buildGroupRecords(
    ACTIVE_TOURNAMENT_ID,
    config.groupCount,
  );
  const desiredGroupIds = desiredGroups.map((g) => g.id);

  // The Neon HTTP driver does not support interactive transactions, so the
  // writes run as ordered, idempotent statements instead. Each is safe to
  // retry: the tournament row is upserted, groups are inserted with
  // on-conflict-do-nothing, and only stale groups are deleted.
  await db
    .insert(tournaments)
    .values({
      id: ACTIVE_TOURNAMENT_ID,
      name: DEFAULT_TOURNAMENT_NAME,
      participantCount: config.participantCount,
      groupCount: config.groupCount,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: tournaments.id,
      set: {
        participantCount: config.participantCount,
        groupCount: config.groupCount,
      },
    });

  // Insert any missing groups. Existing rows are left untouched so
  // participants already placed into a retained group keep their groupId.
  await db
    .insert(groups)
    .values(
      desiredGroups.map((g) => ({
        id: g.id,
        tournamentId: ACTIVE_TOURNAMENT_ID,
        label: g.label,
      })),
    )
    .onConflictDoNothing({ target: groups.id });

  // Remove groups that no longer belong to this setup. Their participants
  // (if any) have groupId set to null via the ON DELETE SET NULL rule.
  if (desiredGroupIds.length > 0) {
    await db
      .delete(groups)
      .where(
        and(
          eq(groups.tournamentId, ACTIVE_TOURNAMENT_ID),
          notInArray(groups.id, desiredGroupIds),
        ),
      );
  }
}

/**
 * Persists the active tournament's participants and their assigned teams.
 *
 * Participants are replaced: existing rows for the tournament
 * are deleted and the normalized entries are inserted. Each participant's
 * `groupId` is recomputed from its draw order and the current group sizes, so
 * it always matches the persisted group structure.
 *
 * Teams are deduplicated by name within the tournament: existing teams are
 * reused, missing ones are created, and teams no longer referenced by any
 * participant are removed so the table stays tidy across edits.
 *
 * Throws when no active tournament exists (the setup must be generated first).
 */
export async function saveParticipants(
  entries: Record<number, Entry>,
): Promise<void> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, ACTIVE_TOURNAMENT_ID))
    .limit(1);

  if (!tournament) {
    throw new Error(
      "No active tournament found. Generate the setup before saving participants.",
    );
  }

  const groupSizes = getGroupSizes(
    tournament.participantCount,
    tournament.groupCount,
  );

  const normalized = normalizeEntriesForSave(
    entries,
    tournament.participantCount,
  );
  const teamNames = uniqueTeamNames(normalized);

  // Resolve existing teams by name within this tournament. Reads happen before
  // the ordered writes below (the Neon HTTP driver has no transactions).
  const existingTeams =
    teamNames.length === 0
      ? []
      : await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(eq(teams.tournamentId, ACTIVE_TOURNAMENT_ID));

  const teamIdByName = new Map<string, string>();
  for (const t of existingTeams) {
    teamIdByName.set(t.name, t.id);
  }
  const teamsToCreate: { id: string; tournamentId: string; name: string }[] = [];
  for (const name of teamNames) {
    if (!teamIdByName.has(name)) {
      const id = teamIdFor(ACTIVE_TOURNAMENT_ID, name);
      teamIdByName.set(name, id);
      teamsToCreate.push({ id, tournamentId: ACTIVE_TOURNAMENT_ID, name });
    }
  }
  const referencedTeamIds = [...teamIdByName.values()];

  // The Neon HTTP driver has no transaction support, so writes run as ordered,
  // idempotent statements. Teams are created before participants reference
  // them, participants are replaced, then orphaned teams are removed.
  if (teamsToCreate.length > 0) {
    await db.insert(teams).values(teamsToCreate);
  }

  // Replace participants for this tournament.
  await db
    .delete(participants)
    .where(eq(participants.tournamentId, ACTIVE_TOURNAMENT_ID));

  if (normalized.length > 0) {
    await db.insert(participants).values(
      normalized.map((p) => ({
        id: participantIdFor(ACTIVE_TOURNAMENT_ID, p.drawOrder),
        tournamentId: ACTIVE_TOURNAMENT_ID,
        name: p.name,
        drawOrder: p.drawOrder,
        assignedTeamId:
          p.team === "" ? null : (teamIdByName.get(p.team) ?? null),
        groupId: groupIdForDrawOrder(
          ACTIVE_TOURNAMENT_ID,
          p.drawOrder,
          groupSizes,
        ),
      })),
    );
  }

  // Remove teams no longer referenced by any participant.
  if (referencedTeamIds.length > 0) {
    await db
      .delete(teams)
      .where(
        and(
          eq(teams.tournamentId, ACTIVE_TOURNAMENT_ID),
          notInArray(teams.id, referencedTeamIds),
        ),
      );
  } else {
    await db.delete(teams).where(eq(teams.tournamentId, ACTIVE_TOURNAMENT_ID));
  }
}