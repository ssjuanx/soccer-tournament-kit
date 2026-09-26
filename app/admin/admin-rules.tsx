"use client";

import { useState } from "react";

import {
  createTournamentRuleAction,
  deleteTournamentRuleAction,
  updateTournamentRuleAction,
} from "@/lib/db/actions";
import type { TournamentRule } from "@/lib/db/rules";

interface RuleDraft {
  title: string;
  body: string;
}

function draftsFrom(rules: TournamentRule[]): Record<string, RuleDraft> {
  return Object.fromEntries(
    rules.map((rule) => [rule.id, { title: rule.title, body: rule.body }]),
  );
}

export default function AdminRules({
  initialRules,
  tournamentReady,
}: {
  initialRules: TournamentRule[];
  tournamentReady: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState(() => draftsFrom(initialRules));
  const [newRule, setNewRule] = useState<RuleDraft>({ title: "", body: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function accept(updated: TournamentRule[], successMessage: string) {
    setRules(updated);
    setDrafts(draftsFrom(updated));
    setMessage(successMessage);
  }

  async function handleCreate() {
    setBusyId("new");
    setMessage(null);
    const result = await createTournamentRuleAction(newRule.title, newRule.body);
    if (result.ok) {
      accept(result.rules, "Rule added.");
      setNewRule({ title: "", body: "" });
    } else {
      setMessage(result.error);
    }
    setBusyId(null);
  }

  async function handleSave(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    setMessage(null);
    const result = await updateTournamentRuleAction(id, draft.title, draft.body);
    if (result.ok) accept(result.rules, "Rule saved.");
    else setMessage(result.error);
    setBusyId(null);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this rule?")) return;
    setBusyId(id);
    setMessage(null);
    const result = await deleteTournamentRuleAction(id);
    if (result.ok) accept(result.rules, "Rule deleted.");
    else setMessage(result.error);
    setBusyId(null);
  }

  function updateDraft(id: string, field: keyof RuleDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], [field]: value },
    }));
  }

  return (
    <section aria-labelledby="rules-admin-heading" className="space-y-4">
      <div>
        <h2
          id="rules-admin-heading"
          className="text-lg font-semibold text-slate-900"
        >
          Public rules
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Each saved rule appears as a card on the public Rules page.
        </p>
      </div>

      {!tournamentReady ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Generate the tournament setup before adding public rules.
        </p>
      ) : null}

      {message ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {message}
        </p>
      ) : null}

      {tournamentReady ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Add a rule</h3>
          <RuleFields
            draft={newRule}
            onChange={(field, value) =>
              setNewRule((current) => ({ ...current, [field]: value }))
            }
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busyId !== null}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyId === "new" ? "Adding…" : "Add rule"}
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {rules.map((rule, index) => {
          const draft = drafts[rule.id] ?? { title: rule.title, body: rule.body };
          const busy = busyId === rule.id;
          return (
            <article
              key={rule.id}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Rule {index + 1}
              </p>
              <RuleFields
                draft={draft}
                onChange={(field, value) => updateDraft(rule.id, field, value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSave(rule.id)}
                  disabled={busyId !== null}
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  disabled={busyId !== null}
                  className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RuleFields({
  draft,
  onChange,
}: {
  draft: RuleDraft;
  onChange: (field: keyof RuleDraft, value: string) => void;
}) {
  return (
    <div className="mt-3 space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Title</span>
        <input
          value={draft.title}
          maxLength={120}
          onChange={(event) => onChange("title", event.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Description</span>
        <textarea
          value={draft.body}
          maxLength={2000}
          rows={4}
          onChange={(event) => onChange("body", event.target.value)}
          className="mt-1 block w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </label>
    </div>
  );
}
