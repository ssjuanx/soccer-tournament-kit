"use client";

import { useMemo, useState } from "react";

import {
  buildSetup,
  getGroupLabel,
  validateSetupInput,
  type SetupPlan,
} from "@/lib/tournament/draw";

type Entry = { name: string; team: string };

/**
 * Admin tournament setup: configure participant + group counts, preview the
 * balanced group distribution, and manually enter each drawn participant's
 * name and team.
 *
 * State lives only in React (no persistence). The physical draw happens
 * outside the app; the administrator records it here, slot by slot.
 */
export default function AdminSetup() {
  const [participantCountRaw, setParticipantCountRaw] = useState("");
  const [groupCountRaw, setGroupCountRaw] = useState("");
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<{
    participantCount: number;
    groupCount: number;
  } | null>(null);

  const setupChanged = useMemo(() => {
    if (!plan || !lastGenerated) return false;
    const p = Number(participantCountRaw);
    const g = Number(groupCountRaw);
    return (
      p !== lastGenerated.participantCount || g !== lastGenerated.groupCount
    );
  }, [plan, lastGenerated, participantCountRaw, groupCountRaw]);

  const hasEnteredData = useMemo(
    () =>
      Object.values(entries).some(
        (entry) => entry.name.trim() !== "" || entry.team.trim() !== "",
      ),
    [entries],
  );

  function handleGenerate() {
    const result = validateSetupInput(participantCountRaw, groupCountRaw);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    // Guard against silently destroying entered data when the setup changed.
    if (
      setupChanged &&
      hasEnteredData &&
      !window.confirm(
        "Regenerating with new sizes will replace the current groups and discard names for any removed slots. Continue?",
      )
    ) {
      return;
    }

    const nextPlan = buildSetup(result.participantCount, result.groupCount);
    setPlan(nextPlan);
    setLastGenerated({
      participantCount: result.participantCount,
      groupCount: result.groupCount,
    });

    // Preserve existing entries keyed by draw order where the slot still
    // exists; initialize the rest as empty.
    setEntries((prev) => {
      const next: Record<number, Entry> = {};
      for (const slot of nextPlan.slots) {
        const existing = prev[slot.drawOrder];
        next[slot.drawOrder] = {
          name: existing?.name ?? "",
          team: existing?.team ?? "",
        };
      }
      return next;
    });

    setError(null);
  }

  function updateEntry(
    drawOrder: number,
    field: keyof Entry,
    value: string,
  ) {
    setEntries((prev) => ({
      ...prev,
      [drawOrder]: {
        name: prev[drawOrder]?.name ?? "",
        team: prev[drawOrder]?.team ?? "",
        [field]: value,
      },
    }));
  }

  return (
    <div className="space-y-8">
      <SetupForm
        participantCountRaw={participantCountRaw}
        groupCountRaw={groupCountRaw}
        onParticipantChange={setParticipantCountRaw}
        onGroupChange={setGroupCountRaw}
        onSubmit={handleGenerate}
        error={error}
        plan={plan}
        setupChanged={setupChanged}
        hasEnteredData={hasEnteredData}
      />

      {plan && <GroupPreview plan={plan} />}

      {plan && (
        <DrawEntry plan={plan} entries={entries} onUpdate={updateEntry} />
      )}
    </div>
  );
}

interface SetupFormProps {
  participantCountRaw: string;
  groupCountRaw: string;
  onParticipantChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
  plan: SetupPlan | null;
  setupChanged: boolean;
  hasEnteredData: boolean;
}

function SetupForm({
  participantCountRaw,
  groupCountRaw,
  onParticipantChange,
  onGroupChange,
  onSubmit,
  error,
  plan,
  setupChanged,
  hasEnteredData,
}: SetupFormProps) {
  return (
    <section
      aria-labelledby="setup-heading"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2 id="setup-heading" className="text-lg font-semibold text-slate-900">
        Tournament setup
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Choose the number of participants and groups. Groups are balanced
        automatically, with larger groups placed first.
      </p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="participant-count"
              className="block text-sm font-medium text-slate-700"
            >
              Participants
            </label>
            <input
              id="participant-count"
              type="number"
              min={1}
              inputMode="numeric"
              value={participantCountRaw}
              onChange={(e) => onParticipantChange(e.target.value)}
              placeholder="e.g. 16"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label
              htmlFor="group-count"
              className="block text-sm font-medium text-slate-700"
            >
              Groups
            </label>
            <input
              id="group-count"
              type="number"
              min={1}
              inputMode="numeric"
              value={groupCountRaw}
              onChange={(e) => onGroupChange(e.target.value)}
              placeholder="e.g. 4"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {plan && setupChanged && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Setup values changed since groups were generated. Click
            &ldquo;Regenerate groups&rdquo; to apply the new sizes
            {hasEnteredData
              ? " — names for any removed slots will be discarded."
              : "."}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
          >
            {plan ? "Regenerate groups" : "Generate groups"}
          </button>
          {plan && (
            <span className="text-sm text-slate-500">
              {plan.participantCount} participants · {plan.groupCount} groups
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function GroupPreview({ plan }: { plan: SetupPlan }) {
  return (
    <section
      aria-labelledby="groups-heading"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2 id="groups-heading" className="text-lg font-semibold text-slate-900">
        Groups
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {plan.groupSizes.map((size, index) => (
          <li
            key={index}
            className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
          >
            <span className="font-medium text-slate-900">
              Group {getGroupLabel(index)}
            </span>
            <span className="text-sm text-slate-600">
              {size} {size === 1 ? "player" : "players"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface DrawEntryProps {
  plan: SetupPlan;
  entries: Record<number, Entry>;
  onUpdate: (drawOrder: number, field: keyof Entry, value: string) => void;
}

function DrawEntry({ plan, entries, onUpdate }: DrawEntryProps) {
  return (
    <section aria-labelledby="draw-heading" className="space-y-3">
      <h2 id="draw-heading" className="text-lg font-semibold text-slate-900">
        Participants
      </h2>
      <p className="text-sm text-slate-600">
        Enter each drawn participant in draw order. Group assignment is shown
        automatically and cannot be edited here.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plan.slots.map((slot) => {
          const entry = entries[slot.drawOrder] ?? { name: "", team: "" };
          return (
            <li
              key={slot.drawOrder}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">
                  Draw {slot.drawOrder}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  Group {slot.groupLabel}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                <div>
                  <label
                    htmlFor={`name-${slot.drawOrder}`}
                    className="block text-xs font-medium text-slate-600"
                  >
                    Name
                  </label>
                  <input
                    id={`name-${slot.drawOrder}`}
                    type="text"
                    value={entry.name}
                    onChange={(e) =>
                      onUpdate(slot.drawOrder, "name", e.target.value)
                    }
                    placeholder="Participant name"
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`team-${slot.drawOrder}`}
                    className="block text-xs font-medium text-slate-600"
                  >
                    Team
                  </label>
                  <input
                    id={`team-${slot.drawOrder}`}
                    type="text"
                    value={entry.team}
                    onChange={(e) =>
                      onUpdate(slot.drawOrder, "team", e.target.value)
                    }
                    placeholder="Team name"
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}