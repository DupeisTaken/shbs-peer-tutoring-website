"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { AttendanceForm } from "~/app/(tutor)/_components/attendance-form";
import { ProfileDialog } from "./profile-dialog";
import { Button, ChoiceButton } from "./ui/button";
import type {
  ScheduleView,
  SchedulePreviewItem,
} from "~/lib/schedule-overview";
import { Modal } from "./ui/modal";
import {
  FilterToolbar,
  ChangeReview,
  FormActions,
  InlineNotice,
  StatePanel,
} from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SectionTabs } from "./ui/section-tabs";
import { useSessionAccessDenied } from "./session-view-state";
import {
  SessionPlanTimeFields,
  type SessionPlanTime,
} from "./session-plan-time";
import { SessionCoordinateMessage } from "./session-coordinate-message";
import { SessionCalendarSubscription } from "./session-calendar-subscription";
import { programDateKey } from "~/lib/program-time";
import { focusVisibleContext } from "./focus-visible-context";
import { AgendaBadge, AgendaEventCard } from "./agenda-event-card";

type Agenda = RouterOutputs["sessionPlanning"]["agenda"];
export type AgendaCohort = Agenda["cohorts"][number];
export type SupplementalScheduleEvent = {
  id: string;
  startsAt: Date;
  content: ReactNode;
};
export type SessionOverview = {
  canAddExtra: boolean;
  extraSourceUnavailable: boolean;
  openExtra: () => void;
  items: (SchedulePreviewItem & {
    title: string;
    detail: string;
    action: ReactNode;
  })[];
};

type PlanningRequest = Agenda["requests"][number];
type Suggestion = Agenda["suggestions"][number];
type Editor = {
  mode: "suggest" | "propose" | "alternative";
  cohort: AgendaCohort;
  request?: PlanningRequest;
  suggestion?: Suggestion;
  kind?: "RESCHEDULE" | "EXTRA";
};

