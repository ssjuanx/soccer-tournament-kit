"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createTournamentRuleAction,
  deleteTournamentRuleAction,
  updateTournamentRulesBulkAction,
} from "@/lib/db/actions";
import type { TournamentRule } from "@/lib/db/rules";
import { SaveStatusBadge } from "@/components/save-status-badge";

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
  onDirtyChange,
}: {
  initialRules: TournamentRule[];
  /** Reports whether any rule draft differs from its saved value. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState(() => draftsFrom(initialRules));
  const [newRule, setNewRule] = useState<RuleDraft>({ title: "", body: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingChanges, setSavingChanges] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A draft is "dirty" when its title or body differs from the saved rule.
  const hasDraftChanges = useMemo(() => {
    for (const rule of rules) {
      const draft = drafts[rule.id];
      if (!draft) continue;
      if (draft.title !== rule.title || draft.body !== rule.body) return true;
    }
    return false;
  }, [rules, drafts]);

  useEffect(() => {
    onDirtyChange?.(hasDraftChanges);
  }, [hasDraftChanges, onDirtyChange]);

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

  async function handleSaveChanges() {
    const changes: { id: string; title: string; body: string }[] = [];
    for (const rule of rules) {
      const draft = drafts[rule.id];
      if (!draft) continue;
      if (draft.title !== rule.title || draft.body !== rule.body) {
        changes.push({ id: rule.id, title: draft.title, body: draft.body });
      }
    }
    if (changes.length === 0) return;
    setSavingChanges(true);
    setMessage(null);
    const result = await updateTournamentRulesBulkAction(changes);
    if (result.ok) {
      accept(
        result.rules,
        `${changes.length} rule${changes.length === 1 ? "" : "s"} saved.`,
      );
    } else {
      setMessage(result.error);
    }
    setSavingChanges(false);
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
          Each saved rule appears as a card on the public Rules page. Add or
          delete a rule immediately; edit the text and save all changes at once.
        </p>
      </div>

      {message ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {message}
        </p>
      ) : null}

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
          disabled={busyId !== null || savingChanges}
          className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyId === "new" ? "Adding…" : "Add rule"}
        </button>
      </div>

      {rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={savingChanges || busyId !== null || !hasDraftChanges}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingChanges ? "Saving…" : "Save changes"}
          </button>
          <SaveStatusBadge
            status={
              hasDraftChanges ? (savingChanges ? "saving" : "unsaved") : "saved"
            }
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {rules.map((rule, index) => {
          const draft = drafts[rule.id] ?? { title: rule.title, body: rule.body };
          const busy = busyId === rule.id;
          const dirty =
            draft.title !== rule.title || draft.body !== rule.body;
          return (
            <article
              key={rule.id}
              className={`rounded-lg border bg-white p-4 ${dirty ? "border-amber-300" : "border-slate-200"}`}
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
                  onClick={() => handleDelete(rule.id)}
                  disabled={busyId !== null || savingChanges}
                  className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Deleting…" : "Delete"}
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
