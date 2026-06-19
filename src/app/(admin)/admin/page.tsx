import Link from "next/link";

import { api } from "~/trpc/server";
import { currentMonth } from "~/lib/time";

export default async function AdminHome() {
  const [pairings, summary] = await Promise.all([
    api.admin.pairings(),
    api.admin.monthlySummary(),
  ]);
  const activeTutors = summary.rows.filter((r) => r.active).length;
  const totalHours = summary.rows.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Pairings" value={pairings.length} />
        <Stat label="Active tutors" value={activeTutors} />
        <Stat label={`Service hours · ${currentMonth()}`} value={totalHours.toFixed(1)} />
      </div>
      <p className="mt-8 text-gray-600">
        Use the navigation above to manage pairings, submissions, the monthly summary,
        meetings, punishments, adjustments, and people.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link href="/admin/summary" className="text-indigo-600 underline">
          Per-tutor monthly summary →
        </Link>
        <Link href="/admin/pairings" className="text-indigo-600 underline">
          Manage pairings →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
