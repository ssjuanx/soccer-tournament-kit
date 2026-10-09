"use client";

import {
  type AdvancementDestination,
  type AdvancementMode,
  type CrossGroupStrategy,
} from "@/lib/db/setup";

interface AdvancementEditorProps {
  advancement: AdvancementDestination[];
  rulesStatus: "saved" | "saving" | "unsaved";
  error: string | null;
  /** Largest group size in the tournament; bounds each bracket's `toPosition`. */
  maxGroupSize: number;
  onChange: (advancement: AdvancementDestination[]) => void;
  onMarkDirty: () => void;
  onSave: () => void;
}

/**
 * Edits the multi-tournament advancement configuration: an ordered list of
 * knockout destinations, each defined by an explicit inclusive standing-position
 * range `[fromPosition, toPosition]` within each group. A standing position
 * outside every bracket's range is eliminated (shown in the summary below).
 *
 * Shares the same Save button / status badge shape as the scoring rules
 * section, but is persisted independently by `saveAdvancementAction` (each
 * section's Save writes only its own data and collapses only its own section).
 */
export function AdvancementEditor({
  advancement,
  rulesStatus,
  error,
  maxGroupSize,
  onChange,
  onMarkDirty,
  onSave,
}: AdvancementEditorProps) {
  function updateName(index: number, name: string) {
    onChange(
      advancement.map((d, i) => (i === index ? { ...d, name } : d)),
    );
    onMarkDirty();
  }

  function updatePosition(
    index: number,
    field: "fromPosition" | "toPosition",
    raw: string,
  ) {
    const trimmed = raw.trim();
    const n = trimmed === "" ? 1 : Number(trimmed);
    const clamped =
      Number.isInteger(n) && n >= 1 ? n : 1;
    onChange(
      advancement.map((d, i) =>
        i === index ? { ...d, [field]: clamped } : d,
      ),
    );
    onMarkDirty();
  }

  function updateMode(index: number, mode: AdvancementMode) {
    onChange(
      advancement.map((d, i) => {
        if (i !== index) return d;
        if (mode === "bestX") {
          return {
            ...d,
            mode: "bestX",
            position:
              Number.isInteger(d.position) && (d.position as number) >= 1
                ? d.position
                : 1,
            count:
              Number.isInteger(d.count) && (d.count as number) >= 1
                ? d.count
                : 1,
            strategy: d.strategy ?? "per-game",
          };
        }
        // Back to positions: drop bestX-only fields to keep state clean.
        return {
          name: d.name,
          fromPosition: d.fromPosition,
          toPosition: d.toPosition,
        };
      }),
    );
    onMarkDirty();
  }

  function updateCount(index: number, raw: string) {
    const trimmed = raw.trim();
    const n = trimmed === "" ? 1 : Number(trimmed);
    const clamped = Number.isInteger(n) && n >= 1 ? n : 1;
    onChange(
      advancement.map((d, i) =>
        i === index ? { ...d, count: clamped } : d,
      ),
    );
    onMarkDirty();
  }

  function updateStrategy(index: number, strategy: CrossGroupStrategy) {
    onChange(
      advancement.map((d, i) => (i === index ? { ...d, strategy } : d)),
    );
    onMarkDirty();
  }

  function updateCandidatePosition(index: number, raw: string) {
    const trimmed = raw.trim();
    const n = trimmed === "" ? 1 : Number(trimmed);
    const clamped = Number.isInteger(n) && n >= 1 ? n : 1;
    onChange(
      advancement.map((d, i) =>
        i === index ? { ...d, position: clamped } : d,
      ),
    );
    onMarkDirty();
  }

  function addDestination() {
    // Auto-initialize the new bracket at the next free standing position so a
    // second bracket doesn't incorrectly claim "Top 1" again. Falls back to 1
    // when the group size is unknown or every position is already covered.
    const taken = new Set<number>();
    for (const dest of advancement) {
      // bestX destinations don't claim a per-group position range.
      if (dest.mode === "bestX") continue;
      for (let pos = dest.fromPosition; pos <= dest.toPosition; pos++) {
        taken.add(pos);
      }
    }
    let nextPos = 1;
    if (maxGroupSize > 0) {
      let found = false;
      for (let pos = 1; pos <= maxGroupSize; pos++) {
        if (!taken.has(pos)) {
          nextPos = pos;
          found = true;
          break;
        }
      }
      if (!found) nextPos = maxGroupSize;
    }
    onChange([
      ...advancement,
      { name: "", fromPosition: nextPos, toPosition: nextPos },
    ]);
    onMarkDirty();
  }

  function removeDestination(index: number) {
    onChange(advancement.filter((_, i) => i !== index));
    onMarkDirty();
  }

  function moveDestination(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= advancement.length) return;
    const next = [...advancement];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    onMarkDirty();
  }

  // Positions in 1..maxGroupSize not covered by any bracket → eliminated.
  const covered = new Set<number>();
  for (const dest of advancement) {
    // bestX destinations don't claim a per-group position range.
    if (dest.mode === "bestX") continue;
    for (let pos = dest.fromPosition; pos <= dest.toPosition; pos++) {
      covered.add(pos);
    }
  }
  const eliminated: number[] = [];
  for (let pos = 1; pos <= maxGroupSize; pos++) {
    if (!covered.has(pos)) eliminated.push(pos);
  }
  const formatPos = (positions: number[]) => {
    if (positions.length === 0) return "";
    const sorted = [...positions].sort((a, b) => a - b);
    const parts: string[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = cur;
      prev = cur;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    return parts.join(", ");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Define the knockout brackets. Each bracket either takes a range of
        standing positions from every group, or picks the best finishers across
        groups (Best X). Any positions not claimed by a bracket are eliminated.
      </p>

      <ol className="space-y-2">
        {advancement.map((dest, index) => {
          const isLast = index === advancement.length - 1;
          return (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </span>
              <input
                type="text"
                value={dest.name}
                onChange={(e) => updateName(index, e.target.value)}
                placeholder="Bracket name"
                className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <select
                value={dest.mode ?? "positions"}
                onChange={(e) => updateMode(index, e.target.value as AdvancementMode)}
                aria-label="Qualification mode"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                <option value="positions">Positions</option>
                <option value="bestX">Best X</option>
              </select>
              {(dest.mode ?? "positions") === "bestX" ? (
                <label className="flex items-center gap-1 text-sm text-slate-700">
                  <span className="text-slate-500">Best</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={1}
                    value={String(dest.count ?? 1)}
                    onChange={(e) => updateCount(index, e.target.value)}
                    className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                  <span className="text-slate-500">of position</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={1}
                    max={maxGroupSize || undefined}
                    value={String(dest.position ?? 1)}
                    onChange={(e) => updateCandidatePosition(index, e.target.value)}
                    className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                  <span className="text-slate-500">across groups, ranked by</span>
                  <select
                    value={dest.strategy ?? "per-game"}
                    onChange={(e) =>
                      updateStrategy(index, e.target.value as CrossGroupStrategy)
                    }
                    aria-label="Ranking strategy"
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  >
                    <option value="per-game">points per game</option>
                    <option value="raw">raw totals</option>
                    <option value="gate">gate (manual)</option>
                    <option value="playoff">playoff</option>
                  </select>
                </label>
              ) : (
                <label className="flex items-center gap-1 text-sm text-slate-700">
                  {dest.fromPosition === 1 ? (
                  <>
                    <span className="text-slate-500">Top</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      max={maxGroupSize || undefined}
                      value={String(dest.toPosition)}
                      onChange={(e) =>
                        updatePosition(index, "toPosition", e.target.value)
                      }
                      className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                  </>
                ) : dest.fromPosition === dest.toPosition ? (
                  <>
                    <span className="text-slate-500">Position</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      max={maxGroupSize || undefined}
                      value={String(dest.fromPosition)}
                      onChange={(e) => {
                        const trimmed = e.target.value.trim();
                        const n = trimmed === "" ? 1 : Number(trimmed);
                        const clamped =
                          Number.isInteger(n) && n >= 1 ? n : 1;
                        onChange(
                          advancement.map((d, i) =>
                            i === index
                              ? {
                                  ...d,
                                  fromPosition: clamped,
                                  toPosition: clamped,
                                }
                              : d,
                          ),
                        );
                        onMarkDirty();
                      }}
                      className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                  </>
                ) : (
                  <>
                    <span className="text-slate-500">Positions</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      max={maxGroupSize || undefined}
                      value={String(dest.fromPosition)}
                      onChange={(e) =>
                        updatePosition(index, "fromPosition", e.target.value)
                      }
                      className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                    <span className="text-slate-500">–</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      max={maxGroupSize || undefined}
                      value={String(dest.toPosition)}
                      onChange={(e) =>
                        updatePosition(index, "toPosition", e.target.value)
                      }
                      className="w-14 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                  </>
                )}
                <span className="text-slate-500">per group qualify</span>
              </label>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveDestination(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveDestination(index, 1)}
                  disabled={isLast}
                  aria-label="Move down"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeDestination(index)}
                  aria-label="Remove"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {eliminated.length > 0 ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Everyone else (positions {formatPos(eliminated)} of each group) will
          be eliminated.
        </p>
      ) : maxGroupSize > 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          All positions qualify — no one is eliminated.
        </p>
      ) : null}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addDestination}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Add bracket
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={rulesStatus === "saving"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rulesStatus === "saving" ? "Saving…" : "Save advancement"}
        </button>
      </div>
    </div>
  );
}
