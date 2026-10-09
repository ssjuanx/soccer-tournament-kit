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
import type {
  AdvancementDestination,
  AdvancementMode,
  CrossGroupStrategy,
  GroupId,
  ManualTiebreakResolution,
  ParticipantId,
  ScoringConfig,
  TiebreakerKey,
  TiebreakerOrder,
} from "../tournament/types.ts";

// Re-export so the repository and actions can import the type from here
// alongside the advancement helpers.
export type { AdvancementDestination, AdvancementMode, CrossGroupStrategy };

// ---------------------------------------------------------------------------
// Persisted snapshot types (mirror the rows in `schema.ts`, domain-shaped)
// ---------------------------------------------------------------------------

/** A persisted tournament, shaped for the admin UI / actions. */
export interface SavedTournament {
  id: string;
  name: string;
  /** Optional identity metadata (blank until the administrator sets them). */
  edition: string | null;
  date: string | null;
  description: string | null;
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
  /**
   * The ordered list of knockout advancement destinations. Each entry sends the
   * participants finishing in a 1-based inclusive standing-position range
   * `[fromPosition, toPosition]` within each group into a named bracket. A
   * position outside every destination's range is eliminated. Parsed from the
   * stored JSON text; null/missing storage yields the default advancement.
   * Always a non-empty valid array (never null) on a saved snapshot. Old
   * `playersPerGroup`-based storage is converted on read by `parseAdvancement`.
   */
  advancement: AdvancementDestination[];
  /**
   * LEGACY: how many participants qualified from each group into the knockout
   * stage (default 2). Superseded by `advancement`; retained only so the
   * migration can backfill `advancement` from it. New code reads `advancement`.
   */
  qualifiersPerGroup: number;
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
  /**
   * Stored manual tiebreak resolutions (one per group that the admin has
   * ordered). Empty when no `manual` tiebreaker resolutions have been saved.
   * Used by the standings engine and the admin manual-resolution panel.
   */
  manualResolutions: ManualTiebreakResolution[];
}

