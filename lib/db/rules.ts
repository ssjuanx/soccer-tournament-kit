/** Persistence for the active tournament's public rule cards. */

import { randomUUID } from "node:crypto";

import { and, asc, eq, max } from "drizzle-orm";

import { db } from "./client.ts";
import { tournamentRules } from "./schema.ts";
import { ACTIVE_TOURNAMENT_ID } from "./tournaments.ts";

export interface TournamentRule {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
}

export async function getTournamentRules(): Promise<TournamentRule[]> {
  return db
    .select({
      id: tournamentRules.id,
      title: tournamentRules.title,
      body: tournamentRules.body,
      sortOrder: tournamentRules.sortOrder,
    })
    .from(tournamentRules)
    .where(eq(tournamentRules.tournamentId, ACTIVE_TOURNAMENT_ID))
    .orderBy(asc(tournamentRules.sortOrder), asc(tournamentRules.id));
}

export async function createTournamentRule(
  title: string,
  body: string,
): Promise<void> {
  const [{ highestOrder }] = await db
    .select({ highestOrder: max(tournamentRules.sortOrder) })
    .from(tournamentRules)
    .where(eq(tournamentRules.tournamentId, ACTIVE_TOURNAMENT_ID));

  await db.insert(tournamentRules).values({
    id: `${ACTIVE_TOURNAMENT_ID}:rule:${randomUUID()}`,
    tournamentId: ACTIVE_TOURNAMENT_ID,
    title,
    body,
    sortOrder: (highestOrder ?? 0) + 1,
  });
}

export async function updateTournamentRule(
  id: string,
  title: string,
  body: string,
): Promise<void> {
  await db
    .update(tournamentRules)
    .set({ title, body })
    .where(
      and(
        eq(tournamentRules.id, id),
        eq(tournamentRules.tournamentId, ACTIVE_TOURNAMENT_ID),
      ),
    );
}

export async function deleteTournamentRule(id: string): Promise<void> {
  await db
    .delete(tournamentRules)
    .where(
      and(
        eq(tournamentRules.id, id),
        eq(tournamentRules.tournamentId, ACTIVE_TOURNAMENT_ID),
      ),
    );
}
