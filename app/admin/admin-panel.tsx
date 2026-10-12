"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AdminSetup, { type AdminTab } from "./admin-setup";
import AdminRules from "./admin-rules";
import { createTournamentAction, deleteTournamentAction } from "@/lib/db/actions";
import { Tabs, type TabItem } from "@/components/tabs";
import type { Match } from "@/lib/tournament/types";
import type { TournamentRule } from "@/lib/db/rules";
import type { TournamentSetupSnapshot } from "@/lib/db/setup";

const TABS: TabItem<AdminTab>[] = [
  { id: "setup", label: "Setup" },
  { id: "group", label: "Group stage" },
  { id: "knockout", label: "Knockout" },
  { id: "rules", label: "Rules" },
];

/**
 * Admin panel shell: a single client component that owns the active tab and
 * renders the four panels. `AdminSetup` (setup/group/knockout) and `AdminRules`
 * both stay mounted across tab switches — only visibility changes — so their
 * in-memory state (draw entries, score inputs, rule drafts) is preserved. Each
 * panel reports its unsaved-changes state upward so the active tab can show a
 * pending-changes dot.
 *
 * Until a tournament exists (`hasTournament` is false) the tab bar is hidden and
 * a "Create tournament" form is shown instead. Creating the tournament inserts
 * the active row (with zeroed counts) and refreshes the route so this server
 * component re-reads the setup and the tabs are revealed.
 */
export default function AdminPanel({
  hasTournament,
  initialSetup,
  initialMatches,
  initialKnockoutMatches,
  initialRules,
}: {
  hasTournament: boolean;
  initialSetup: TournamentSetupSnapshot;
  initialMatches: Match[];
  /** Knockout matches keyed by bracket slug, for all advancement destinations. */
  initialKnockoutMatches: Record<string, Match[]>;
  initialRules: TournamentRule[];
}) {
  const [tab, setTab] = useState<AdminTab>("setup");
  const [dirty, setDirty] = useState<Record<AdminTab, boolean>>({
    setup: false,
    group: false,
    knockout: false,
    rules: false,
  });

  const handleSetupDirty = useCallback(
    (which: "setup" | "group" | "knockout", isDirty: boolean) => {
      setDirty((prev) =>
        prev[which] === isDirty ? prev : { ...prev, [which]: isDirty },
      );
    },
    [],
  );
  const handleRulesDirty = useCallback((isDirty: boolean) => {
    setDirty((prev) =>
      prev.rules === isDirty ? prev : { ...prev, rules: isDirty },
    );
  }, []);

  if (!hasTournament) {
    return <CreateTournamentForm />;
  }

  return (
    <div className="space-y-6">
      <Tabs
        items={TABS}
        active={tab}
        onChange={setTab}
        isDirty={(id) => dirty[id]}
      />

      <AdminSetup
        initialSetup={initialSetup}
        initialMatches={initialMatches}
        initialKnockoutMatches={initialKnockoutMatches}
        tab={tab}
        onDirtyChange={handleSetupDirty}
      />

      {/* Hidden (not unmounted) when inactive so rule drafts persist across tabs. */}
      <div className={tab === "rules" ? "" : "hidden"}>
        <AdminRules
          initialRules={initialRules}
          onDirtyChange={handleRulesDirty}
        />
      </div>

      <DangerZone />
    </div>
  );
type DeleteStatus = "idle" | "armed" | "deleting" | "error";

/**
 * Destructive-action zone shown at the bottom of the admin panel. "Delete
 * tournament" wipes the active tournament and all of its data (groups, teams,
 * participants, matches, manual tiebreak resolutions) via
 * `deleteTournamentAction`. The global rule cards are preserved.
 *
 * The button uses a two-step confirm to prevent accidental wipes: the first
 * click arms it (showing a "click again to confirm" prompt) and reverts after
 * five seconds if not confirmed. After a successful delete the action
 * revalidates `/` and `/admin`; `router.refresh()` re-runs the server
 * component, which then renders the "Create tournament" form.
 */
function DangerZone() {
  const router = useRouter();
  const [status, setStatus] = useState<DeleteStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  async function handleDelete() {
    // First click arms the button; the second click within the window confirms.
    if (status === "idle") {
      setStatus("armed");
      setError(null);
      armTimer.current = setTimeout(() => setStatus("idle"), 5000);
      return;
    }
    if (status === "armed") {
      if (armTimer.current) {
        clearTimeout(armTimer.current);
        armTimer.current = null;
      }
      setStatus("deleting");
      setError(null);
      const result = await deleteTournamentAction();
      if (result.ok) {
        router.refresh();
        return;
      }
      setStatus("error");
      setError(result.error);
    }
  }

  const label =
    status === "deleting"
      ? "Deleting…"
      : status === "armed"
        ? "Click again to confirm"
        : "Delete tournament";

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="rounded-lg border border-red-200 bg-red-50 p-5"
    >
      <h2
        id="danger-zone-heading"
        className="text-lg font-semibold text-red-900"
      >
        Danger zone
      </h2>
      <p className="mt-1 text-sm text-red-700">
        Deletes the active tournament and all of its data — groups, teams,
        participants, matches, and manual tiebreak resolutions. This cannot be
        undone. The public rule cards are preserved.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={status === "deleting"}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {label}
        </button>
        {status === "error" && error ? (
          <span className="text-sm text-red-700">{error}</span>
        ) : null}
      </div>
    </section>
  );
}

type CreateStatus = "idle" | "creating" | "error";

/**
 * First-step form shown when no active tournament exists. Collects the
 * tournament's identity metadata, calls `createTournamentAction` (which inserts
 * the active row with zeroed counts), then refreshes the route so the server
 * component re-reads the setup and the admin tabs are revealed.
 */
function CreateTournamentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [edition, setEdition] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<CreateStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    // Name is the only required field; edition/date/description are optional.
    if (name.trim() === "") {
      setStatus("error");
      setError("Name is required.");
      return;
    }
    setStatus("creating");
    setError(null);
    const result = await createTournamentAction(name, edition, date, description);
    if (result.ok) {
      // The action revalidates /admin; refresh to re-run the server component
      // and reveal the tabbed panel.
      router.refresh();
      return;
    }
    setStatus("error");
    setError(result.error);
  }

  return (
    <section
      aria-labelledby="create-tournament-heading"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2
        id="create-tournament-heading"
        className="text-lg font-semibold text-slate-900"
      >
        Create tournament
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Enter the tournament details to get started. Only the name is required —
        edition, date, and description are optional. You can edit these at any
        time after creation.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="tournament-name"
            className="block text-sm font-medium text-slate-700"
          >
            Name <span className="text-red-600">*</span>
          </label>
          <input
            id="tournament-name"
            type="text"
            required
            aria-required="true"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="FC Tournament"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-edition"
            className="block text-sm font-medium text-slate-700"
          >
            Edition{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="tournament-edition"
            type="text"
            value={edition}
            onChange={(e) => setEdition(e.target.value)}
            placeholder="e.g. 2026 Edition"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-date"
            className="block text-sm font-medium text-slate-700"
          >
            Date <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="tournament-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-description"
            className="block text-sm font-medium text-slate-700"
          >
            Description{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="tournament-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={status === "creating"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "creating" ? "Creating…" : "Create tournament"}
        </button>
        {status === "error" && error ? (
          <span className="text-sm text-red-600">{error}</span>
        ) : null}
      </div>
    </section>
  );
}
}