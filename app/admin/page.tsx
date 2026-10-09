import AdminPanel from "./admin-panel";
import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches } from "@/lib/db/matches";
import { getTournamentRules } from "@/lib/db/rules";
import { loadKnockoutMatchesBySlug } from "@/lib/db/bracket-views";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Admin" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered).
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [initialSetup, initialMatches, initialRules] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getTournamentRules(),
  ]);

  // Load knockout matches for every advancement destination so the admin panel
  // can render each bracket section with its persisted matches.
  const initialKnockoutMatches = initialSetup.tournament
    ? await loadKnockoutMatchesBySlug(initialSetup.tournament.advancement)
    : ({} as Record<string, never>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        subtitle="Configure the tournament and enter the drawn participants and teams."
      />
      <AdminPanel
        hasTournament={initialSetup.tournament != null}
        initialSetup={initialSetup}
        initialMatches={initialMatches}
        initialKnockoutMatches={initialKnockoutMatches}
        initialRules={initialRules}
      />
    </div>
  );
}
