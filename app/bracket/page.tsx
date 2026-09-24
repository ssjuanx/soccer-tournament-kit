import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches } from "@/lib/db/matches";

export const metadata = { title: "Bracket" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so the bracket status reflects the current group-stage progress.
export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const [setup, matches] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
  ]);

  const hasTournament = setup.tournament != null;
  const playedCount = matches.filter((m) => m.score != null).length;

  let message: string;
  if (!hasTournament) {
    message =
      "No tournament has been set up yet. The knockout bracket will appear here once the group stage is complete.";
  } else if (matches.length === 0) {
    message =
      "Group-stage fixtures haven't been generated yet. The knockout bracket will appear here once the group stage is complete.";
  } else if (playedCount < matches.length) {
    message = `The group stage is in progress (${playedCount} of ${matches.length} matches played). The knockout bracket will appear here once the group stage is complete.`;
  } else {
    message =
      "The group stage is complete. The knockout bracket will be generated next.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bracket</h1>
        <p className="mt-1 text-slate-600">
          The knockout bracket from the round of 16 to the final.
        </p>
      </div>
      <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
        {message}
      </p>
    </div>
  );
}