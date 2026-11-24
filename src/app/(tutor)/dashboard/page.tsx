import { DepartureBanner } from "~/app/_components/school-departure";
import { PolicyConsent } from "~/app/_components/policy-consent";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";
import { AnnouncementsBanner } from "~/app/(tutor)/_components/announcements-banner";
import { TimeAvailability } from "~/app/(tutor)/_components/time-availability";
import { TutorPairings } from "~/app/(tutor)/_components/tutor-pairings";
import { MyInterviews } from "~/app/(tutor)/_components/my-interviews";
import { TutorActivation } from "~/app/(tutor)/_components/tutor-activation";
import { TutorDiscipline } from "~/app/(tutor)/_components/tutor-discipline";
import { QualificationRequests } from "~/app/(tutor)/_components/qualification-requests";
import { SubjectWillingness } from "~/app/(tutor)/_components/subject-willingness";
import { getTranslations } from "next-intl/server";
import { DashboardTasks } from "~/app/(tutor)/_components/dashboard-tasks";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { SessionPagePosition } from "~/app/_components/session-view-state";

import { TutorWorkspace } from "~/app/(tutor)/_components/tutor-workspace";
import { TutorSchedule } from "~/app/(tutor)/_components/tutor-schedule";
import { TutorRoomSchedule } from "~/app/(tutor)/_components/tutor-room-schedule";
import { ProgramCalendarNotice } from "~/app/_components/program-calendar";
import { SchoolCalendarNotice } from "~/app/_components/school-calendar-notice";
import { PersonalTutorHistory } from "~/app/history/personal-tutor-history";
import { isInterviewChairRole } from "~/lib/interview-chair";
import { pageMetadata } from "~/server/branding-metadata";

