"use client";
import {
  useSessionViewState,
  useSessionPageScroll,
  useSessionAccessDenied,
} from "~/app/_components/session-view-state";
import {
  meetingViewParser,
  type MeetingView,
} from "~/lib/management-view-state";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";

import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { FormActions, StatePanel } from "~/app/_components/ui/patterns";
import { useDialog } from "~/app/_components/confirm-dialog";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { parseProgramDateTime, programDateKey } from "~/lib/program-time";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";
import { MeetingPeriodSections, useMeetingPeriodBusy } from "~/app/_components/meeting-period-sections";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

/** The statuses an admin picks directly. EXEMPT (X) is auto-applied to inactive tutors;
 *  EXCUSED_ABSENT comes only from a tutor's self-excuse and shows as a read-only badge. */
const ATTENDANCE_OPTIONS = [
  { value: "PRESENT", labelKey: "admin.meetings.status.present" },
  {
    value: "UNEXCUSED_ABSENT",
    labelKey: "admin.meetings.status.unexcusedAbsent",
  },
] as const;
type MeetingStatus =
  "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT" | "EXEMPT";

export default function MeetingsPage() {
  const t = useTranslations();
  const periods = api.admin.meetingPeriods.useQuery();
  const denied = useSessionAccessDenied(periods);
  useSessionPageScroll({
    id: "meetings-v2",
    ready: periods.data !== undefined && !denied,
    enabled: !denied,
  });
  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.meetings.title")}</h1>
      <QueryFeedback
        hasData={periods.data !== undefined && !denied}
        loading={periods.isLoading}
        error={!!periods.error}
        retrying={periods.isFetching}
        loadingTitle={t("tutor.tasks.loading")}
        errorTitle={t(
          denied ? "meetingPeriods.denied" : "uiPatterns.loadFailed",
        )}
        retryLabel={t("uiPatterns.retry")}
        onRetry={() => void periods.refetch()}
      />
      {!denied && periods.data && (
        <MeetingPeriodSections
          catalog={periods.data}
          renderPeriod={(period, history, outsideCurrent) => (
            <MeetingPeriodPanel period={period} history={history} outsideCurrent={outsideCurrent} />
          )}
        />
      )}
    </div>
  );
}

