/** Persistence for the active tournament's public rule cards. */

import { randomUUID } from "node:crypto";

import { asc, eq, max } from "drizzle-orm";

import { db } from "./client.ts";
import { tournamentRules } from "./schema.ts";

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
    .orderBy(asc(tournamentRules.sortOrder), asc(tournamentRules.id));
}

export async function createTournamentRule(
  title: string,
  body: string,
): Promise<string> {
  const [{ highestOrder }] = await db
    .select({ highestOrder: max(tournamentRules.sortOrder) })
    .from(tournamentRules);

  const id = `rule:${randomUUID()}`;
  await db.insert(tournamentRules).values({
    id,
    title,
    body,
    sortOrder: (highestOrder ?? 0) + 1,
  });
  return id;
}

export async function updateTournamentRule(
  id: string,
  title: string,
  body: string,
): Promise<void> {
  await db
    .update(tournamentRules)
    .set({ title, body })
    .where(eq(tournamentRules.id, id));
}

export async function deleteTournamentRule(id: string): Promise<void> {
  await db
    .delete(tournamentRules)
    .where(eq(tournamentRules.id, id));
}