export async function generateMetadata() {
  return pageMetadata("admin.nav.links.dashboard");
}

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

  const [total, crew, features, rooms] = await Promise.all([
    api.tutor.myMonthlyTotal(),
    api.tutor.myCrew(),
    getFeatures(db),
    api.tutor.schedule(),
  ]);
  // Show the separate Interview chair tab for Admin/Head chairs and any active tutor
  // retaining a historical chair assignment; regular panelists vote in Schedule.
  const showChairWorkspace =
    !inactive &&
    features.INTERVIEWS &&
    (isInterviewChairRole(session.role) ||
      (await db.interviewAssignment.count({
        where: { tutorId: session.tutorId, isHead: true },
      })) > 0);

  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:py-6"
    >
      <SessionPagePosition
        id="tutor-dashboard-v1"
        scope={`${me.status}:${total.periodLabel ?? ""}`}
        ready
      />
      {/* Header + monthly service-hour earnings */}
      <section className="border-accent-100 bg-accent-50/45 rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">
              {t("dashboard.greeting", { name: session?.user?.name ?? "" })}
            </h1>
            <p className="muted mt-1">{t("dashboard.subtitle")}</p>
          </div>
          <div className="grid w-full min-w-0 gap-3 sm:flex sm:w-auto sm:flex-wrap">
            {features.SERVICE_HOURS && (
              <section
                aria-label={t("dashboard.hours.title")}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 text-right sm:w-72 sm:max-w-full"
              >
                <div className="space-y-1 text-xs leading-4 text-slate-600">
                  <h2 className="font-medium tracking-wide uppercase">
                    {t("dashboard.hours.title")}
                  </h2>
                  {total.periodLabel && (
                    <p className="break-words">{total.periodLabel}</p>
                  )}
                </div>
                <p className="mt-2 text-4xl leading-none font-bold tracking-tight text-slate-900 tabular-nums">
                  {total.total.toFixed(1)} <span>h</span>
                </p>
                {/* Separate terms wrap independently without changing the server's total. */}
                <ul className="mt-3 flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-sm leading-5 text-slate-600 tabular-nums">
                  <li>
                    {t("tutor.dashboard.hours.earned", {
                      earned: total.earned.toFixed(1),
                    })}
                  </li>
                  {total.extras > 0 && (
                    <li>
                      {t("tutor.dashboard.hours.extra", {
                        extra: total.extras.toFixed(1),
                      })}
                    </li>
                  )}
                  {total.punishments > 0 && (
                    <li>
                      {t("tutor.dashboard.hours.penalty", {
                        penalty: total.punishments.toFixed(1),
                      })}
                    </li>
                  )}
                </ul>
              </section>
            )}
            {/* Crew hours — tallied separately from tutoring (only shown for crew members). */}
            {features.CREW && crew.isCrew && (
              <section
                aria-label={t("tutor.dashboard.crew.title")}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 text-right"
              >
                <h2 className="text-xs leading-4 font-medium tracking-wide text-slate-600 uppercase">
                  {t("tutor.dashboard.crew.title")}
                </h2>
                <p className="mt-2 text-4xl leading-none font-bold tracking-tight text-slate-900 tabular-nums">
                  {crew.hours.toFixed(1)} <span>h</span>
                </p>
                <p className="mt-3 border-t border-slate-100 pt-2 text-sm leading-5 text-slate-600">
                  {t("tutor.dashboard.crew.patrols", { count: crew.patrols })}
                </p>
              </section>
            )}
          </div>
        </div>
      </section>

      {/* Pinned announcements persist; ordinary announcements can be dismissed. */}
      <AnnouncementsBanner />
      <PolicyConsent slug="tutor-policy" />

      <DepartureBanner />
      {pending && (
        <div id="tutor-activation" tabIndex={-1} className="scroll-mt-6">
          <TutorActivation />
        </div>
      )}

      {inactive && !pending && (
        <InlineNotice
          tone="warning"
          title={t("tutor.dashboard.inactive.title")}
        >
          <p className="mt-1">
            {t("tutor.dashboard.inactive.body", {
              status: t(`tutor.status.${me.status}`),
            })}
          </p>
          {me.status === "OPTED_OUT" && (
            <p className="mt-2">{t("tutor.dashboard.inactive.reentryHint")}</p>
          )}
        </InlineNotice>
      )}

      <TutorWorkspace
        attention={
          <DashboardTasks
            status={me.status}
            interviewsEnabled={features.INTERVIEWS}
            meetingsEnabled={features.MEETINGS}
            now={new Date()}
            compact
          />
        }
        schedule={
          <div className="space-y-4">
            <TutorSchedule
              active={!inactive}
              interviewsEnabled={features.INTERVIEWS}
              meetingsEnabled={features.MEETINGS}
              now={new Date()}
              compact
            />
            <section
              id="room-schedule"
              tabIndex={-1}
              className="scroll-mt-6 space-y-3"
            >
              <ProgramCalendarNotice />
              <SchoolCalendarNotice />
              <DisclosureSection
                title={t("dashboard.schedule.title")}
                lifetime="retained"
              >
                <TutorRoomSchedule initialData={rooms} />
              </DisclosureSection>
            </section>
          </div>
        }
        chair={
          showChairWorkspace ? (
            <div id="chair-interviews" tabIndex={-1} className="scroll-mt-6">
              <MyInterviews audience="chair" />
            </div>
          ) : undefined
        }
        pairings={
          <div className="space-y-4">
            <section
              id="tutor-pairings"
              tabIndex={-1}
              className="card scroll-mt-6 p-4 sm:p-5"
            >
              <h2 className="section-title">{t("dashboard.pairings.title")}</h2>
              <p className="muted mt-1 mb-2">{t("dashboard.pairings.help")}</p>
              <TutorPairings active={!inactive} />
            </section>

            {!inactive && features.DISCIPLINE && <TutorDiscipline />}
          </div>
        }
        preferences={
          <div className="space-y-4">
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
              <TimeAvailability active={!inactive} />
            </section>
          </div>
        }
        history={
          <section
            id="tutor-history"
            tabIndex={-1}
            className="card scroll-mt-6 p-4 sm:p-5"
          >
            <PersonalTutorHistory />
          </section>
        }
      />
    </main>
  );
}
