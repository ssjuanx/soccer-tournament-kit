"use client";

/**
 * Accessible tablist. Extracted from `app/admin/admin-panel.tsx`.
 *
 * Generic over the tab id type so callers keep full type-safety (e.g. the admin
 * panel's `AdminTab` union). Each tab may render a small "unsaved changes" dot
 * via the optional `isDirty` predicate.
 */
export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  isDirty,
}: {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  isDirty?: (id: T) => boolean;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2 border-b border-slate-200">
      {items.map((t) => {
        const isActive = active === t.id;
        const dirty = isDirty ? isDirty(t.id) : false;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            className={`relative -mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {t.label}
            {dirty ? (
              <span
                aria-label="Unsaved changes"
                className="ml-2 inline-flex h-2 w-2 rounded-full bg-amber-500 align-middle"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}