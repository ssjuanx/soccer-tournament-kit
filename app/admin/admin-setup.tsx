"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildSetup,
  getGroupLabel,
  validateSetupInput,
  type SetupPlan,
} from "@/lib/tournament/draw";
import type { Match } from "@/lib/tournament/types";
import {
  compareGroupLabels,
  entriesHaveData,
  mapSetupToEntries,
  type Entry,
  type SavedParticipant,
  type TournamentSetupSnapshot,
} from "@/lib/db/setup";
import { isStructurallyLocked, parseScore } from "@/lib/db/fixtures";
import {
  clearFixturesAction,
  generateFixturesAction,
  generateSetupAction,
  saveMatchScoreAction,
  saveParticipantsAction,
} from "@/lib/db/actions";

/**
 * Admin tournament setup: configure participant + group counts, preview the
 * balanced group distribution, and manually enter each drawn participant's
 * name and team.
 *
 * State is rehydrated from the persisted `initialSetup` snapshot (loaded
 * server-side) and saved back to Neon via Server Actions. The physical draw
 * happens outside the app; the administrator records it here, slot by slot.
 */
export default function AdminSetup({
  initialSetup,
  initialMatches,
}: {
  initialSetup: TournamentSetupSnapshot;
  initialMatches: Match[];
}) {
  const [participantCountRaw, setParticipantCountRaw] = useState(() =>
    initialSetup.tournament
      ? String(initialSetup.tournament.participantCount)
      : "",
  );
  const [groupCountRaw, setGroupCountRaw] = useState(() =>
    initialSetup.tournament
      ? String(initialSetup.tournament.groupCount)
      : "",
  );
  const [plan, setPlan] = useState<SetupPlan | null>(() =>
    initialSetup.tournament
      ? buildSetup(
          initialSetup.tournament.participantCount,
          initialSetup.tournament.groupCount,
        )
      : null,
  );
  const [entries, setEntries] = useState<Record<number, Entry>>(() =>
    mapSetupToEntries(initialSetup).entries,
  );
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<{
    participantCount: number;
    groupCount: number;
  } | null>(() =>
    initialSetup.tournament
      ? {
          participantCount: initialSetup.tournament.participantCount,
          groupCount: initialSetup.tournament.groupCount,
        }
      : null,
  );
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved",
  );
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  // Locked reflects the live match state so the UI toggles immediately after
  // generate/clear without needing a page reload.
  const locked = isStructurallyLocked(matches);
  const [scoreInputs, setScoreInputs] = useState<Record<string, ScoreInput>>(
    () => initScoreInputs(initialMatches),
  );
  const [scoreSaving, setScoreSaving] = useState<Record<string, boolean>>({});
  const [fixtureStatus, setFixtureStatus] = useState<"idle" | "generating">(
    "idle",
  );

  // Lookups for rendering fixture rows: participant id -> saved participant,
  // and group id -> label. These come from the initial server-loaded snapshot;
  // they are stable while locked (no participant/group edits are allowed).
  const participantById = useMemo(() => {
    const map = new Map<string, SavedParticipant>();
    for (const p of initialSetup.participants) {
      map.set(p.id, p);
    }
    return map;
  }, [initialSetup.participants]);
  const groupLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of initialSetup.groups) {
      map.set(g.id, g.label);
    }
    return map;
  }, [initialSetup.groups]);

  // Mark the form dirty after the first render (which rehydrates from the DB).
  // Any later change to the entries or plan means there are unsaved edits.
  const isFirstEffect = useRef(true);
  useEffect(() => {
    if (isFirstEffect.current) {
      isFirstEffect.current = false;
      return;
    }
    setSaveStatus(entriesHaveData(entries) ? "unsaved" : "saved");
  }, [entries, plan]);

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

  async function handleGenerate() {
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

    // Persist the setup (tournament config + groups). Participants are saved
    // separately via the Save button.
    const saved = await generateSetupAction(
      participantCountRaw,
      groupCountRaw,
    );
    if (!saved.ok) {
      setError(saved.error);
    }
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

  async function handleSave() {
    if (!plan) return;
    setSaveStatus("saving");
    const result = await saveParticipantsAction(entries);
    if (result.ok) {
      setSaveStatus("saved");
      setError(null);
    } else {
      setSaveStatus("unsaved");
      setError(result.error);
    }
  }

  async function handleGenerateFixtures() {
    setFixtureStatus("generating");
    const result = await generateFixturesAction();
    if (result.ok) {
      setMatches(result.matches);
      setScoreInputs(initScoreInputs(result.matches));
      setError(null);
    } else {
      setError(result.error);
    }
    setFixtureStatus("idle");
  }

  async function handleClearFixtures() {
    if (
      !window.confirm(
        "Clearing fixtures will delete all group-stage matches and any entered scores. Continue?",
      )
    ) {
      return;
    }
    const result = await clearFixturesAction();
    if (result.ok) {
      setMatches(result.matches);
      setScoreInputs({});
      setError(null);
    } else {
      setError(result.error);
    }
  }

  function updateScoreInput(
    matchId: string,
    side: "home" | "away",
    value: string,
  ) {
    setScoreInputs((prev) => {
      const current = prev[matchId] ?? { home: "", away: "" };
      return { ...prev, [matchId]: { ...current, [side]: value } };
    });
  }

  async function handleSaveScore(matchId: string) {
    const input = scoreInputs[matchId] ?? { home: "", away: "" };
    setScoreSaving((prev) => ({ ...prev, [matchId]: true }));
    const result = await saveMatchScoreAction(matchId, input.home, input.away);
    if (result.ok) {
      // Mirror the server-persisted score into local state. parseScore is pure
      // and already validated server-side, so it cannot throw here.
      const parsed = parseScore(input.home, input.away);
      setMatches((prev) =>
        prev.map((m) => (m.id === matchId ? { ...m, score: parsed } : m)),
      );
      setError(null);
    } else {
      setError(result.error);
    }
    setScoreSaving((prev) => ({ ...prev, [matchId]: false }));
  }

  return (
    <div className="space-y-8">
      {locked && (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-semibold">Fixtures generated — structure locked.</p>
          <p className="mt-1">
            Participant and group editing is disabled to protect the fixture
            pairings and any entered scores. Edit scores below, or clear
            fixtures to unlock.
          </p>
        </div>
      )}

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
        locked={locked}
      />

      {plan && <GroupPreview plan={plan} />}

      {plan && (
        <DrawEntry
          plan={plan}
          entries={entries}
          onUpdate={updateEntry}
          locked={locked}
        />
      )}

      {plan && (
        <section className="flex flex-wrap items-center gap-3">
          {!locked && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saveStatus === "saving"}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveStatus === "saving" ? "Saving…" : "Save participants"}
              </button>
              <SaveStatusBadge status={saveStatus} />
              <button
                type="button"
                onClick={handleGenerateFixtures}
                disabled={fixtureStatus === "generating"}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {fixtureStatus === "generating"
                  ? "Generating…"
                  : "Generate fixtures"}
              </button>
            </>
          )}
          {locked && (
            <button
              type="button"
              onClick={handleClearFixtures}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Clear fixtures
            </button>
          )}
        </section>
      )}

      {locked && (
        <FixturesSection
          matches={matches}
          scoreInputs={scoreInputs}
          scoreSaving={scoreSaving}
          onScoreChange={updateScoreInput}
          onSaveScore={handleSaveScore}
          participantById={participantById}
          groupLabelById={groupLabelById}
        />
      )}
    </div>
  );
}

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
  locked,
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
  locked: boolean;
}

