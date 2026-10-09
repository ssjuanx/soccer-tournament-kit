"use client";

import { useEffect, useMemo, useState } from "react";

import { computeKnockoutView } from "@/lib/db/fixtures";
import {
  clearKnockoutFixturesAction,
  generateKnockoutFixturesAction,
  saveKnockoutScoresAction,
} from "@/lib/db/actions";
import type { SavedParticipant, TournamentSetupSnapshot } from "@/lib/db/setup";
import type { BracketMatch } from "@/lib/tournament/knockout";
import type { KnockoutRound, Match } from "@/lib/tournament/types";
import { SaveStatusBadge } from "@/components/save-status-badge";
import { initScoreInputs, type ScoreInput } from "@/lib/ui/score-inputs";

const ROUND_LABELS: Record<KnockoutRound, string> = {
  round_of_64: "Round of 64",
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarter_final: "Quarter-finals",
  semi_final: "Semi-finals",
  final: "Final",
};

interface KnockoutSectionProps {
  bracketSlug: string;
  title: string;
  setup: TournamentSetupSnapshot;
  groupMatches: Match[];
  initialKnockoutMatches: Match[];
  /** Reports whether this bracket has unsaved score edits, for the tab badge. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function KnockoutSection({
  bracketSlug,
  title,
  setup,
  groupMatches,
  initialKnockoutMatches,
  onDirtyChange,
}: KnockoutSectionProps) {
  const [knockoutMatches, setKnockoutMatches] = useState<Match[]>(
    initialKnockoutMatches,
  );
  const [scoreInputs, setScoreInputs] = useState<Record<string, ScoreInput>>(
    () => initScoreInputs(initialKnockoutMatches),
  );
  const [scoreStatus, setScoreStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved",
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clearing group fixtures also deletes both derived brackets in the
  // repository. Mirror that in local state so stale brackets cannot reappear
  // if new group fixtures are generated without a page refresh.
  useEffect(() => {
    if (groupMatches.length === 0) {
      setKnockoutMatches([]);
      setScoreInputs({});
    }
  }, [groupMatches.length]);

  const view = useMemo(
    () =>
      computeKnockoutView(
        setup,
        groupMatches,
        knockoutMatches,
        bracketSlug,
      ),
    [setup, groupMatches, knockoutMatches, bracketSlug],
  );

  const participantById = new Map<string, SavedParticipant>();
  for (const p of setup.participants) participantById.set(p.id, p);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const result = await generateKnockoutFixturesAction(bracketSlug);
    if (result.ok) {
      setKnockoutMatches(result.matches);
      setScoreInputs(initScoreInputs(result.matches));
    } else {
      setError(result.error);
    }
    setGenerating(false);
  }

  async function handleClear() {
    if (
      !window.confirm(
        `Clear the ${title} bracket and all its scores? The group stage is not affected.`,
      )
    ) {
      return;
    }
    const result = await clearKnockoutFixturesAction(bracketSlug);
    if (result.ok) {
      setKnockoutMatches([]);
      setScoreInputs({});
      setError(null);
    } else {
      setError(result.error);
    }
  }

  function updateScore(matchId: string, side: "home" | "away", value: string) {
    setScoreInputs((prev) => {
      const current = prev[matchId] ?? { home: "", away: "" };
      return { ...prev, [matchId]: { ...current, [side]: value } };
    });
    setScoreStatus("unsaved");
  }

  // Knockout scores whose inputs differ from what is persisted. Drives the
  // single "Save all scores" button and the unsaved-changes badge reported to
  // the panel. Only these are sent on a bulk save.
  const dirtyScoreEntries = useMemo(() => {
    const entries: { matchId: string; home: string; away: string }[] = [];
    for (const match of knockoutMatches) {
      const input = scoreInputs[match.id] ?? { home: "", away: "" };
      const savedHome = match.score?.home.toString() ?? "";
      const savedAway = match.score?.away.toString() ?? "";
      if (input.home !== savedHome || input.away !== savedAway) {
        entries.push({
          matchId: match.id,
          home: input.home,
          away: input.away,
        });
      }
    }
    return entries;
  }, [knockoutMatches, scoreInputs]);

  const hasDirtyScores = dirtyScoreEntries.length > 0;
  useEffect(() => {
    onDirtyChange?.(hasDirtyScores);
  }, [hasDirtyScores, onDirtyChange]);

  async function handleSaveAllScores() {
    if (dirtyScoreEntries.length === 0) return;
    setScoreStatus("saving");
    const result = await saveKnockoutScoresAction(
      bracketSlug,
      dirtyScoreEntries,
    );
    if (result.ok) {
      // Resync inputs from the server-persisted scores so the dirty diff clears
      // and the advanced rounds recompute from the latest winners.
      setKnockoutMatches(result.matches);
      setScoreInputs(initScoreInputs(result.matches));
      setScoreStatus("saved");
      setError(null);
    } else {
      setScoreStatus("unsaved");
      setError(result.error);
    }
  }

  if (view.status === "none" || view.status === "groupStageIncomplete") {
    return null;
  }

  if (view.status === "ready") {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {error != null ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <p className="text-sm text-slate-600">
          The group stage is complete. Generate the {title.toLowerCase()} bracket.
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? "Generating…" : `Generate ${title}`}
        </button>
      </section>
    );
  }

  const bracket = view.bracket as BracketMatch[];
  const rounds = new Map<number, BracketMatch[]>();
  for (const m of bracket) {
    const list = rounds.get(m.roundIndex);
    if (list) list.push(m);
    else rounds.set(m.roundIndex, [m]);
  }
  const roundIndices = [...rounds.keys()].sort((a, b) => a - b);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAllScores}
            disabled={scoreStatus === "saving" || !hasDirtyScores}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scoreStatus === "saving" ? "Saving…" : "Save all scores"}
          </button>
          <SaveStatusBadge status={scoreStatus} />
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Clear bracket
          </button>
        </div>
      </div>

      {error != null ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {view.champion != null ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-lg font-semibold text-amber-900">
            🏆 Champion: {participantById.get(view.champion)?.name ?? "TBD"}
            {participantById.get(view.champion)?.teamName ? (
              <span className="text-amber-700">
                {" "}
                ({participantById.get(view.champion)!.teamName})
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {roundIndices.map((roundIndex) => {
          const matches = rounds.get(roundIndex)!;
          const label = ROUND_LABELS[matches[0].knockoutRound];
          return (
            <div
              key={roundIndex}
              className="flex min-h-72 flex-col rounded-lg border border-slate-200 bg-white p-5"
            >
              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                {label}
              </h3>
              <ul className="flex flex-1 flex-col justify-evenly gap-4">
                {matches.map((m) => (
                  <KnockoutMatchRow
                    key={m.id}
                    match={m}
                    participantById={participantById}
                    input={scoreInputs[m.id] ?? { home: "", away: "" }}
                    onScoreChange={updateScore}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface KnockoutMatchRowProps {
  match: BracketMatch;
  participantById: Map<string, SavedParticipant>;
  input: ScoreInput;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
}

function KnockoutMatchRow({
  match,
  participantById,
  input,
  onScoreChange,
}: KnockoutMatchRowProps) {
  const isBye =
    match.roundIndex === 0 &&
    (match.home.participantId == null) !==
      (match.away.participantId == null);
  // Enterable when both sides are known (not a bye, not TBD).
  const enterable =
    match.home.participantId != null && match.away.participantId != null;
  const played = match.score != null;

  const sideLabel = (id: string | null) =>
    id ? participantById.get(id)?.name ?? "TBD" : isBye ? "Bye" : "TBD";

  return (
    <li className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 break-words text-sm leading-5 text-slate-700">
          {sideLabel(match.home.participantId)}
        </span>
        {enterable ? (
          <input
            type="number"
            inputMode="numeric"
            value={input.home}
            onChange={(e) => onScoreChange(match.id, "home", e.target.value)}
            className="w-12 rounded border border-slate-300 px-1 py-0.5 text-center text-sm"
          />
        ) : (
          <span className="w-12 text-center text-sm text-slate-500">
            {played ? match.score!.home : "–"}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 break-words text-sm leading-5 text-slate-700">
          {sideLabel(match.away.participantId)}
        </span>
        {enterable ? (
          <input
            type="number"
            inputMode="numeric"
            value={input.away}
            onChange={(e) => onScoreChange(match.id, "away", e.target.value)}
            className="w-12 rounded border border-slate-300 px-1 py-0.5 text-center text-sm"
          />
        ) : (
          <span className="w-12 text-center text-sm text-slate-500">
            {played ? match.score!.away : "–"}
          </span>
        )}
      </div>
    </li>
  );
}
