import AdminSetup from "./admin-setup";

export const metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-slate-600">
          Configure the tournament and enter the drawn participants and teams.
        </p>
      </div>
      <AdminSetup />
    </div>
  );
}