function DrawEntry({ plan, entries, onUpdate, locked }: DrawEntryProps) {
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
                    disabled={locked}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
                    disabled={locked}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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

function SaveStatusBadge({
  status,
}: {
  status: "saved" | "saving" | "unsaved";
}) {
  if (status === "saving") {
    return <span className="text-sm text-slate-600">Saving…</span>;
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        ✓ Saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
      Unsaved changes
    </span>
  );
}

// ---------------------------------------------------------------------------
// Fixtures & score entry
// ---------------------------------------------------------------------------

/** A score input pair as edited in the UI (strings until saved). */
interface ScoreInput {
  home: string;
  away: string;
}

/**
 * Builds the initial score-input state from a match list. Each match's saved
 * score (if any) is rendered back into the inputs; unplayed matches start
 * blank.
 */
function initScoreInputs(matches: Match[]): Record<string, ScoreInput> {
  const inputs: Record<string, ScoreInput> = {};
  for (const match of matches) {
    inputs[match.id] = {
      home: match.score?.home.toString() ?? "",
      away: match.score?.away.toString() ?? "",
    };
  }
  return inputs;
}

interface FixturesSectionProps {
  matches: Match[];
  scoreInputs: Record<string, ScoreInput>;
  scoreSaving: Record<string, boolean>;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onSaveScore: (matchId: string) => void;
  participantById: Map<string, SavedParticipant>;
  groupLabelById: Map<string, string>;
}

function FixturesSection({
  matches,
  scoreInputs,
  scoreSaving,
  onScoreChange,
  onSaveScore,
  participantById,
  groupLabelById,
}: FixturesSectionProps) {
  // Group matches by their groupId, preserving group label order (A, B, ...).
  const matchesByGroup = new Map<string, Match[]>();
  for (const match of matches) {
    if (!match.groupId) continue;
    const list = matchesByGroup.get(match.groupId);
    if (list) {
      list.push(match);
    } else {
      matchesByGroup.set(match.groupId, [match]);
    }
  }
  const groups = [...matchesByGroup.entries()].sort(([a], [b]) => {
    const la = groupLabelById.get(a) ?? a;
    const lb = groupLabelById.get(b) ?? b;
    return compareGroupLabels(la, lb);
  });

  return (
    <section aria-labelledby="fixtures-heading" className="space-y-4">
      <h2
        id="fixtures-heading"
        className="text-lg font-semibold text-slate-900"
      >
        Fixtures &amp; scores
      </h2>
      <p className="text-sm text-slate-600">
        Enter the final score for each match. Leave both blank to mark a match
        as unplayed.
      </p>
      <div className="space-y-4">
        {groups.map(([groupId, groupMatches]) => (
          <div
            key={groupId}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">
              Group {groupLabelById.get(groupId) ?? "?"}
            </h3>
            <ul className="mt-2 divide-y divide-slate-100">
              {groupMatches.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  input={scoreInputs[match.id] ?? { home: "", away: "" }}
                  saving={scoreSaving[match.id] === true}
                  onScoreChange={onScoreChange}
                  onSaveScore={onSaveScore}
                  participantById={participantById}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

interface MatchRowProps {
  match: Match;
  input: ScoreInput;
  saving: boolean;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onSaveScore: (matchId: string) => void;
  participantById: Map<string, SavedParticipant>;
}

function MatchRow({
  match,
  input,
  saving,
  onScoreChange,
  onSaveScore,
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
      <button
        type="button"
        onClick={() => onSaveScore(match.id)}
        disabled={saving}
        className="rounded-md bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </li>
  );
}