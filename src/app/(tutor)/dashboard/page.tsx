import { DepartureBanner } from "~/app/_components/school-departure";
import { PolicyConsent } from "~/app/_components/policy-consent";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";
import { AnnouncementsBanner } from "~/app/(tutor)/_components/announcements-banner";
import { SessionAgenda } from "~/app/_components/session-agenda";
import { TutorUpcoming } from "~/app/(tutor)/_components/tutor-upcoming";
import { TutorWorkloadPreference } from "~/app/_components/tutor-workload-preference";
import { AvailabilityEditor } from "~/app/(tutor)/_components/availability-editor";
import { TutorPairings } from "~/app/(tutor)/_components/tutor-pairings";
import { MyInterviews } from "~/app/(tutor)/_components/my-interviews";
import { TutorMeetings } from "~/app/(tutor)/_components/tutor-meetings";
import { TutorActivation } from "~/app/(tutor)/_components/tutor-activation";
import { TutorDiscipline } from "~/app/(tutor)/_components/tutor-discipline";
import { QualificationRequests } from "~/app/(tutor)/_components/qualification-requests";
import { SubjectWillingness } from "~/app/(tutor)/_components/subject-willingness";
import { getTranslations } from "next-intl/server";
import { DashboardTasks } from "~/app/(tutor)/_components/dashboard-tasks";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { SessionPagePosition } from "~/app/_components/session-view-state";

import { TutorRoomSchedule } from "~/app/(tutor)/_components/tutor-room-schedule";
import { ProgramCalendarNotice } from "~/app/_components/program-calendar";
import { SchoolCalendarNotice } from "~/app/_components/school-calendar-notice";

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
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-5 sm:space-y-8 sm:py-8">
      <SessionPagePosition
        id="tutor-dashboard-v1"
        scope={`${me.status}:${total.periodLabel ?? ""}`}
        ready
      />
      {/* Header + monthly service-hour earnings */}
      <section className="border-accent-100 bg-accent-50/45 rounded-xl border px-4 py-5 sm:px-6 sm:py-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="text-center sm:text-left">
            <h1 className="page-title">
              {t("dashboard.greeting", { name: session?.user?.name ?? "" })}
            </h1>
            <p className="muted mt-1">{t("dashboard.subtitle")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end lg:justify-end">
            {features.SERVICE_HOURS && (
              <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-center shadow-sm sm:text-right">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {t("dashboard.hours.title")}
                  {total.periodLabel ? ` · ${total.periodLabel}` : ""}
                </p>
                <p className="text-3xl font-bold text-slate-900">
                  {total.total.toFixed(1)} h
                </p>
                <p className="muted">
                  {t("tutor.dashboard.hours.earned", {
                    earned: total.earned.toFixed(1),
                  })}
                  {total.extras > 0 &&
                    ` ${t("tutor.dashboard.hours.extra", { extra: total.extras.toFixed(1) })}`}
                  {total.punishments > 0 &&
                    ` ${t("tutor.dashboard.hours.penalty", { penalty: total.punishments.toFixed(1) })}`}
                </p>
              </div>
            )}
            {/* Crew hours — tallied separately from tutoring (only shown for crew members). */}
            {features.CREW && crew.isCrew && (
              <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-center shadow-sm sm:text-right">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {t("tutor.dashboard.crew.title")}
                </p>
                <p className="text-3xl font-bold text-slate-900">
                  {crew.hours.toFixed(1)} h
                </p>
                <p className="muted">
                  {t("tutor.dashboard.crew.patrols", { count: crew.patrols })}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Team announcements — shown on every login until acknowledged. */}
      <AnnouncementsBanner />
      <PolicyConsent slug="tutor-policy" />

      <DepartureBanner />
      {pending && (
        <div id="tutor-activation" tabIndex={-1} className="scroll-mt-6">
          <TutorActivation />
        </div>
      )}

      {inactive && !pending && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
          <p className="font-semibold">{t("tutor.dashboard.inactive.title")}</p>
          <p className="mt-1 text-sm">
            {t("tutor.dashboard.inactive.body", {
              status: t(`tutor.status.${me.status}`),
            })}
          </p>
          {me.status === "OPTED_OUT" && (
            <p className="mt-2 text-sm">
              {t("tutor.dashboard.inactive.reentryHint")}
            </p>
          )}
        </div>
      )}

      <section
        id="tutor-pairings"
        tabIndex={-1}
        className="card scroll-mt-6 p-4 sm:p-5"
      >
        <h2 className="section-title">{t("dashboard.pairings.title")}</h2>
        <p className="muted mt-1 mb-2">{t("dashboard.pairings.help")}</p>
        <TutorPairings active={!inactive} />
      </section>

      <DashboardTasks
        status={me.status}
        interviewsEnabled={features.INTERVIEWS}
        meetingsEnabled={features.MEETINGS}
        now={new Date()}
      />
      <div id="attendance" tabIndex={-1} className="scroll-mt-6">
        <SessionAgenda role="tutor" />
      </div>
      <TutorUpcoming
        active={!inactive}
        interviewsEnabled={features.INTERVIEWS}
        includeSessions={false}
        now={new Date()}
      />

      {/* Unresolved work remains expanded. Only optional editors and completed
          evidence use disclosures, which retain mounted drafts when collapsed. */}
      {!inactive && features.INTERVIEWS && <MyInterviews />}
      {!inactive && features.MEETINGS && <TutorMeetings />}
      <QualificationRequests
        active={!inactive}
        viewScope={total.periodLabel ?? ""}
      />
      <section
        id="tutor-preferences"
        tabIndex={-1}
        className="scroll-mt-6 space-y-4"
      >
        <SubjectWillingness />
        <section className="card p-4 sm:p-5">
          <h2 className="section-title">{t("dashboard.availability.title")}</h2>
          <p className="muted mt-1 mb-4 text-sm">
            {t("dashboard.availability.help")}
          </p>
          {inactive && <TutorWorkloadPreference summaryOnly />}
          {!inactive && (
            <DisclosureSection
              title={t("dashboard.availability.edit")}
              lifetime="retained"
            >
              <AvailabilityEditor />
              {/* Independent sibling forms retain their own drafts and save recovery. */}
              <TutorWorkloadPreference embedded />
            </DisclosureSection>
          )}
        </section>
      </section>

      {/* Punishment history for the tutor's tutees (reason-free; self-hides when none). */}
      {!inactive && features.DISCIPLINE && <TutorDiscipline />}

      {/* Room assignments (read-only schedule grid; your pairings are highlighted) */}
      <section
        id="room-schedule"
        tabIndex={-1}
        className="scroll-mt-6 space-y-2"
      >
        <div className="text-center sm:text-left">
          <h2 className="section-title">{t("dashboard.schedule.title")}</h2>
          <p className="muted">{t("dashboard.schedule.help")}</p>
        </div>
        <ProgramCalendarNotice />
        <SchoolCalendarNotice />
        <TutorRoomSchedule initialData={schedule} />
      </section>
    </div>
  );
}
