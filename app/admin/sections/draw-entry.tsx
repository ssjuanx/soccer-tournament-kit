"use client";

import { type SetupPlan } from "@/lib/tournament/draw";
import { type Entry } from "@/lib/db/setup";

interface DrawEntryProps {
  plan: SetupPlan;
  entries: Record<number, Entry>;
  onUpdate: (drawOrder: number, field: keyof Entry, value: string) => void;
  locked: boolean;
}

export function DrawEntry({ plan, entries, onUpdate, locked }: DrawEntryProps) {
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
