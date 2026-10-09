"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildSetup,
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
  entriesHaveData,
  mapSetupToEntries,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_TIEBREAKER_ORDER,
  DEFAULT_ADVANCEMENT,
  slugifyBracketName,
  type AdvancementDestination,
  type Entry,
  type SavedParticipant,
  type TournamentSetupSnapshot,
} from "@/lib/db/setup";
import { isStructurallyLocked } from "@/lib/db/fixtures";
import {
  clearFixturesAction,
  generateFixturesAction,
  generateSetupAction,
  saveGroupScoresAction,
  saveManualTiebreakResolutionAction,
  saveParticipantsAction,
  saveTournamentMetadataAction,
  saveTournamentRulesAction,
  saveAdvancementAction,
} from "@/lib/db/actions";
import { KnockoutSection } from "./knockout-section";
import { SaveStatusBadge } from "@/components/save-status-badge";
import { initScoreInputs, type ScoreInput } from "@/lib/ui/score-inputs";
import { CollapsibleSection } from "./sections/collapsible-section";
import { SetupForm, GroupPreview } from "./sections/setup-form";
import { MetadataSection } from "./sections/metadata-section";
import { DrawEntry } from "./sections/draw-entry";
import { RulesSection } from "./sections/rules-section";
import { ManualTiebreakSection } from "./sections/manual-tiebreak-section";
import { FixturesSection } from "./sections/fixtures-section";
import { AdvancementEditor } from "./sections/advancement-editor";

