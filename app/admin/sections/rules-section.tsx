"use client";

import type { TiebreakerKey } from "@/lib/tournament/types";

const TIEBREAKER_LABELS: Record<TiebreakerKey, string> = {
  goal_difference: "Goal difference",
  goals_for: "Goals for",
  head_to_head: "Head-to-head",
  manual: "Manual (admin decides)",
};

const ALL_TIEBREAKER_OPTIONS: TiebreakerKey[] = [
  "goal_difference",
  "goals_for",
  "head_to_head",
  "manual",
];

interface RulesSectionProps {
  winPointsRaw: string;
  drawPointsRaw: string;
  lossPointsRaw: string;
  tiebreakerOrder: TiebreakerKey[];
  rulesStatus: "saved" | "saving" | "unsaved";
  error: string | null;
  onWinChange: (value: string) => void;
  onDrawChange: (value: string) => void;
  onLossChange: (value: string) => void;
  onMoveTiebreaker: (index: number, direction: -1 | 1) => void;
  onToggleTiebreaker: (key: TiebreakerKey) => void;
  onSaveRules: () => void;
}

/**
 * Edits the tournament-owned scoring rules and tiebreaker order. These are
 * editable even after fixtures are locked (changing rules never invalidates the
 * fixture pairings). Points are always the primary sort. If `manual` is not
 * configured, draw order remains the deterministic fallback.
 */
export function RulesSection({
  winPointsRaw,
  drawPointsRaw,
  lossPointsRaw,
  tiebreakerOrder,
  rulesStatus,
  error,
  onWinChange,
  onDrawChange,
  onLossChange,
  onMoveTiebreaker,
  onToggleTiebreaker,
  onSaveRules,
}: RulesSectionProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Points are always the primary sort. Manual is the final decision for an
        exact tie: settle it outside the app, then record who ranks first here.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Win points</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={winPointsRaw}
            onChange={(e) => onWinChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Draw points</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={drawPointsRaw}
            onChange={(e) => onDrawChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Loss points</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={lossPointsRaw}
            onChange={(e) => onLossChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-slate-700">
          Tiebreaker order (after points)
        </span>
        <ul className="space-y-1">
          {tiebreakerOrder.map((key, index) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </span>
              <span className="flex-1 text-sm text-slate-900">
                {TIEBREAKER_LABELS[key]}
              </span>
              <button
                type="button"
                onClick={() => onMoveTiebreaker(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${TIEBREAKER_LABELS[key]} up`}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMoveTiebreaker(index, 1)}
                disabled={index === tiebreakerOrder.length - 1}
                aria-label={`Move ${TIEBREAKER_LABELS[key]} down`}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onToggleTiebreaker(key)}
                aria-label={`Remove ${TIEBREAKER_LABELS[key]}`}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {/* Offer any tiebreaker not currently included so it can be added back. */}
        <div className="flex flex-wrap gap-2">
          {ALL_TIEBREAKER_OPTIONS.filter(
            (key) => !tiebreakerOrder.includes(key),
          ).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onToggleTiebreaker(key)}
              className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + Add {TIEBREAKER_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSaveRules}
          disabled={rulesStatus === "saving"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rulesStatus === "saving" ? "Saving…" : "Save scoring"}
        </button>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