function MeetingPeriodPanel({
  period,
  history,
  outsideCurrent,
}: {
  period: string;
  history: boolean;
  outsideCurrent?: string | null;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const timeZone = useTimeZone();
  const [inputError, setInputError] = useState("");
  // Supplemental upcoming records have one editable owner in their recorded
  // history group; this overview must not create a competing attendance draft.
  const readOnly = useReadOnly() || period === "upcomingOutside";
  const utils = api.useUtils();
  const { confirm, dialog } = useDialog();
  const meetings = api.admin.meetings.useQuery({ period, outsideCurrent });
  const tutors = api.admin.tutors.useQuery();
  const denied = useSessionAccessDenied(meetings, tutors);
  const [view, setView] = useSessionViewState<MeetingView>({
    id: "meeting-panels-v1",
    scope: period,
    initialState: { showPast: false, showSummary: false },
    parse: meetingViewParser,
    enabled: !denied,
  });
  const { showPast, showSummary } = view;
  const setShowPast = (showPast: boolean) =>
    setView((previous) => ({ ...previous, showPast }));
  const setShowSummary = (change: (previous: boolean) => boolean) =>
    setView((previous) => ({
      ...previous,
      showSummary: change(previous.showSummary),
    }));
  const invalidate = () =>
    Promise.all([
      utils.admin.meetings.invalidate(),
      utils.admin.meetingPeriods.invalidate(),
    ]);
  const create = api.admin.createMeeting.useMutation({
    onSuccess: async () => {
      setTitle("");
      await invalidate();
    },
  });
  const del = api.admin.deleteMeeting.useMutation({ onSuccess: invalidate });
  const previousGrouping = useMeetingPeriodBusy(create.isPending || del.isPending);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => programDateKey(new Date(), timeZone));
  const [time, setTime] = useState("12:00");
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [busyMeetings, setBusyMeetings] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const fieldId = useId();
  const onEditorBusy = useCallback((id: string, pending: boolean) => {
    setBusyMeetings((previous) => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Meeting attendance only concerns ACTIVE tutors; the rest show as exempt (X).
  const tutorOpts = (tutors.data ?? []).map((tu) => ({
    id: tu.id,
    englishName: tu.englishName,
    username: tu.username,
    active: tu.status === "ACTIVE",
    status: tu.status,
  }));

  // Revoked reads conceal cached records; Retry cannot replay an attendance write.
  if (denied)
    return (
      <div className="space-y-6">
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.meetings.title"),
          })}
          action={
            <Button
              disabled={meetings.isFetching || tutors.isFetching}
              onClick={() => {
                void meetings.refetch();
                void tutors.refetch();
              }}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="space-y-6">
      {dialog}
      {period === "upcomingOutside" && (
        <p className="muted">{t("meetingPeriods.outsideStaffHelp")}</p>
      )}
      {meetings.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button onClick={() => void meetings.refetch()}>
              {t("uiPatterns.retry")}
            </Button>
          }
        >
          {meetings.error.message}
        </StatePanel>
      )}
      {inputError && <p role="alert">{inputError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="btn-secondary control-standard"
          aria-expanded={showSummary}
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary
            ? t("admin.meetings.summary.hide")
            : t("admin.meetings.summary.show")}
        </button>
      </div>

      {showSummary && (
        <MeetingSummary meetings={meetings.data ?? []} tutors={tutorOpts} />
      )}

      {!readOnly && !history && !previousGrouping && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              try {
                setInputError("");
                create.mutate({
                  title: title.trim(),
                  date: parseProgramDateTime(
                    `${date}T${time || "00:00"}`,
                    timeZone,
                  ),
                });
              } catch (error) {
                setInputError(
                  error instanceof Error ? error.message : "Invalid date",
                );
              }
            }
          }}
        >
          {/* Preferred widths shrink to the form width at enlarged text sizes;
              fixed rem minimums would override the controls' max-width. */}
          <label htmlFor={`${fieldId}-title`}>
            <span className="label">
              {t("admin.meetings.titlePlaceholder")}
            </span>
            <input
              id={`${fieldId}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("admin.meetings.titlePlaceholder")}
              aria-label={t("admin.meetings.titlePlaceholder")}
              className="input field-auto-bounded [--field-min-width:12rem]"
            />
          </label>
          <label htmlFor={`${fieldId}-date`}>
            <span className="label">{t("uiPatterns.meetingDate")}</span>
            <input
              id={`${fieldId}-date`}
              aria-label={t("uiPatterns.meetingDate")}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input field-auto-bounded [--field-min-width:9rem]"
            />
          </label>
          <label htmlFor={`${fieldId}-time`}>
            <span className="label">{t("admin.meetings.timeLabel")}</span>
            <input
              id={`${fieldId}-time`}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label={t("admin.meetings.timeLabel")}
              className="input field-auto-bounded [--field-min-width:7rem]"
            />
          </label>
          <button
            className="btn-primary"
            disabled={!title.trim() || create.isPending}
          >
            {t("admin.meetings.create")}
          </button>
        </form>
      )}

      {create.error && (
        <p role="alert" className="text-sm text-red-700">
          {create.error.message}
        </p>
      )}
      {del.error && (
        <p role="alert" className="text-sm text-red-700">
          {del.error.message}
        </p>
      )}
      <QueryFeedback
        hasData={meetings.data !== undefined}
        loading={meetings.isLoading}
        error={false}
        loadingTitle={t("tutor.tasks.loading")}
        errorTitle={t("uiPatterns.loadFailed")}
        retryLabel={t("uiPatterns.retry")}
        onRetry={() => void meetings.refetch()}
      />
      {meetings.data?.length === 0 && (
        <p className="muted">{t("meetingPeriods.empty")}</p>
      )}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        <div className="card min-w-0 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {(meetings.data ?? []).map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    onClick={() => {
                      setOpened((previous) => new Set(previous).add(m.id));
                      setSelected(selected === m.id ? null : m.id);
                    }}
                    aria-expanded={selected === m.id}
                    className="hover:text-accent-600 min-h-11 min-w-0 flex-1 text-left font-medium break-words text-slate-900 lg:min-h-8"
                  >
                    {m.title} ·{" "}
                    {programFormat.dateTime(new Date(m.date), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </button>
                  <TableDetails title={m.title} longReader>
                    <p>
                      {programFormat.dateTime(new Date(m.date), {
                        dateStyle: "full",
                        timeStyle: "short",
                      })}
                    </p>
                    <h3 className="font-semibold">
                      {t("admin.meetings.selfExcused", {
                        count: m.attendances.filter(
                          (entry) => entry.excusedAt != null,
                        ).length,
                      })}
                    </h3>
                    <ul className="space-y-3">
                      {m.attendances
                        .filter((entry) => entry.excusedAt != null)
                        .map((entry) => (
                          <li key={entry.tutorId}>
                            <p className="font-medium">
                              <ParticipantName
                                name={entry.tutor.englishName}
                                username={
                                  tutorOpts.find(
                                    (tutor) => tutor.id === entry.tutorId,
                                  )?.username
                                }
                              />
                            </p>
                            <p className="whitespace-pre-wrap">
                              {entry.reason ??
                                t("auditEventDetails.notRecorded")}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </TableDetails>
                  {!readOnly && (
                    <TableAction
                      variant="danger"
                      disabled={del.isPending || busyMeetings.has(m.id)}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("uiPatterns.deleteMeeting"),
                            message: t("uiPatterns.deleteMeetingHelp", {
                              title: m.title,
                            }),
                            confirmLabel: t("admin.meetings.delete"),
                            cancelLabel: t("uiPatterns.cancel"),
                            danger: true,
                          })
                        )
                          del.mutate({ id: m.id });
                      }}
                    >
                      {t("admin.meetings.delete")}
                    </TableAction>
                  )}
                </div>
                {/* Opened forms retain their own draft and pending callbacks while
                    another meeting is selected or this disclosure is collapsed. */}
                {opened.has(m.id) && (
                  <div
                    hidden={selected !== m.id}
                    className="mt-3 min-w-0 space-y-3"
                  >
                    <PastTutorsToggle
                      showPast={showPast}
                      onChange={setShowPast}
                    />
                    {/* The reveal control hides unrecorded past tutors only; recorded
                        attendance stays visible and the mounted editor keeps its draft. */}
                    <AttendanceEditor
                      meetingId={m.id}
                      onBusyChange={onEditorBusy}
                      readOnly={readOnly}
                      tutors={visibleTutors(
                        tutorOpts,
                        showPast,
                        m.attendances.map((a) => a.tutorId),
                      )}
                      current={Object.fromEntries(
                        m.attendances.map((a) => [a.tutorId, a.status]),
                      )}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Per-tutor meeting attendance summary, alongside the list. */}
        <div className="min-w-0">
          <TutorMeetingStats
            meetings={meetings.data ?? []}
            tutors={tutorOpts}
          />
        </div>
      </div>
    </div>
  );
}

/** Per-tutor attendance tally for the supplied period (present / excused / unexcused), worst first.
 *  Shown beside the meetings list so coordinators can spot patterns at a glance. */
function TutorMeetingStats({
  meetings,
  tutors,
}: {
  meetings: MeetingRecord[];
  tutors: {
    id: string;
    englishName: string;
    username?: string | null;
    active: boolean;
  }[];
}) {
  const t = useTranslations();
  const tally = new Map<
    string,
    { present: number; excused: number; unexcused: number }
  >();
  for (const m of meetings) {
    for (const a of m.attendances) {
      const e = tally.get(a.tutorId) ?? {
        present: 0,
        excused: 0,
        unexcused: 0,
      };
      if (a.status === "PRESENT") e.present++;
      else if (a.status === "EXCUSED_ABSENT") e.excused++;
      else if (a.status === "UNEXCUSED_ABSENT") e.unexcused++;
      tally.set(a.tutorId, e);
    }
  }
  const rows = tutors
    .map((tu) => ({
      ...tu,
      ...(tally.get(tu.id) ?? { present: 0, excused: 0, unexcused: 0 }),
    }))
    .filter((r) => r.present + r.excused + r.unexcused > 0)
    .sort(
      (a, b) =>
        b.unexcused - a.unexcused ||
        b.excused - a.excused ||
        a.englishName.localeCompare(b.englishName),
    );

  return (
    <div className="card min-w-0 overflow-x-auto">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="section-title">{t("admin.meetings.stats.title")}</h2>
        <p className="muted mt-0.5 text-xs">{t("admin.meetings.stats.help")}</p>
        <p className="mt-2 text-xs text-slate-600">
          P: {t("admin.meetings.status.present")} · EA:{" "}
          {t("admin.meetings.status.excusedAbsent")} · UA:{" "}
          {t("admin.meetings.status.unexcusedAbsent")}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="muted px-4 py-3 text-sm">
          {t("admin.meetings.stats.empty")}
        </p>
      ) : (
        <SummaryTable sortable label={t("admin.meetings.stats.title")}>
          <thead>
            <tr>
              <th>{t("admin.meetings.stats.tutor")}</th>
              <th className="text-right">
                <abbr title={t("admin.meetings.status.present")}>P</abbr>
              </th>
              <th className="text-right">
                <abbr title={t("admin.meetings.status.excusedAbsent")}>EA</abbr>
              </th>
              <th className="text-right">
                <abbr title={t("admin.meetings.status.unexcusedAbsent")}>
                  UA
                </abbr>
              </th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="text-slate-700">
                <td
                  data-sort-value={participantNameLabel(
                    r.englishName,
                    r.username,
                    "",
                  )}
                  className="font-medium whitespace-nowrap text-slate-700"
                >
                  <ParticipantName name={r.englishName} username={r.username} />
                  {!r.active && (
                    <span className="badge-slate ml-2">
                      {t("admin.summary.inactive")}
                    </span>
                  )}
                </td>
                <td className="text-right text-green-700">{r.present}</td>
                <td
                  className={`text-right ${r.excused > 0 ? "text-amber-700" : "text-slate-600"}`}
                >
                  {r.excused}
                </td>
                <td
                  className={`text-right font-semibold ${
                    r.unexcused > 0 ? "text-red-700" : "text-slate-600"
                  }`}
                >
                  {r.unexcused}
                </td>
                <TableActions>
                  <TableDetails
                    longReader
                    title={participantNameLabel(
                      r.englishName,
                      r.username,
                      t("participantNames.unnamed"),
                    )}
                  >
                    <MeetingRecordDetails meetings={meetings} tutorId={r.id} />
                  </TableDetails>
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
    </div>
  );
}

/** Recorded evidence takes precedence over today's membership. Missing records
 * cannot establish a historical exemption or absence. */
function MeetingSummary({
  meetings,
  tutors,
}: {
  meetings: MeetingRecord[];
  tutors: {
    id: string;
    englishName: string;
    username?: string | null;
    active: boolean;
  }[];
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const byMeeting = new Map<string, Map<string, string>>();
  for (const m of meetings) {
    const inner = new Map<string, string>();
    for (const a of m.attendances) inner.set(a.tutorId, a.status);
    byMeeting.set(m.id, inner);
  }

  const cell = (status: string | undefined) => {
    switch (status) {
      case "EXEMPT":
        return {
          text: "X",
          cls: "text-slate-600",
          title: t("admin.meetings.exempt"),
        };
      case "PRESENT":
        return {
          text: "P",
          cls: "text-green-700",
          title: t("admin.meetings.status.present"),
        };
      case "EXCUSED_ABSENT":
        return {
          text: "EA",
          cls: "text-amber-700",
          title: t("admin.meetings.status.excusedAbsent"),
        };
      case "UNEXCUSED_ABSENT":
        return {
          text: "UA",
          cls: "text-red-700",
          title: t("admin.meetings.status.unexcusedAbsent"),
        };
      default:
        return { text: "·", cls: "text-slate-600", title: "—" };
    }
  };

  return (
    <div className="card overflow-hidden">
      <SummaryTable sortable label={t("admin.meetings.summary.show")}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white">
              {t("admin.meetings.summary.tutor")}
            </th>
            {meetings.map((m) => (
              <th
                key={m.id}
                className="text-center whitespace-nowrap"
                title={m.title}
              >
                {programFormat.dateTime(new Date(m.date), {
                  dateStyle: "medium",
                })}
              </th>
            ))}
            <th className="table-actions-heading">
              {t("tablePatterns.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {tutors.map((tu) => (
            <tr key={tu.id} className="text-slate-700">
              <th
                data-sort-value={participantNameLabel(
                  tu.englishName,
                  tu.username,
                  "",
                )}
                scope="row"
                className="sticky left-0 z-10 bg-white text-left font-medium whitespace-nowrap text-slate-700"
              >
                <ParticipantName name={tu.englishName} username={tu.username} />
                {!tu.active && (
                  <span className="badge-slate ml-2">
                    {t("admin.summary.inactive")}
                  </span>
                )}
              </th>
              {meetings.map((m) => {
                const c = cell(byMeeting.get(m.id)?.get(tu.id));
                return (
                  <td
                    key={m.id}
                    className={`text-center text-xs font-semibold ${c.cls}`}
                    title={c.title}
                  >
                    {c.text}
                  </td>
                );
              })}
              <TableActions>
                <TableDetails
                  longReader
                  title={participantNameLabel(
                    tu.englishName,
                    tu.username,
                    t("participantNames.unnamed"),
                  )}
                >
                  <MeetingRecordDetails meetings={meetings} tutorId={tu.id} />
                </TableDetails>
              </TableActions>
            </tr>
          ))}
          {(meetings.length === 0 || tutors.length === 0) && (
            <tr>
              <td colSpan={meetings.length + 2} className="text-slate-500">
                {t("admin.meetings.summary.noMeetings")}
              </td>
            </tr>
          )}
        </tbody>
      </SummaryTable>
    </div>
  );
}

type MeetingRecord = {
  id: string;
  title: string;
  date: Date;
  attendances: { tutorId: string; status: string; reason?: string | null }[];
};

/** Full titles, dates and recorded absence reasons live behind the row's detail link. */
function MeetingRecordDetails({
  meetings,
  tutorId,
}: {
  meetings: MeetingRecord[];
  tutorId: string;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const statusKeys: Record<string, string> = {
    PRESENT: "admin.meetings.status.present",
    EXCUSED_ABSENT: "admin.meetings.status.excusedAbsent",
    UNEXCUSED_ABSENT: "admin.meetings.status.unexcusedAbsent",
    EXEMPT: "admin.meetings.exempt",
  };
  return (
    <ul className="space-y-4">
      {meetings.map((meeting) => {
        const record = meeting.attendances.find(
          (entry) => entry.tutorId === tutorId,
        );
        const status = record?.status ?? "";
        return (
          <li
            key={meeting.id}
            className="space-y-1 border-b border-slate-100 pb-3 last:border-0"
          >
            <h3 className="font-semibold">{meeting.title}</h3>
            <p className="text-slate-500">
              {format.dateTime(new Date(meeting.date), {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
            <p>{statusKeys[status] ? t(statusKeys[status]) : "—"}</p>
            {record?.reason && (
              <p>
                <span className="font-medium">
                  {t("tablePatterns.reason")}:{" "}
                </span>
                {record.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AttendanceEditor({
  meetingId,
  readOnly,
  tutors,
  current,
  onBusyChange,
}: {
  meetingId: string;
  readOnly: boolean;
  tutors: {
    id: string;
    englishName: string;
    username?: string | null;
    active: boolean;
  }[];
  current: Record<string, string>;
  onBusyChange: (id: string, pending: boolean) => void;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Record<string, MeetingStatus>>(
    () => current as Record<string, MeetingStatus>,
  );
  const correctsRecordedAttendance = Object.entries(current).some(
    ([id, status]) => draft[id] && draft[id] !== status,
  );
  const admitted = useRef(false);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshSaved = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await invalidateAndReport(utils.admin.meetings);
      setRefreshFailed(false);
      admitted.current = false;
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  };
  const save = api.admin.recordMeetingAttendance.useMutation({
    onSuccess: refreshSaved,
    onError: () => {
      admitted.current = false;
    },
  });
  const pending = save.isPending || refreshing;
  useMeetingPeriodBusy(pending);
  useEffect(() => {
    onBusyChange(meetingId, pending);
    return () => onBusyChange(meetingId, false);
  }, [meetingId, pending, onBusyChange]);

  return (
    <div className="mt-3 min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {/* Narrow rows put choices beneath names; grid items and long labels can shrink
          without clipping. Desktop keeps the compact name/choices arrangement. */}
      <div className="space-y-3 lg:space-y-1.5">
        {tutors.map((tu) => {
          // Inactive tutors are read-only; the explicit badge carries status without fading names.
          if (!tu.active) {
            return (
              <div
                key={tu.id}
                className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 text-sm text-slate-600 sm:flex-row sm:items-center lg:min-h-8"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <ParticipantName
                    name={tu.englishName}
                    username={tu.username}
                  />
                </span>
                <div className="flex min-h-11 items-center lg:min-h-8">
                  <span className="badge-slate">
                    {t("admin.meetings.exempt")}
                  </span>
                </div>
              </div>
            );
          }
          const value = draft[tu.id];
          // A self-excused tutor (EXCUSED_ABSENT) is shown as a read-only badge, not editable here.
          if (value === "EXCUSED_ABSENT") {
            return (
              <div
                key={tu.id}
                className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center lg:min-h-8"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                  <ParticipantName
                    name={tu.englishName}
                    username={tu.username}
                  />
                </span>
                <div className="flex min-h-11 items-center lg:min-h-8">
                  <span className="badge-amber">
                    {t("admin.meetings.status.excusedAbsent")}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div
              key={tu.id}
              className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center lg:min-h-8"
            >
              <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                <ParticipantName name={tu.englishName} username={tu.username} />
              </span>
              <div
                role="group"
                aria-label={t("uiPatterns.attendanceFor", {
                  name: participantNameLabel(
                    tu.englishName,
                    tu.username,
                    t("participantNames.unnamed"),
                  ),
                })}
                className="flex min-h-11 max-w-full flex-wrap items-center gap-1 sm:justify-end lg:min-h-8"
              >
                {ATTENDANCE_OPTIONS.map((opt) => (
                  <ChoiceButton
                    key={opt.value}
                    selected={value === opt.value}
                    className="max-w-full [overflow-wrap:anywhere]"
                    disabled={readOnly || pending || refreshFailed}
                    onClick={() => {
                      setDraft((d) => ({ ...d, [tu.id]: opt.value }));
                      save.reset();
                    }}
                  >
                    {t(opt.labelKey)}
                  </ChoiceButton>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {correctsRecordedAttendance && (
        <p className="muted mt-3 text-sm">{t("approvals.reversalHelp")}</p>
      )}
      {!readOnly && (
        <FormActions>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              if (admitted.current || pending || refreshFailed || readOnly)
                return;
              const entries = tutors
                .filter((tu) => tu.active && draft[tu.id])
                .map((tu) => ({ tutorId: tu.id, status: draft[tu.id]! }));
              admitted.current = true;
              save.mutate({ meetingId, entries });
            }}
            disabled={pending || refreshFailed}
          >
            {save.isPending
              ? t("admin.meetings.saving")
              : t(
                  correctsRecordedAttendance
                    ? "admin.meetings.correctAttendance"
                    : "admin.meetings.saveAttendance",
                )}
          </Button>
          <Button
            disabled={pending || refreshFailed}
            onClick={() => {
              setDraft(current as Record<string, MeetingStatus>);
              save.reset();
            }}
          >
            {t("uiPatterns.cancel")}
          </Button>
        </FormActions>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={refreshing} onClick={() => void refreshSaved()}>
              {t("uiPatterns.retry")}
            </Button>
          }
        >
          {t("admin.meetings.refreshFailed")}
        </InlineNotice>
      )}
      {save.isSuccess && (
        <span role="status" className="ml-2 text-sm text-green-700">
          {t("admin.meetings.saved")}
        </span>
      )}
      {save.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {save.error && !save.error.data?.approvalId && (
        <span role="alert" className="ml-2 text-sm text-red-700">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
