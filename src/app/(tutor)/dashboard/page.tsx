import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { AttendanceForm } from "~/app/(tutor)/_components/attendance-form";
import { AvailabilityEditor } from "~/app/(tutor)/_components/availability-editor";

export default async function TutorDashboard() {
  const session = await auth();
  const [pairings, total] = await Promise.all([
    api.tutor.myPairings(),
    api.tutor.myMonthlyTotal(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Header + monthly total */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Hi, {session?.user?.name}</h1>
          <p className="muted mt-1">Submit attendance and manage your availability.</p>
        </div>
        <div className="card px-5 py-3 text-right">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Service hours · {total.month}
          </p>
          <p className="text-3xl font-bold text-slate-900">{total.total.toFixed(1)} h</p>
          <p className="muted">
            {total.earned.toFixed(1)} earned
            {total.extras > 0 && ` + ${total.extras.toFixed(1)} extra`}
            {total.punishments > 0 && ` − ${total.punishments.toFixed(1)} penalty`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Pairings + availability */}
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="font-semibold text-slate-900">My pairings</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {pairings.length === 0 && (
                <li className="py-3 text-sm text-slate-500">No pairings yet.</li>
              )}
              {pairings.map((p) => (
                <li key={p.id} className="py-3">
                  <p className="font-medium text-slate-900">{p.subject}</p>
                  <p className="muted">
                    {DAY_NAMES[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
                    {p.room ? ` · ${p.room.name}` : ""}
                  </p>
                  <p className="muted">
                    {p.tutees.map((t) => t.tutee.englishName).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-slate-900">My availability</h2>
            <p className="muted mt-1 mb-3">
              Mark the time slots you can teach. These help coordinators schedule you.
            </p>
            <AvailabilityEditor />
          </section>
        </div>

        {/* Attendance form */}
        <section className="card p-5 lg:col-span-3">
          <h2 className="font-semibold text-slate-900">Submit attendance</h2>
          <p className="muted mt-1 mb-4">
            Record a session for one of your pairings. Service hours are computed
            automatically.
          </p>
          <AttendanceForm />
        </section>
      </div>
    </div>
  );
}
