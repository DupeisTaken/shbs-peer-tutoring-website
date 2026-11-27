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
import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { useDialog } from "~/app/_components/confirm-dialog";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { parseProgramDateTime, programDateKey } from "~/lib/program-time";
import {
  getMeetingAutoExemption,
  resolveEffectiveMeetingStatus,
  resolveTermForMeetingDate,
  type MeetingTermWindow,
} from "~/lib/meeting-quarter";
import { getPeriodDisplay } from "~/lib/period";
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
import {
  MeetingPeriodSections,
  useMeetingPeriodBusy,
} from "~/app/_components/meeting-period-sections";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

/** The statuses an admin picks directly. EXEMPT (X) is auto-applied to inactive tutors
 *  and tutors who did not yet have an account when the meeting occurred;
 *  EXCUSED_ABSENT comes only from a tutor's self-excuse and shows as a read-only badge. */
const ATTENDANCE_OPTIONS = [
  { value: "PRESENT", labelKey: "admin.meetings.status.present" },
  {
    value: "UNEXCUSED_ABSENT",
    labelKey: "admin.meetings.status.unexcusedAbsent",
  },
] as const;

type MeetingStatus =
  | "PRESENT"
  | "EXCUSED_ABSENT"
  | "UNEXCUSED_ABSENT"
  | "EXEMPT";

type TutorOption = {
  id: string;
  englishName: string;
  username?: string | null;
  active: boolean;
  status: string;
  user?: { createdAt?: Date | string | null } | null;
};

type MeetingRecord = {
  id: string;
  title: string;
  date: Date;
  attendances: {
    tutorId: string;
    status: string;
    excusedAt?: Date | null;
    reason?: string | null;
    tutor: { englishName: string };
  }[];
};

const ACCENT_BADGE =
  "badge bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200/80";

export default function MeetingsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const periods = api.admin.meetingPeriods.useQuery();
  const denied = useSessionAccessDenied(periods);
  useSessionPageScroll({
    id: "meetings-v2",
    ready: periods.data !== undefined && !denied,
    enabled: !denied,
  });

  const terms =
    (periods.data as { terms?: MeetingTermWindow[] } | undefined)?.terms ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="page-title">{t("admin.meetings.title")}</h1>
          <p className="muted text-sm">{t("admin.meetings.subtitle")}</p>
        </div>
        {!denied && periods.data?.current && (
          <span className={`${ACCENT_BADGE} self-center`}>
            {t("admin.meetings.periodCurrentBadge", {
              period: periods.data.current.label,
            })}
          </span>
        )}
      </div>

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
          beforeSections={({ previousGrouping }) =>
            !readOnly && !previousGrouping ? (
              <CreateMeetingCard
                terms={terms}
                quarters={periods.data.quarters}
                currentPeriodLabel={periods.data.current?.label ?? null}
              />
            ) : null
          }
          renderPeriod={(period, history, outsideCurrent) => (
            <MeetingPeriodPanel
              period={period}
              history={history}
              outsideCurrent={outsideCurrent}
            />
          )}
        />
      )}
    </div>
  );
}

/** Top-level creation card: meetings are entered once by date and auto-sorted
 *  into their matching program quarter on the server. */
