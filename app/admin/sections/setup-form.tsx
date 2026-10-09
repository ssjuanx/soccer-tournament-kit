"use client";

import { getGroupLabel, type SetupPlan } from "@/lib/tournament/draw";

interface SetupFormProps {
  participantCountRaw: string;
  groupCountRaw: string;
  onParticipantChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  error: string | null;
  plan: SetupPlan | null;
  setupChanged: boolean;
  hasEnteredData: boolean;
  locked: boolean;
}

export function SetupForm({
  participantCountRaw,
  groupCountRaw,
  onParticipantChange,
  onGroupChange,
  onSubmit,
  error,
  plan,
  setupChanged,
  hasEnteredData,
  locked,
}: SetupFormProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Choose the number of participants and groups. Groups are balanced
        automatically, with larger groups placed first.
      </p>

      <form
        className="space-y-4"
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
              disabled={locked}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
              disabled={locked}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
            disabled={locked}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
    </div>
  );
}

export function GroupPreview({ plan }: { plan: SetupPlan }) {
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
