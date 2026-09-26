/**
 * Single-elimination knockout bracket generation and advancement.
 *
 * Everything here is framework-agnostic and free of any database import, so it
 * can be unit-tested with `node --test` exactly like the other modules in
 * `lib/tournament/`. The repository (`matches.ts`) and Server Actions
 * (`actions.ts`) build on these helpers; the public bracket page recomputes the
 * bracket from the qualifiers and the stored knockout scores.
 *
 * Design notes:
 * - The bracket is a *pure function* of the qualifiers (and, for advancement,
 *   the stored scores). Match ids are deterministic
 *   (`${tournamentId}:ko:r${round}:m${index}`), so the same qualifiers always
 *   reproduce the same bracket and scores attach to the same rows.
 * - `bracketSize` is the next power of two of the qualifier count (derived, not
 *   stored). Byes go to the highest seeds: standard seeding pairs seed `s` with
 *   seed `bracketSize + 1 - s`, and seeds beyond the qualifier count are byes,
 *   so the top qualifiers receive the byes.
 * - Seeding avoids same-group round-1 rematches: qualifiers are ordered in
 *   tiers by their within-group position (group winners first, then runners-up,
 *   …), and a deterministic swap pass eliminates any remaining same-group
 *   round-1 pairing without moving byes away from the top seeds.
 */

import type {
  GroupId,
  KnockoutRound,
  Match,
  MatchScore,
  ParticipantId,
} from "./types";

// ---------------------------------------------------------------------------
// Qualifiers
// ---------------------------------------------------------------------------

/**
 * A participant that qualified for the knockout stage from its group.
 *
 * `groupPosition` is the 1-based standing position within the group
 * (1 = group winner, 2 = runner-up, …), which drives the global seed ordering.
 */
export interface Qualifier {
  participantId: ParticipantId;
  groupId: GroupId;
  /** 1-based standing position within the group (1 = winner). */
  groupPosition: number;
}

// ---------------------------------------------------------------------------
// Bracket size & round names
// ---------------------------------------------------------------------------

/** Largest supported bracket (64 participants). Mirrors `KnockoutRound`. */
export const MAX_BRACKET_SIZE = 64;

