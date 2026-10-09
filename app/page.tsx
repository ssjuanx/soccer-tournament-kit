import Link from "next/link";
import { getTournamentSetup } from "@/lib/db/tournaments";

export const dynamic = "force-dynamic";

const features = [
  {
    href: "/standings",
    title: "Standings",
    description: "Group-stage tables with points, goals, and tiebreakers.",
  },
  {
    href: "/matches",
    title: "Matches",
    description: "Every scheduled match and its final score.",
  },
  {
    href: "/bracket",
    title: "Bracket",
    description: "Championship and Consolation, from the first round to both finals.",
  },
];

export default async function HomePage() {
  const setup = await getTournamentSetup();
  const tournament = setup.tournament;
  const heading = tournament?.name || "FC Tournament";
  const details = [tournament?.edition, tournament?.date]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {tournament ? heading : "Welcome to FC Tournament"}
        </h1>
        {details ? (
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {details}
          </p>
        ) : null}
        <p className="max-w-2xl text-slate-600">
          {tournament?.description ||
            "Four groups compete for two paths: the top two in each group advance to the Championship, while everyone else continues in Consolation."}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/standings"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            View standings
          </Link>
          <Link
            href="/bracket"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            View brackets
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((feature) => (
          <Link
            key={feature.href}
            href={feature.href}
            className="group rounded-lg border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400"
          >
            <h2 className="text-lg font-semibold group-hover:text-slate-900">
              {feature.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{feature.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
