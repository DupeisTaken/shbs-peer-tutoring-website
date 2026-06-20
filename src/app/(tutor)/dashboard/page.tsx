import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { AnnouncementsBanner } from "~/app/(tutor)/_components/announcements-banner";
import { AttendanceForm } from "~/app/(tutor)/_components/attendance-form";
import { AvailabilityEditor } from "~/app/(tutor)/_components/availability-editor";
import { TutorPairings } from "~/app/(tutor)/_components/tutor-pairings";
import { MyInterviews } from "~/app/(tutor)/_components/my-interviews";
import { RoomGrid } from "~/app/_components/room-grid";

export default async function TutorDashboard() {
  const session = await auth();
  const me = await api.tutor.me();

  // Pending tutors (self-signed-up, not yet activated) get a limited view.
  if (!me.active) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <AnnouncementsBanner />
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
          <p className="font-semibold">Your tutor account is pending approval.</p>
          <p className="mt-1 text-sm">
            A coordinator will activate your account shortly. In the meantime you can set the
            time slots you&apos;re available for below.
          </p>
        </div>
        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">My availability</h2>
          <p className="muted mt-1 mb-3">Mark the time slots you can teach.</p>
          <AvailabilityEditor />
        </section>
      </div>
    );
  }

  const [total, schedule] = await Promise.all([
    api.tutor.myMonthlyTotal(),
    api.tutor.schedule(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Team announcements — shown on every login until acknowledged. */}
      <AnnouncementsBanner />

      {/* Header + monthly service-hour earnings */}
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

      {/* Pending interviews + session-time confirmations (self-hides when none). */}
      <MyInterviews />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Pairings + availability */}
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="font-semibold text-slate-900">My pairings</h2>
            <p className="muted mt-1 mb-2">
              Pick the default time slot for each pairing (you still enter actual session
              times when submitting attendance).
            </p>
            <TutorPairings />
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

      {/* Room assignments (read-only schedule grid; your pairings are highlighted) */}
      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">Room schedule</h2>
        <p className="muted">Your pairings are highlighted. Blocked cells are unavailable rooms.</p>
        <RoomGrid
          rooms={schedule.rooms}
          slots={schedule.slots}
          pairings={schedule.pairings}
          blocks={schedule.blocks}
          highlightTutorId={schedule.myTutorId}
        />
      </section>
    </div>
  );
}
