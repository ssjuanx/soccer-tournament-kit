"use client";

import { compareGroupLabels, type SavedParticipant } from "@/lib/db/setup";
import { orderGroupMatchesForPlay } from "@/lib/tournament/fixtures";
import type { Match } from "@/lib/tournament/types";
import { SaveStatusBadge } from "@/components/save-status-badge";
import { type ScoreInput } from "@/lib/ui/score-inputs";

interface FixturesSectionProps {
  matches: Match[];
  scoreInputs: Record<string, ScoreInput>;
  scoreStatus: "saved" | "saving" | "unsaved";
  canSave: boolean;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onSaveAllScores: () => void;
  participantById: Map<string, SavedParticipant>;
  groupLabelById: Map<string, string>;
}

export function FixturesSection({
  matches,
  scoreInputs,
  scoreStatus,
  canSave,
  onScoreChange,
  onSaveAllScores,
  participantById,
  groupLabelById,
}: FixturesSectionProps) {
  const orderedGroupIds = [...groupLabelById.keys()].sort((a, b) => {
    const la = groupLabelById.get(a) ?? a;
    const lb = groupLabelById.get(b) ?? b;
    return compareGroupLabels(la, lb);
  });
  const playOrder = orderGroupMatchesForPlay(matches, orderedGroupIds);

  return (
    <section aria-labelledby="fixtures-heading" className="space-y-4">
      <h2
        id="fixtures-heading"
        className="text-lg font-semibold text-slate-900"
      >
        Fixtures &amp; scores
      </h2>
      <p className="text-sm text-slate-600">
        Play from top to bottom; no times are assigned. Enter the final score
        for each match, or leave both blank to mark it as unplayed. Save once
        when you&apos;re done.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSaveAllScores}
          disabled={scoreStatus === "saving" || !canSave}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scoreStatus === "saving" ? "Saving…" : "Save all scores"}
        </button>
        <SaveStatusBadge status={scoreStatus} />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <ol className="divide-y divide-slate-100">
              {playOrder.map((match, index) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  matchNumber={index + 1}
                  groupLabel={groupLabelById.get(match.groupId ?? "") ?? "?"}
                  input={scoreInputs[match.id] ?? { home: "", away: "" }}
                  onScoreChange={onScoreChange}
                  participantById={participantById}
                />
              ))}
        </ol>
      </div>
    </section>
  );
}

interface MatchRowProps {
  match: Match;
  matchNumber: number;
  groupLabel: string;
  input: ScoreInput;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  participantById: Map<string, SavedParticipant>;
}

function MatchRow({
  match,
  matchNumber,
  groupLabel,
  input,
  onScoreChange,
  participantById,
}: MatchRowProps) {
  const home = match.homeParticipantId
    ? participantById.get(match.homeParticipantId)
    : undefined;
  const away = match.awayParticipantId
    ? participantById.get(match.awayParticipantId)
    : undefined;

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="w-24 shrink-0 text-xs font-semibold text-slate-500">
        #{matchNumber} · Group {groupLabel}
      </span>
      <span className="flex-1 text-right text-sm text-slate-900">
        {home ? home.name : "TBD"}
        {home?.teamName ? (
          <span className="text-slate-500"> ({home.teamName})</span>
        ) : null}
      </span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={`Home score for ${home?.name ?? "home"}`}
        value={input.home}
        onChange={(e) => onScoreChange(match.id, "home", e.target.value)}
        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      <span className="text-slate-400">–</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={`Away score for ${away?.name ?? "away"}`}
        value={input.away}
        onChange={(e) => onScoreChange(match.id, "away", e.target.value)}
        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      <span className="flex-1 text-sm text-slate-900">
        {away ? away.name : "TBD"}
        {away?.teamName ? (
          <span className="text-slate-500"> ({away.teamName})</span>
        ) : null}
      </span>
    </li>
  );
}
