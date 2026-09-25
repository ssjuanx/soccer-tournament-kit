import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches, getKnockoutMatches } from "@/lib/db/matches";
import { computeKnockoutView } from "@/lib/db/fixtures";
import { BracketView } from "./bracket-view";

export const metadata = { title: "Bracket" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so the bracket reflects the current knockout progress.
export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const [
    setup,
    groupMatches,
    championshipMatches,
    consolationMatches,
  ] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getKnockoutMatches("championship"),
    getKnockoutMatches("consolation"),
  ]);

  const championship = computeKnockoutView(
    setup,
    groupMatches,
    championshipMatches,
    "championship",
  );
  const consolation = computeKnockoutView(
    setup,
    groupMatches,
    consolationMatches,
    "consolation",
  );

  const messageFor = (status: typeof championship): string | null => {
    if (status.status === "none") {
      return setup.tournament
      ? "Group-stage fixtures haven't been generated yet. The knockout bracket will appear here once the group stage is complete."
      : "No tournament has been set up yet. The knockout bracket will appear here once the group stage is complete.";
    }
    if (status.status === "groupStageIncomplete") {
      return `The group stage is in progress (${status.played} of ${status.total} matches played).`;
    }
    if (status.status === "ready") {
      return "The group stage is complete. This bracket will appear once the administrator generates it.";
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bracket</h1>
        <p className="mt-1 text-slate-600">
          Championship and Consolation single-elimination brackets.
        </p>
      </div>

      {([
        ["Championship", championship],
        ["Consolation", consolation],
      ] as const).map(([title, view]) => (
        <section key={title} className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          {view.status === "bracket" ? (
            <BracketView
              bracket={view.bracket}
              champion={view.champion}
              participants={setup.participants}
              championLabel={
                title === "Championship"
                  ? "Championship winner"
                  : "Consolation winner"
              }
            />
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
              {messageFor(view)}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
