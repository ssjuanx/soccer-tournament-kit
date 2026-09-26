import { getTournamentRules } from "@/lib/db/rules";

export const metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await getTournamentRules();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rules</h1>
        <p className="mt-1 text-slate-600">
          Tournament rules and event-day decisions.
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
          Rules have not been published yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rules.map((rule, index) => (
            <article
              key={rule.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Rule {index + 1}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                {rule.title}
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {rule.body}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