function CreateMeetingCard({
  terms,
  quarters,
  currentPeriodLabel,
}: {
  terms: readonly MeetingTermWindow[];
  quarters: boolean;
  currentPeriodLabel: string | null;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const utils = api.useUtils();
  const fieldId = useId();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => programDateKey(new Date(), timeZone));
  const [time, setTime] = useState("12:00");
  const [inputError, setInputError] = useState("");
  const [createdBanner, setCreatedBanner] = useState<{
    title: string;
    periodLabel: string | null;
  } | null>(null);

  const invalidate = () =>
    Promise.all([
      utils.admin.meetings.invalidate(),
      utils.admin.meetingPeriods.invalidate(),
    ]);

  const create = api.admin.createMeeting.useMutation({
    onSuccess: async (created) => {
      const createdTitle = created?.title ?? title.trim();
      const term = (
        created as
          | {
              term?: {
                schoolYear: string;
                quarter: "Q1" | "Q2" | "Q3" | "Q4";
              } | null;
            }
          | undefined
      )?.term;
      const periodLabel = term
        ? getPeriodDisplay(term, quarters).label
        : previewPeriod?.label ?? null;
      setTitle("");
      setCreatedBanner({ title: createdTitle, periodLabel });
      await invalidate();
    },
  });

  useMeetingPeriodBusy(create.isPending);

  // Live preview of which quarter/semester the selected date will be sorted into.
  const previewPeriod = (() => {
    if (!date) return null;
    try {
      const parsed = parseProgramDateTime(`${date}T${time || "00:00"}`, timeZone);
      const matched = resolveTermForMeetingDate(parsed, terms, { timeZone });
      if (!matched) return null;
      const label = getPeriodDisplay(matched, quarters).label;
      return {
        label,
        isCurrent: matched.active || label === currentPeriodLabel,
      };
    } catch {
      return null;
    }
  })();

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      className="card min-w-0 space-y-3 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${fieldId}-heading`} className="section-title">
            {t("admin.meetings.addHeading")}
          </h2>
          <p className="muted mt-0.5 text-xs">
            {t("admin.meetings.autoSortHint")}
          </p>
        </div>
        {previewPeriod && (
          <span
            className={previewPeriod.isCurrent ? ACCENT_BADGE : "badge-slate"}
          >
            {t("admin.meetings.autoSortTarget", {
              period: previewPeriod.label,
            })}
          </span>
        )}
      </div>

      <form
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10.5rem_8.5rem_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            try {
              setInputError("");
              setCreatedBanner(null);
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
        <label htmlFor={`${fieldId}-title`} className="min-w-0 sm:col-span-2 lg:col-span-1">
          <span className="label">{t("admin.meetings.titlePlaceholder")}</span>
          <input
            id={`${fieldId}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (createdBanner) setCreatedBanner(null);
            }}
            placeholder={t("admin.meetings.titlePlaceholder")}
            aria-label={t("admin.meetings.titlePlaceholder")}
            className="input w-full"
          />
        </label>
        <label htmlFor={`${fieldId}-date`} className="min-w-0">
          <span className="label">{t("uiPatterns.meetingDate")}</span>
          <input
            id={`${fieldId}-date`}
            aria-label={t("uiPatterns.meetingDate")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input w-full"
          />
        </label>
        <label htmlFor={`${fieldId}-time`} className="min-w-0">
          <span className="label">{t("admin.meetings.timeLabel")}</span>
          <input
            id={`${fieldId}-time`}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label={t("admin.meetings.timeLabel")}
            className="input w-full"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          className="w-full sm:col-span-2 lg:col-span-1 lg:w-auto"
          disabled={!title.trim() || create.isPending}
        >
          {t("admin.meetings.create")}
        </Button>
      </form>

      {inputError && (
        <p role="alert" className="text-sm text-red-700">
          {inputError}
        </p>
      )}
      {create.error && (
        <p role="alert" className="text-sm text-red-700">
          {create.error.message}
        </p>
      )}
      {createdBanner && (
        <InlineNotice tone="success" announcement="status">
          {createdBanner.periodLabel
            ? t("admin.meetings.createdInPeriod", {
                title: createdBanner.title,
                period: createdBanner.periodLabel,
              })
            : t("admin.meetings.createdNotice", { title: createdBanner.title })}
        </InlineNotice>
      )}
    </section>
  );
}

function MeetingPeriodPanel({
  period,
  outsideCurrent,
}: {
  period: string;
  history: boolean;
  outsideCurrent?: string | null;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
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
  const del = api.admin.deleteMeeting.useMutation({ onSuccess: invalidate });
  useMeetingPeriodBusy(del.isPending);

  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [busyMeetings, setBusyMeetings] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onEditorBusy = useCallback((id: string, pending: boolean) => {
    setBusyMeetings((previous) => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Meeting attendance concerns ACTIVE tutors with accounts; inactive tutors and
  // tutors without an account at the meeting date show as exempt (X).
  const tutorOpts: TutorOption[] = useMemo(
    () =>
      (tutors.data ?? []).map((tu) => ({
        id: tu.id,
        englishName: tu.englishName,
        username: tu.username,
        active: tu.status === "ACTIVE",
        status: tu.status,
        user: (tu as { user?: { createdAt?: Date | string | null } | null })
          .user,
      })),
    [tutors.data],
  );

  const meetingList = useMemo(
    () => (meetings.data ?? []) as MeetingRecord[],
    [meetings.data],
  );

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

  const now = new Date();
  const upcomingCount = meetingList.filter(
    (m) => new Date(m.date).getTime() > now.getTime(),
  ).length;
  const completedCount = meetingList.length - upcomingCount;

  return (
    <div className="space-y-5">
      {dialog}
      {period === "upcomingOutside" && (
        <p className="muted text-sm">{t("meetingPeriods.outsideStaffHelp")}</p>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {meetings.data !== undefined && (
            <>
              <span className="badge-slate">
                {t("admin.meetings.countBadge", { count: meetingList.length })}
              </span>
              {upcomingCount > 0 && (
                <span className={ACCENT_BADGE}>
                  {t("admin.meetings.upcomingBadge")} · {upcomingCount}
                </span>
              )}
              {completedCount > 0 && (
                <span className="badge-slate">
                  {t("admin.meetings.completedBadge")} · {completedCount}
                </span>
              )}
            </>
          )}
        </div>
        <Button
          variant="secondary"
          size="compact"
          aria-expanded={showSummary}
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary
            ? t("admin.meetings.summary.hide")
            : t("admin.meetings.summary.show")}
        </Button>
      </div>

      {showSummary && (
        <MeetingSummary meetings={meetingList} tutors={tutorOpts} now={now} />
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

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="section-title">{t("admin.meetings.listTitle")}</h2>
            {meetings.data !== undefined && (
              <span className="muted text-xs">
                {t("admin.meetings.countBadge", { count: meetingList.length })}
              </span>
            )}
          </div>

          {meetings.data?.length === 0 ? (
            <p className="muted px-4 py-6 text-sm sm:px-5">
              {t("meetingPeriods.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {meetingList.map((m) => {
                const meetingDate = new Date(m.date);
                const isUpcoming = meetingDate.getTime() > now.getTime();
                const isSelected = selected === m.id;
                const selfExcusedList = m.attendances.filter(
                  (entry) => entry.excusedAt != null,
                );
                const recordedByTutor = new Map(
                  m.attendances.map((a) => [a.tutorId, a.status]),
                );
                let presentCount = 0;
                let excusedCount = 0;
                let unexcusedCount = 0;
                let exemptCount = 0;
                for (const a of m.attendances) {
                  if (a.status === "PRESENT") presentCount++;
                  else if (a.status === "EXCUSED_ABSENT") excusedCount++;
                  else if (a.status === "UNEXCUSED_ABSENT") unexcusedCount++;
                  else if (a.status === "EXEMPT") exemptCount++;
                }
                for (const tu of tutorOpts) {
                  if (recordedByTutor.has(tu.id)) continue;
                  if (
                    getMeetingAutoExemption(tu, meetingDate, now) ===
                    "no_account_at_meeting"
                  ) {
                    exemptCount++;
                  }
                }
                const hasAnyCount =
                  presentCount + excusedCount + unexcusedCount + exemptCount > 0;

                return (
                  <li
                    key={m.id}
                    className={`px-4 py-3.5 transition-colors sm:px-5 ${
                      isSelected ? "bg-slate-50/70" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setOpened((previous) => new Set(previous).add(m.id));
                          setSelected(isSelected ? null : m.id);
                        }}
                        aria-expanded={isSelected}
                        className="group focus-visible:ring-accent-500 flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-md text-left focus-visible:ring-2 focus-visible:outline-hidden lg:min-h-8"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                            isSelected ? "rotate-90 text-slate-700" : ""
                          }`}
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="min-w-0 flex-1">
                          <span className="group-hover:text-accent-600 block font-medium break-words text-slate-900">
                            {m.title} ·{" "}
                            <span className="font-normal text-slate-600">
                              {programFormat.dateTime(meetingDate, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className={
                                isUpcoming ? ACCENT_BADGE : "badge-slate"
                              }
                            >
                              {t(
                                isUpcoming
                                  ? "admin.meetings.upcomingBadge"
                                  : "admin.meetings.completedBadge",
                              )}
                            </span>
                            {hasAnyCount ? (
                              <span className="flex flex-wrap items-center gap-2 font-medium tabular-nums">
                                {presentCount > 0 && (
                                  <span className="text-green-700">
                                    {presentCount} P
                                  </span>
                                )}
                                {excusedCount > 0 && (
                                  <span className="text-amber-700">
                                    {excusedCount} EA
                                  </span>
                                )}
                                {unexcusedCount > 0 && (
                                  <span className="text-red-700">
                                    {unexcusedCount} UA
                                  </span>
                                )}
                                {exemptCount > 0 && (
                                  <span className="text-slate-600">
                                    {exemptCount} X
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-600">
                                {t("admin.meetings.noAttendanceYet")}
                              </span>
                            )}
                            {selfExcusedList.length > 0 && (
                              <span className="badge-amber">
                                {t("admin.meetings.selfExcused", {
                                  count: selfExcusedList.length,
                                })}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-3">
                        <TableDetails title={m.title} longReader>
                          <p className="text-slate-600">
                            {programFormat.dateTime(meetingDate, {
                              dateStyle: "full",
                              timeStyle: "short",
                            })}
                          </p>
                          <h3 className="font-semibold text-slate-900">
                            {t("admin.meetings.selfExcused", {
                              count: selfExcusedList.length,
                            })}
                          </h3>
                          <ul className="space-y-3">
                            {selfExcusedList.map((entry) => (
                              <li
                                key={entry.tutorId}
                                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                              >
                                <p className="font-medium text-slate-900">
                                  <ParticipantName
                                    name={entry.tutor.englishName}
                                    username={
                                      tutorOpts.find(
                                        (tutor) => tutor.id === entry.tutorId,
                                      )?.username
                                    }
                                  />
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-slate-700">
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
                    </div>

                    {/* Opened forms retain their own draft and pending callbacks while
                        another meeting is selected or this disclosure is collapsed. */}
                    {opened.has(m.id) && (
                      <div
                        hidden={!isSelected}
                        className="mt-3.5 min-w-0 space-y-3"
                      >
                        <PastTutorsToggle
                          showPast={showPast}
                          onChange={setShowPast}
                        />
                        {/* The reveal control hides unrecorded past tutors only; recorded
                            attendance stays visible and the mounted editor keeps its draft. */}
                        <AttendanceEditor
                          meetingId={m.id}
                          meetingDate={meetingDate}
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
                );
              })}
            </ul>
          )}
        </div>

        {/* Per-tutor meeting attendance summary, alongside the list. */}
        <div className="min-w-0">
          <TutorMeetingStats
            meetings={meetingList}
            tutors={tutorOpts}
            now={now}
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
  now,
}: {
  meetings: MeetingRecord[];
  tutors: TutorOption[];
  now: Date;
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
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="section-title">{t("admin.meetings.stats.title")}</h2>
        <p className="muted mt-0.5 text-xs">{t("admin.meetings.stats.help")}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span>
            <strong className="font-semibold text-green-700">P</strong>:{" "}
            {t("admin.meetings.status.present")}
          </span>
          <span>
            <strong className="font-semibold text-amber-700">EA</strong>:{" "}
            {t("admin.meetings.status.excusedAbsent")}
          </span>
          <span>
            <strong className="font-semibold text-red-700">UA</strong>:{" "}
            {t("admin.meetings.status.unexcusedAbsent")}
          </span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="muted px-4 py-6 text-sm sm:px-5">
          {t("admin.meetings.stats.empty")}
        </p>
      ) : (
        <SummaryTable sortable label={t("admin.meetings.stats.title")}>
          <thead>
            <tr>
              <th>{t("admin.meetings.stats.tutor")}</th>
              <th className="!px-2 text-right">
                <abbr title={t("admin.meetings.status.present")}>P</abbr>
              </th>
              <th className="!px-2 text-right">
                <abbr title={t("admin.meetings.status.excusedAbsent")}>EA</abbr>
              </th>
              <th className="!px-2 text-right">
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
                <td className="!px-2 text-right tabular-nums text-green-700">
                  {r.present}
                </td>
                <td
                  className={`!px-2 text-right tabular-nums ${r.excused > 0 ? "text-amber-700" : "text-slate-600"}`}
                >
                  {r.excused}
                </td>
                <td
                  className={`!px-2 text-right font-semibold tabular-nums ${
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
                    <MeetingRecordDetails
                      meetings={meetings}
                      tutor={r}
                      now={now}
                    />
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

/** Recorded evidence takes precedence over today's membership. Active tutors who
 *  did not yet have an account when a meeting occurred show as Exempt (X). */
function MeetingSummary({
  meetings,
  tutors,
  now,
}: {
  meetings: MeetingRecord[];
  tutors: TutorOption[];
  now: Date;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const byMeeting = new Map<string, Map<string, string>>();
  for (const m of meetings) {
    const inner = new Map<string, string>();
    for (const a of m.attendances) inner.set(a.tutorId, a.status);
    byMeeting.set(m.id, inner);
  }

  const cell = (
    status: string | undefined,
    autoExemptReason: "inactive" | "no_account_at_meeting" | null,
  ) => {
    switch (status) {
      case "EXEMPT":
        return {
          text: "X",
          cls: "text-slate-600",
          title:
            autoExemptReason === "no_account_at_meeting"
              ? `${t("admin.meetings.exempt")} · ${t("admin.meetings.exemptNoAccount")}`
              : t("admin.meetings.exempt"),
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h3 className="section-title">{t("admin.meetings.summary.title")}</h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span>
            <strong className="font-semibold text-green-700">P</strong>:{" "}
            {t("admin.meetings.status.present")}
          </span>
          <span>
            <strong className="font-semibold text-amber-700">EA</strong>:{" "}
            {t("admin.meetings.status.excusedAbsent")}
          </span>
          <span>
            <strong className="font-semibold text-red-700">UA</strong>:{" "}
            {t("admin.meetings.status.unexcusedAbsent")}
          </span>
          <span>
            <strong className="font-semibold text-slate-700">X</strong>:{" "}
            {t("admin.meetings.exempt")}
          </span>
        </p>
      </div>
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
                const effective = resolveEffectiveMeetingStatus(
                  byMeeting.get(m.id)?.get(tu.id),
                  tu,
                  m.date,
                  now,
                );
                const c = cell(effective.status, effective.autoExemptReason);
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
                  <MeetingRecordDetails
                    meetings={meetings}
                    tutor={tu}
                    now={now}
                  />
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

/** Full titles, dates and recorded absence reasons live behind the row's detail link. */
function MeetingRecordDetails({
  meetings,
  tutor,
  now,
}: {
  meetings: MeetingRecord[];
  tutor: TutorOption;
  now: Date;
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
          (entry) => entry.tutorId === tutor.id,
        );
        const effective = resolveEffectiveMeetingStatus(
          record?.status,
          tutor,
          meeting.date,
          now,
        );
        const status = effective.status ?? "";
        return (
          <li
            key={meeting.id}
            className="space-y-1 border-b border-slate-100 pb-3 last:border-0"
          >
            <h3 className="font-semibold text-slate-900">{meeting.title}</h3>
            <p className="text-slate-600">
              {format.dateTime(new Date(meeting.date), {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span>{statusKeys[status] ? t(statusKeys[status]) : "—"}</span>
              {effective.autoExemptReason === "no_account_at_meeting" && (
                <span className="badge-slate">
                  {t("admin.meetings.exemptNoAccount")}
                </span>
              )}
            </p>
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
  meetingDate,
  readOnly,
  tutors,
  current,
  onBusyChange,
}: {
  meetingId: string;
  meetingDate: Date;
  readOnly: boolean;
  tutors: TutorOption[];
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

  const now = new Date();
  const autoExemptNoAccountIds = new Set<string>();
  for (const tu of tutors) {
    if (current[tu.id]) continue;
    if (
      getMeetingAutoExemption(tu, meetingDate, now) === "no_account_at_meeting"
    ) {
      autoExemptNoAccountIds.add(tu.id);
    }
  }

  const editableUnmarkedIds = tutors
    .filter(
      (tu) =>
        tu.active &&
        !autoExemptNoAccountIds.has(tu.id) &&
        draft[tu.id] !== "EXCUSED_ABSENT" &&
        !draft[tu.id],
    )
    .map((tu) => tu.id);

  const statusBadgeForRecorded = (status: string) => {
    if (status === "PRESENT")
      return { cls: "badge-green", label: t("admin.meetings.status.present") };
    if (status === "EXCUSED_ABSENT")
      return {
        cls: "badge-amber",
        label: t("admin.meetings.status.excusedAbsent"),
      };
    if (status === "UNEXCUSED_ABSENT")
      return {
        cls: "badge-red",
        label: t("admin.meetings.status.unexcusedAbsent"),
      };
    return { cls: "badge-slate", label: t("admin.meetings.exempt") };
  };

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 sm:p-4">
      {!readOnly && editableUnmarkedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={pending || refreshFailed}
            onClick={() => {
              setDraft((previous) => {
                const next = { ...previous };
                for (const id of editableUnmarkedIds) {
                  next[id] = "PRESENT";
                }
                return next;
              });
              save.reset();
            }}
          >
            {t("admin.meetings.markAllPresent")}
          </Button>
        </div>
      )}

      {/* Narrow rows put choices beneath names; grid items and long labels can shrink
          without clipping. Desktop keeps the compact name/choices arrangement. */}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-white">
        {tutors.map((tu) => {
          // Inactive tutors are read-only; recorded evidence stays visible, unrecorded shows Exempt (X).
          if (!tu.active) {
            const recorded = current[tu.id];
            const badge = recorded
              ? statusBadgeForRecorded(recorded)
              : { cls: "badge-slate", label: t("admin.meetings.exempt") };
            return (
              <div
                key={tu.id}
                className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 px-3 py-2 text-sm text-slate-600 sm:flex-row sm:items-center lg:min-h-8"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <ParticipantName
                    name={tu.englishName}
                    username={tu.username}
                  />
                </span>
                <div className="flex min-h-11 flex-wrap items-center gap-2 lg:min-h-8">
                  <span className="text-xs text-slate-600">
                    {t("admin.meetings.exemptInactive")}
                  </span>
                  <span className={badge.cls}>{badge.label}</span>
                </div>
              </div>
            );
          }

          // Active tutors who did not yet have an account when this meeting happened
          // are automatically marked Exempt (X) as read-only unless attendance was already recorded.
          if (autoExemptNoAccountIds.has(tu.id)) {
            return (
              <div
                key={tu.id}
                className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 px-3 py-2 text-sm text-slate-600 sm:flex-row sm:items-center lg:min-h-8"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                  <ParticipantName
                    name={tu.englishName}
                    username={tu.username}
                  />
                </span>
                <div className="flex min-h-11 flex-wrap items-center gap-2 lg:min-h-8">
                  <span className="text-xs text-slate-600">
                    {t("admin.meetings.exemptNoAccount")}
                  </span>
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
                className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center lg:min-h-8"
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
              className="flex min-h-11 min-w-0 flex-col items-start justify-between gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center lg:min-h-8"
            >
              <span className="min-w-0 font-medium [overflow-wrap:anywhere] text-slate-800">
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
        <p className="muted text-sm">{t("approvals.reversalHelp")}</p>
      )}
      {!readOnly && (
        <FormActions>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              if (admitted.current || pending || refreshFailed || readOnly)
                return;
              const entries: { tutorId: string; status: MeetingStatus }[] = [];
              for (const tu of tutors) {
                if (!tu.active) continue;
                if (autoExemptNoAccountIds.has(tu.id)) {
                  // Persist the automatic exemption so tutor history and reports reflect it.
                  entries.push({ tutorId: tu.id, status: "EXEMPT" });
                  continue;
                }
                const status = draft[tu.id];
                if (
                  status &&
                  !(
                    status === "EXCUSED_ABSENT" &&
                    current[tu.id] === "EXCUSED_ABSENT"
                  )
                ) {
                  entries.push({ tutorId: tu.id, status });
                }
              }
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
        <span role="status" className="text-sm text-green-700">
          {t("admin.meetings.saved")}
        </span>
      )}
      {save.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {save.error && !save.error.data?.approvalId && (
        <span role="alert" className="text-sm text-red-700">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
