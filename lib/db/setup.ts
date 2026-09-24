/**
 * Pure mapping/validation helpers for the tournament persistence layer.
 *
 * Everything here is framework-agnostic and free of any database import, so it
 * can be unit-tested with `node --test` exactly like the modules in
 * `lib/tournament/`. The repository (`tournaments.ts`) and Server Actions
 * (`actions.ts`) build on these helpers; the React admin UI uses
 * `mapSetupToEntries` to rehydrate its state from a persisted snapshot.
 *
 * Identifiers are deterministic and derived from the domain model so that the
 * same logical entity always maps to the same row id:
 *   group id       = `${tournamentId}:group:${label}`
 *   team id        = `${tournamentId}:team:${name}`
 *   participant id = `${tournamentId}:participant:${drawOrder}`
 * This keeps persistence idempotent: saving the same setup twice produces the
 * same rows, and the `onConflictDo*` upserts in the repository stay stable.
 */

import { getGroupIndexForDrawOrder, getGroupSizes } from "../tournament/groups.ts";
import { getGroupLabel } from "../tournament/draw.ts";

// ---------------------------------------------------------------------------
// Persisted snapshot types (mirror the rows in `schema.ts`, domain-shaped)
// ---------------------------------------------------------------------------

/** A persisted tournament, shaped for the admin UI / actions. */
export interface SavedTournament {
  id: string;
  name: string;
  participantCount: number;
  groupCount: number;
  status: string;
}

/** A persisted group, without the `tournamentId` (implicit from the snapshot). */
export interface SavedGroup {
  id: string;
  label: string;
}

/** A persisted participant with its team name joined in (null if unassigned). */
export interface SavedParticipant {
  id: string;
  name: string;
  drawOrder: number;
  teamName: string | null;
  groupId: string | null;
}

/**
 * The full, stored setup of the active tournament. Returned by
 * `getTournamentSetup()` and consumed by the admin server component to
 * rehydrate the client. `tournament` is `null` when no tournament has been
 * created yet, in which case `groups` and `participants` are empty.
 */
export interface TournamentSetupSnapshot {
  tournament: SavedTournament | null;
  groups: SavedGroup[];
  participants: SavedParticipant[];
}

/** A single draw-order slot as edited in the admin UI. */
export interface Entry {
  name: string;
  team: string;
}

/** A normalized, persistable participant entry (non-blank name, trimmed). */
export interface PersistableEntry {
  drawOrder: number;
  name: string;
  team: string;
}

// ---------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------

/** Deterministic group row id from a 0-based group index. */
export function groupRecordId(tournamentId: string, groupIndex: number): string {
  return `${tournamentId}:group:${getGroupLabel(groupIndex)}`;
}

/** Deterministic participant row id from a 1-based draw order. */
export function participantIdFor(tournamentId: string, drawOrder: number): string {
  return `${tournamentId}:participant:${drawOrder}`;
}

/** Deterministic team row id from a team name (unique within a tournament). */
export function teamIdFor(tournamentId: string, name: string): string {
  return `${tournamentId}:team:${name}`;
}

// ---------------------------------------------------------------------------
// Group records
// ---------------------------------------------------------------------------

/**
 * Builds the full set of group records for a tournament: one per group, in
 * index order, each with a deterministic id and the matching label.
 */
export function buildGroupRecords(
  tournamentId: string,
  groupCount: number,
): SavedGroup[] {
  const records: SavedGroup[] = [];
  for (let index = 0; index < groupCount; index++) {
    records.push({
      id: groupRecordId(tournamentId, index),
      label: getGroupLabel(index),
    });
  }
  return records;
}

/**
 * Computes the group id for a given draw order from the current group sizes,
 * reusing the same draw-order assignment logic as the persistence-free engine.
 */
export function groupIdForDrawOrder(
  tournamentId: string,
  drawOrder: number,
  groupSizes: number[],
): string {
  const groupIndex = getGroupIndexForDrawOrder(drawOrder, groupSizes);
  return groupRecordId(tournamentId, groupIndex);
}

/**
 * Comparator that orders group labels by their generating index.
 *
 * `getGroupLabel` produces "A".."Z" then "AA".."AZ", "BA"..., so a plain
 * lexicographic sort is wrong once labels exceed one character ("Z" vs "AA").
 * Ordering by `(length, then lexicographic)` matches the index order exactly:
 * shorter labels always come first, and equal-length labels compare correctly.
 */
export function compareGroupLabels(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Snapshot <-> UI entry mapping
// ---------------------------------------------------------------------------

/**
 * Reconstructs the admin UI state from a persisted snapshot.
 *
 * Returns the configured counts plus an entries map keyed by draw order. When
 * no tournament exists yet, the counts are `0` and the entries map is empty so
 * the UI starts blank.
 */
export function mapSetupToEntries(snapshot: TournamentSetupSnapshot): {
  participantCount: number;
  groupCount: number;
  entries: Record<number, Entry>;
} {
  if (!snapshot.tournament) {
    return { participantCount: 0, groupCount: 0, entries: {} };
  }
  const entries: Record<number, Entry> = {};
  for (const p of snapshot.participants) {
    entries[p.drawOrder] = { name: p.name, team: p.teamName ?? "" };
  }
  return {
    participantCount: snapshot.tournament.participantCount,
    groupCount: snapshot.tournament.groupCount,
    entries,
  };
}

/** Whether any entry has a non-blank name or team (used for save-status UX). */
export function entriesHaveData(entries: Record<number, Entry>): boolean {
  return Object.values(entries).some(
    (e) => e.name.trim() !== "" || e.team.trim() !== "",
  );
}

// ---------------------------------------------------------------------------
// Save-side normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes the UI entries into a persistable list for a given participant
 * count.
 *
 * - Iterates draw orders `1..participantCount` (entries outside that range,
 *   e.g. left over from a shrink, are ignored).
 * - Drops slots with a blank name (a participant requires a name).
 * - Trims both name and team. A blank team is kept as `""` and later stored as
 *   a null `assignedTeamId`.
 */
export function normalizeEntriesForSave(
  entries: Record<number, Entry>,
  participantCount: number,
): PersistableEntry[] {
  const out: PersistableEntry[] = [];
  for (let drawOrder = 1; drawOrder <= participantCount; drawOrder++) {
    const entry = entries[drawOrder];
    if (!entry) continue;
    const name = entry.name.trim();
    if (name === "") continue;
    out.push({ drawOrder, name, team: entry.team.trim() });
  }
  return out;
}

/**
 * Extracts the unique, sorted, non-blank team names from a normalized entry
 * list. Used to know which team rows must exist before participants are saved.
 */
export function uniqueTeamNames(normalized: PersistableEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of normalized) {
    if (entry.team !== "") {
      names.add(entry.team);
    }
  }
  return [...names].sort();
}

// Re-exported so the repository can compute group sizes without a second import.
export { getGroupSizes };