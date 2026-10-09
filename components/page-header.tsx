/**
 * Repeated page header: a bold title plus an optional subtitle paragraph.
 * Replaces the `<div><h1 …/><p …/></div>` block duplicated on every page.
 */
export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-slate-600">{subtitle}</p>
      ) : null}
    </div>
  );
}