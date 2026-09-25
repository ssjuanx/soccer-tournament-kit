import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches, getKnockoutMatches } from "@/lib/db/matches";
import { computeKnockoutView } from "@/lib/db/fixtures";
import { BracketView } from "./bracket-view";

export const metadata = { title: "Bracket" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so the bracket reflects the current knockout progress.
export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const [setup, groupMatches, knockoutMatches] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getKnockoutMatches(),
  ]);

  const view = computeKnockoutView(setup, groupMatches, knockoutMatches);

  let message: string | null = null;
  if (view.status === "none") {
    message = setup.tournament
      ? "Group-stage fixtures haven't been generated yet. The knockout bracket will appear here once the group stage is complete."
      : "No tournament has been set up yet. The knockout bracket will appear here once the group stage is complete.";
  } else if (view.status === "groupStageIncomplete") {
    message = `The group stage is in progress (${view.played} of ${view.total} matches played). The knockout bracket will appear here once the group stage is complete.`;
  } else if (view.status === "ready") {
    message =
      "The group stage is complete. The knockout bracket will appear here once the administrator generates it.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bracket</h1>
        <p className="mt-1 text-slate-600">
          The single-elimination knockout bracket, from the first round to the
          final.
        </p>
      </div>

      {view.status === "bracket" ? (
        <BracketView
          bracket={view.bracket}
          champion={view.champion}
          participants={setup.participants}
        />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          {message}
        </p>
      )}
    </div>
  );
}