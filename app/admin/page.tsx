export const metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <p className="text-slate-600">
        This area is reserved for the tournament administrator to manage
        participants, teams, and match scores. Administration tools are not
        available yet.
      </p>
    </div>
  );
}