import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";
import { AnnouncementsBanner } from "~/app/(tutor)/_components/announcements-banner";
import { AttendanceForm } from "~/app/(tutor)/_components/attendance-form";
import { AvailabilityEditor } from "~/app/(tutor)/_components/availability-editor";
import { TutorPairings } from "~/app/(tutor)/_components/tutor-pairings";
import { MergeProvider } from "~/app/(tutor)/_components/merge-context";
import { MyInterviews } from "~/app/(tutor)/_components/my-interviews";
import { TutorMeetings } from "~/app/(tutor)/_components/tutor-meetings";
import { TutorActivation } from "~/app/(tutor)/_components/tutor-activation";
import { TutorDiscipline } from "~/app/(tutor)/_components/tutor-discipline";
import { getTranslations } from "next-intl/server";

import { RoomGrid } from "~/app/_components/room-grid";

export default async function TutorDashboard() {
  const session = await auth();
  // Guard before fetching tutor data: a signed-in non-tutor (e.g. an admin without a tutor link)
  // is sent to their area instead of throwing the tutorProcedure "requires a tutor account" error
  // while the layout redirect resolves.
  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/admin");
  const me = await api.tutor.me();
  const t = await getTranslations();

  // Inactive tutors (pending / graduated / opted-out / archived) keep read-only access to their
  // own history — no tutoring actions. Mutations are additionally blocked server-side by
  // `activeTutorProcedure`; this just tailors the UI. PENDING gets the activation prompt instead
  // of the generic read-only banner.
  const inactive = me.status !== "ACTIVE";
  const pending = me.status === "PENDING";

  const [total, schedule, crew, features] = await Promise.all([
    api.tutor.myMonthlyTotal(),
    api.tutor.schedule(),
    api.tutor.myCrew(),
    getFeatures(db),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Team announcements — shown on every login until acknowledged. */}
      <AnnouncementsBanner />

      {pending && <TutorActivation />}

      {inactive && !pending && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
          <p className="font-semibold">{t("tutor.dashboard.inactive.title")}</p>
          <p className="mt-1 text-sm">
            {t("tutor.dashboard.inactive.body", {
              status: t(`tutor.status.${me.status}`),
            })}
          </p>
          {me.status === "OPTED_OUT" && (
            <p className="mt-2 text-sm">{t("tutor.dashboard.inactive.reentryHint")}</p>
          )}
        </div>
      )}

      {/* Header + monthly service-hour earnings */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t("dashboard.greeting", { name: session?.user?.name ?? "" })}
          </h1>
          <p className="muted mt-1">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {features.SERVICE_HOURS && (
            <div className="card px-5 py-3 text-right">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {t("dashboard.hours.title")}
                {total.periodLabel ? ` · ${total.periodLabel}` : ""}
              </p>
              <p className="text-3xl font-bold text-slate-900">{total.total.toFixed(1)} h</p>
              <p className="muted">
                {t("tutor.dashboard.hours.earned", { earned: total.earned.toFixed(1) })}
                {total.extras > 0 &&
                  ` ${t("tutor.dashboard.hours.extra", { extra: total.extras.toFixed(1) })}`}
                {total.punishments > 0 &&
                  ` ${t("tutor.dashboard.hours.penalty", { penalty: total.punishments.toFixed(1) })}`}
              </p>
            </div>
          )}
          {/* Crew hours — tallied separately from tutoring (only shown for crew members). */}
          {crew.isCrew && (
            <div className="card px-5 py-3 text-right">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {t("tutor.dashboard.crew.title")}
              </p>
              <p className="text-3xl font-bold text-slate-900">{crew.hours.toFixed(1)} h</p>
              <p className="muted">
                {t("tutor.dashboard.crew.patrols", { count: crew.patrols })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pending interviews + session-time confirmations (self-hides when none). */}
      {!inactive && features.INTERVIEWS && <MyInterviews />}

      {/* Upcoming meetings + self-excuse (self-hides when none). */}
      {!inactive && features.MEETINGS && <TutorMeetings />}

      <MergeProvider>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          {/* Pairings + availability */}
          <div className="space-y-6 lg:col-span-2">
            <section className="card p-5">
              <h2 className="section-title">{t("dashboard.pairings.title")}</h2>
              <p className="muted mt-1 mb-2">{t("dashboard.pairings.help")}</p>
              <TutorPairings />
            </section>

            {!inactive && (
              <section className="card p-5">
                <h2 className="section-title">
                  {t("dashboard.availability.title")}
                </h2>
                <p className="muted mt-1 mb-3">{t("dashboard.availability.help")}</p>
                <AvailabilityEditor />
              </section>
            )}
          </div>

          {/* Attendance form */}
          {!inactive && (
            <section className="card p-5 lg:col-span-3">
              <h2 className="section-title">{t("dashboard.attendance.title")}</h2>
              <p className="muted mt-1 mb-4">{t("dashboard.attendance.help")}</p>
              <AttendanceForm />
            </section>
          )}
        </div>
      </MergeProvider>

      {/* Punishment history for the tutor's tutees (reason-free; self-hides when none). */}
      {!inactive && features.DISCIPLINE && <TutorDiscipline />}

      {/* Room assignments (read-only schedule grid; your pairings are highlighted) */}
      <section className="space-y-2">
        <h2 className="section-title">{t("dashboard.schedule.title")}</h2>
        <p className="muted">{t("dashboard.schedule.help")}</p>
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
