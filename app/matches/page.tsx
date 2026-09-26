import { compareGroupLabels, type SavedParticipant } from "@/lib/db/setup";
import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches, getKnockoutMatches } from "@/lib/db/matches";
import { computeKnockoutView } from "@/lib/db/fixtures";
import { orderGroupMatchesForPlay } from "@/lib/tournament/fixtures";
import type { Match } from "@/lib/tournament/types";
import { BracketView } from "../bracket/bracket-view";

export const metadata = { title: "Matches" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so admin-entered scores show up immediately on the public site.
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const [setup, matches, championshipMatches, consolationMatches] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getKnockoutMatches("championship"),
    getKnockoutMatches("consolation"),
  ]);

  const championshipView = computeKnockoutView(
    setup,
    matches,
    championshipMatches,
    "championship",
  );
  const consolationView = computeKnockoutView(
    setup,
    matches,
    consolationMatches,
    "consolation",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Matches</h1>
        <p className="mt-1 text-slate-600">
          Every scheduled group-stage match, its final score, and both knockout
          brackets.
        </p>
      </div>

      {!setup.tournament ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          No tournament has been set up yet. Matches will appear here once the
          administrator generates fixtures.
        </p>
      ) : matches.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          No fixtures have been generated yet. Matches will appear here once the
          administrator generates them.
        </p>
      ) : (
        <MatchesList
          participants={setup.participants}
          groups={setup.groups}
          matches={matches}
        />
      )}

      {([
        ["Championship", championshipView],
        ["Consolation", consolationView],
      ] as const).map(([title, view]) =>
        view.status === "bracket" ? (
          <section key={title} className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
            <BracketView
              bracket={view.bracket}
              champion={view.champion}
              participants={setup.participants}
              championLabel={`${title} winner`}
            />
          </section>
        ) : null,
      )}
    </div>
  );
}

interface MatchesListProps {
  participants: SavedParticipant[];
  groups: { id: string; label: string }[];
  matches: Match[];
}

function MatchesList({ participants, groups, matches }: MatchesListProps) {
  const participantById = new Map<string, SavedParticipant>();
  for (const p of participants) {
    participantById.set(p.id, p);
  }

  const labelByGroupId = new Map<string, string>();
  for (const group of groups) {
    labelByGroupId.set(group.id, group.label);
  }

  const orderedGroupIds = groups.map((group) => group.id).sort((a, b) => {
    const la = labelByGroupId.get(a) ?? a;
    const lb = labelByGroupId.get(b) ?? b;
    return compareGroupLabels(la, lb);
  });
  const playOrder = orderGroupMatchesForPlay(matches, orderedGroupIds);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Match order</h2>
      <p className="mt-1 text-xs text-slate-500">
        Play from top to bottom. No times are assigned.
      </p>
      <ol className="mt-2 divide-y divide-slate-100">
        {playOrder.map((match, index) => {
              const home = match.homeParticipantId
                ? participantById.get(match.homeParticipantId)
                : undefined;
              const away = match.awayParticipantId
                ? participantById.get(match.awayParticipantId)
                : undefined;
              const played = match.score != null;
              return (
                <li
                  key={match.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="w-20 shrink-0 text-xs font-semibold text-slate-500">
                    #{index + 1} · Group {labelByGroupId.get(match.groupId ?? "") ?? "?"}
                  </span>
                  <span className="flex-1 text-right text-sm text-slate-900">
                    {home ? home.name : "TBD"}
                    {home?.teamName ? (
                      <span className="text-slate-500"> ({home.teamName})</span>
                    ) : null}
                  </span>
                  <span className="min-w-[3.5rem] rounded-md bg-slate-100 px-3 py-1 text-center text-sm font-semibold text-slate-900">
                    {played ? `${match.score!.home} – ${match.score!.away}` : "–"}
                  </span>
                  <span className="flex-1 text-sm text-slate-900">
                    {away ? away.name : "TBD"}
                    {away?.teamName ? (
                      <span className="text-slate-500"> ({away.teamName})</span>
                    ) : null}
                  </span>
                </li>
              );
        })}
      </ol>
    </section>
  );
}
