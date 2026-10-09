/**
 * Shared save-status badge. Consolidates the three near-identical copies that
 * previously lived in `admin-setup` (`SaveStatusBadge`), `knockout-section`
 * (`ScoreSaveBadge`), and `admin-rules` (`RulesSaveBadge`).
 */
export type SaveStatus = "saved" | "saving" | "unsaved";

export function SaveStatusBadge({ status }: { status: SaveStatus }) {
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