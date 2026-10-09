"use client";

import { SaveStatusBadge } from "@/components/save-status-badge";

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
export function MetadataSection({
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