/** The clock explains a persisted deadline. Only a server read can settle consent. */
export function SessionResponseDeadline({
  deadline,
  deliveredAt,
  cutoffAt,
  now,
}: {
  deadline: Date | null;
  deliveredAt: Date | null;
  cutoffAt?: Date;
  now: Date;
}) {
  const t = useTranslations("sessionPlanning");
  const format = useFormatter();
  if (!deliveredAt)
    return <p className="text-sm text-amber-900">{t("deliveryPending")}</p>;
  if (!deadline)
    return (
      <p className="text-sm text-amber-900">
        {t("explicitBy", {
          deadline: cutoffAt
            ? format.dateTime(cutoffAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "—",
        })}
      </p>
    );
  const minutes = Math.max(
    0,
    Math.ceil((deadline.getTime() - now.getTime()) / 60_000),
  );
  return (
    <div className="space-y-1 text-sm">
      <p>
        {t("respondBy", {
          deadline: format.dateTime(deadline, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })}
      </p>
      <p className="muted">
        {minutes
          ? t("remaining", {
              hours: Math.floor(minutes / 60),
              minutes: minutes % 60,
            })
          : t("checking")}
      </p>
    </div>
  );
}

function cohortLabel(cohort: AgendaCohort, fallback: string) {
  // Unavailable arrangements can omit subjects; every reader still needs a label.
  return cohort.subjects.join(" + ") || fallback;
}

/** One owner keeps editors, accepted receipts and attendance drafts alive across agenda refreshes. */
export function SessionAgenda({
  role,
  preview = false,
  supplementalEvents = [],
  heading,
  view = "upcoming",
  onViewChange,
  renderOverview,
  pagination,
}: {
  role: "tutor" | "tutee";
  preview?: boolean;
  /** Authorized personal sources supply display only; their controllers own every action. */
  supplementalEvents?: readonly SupplementalScheduleEvent[];
  heading?: string;
  view?: ScheduleView;
  onViewChange?: (view: ScheduleView) => void;
  renderOverview?: (overview: SessionOverview) => ReactNode;
  pagination?: ReactNode;
}) {
  const t = useTranslations("sessionPlanning");
  const format = useFormatter();
  const u = useTranslations("unifiedSchedule");
  const eventText = useTranslations("agendaEvents");
  const [extraPicker, setExtraPicker] = useState(false);
  const agenda = api.sessionPlanning.agenda.useQuery(
    { role },
    { refetchInterval: 30_000 },
  );
  const agendaDenied = useSessionAccessDenied(agenda);
  const history = api.sessionPlanning.history.useInfiniteQuery(
    { role, view: view === "all" ? "all" : "history", limit: 20 },
    {
      enabled: !!onViewChange && view !== "upcoming" && !agendaDenied,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    },
  );
  const historyDenied = useSessionAccessDenied(history);
  const denied = agendaDenied || historyDenied;
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<"week" | "needsAttendance">("week");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [attendance, setAttendance] = useState<AgendaCohort | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendanceGeneration, setAttendanceGeneration] = useState(0);
  const [nextAttendance, setNextAttendance] = useState<AgendaCohort | null>(
    null,
  );
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [receipt, setReceipt] = useState<"saved" | "savedRefreshFailed" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [decisionReview, setDecisionReview] = useState<{
    request: PlanningRequest;
    decision: "ACCEPT" | "REJECT" | "SPLIT" | "FORMALIZE_SPLIT";
    clientKey: string;
  } | null>(null);
  const admission = useRef(false);
  const arrivedHash = useRef<string | null>(null);
  const propose = api.sessionPlanning.propose.useMutation();
  const suggest = api.sessionPlanning.suggest.useMutation();
  const respond = api.sessionPlanning.respond.useMutation();
  const split = api.sessionPlanning.requestSplit.useMutation();
  const formalizeSplit = api.sessionPlanning.formalizeSplit.useMutation();
  const retryNotice = api.sessionPlanning.retryNotice.useMutation();
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    if (role !== "tutor" || denied) return;
    let frame: number | undefined;
    const arrive = (force = false) => {
      const hash = window.location.hash;
      if (
        (!force && arrivedHash.current === hash) ||
        document.querySelector("dialog[open]")
      )
        return;
      if (hash === "#attendance" && role === "tutor") {
        onViewChange?.("upcoming");
        setTab("needsAttendance");
      } else if (hash.startsWith("#session-") && agenda.data) {
        const cohort = agenda.data.cohorts.find(
          (row) => `#session-${row.id}` === hash,
        );
        if (!cohort) return;
        onViewChange?.(
          cohort.needsAttendance || cohort.endsAt > now
            ? "upcoming"
            : "history",
        );
        setTab(
          cohort.date < agenda.data.windowStart ||
            cohort.date > agenda.data.windowEnd
            ? "needsAttendance"
            : "week",
        );
      } else return;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (
          window.location.hash !== hash ||
          document.querySelector("dialog[open]")
        )
          return;
        const target = document.getElementById(hash.slice(1));
        if (target) {
          focusVisibleContext(target);
          arrivedHash.current = hash;
        }
      });
    };
    arrive();
    const changed = () => arrive(true);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [agenda.data, role, denied, onViewChange, now]);
  const blocked =
    denied ||
    !!agenda.error ||
    !agenda.data ||
    working ||
    receipt === "savedRefreshFailed";
  function beginDecision(
    request: PlanningRequest,
    decision: "ACCEPT" | "REJECT" | "SPLIT" | "FORMALIZE_SPLIT",
  ) {
    if (blocked) return;
    setError(null);
    setDecisionReview({ request, decision, clientKey: crypto.randomUUID() });
  }
  async function reloadEditor() {
    try {
      const result = await agenda.refetch({ throwOnError: true });
      if (!result.data || !editor) return;
      const cohort = result.data.cohorts.find(
        (item) => item.id === editor.cohort.id,
      );
      const request = editor.request
        ? result.data.requests.find((item) => item.id === editor.request!.id)
        : undefined;
      if (cohort) {
        setEditor({ ...editor, cohort, request });
        setEditorGeneration((value) => value + 1);
        setError(null);
      }
    } catch {
      /* A failed read preserves the captured editor and its version. */
    }
  }
  async function refreshAccepted() {
    setWorking(true);
    try {
      await agenda.refetch({ throwOnError: true });
      setReceipt("saved");
    } catch {
      setReceipt("savedRefreshFailed");
    } finally {
      setWorking(false);
    }
  }
  async function commit(action: () => Promise<unknown>) {
    if (admission.current || blocked) return false;
    admission.current = true;
    setWorking(true);
    setError(null);
    setReceipt(null);
    try {
      await action();
      // Clear the accepted editor before recovery. A refresh failure cannot replay it.
      setEditor(null);
      setDecisionReview(null);
      setReceipt("saved");
      await refreshAccepted();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("loadFailed"));
      return false;
    } finally {
      admission.current = false;
      setWorking(false);
    }
  }
  function openAttendance(cohort: AgendaCohort) {
    if (blocked || attendanceBusy || !cohort.canRecordAttendance) return;
    if (attendance && attendance.id !== cohort.id) {
      setNextAttendance(cohort);
      return;
    }
    setAttendance(cohort);
    setAttendanceOpen(true);
  }
  async function reloadAttendance() {
    if (attendanceBusy || !attendance) return;
    try {
      const result = await agenda.refetch({ throwOnError: true });
      const latest = result.data?.cohorts.find(
        (item) => item.id === attendance.id,
      );
      if (latest?.canRecordAttendance) {
        setAttendance(latest);
        setAttendanceGeneration((value) => value + 1);
      }
    } catch {
      /* Retain the draft until an explicit reload completes successfully. */
    }
  }
  const feedback = (
    <QueryFeedback
      hasData={!!agenda.data}
      loading={!agenda.data && !agenda.error}
      error={!!agenda.error}
      retrying={agenda.isFetching}
      loadingTitle={t("load")}
      errorTitle={t(agenda.data ? "refreshFailed" : "loadFailed")}
      retryLabel={t("retry")}
      onRetry={() => void agenda.refetch()}
    />
  );
  const safeCohorts = !denied ? (agenda.data?.cohorts ?? []) : [];
  const extraSources = safeCohorts.filter(
    (cohort) =>
      cohort.status === "SCHEDULED" &&
      cohort.startsAt > now &&
      !cohort.unavailable &&
      !!cohort.primaryPairingId &&
      cohort.tutees.length > 0,
  );
  const canAddExtra =
    role === "tutor" &&
    !!agenda.data?.canTutorWrite &&
    !blocked &&
    extraSources.length > 0;
  const overviewItems: SessionOverview["items"] = safeCohorts
    .filter(
      (cohort) =>
        cohort.needsAttendance ||
        (cohort.status === "SCHEDULED" && cohort.endsAt > now),
    )
    .map((cohort) => ({
      id: `session:${cohort.id}`,
      startsAt: cohort.startsAt,
      sortAt: cohort.endsAt,
      needsAction: cohort.needsAttendance,
      title: cohortLabel(cohort, t("scheduleUnavailable")),
      detail: cohort.needsAttendance ? t("needsAttendance") : t("regular"),
      action:
        cohort.needsAttendance && cohort.canRecordAttendance ? (
          <Button
            size="compact"
            disabled={blocked || attendanceBusy}
            onClick={() => openAttendance(cohort)}
          >
            {t("record")}
          </Button>
        ) : (
          <a
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href={`#session-${cohort.id}`}
          >
            {u("viewEvent")}
          </a>
        ),
    }));
  for (const request of !denied ? (agenda.data?.requests ?? []) : []) {
    const offer = request.currentOffer;
    if (
      request.status === "SPLIT_REQUESTED" ||
      offer?.myResponse?.state === "PENDING"
    ) {
      overviewItems.push({
        id: `request:${request.id}`,
        startsAt: offer?.startsAt ?? null,
        sortAt: offer?.startsAt ?? now,
        needsAction: true,
        title: t("requests"),
        detail: t(`status.${request.status}`),
        action: (
          <a
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href={`#request-${request.id}`}
          >
            {u("viewEvent")}
          </a>
        ),
      });
    }
  }
  const overview = renderOverview?.({
    canAddExtra,
    extraSourceUnavailable:
      !!agenda.data && !denied && !agenda.error && !extraSources.length,
    openExtra: () => setExtraPicker(true),
    items: overviewItems,
  });
  const otherEvents = role === "tutor" && !preview ? supplementalEvents : [];
  const filters = onViewChange && (
    <FilterToolbar label={u("eventFilters")} summary={u("filterHelp")}>
      {(["all", "upcoming", "history"] as const).map((option) => (
        <ChoiceButton
          key={option}
          selected={view === option}
          onClick={() => onViewChange(option)}
        >
          {u(`filter.${option}`)}
        </ChoiceButton>
      ))}
    </FilterToolbar>
  );
  const independentEvents = (
    <div className="space-y-3">
      {[...otherEvents]
        .sort(
          (a, b) =>
            a.startsAt.getTime() - b.startsAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((event) => (
          <Fragment key={event.id}>{event.content}</Fragment>
        ))}
    </div>
  );
  if (denied)
    return (
      <>
        {overview}
        <section id="sessions" className="space-y-4">
          <h2 className="section-title">{heading ?? t("title")}</h2>
          <StatePanel
            kind="denied"
            title={t("denied")}
            action={
              <Button
                disabled={agenda.isFetching}
                onClick={() => {
                  void agenda.refetch();
                  if (historyDenied) void history.refetch();
                }}
              >
                {t("retry")}
              </Button>
            }
          />
          {filters}
          {independentEvents}
          {pagination}
        </section>
      </>
    );
  if (!agenda.data)
    return (
      <>
        {overview}
        <section id="sessions" className="space-y-4">
          <h2 className="section-title">{heading ?? t("title")}</h2>
          {feedback}
          {filters}
          {independentEvents}
          {pagination}
        </section>
      </>
    );
  const data = agenda.data;
  const pastCohorts = !historyDenied
    ? (history.data?.pages.flatMap((page) => page.cohorts) ?? [])
    : [];
  const allCohorts = [
    ...new Map(
      [
        ...pastCohorts,
        ...data.cohorts.map((cohort) => {
          const captured =
            cohort.status === "CANCELLED"
              ? pastCohorts.find((row) => row.id === cohort.id)
              : undefined;
          return captured
            ? {
                ...cohort,
                subjects: captured.subjects,
                tutees: captured.tutees,
              }
            : cohort;
        }),
      ].map((cohort) => [cohort.id, cohort]),
    ).values(),
  ];
  const visible = onViewChange
    ? allCohorts.filter(
        (cohort) =>
          view === "all" ||
          (view === "history"
            ? cohort.endsAt <= now
            : cohort.needsAttendance ||
              (cohort.status === "SCHEDULED" &&
                cohort.endsAt > now &&
                cohort.date >= data.windowStart &&
                cohort.date <= data.windowEnd)),
      )
    : data.cohorts.filter((cohort) =>
        tab === "needsAttendance"
          ? cohort.needsAttendance
          : cohort.needsAttendance ||
            (cohort.date >= data.windowStart && cohort.date <= data.windowEnd),
      );
  const shown = preview ? visible.slice(0, 3) : visible;
  // Historical rows never grant write authority. An overlapping stable agenda row
  // wins by ID so an unfinished attendance draft still uses its captured source.
  const timeline = [
    ...shown.map((cohort) => ({
      id: `session:${cohort.id}`,
      startsAt: cohort.startsAt,
      cohort,
    })),
    ...(onViewChange || tab === "week"
      ? otherEvents.filter((event) => {
          if (onViewChange) return true;
          const date = programDateKey(event.startsAt, data.timeZone);
          return date >= data.windowStart && date <= data.windowEnd;
        })
      : []),
  ].sort(
    (a, b) =>
      (onViewChange && view !== "upcoming" ? -1 : 1) *
        (a.startsAt.getTime() - b.startsAt.getTime()) ||
      a.id.localeCompare(b.id),
  );
  const timeText = (startsAt: Date, endsAt: Date) =>
    `${format.dateTime(startsAt, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} – ${format.dateTime(endsAt, { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <>
      {overview}
      <section
        id="sessions"
        tabIndex={-1}
        className="scroll-mt-6 space-y-4"
        aria-labelledby="session-agenda-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="session-agenda-title" className="section-title">
              {heading ?? t("title")}
            </h2>
            <p className="muted mt-1 text-sm">
              {onViewChange && view !== "upcoming"
                ? u("historyScope")
                : t("help", { timeZone: data.timeZone })}
            </p>
          </div>
          {preview ? (
            <a
              className="link inline-flex min-h-11 items-center"
              href="/student?view=schedule#sessions"
            >
              {t("viewSessions")}
            </a>
          ) : (
            <SessionCalendarSubscription />
          )}
        </div>
        {feedback}
        {data.notices
          .filter(
            (notice) =>
              notice.actionRequired && notice.event === "deadline_missed",
          )
          .map((notice) => {
            const context = notice.context;
            const timeZone = context.timeZone ?? data.timeZone;
            const noticeTime = (value: string) =>
              format.dateTime(new Date(value), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone,
              });
            return (
              <InlineNotice key={notice.id} tone="warning" announcement="alert">
                <p className="font-semibold">{t("deadlineMissedTitle")}</p>
                <p className="mt-1">{t("deadlineMissedHelp")}</p>
                <div className="mt-2 space-y-1">
                  {context.subjectLabel && (
                    <p className="font-medium">{context.subjectLabel}</p>
                  )}
                  {context.originalStartsAt && (
                    <p>
                      {t("before")}:{" "}
                      <time dateTime={context.originalStartsAt}>
                        {noticeTime(context.originalStartsAt)}
                      </time>
                    </p>
                  )}
                  {context.startsAt && (
                    <p>
                      {t("proposed")}:{" "}
                      <time dateTime={context.startsAt}>
                        {noticeTime(context.startsAt)}
                      </time>
                      {context.endsAt && (
                        <>
                          {" "}
                          –{" "}
                          <time dateTime={context.endsAt}>
                            {format.dateTime(new Date(context.endsAt), {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone,
                            })}
                          </time>
                        </>
                      )}
                    </p>
                  )}
                  <p className="text-xs">{t("zone", { timeZone })}</p>
                </div>
              </InlineNotice>
            );
          })}
        {receipt && (
          <InlineNotice
            tone={receipt === "savedRefreshFailed" ? "warning" : "success"}
            announcement="status"
            action={
              receipt === "savedRefreshFailed" ? (
                <Button
                  disabled={working}
                  onClick={() => void refreshAccepted()}
                >
                  {t("retry")}
                </Button>
              ) : undefined
            }
          >
            {t(receipt)}
          </InlineNotice>
        )}
        {error && (
          <InlineNotice tone="error" announcement="alert">
            {error}
          </InlineNotice>
        )}
        {filters}
        <AgendaTabs
          unified={!!onViewChange}
          label={t("title")}
          value={tab}
          onChange={setTab}
          items={[
            { value: "week", label: t("week") },
            ...(role === "tutor"
              ? [
                  {
                    value: "needsAttendance" as const,
                    label: t("needsAttendance"),
                  },
                ]
              : []),
          ]}
        >
          {!timeline.length && <StatePanel kind="empty" title={t("empty")} />}
          <div className="space-y-3">
            {timeline.map((entry) => {
              if ("content" in entry)
                return <Fragment key={entry.id}>{entry.content}</Fragment>;
              const cohort = entry.cohort;
              return (
                <AgendaEventCard
                  key={cohort.id}
                  id={`session-${cohort.id}`}
                  kind={cohort.kind === "EXTRA" ? "extra" : "regular"}
                  title={cohortLabel(cohort, t("scheduleUnavailable"))}
                  time={
                    <time dateTime={cohort.startsAt.toISOString()}>
                      {timeText(cohort.startsAt, cohort.endsAt)}
                    </time>
                  }
                  details={
                    <>
                      <p>
                        {role === "tutee"
                          ? cohort.tutorName
                          : cohort.tutees
                              .map((learner) => learner.name)
                              .join(", ")}
                      </p>
                      <p>
                        {cohort.online
                          ? t("online")
                          : (cohort.roomName ?? t("noRoom"))}
                      </p>
                    </>
                  }
                  badges={
                    <>
                      {cohort.needsAttendance ? (
                        <AgendaBadge
                          tone={role === "tutor" ? "warning" : "neutral"}
                        >
                          {eventText(
                            role === "tutor"
                              ? "needsAction"
                              : "awaitingAttendance",
                          )}
                        </AgendaBadge>
                      ) : (
                        !cohort.unavailable &&
                        cohort.status === "SCHEDULED" &&
                        cohort.endsAt > now && (
                          <AgendaBadge>
                            {eventText(
                              cohort.startsAt <= now
                                ? "inProgress"
                                : "upcoming",
                            )}
                          </AgendaBadge>
                        )
                      )}
                      {cohort.rescheduled && (
                        <AgendaBadge>{eventText("rescheduled")}</AgendaBadge>
                      )}
                      {cohort.unavailable && (
                        <AgendaBadge tone="warning">
                          {eventText("unavailable")}
                        </AgendaBadge>
                      )}
                      {!cohort.unavailable && cohort.status !== "SCHEDULED" && (
                        <AgendaBadge
                          tone={
                            cohort.status === "RECORDED" ? "success" : "neutral"
                          }
                        >
                          {eventText(
                            cohort.status === "RECORDED"
                              ? "completed"
                              : "cancelled",
                          )}
                        </AgendaBadge>
                      )}
                    </>
                  }
                >
                  {role === "tutor" && cohort.needsAttendance && (
                    <p className="mb-3 text-sm text-yellow-900">
                      {eventText("attendanceNeeded")}
                    </p>
                  )}
                  {cohort.status === "SCHEDULED" &&
                    !preview &&
                    data.cohorts.some((source) => source.id === cohort.id) && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <SessionCoordinateMessage cohortId={cohort.id} />
                        {role === "tutor" && data.canTutorWrite && (
                          <>
                            <Button
                              size="compact"
                              disabled={
                                blocked ||
                                cohort.startsAt <= now ||
                                cohort.unavailable
                              }
                              onClick={() =>
                                setEditor({
                                  mode: "propose",
                                  cohort,
                                  kind: "RESCHEDULE",
                                })
                              }
                            >
                              {t("reschedule")}
                            </Button>
                            {!onViewChange && (
                              <Button
                                size="compact"
                                disabled={
                                  blocked ||
                                  cohort.startsAt <= now ||
                                  cohort.unavailable
                                }
                                onClick={() =>
                                  setEditor({
                                    mode: "propose",
                                    cohort,
                                    kind: "EXTRA",
                                  })
                                }
                              >
                                {t("addExtra")}
                              </Button>
                            )}
                          </>
                        )}
                        {role === "tutee" && (
                          <Button
                            size="compact"
                            disabled={
                              blocked ||
                              cohort.startsAt <= now ||
                              cohort.unavailable
                            }
                            onClick={() =>
                              setEditor({ mode: "suggest", cohort })
                            }
                          >
                            {t("suggest")}
                          </Button>
                        )}
                        {role === "tutor" && cohort.canRecordAttendance && (
                          <Button
                            variant="primary"
                            size="compact"
                            disabled={blocked || attendanceBusy}
                            onClick={() => openAttendance(cohort)}
                          >
                            {t("record")}
                          </Button>
                        )}
                      </div>
                    )}
                  {cohort.unavailable && (
                    <InlineNotice tone="warning">
                      {t("scheduleUnavailableHelp")}
                    </InlineNotice>
                  )}
                  {cohort.schoolClosed &&
                    !cohort.unavailable &&
                    cohort.status === "SCHEDULED" && (
                      <InlineNotice tone="warning">
                        {t("schoolClosed")}
                      </InlineNotice>
                    )}
                </AgendaEventCard>
              );
            })}
          </div>
        </AgendaTabs>
        {pagination}
        {onViewChange && view !== "upcoming" && (
          <div className="space-y-2">
            <QueryFeedback
              hasData={!!history.data && !historyDenied}
              loading={history.isLoading}
              error={!!history.error || historyDenied}
              retrying={history.isFetching}
              loadingTitle={u("loadingHistory")}
              errorTitle={u(historyDenied ? "denied" : "historyFailed")}
              retryLabel={t("retry")}
              onRetry={() => void history.refetch()}
            />
            {history.hasNextPage && !historyDenied && (
              <Button
                size="compact"
                disabled={history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                {u("moreSessions")}
              </Button>
            )}
            <p className="muted text-xs">{u("historyScope")}</p>
          </div>
        )}
        {data.attendanceBacklogHasMore && (
          <InlineNotice tone="info">{u("moreAttendance")}</InlineNotice>
        )}
        <p className="muted text-xs">{t("publication")}</p>
        {data.weeklyPublication.unavailable > 0 && (
          <InlineNotice tone="warning">
            {t("publicationUnavailable", {
              count: data.weeklyPublication.unavailable,
            })}
          </InlineNotice>
        )}
        {!preview &&
          data.notices.some((notice) => notice.status !== "SENT") && (
            <section className="space-y-2" aria-label={t("essentialNotices")}>
              <h3 className="section-title">{t("essentialNotices")}</h3>
              {data.notices
                .filter((notice) => notice.status !== "SENT")
                .map((notice) => (
                  <InlineNotice
                    key={notice.id}
                    tone={notice.lastError ? "warning" : "info"}
                    action={
                      notice.lastError ||
                      notice.status === "FAILED" ||
                      notice.status === "BLOCKED" ? (
                        <Button
                          disabled={blocked}
                          onClick={() =>
                            void commit(() =>
                              retryNotice.mutateAsync({ noticeId: notice.id }),
                            )
                          }
                        >
                          {t("retryDelivery")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {t(notice.lastError ? "noticeFailed" : "noticePending")}
                  </InlineNotice>
                ))}
            </section>
          )}
        {!preview && data.requests.length > 0 && (
          <section
            className="space-y-3"
            aria-labelledby="session-requests-title"
          >
            <h3 id="session-requests-title" className="section-title">
              {t("requests")}
            </h3>
            {data.requests.map((request) => {
              const offer = request.currentOffer;
              const response = offer?.myResponse;
              const cohort = data.cohorts.find(
                (item) => item.id === request.cohortId,
              );
              const canRespond =
                request.status === "PENDING" && response?.state === "PENDING";
              return (
                <article
                  key={request.id}
                  id={`request-${request.id}`}
                  tabIndex={-1}
                  className="card scroll-mt-6 space-y-3 p-4 sm:p-5"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="font-semibold">
                      {cohort
                        ? cohortLabel(cohort, t("scheduleUnavailable"))
                        : t("requests")}{" "}
                      · {t(request.scope === "ALL" ? "all" : "one")}
                    </h4>
                    <span className="badge-slate">
                      {t(`status.${request.status}`)}
                    </span>
                  </div>
                  <p className="text-sm font-medium">
                    {t(request.kind === "EXTRA" ? "extra" : "rescheduled")}
                  </p>
                  <p className="muted text-sm">
                    {t(request.scope === "ALL" ? "allFlow" : "oneFlow")}
                  </p>
                  {request.scope === "ONE" && (
                    <p className="text-sm font-medium">
                      {t(
                        `stage.${request.stage === 1 ? "A" : request.stage === 2 ? "B" : "C"}`,
                      )}
                    </p>
                  )}
                  {offer && (
                    <>
                      {offer.schoolClosed && (
                        <InlineNotice tone="warning">
                          {t("schoolClosedProposal")}
                        </InlineNotice>
                      )}
                      <p>
                        {t("proposed")}:{" "}
                        {timeText(offer.startsAt, offer.endsAt)}
                      </p>
                      {cohort && request.kind === "RESCHEDULE" && (
                        <p className="muted text-sm">
                          {t("before")}:{" "}
                          {timeText(cohort.startsAt, cohort.endsAt)}
                        </p>
                      )}
                      <ul className="space-y-2" aria-label={t("responses")}>
                        {offer.responses.map((item) => (
                          <li key={item.actorKey} className="space-y-1">
                            <p className="text-sm">
                              {item.name} ·{" "}
                              {t(
                                item.acceptedBy === "TIMEOUT"
                                  ? "status.AUTO_ACCEPTED"
                                  : `status.${item.state}`,
                              )}
                            </p>
                            {request.status === "PENDING" &&
                              item.state === "PENDING" && (
                                <SessionResponseDeadline
                                  deadline={item.deadline}
                                  deliveredAt={item.deliveredAt}
                                  cutoffAt={offer.cutoffAt}
                                  now={now}
                                />
                              )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {canRespond && offer && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={blocked}
                        onClick={() => beginDecision(request, "ACCEPT")}
                      >
                        {t("accept")}
                      </Button>
                      {offer.canReject && (
                        <Button
                          disabled={blocked || !cohort}
                          onClick={() => {
                            if (request.scope === "ONE" && request.stage === 3)
                              beginDecision(request, "REJECT");
                            else if (cohort)
                              setEditor({
                                mode: "alternative",
                                request,
                                cohort,
                              });
                          }}
                        >
                          {t(
                            request.scope === "ONE" && request.stage === 3
                              ? "finalReject"
                              : "alternative",
                          )}
                        </Button>
                      )}
                      {offer.canRequestSplit && (
                        <Button
                          disabled={blocked}
                          onClick={() => beginDecision(request, "SPLIT")}
                        >
                          {t("requestSeparate")}
                        </Button>
                      )}
                    </div>
                  )}
                  {request.status === "SPLIT_REQUESTED" && (
                    <>
                      <p className="muted text-sm">{t("splitHelp")}</p>
                      {role === "tutor" && (
                        <Button
                          disabled={blocked}
                          onClick={() =>
                            beginDecision(request, "FORMALIZE_SPLIT")
                          }
                        >
                          {t("formalizeSplit")}
                        </Button>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </section>
        )}
        {!preview && role === "tutor" && data.suggestions.length > 0 && (
          <section className="space-y-3">
            <h3 className="section-title">{t("suggestions")}</h3>
            {data.suggestions.map((suggestion) => {
              const cohort = data.cohorts.find(
                (item) => item.id === suggestion.cohortId,
              );
              return cohort ? (
                <article
                  key={suggestion.id}
                  className="card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <p>
                    {cohortLabel(cohort, t("scheduleUnavailable"))} ·{" "}
                    {suggestion.date} ·{" "}
                    {String(Math.floor(suggestion.startMin / 60)).padStart(
                      2,
                      "0",
                    )}
                    :{String(suggestion.startMin % 60).padStart(2, "0")}
                  </p>
                  <Button
                    disabled={blocked}
                    onClick={() =>
                      setEditor({
                        mode: "propose",
                        cohort,
                        suggestion,
                        kind: "RESCHEDULE",
                      })
                    }
                  >
                    {t("formalize")}
                  </Button>
                </article>
              ) : null;
            })}
          </section>
        )}
        {extraPicker && (
          <ProfileDialog
            title={t("addExtra")}
            onClose={() => setExtraPicker(false)}
          >
            <div className="space-y-3">
              <p className="muted text-sm">{u("chooseExtraHelp")}</p>
              {extraSources.map((cohort) => (
                <div
                  key={cohort.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"
                >
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      {cohortLabel(cohort, t("scheduleUnavailable"))}
                    </h3>
                    <p className="text-sm">
                      {cohort.tutees.map((person) => person.name).join(", ")}
                    </p>
                    <p className="muted text-sm">
                      {timeText(cohort.startsAt, cohort.endsAt)}
                    </p>
                  </div>
                  <Button
                    size="compact"
                    disabled={!canAddExtra}
                    onClick={() => {
                      setExtraPicker(false);
                      setEditor({ mode: "propose", cohort, kind: "EXTRA" });
                    }}
                  >
                    {u("chooseSession")}
                  </Button>
                </div>
              ))}
              {!extraSources.length && <p>{u("noExtraSource")}</p>}
            </div>
          </ProfileDialog>
        )}
        {editor && (
          <SessionPlanningEditor
            key={`${editorGeneration}:${editor.mode}:${editor.cohort.id}:${editor.cohort.version}:${editor.request?.version ?? editor.suggestion?.id ?? ""}`}
            editor={editor}
            schoolCalendarDays={data.schoolCalendarDays}
            timeZone={data.timeZone}
            blocked={blocked}
            working={working}
            error={error}
            readFailed={!!agenda.error}
            onRetry={() => void agenda.refetch()}
            onReload={() => void reloadEditor()}
            onClose={() => {
              if (!working) setEditor(null);
            }}
            onCommit={(value) =>
              commit(() => {
                const common = {
                  cohortId: editor.cohort.id,
                  expectedVersion: editor.cohort.version,
                  date: value.date,
                  startMin: value.startMin,
                  roomId: value.online ? null : value.roomId,
                  online: value.online,
                  clientKey: value.clientKey,
                };
                if (editor.mode === "suggest")
                  return suggest.mutateAsync(common);
                if (
                  editor.mode === "alternative" &&
                  editor.request?.currentOffer
                )
                  return respond.mutateAsync({
                    requestId: editor.request.id,
                    offerId: editor.request.currentOffer.id,
                    expectedVersion: editor.request.version,
                    decision: "REJECT",
                    alternative: {
                      date: value.date,
                      startMin: value.startMin,
                      roomId: value.online ? null : value.roomId,
                      online: value.online,
                    },
                    clientKey: value.clientKey,
                  });
                return propose.mutateAsync({
                  ...common,
                  scope: value.scope,
                  tuteeId: value.scope === "ONE" ? value.tuteeId : undefined,
                  kind: editor.kind ?? "RESCHEDULE",
                  // Agreement carries forward only when the reviewed allocation
                  // still exactly matches the learner's original suggestion.
                  suggestionId:
                    editor.suggestion?.date === value.date &&
                    editor.suggestion.startMin === value.startMin &&
                    editor.suggestion.online === value.online &&
                    editor.suggestion.roomId === value.roomId
                      ? editor.suggestion.id
                      : undefined,
                });
              })
            }
          />
        )}
        {decisionReview && (
          <Modal
            title={t(
              decisionReview.decision === "ACCEPT"
                ? "accept"
                : decisionReview.decision === "REJECT"
                  ? "finalReject"
                  : decisionReview.decision === "SPLIT"
                    ? "requestSeparate"
                    : "formalizeSplit",
            )}
            busy={working}
            onClose={() => {
              if (!working) setDecisionReview(null);
            }}
            footer={
              <>
                <Button
                  disabled={working}
                  onClick={() => setDecisionReview(null)}
                >
                  {t("cancel")}
                </Button>
                <Button
                  variant="primary"
                  disabled={blocked}
                  onClick={() =>
                    void commit(() => {
                      const request = decisionReview.request;
                      const common = {
                        requestId: request.id,
                        expectedVersion: request.version,
                        clientKey: decisionReview.clientKey,
                      };
                      if (decisionReview.decision === "SPLIT")
                        return split.mutateAsync(common);
                      if (decisionReview.decision === "FORMALIZE_SPLIT")
                        return formalizeSplit.mutateAsync(common);
                      if (!request.currentOffer)
                        throw new Error(t("refreshFailed"));
                      return respond.mutateAsync({
                        ...common,
                        offerId: request.currentOffer.id,
                        decision: decisionReview.decision,
                      });
                    })
                  }
                >
                  {t(
                    decisionReview.decision === "ACCEPT"
                      ? "accept"
                      : decisionReview.decision === "REJECT"
                        ? "finalReject"
                        : decisionReview.decision === "SPLIT"
                          ? "requestSeparate"
                          : "formalizeSplit",
                  )}
                </Button>
              </>
            }
          >
            {decisionReview.request.currentOffer && (
              <p>
                {timeText(
                  decisionReview.request.currentOffer.startsAt,
                  decisionReview.request.currentOffer.endsAt,
                )}
              </p>
            )}
            <p className="mt-3">
              {t(
                decisionReview.decision === "SPLIT" ||
                  decisionReview.decision === "FORMALIZE_SPLIT"
                  ? "splitHelp"
                  : "reviewHelp",
              )}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-red-700">
                {error}
              </p>
            )}
            {agenda.error && (
              <InlineNotice
                tone="error"
                action={
                  <Button onClick={() => void agenda.refetch()}>
                    {t("retry")}
                  </Button>
                }
              >
                {t("refreshFailed")}
              </InlineNotice>
            )}
          </Modal>
        )}
        {attendance && (
          <AttendanceForm
            key={`${attendanceGeneration}:${attendance.id}`}
            occurrence={attendance}
            open={attendanceOpen}
            readBlocked={blocked}
            onClose={() => setAttendanceOpen(false)}
            onBusyChange={setAttendanceBusy}
            onRetry={() => void agenda.refetch()}
            onReload={() => void reloadAttendance()}
          />
        )}
        {nextAttendance && (
          <Modal
            title={t("switchTitle")}
            onClose={() => setNextAttendance(null)}
            footer={
              <>
                <Button
                  onClick={() => {
                    setNextAttendance(null);
                    setAttendanceOpen(true);
                  }}
                >
                  {t("resume")}
                </Button>
                <Button
                  disabled={attendanceBusy}
                  onClick={() => {
                    setAttendance(nextAttendance);
                    setNextAttendance(null);
                    setAttendanceOpen(true);
                  }}
                >
                  {t("discard")}
                </Button>
              </>
            }
          >
            <p>{t("switchHelp")}</p>
          </Modal>
        )}
      </section>
    </>
  );
}

type EditorValue = SessionPlanTime & {
  scope: "ONE" | "ALL";
  tuteeId?: string;
  roomId: string | null;
  online: boolean;
  clientKey: string;
};
function SessionPlanningEditor({
  editor,
  schoolCalendarDays,
  timeZone,
  blocked,
  working,
  error,
  readFailed,
  onRetry,
  onReload,
  onClose,
  onCommit,
}: {
  editor: Editor;
  schoolCalendarDays: Agenda["schoolCalendarDays"];
  timeZone: string;
  blocked: boolean;
  working: boolean;
  error: string | null;
  readFailed: boolean;
  onRetry: () => void;
  onReload: () => void;
  onClose: () => void;
  onCommit: (value: EditorValue) => Promise<boolean>;
}) {
  const t = useTranslations("sessionPlanning");
  const utils = api.useUtils();
  const scopeHelpId = useId();
  const [value, setValue] = useState<EditorValue>(() => ({
    date:
      editor.suggestion?.date ??
      editor.request?.currentOffer?.date ??
      editor.cohort.date,
    startMin:
      editor.suggestion?.startMin ??
      editor.request?.currentOffer?.startMin ??
      editor.cohort.startMin,
    scope: editor.request
      ? editor.request.scope === "ONE"
        ? "ONE"
        : "ALL"
      : editor.suggestion || editor.cohort.tutees.length === 1
        ? "ONE"
        : "ALL",
    tuteeId:
      editor.suggestion?.tuteeId ??
      (editor.request?.scope === "ONE"
        ? editor.request.participantIds[0]
        : editor.cohort.tutees[0]?.id),
    roomId:
      editor.suggestion?.roomId ??
      editor.request?.currentOffer?.roomId ??
      editor.cohort.roomId,
    online:
      editor.suggestion?.online ??
      editor.request?.currentOffer?.online ??
      editor.cohort.online,
    clientKey: crypto.randomUUID(),
  }));
  const [review, setReview] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const previewGuard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function reviewProposal() {
    if (blocked || !valid || previewGuard.current) return;
    previewGuard.current = true;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const allocation = await utils.sessionPlanning.previewLocation.fetch(
        {
          ...value,
          mode: editor.mode,
          cohortId: editor.cohort.id,
          expectedVersion: editor.cohort.version,
          kind:
            editor.kind ??
            (editor.request?.kind === "EXTRA" ? "EXTRA" : "RESCHEDULE"),
          requestId: editor.request?.id,
          requestVersion: editor.request?.version,
          offerId: editor.request?.currentOffer?.id,
        },
        { staleTime: 0 },
      );
      if (!mounted.current) return;
      setValue({
        ...value,
        roomId: allocation.roomId,
        clientKey:
          allocation.roomId === value.roomId
            ? value.clientKey
            : crypto.randomUUID(),
      });
      setRoomName(allocation.roomName);
      setReview(true);
    } catch {
      if (mounted.current) setPreviewError(t("allocationFailed"));
    } finally {
      previewGuard.current = false;
      if (mounted.current) setPreviewing(false);
    }
  }
  const title = t(
    editor.mode === "suggest"
      ? "suggest"
      : editor.mode === "alternative"
        ? "alternative"
        : editor.kind === "EXTRA"
          ? "addExtra"
          : "reschedule",
  );
  const valid = !!value.date && (value.scope === "ALL" || !!value.tuteeId);
  const closedDate = schoolCalendarDays.some(
    (day) => day.active && day.date === value.date && !day.isSchoolDay,
  );
  return (
    <ProfileDialog
      title={title}
      onClose={onClose}
      pending={working || previewing}
    >
      {error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={working} onClick={onReload}>
              {t("reload")}
            </Button>
          }
        >
          {error}
        </InlineNotice>
      )}
      {readFailed && (
        <InlineNotice
          tone="error"
          action={<Button onClick={onRetry}>{t("retry")}</Button>}
        >
          {t("refreshFailed")}
        </InlineNotice>
      )}
      {previewError && (
        <InlineNotice tone="error" announcement="alert">
          {previewError}
        </InlineNotice>
      )}
      <p className="mb-3 text-sm">
        <span className="font-medium">
          {cohortLabel(editor.cohort, t("scheduleUnavailable"))}
        </span>
        {" · "}
        <span className="muted">{timeZone}</span>
      </p>
      {closedDate && (
        <InlineNotice tone="warning">{t("schoolClosedProposal")}</InlineNotice>
      )}
      {review ? (
        <ChangeReview
          title={t("review")}
          evidence={
            <div className="space-y-2">
              {editor.kind !== "EXTRA" && editor.request?.kind !== "EXTRA" && (
                <p>
                  {t("before")}: {editor.cohort.date} ·{" "}
                  {String(Math.floor(editor.cohort.startMin / 60)).padStart(
                    2,
                    "0",
                  )}
                  :{String(editor.cohort.startMin % 60).padStart(2, "0")}
                </p>
              )}
              <p>
                {t("proposed")}: {value.date} ·{" "}
                {String(Math.floor(value.startMin / 60)).padStart(2, "0")}:
                {String(value.startMin % 60).padStart(2, "0")} · 45 min
              </p>
              <p>
                {t("location")}: {value.online ? t("online") : roomName}
              </p>
              {!value.online && (
                <p className="muted text-sm">{t("roomReviewHelp")}</p>
              )}
              <p>
                {t(value.scope === "ALL" ? "all" : "one")}:{" "}
                {(editor.request
                  ? editor.cohort.tutees.filter((item) =>
                      editor.request!.participantIds.includes(item.id),
                    )
                  : value.scope === "ALL"
                    ? editor.cohort.tutees
                    : editor.cohort.tutees.filter(
                        (item) => item.id === value.tuteeId,
                      )
                )
                  .map((item) => item.name)
                  .join(", ")}
              </p>
            </div>
          }
          consequences={
            <>
              <p>{t("reviewHelp")}</p>
              <p className="mt-2">
                {t(
                  editor.mode === "suggest"
                    ? "suggestionHelp"
                    : "agreementHelp",
                )}
              </p>
            </>
          }
          actions={
            <>
              <Button disabled={working} onClick={() => setReview(false)}>
                {t("back")}
              </Button>
              <Button
                variant="primary"
                disabled={blocked || !valid}
                onClick={() => void onCommit(value)}
              >
                {t(
                  editor.mode === "suggest" ? "sendSuggestion" : "sendProposal",
                )}
              </Button>
            </>
          }
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void reviewProposal();
          }}
          className="space-y-3"
        >
          {editor.mode === "propose" && (
            <fieldset
              disabled={working || previewing || !!editor.suggestion}
              className="space-y-2"
              aria-describedby={scopeHelpId}
            >
              <legend className="label">{t("scope")}</legend>
              {editor.cohort.tutees.length > 1 && (
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.scope === "ALL"}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        scope: event.target.checked ? "ALL" : "ONE",
                        clientKey: crypto.randomUUID(),
                      })
                    }
                  />
                  {t("includeAll")}
                </label>
              )}
              {editor.cohort.tutees.length === 1 ? (
                <p className="text-sm">{editor.cohort.tutees[0]?.name}</p>
              ) : (
                value.scope === "ONE" && (
                  <label className="block space-y-1">
                    <span className="label">{t("learner")}</span>
                    <select
                      className="select"
                      value={value.tuteeId ?? ""}
                      required
                      onChange={(event) =>
                        setValue({
                          ...value,
                          tuteeId: event.target.value,
                          clientKey: crypto.randomUUID(),
                        })
                      }
                    >
                      <option value="">{t("chooseLearner")}</option>
                      {editor.cohort.tutees.map((learner) => (
                        <option key={learner.id} value={learner.id}>
                          {learner.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              )}
              <p id={scopeHelpId} className="muted text-sm">
                {t(value.scope === "ALL" ? "allScopeHelp" : "oneScopeHelp")}
              </p>
            </fieldset>
          )}
          <SessionPlanTimeFields
            value={value}
            disabled={working || previewing}
            onChange={(time) =>
              setValue({ ...value, ...time, clientKey: crypto.randomUUID() })
            }
          />
          <label className="block space-y-1">
            <span className="label">{t("location")}</span>
            <select
              className="select"
              disabled={working || previewing}
              value={value.online ? "online" : "inPerson"}
              onChange={(event) =>
                setValue({
                  ...value,
                  online: event.target.value === "online",
                  roomId: null,
                  clientKey: crypto.randomUUID(),
                })
              }
            >
              <option value="inPerson">{t("automaticRoom")}</option>
              <option value="online">{t("online")}</option>
            </select>
          </label>
          <FormActions>
            <Button disabled={working || previewing} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={blocked || !valid || previewing}
            >
              {t(previewing ? "checkingLocation" : "review")}
            </Button>
          </FormActions>
        </form>
      )}
    </ProfileDialog>
  );
}

function AgendaTabs(
  props: React.ComponentProps<
    typeof SectionTabs<"week" | "needsAttendance">
  > & { unified: boolean },
) {
  const { unified, ...tabs } = props;
  return unified ? <div>{props.children}</div> : <SectionTabs {...tabs} />;
}
