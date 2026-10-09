import { getTournamentRules } from "@/lib/db/rules";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await getTournamentRules();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        subtitle="Tournament rules and event-day decisions."
      />

      {rules.length === 0 ? (
        <EmptyState>Rules have not been published yet.</EmptyState>
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
