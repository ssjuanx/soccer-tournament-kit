"use client";

import { compareGroupLabels, type SavedParticipant } from "@/lib/db/setup";
import type { ParticipantId } from "@/lib/tournament/types";

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
export function ManualTiebreakSection({
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
        Use your off-app decider, order the
        participants winner-first, and save. The ordering resolves only that
        cohort. Until then, its members share a position as{" "}
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
