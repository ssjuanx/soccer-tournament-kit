import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches } from "@/lib/db/matches";
import { loadBracketViews } from "@/lib/db/bracket-views";
import { BracketView } from "./bracket-view";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Bracket" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered), so the bracket reflects the current knockout progress.
export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const setup = await getTournamentSetup();
  const groupMatches = await getGroupMatches();

  const views = await loadBracketViews(setup, groupMatches);

  const messageFor = (status: (typeof views)[number]["view"]): string | null => {
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
      <PageHeader
        title="Bracket"
        subtitle="Single-elimination knockout brackets."
      />

      {views.map(({ title, slug, view }) => (
        <section key={slug} className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          {view.status === "bracket" ? (
            <BracketView
              bracket={view.bracket}
              champion={view.champion}
              participants={setup.participants}
              championLabel={`${title} winner`}
            />
          ) : (
            <EmptyState>{messageFor(view)}</EmptyState>
          )}
        </section>
      ))}
    </div>
  );
}
