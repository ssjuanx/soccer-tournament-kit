/**
 * Repeated empty-state notice: a bordered white panel with a muted message.
 * Used across the public pages (standings, matches, bracket, rules) when there
 * is nothing to show yet.
 */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">
      {children}
    </p>
  );
}