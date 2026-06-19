import Link from "next/link";

import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function TutorDashboard() {
  const session = await auth();
  const [pairings, total] = await Promise.all([
    api.tutor.myPairings(),
    api.tutor.myMonthlyTotal(),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tutor dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">{session?.user?.name}</p>
        </div>
        <Link
          href="/attendance"
          className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white"
        >
          Submit attendance
        </Link>
      </div>

      {/* Live monthly service-hour total */}
      <section className="mt-8 rounded-lg border bg-white p-5">
        <h2 className="text-sm font-medium text-gray-500">
          Service hours · {total.month}
        </h2>
        <p className="mt-1 text-3xl font-bold">{total.total.toFixed(1)} h</p>
        <p className="mt-1 text-sm text-gray-500">
          {total.earned.toFixed(1)} earned
          {total.extras > 0 && ` + ${total.extras.toFixed(1)} extra`}
          {total.punishments > 0 && ` − ${total.punishments.toFixed(1)} penalty`}
        </p>
      </section>

      {/* Pairings */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">My pairings</h2>
        <ul className="mt-3 divide-y rounded-lg border bg-white">
          {pairings.length === 0 && (
            <li className="p-4 text-gray-500">No pairings yet.</li>
          )}
          {pairings.map((p) => (
            <li key={p.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{p.subject}</p>
                <p className="text-sm text-gray-500">
                  {DAYS[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
                  {p.room ? ` · ${p.room.name}` : ""}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                {p.tutees.map((t) => t.tutee.englishName).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