/** A persisted manual tiebreak resolution, without the `tournamentId`. */
export interface SavedManualTiebreakResolution {
  id: string;
  groupId: string;
  cohortKey: string;
  participantOrder: ParticipantId[];
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

/** Deterministic manual-tiebreak-resolution row id for one cohort in a group. */
export function manualResolutionIdFor(
  tournamentId: string,
  groupId: string,
  cohortKey: string,
): string {
  return `${tournamentId}:resolution:${groupId}:${cohortKey}`;
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
// Tournament metadata: name / edition / date / description
// ---------------------------------------------------------------------------

/** Default tournament name used when the administrator leaves the name blank. */
export const DEFAULT_TOURNAMENT_NAME = "FC Tournament";

/**
 * Normalizes raw tournament-identity metadata from the admin form.
 *
 * `name` is required: a blank/whitespace name falls back to
 * `DEFAULT_TOURNAMENT_NAME`. `edition` and `description` are trimmed and stored
 * as `null` when blank. `date` is trimmed and stored as `null` when blank; a
 * non-blank value is kept as-is (the UI uses an `<input type="date">`, so it is
 * already `YYYY-MM-DD`). Returns the canonical, persistable shape.
 */
export function normalizeTournamentMetadata(input: {
  name: string;
  edition: string;
  date: string;
  description: string;
}): {
  name: string;
  edition: string | null;
  date: string | null;
  description: string | null;
} {
  const name = input.name.trim() || DEFAULT_TOURNAMENT_NAME;
  const edition = input.edition.trim() || null;
  const date = input.date.trim() || null;
  const description = input.description.trim() || null;
  return { name, edition, date, description };
}

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

// ---------------------------------------------------------------------------
// Advancement configuration: multi-tournament knockout destinations
// ---------------------------------------------------------------------------

/**
 * The default advancement configuration: a single Championship bracket taking
 * the top 2 from each group (positions 1–2). Positions 3 and below are
 * eliminated by default. This preserves the legacy single-`qualifiersPerGroup`
 * behaviour for the Championship bracket while dropping the implicit
 * "Consolation for the rest" bucket (an organizer can add explicit brackets for
 * lower positions if desired).
 */
export const DEFAULT_ADVANCEMENT: AdvancementDestination[] = [
  { name: "Championship", fromPosition: 1, toPosition: 2 },
];

/**
 * Converts a bracket display name into a stable slug used as the
 * `bracket_kind` column value and as the match-id namespace segment.
 *
 * Lowercases, replaces any run of non-alphanumeric characters with a single
 * hyphen, and trims leading/trailing hyphens. e.g. "Championship" →
 * "championship", "Plate / Shield" → "plate-shield". An empty/whitespace name
 * yields an empty string (rejected by `validateAdvancement`).
 */
export function slugifyBracketName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The supported cross-group ranking strategies for `"bestX"` destinations, in
 * the order shown in the admin UI.
 */
export const CROSS_GROUP_STRATEGIES: readonly CrossGroupStrategy[] = [
  "per-game",
  "raw",
  "gate",
  "playoff",
];

/** The default ranking strategy for a `"bestX"` destination. */
export const DEFAULT_CROSS_GROUP_STRATEGY: CrossGroupStrategy = "per-game";

/**
 * Reads the optional `"bestX"` fields off a parsed JSON object, returning only
 * the fields that are present and well-formed. A `mode` of anything other than
 * `"bestX"` (including the legacy absence of `mode`) yields an empty object so
 * positions-mode destinations stay minimal and round-trip to the default
 * representation.
 */
function readBestXFields(
  item: Record<string, unknown>,
): Partial<AdvancementDestination> {
  if (item.mode !== "bestX") return {};
  const out: Partial<AdvancementDestination> = { mode: "bestX" };
  const count = item.count;
  if (typeof count === "number" && Number.isInteger(count) && count >= 1) {
    out.count = count;
  }
  const position = item.position;
  if (
    typeof position === "number" &&
    Number.isInteger(position) &&
    position >= 1
  ) {
    out.position = position;
  }
  const strategy = item.strategy;
  if (
    typeof strategy === "string" &&
    (CROSS_GROUP_STRATEGIES as readonly string[]).includes(strategy)
  ) {
    out.strategy = strategy as CrossGroupStrategy;
  }
  const groups = item.groups;
  if (Array.isArray(groups)) {
    const labels = groups
      .filter((g): g is string => typeof g === "string" && g.trim() !== "")
      .map((g) => g.trim());
    if (labels.length > 0) out.groups = labels;
  }
  if (typeof item.allowOverlap === "boolean") out.allowOverlap = item.allowOverlap;
  if (
    typeof item.playoffThreshold === "number" &&
    Number.isFinite(item.playoffThreshold)
  ) {
    out.playoffThreshold = item.playoffThreshold;
  }
  return out;
}

/**
 * Serializes an advancement configuration into the JSON text stored in
 * `tournaments.advancement`. The default advancement is stored as `null` so a
 * fresh tournament and an untouched one share the same on-disk representation.
 */
export function serializeAdvancement(
  advancement: AdvancementDestination[],
): string | null {
  if (
    advancement.length === DEFAULT_ADVANCEMENT.length &&
    advancement.every(
      (d, i) =>
        d.name === DEFAULT_ADVANCEMENT[i].name &&
        d.fromPosition === DEFAULT_ADVANCEMENT[i].fromPosition &&
        d.toPosition === DEFAULT_ADVANCEMENT[i].toPosition &&
        d.mode == null &&
        d.count == null &&
        d.strategy == null &&
        d.groups == null &&
        d.allowOverlap == null &&
        d.playoffThreshold == null &&
        d.position == null,
    )
  ) {
    return null;
  }
  return JSON.stringify(advancement);
}

/**
 * Parses a stored `advancement` text value into a valid
 * `AdvancementDestination[]`. Malformed JSON, non-array values, or invalid
 * entries are ignored and the default advancement is returned instead — so a
 * corrupt row never breaks bracket rendering.
 *
 * Backward compatibility: storage written by the old model used
 * `playersPerGroup` (a positive integer, or `null` for "the rest"). When such
 * entries are detected they are converted to explicit position ranges:
 *   - `playersPerGroup: N`  → `fromPosition: line+1, toPosition: line+N`
 *     (where `line` is the accumulated `playersPerGroup` of earlier entries)
 *   - `playersPerGroup: null` ("the rest") →
 *     `fromPosition: line+1, toPosition: maxGroupSize`
 * `maxGroupSize` (the largest group size in the tournament) bounds the "rest"
 * bucket. It should be supplied by the caller; when unavailable (e.g. a
 * tournament with no generated groups) the rest bucket collapses to an empty
 * range (`toPosition = line`), which is harmless because such a tournament has
 * null/default advancement anyway.
 */
export function parseAdvancement(
  raw: string | null | undefined,
  maxGroupSize?: number,
): AdvancementDestination[] {
  if (raw == null || raw === "") return DEFAULT_ADVANCEMENT.map((d) => ({ ...d }));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_ADVANCEMENT.map((d) => ({ ...d }));
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_ADVANCEMENT.map((d) => ({ ...d }));
  }

  const isOldFormat = parsed.some(
    (item) =>
      item != null &&
      typeof item === "object" &&
      "playersPerGroup" in (item as Record<string, unknown>),
  );

  const out: AdvancementDestination[] = [];
  if (isOldFormat) {
    // Convert accumulated "top N" / "rest" into explicit position ranges.
    let line = 0;
    for (const item of parsed) {
      if (
        item == null ||
        typeof item !== "object" ||
        typeof (item as Record<string, unknown>).name !== "string"
      ) {
        continue;
      }
      const name = (item as Record<string, unknown>).name as string;
      const ppg = (item as Record<string, unknown>).playersPerGroup;
      if (ppg === null) {
        const to = maxGroupSize != null ? Math.max(line, maxGroupSize) : line;
        out.push({ name, fromPosition: line + 1, toPosition: to });
        line = to;
      } else if (typeof ppg === "number" && Number.isInteger(ppg) && ppg >= 1) {
        out.push({ name, fromPosition: line + 1, toPosition: line + ppg });
        line += ppg;
      }
    }
  } else {
    // New explicit-range format.
    for (const item of parsed) {
      if (
        item != null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).name === "string"
      ) {
        const name = (item as Record<string, unknown>).name as string;
        const from = (item as Record<string, unknown>).fromPosition;
        const to = (item as Record<string, unknown>).toPosition;
        if (
          typeof from === "number" &&
          Number.isInteger(from) &&
          typeof to === "number" &&
          Number.isInteger(to)
        ) {
          out.push({
            name,
            fromPosition: from,
            toPosition: to,
            ...readBestXFields(item as Record<string, unknown>),
          });
        }
      }
    }
  }
  return out.length === 0 ? DEFAULT_ADVANCEMENT.map((d) => ({ ...d })) : out;
}