/**
 * Smallest power of two greater than or equal to `n`.
 *
 * `n` must be a positive integer. `nextPowerOfTwo(1) === 1`.
 */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be a positive integer (got ${n}).`);
  }
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * The single-elimination bracket size for a given number of qualifiers: the
 * next power of two, derived (never stored). Throws if the count would exceed
 * the largest supported bracket.
 */
export function bracketSize(qualifierCount: number): number {
  if (!Number.isInteger(qualifierCount) || qualifierCount < 1) {
    throw new Error(
      `qualifierCount must be a positive integer (got ${qualifierCount}).`,
    );
  }
  const size = nextPowerOfTwo(qualifierCount);
  if (size > MAX_BRACKET_SIZE) {
    throw new Error(
      `Knockout bracket of ${qualifierCount} qualifiers would exceed the maximum supported size of ${MAX_BRACKET_SIZE}.`,
    );
  }
  return size;
}

/**
 * Maps a round's match count to its `KnockoutRound` name.
 *
 * A round with `m` matches has `2m` bracket slots, so e.g. 8 matches → 16
 * slots → "round_of_16". The final has 1 match.
 */
export function roundNameForMatchCount(matchCount: number): KnockoutRound {
  switch (matchCount) {
    case 32:
      return "round_of_64";
    case 16:
      return "round_of_32";
    case 8:
      return "round_of_16";
    case 4:
      return "quarter_final";
    case 2:
      return "semi_final";
    case 1:
      return "final";
    default:
      throw new Error(`Unsupported round match count: ${matchCount}.`);
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Standard single-elimination seed ordering for a bracket of `size` slots.
 *
 * Returns the 1-based seed number occupying each bracket slot (slot index →
 * seed), constructed recursively so that the best seeds meet as late as
 * possible:
 *   size 2 → [1, 2]
 *   size 4 → [1, 4, 2, 3]
 *   size 8 → [1, 8, 4, 5, 2, 7, 3, 6]
 *
 * Slot `2i` always holds the lower (better) seed of its round-1 pairing, so it
 * is the home side; slot `2i+1` is the away side.
 */
export function seedOrdering(size: number): number[] {
  if (!Number.isInteger(size) || size < 1 || (size & (size - 1)) !== 0) {
    throw new Error(`size must be a positive power of two (got ${size}).`);
  }
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(order.length * 2 + 1 - s);
    }
    order = next;
  }
  return order;
}

/**
 * Orders qualifiers into the global seed list (best first).
 *
 * Qualifiers are grouped in tiers by `groupPosition` (winners tier first, then
 * runners-up, …). Within a tier the input order is preserved, so the caller
 * controls intra-tier ordering (typically by group label A, B, …). Seed 1 is
 * the first element of the returned list.
 */
export function buildSeedList(qualifiers: Qualifier[]): Qualifier[] {
  return [...qualifiers].sort((a, b) => a.groupPosition - b.groupPosition);
}

// ---------------------------------------------------------------------------
// Bracket structure (in-memory, richer than the persisted `Match`)
// ---------------------------------------------------------------------------

/** One side of a knockout match: a participant or null (bye / TBD). */
export interface BracketSlot {
  /** 1-based global seed, or null for a bye. */
  seed: number | null;
  participantId: ParticipantId | null;
  /** Source group of the seed (null once advanced from a later round). */
  groupId: GroupId | null;
}

/** A knockout match in the in-memory bracket tree. */
export interface BracketMatch {
  id: string;
  /** 0 = first round. */
  roundIndex: number;
  /** 0-based index within the round. */
  matchIndex: number;
  knockoutRound: KnockoutRound;
  home: BracketSlot;
  away: BracketSlot;
  score: MatchScore | null;
}

// ---------------------------------------------------------------------------
// Match ids
// ---------------------------------------------------------------------------

/**
 * Deterministic knockout match id: `${tournamentId}:ko:r${round}:m${index}`.
 * The round and match index are recoverable with `parseKnockoutMatchId`, which
 * is how advancement re-derives the bracket topology from persisted rows.
 */
export function knockoutMatchId(
  tournamentId: string,
  roundIndex: number,
  matchIndex: number,
): string {
  return `${tournamentId}:ko:r${roundIndex}:m${matchIndex}`;
}

/** Parses a knockout match id back into its round and match index. */
export function parseKnockoutMatchId(
  id: string,
): { roundIndex: number; matchIndex: number } {
  const match = id.match(/:ko:r(\d+):m(\d+)$/);
  if (!match) {
    throw new Error(`Not a knockout match id: ${id}.`);
  }
  return {
    roundIndex: Number(match[1]),
    matchIndex: Number(match[2]),
  };
}
// ---------------------------------------------------------------------------
// Same-group round-1 rematch avoidance
// ---------------------------------------------------------------------------

/**
 * Eliminates same-group round-1 pairings by swapping the *away* (lower-seeded)
 * participants between two real-participant matches.
 *
 * Byes (null away) are never moved, so they stay with the top seeds. Home slots
 * are never moved either, so "home = higher seed" is preserved (away seeds are
 * all in the high-seed range; swapping among them keeps home the better seed).
 * The pass is deterministic and greedily resolves conflicts top-to-bottom.
 */
function avoidSameGroupRematches(round0: BracketMatch[]): BracketMatch[] {
  const matches = round0.map((m) => ({
    ...m,
    home: { ...m.home },
    away: { ...m.away },
  }));

  for (let i = 0; i < matches.length; i++) {
    const a = matches[i];
    if (a.home.groupId == null || a.away.groupId == null) continue;
    if (a.home.groupId !== a.away.groupId) continue;

    // Same-group round-1 rematch: find a partner match whose away can swap in
    // without creating a new same-group pairing in either match. Search all
    // other matches (a conflict can sit in the last match, with no later
    // partner); the validity guard keeps both matches conflict-free.
    for (let j = 0; j < matches.length; j++) {
      if (j === i) continue;
      const b = matches[j];
      // Only swap real (non-bye) aways; never move a bye.
      if (b.away.participantId == null) continue;
      if (b.home.groupId == null) continue;

      const aHomeGroup = a.home.groupId;
      const bHomeGroup = b.home.groupId;
      const aAwayGroup = a.away.groupId;
      const bAwayGroup = b.away.groupId;

      // After swapping a.away <-> b.away:
      //   match a: aHome vs bAway   -> need aHomeGroup !== bAwayGroup
      //   match b: bHome vs aAway   -> need bHomeGroup !== aAwayGroup
      if (aHomeGroup !== bAwayGroup && bHomeGroup !== aAwayGroup) {
        const tmp = a.away;
        a.away = b.away;
        b.away = tmp;
        break;
      }
    }
  }
  return matches;
}
// ---------------------------------------------------------------------------
// Bracket generation
// ---------------------------------------------------------------------------

/**
 * Generates the full single-elimination bracket for the given qualifiers.
 *
 * Round 0 is filled with the seeded pairings (including byes to the top seeds
 * and same-group-rematch avoidance). Later rounds are created with both slots
 * TBD (null) and null scores, to be filled by `advanceBracket` from stored
 * scores. Scores are always `null` on a freshly generated bracket.
 *
 * Throws when fewer than 2 qualifiers are provided.
 */
export function generateBracket(
  qualifiers: Qualifier[],
  tournamentId: string,
): BracketMatch[] {
  if (!Array.isArray(qualifiers)) {
    throw new Error("qualifiers must be an array.");
  }
  if (qualifiers.length < 2) {
    throw new Error(
      `A knockout bracket requires at least 2 qualifiers (got ${qualifiers.length}).`,
    );
  }

  const seedList = buildSeedList(qualifiers);
  const size = bracketSize(seedList.length);
  const order = seedOrdering(size);

  // Slot index → qualifier (null when the seed is a bye).
  const slotQualifier: (Qualifier | null)[] = order.map((seed) =>
    seed <= seedList.length ? seedList[seed - 1] : null,
  );

  const rounds = Math.log2(size);
  const matches: BracketMatch[] = [];

  // Round 0: pair slots (2i, 2i+1); home is the lower (better) seed.
  const round0: BracketMatch[] = [];
  const matchCount0 = size / 2;
  for (let i = 0; i < matchCount0; i++) {
    const left = slotQualifier[2 * i];
    const right = slotQualifier[2 * i + 1];
    const homeSeed = order[2 * i];
    const awaySeed = order[2 * i + 1];
    round0.push({
      id: knockoutMatchId(tournamentId, 0, i),
      roundIndex: 0,
      matchIndex: i,
      knockoutRound: roundNameForMatchCount(matchCount0),
      home: {
        seed: homeSeed,
        participantId: left?.participantId ?? null,
        groupId: left?.groupId ?? null,
      },
      away: {
        seed: awaySeed,
        participantId: right?.participantId ?? null,
        groupId: right?.groupId ?? null,
      },
      score: null,
    });
  }

  matches.push(...avoidSameGroupRematches(round0));

  // Later rounds: both slots TBD, filled by advancement.
  let prevRoundCount = matchCount0;
  for (let r = 1; r < rounds; r++) {
    const count = prevRoundCount / 2;
    for (let i = 0; i < count; i++) {
      matches.push({
        id: knockoutMatchId(tournamentId, r, i),
        roundIndex: r,
        matchIndex: i,
        knockoutRound: roundNameForMatchCount(count),
        home: { seed: null, participantId: null, groupId: null },
        away: { seed: null, participantId: null, groupId: null },
        score: null,
      });
    }
    prevRoundCount = count;
  }

  return matches;
}
// ---------------------------------------------------------------------------
// Advancement & champion
// ---------------------------------------------------------------------------

/**
 * The winner of a bracket match, or null if it is not yet decided.
 *
 * - A played match (score set): the side with more goals. Equal scores yield no
 *   winner (a knockout match must be decided; advancement waits).
 * - An unplayed first-round match with one bye side: the real side advances
 *   automatically.
 * - An unplayed match with both sides known / both TBD: no winner yet.
 * - A later-round empty slot is always TBD, never a bye.
 */
export function winnerOf(match: BracketMatch): BracketSlot | null {
  if (match.score != null) {
    if (match.score.home > match.score.away) return match.home;
    if (match.score.away > match.score.home) return match.away;
    return null; // draw: not decided
  }
  // Byes exist only in the seeded first round. In later rounds a null side
  // means its feeder match has not been decided yet and must never trigger an
  // automatic advance.
  if (
    match.roundIndex === 0 &&
    match.home.participantId != null &&
    match.away.participantId == null
  ) {
    return match.home;
  }
  if (
    match.roundIndex === 0 &&
    match.away.participantId != null &&
    match.home.participantId == null
  ) {
    return match.away;
  }
  return null;
}

/**
 * Propagates winners through the bracket, filling TBD slots in later rounds.
 *
 * Returns a new bracket; the input is not mutated. Scores are preserved as-is;
 * only the `home`/`away` slots of later rounds are populated from the winners
 * of the previous round (carrying each winner's seed, participant, and group).
 * Round 0 pairings are never changed by advancement.
 */
export function advanceBracket(matches: BracketMatch[]): BracketMatch[] {
  const byId = new Map<string, BracketMatch>();
  for (const m of matches) {
    byId.set(m.id, {
      ...m,
      home: { ...m.home },
      away: { ...m.away },
    });
  }

  const maxRound = matches.reduce(
    (max, m) => Math.max(max, m.roundIndex),
    0,
  );

  // Process rounds in ascending order so each round is fully resolved before
  // the next one consumes its winners.
  for (let r = 0; r < maxRound; r++) {
    const roundMatches = matches
      .filter((m) => m.roundIndex === r)
      .sort((a, b) => a.matchIndex - b.matchIndex);
    for (const m of roundMatches) {
      const winner = winnerOf(byId.get(m.id)!);
      if (winner == null || winner.participantId == null) continue;
      const nextIndex = Math.floor(m.matchIndex / 2);
      // Recover the tournament id prefix from the current match id.
      const prefix = m.id.slice(0, m.id.lastIndexOf(":ko:"));
      const nextMatchId = `${prefix}:ko:r${r + 1}:m${nextIndex}`;
      const next = byId.get(nextMatchId);
      if (!next) continue;
      const slot = m.matchIndex % 2 === 0 ? next.home : next.away;
      slot.participantId = winner.participantId;
      slot.seed = winner.seed;
      slot.groupId = winner.groupId;
    }
  }

  return [...byId.values()].sort(
    (a, b) => a.roundIndex - b.roundIndex || a.matchIndex - b.matchIndex,
  );
}

/**
 * The tournament champion: the winner of the final (last round). Returns null
 * until the final has been decided.
 */
export function getChampion(matches: BracketMatch[]): ParticipantId | null {
  if (matches.length === 0) return null;
  const final = matches.reduce(
    (acc, m) => (m.roundIndex > acc.roundIndex ? m : acc),
    matches[0],
  );
  const winner = winnerOf(final);
  return winner?.participantId ?? null;
}

// ---------------------------------------------------------------------------
// Conversion to/from the persisted `Match` shape
// ---------------------------------------------------------------------------

/**
 * Flattens the in-memory bracket into the persisted domain `Match` shape.
 *
 * `knockoutSeed` is the home (higher) seed of the match, for stable ordering
 * and seed display; null when the home slot is still TBD.
 */
export function bracketToMatches(bracket: BracketMatch[]): Match[] {
  return bracket.map((m) => ({
    id: m.id,
    stage: "knockout",
    groupId: null,
    knockoutRound: m.knockoutRound,
    knockoutSeed: m.home.seed,
    homeParticipantId: m.home.participantId,
    awayParticipantId: m.away.participantId,
    score: m.score,
  }));
}

/**
 * Overlays saved scores (keyed by match id) onto a freshly generated bracket.
 *
 * Returns a new bracket with `score` set where a saved score exists. Used by
 * the bracket page to recompute the advanced bracket from the qualifiers plus
 * the persisted knockout scores.
 */
export function applyScores(
  bracket: BracketMatch[],
  scoreById: Map<string, MatchScore>,
): BracketMatch[] {
  return bracket.map((m) => {
    const score = scoreById.get(m.id) ?? null;
    return score === m.score ? m : { ...m, score };
  });
}
