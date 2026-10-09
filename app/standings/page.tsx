import { compareGroupLabels, type SavedParticipant } from "@/lib/db/setup";
import { getGroupSizes } from "@/lib/tournament/groups";
import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches } from "@/lib/db/matches";
import { loadBracketViews } from "@/lib/db/bracket-views";
import { bracketToMatches } from "@/lib/tournament/knockout";
import {
  calculateStandings,
  calculateTournamentTotals,
} from "@/lib/tournament/standings";
import type {
  AdvancementDestination,
  ManualTiebreakResolution,
  ScoringConfig,
  TiebreakerOrder,
} from "@/lib/tournament/types";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Standings" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so admin-entered scores show up immediately on the public site.
export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const setup = await getTournamentSetup();
  const matches = await getGroupMatches();

  const advancement = setup.tournament?.advancement ?? [];
  const bracketViews = await loadBracketViews(setup, matches);
  const bracketMatches = bracketViews.map(({ view }) =>
    view.status === "bracket" ? bracketToMatches(view.bracket) : [],
  );

  const allMatches = [...matches, ...bracketMatches.flat()];

  const tournament = setup.tournament;
  const maxGroupSize =
    tournament && tournament.participantCount > 0 && tournament.groupCount > 0
      ? Math.max(...getGroupSizes(tournament.participantCount, tournament.groupCount))
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Standings"
        subtitle="Group tables and all-player tournament totals, recomputed live from the entered scores."
      />

      {!setup.tournament ? (
        <EmptyState>
          No tournament has been set up yet. Standings will appear here once the
          administrator configures the tournament and enters scores.
        </EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState>
          Fixtures haven&apos;t been generated yet. Standings will appear once
          matches are scheduled and scores are entered.
        </EmptyState>
      ) : (
        <StandingsTables
          participants={setup.participants}
          groups={setup.groups}
          matches={matches}
          allMatches={allMatches}
          scoring={{
            winPoints: setup.tournament.winPoints,
            drawPoints: setup.tournament.drawPoints,
            lossPoints: setup.tournament.lossPoints,
          }}
          tiebreakerOrder={setup.tournament.tiebreakerOrder}
          manualResolutions={setup.manualResolutions}
          advancement={advancement}
          maxGroupSize={maxGroupSize}
        />
      )}
    </div>
  );
}

/**
 * Returns the advancement-destination name a given standing position qualifies
 * for, or `null` if the position falls outside every bracket's range (i.e. the
 * position is eliminated — no knockout bracket claims it).
 */
function bracketForPosition(
  position: number,
  advancement: AdvancementDestination[],
): string | null {
  for (const dest of advancement) {
    if (position >= dest.fromPosition && position <= dest.toPosition) {
      return dest.name;
    }
  }
  return null;
}

/** The index of the advancement destination a position falls into (-1 if none). */
function bracketIndexForPosition(
  position: number,
  advancement: AdvancementDestination[],
): number {
  for (let i = 0; i < advancement.length; i++) {
    const dest = advancement[i];
    if (position >= dest.fromPosition && position <= dest.toPosition) {
      return i;
    }
  }
  return -1;
}

/**
 * The 1-based standing positions in `1..maxGroupSize` that no advancement
 * destination covers — those finishers are eliminated. Returns an empty list
 * when `maxGroupSize` is unknown (no configured setup) so nothing misleading is
 * shown.
 */
function eliminatedPositions(
  advancement: AdvancementDestination[],
  maxGroupSize: number,
): number[] {
  if (maxGroupSize <= 0) return [];
  const out: number[] = [];
  for (let pos = 1; pos <= maxGroupSize; pos++) {
    if (bracketForPosition(pos, advancement) === null) {
      out.push(pos);
    }
  }
  return out;
}

/** Formats a list of positions as a compact human-readable range string. */
function formatPositions(positions: number[]): string {
  if (positions.length === 0) return "";
  const sorted = [...positions].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = cur;
    prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(", ");
}