/**
 * Validates an advancement configuration from the admin UI.
 *
 * Rules:
 *   - At least one destination.
 *   - Every name is non-blank after trimming.
 *   - No two destinations share the same slug (after slugification), so bracket
 *     identities are unique.
 *   - `fromPosition` and `toPosition` are positive integers with
 *     `fromPosition <= toPosition`.
 *   - When `maxGroupSize` is supplied, `toPosition` must not exceed it (the
 *     largest group has no standing position beyond it).
 *   - No two destinations' position ranges overlap (a standing position can
 *     qualify for at most one bracket).
 *
 * Returns `{ ok: true, advancement }` with a normalized (trimmed) copy, or
 * `{ ok: false, error }` with a friendly message.
 */
export function validateAdvancement(
  advancement: AdvancementDestination[],
  maxGroupSize?: number,
): { ok: true; advancement: AdvancementDestination[] } | { ok: false; error: string } {
  if (!Array.isArray(advancement) || advancement.length === 0) {
    return { ok: false, error: "Add at least one knockout bracket." };
  }

  const normalized: AdvancementDestination[] = [];
  const seenSlugs = new Set<string>();

  for (let i = 0; i < advancement.length; i++) {
    const dest = advancement[i];
    const name = (dest?.name ?? "").trim();
    if (name === "") {
      return { ok: false, error: `Bracket ${i + 1} needs a name.` };
    }
    const slug = slugifyBracketName(name);
    if (slug === "") {
      return {
        ok: false,
        error: `Bracket "${name}" has no usable characters. Use letters or numbers.`,
      };
    }
    if (seenSlugs.has(slug)) {
      return {
        ok: false,
        error: `Two brackets slug to "${slug}". Give each a unique name.`,
      };
    }
    seenSlugs.add(slug);

    const isBestX = dest?.mode === "bestX";
    const rawFrom = dest.fromPosition;
    const rawTo = dest.toPosition;
    const fromOk = Number.isInteger(rawFrom) && rawFrom >= 1;
    const toOk = Number.isInteger(rawTo) && rawTo >= 1;

    if (isBestX) {
      // from/to are irrelevant in bestX mode; coerce to a harmless 1/1 so the
      // required numeric fields always hold a valid standing-position range.
      const from = fromOk ? rawFrom : 1;
      const to = toOk ? rawTo : 1;
      const count = dest.count;
      if (!Number.isInteger(count) || (count as number) < 1) {
        return {
          ok: false,
          error: `Bracket "${name}" needs a whole-number "best X" count of 1 or more.`,
        };
      }
      const position = dest.position;
      if (!Number.isInteger(position) || (position as number) < 1) {
        return {
          ok: false,
          error: `Bracket "${name}" needs a whole-number standing position of 1 or more.`,
        };
      }
      if (maxGroupSize != null && (position as number) > maxGroupSize) {
        return {
          ok: false,
          error: `Bracket "${name}" uses position ${position}, but the largest group only has ${maxGroupSize} standing positions.`,
        };
      }
      const strategy: CrossGroupStrategy =
        dest.strategy != null &&
        (CROSS_GROUP_STRATEGIES as readonly string[]).includes(dest.strategy)
          ? dest.strategy
          : DEFAULT_CROSS_GROUP_STRATEGY;
      const entry: AdvancementDestination = {
        name,
        fromPosition: from,
        toPosition: to,
        mode: "bestX",
        position: position as number,
        count: count as number,
        strategy,
      };
      if (Array.isArray(dest.groups)) {
        const labels = dest.groups
          .map((g) => (typeof g === "string" ? g.trim() : ""))
          .filter((g) => g !== "");
        const unique: string[] = [];
        for (const label of labels) {
          if (!unique.includes(label)) unique.push(label);
        }
        if (unique.length > 0) entry.groups = unique;
      }
      if (typeof dest.allowOverlap === "boolean") {
        entry.allowOverlap = dest.allowOverlap;
      }
      if (
        typeof dest.playoffThreshold === "number" &&
        Number.isFinite(dest.playoffThreshold)
      ) {
        entry.playoffThreshold = dest.playoffThreshold;
      }
      normalized.push(entry);
      continue;
    }

    if (!fromOk || !toOk) {
      return {
        ok: false,
        error: `Bracket "${name}" needs whole-number positions of 1 or more.`,
      };
    }
    if (rawFrom > rawTo) {
      return {
        ok: false,
        error: `Bracket "${name}" starts at position ${rawFrom} but ends at ${rawTo}. The "from" position must be lower or equal.`,
      };
    }
    if (maxGroupSize != null && rawTo > maxGroupSize) {
      return {
        ok: false,
        error: `Bracket "${name}" ends at position ${rawTo}, but the largest group only has ${maxGroupSize} standing positions.`,
      };
    }
    // positions mode (default): drop any stray bestX-only fields.
    normalized.push({ name, fromPosition: rawFrom, toPosition: rawTo });
  }

  // No overlapping ranges among positions-mode destinations: a standing
  // position qualifies for at most one bracket. bestX destinations are
  // cross-group and don't claim a per-group position range, so they're exempt
  // (allowOverlap governs whether they may reuse a positions-mode qualifier).
  const sorted = normalized
    .filter((d) => d.mode !== "bestX")
    .sort((a, b) => a.fromPosition - b.fromPosition);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].fromPosition <= sorted[i - 1].toPosition) {
      return {
        ok: false,
        error: `Brackets "${sorted[i - 1].name}" and "${sorted[i].name}" overlap (positions ${sorted[i - 1].fromPosition}–${sorted[i - 1].toPosition} and ${sorted[i].fromPosition}–${sorted[i].toPosition}). Each position can qualify for only one bracket.`,
      };
    }
  }

  return { ok: true, advancement: normalized };
}

