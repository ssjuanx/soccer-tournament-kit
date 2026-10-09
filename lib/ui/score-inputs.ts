import type { Match } from "../tournament/types.ts";

/** A pair of free-text score inputs (home/away) bound to a single match. */
export interface ScoreInput {
  home: string;
  away: string;
}

/**
 * Builds the initial score-input state from a match list. Each match's saved
 * score (if any) is rendered back into the inputs; unplayed matches start
 * blank. Consolidates the two identical copies that previously lived in
 * `admin-setup.tsx` and `knockout-section.tsx`.
 */
export function initScoreInputs(
  matches: Match[],
): Record<string, ScoreInput> {
  const inputs: Record<string, ScoreInput> = {};
  for (const match of matches) {
    inputs[match.id] =
      match.score != null
        ? { home: String(match.score.home), away: String(match.score.away) }
        : { home: "", away: "" };
  }
  return inputs;
}