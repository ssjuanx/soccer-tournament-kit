"use client";

import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  titleId: string;
  open: boolean;
  onToggle: () => void;
  /** Optional right-aligned content (e.g. a SaveStatusBadge) in the header. */
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * A bordered card with a clickable header (title + optional badge + chevron)
 * that collapses/expands its body. Used to wrap the admin setup sections so the
 * page stays compact: each section auto-collapses on a successful save and
 * expands again when its header is clicked.
 */
export function CollapsibleSection({
  title,
  titleId,
  open,
  onToggle,
  badge,
  children,
}: CollapsibleSectionProps) {
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-slate-200 bg-white"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${titleId}-body`}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <span id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <span className="text-slate-400" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>
      {open ? (
        <div id={`${titleId}-body`} className="border-t border-slate-200 px-5 py-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