/**
 * Normalizes an advancement configuration without full validation: trims names,
 * drops entries with blank names, and coerces `fromPosition`/`toPosition` to
 * positive integers (defaulting to 1). Used when rehydrating draft UI state so
 * the editor always has well-formed entries to render.
 */
export function normalizeAdvancement(
  advancement: AdvancementDestination[],
): AdvancementDestination[] {
  if (!Array.isArray(advancement)) return DEFAULT_ADVANCEMENT.map((d) => ({ ...d }));
  const out = advancement
    .map((d): AdvancementDestination => {
      const from = Number.isInteger(d?.fromPosition) ? d.fromPosition : 1;
      const to = Number.isInteger(d?.toPosition) ? d.toPosition : 1;
      const base: AdvancementDestination = {
        name: (d?.name ?? "").trim(),
        fromPosition: from < 1 ? 1 : from,
        toPosition: to < 1 ? 1 : to,
      };
      if (d?.mode === "bestX") {
        base.mode = "bestX";
        if (Number.isInteger(d.count) && (d.count as number) >= 1) {
          base.count = d.count;
        }
        if (Number.isInteger(d.position) && (d.position as number) >= 1) {
          base.position = d.position;
        }
        const strat = d.strategy;
        if (
          strat != null &&
          (CROSS_GROUP_STRATEGIES as readonly string[]).includes(strat)
        ) {
          base.strategy = strat;
        }
        if (Array.isArray(d.groups)) {
          const labels = d.groups
            .filter((g): g is string => typeof g === "string" && g.trim() !== "")
            .map((g) => g.trim());
          if (labels.length > 0) base.groups = labels;
        }
        if (typeof d.allowOverlap === "boolean") base.allowOverlap = d.allowOverlap;
        if (
          typeof d.playoffThreshold === "number" &&
          Number.isFinite(d.playoffThreshold)
        ) {
          base.playoffThreshold = d.playoffThreshold;
        }
      }
      return base;
    })
    .filter((d) => d.name !== "");
  return out.length === 0 ? DEFAULT_ADVANCEMENT.map((d) => ({ ...d })) : out;
}

