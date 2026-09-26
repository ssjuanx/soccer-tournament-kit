import AdminSetup from "./admin-setup";
import AdminRules from "./admin-rules";
import { getTournamentSetup } from "@/lib/db/tournaments";
import { getGroupMatches, getKnockoutMatches } from "@/lib/db/matches";
import { getTournamentRules } from "@/lib/db/rules";

export const metadata = { title: "Admin" };

// Always read the latest persisted setup and fixtures at request time (never
// prerendered).
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [
    initialSetup,
    initialMatches,
    initialChampionshipMatches,
    initialConsolationMatches,
    initialRules,
  ] = await Promise.all([
    getTournamentSetup(),
    getGroupMatches(),
    getKnockoutMatches("championship"),
    getKnockoutMatches("consolation"),
    getTournamentRules(),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-slate-600">
          Configure the tournament and enter the drawn participants and teams.
        </p>
      </div>
      <AdminSetup
        initialSetup={initialSetup}
        initialMatches={initialMatches}
        initialChampionshipMatches={initialChampionshipMatches}
        initialConsolationMatches={initialConsolationMatches}
      />
      <AdminRules
        initialRules={initialRules}
        tournamentReady={initialSetup.tournament != null}
      />
    </div>
  );
}