/** Tabs rendered by the admin panel. `AdminSetup` owns setup/group/knockout. */
export type AdminTab = "setup" | "group" | "knockout" | "rules";

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
  initialKnockoutMatches,
  tab,
  onDirtyChange,
}: {
  initialSetup: TournamentSetupSnapshot;
  initialMatches: Match[];
  /** Knockout matches keyed by bracket slug, for all advancement destinations. */
  initialKnockoutMatches: Record<string, Match[]>;
  /** Active tab. `AdminSetup` renders setup/group/knockout; "rules" renders nothing. */
  tab: AdminTab;
  /** Reports unsaved-changes state for the setup/group/knockout tabs to the panel. */
  onDirtyChange?: (
    tab: "setup" | "group" | "knockout",
    dirty: boolean,
  ) => void;
}) {
  // A freshly created tournament is stored with zeroed participant/group counts
  // (no groups generated yet). buildSetup() throws for non-positive counts, so
  // treat a tournament with no configured setup exactly like the no-tournament
  // case: blank count inputs and plan === null, which renders only the
  // "Generate groups" form. Once the admin generates a setup the counts become
  // positive and the full editor is revealed.
  const hasConfiguredSetup =
    initialSetup.tournament != null &&
    initialSetup.tournament.participantCount > 0 &&
    initialSetup.tournament.groupCount > 0;
  const [participantCountRaw, setParticipantCountRaw] = useState(() =>
    hasConfiguredSetup
      ? String(initialSetup.tournament!.participantCount)
      : "",
  );
  const [groupCountRaw, setGroupCountRaw] = useState(() =>
    hasConfiguredSetup
      ? String(initialSetup.tournament!.groupCount)
      : "",
  );
  const [plan, setPlan] = useState<SetupPlan | null>(() =>
    hasConfiguredSetup
      ? buildSetup(
          initialSetup.tournament!.participantCount,
          initialSetup.tournament!.groupCount,
        )
      : null,
  );
  const [entries, setEntries] = useState<Record<number, Entry>>(() =>
    mapSetupToEntries(initialSetup).entries,
  );
  const [error, setError] = useState<string | null>(null);
  // Per-section save errors, surfaced inline so a failed save in one section
  // never shows in another. `scoringError` belongs to "Scoring & tiebreakers"
  // and `advancementError` to "Knockout advancement"; `error` belongs to the
  // Tournament setup section.
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [advancementError, setAdvancementError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<{
    participantCount: number;
    groupCount: number;
  } | null>(() =>
    hasConfiguredSetup
      ? {
          participantCount: initialSetup.tournament!.participantCount,
          groupCount: initialSetup.tournament!.groupCount,
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
  const [fixtureStatus, setFixtureStatus] = useState<"idle" | "generating">(
    "idle",
  );
  // Group-stage score entry status for the single "Save all scores" button.
  const [scoreStatus, setScoreStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved",
  );
  // Knockout bracket dirty flags reported up by each KnockoutSection; OR'd to
  // drive the Knockout tab's unsaved-changes badge.
  const [knockoutDirty, setKnockoutDirty] = useState<Record<string, boolean>>(
    {},
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
  const [advancement, setAdvancement] = useState<AdvancementDestination[]>(
    () =>
      initialSetup.tournament
        ? initialSetup.tournament.advancement.map((d) => ({ ...d }))
        : DEFAULT_ADVANCEMENT.map((d) => ({ ...d })),
  );
  const [tiebreakerOrder, setTiebreakerOrder] = useState<TiebreakerKey[]>(() =>
    initialSetup.tournament
      ? initialSetup.tournament.tiebreakerOrder
      : [...DEFAULT_TIEBREAKER_ORDER],
  );
  const [scoringStatus, setScoringStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved",
  );
  const [advancementStatus, setAdvancementStatus] = useState<
    "saved" | "saving" | "unsaved"
  >("saved");
  // Collapsible admin sections: each starts expanded and auto-collapses when its
  // own save completes successfully (see handleSaveScoring /
  // handleSaveAdvancement / handleGenerate). Clicking a section header toggles
  // it back open.
  const [rulesOpen, setRulesOpen] = useState(true);
  const [advancementOpen, setAdvancementOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);

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
    } else {
      // Auto-collapse the setup section after a successful (re)generation.
      setSetupOpen(false);
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

  async function handleSaveScoring() {
    setScoringStatus("saving");
    const result = await saveTournamentRulesAction(
      winPointsRaw,
      drawPointsRaw,
      lossPointsRaw,
      tiebreakerOrder,
    );
    if (result.ok) {
      setScoringStatus("saved");
      setScoringError(null);
      // Auto-collapse only this section after a successful save.
      setRulesOpen(false);
    } else {
      setScoringStatus("unsaved");
      setScoringError(result.error);
    }
  }

  async function handleSaveAdvancement() {
    setAdvancementStatus("saving");
    const result = await saveAdvancementAction(advancement);
    if (result.ok) {
      setAdvancementStatus("saved");
      setAdvancementError(null);
      // Auto-collapse only this section after a successful save.
      setAdvancementOpen(false);
    } else {
      setAdvancementStatus("unsaved");
      setAdvancementError(result.error);
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
    setScoringStatus("unsaved");
    setScoringError(null);
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
    setScoringStatus("unsaved");
    setScoringError(null);
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
    // Gate: only surface unresolved cohorts once the group stage is complete.
    // Before that, a points tie is provisional and could be broken by future
    // results, so showing a "tiebreak pending" prompt is premature.
    if (matches.length === 0 || !matches.every((m) => m.score != null)) {
      return result;
    }
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
    setScoreStatus("unsaved");
  }

  // Scores whose inputs differ from what is persisted on the match list. Drives
  // the "Save all scores" enablement and the unsaved-changes badge. Only these
  // are sent to the server on a bulk save.
  const dirtyScoreEntries = useMemo(() => {
    const entries: { matchId: string; home: string; away: string }[] = [];
    for (const match of matches) {
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
  }, [matches, scoreInputs]);

  async function handleSaveAllScores() {
    if (dirtyScoreEntries.length === 0) return;
    setScoreStatus("saving");
    const result = await saveGroupScoresAction(dirtyScoreEntries);
    if (result.ok) {
      // Resync inputs from the server-persisted scores so the dirty diff clears.
      setMatches(result.matches);
      setScoreInputs(initScoreInputs(result.matches));
      setScoreStatus("saved");
      setError(null);
    } else {
      setScoreStatus("unsaved");
      setError(result.error);
    }
  }

  // Report unsaved-changes state per owned tab up to the panel so it can badge
  // tabs with pending edits. Computed from the same status flags that drive the
  // inline SaveStatusBadge components.
  const setupDirty =
    metadataStatus === "unsaved" ||
    saveStatus === "unsaved" ||
    scoringStatus === "unsaved" ||
    advancementStatus === "unsaved" ||
    setupChanged;
  const groupDirty =
    scoreStatus === "unsaved" ||
    Object.values(manualStatus).some((s) => s === "unsaved");
  const knockoutDirtyFlag = Object.values(knockoutDirty).some(Boolean);
  useEffect(() => {
    onDirtyChange?.("setup", setupDirty);
  }, [setupDirty, onDirtyChange]);
  useEffect(() => {
    onDirtyChange?.("group", groupDirty);
  }, [groupDirty, onDirtyChange]);
  useEffect(() => {
    onDirtyChange?.("knockout", knockoutDirtyFlag);
  }, [knockoutDirtyFlag, onDirtyChange]);

  return (
    <div className="space-y-8">
      {(tab === "setup" || tab === "group") && locked && (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-semibold">Fixtures generated — structure locked.</p>
          <p className="mt-1">
            Participant and group editing is disabled to protect the fixture
            pairings and any entered scores. Edit scores on the Group stage tab,
            or clear fixtures to unlock.
          </p>
        </div>
      )}

      {tab === "setup" && (
        <>
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
            <CollapsibleSection
              title="Scoring & tiebreakers"
              titleId="rules-heading"
              open={rulesOpen}
              onToggle={() => setRulesOpen((o) => !o)}
              badge={<SaveStatusBadge status={scoringStatus} />}
            >
              <RulesSection
                winPointsRaw={winPointsRaw}
                drawPointsRaw={drawPointsRaw}
                lossPointsRaw={lossPointsRaw}
                tiebreakerOrder={tiebreakerOrder}
                rulesStatus={scoringStatus}
                error={scoringError}
                onWinChange={(v) => {
                  setWinPointsRaw(v);
                  setScoringStatus("unsaved");
                  setScoringError(null);
                }}
                onDrawChange={(v) => {
                  setDrawPointsRaw(v);
                  setScoringStatus("unsaved");
                  setScoringError(null);
                }}
                onLossChange={(v) => {
                  setLossPointsRaw(v);
                  setScoringStatus("unsaved");
                  setScoringError(null);
                }}
                onMoveTiebreaker={moveTiebreaker}
                onToggleTiebreaker={toggleTiebreaker}
                onSaveRules={handleSaveScoring}
              />
            </CollapsibleSection>
          )}

          {plan && (
            <CollapsibleSection
              title="Knockout advancement"
              titleId="advancement-heading"
              open={advancementOpen}
              onToggle={() => setAdvancementOpen((o) => !o)}
              badge={<SaveStatusBadge status={advancementStatus} />}
            >
              <AdvancementEditor
                advancement={advancement}
                rulesStatus={advancementStatus}
                error={advancementError}
                maxGroupSize={plan ? Math.max(...plan.groupSizes) : 0}
                onChange={(next) => {
                  setAdvancement(next);
                  setAdvancementError(null);
                }}
                onMarkDirty={() => {
                  setAdvancementStatus("unsaved");
                  setAdvancementError(null);
                }}
                onSave={handleSaveAdvancement}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title="Tournament setup"
            titleId="setup-heading"
            open={setupOpen}
            onToggle={() => setSetupOpen((o) => !o)}
          >
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
          </CollapsibleSection>

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
        </>
      )}

      {tab === "group" && (
        <>
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
              scoreStatus={scoreStatus}
              canSave={dirtyScoreEntries.length > 0}
              onScoreChange={updateScoreInput}
              onSaveAllScores={handleSaveAllScores}
              participantById={participantById}
              groupLabelById={groupLabelById}
            />
          )}
        </>
      )}

      {tab === "knockout" && plan && (
        <div className="space-y-8">
          {initialSetup.tournament?.advancement.map((dest) => {
            const slug = slugifyBracketName(dest.name);
            return (
              <KnockoutSection
                key={slug}
                bracketSlug={slug}
                title={dest.name}
                setup={initialSetup}
                groupMatches={matches}
                initialKnockoutMatches={initialKnockoutMatches[slug] ?? []}
                onDirtyChange={(dirty) =>
                  setKnockoutDirty((prev) => ({ ...prev, [slug]: dirty }))
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