// ---------------------------------------------------------------------------
// Manual tiebreak resolution: participant-order serialization & parsing
// ---------------------------------------------------------------------------

/**
 * Serializes a manual-tiebreak participant order into the JSON text stored in
 * `manual_tiebreak_resolutions.participant_order`. Returns the JSON string
 * (never null — a resolution row only exists when the admin has set an order).
 */
export function serializeParticipantOrder(order: ParticipantId[]): string {
  return JSON.stringify(order);
}

/**
 * Parses a stored `participant_order` text value into a `ParticipantId[]`.
 *
 * Malformed JSON or non-array values yield an empty array (treated as "no
 * resolution"), so a corrupt row never breaks standings rendering. Non-string
 * entries are dropped. The result is *not* de-duplicated or validated against
 * known participants here — the ranking resolver validates coverage itself.
 */
export function parseParticipantOrder(
  raw: string | null | undefined,
): ParticipantId[] {
  if (raw == null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is ParticipantId => typeof item === "string");
}

/**
 * Normalizes a candidate participant order from the admin UI: keeps only
 * non-empty string ids, de-duplicates (first occurrence wins), and preserves
 * order. Returns the cleaned list (possibly empty).
 */
export function normalizeParticipantOrder(order: ParticipantId[]): ParticipantId[] {
  const seen = new Set<ParticipantId>();
  const out: ParticipantId[] = [];
  for (const id of order) {
    if (typeof id === "string" && id !== "" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
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