import { compareGroupLabels, type SavedParticipant } from "@/lib/db/setup";
import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches, getKnockoutMatches } from "@/lib/db/matches";
import { computeKnockoutView } from "@/lib/db/fixtures";
import { bracketToMatches } from "@/lib/tournament/knockout";
import {
  calculateStandings,
  calculateTournamentTotals,
} from "@/lib/tournament/standings";
import type {
  ManualTiebreakResolution,
  ScoringConfig,
  TiebreakerOrder,
} from "@/lib/tournament/types";

export const metadata = { title: "Standings" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so admin-entered scores show up immediately on the public site.
export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const [setup, matches, championshipMatches, consolationMatches] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getKnockoutMatches("championship"),
    getKnockoutMatches("consolation"),
  ]);
  const championship = computeKnockoutView(
    setup,
    matches,
    championshipMatches,
    "championship",
  );
  const consolation = computeKnockoutView(
    setup,
    matches,
    consolationMatches,
    "consolation",
  );
  const allMatches = [
    ...matches,
    ...(championship.status === "bracket"
      ? bracketToMatches(championship.bracket)
      : []),
    ...(consolation.status === "bracket"
      ? bracketToMatches(consolation.bracket)
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Standings</h1>
        <p className="mt-1 text-slate-600">
          Group tables and all-player tournament totals, recomputed live from
          the entered scores.
        </p>
      </div>

      {!setup.tournament ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          No tournament has been set up yet. Standings will appear here once the
          administrator configures the tournament and enters scores.
        </p>
      ) : matches.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          Fixtures haven&apos;t been generated yet. Standings will appear once
          matches are scheduled and scores are entered.
        </p>
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
          qualifiersPerGroup={setup.tournament.qualifiersPerGroup}
        />
      )}
    </div>
  );
}

interface StandingsTablesProps {
  participants: SavedParticipant[];
  groups: { id: string; label: string }[];
  matches: Parameters<typeof calculateStandings>[0];
  allMatches: Parameters<typeof calculateTournamentTotals>[0];
  scoring: ScoringConfig;
  tiebreakerOrder: TiebreakerOrder;
  manualResolutions: ManualTiebreakResolution[];
  qualifiersPerGroup: number;
}

function StandingsTables({
  participants,
  groups,
  matches,
  allMatches,
  scoring,
  tiebreakerOrder,
  manualResolutions,
  qualifiersPerGroup,
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
        const groupComplete =
          groupMatches.length > 0 &&
          groupMatches.every((match) => match.score != null);
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
                    const championship = row.position <= qualifiersPerGroup;
                    return (
                      <tr
                        key={row.participantId}
                        className={`border-b border-slate-100 last:border-0 ${
                          championship ? "bg-emerald-50/60" : ""
                        }`}
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
                            className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              championship
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {championship
                              ? groupComplete
                                ? "Championship"
                                : "Champ. zone"
                              : groupComplete
                                ? "Consolation"
                                : "Cons. zone"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.played}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.wins}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.draws}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.losses}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.goalsFor}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.goalsAgainst}</td>
                        <td className="px-3 py-2 text-center text-slate-700">
                          {row.goalDifference > 0
                            ? `+${row.goalDifference}`
                            : row.goalDifference}
                        </td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-900">
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
        Every played group, Championship, and Consolation match. Byes do not
        count as matches.
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
                  <td className="px-3 py-2 text-center text-slate-700">
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
