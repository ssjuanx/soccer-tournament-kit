"use client";

import { useEffect, useMemo, useState } from "react";

import { computeKnockoutView } from "@/lib/db/fixtures";
import {
  clearKnockoutFixturesAction,
  generateKnockoutFixturesAction,
  saveKnockoutScoreAction,
} from "@/lib/db/actions";
import type { SavedParticipant, TournamentSetupSnapshot } from "@/lib/db/setup";
import type { BracketMatch } from "@/lib/tournament/knockout";
import type {
  BracketKind,
  KnockoutRound,
  Match,
} from "@/lib/tournament/types";

const ROUND_LABELS: Record<KnockoutRound, string> = {
  round_of_64: "Round of 64",
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarter_final: "Quarter-finals",
  semi_final: "Semi-finals",
  final: "Final",
};

interface ScoreInput {
  home: string;
  away: string;
}

function initScoreInputs(matches: Match[]): Record<string, ScoreInput> {
  const inputs: Record<string, ScoreInput> = {};
  for (const m of matches) {
    inputs[m.id] =
      m.score != null
        ? { home: String(m.score.home), away: String(m.score.away) }
        : { home: "", away: "" };
  }
  return inputs;
}

interface KnockoutSectionProps {
  bracketKind: BracketKind;
  title: string;
  setup: TournamentSetupSnapshot;
  groupMatches: Match[];
  initialKnockoutMatches: Match[];
}

export function KnockoutSection({
  bracketKind,
  title,
  setup,
  groupMatches,
  initialKnockoutMatches,
}: KnockoutSectionProps) {
  const [knockoutMatches, setKnockoutMatches] = useState<Match[]>(
    initialKnockoutMatches,
  );
  const [scoreInputs, setScoreInputs] = useState<Record<string, ScoreInput>>(
    () => initScoreInputs(initialKnockoutMatches),
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});
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
        bracketKind,
      ),
    [setup, groupMatches, knockoutMatches, bracketKind],
  );

  const participantById = new Map<string, SavedParticipant>();
  for (const p of setup.participants) participantById.set(p.id, p);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const result = await generateKnockoutFixturesAction(bracketKind);
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
    const result = await clearKnockoutFixturesAction(bracketKind);
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
  }

  async function handleSaveScore(matchId: string) {
    const input = scoreInputs[matchId] ?? { home: "", away: "" };
    setSaving((prev) => ({ ...prev, [matchId]: true }));
    const result = await saveKnockoutScoreAction(
      bracketKind,
      matchId,
      input.home,
      input.away,
    );
    if (result.ok) {
      setKnockoutMatches(result.matches);
      setScoreInputs(initScoreInputs(result.matches));
      setError(null);
    } else {
      setError(result.error);
    }
    setSaving((prev) => ({ ...prev, [matchId]: false }));
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
        <button
          type="button"
          onClick={handleClear}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Clear bracket
        </button>
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
                    saving={saving[m.id] ?? false}
                    onScoreChange={updateScore}
                    onSaveScore={handleSaveScore}
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
  saving: boolean;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onSaveScore: (matchId: string) => void;
}

function KnockoutMatchRow({
  match,
  participantById,
  input,
  saving,
  onScoreChange,
  onSaveScore,
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
        <span className="min-w-[1.5rem] text-xs text-slate-400">
          {match.home.seed ?? ""}
        </span>
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
        <span className="min-w-[1.5rem] text-xs text-slate-400">
          {match.away.seed ?? ""}
        </span>
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
      {enterable ? (
        <button
          type="button"
          onClick={() => onSaveScore(match.id)}
          disabled={saving}
          className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save score"}
        </button>
      ) : null}
    </li>
  );
}
