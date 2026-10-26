"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { Pager } from "~/app/_components/student-portal";
import { useHistoryReadDenial } from "./use-history-read-denial";
import {
  SummaryTable,
  TableAction,
  TableActions,
} from "~/app/_components/ui/summary-table";

export function PersonalTutorHistory() {
  const t = useTranslations("tuteeHistory");
  const common = useTranslations("uiPatterns");
  const records = api.tuteeHistory.myTutorRecords.useQuery();
  const [selected, setSelected] = useState<
    RouterOutputs["tuteeHistory"]["myTutorRecords"][number] | null
  >(null);
  const denied = useHistoryReadDenial(records);
  // myTutorRecords lists every owned tutor identity; only the detail collections
  // paginate. Complete successful list exclusion is authoritative ownership loss.
  const selectedMissing =
    selected !== null &&
    records.isSuccess &&
    !records.isFetching &&
    !records.error &&
    records.data !== undefined &&
    !records.data.some((record) => record.id === selected.id);
  useEffect(() => {
    if (denied || selectedMissing) setSelected(null);
  }, [denied, selectedMissing]);
  return (
    <section className="space-y-3" aria-labelledby="tutor-history-title">
      <h2 id="tutor-history-title" className="text-lg font-semibold">
        {t("tutorHistory")}
      </h2>
      <p className="muted text-sm">{t("tutorHistoryHelp")}</p>
      <QueryFeedback
        hasData={!denied && records.data !== undefined}
        loading={records.isLoading}
        error={denied || !!records.error}
        retrying={records.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t(denied ? "historyAccessLost" : "failed")}
        retryLabel={common("retry")}
        onRetry={() => void records.refetch()}
      />
      {!denied && !!records.data?.length && (
        <SummaryTable label={t("tutorHistory")}>
          <thead>
            <tr>
              <th>{t("historyRecord")}</th>
              <th>{t("recordedPeriods")}</th>
              <th>{t("sessionsHeading")}</th>
              <th>{t("sessionHoursHeading")}</th>
              <th>{t("actionsHeading")}</th>
            </tr>
          </thead>
          <tbody>
            {records.data.map((record) => (
              <tr key={record.id}>
                <td>
                  <p className="font-semibold">{record.englishName}</p>
                  <p className="muted text-xs break-all">
                    {t("recordId", { id: record.id })}
                  </p>
                </td>
                <td>
                  {record.periods.length
                    ? record.periods.length === 1
                      ? record.periods[0]
                      : t("periodRange", {
                          first: record.periods.at(-1)!,
                          last: record.periods[0]!,
                        })
                    : t("periodUnknown")}
                  <RecordedDates
                    first={record.firstSessionDate}
                    last={record.lastSessionDate}
                  />
                </td>
                <td>{record.sessionCount}</td>
                <td>{record.storedSessionHours}</td>
                <TableActions>
                  <TableAction
                    aria-haspopup="dialog"
                    aria-label={t("recordDetailsLabel", {
                      name: record.englishName,
                      id: record.id,
                    })}
                    onClick={() => setSelected(record)}
                  >
                    {t("details")}
                  </TableAction>
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
      {!denied && records.data?.length === 0 && (
        <p className="muted text-sm">{t("noTutorHistory")}</p>
      )}
      {!denied && !selectedMissing && selected && (
        <TutorEvidence
          key={selected.id}
          record={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function TutorEvidence({
  record,
  onClose,
}: {
  record: RouterOutputs["tuteeHistory"]["myTutorRecords"][number];
  onClose: () => void;
}) {
  const t = useTranslations("tuteeHistory");
  const common = useTranslations("uiPatterns");
  const attendance = useTranslations("tutor.attendance.tutorStatusOpt");
  const adjustment = useTranslations("admin.adjustments.typeLabel");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const [meetingPage, setMeetingPage] = useState(0);
  const [amendmentPage, setAmendmentPage] = useState(0);
  // Each evidence collection owns its cursor; advancing sessions must not skip meetings.
  const query = api.tuteeHistory.myTutorDetails.useQuery(
    { tutorId: record.id, page, meetingPage, amendmentPage },
    { refetchOnMount: "always" },
  );
  const denied = useHistoryReadDenial(query);
  // The selected row identifies the initial read; a refreshed detail response
  // owns its identity and aggregate evidence, even when the directory is stale.
  const identity = query.data ? query.data.record : record;
  const periods = query.data ? query.data.periods : record.periods;
  const counts = query.data
    ? query.data.counts
    : {
        sessions: record.sessionCount,
        meetings: record.meetingCount,
        amendments: record.amendmentCount,
      };
  return (
    <ProfileDialog
      title={denied ? t("tutorHistory") : identity.englishName}
      onClose={onClose}
    >
      <div className="space-y-5">
        {!denied && (
          <>
            <p className="muted text-xs break-all">
              {t("recordId", { id: identity.id })}
            </p>
            <p className="muted text-sm">
              {periods.join(", ") || t("periodUnknown")}
            </p>
            <p className="text-sm">{t("historyCounts", counts)}</p>
            <p className="muted text-sm">{t("sessionHoursHelp")}</p>
            <RecordedDates
              first={
                query.data
                  ? query.data.firstSessionDate
                  : record.firstSessionDate
              }
              last={
                query.data ? query.data.lastSessionDate : record.lastSessionDate
              }
            />
          </>
        )}
        <QueryFeedback
          hasData={!denied && query.data !== undefined}
          loading={query.isLoading}
          error={denied || !!query.error}
          retrying={query.isFetching}
          loadingTitle={t("loading")}
          errorTitle={t(denied ? "historyAccessLost" : "failed")}
          retryLabel={common("retry")}
          onRetry={() => void query.refetch()}
        />
        {!denied && query.data && (
          <>
            <section className="space-y-3">
              <h3 className="font-semibold">{t("sessionsHeading")}</h3>
              {!query.data.sessions.length && (
                <p className="muted text-sm">{t("noSessions")}</p>
              )}
              {query.data.sessions.map((row) => (
                <article
                  className="rounded-lg border border-slate-200 p-3"
                  key={row.id}
                >
                  <p className="font-medium">
                    {/* Attendance stores a calendar date at UTC midnight, not an instant. */}
                    {format.dateTime(row.date, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}{" "}
                    · {row.pairing?.subject}
                  </p>
                  <p>
                    {row.schoolYear} {row.quarter} ·{" "}
                    {attendance(row.tutorStatus)}
                  </p>
                  <p>{t("storedHours", { hours: row.shCount })}</p>
                </article>
              ))}
              <HistoryPager
                label={t("sessionsHeading")}
                page={page}
                more={query.data.sessionMore}
                pending={query.isFetching}
                onPage={setPage}
              />
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">{t("meetings")}</h3>
              {!query.data.meetings.length && (
                <p className="muted text-sm">{t("noMeetings")}</p>
              )}
              {query.data.meetings.map((row) => (
                <p key={row.id}>
                  {format.dateTime(row.meeting.date, { dateStyle: "medium" })} ·{" "}
                  {row.meeting.title} · {t(`attendance_${row.status}`)}
                </p>
              ))}
              <HistoryPager
                label={t("meetings")}
                page={meetingPage}
                more={query.data.meetingMore}
                pending={query.isFetching}
                onPage={setMeetingPage}
              />
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">{t("amendments")}</h3>
              {!query.data.amendments.length && (
                <p className="muted text-sm">{t("noAmendments")}</p>
              )}
              {query.data.amendments.map((row) => (
                <p className="break-words" key={row.id}>
                  {row.schoolYear} {row.quarter} · {adjustment(row.type)}{" "}
                  {row.amount} · {row.reason}
                </p>
              ))}
              <HistoryPager
                label={t("amendments")}
                page={amendmentPage}
                more={query.data.amendmentMore}
                pending={query.isFetching}
                onPage={setAmendmentPage}
              />
            </section>
          </>
        )}
      </div>
    </ProfileDialog>
  );
}

/** Attendance dates are stored calendar days; the viewer's timezone must not shift them. */
function RecordedDates({
  first,
  last,
}: {
  first: Date | null;
  last: Date | null;
}) {
  const t = useTranslations("tuteeHistory");
  const format = useFormatter();
  const day = (date: Date) =>
    format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <p className="muted text-xs">
      {first && last
        ? t("recordedDateRange", { first: day(first), last: day(last) })
        : t("recordedDatesUnknown")}
    </p>
  );
}

function HistoryPager({
  label,
  page,
  more,
  pending,
  onPage,
}: {
  label: string;
  page: number;
  more: boolean;
  pending: boolean;
  onPage: (page: number) => void;
}) {
  if (!page && !more) return null;
  return (
    <fieldset disabled={pending}>
      <Pager label={label} page={page} more={more} setPage={onPage} />
    </fieldset>
  );
}
