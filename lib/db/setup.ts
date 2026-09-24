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
import {
  ALL_TIEBREAKER_KEYS,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_TIEBREAKER_ORDER,
} from "../tournament/standings.ts";
import type { ScoringConfig, TiebreakerKey, TiebreakerOrder } from "../tournament/types.ts";

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
  /** Tournament-owned scoring rules (defaults: 3 / 1 / 0). */
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  /**
   * Configured tiebreaker order (applied after points, before draw order).
   * Parsed from the stored JSON text; null/missing storage yields the default
   * order. Always a valid `TiebreakerOrder` (never null) on a saved snapshot.
   */
  tiebreakerOrder: TiebreakerOrder;
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

// ---------------------------------------------------------------------------
// Tournament rules: scoring config & tiebreaker order
// ---------------------------------------------------------------------------

// Re-export the defaults so the repository and actions can seed new tournaments
// and validate without importing the engine directly.
export { DEFAULT_SCORING_CONFIG, DEFAULT_TIEBREAKER_ORDER };

/**
 * Serializes a tiebreaker order into the JSON text stored in
 * `tournaments.tiebreaker_order`. The default order is stored as `null` so a
 * fresh tournament and an untouched one share the same on-disk representation.
 */
export function serializeTiebreakerOrder(order: TiebreakerOrder): string | null {
  if (order.length === 0) return null;
  // Compare ignoring order-independent concerns: if it equals the default
  // (same sequence), store null to keep storage canonical.
  if (
    order.length === DEFAULT_TIEBREAKER_ORDER.length &&
    order.every((k, i) => k === DEFAULT_TIEBREAKER_ORDER[i])
  ) {
    return null;
  }
  return JSON.stringify(order);
}

/**
 * Parses a stored `tiebreaker_order` text value into a valid `TiebreakerOrder`.
 *
 * Malformed JSON, non-array values, or unknown keys are ignored and the default
 * order is returned instead — persisted rules are trusted-but-verified so a
 * corrupt row never breaks standings rendering. Duplicate keys are de-duplicated
 * (first occurrence wins).
 */
export function parseTiebreakerOrder(raw: string | null | undefined): TiebreakerOrder {
  if (raw == null || raw === "") return [...DEFAULT_TIEBREAKER_ORDER];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_TIEBREAKER_ORDER];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_TIEBREAKER_ORDER];
  const validKeys = new Set<string>(ALL_TIEBREAKER_KEYS);
  const seen = new Set<TiebreakerKey>();
  const out: TiebreakerKey[] = [];
  for (const item of parsed) {
    if (typeof item === "string" && validKeys.has(item) && !seen.has(item as TiebreakerKey)) {
      seen.add(item as TiebreakerKey);
      out.push(item as TiebreakerKey);
    }
  }
  return out.length === 0 ? [...DEFAULT_TIEBREAKER_ORDER] : out;
}

/**
 * Normalizes a candidate tiebreaker order from the admin UI: keeps only known
 * keys, de-duplicates (first occurrence wins), and falls back to the default
 * order when nothing valid remains. Order is preserved.
 */
export function normalizeTiebreakerOrder(order: TiebreakerKey[]): TiebreakerOrder {
  const validKeys = new Set<string>(ALL_TIEBREAKER_KEYS);
  const seen = new Set<TiebreakerKey>();
  const out: TiebreakerKey[] = [];
  for (const key of order) {
    if (validKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out.length === 0 ? [...DEFAULT_TIEBREAKER_ORDER] : out;
}

/**
 * Parses raw string scoring inputs from the admin form into a `ScoringConfig`.
 *
 * Each value must be an integer. Blank values fall back to the corresponding
 * default (3 / 1 / 0). Returns a tagged result so the UI can surface a friendly
 * error without throwing into the render path — mirrors `validateSetupInput`.
 */
export function parseScoringRules(
  winRaw: string,
  drawRaw: string,
  lossRaw: string,
): { ok: true; config: ScoringConfig } | { ok: false; message: string } {
  const parse = (raw: string, fallback: number): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return fallback;
    const n = Number(trimmed);
    if (!Number.isInteger(n)) return null;
    return n;
  };

  const win = parse(winRaw, DEFAULT_SCORING_CONFIG.winPoints);
  const draw = parse(drawRaw, DEFAULT_SCORING_CONFIG.drawPoints);
  const loss = parse(lossRaw, DEFAULT_SCORING_CONFIG.lossPoints);

  if (win == null) {
    return { ok: false, message: "Win points must be a whole number." };
  }
  if (draw == null) {
    return { ok: false, message: "Draw points must be a whole number." };
  }
  if (loss == null) {
    return { ok: false, message: "Loss points must be a whole number." };
  }
  return { ok: true, config: { winPoints: win, drawPoints: draw, lossPoints: loss } };
}