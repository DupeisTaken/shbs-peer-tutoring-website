"use client";
import {
  useSessionViewState,
  useSessionPageScroll,
} from "~/app/_components/session-view-state";
import {
  attendanceViewParser,
  type AttendanceView,
} from "~/lib/management-view-state";
import { viewAccessDenied } from "~/lib/session-view-state";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";

import { useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { FilterToolbar, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { Button } from "~/app/_components/ui/button";

import { api } from "~/trpc/react";
import { SessionRecordDetails } from "~/app/_components/session-record-details";
import { AttendanceCorrection } from "~/app/_components/attendance-correction";
import { useReadOnly } from "~/app/_components/read-only";
import { currentMonth } from "~/lib/time";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";

export default function SubmissionsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const filterId = useId();
  const queryClient = useQueryClient();
  const [deniedTutors, setDeniedTutors] = useState(false);
  const [deniedSessions, setDeniedSessions] = useState(false);
  const tutors = api.admin.tutors.useQuery(undefined, {
    enabled: !deniedTutors,
  });
  // Live options validate the remembered ID; correction drafts remain private.
  const [view, setView] = useSessionViewState<AttendanceView>({
    id: "attendance-filters-v1",
    initialState: { month: currentMonth(), tutorId: "", showPast: false },
    parse: attendanceViewParser((tutors.data ?? []).map((row) => row.id)),
    restoreReady: tutors.data !== undefined,
    enabled:
      !deniedTutors && !deniedSessions && !viewAccessDenied(tutors.error),
  });
  const { month, tutorId, showPast } = view;
  const setMonth = (month: string) =>
    setView((previous) => ({ ...previous, month }));
  const setTutorId = (tutorId: string) =>
    setView((previous) => ({ ...previous, tutorId }));
  const setShowPast = (showPast: boolean) =>
    setView((previous) => ({ ...previous, showPast }));
  const input = {
    month: month || undefined,
    tutorId: tutorId || undefined,
  };
  const sessions = api.admin.sessions.useQuery(input, {
    enabled: !deniedSessions,
  });
  const tutorAccessDenied =
    tutors.error?.data?.code === "FORBIDDEN" ||
    tutors.error?.data?.code === "UNAUTHORIZED";
  const sessionAccessDenied =
    sessions.error?.data?.code === "FORBIDDEN" ||
    sessions.error?.data?.code === "UNAUTHORIZED";
  const tutorsHidden = tutorAccessDenied || deniedTutors;
  const sessionsHidden = sessionAccessDenied || deniedSessions;
  useSessionPageScroll({
    id: "attendance-v1",
    scope: JSON.stringify(view),
    ready:
      tutors.data !== undefined &&
      sessions.data !== undefined &&
      !tutorsHidden &&
      !sessionsHidden,
    enabled: !tutorsHidden && !sessionsHidden,
  });
  // These keys and their authorization belong to the attendance feature. The
  // feedback component only presents the resulting read/retry state.
  useEffect(() => {
    if (tutorAccessDenied) {
      setDeniedTutors(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.tutors, undefined, "query"),
        exact: true,
      });
    } else if (tutors.isSuccess && !tutors.isFetching) setDeniedTutors(false);
  }, [tutorAccessDenied, tutors.isSuccess, tutors.isFetching, queryClient]);
  useEffect(() => {
    if (sessionAccessDenied) {
      setDeniedSessions(true);
      queryClient.removeQueries({
        // Clearing saved filters changes the query key; conceal and evict all
        // attendance scopes so another cached month cannot release the denial.
        queryKey: getQueryKey(api.admin.sessions, undefined, "query"),
      });
    } else if (sessions.isSuccess && !sessions.isFetching)
      setDeniedSessions(false);
  }, [
    sessionAccessDenied,
    sessions.isSuccess,
    sessions.isFetching,
    queryClient,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.submissions.title")}</h1>

      <FilterToolbar label={t("admin.submissions.title")}>
        <label htmlFor={`${filterId}-month`}>
          <span className="label">{t("admin.submissions.monthLabel")}</span>
          <input
            id={`${filterId}-month`}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="input control-compact field-auto min-w-36 lg:min-h-8 lg:py-1"
          />
        </label>
        <label htmlFor={`${filterId}-tutor`}>
          <span className="label">{t("admin.submissions.colTutor")}</span>
          <select
            id={`${filterId}-tutor`}
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
            className="select control-compact field-auto min-w-48 lg:min-h-8 lg:py-1"
            disabled={tutors.data === undefined || tutorsHidden}
          >
            <option value="">{t("admin.submissions.allTutors")}</option>
            {visibleTutors(tutorsHidden ? [] : (tutors.data ?? []), showPast, [
              tutorId,
            ]).map((t) => (
              <option key={t.id} value={t.id}>
                <ParticipantName name={t.englishName} username={t.username} />
              </option>
            ))}
          </select>
        </label>
        <PastTutorsToggle showPast={showPast} onChange={setShowPast} />
      </FilterToolbar>

      {tutorsHidden ? (
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.submissions.colTutor"),
          })}
          action={
            <Button
              disabled={tutors.isFetching}
              onClick={() => void tutors.refetch()}
            >
              {t("managementRecovery.retry", {
                section: t("admin.submissions.colTutor"),
              })}
            </Button>
          }
        />
      ) : (
        <QueryFeedback
          hasData={tutors.data !== undefined}
          loading={tutors.data === undefined}
          error={!!tutors.error}
          retrying={tutors.isFetching}
          loadingTitle={t("managementRecovery.loading", {
            section: t("admin.submissions.colTutor"),
          })}
          errorTitle={t(
            tutors.data === undefined
              ? "managementRecovery.loadFailed"
              : "managementRecovery.refreshFailed",
            { section: t("admin.submissions.colTutor") },
          )}
          retryLabel={t("managementRecovery.retry", {
            section: t("admin.submissions.colTutor"),
          })}
          onRetry={() => void tutors.refetch()}
        />
      )}
      {sessionsHidden ? (
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.submissions.title"),
          })}
          action={
            <Button
              disabled={sessions.isFetching}
              onClick={() => void sessions.refetch()}
            >
              {t("managementRecovery.retry", {
                section: t("admin.submissions.title"),
              })}
            </Button>
          }
        />
      ) : (
        <QueryFeedback
          hasData={sessions.data !== undefined}
          loading={sessions.data === undefined}
          error={!!sessions.error}
          retrying={sessions.isFetching}
          loadingTitle={t("managementRecovery.loading", {
            section: t("admin.submissions.title"),
          })}
          errorTitle={t(
            sessions.data === undefined
              ? "managementRecovery.loadFailed"
              : "managementRecovery.refreshFailed",
            { section: t("admin.submissions.title") },
          )}
          retryLabel={t("managementRecovery.retry", {
            section: t("admin.submissions.title"),
          })}
          onRetry={() => void sessions.refetch()}
        />
      )}

      {sessions.data !== undefined && !sessionsHidden && (
        <div className="card">
          <SummaryTable label={t("admin.submissions.title")}>
            <thead>
              <tr>
                <th>{t("admin.submissions.colDate")}</th>
                <th>{t("admin.submissions.colTutor")}</th>
                <th>{t("admin.submissions.colSubject")}</th>
                <th>{t("admin.submissions.colStatus")}</th>
                <th>{t("admin.submissions.colTutees")}</th>
                <th className="text-right">{t("admin.submissions.colSH")}</th>
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(sessions.data ?? []).map((s) => (
                <tr key={s.id}>
                  {/* Date components must stay together while this table scrolls locally. */}
                  <td className="min-w-28 whitespace-nowrap">
                    {programFormat.dateTime(new Date(s.date), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="min-w-32">
                    <ParticipantName name={s.tutor.englishName} />
                  </td>
                  <td className="min-w-36">{s.pairing.subject}</td>
                  <td className="min-w-24 text-slate-500">
                    {t(`tutor.attendance.tutorStatusOpt.${s.tutorStatus}`)}
                  </td>
                  <td>{s.tutees.length}</td>
                  <td className="text-right">{s.shCount.toFixed(1)}</td>
                  <TableActions>
                    <TableDetails
                      longReader
                      title={`${participantNameLabel(s.tutor.englishName, undefined, t("participantNames.unnamed"))} · ${s.pairing.subject}`}
                    >
                      <SessionRecordDetails session={s} />
                    </TableDetails>
                    {!readOnly &&
                      (!s.mergeGroupId || s.mergeGroupId === s.id) && (
                        <TableDetails
                          label={t("corrections.editAttendance")}
                          title={`${participantNameLabel(s.tutor.englishName, undefined, t("participantNames.unnamed"))} · ${s.pairing.subject}`}
                        >
                          <AttendanceCorrection id={s.id} />
                        </TableDetails>
                      )}
                  </TableActions>
                </tr>
              ))}
              {sessions.data.length === 0 && !sessions.error && (
                <tr>
                  <td colSpan={7} className="text-slate-500">
                    {t("admin.submissions.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
        </div>
      )}
    </div>
  );
}