const BRACKET_COLORS = [
  { bg: "bg-emerald-50/60", badge: "bg-emerald-100 text-emerald-700" },
  { bg: "bg-indigo-50/60", badge: "bg-indigo-100 text-indigo-700" },
  { bg: "bg-amber-50/60", badge: "bg-amber-100 text-amber-700" },
  { bg: "bg-rose-50/60", badge: "bg-rose-100 text-rose-700" },
];
const ELIMINATED_COLOR = { bg: "", badge: "bg-slate-100 text-slate-500" };

function bracketColor(index: number) {
  if (index < 0) return ELIMINATED_COLOR;
  return BRACKET_COLORS[index % BRACKET_COLORS.length];
}

interface StandingsTablesProps {
  participants: SavedParticipant[];
  groups: { id: string; label: string }[];
  matches: Parameters<typeof calculateStandings>[0];
  allMatches: Parameters<typeof calculateTournamentTotals>[0];
  scoring: ScoringConfig;
  tiebreakerOrder: TiebreakerOrder;
  manualResolutions: ManualTiebreakResolution[];
  advancement: AdvancementDestination[];
  maxGroupSize: number;
}

function StandingsTables({
  participants,
  groups,
  matches,
  allMatches,
  scoring,
  tiebreakerOrder,
  manualResolutions,
  advancement,
  maxGroupSize,
}: StandingsTablesProps) {
  // Group participants by their groupId, preserving the snapshot's draw order.
  const participantsByGroup = new Map<string, SavedParticipant[]>();
  for (const participant of participants) {
    if (!participant.groupId) continue;
    const list = participantsByGroup.get(participant.groupId);
    if (list) {
      list.push(participant);
    } else {
      participantsByGroup.set(participant.groupId, [participant]);
    }
  }

  const labelByGroupId = new Map<string, string>();
  for (const group of groups) {
    labelByGroupId.set(group.id, group.label);
  }

  // Only show groups that actually have participants, ordered by label (A, B, …).
  const visibleGroups = groups
    .filter((g) => participantsByGroup.has(g.id))
    .sort((a, b) => compareGroupLabels(a.label, b.label));

  const domainParticipants = participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    drawOrder: participant.drawOrder,
    assignedTeamId: null,
    groupId: participant.groupId,
  }));
  const globalTotals = calculateTournamentTotals(
    allMatches,
    domainParticipants,
  );
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );

  return (
    <div className="space-y-6">
      <StandingsLegend advancement={advancement} maxGroupSize={maxGroupSize} />
      <GlobalTotalsTable
        totals={globalTotals}
        participantById={participantById}
        labelByGroupId={labelByGroupId}
      />
      {visibleGroups.map((group) => {
        const groupParticipants = participantsByGroup.get(group.id) ?? [];
        const groupMatches = matches.filter(
          (match) => match.groupId === group.id,
        );
        // The standings engine only needs id + drawOrder; map to the domain shape.
        const standings = calculateStandings(
          groupMatches,
          groupParticipants.map((p) => ({
            id: p.id,
            name: p.name,
            drawOrder: p.drawOrder,
            assignedTeamId: null,
            groupId: p.groupId,
          })),
          { scoring, tiebreakerOrder, manualResolutions },
        );
        const hasUnresolved = standings.some((r) => r.unresolved);
        return (
          <section
            key={group.id}
            className="rounded-lg border border-slate-200 bg-white p-5"
            aria-labelledby={`group-${group.id}-heading`}
          >
            <h2
              id={`group-${group.id}-heading`}
              className="text-lg font-semibold text-slate-900"
            >
              Group {group.label}
              {hasUnresolved ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Tiebreak pending
                </span>
              ) : null}
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-2 pr-3 font-medium">#</th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Participant
                    </th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">P</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">W</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">D</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">L</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">GF</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">GA</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">GD</th>
                    <th scope="col" className="px-3 py-2 text-center font-semibold text-slate-900">
                      Pts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => {
                    const participant = groupParticipants.find(
                      (p) => p.id === row.participantId,
                    );
                    const bIdx = bracketIndexForPosition(row.position, advancement);
                    const bName = bracketForPosition(row.position, advancement);
                    const isEliminated = bIdx < 0;
                    const color = bracketColor(bIdx);
                    return (
                      <tr
                        key={row.participantId}
                        className={`border-b border-slate-100 last:border-0 ${color.bg}`}
                      >
                        <td className="py-2 pr-3 font-medium text-slate-900">
                          {row.position}
                          {row.unresolved ? (
                            <span
                              title="Tiebreak pending — this position is shared pending manual resolution"
                              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle"
                            />
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-slate-900">
                          {participant?.name ?? "—"}
                          {participant?.teamName ? (
                            <span className="text-slate-500">
                              {" "}
                              ({participant.teamName})
                            </span>
                          ) : null}
                          <span
                            className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color.badge}`}
                          >
                            {isEliminated ? "Eliminado" : bName}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.played}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.wins}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.draws}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.losses}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.goalsFor}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.goalsAgainst}</td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-900">
                          {row.goalDifference > 0
                            ? `+${row.goalDifference}`
                            : row.goalDifference}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-emerald-700">
                          {row.points}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StandingsLegend({
  advancement,
  maxGroupSize,
}: {
  advancement: AdvancementDestination[];
  maxGroupSize: number;
}) {
  const eliminated = eliminatedPositions(advancement, maxGroupSize);
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="standings-legend-heading"
    >
      <h2
        id="standings-legend-heading"
        className="text-sm font-semibold text-slate-900"
      >
        Legend
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        {advancement.map((dest, i) => {
          const color = bracketColor(i);
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-flex h-3 w-3 rounded ${color.badge.split(" ")[0]}`}
              />
              <span className="font-medium text-slate-700">
                {dest.name || "Untitled"}
              </span>
              <span className="text-slate-400">
                {dest.fromPosition === 1
                  ? `top ${dest.toPosition} per group`
                  : dest.fromPosition === dest.toPosition
                    ? `position ${dest.fromPosition} per group`
                    : `positions ${dest.fromPosition}–${dest.toPosition} per group`}
              </span>
            </span>
          );
        })}
        {eliminated.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex h-3 w-3 rounded ${ELIMINATED_COLOR.badge.split(" ")[0]}`}
            />
            <span className="font-medium text-slate-700">Eliminated</span>
            <span className="text-slate-400">
              · positions {formatPositions(eliminated)} per group
            </span>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>Tiebreak pending</span>
        </span>
      </div>
      {eliminated.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Everyone else (positions {formatPositions(eliminated)} of each
          group) will be eliminated.
        </p>
      ) : maxGroupSize > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          All positions qualify — no one is eliminated.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        P = Played · W = Wins · D = Draws · L = Losses · GF = Goals for ·
        GA = Goals against · GD = Goal difference (bold) · Pts = Points
        (highlighted)
      </p>
    </section>
  );
}

function GlobalTotalsTable({
  totals,
  participantById,
  labelByGroupId,
}: {
  totals: ReturnType<typeof calculateTournamentTotals>;
  participantById: Map<string, SavedParticipant>;
  labelByGroupId: Map<string, string>;
}) {
  return (
    <section
      className="rounded-lg border border-slate-300 bg-white p-5"
      aria-labelledby="global-standings-heading"
    >
      <h2
        id="global-standings-heading"
        className="text-xl font-semibold text-slate-900"
      >
        Tournament totals
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Every played group and knockout match. Byes do not count as matches.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">#</th>
              <th scope="col" className="py-2 pr-3 font-medium">Participant</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">Group</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">P</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">W</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">D</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">L</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold text-slate-900">GF</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">GA</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">GD</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row, index) => {
              const participant = participantById.get(row.participantId);
              return (
                <tr
                  key={row.participantId}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {index + 1}
                  </td>
                  <td className="py-2 pr-3 text-slate-900">
                    {participant?.name ?? "—"}
                    {participant?.teamName ? (
                      <span className="text-slate-500">
                        {" "}({participant.teamName})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">
                    {labelByGroupId.get(participant?.groupId ?? "") ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-700">{row.played}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{row.wins}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{row.draws}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{row.losses}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-900">{row.goalsFor}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{row.goalsAgainst}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-900">
                    {row.goalDifference > 0
                      ? `+${row.goalDifference}`
                      : row.goalDifference}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
