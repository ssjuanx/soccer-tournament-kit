import type { SavedParticipant } from "@/lib/db/setup";
import type { BracketMatch } from "@/lib/tournament/knockout";
import type { KnockoutRound } from "@/lib/tournament/types";

const ROUND_LABELS: Record<KnockoutRound, string> = {
  round_of_64: "Round of 64",
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarter_final: "Quarter-finals",
  semi_final: "Semi-finals",
  final: "Final",
};

interface BracketViewProps {
  bracket: BracketMatch[];
  champion: string | null;
  championLabel?: string;
  participants: SavedParticipant[];
}

export function BracketView({
  bracket,
  champion,
  championLabel = "Champion",
  participants,
}: BracketViewProps) {
  const participantById = new Map<string, SavedParticipant>();
  for (const p of participants) participantById.set(p.id, p);

  // Group matches by round index (already ordered round-then-match).
  const rounds = new Map<number, BracketMatch[]>();
  const roundsWithByes = new Set<number>();
  for (const m of bracket) {
    const isAutomaticBye =
      m.roundIndex === 0 &&
      (m.home.participantId == null) !== (m.away.participantId == null);
    if (isAutomaticBye) {
      roundsWithByes.add(m.roundIndex);
      continue;
    }
    const list = rounds.get(m.roundIndex);
    if (list) list.push(m);
    else rounds.set(m.roundIndex, [m]);
  }
  const roundIndices = [...rounds.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {champion != null ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-amber-900">
            🏆 {championLabel}: {participantById.get(champion)?.name ?? "TBD"}
            {participantById.get(champion)?.teamName ? (
              <span className="text-amber-700">
                {" "}
                ({participantById.get(champion)!.teamName})
              </span>
            ) : null}
          </h2>
        </div>
      ) : null}

      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {roundIndices.map((roundIndex) => {
          const matches = rounds.get(roundIndex)!;
          const label = roundsWithByes.has(roundIndex)
            ? "Preliminary round"
            : ROUND_LABELS[matches[0].knockoutRound];
          return (
            <section
              key={roundIndex}
              className="flex min-h-64 flex-col rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {label}
              </h2>
              <ul className="flex flex-1 flex-col justify-evenly gap-4">
                {matches.map((m) => (
                  <BracketMatchRow
                    key={m.id}
                    match={m}
                    participantById={participantById}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BracketMatchRow({
  match,
  participantById,
}: {
  match: BracketMatch;
  participantById: Map<string, SavedParticipant>;
}) {
  const home = match.home.participantId
    ? participantById.get(match.home.participantId)
    : null;
  const away = match.away.participantId
    ? participantById.get(match.away.participantId)
    : null;
  const isBye =
    match.roundIndex === 0 &&
    (match.home.participantId == null) !==
      (match.away.participantId == null);
  const played = match.score != null;
  const homeWon = played && match.score!.home > match.score!.away;
  const awayWon = played && match.score!.away > match.score!.home;

  return (
    <li className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <SeedBadge seed={match.home.seed} />
        <span
          className={`min-w-0 flex-1 break-words text-sm leading-5 ${
            homeWon ? "font-semibold text-slate-900" : "text-slate-700"
          }`}
        >
          {home ? home.name : isBye ? "Bye" : "TBD"}
          {home?.teamName ? (
            <span className="text-slate-500"> ({home.teamName})</span>
          ) : null}
        </span>
        <span className="min-w-[2.5rem] text-right text-sm font-semibold text-slate-900">
          {played ? match.score!.home : ""}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <SeedBadge seed={match.away.seed} />
        <span
          className={`min-w-0 flex-1 break-words text-sm leading-5 ${
            awayWon ? "font-semibold text-slate-900" : "text-slate-700"
          }`}
        >
          {away ? away.name : isBye ? "Bye" : "TBD"}
          {away?.teamName ? (
            <span className="text-slate-500"> ({away.teamName})</span>
          ) : null}
        </span>
        <span className="min-w-[2.5rem] text-right text-sm font-semibold text-slate-900">
          {played ? match.score!.away : ""}
        </span>
      </div>
    </li>
  );
}

function SeedBadge({ seed }: { seed: number | null }) {
  if (seed == null) return <span className="min-w-[1.75rem]" />;
  return (
    <span className="min-w-[1.75rem] rounded bg-slate-200 px-1.5 py-0.5 text-center text-xs font-medium text-slate-600">
      {seed}
    </span>
  );
}
