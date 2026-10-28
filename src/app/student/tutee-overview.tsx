"use client";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { ProgramCalendarNotice } from "~/app/_components/program-calendar";
import { SchoolCalendarNotice } from "~/app/_components/school-calendar-notice";

/** Overview reads the same owned records as the detailed panels; it never creates an enrollment. */
export function TuteeOverview({ viewScope = "" }: { viewScope?: string }) {
  const t = useTranslations("tuteePortal");
  const locale = useLocale();
  const scheduling = useTranslations("scheduling");
  const recovery = useTranslations("participantRecovery");
  const personal = api.student.me.useQuery({ page: 0 });
  const requests = api.studentWorkflow.mine.useQuery();
  useSessionPageScroll({
    id: "student-dashboard-v1",
    scope: viewScope,
    ready: !!personal.data && !!requests.data,
    enabled: ![personal, requests].some(
      (query) =>
        query.error?.data?.code === "FORBIDDEN" ||
        query.error?.data?.code === "UNAUTHORIZED",
    ),
  });
  const open = requests.data?.filter((row) => row.state === "OPEN");
  return (
    <div className="space-y-6">
      {/* The route header owns intake; these summaries describe only known records. */}
      <QueryFeedback
        hasData={!!personal.data || !!requests.data}
        loading={!personal.data || !requests.data}
        error={!!personal.error || !!requests.error}
        retrying={personal.isFetching || requests.isFetching}
        loadingTitle={recovery("loading")}
        errorTitle={recovery(
          personal.data || requests.data ? "refreshFailed" : "loadFailed",
        )}
        errorDetail={
          <ul>
            {personal.error && (
              <li>
                {t("schedule")}: {personal.error.message}
              </li>
            )}
            {requests.error && (
              <li>
                {t("requests")}: {requests.error.message}
              </li>
            )}
          </ul>
        }
        retryLabel={recovery("retry")}
        onRetry={() => {
          // Retry only failed reads; successful sibling summaries remain independent.
          if (personal.error) void personal.refetch();
          if (requests.error) void requests.refetch();
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/student?view=schedule"
          className="card hover:border-accent-300 block p-5 transition"
        >
          <h2 className="section-title">{t("schedule")}</h2>
          <p className="mt-3 text-3xl font-bold">
            {!personal.data || personal.error
              ? "—"
              : personal.data.schedule.filter(
                  (pairing) => pairing.scheduleConfirmed,
                ).length}
          </p>
          <p className="muted mt-1 text-sm">{t("scheduledSubjects")}</p>
          {/* A short recurring preview uses agreed weekly times, never a next-session date. */}
          {!personal.error && personal.data && (
            <ul className="mt-3 space-y-2 text-sm">
              {personal.data.schedule.slice(0, 3).map((pairing) => (
                <li key={pairing.id} className="[overflow-wrap:anywhere]">
                  <span className="font-medium">{pairing.subject}</span>
                  <span className="muted block">
                    {pairingScheduleText(
                      pairing,
                      scheduling("awaiting"),
                      locale,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Link>
        <Link
          href="/student?view=requests"
          className="card hover:border-accent-300 block p-5 transition"
        >
          <h2 className="section-title">{t("requests")}</h2>
          <p className="mt-3 text-3xl font-bold">
            {!requests.data || requests.error ? "—" : open?.length}
          </p>
          <p className="muted mt-1 text-sm">{t("openRequests")}</p>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(["attendance", "support", "account"] as const).map((view) => (
          <Link
            key={view}
            href={
              view === "account"
                ? "/student?view=account"
                : `/student?view=${view}`
            }
            className="card block space-y-2 p-5"
          >
            <h2 className="font-semibold">{t(view)}</h2>
            <p className="muted text-sm">{t(`${view}Help`)}</p>
          </Link>
        ))}
      </div>
      <ProgramCalendarNotice />
      <SchoolCalendarNotice />
    </div>
  );
}
