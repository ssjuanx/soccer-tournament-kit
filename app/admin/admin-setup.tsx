"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildSetup,
  getGroupLabel,
  validateSetupInput,
  type SetupPlan,
} from "@/lib/tournament/draw";
import { calculateStandings } from "@/lib/tournament/standings";
import { cohortKeyOf } from "@/lib/tournament/tiebreakers";
import type {
  ManualTiebreakResolution,
  Match,
  Participant,
  ParticipantId,
  TiebreakerKey,
} from "@/lib/tournament/types";
import {
  compareGroupLabels,
  entriesHaveData,
  mapSetupToEntries,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_TIEBREAKER_ORDER,
  type Entry,
  type SavedParticipant,
  type TournamentSetupSnapshot,
} from "@/lib/db/setup";
import { isStructurallyLocked, parseScore } from "@/lib/db/fixtures";
import {
  clearFixturesAction,
  generateFixturesAction,
  generateSetupAction,
  saveManualTiebreakResolutionAction,
  saveMatchScoreAction,
  saveParticipantsAction,
  saveTournamentMetadataAction,
  saveTournamentRulesAction,
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

  // Tournament rules (scoring values + tiebreaker order). Rehydrated from the
  // persisted tournament; editable even while fixtures are locked because
  // changing rules never invalidates fixture pairings.
  const [winPointsRaw, setWinPointsRaw] = useState(() =>
    initialSetup.tournament
      ? String(initialSetup.tournament.winPoints)
      : String(DEFAULT_SCORING_CONFIG.winPoints),
  );
  const [drawPointsRaw, setDrawPointsRaw] = useState(() =>
    initialSetup.tournament
      ? String(initialSetup.tournament.drawPoints)
      : String(DEFAULT_SCORING_CONFIG.drawPoints),
  );
  const [lossPointsRaw, setLossPointsRaw] = useState(() =>
    initialSetup.tournament
      ? String(initialSetup.tournament.lossPoints)
      : String(DEFAULT_SCORING_CONFIG.lossPoints),
  );
  const [tiebreakerOrder, setTiebreakerOrder] = useState<TiebreakerKey[]>(() =>
    initialSetup.tournament
      ? initialSetup.tournament.tiebreakerOrder
      : [...DEFAULT_TIEBREAKER_ORDER],
  );
  const [rulesStatus, setRulesStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved",
  );

  // Tournament identity metadata (name, edition, date, description). Rehydrated
  // from the persisted tournament; editable at any time, even while fixtures are
  // locked, because changing metadata never invalidates fixture pairings.
  const [nameRaw, setNameRaw] = useState(() =>
    initialSetup.tournament ? initialSetup.tournament.name : "",
  );
  const [editionRaw, setEditionRaw] = useState(() =>
    initialSetup.tournament ? initialSetup.tournament.edition ?? "" : "",
  );
  const [dateRaw, setDateRaw] = useState(() =>
    initialSetup.tournament ? initialSetup.tournament.date ?? "" : "",
  );
  const [descriptionRaw, setDescriptionRaw] = useState(() =>
    initialSetup.tournament ? initialSetup.tournament.description ?? "" : "",
  );
  const [metadataStatus, setMetadataStatus] = useState<
    "saved" | "saving" | "unsaved"
  >("saved");

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

  // Participants grouped by groupId (draw order preserved), for the manual
  // tiebreak resolution panel. Stable while locked.
  const participantsByGroup = useMemo(() => {
    const map = new Map<string, SavedParticipant[]>();
    for (const p of initialSetup.participants) {
      if (!p.groupId) continue;
      const list = map.get(p.groupId);
      if (list) {
        list.push(p);
      } else {
        map.set(p.groupId, [p]);
      }
    }
    return map;
  }, [initialSetup.participants]);

  // Cohort-scoped manual tiebreak orders. The admin reorders one tied cohort at
  // a time. `savedResolutions` mirrors what has been persisted and drives which
  // cohorts are still shown as needing a resolution; `manualOrders` holds live
  // (possibly unsaved) edits keyed by the cohort's deterministic key. A cohort
  // without a saved order defaults to draw order (the admin reorders from there).
  // Only relevant while `manual` is in the tiebreaker order.
  const [savedResolutions, setSavedResolutions] = useState<
    ManualTiebreakResolution[]
  >(() => initialSetup.manualResolutions.map((r) => ({ ...r })));
  const [manualOrders, setManualOrders] = useState<Record<string, ParticipantId[]>>(
    () => {
      const seed: Record<string, ParticipantId[]> = {};
      for (const resolution of initialSetup.manualResolutions) {
        seed[resolution.cohortKey] = [...resolution.participantOrder];
      }
      return seed;
    },
  );
  const [manualSaving, setManualSaving] = useState<Record<string, boolean>>({});
  const [manualStatus, setManualStatus] = useState<
    Record<string, "saved" | "saving" | "unsaved" | "error">
  >({});

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

  async function handleSaveRules() {
    setRulesStatus("saving");
    const result = await saveTournamentRulesAction(
      winPointsRaw,
      drawPointsRaw,
      lossPointsRaw,
      tiebreakerOrder,
    );
    if (result.ok) {
      setRulesStatus("saved");
      setError(null);
    } else {
      setRulesStatus("unsaved");
      setError(result.error);
    }
  }

  async function handleSaveMetadata() {
    setMetadataStatus("saving");
    const result = await saveTournamentMetadataAction(
      nameRaw,
      editionRaw,
      dateRaw,
      descriptionRaw,
    );
    if (result.ok) {
      setMetadataStatus("saved");
      setError(null);
    } else {
      setMetadataStatus("unsaved");
      setError(result.error);
    }
  }

  function moveTiebreaker(index: number, direction: -1 | 1) {
    setTiebreakerOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setRulesStatus("unsaved");
  }

  function toggleTiebreaker(key: TiebreakerKey) {
    setTiebreakerOrder((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        // The engine falls back to the default order when nothing valid
        // remains, but keep at least the default here so the UI shows intent.
        return next.length === 0 ? [...DEFAULT_TIEBREAKER_ORDER] : next;
      }
      return [...prev, key];
    });
    setRulesStatus("unsaved");
  }

  // Tied cohorts that currently reach the `manual` tiebreaker without a stored
  // resolution, per group. Derived from the saved scores (`matches`) and the
  // saved resolutions so the panel lists exactly the cohorts still needing
  // input — a cohort with a covering saved order is resolved and hidden.
  // Recomputed as scores are entered and as resolutions are saved.
  const cohortsByGroup = useMemo(() => {
    const result = new Map<
      string,
      { cohortKey: string; participantIds: ParticipantId[] }[]
    >();
    if (!tiebreakerOrder.includes("manual")) return result;
    const scoring = initialSetup.tournament
      ? {
          winPoints: initialSetup.tournament.winPoints,
          drawPoints: initialSetup.tournament.drawPoints,
          lossPoints: initialSetup.tournament.lossPoints,
        }
      : DEFAULT_SCORING_CONFIG;
    for (const group of initialSetup.groups) {
      const groupParticipants = participantsByGroup.get(group.id) ?? [];
      if (groupParticipants.length === 0) continue;
      const groupMatches = matches.filter((m) => m.groupId === group.id);
      const standings = calculateStandings(
        groupMatches,
        groupParticipants.map(
          (p): Participant => ({
            id: p.id,
            name: p.name,
            drawOrder: p.drawOrder,
            assignedTeamId: null,
            groupId: p.groupId,
          }),
        ),
        {
          scoring,
          tiebreakerOrder,
          groupId: group.id,
          manualResolutions: savedResolutions,
        },
      );
      // Group unresolved rows by shared position -> one cohort each.
      const byPosition = new Map<number, ParticipantId[]>();
      for (const row of standings) {
        if (!row.unresolved) continue;
        const list = byPosition.get(row.position);
        if (list) list.push(row.participantId);
        else byPosition.set(row.position, [row.participantId]);
      }
      const cohorts: { cohortKey: string; participantIds: ParticipantId[] }[] =
        [];
      for (const ids of byPosition.values()) {
        if (ids.length <= 1) continue;
        // Stable display order: draw order ascending.
        const ordered = [...ids].sort(
          (a, b) =>
            (participantById.get(a)?.drawOrder ?? Infinity) -
            (participantById.get(b)?.drawOrder ?? Infinity),
        );
        cohorts.push({ cohortKey: cohortKeyOf(ids), participantIds: ordered });
      }
      result.set(group.id, cohorts);
    }
    return result;
  }, [
    matches,
    savedResolutions,
    tiebreakerOrder,
    initialSetup.groups,
    initialSetup.tournament,
    participantsByGroup,
    participantById,
  ]);

  // --- Manual tiebreak resolution handlers ---

  /** Returns the editable order for a cohort (live/saved order or draw order). */
  function manualOrderFor(
    cohortKey: string,
    participantIds: ParticipantId[],
  ): ParticipantId[] {
    const existing = manualOrders[cohortKey];
    if (existing && existing.length > 0) return existing;
    return [...participantIds];
  }

  function moveManualParticipant(
    cohortKey: string,
    participantIds: ParticipantId[],
    index: number,
    direction: -1 | 1,
  ) {
    const order = [...manualOrderFor(cohortKey, participantIds)];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setManualOrders((prev) => ({ ...prev, [cohortKey]: order }));
    setManualStatus((prev) => ({ ...prev, [cohortKey]: "unsaved" }));
  }

  async function handleSaveManualResolution(
    groupId: string,
    cohort: { cohortKey: string; participantIds: ParticipantId[] },
  ) {
    const order = manualOrderFor(cohort.cohortKey, cohort.participantIds);
    setManualSaving((prev) => ({ ...prev, [cohort.cohortKey]: true }));
    setManualStatus((prev) => ({ ...prev, [cohort.cohortKey]: "saving" }));
    const result = await saveManualTiebreakResolutionAction(
      groupId,
      cohort.cohortKey,
      order,
    );
    setManualSaving((prev) => ({ ...prev, [cohort.cohortKey]: false }));
    if (result.ok) {
      setManualStatus((prev) => ({ ...prev, [cohort.cohortKey]: "saved" }));
      // Mirror the saved resolution locally so the cohort is treated as
      // resolved on recompute (it drops out of the "needs resolution" list).
      setSavedResolutions((prev) => {
        const filtered = prev.filter((r) => r.cohortKey !== cohort.cohortKey);
        return [
          ...filtered,
          { groupId, cohortKey: cohort.cohortKey, participantOrder: order },
        ];
      });
      setError(null);
    } else {
      setManualStatus((prev) => ({ ...prev, [cohort.cohortKey]: "error" }));
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
        <MetadataSection
          nameRaw={nameRaw}
          editionRaw={editionRaw}
          dateRaw={dateRaw}
          descriptionRaw={descriptionRaw}
          metadataStatus={metadataStatus}
          onNameChange={(v) => {
            setNameRaw(v);
            setMetadataStatus("unsaved");
          }}
          onEditionChange={(v) => {
            setEditionRaw(v);
            setMetadataStatus("unsaved");
          }}
          onDateChange={(v) => {
            setDateRaw(v);
            setMetadataStatus("unsaved");
          }}
          onDescriptionChange={(v) => {
            setDescriptionRaw(v);
            setMetadataStatus("unsaved");
          }}
          onSaveMetadata={handleSaveMetadata}
        />
      )}

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

      {plan && (
        <RulesSection
          winPointsRaw={winPointsRaw}
          drawPointsRaw={drawPointsRaw}
          lossPointsRaw={lossPointsRaw}
          tiebreakerOrder={tiebreakerOrder}
          rulesStatus={rulesStatus}
          onWinChange={(v) => {
            setWinPointsRaw(v);
            setRulesStatus("unsaved");
          }}
          onDrawChange={(v) => {
            setDrawPointsRaw(v);
            setRulesStatus("unsaved");
          }}
          onLossChange={(v) => {
            setLossPointsRaw(v);
            setRulesStatus("unsaved");
          }}
          onMoveTiebreaker={moveTiebreaker}
          onToggleTiebreaker={toggleTiebreaker}
          onSaveRules={handleSaveRules}
        />
      )}

      {plan && tiebreakerOrder.includes("manual") && (
        <ManualTiebreakSection
          groups={initialSetup.groups}
          cohortsByGroup={cohortsByGroup}
          participantById={participantById}
          groupLabelById={groupLabelById}
          manualOrderFor={manualOrderFor}
          savingByGroup={manualSaving}
          statusByGroup={manualStatus}
          onMove={moveManualParticipant}
          onSave={handleSaveManualResolution}
        />
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
interface MetadataSectionProps {
  nameRaw: string;
  editionRaw: string;
  dateRaw: string;
  descriptionRaw: string;
  metadataStatus: "saved" | "saving" | "unsaved";
  onNameChange: (value: string) => void;
  onEditionChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSaveMetadata: () => void;
}

/**
 * Editable tournament identity: name, edition, date, and description. Unlike
 * participant/group counts this metadata is never locked by fixtures, so the
 * save button stays enabled regardless of lock state. A blank name falls back
 * to the default tournament name when persisted.
 */
function MetadataSection({
  nameRaw,
  editionRaw,
  dateRaw,
  descriptionRaw,
  metadataStatus,
  onNameChange,
  onEditionChange,
  onDateChange,
  onDescriptionChange,
  onSaveMetadata,
}: MetadataSectionProps) {
  return (
    <section
      aria-labelledby="metadata-heading"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2
        id="metadata-heading"
        className="text-lg font-semibold text-slate-900"
      >
        Tournament details
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Name, edition, date, and description. A blank name uses the default
        tournament name. These can be edited at any time.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="tournament-name"
            className="block text-sm font-medium text-slate-700"
          >
            Name
          </label>
          <input
            id="tournament-name"
            type="text"
            value={nameRaw}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="FC Tournament"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-edition"
            className="block text-sm font-medium text-slate-700"
          >
            Edition
          </label>
          <input
            id="tournament-edition"
            type="text"
            value={editionRaw}
            onChange={(e) => onEditionChange(e.target.value)}
            placeholder="e.g. 2026 Edition"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-date"
            className="block text-sm font-medium text-slate-700"
          >
            Date
          </label>
          <input
            id="tournament-date"
            type="date"
            value={dateRaw}
            onChange={(e) => onDateChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label
            htmlFor="tournament-description"
            className="block text-sm font-medium text-slate-700"
          >
            Description
          </label>
          <input
            id="tournament-description"
            type="text"
            value={descriptionRaw}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Optional short description"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSaveMetadata}
          disabled={metadataStatus === "saving"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {metadataStatus === "saving" ? "Saving…" : "Save details"}
        </button>
        <SaveStatusBadge status={metadataStatus} />
      </div>
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
// Tournament rules: scoring values & tiebreaker order
// ---------------------------------------------------------------------------

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
 * fixture pairings). Points are always the primary sort and draw order is
 * always the final fallback, so only the relative order of the listed
 * tiebreakers is configurable.
 */
function RulesSection({
  winPointsRaw,
  drawPointsRaw,
  lossPointsRaw,
  tiebreakerOrder,
  rulesStatus,
  onWinChange,
  onDrawChange,
  onLossChange,
  onMoveTiebreaker,
  onToggleTiebreaker,
  onSaveRules,
}: RulesSectionProps) {
  return (
    <section aria-labelledby="rules-heading" className="space-y-4">
      <h2 id="rules-heading" className="text-lg font-semibold text-slate-900">
        Scoring &amp; tiebreakers
      </h2>
      <p className="text-sm text-slate-600">
        Points are always the primary sort and original draw order is always the
        final tiebreaker. Configure the points awarded per result and the order
        of the tiebreakers applied in between.
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
          Tiebreaker order (after points, before draw order)
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
          {rulesStatus === "saving" ? "Saving…" : "Save rules"}
        </button>
        <SaveStatusBadge status={rulesStatus} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Manual tiebreak resolution
// ---------------------------------------------------------------------------

interface ManualTiebreakSectionProps {
  groups: { id: string; label: string }[];
  cohortsByGroup: Map<
    string,
    { cohortKey: string; participantIds: ParticipantId[] }[]
  >;
  participantById: Map<string, SavedParticipant>;
  groupLabelById: Map<string, string>;
  manualOrderFor: (
    cohortKey: string,
    participantIds: ParticipantId[],
  ) => ParticipantId[];
  savingByGroup: Record<string, boolean>;
  statusByGroup: Record<string, "saved" | "saving" | "unsaved" | "error">;
  onMove: (
    cohortKey: string,
    participantIds: ParticipantId[],
    index: number,
    direction: -1 | 1,
  ) => void;
  onSave: (
    groupId: string,
    cohort: { cohortKey: string; participantIds: ParticipantId[] },
  ) => void;
}

/**
 * Manual tiebreak resolution panel. Shown only when the `manual` tiebreaker is
 * enabled. Each card is one tied cohort within a group that reached the manual
 * tiebreaker without a stored resolution; the administrator reorders that
 * cohort's members best-first and saves. The ordering resolves only that
 * cohort — other cohorts in the same group are unaffected. Until a cohort is
 * resolved, its members share a position as "tiebreak pending". Cohorts that
 * already have a covering saved resolution are not shown.
 */
function ManualTiebreakSection({
  groups,
  cohortsByGroup,
  participantById,
  groupLabelById,
  manualOrderFor,
  savingByGroup,
  statusByGroup,
  onMove,
  onSave,
}: ManualTiebreakSectionProps) {
  const visibleGroups = groups
    .filter((g) => (cohortsByGroup.get(g.id)?.length ?? 0) > 0)
    .sort((a, b) => compareGroupLabels(a.label, b.label));

  const totalCohorts = visibleGroups.reduce(
    (sum, g) => sum + (cohortsByGroup.get(g.id)?.length ?? 0),
    0,
  );

  return (
    <section aria-labelledby="manual-heading" className="space-y-4">
      <h2 id="manual-heading" className="text-lg font-semibold text-slate-900">
        Manual tiebreak resolutions
      </h2>
      <p className="text-sm text-slate-600">
        The <em>manual</em> tiebreaker is enabled. Each card below is one tied
        cohort that reached the manual tiebreaker without a stored resolution.
        Order that cohort&rsquo;s participants best-first and save; the ordering
        resolves only that cohort. Until then, its members share a position as{" "}
        <span className="font-medium">tiebreak pending</span>.
      </p>
      {totalCohorts === 0 ? (
        <p className="text-sm text-slate-500">
          No unresolved tied cohorts right now — every tie that reaches the
          manual tiebreaker has a saved resolution.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleGroups.flatMap((group) => {
            const cohorts = cohortsByGroup.get(group.id) ?? [];
            const label = groupLabelById.get(group.id) ?? group.label;
            return cohorts.map((cohort) => {
              const order = manualOrderFor(
                cohort.cohortKey,
                cohort.participantIds,
              );
              const saving = savingByGroup[cohort.cohortKey] === true;
              const status = statusByGroup[cohort.cohortKey];
              return (
                <div
                  key={`${group.id}:${cohort.cohortKey}`}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Group {label}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {cohort.participantIds.length} tied
                      </span>
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSave(group.id, cohort)}
                        disabled={saving}
                        className="rounded-md bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save order"}
                      </button>
                  {status === "saving" ? (
                    <span className="text-xs text-slate-500">Saving…</span>
                  ) : status === "unsaved" ? (
                    <span className="text-xs font-medium text-amber-600">Unsaved</span>
                  ) : status === "error" ? (
                    <span className="text-xs font-medium text-red-600">Error</span>
                  ) : status === "saved" ? (
                    <span className="text-xs font-medium text-green-600">Saved</span>
                  ) : null}
                </div>
              </div>
              <ol className="mt-2 space-y-1">
                {order.map((id, index) => {
                  const participant = participantById.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-sm text-slate-900">
                        {participant?.name ?? id}
                        {participant?.teamName ? (
                          <span className="text-slate-500">
                            {" "}
                            ({participant.teamName})
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onMove(
                            cohort.cohortKey,
                            cohort.participantIds,
                            index,
                            -1,
                          )
                        }
                        disabled={index === 0}
                        aria-label={`Move ${participant?.name ?? id} up`}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onMove(
                            cohort.cohortKey,
                            cohort.participantIds,
                            index,
                            1,
                          )
                        }
                        disabled={index === order.length - 1}
                        aria-label={`Move ${participant?.name ?? id} down`}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
            });
          })}
        </div>
      )}
    </section>
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