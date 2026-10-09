import { getKnockoutMatches } from "./matches.ts";
import { computeKnockoutView, type KnockoutView } from "./fixtures.ts";
import { slugifyBracketName, type TournamentSetupSnapshot } from "./setup.ts";
import type { AdvancementDestination, Match } from "../tournament/types.ts";

/**
 * One entry per advancement destination, pairing the bracket's display title
 * and slug with the computed {@link KnockoutView} for that bracket.
 */
export interface BracketViewEntry {
  title: string;
  slug: string;
  view: KnockoutView;
}

/**
 * Slugify every advancement destination name in order. Centralised so the
 * slug derivation stays consistent across the matches, bracket, and standings
 * pages (and the admin panel).
 */
export function getAdvancementSlugs(
  advancement: AdvancementDestination[],
): string[] {
  return advancement.map((d) => slugifyBracketName(d.name));
}

/**
 * Loads and computes the knockout view for every advancement destination in a
 * single pass. This replaces the duplicated
 * `advancement → slugs → getKnockoutMatches → computeKnockoutView` pipeline that
 * previously lived inline in `matches`, `bracket`, and `standings` pages.
 *
 * Returns an empty array when no tournament is configured. When the group stage
 * has no fixtures yet, each entry's `view` is `{ status: "none" }` (handled
 * inside {@link computeKnockoutView}).
 */
export async function loadBracketViews(
  setup: TournamentSetupSnapshot,
  groupMatches: Match[],
): Promise<BracketViewEntry[]> {
  const advancement = setup.tournament?.advancement ?? [];
  if (advancement.length === 0) {
    return [];
  }

  const slugs = getAdvancementSlugs(advancement);
  const knockoutMatchLists = await Promise.all(
    slugs.map((slug) => getKnockoutMatches(slug)),
  );

  return advancement.map((dest, i) => ({
    title: dest.name,
    slug: slugs[i],
    view: computeKnockoutView(
      setup,
      groupMatches,
      knockoutMatchLists[i],
      slugs[i],
    ),
  }));
}

/**
 * Loads the persisted knockout matches for every advancement destination and
 * returns them keyed by bracket slug. Used by the admin panel, which needs the
 * raw `Match[]` per bracket (rather than a computed view) so it can render and
 * edit knockout fixtures.
 */
export async function loadKnockoutMatchesBySlug(
  advancement: AdvancementDestination[],
): Promise<Record<string, Match[]>> {
  const result: Record<string, Match[]> = {};
  if (advancement.length === 0) {
    return result;
  }

  const slugs = getAdvancementSlugs(advancement);
  const loaded = await Promise.all(
    slugs.map((slug) => getKnockoutMatches(slug)),
  );
  slugs.forEach((slug, i) => {
    result[slug] = loaded[i];
  });
  return result;
}