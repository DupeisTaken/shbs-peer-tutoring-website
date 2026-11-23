"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  groupSchoolCalendarHolidays,
  schoolCalendarRangeDates,
  type SchoolCalendarHolidayGroup,
} from "~/lib/school-calendar";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import {
  SummaryTable,
  TableAction,
  TableActions,
  TableDetails,
} from "./ui/summary-table";
import { useActionReview } from "./ui/action-review";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useSessionAccessDenied } from "./session-view-state";
import {
  SchoolCalendarDate,
  SchoolHolidayEditor,
  type SchoolCalendarRecord,
} from "./school-calendar";

type ProgramDay = {
  date: string;
  endDate: string;
  reason: string;
  active: boolean;
  version: number;
  schedulingEffect?: string;
};

type UnifiedRow =
  | { kind: "holiday"; from: string; to: string; group: SchoolCalendarHolidayGroup<SchoolCalendarRecord> }
  | { kind: "program"; from: string; to: string; day: ProgramDay };

function impactConflict(failure: unknown) {
  if (!failure || typeof failure !== "object" || !("data" in failure)) return false;
  const data = failure.data;
  return !!data && typeof data === "object" && "code" in data && data.code === "CONFLICT";
}

/** Keep date-only labels intact: converting to local instants can shift their calendar day. */
function CalendarRange({
  date,
  endDate = date,
}: {
  date: string;
  endDate?: string;
}) {
  const t = useTranslations("programCalendar");
  return (
    <span className="font-medium tabular-nums">
      <time dateTime={date}>{date}</time>
      {endDate !== date && (
        <>
          {" "}
          {t("through")} <time dateTime={endDate}>{endDate}</time>
        </>
      )}
    </span>
  );
}

/** Display the selected effect; the dated scheduler owns commitments and attendance authority. */
export function ProgramCalendarNotice() {
  const t = useTranslations("programCalendar");
  const query = api.program.calendar.useQuery();
  const denied = useSessionAccessDenied(query);
  if (!query.data?.length && !query.error) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="muted mt-1 text-sm">{t("informational")}</p>
      {query.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
          }
        >
          {t("loadFailed")}
        </InlineNotice>
      )}
      <ul className="mt-3 space-y-2 text-sm">
        {!denied &&
          query.data?.map((day) => (
            <li key={day.date}>
              <CalendarRange date={day.date} endDate={day.endDate} /> ·{" "}
              {day.reason}
              <p className="mt-1 font-medium">
                {t(
                  day.schedulingEffect === "PAUSE_REGULAR"
                    ? "pauseEffect"
                    : "noticeEffect",
                )}
              </p>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Combines grouped School Holidays (No school) with Tutoring Notices & Pauses (School day)
 * in one management card while keeping their underlying domain queries, mutations and approvals distinct. */
export function ProgramCalendarSettings() {
  const t = useTranslations("programCalendar");
  const school = useTranslations("schoolCalendar");
  const approvals = useTranslations("approvals");
  const query = api.program.calendarSettings.useQuery();
  const identity = api.account.me.useQuery();
  const calendar = api.student.calendar.useQuery();
  const utils = api.useUtils();
  const review = useActionReview();
  const revokeReview = review.revoke;
  const remove = api.program.removeCalendarDay.useMutation();
  const resetHoliday = api.student.resetCalendarHoliday.useMutation();
  const programDenied = useSessionAccessDenied(query);
  const schoolDenied = useSessionAccessDenied(identity, calendar);
  const [removePreviewing, setRemovePreviewing] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeRefreshing, setRemoveRefreshing] = useState(false);
  const removeGuard = useRef(false);
  const [editor, setEditor] = useState<{
    day: ProgramDay | null;
    snapshot: ProgramDay[];
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [holidayEditor, setHolidayEditor] = useState<{
    group: SchoolCalendarHolidayGroup<SchoolCalendarRecord> | null;
    snapshot: SchoolCalendarRecord[];
  } | null>(null);
  const [acceptedHolidayVersions, setAcceptedHolidayVersions] = useState<
    ReadonlySet<string>
  >(new Set());
  const [holidayRecoveryNeeded, setHolidayRecoveryNeeded] = useState(false);

  useEffect(() => {
    if (programDenied && schoolDenied) revokeReview();
  }, [programDenied, schoolDenied, revokeReview]);

  const refreshSchoolCalendar = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.student.calendar),
      () => invalidateAndReport(utils.program.schoolCalendar),
      async () => {
        await utils.sessionPlanning?.invalidate();
      },
    ]);

  if (programDenied && schoolDenied)
    return (
      <section className="card p-5">
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              onClick={() =>
                void Promise.allSettled([
                  query.refetch(),
                  identity.refetch(),
                  calendar.refetch(),
                ])
              }
            >
              {t("refresh")}
            </Button>
          }
        />
      </section>
    );

  if (!query.data && !calendar.data) {
    const hasLoadError = Boolean(
      query.error ?? calendar.error ?? identity.error,
    );
    return (
      <section className="card p-5">
        <StatePanel
          kind={hasLoadError ? "error" : "loading"}
          title={t(hasLoadError ? "loadFailed" : "loading")}
          action={
            hasLoadError && (
              <Button
                onClick={() =>
                  void Promise.allSettled([
                    query.refetch(),
                    identity.refetch(),
                    calendar.refetch(),
                  ])
                }
              >
                {t("refresh")}
              </Button>
            )
          }
        />
      </section>
    );
  }

  const data = query.data;
  const canEditProgram = !programDenied && !!data?.canEdit;
  const canApplyProgram = !programDenied && !!data?.canApply;
  const canEditHoliday =
    !schoolDenied &&
    !identity.error &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(identity.data?.role ?? "");
  const canApplyHoliday =
    !schoolDenied && ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  const holidayBlocked =
    !!calendar.error ||
    !!identity.error ||
    holidayRecoveryNeeded ||
    review.blocked("holiday");
  const holidayAccepted = (
    group: SchoolCalendarHolidayGroup<SchoolCalendarRecord>,
  ) =>
    group.days.some((day) =>
      acceptedHolidayVersions.has(`${day.date}:${day.version}`),
    );

  const holidayGroups =
    !schoolDenied && calendar.data
      ? groupSchoolCalendarHolidays(calendar.data)
      : [];
  const programRows =
    !programDenied && data ? data.days.filter((day) => day.active) : [];
  const rows: UnifiedRow[] = [
    ...holidayGroups.map((group) => ({
      kind: "holiday" as const,
      from: group.from,
      to: group.to,
      group,
    })),
    ...programRows.map((day) => ({
      kind: "program" as const,
      from: day.date,
      to: day.endDate,
      day,
    })),
  ].sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.kind.localeCompare(b.kind),
  );

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      {review.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{t("combinedTitle")}</h2>
        {(canEditHoliday || canEditProgram) && (
          <div className="flex flex-wrap items-center gap-2">
            {canEditHoliday && (
              <Button
                disabled={holidayBlocked || !calendar.data || !!holidayEditor}
                onClick={() =>
                  setHolidayEditor({
                    group: null,
                    snapshot: calendar.data ?? [],
                  })
                }
              >
                {school("addHoliday")}
              </Button>
            )}
            {canEditProgram && (
              <Button
                disabled={!!query.error || !!removePreviewing || !!editor}
                onClick={() => setEditor({ day: null, snapshot: data.days })}
              >
                {t("add")}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="muted text-sm">{t("combinedHelp")}</p>
      {programDenied && (
        <InlineNotice tone="error" announcement="alert">
          {t("denied")}
        </InlineNotice>
      )}
      {!programDenied && query.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
          }
        >
          {t("loadFailed")}
        </InlineNotice>
      )}
      {schoolDenied && (
        <InlineNotice tone="error" announcement="alert">
          {school("denied")}
        </InlineNotice>
      )}
      {!schoolDenied && (
        <QueryFeedback
          hasData={calendar.data !== undefined}
          loading={calendar.data === undefined && !calendar.error}
          error={!!calendar.error || !!identity.error}
          retrying={calendar.isFetching || identity.isFetching}
          loadingTitle={school("loading")}
          errorTitle={school("loadFailed")}
          retryLabel={school("refresh")}
          onRetry={() =>
            void Promise.allSettled([identity.refetch(), calendar.refetch()])
          }
        />
      )}
      {holidayRecoveryNeeded && !holidayEditor && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              onClick={async () => {
                try {
                  await refreshSchoolCalendar();
                  setHolidayRecoveryNeeded(false);
                } catch {
                  /* Keep accepted-save recovery until all reads succeed. */
                }
              }}
            >
              {school("refresh")}
            </Button>
          }
        >
          {school("refreshFailed")}
        </InlineNotice>
      )}
      {removeError && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              disabled={removeRefreshing || !!removePreviewing}
              onClick={async () => {
                if (removeGuard.current) return;
                removeGuard.current = true;
                setRemoveRefreshing(true);
                try {
                  const result = await query.refetch();
                  if (result.isSuccess) setRemoveError(null);
                } catch {
                  // Keep the failed review visible until an explicit read succeeds.
                } finally {
                  removeGuard.current = false;
                  setRemoveRefreshing(false);
                }
              }}
            >
              {t("refresh")}
            </Button>
          }
        >
          {removeError}
        </InlineNotice>
      )}
      {rows.length > 0 ? (
        <SummaryTable sortable label={t("combinedTitle")}>
          <thead>
            <tr>
              <th className="whitespace-nowrap [&_.table-sort-button]:whitespace-nowrap">
                {t("date")}
              </th>
              <th className="whitespace-nowrap [&_.table-sort-button]:whitespace-nowrap">
                {t("schedulingEffect")}
              </th>
              <th className="whitespace-nowrap [&_.table-sort-button]:whitespace-nowrap">
                {t("reasonOrNote")}
              </th>
              <th className="table-actions-heading">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              if (entry.kind === "holiday") {
                const { group } = entry;
                const rowKey = `holiday:${group.from}:${group.to}`;
                const resetKey = `holiday-reset:${group.from}:${group.to}`;
                const dayCount = group.days.length;
                const previewNote =
                  group.note.length > 80
                    ? `${group.note.slice(0, 80)}…`
                    : group.note;
                return (
                  <tr key={rowKey}>
                    <td
                      className="whitespace-nowrap tabular-nums"
                      data-sort-value={group.from}
                    >
                      <CalendarRange date={group.from} endDate={group.to} />
                      <span className="muted ml-2 text-xs font-normal">
                        {school("holidayDaysCount", { count: dayCount })}
                      </span>
                    </td>
                    <td
                      className="whitespace-nowrap text-sm"
                      data-sort-value={t("holidayEffect")}
                    >
                      {t("holidayEffect")}
                    </td>
                    <td
                      data-sort-value={group.note}
                      className="max-w-[16rem] xl:max-w-[18rem]"
                    >
                      {previewNote ? (
                        <p className="truncate">{previewNote}</p>
                      ) : (
                        <span className="muted text-sm">
                          {school("noStaffNote")}
                        </span>
                      )}
                    </td>
                    <TableActions>
                      <TableDetails
                        title={`${school("holidayDetailsTitle")} · ${group.from}${group.to !== group.from ? ` ${t("through")} ${group.to}` : ""}`}
                        label={school("details")}
                      >
                        <div className="space-y-3">
                          <p>
                            <SchoolCalendarDate date={group.from} />
                            {group.to !== group.from && (
                              <>
                                {" "}
                                {t("through")}{" "}
                                <SchoolCalendarDate date={group.to} />
                              </>
                            )}
                            {" · "}
                            {school("holidayDaysCount", { count: dayCount })}
                            {" · "}
                            {school("noSchool")}
                          </p>
                          {group.note ? (
                            <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                              {group.note}
                            </p>
                          ) : (
                            <p className="muted text-sm">
                              {school("noStaffNote")}
                            </p>
                          )}
                          <p className="muted text-xs">
                            {school("staffNotePrivate")}
                          </p>
                          {dayCount > 1 && (
                            <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
                              {group.days.map((day) => (
                                <li key={day.date}>
                                  <SchoolCalendarDate date={day.date} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </TableDetails>
                      {canEditHoliday && (
                        <>
                          <TableAction
                            disabled={
                              holidayBlocked ||
                              !!holidayEditor ||
                              holidayAccepted(group)
                            }
                            onClick={() =>
                              setHolidayEditor({
                                group,
                                snapshot: calendar.data ?? [],
                              })
                            }
                          >
                            {school("edit")}
                          </TableAction>
                          <TableAction
                            className="lg:whitespace-nowrap"
                            disabled={
                              holidayBlocked ||
                              !!holidayEditor ||
                              holidayAccepted(group) ||
                              review.blocked(resetKey)
                            }
                            onClick={() =>
                              review.open({
                                key: resetKey,
                                title: school("resetHolidayTitle"),
                                description: school("resetHolidayHelp"),
                                confirmLabel: canApplyHoliday
                                  ? school("reset")
                                  : approvals("requestAdmin"),
                                confirmVariant: "primary",
                                details: (
                                  <div className="space-y-2">
                                    <p>
                                      <SchoolCalendarDate date={group.from} />
                                      {group.to !== group.from && (
                                        <>
                                          {" "}
                                          {t("through")}{" "}
                                          <SchoolCalendarDate date={group.to} />
                                        </>
                                      )}
                                      {" · "}
                                      {school("holidayDaysCount", {
                                        count: dayCount,
                                      })}
                                      {" · "}
                                      {school("noSchool")}
                                    </p>
                                    {group.note && (
                                      <p className="muted text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                                        {group.note}
                                      </p>
                                    )}
                                  </div>
                                ),
                                commit: () =>
                                  resetHoliday.mutateAsync({
                                    from: group.from,
                                    to: group.to,
                                    expectedVersions: group.days.map(
                                      (day) => ({
                                        date: day.date,
                                        version: day.version,
                                      }),
                                    ),
                                  }),
                                refresh: refreshSchoolCalendar,
                                approvalId: queuedApprovalId,
                                repeatAfterRefresh: true,
                              })
                            }
                          >
                            {school("reset")}
                          </TableAction>
                        </>
                      )}
                    </TableActions>
                  </tr>
                );
              }
              const { day } = entry;
              const effectLabel = t(
                day.schedulingEffect === "PAUSE_REGULAR"
                  ? "pauseEffectTable"
                  : "noticeEffectTable",
              );
              return (
                <tr key={`program:${day.date}`}>
                  <td
                    className="whitespace-nowrap tabular-nums"
                    data-sort-value={day.date}
                  >
                    <CalendarRange date={day.date} endDate={day.endDate} />
                  </td>
                  <td
                    className="whitespace-nowrap text-sm"
                    data-sort-value={effectLabel}
                  >
                    {effectLabel}
                  </td>
                  <td
                    data-sort-value={day.reason}
                    className="max-w-[16rem] xl:max-w-[18rem]"
                  >
                    {/* Single-line preview keeps rows unwrapped; full text stays in View details / Edit. */}
                    <p className="truncate">
                      {day.reason.length > 80
                        ? `${day.reason.slice(0, 80)}…`
                        : day.reason}
                    </p>
                  </td>
                  <TableActions>
                    <TableDetails
                      title={`${t("title")} · ${day.date}${day.endDate !== day.date ? ` ${t("through")} ${day.endDate}` : ""}`}
                      label={t("details")}
                    >
                      <div className="space-y-3">
                        <p>
                          <CalendarRange
                            date={day.date}
                            endDate={day.endDate}
                          />{" "}
                          · {effectLabel}
                        </p>
                        <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                          {day.reason}
                        </p>
                      </div>
                    </TableDetails>
                    {canEditProgram && (
                      <>
                        <TableAction
                          disabled={!!query.error || !!removePreviewing}
                          onClick={() =>
                            setEditor({ day, snapshot: data.days })
                          }
                        >
                          {t("edit")}
                        </TableAction>
                        <TableAction
                          disabled={
                            !!query.error ||
                            !!removePreviewing ||
                            review.blocked(day.date)
                          }
                          onClick={async () => {
                            if (removeGuard.current) return;
                            removeGuard.current = true;
                            setRemovePreviewing(day.date);
                            setRemoveError(null);
                            const previewing =
                              day.schedulingEffect === "PAUSE_REGULAR";
                            try {
                              const removalImpact = previewing
                                ? await utils.program.calendarImpact.fetch(
                                    {
                                      date: day.date,
                                      endDate: day.endDate,
                                      expectedVersion: day.version,
                                      remove: true,
                                    },
                                    { staleTime: 0 },
                                  )
                                : null;
                              review.open({
                                key: day.date,
                                title: t("removeTitle"),
                                description: t(
                                  day.schedulingEffect === "PAUSE_REGULAR"
                                    ? "removePauseHelp"
                                    : "removeHelp",
                                ),
                                confirmLabel: t("remove"),
                                details: (
                                  <div className="space-y-2">
                                    <p>
                                      <CalendarRange
                                        date={day.date}
                                        endDate={day.endDate}
                                      />{" "}
                                      · {day.reason}
                                    </p>
                                    {removalImpact && (
                                      <>
                                        <p>{t("impactScope")}</p>
                                        <p>
                                          {t("impactRestore", {
                                            count:
                                              removalImpact.restorationCount,
                                          })}
                                        </p>
                                        <p>{t("impactRule")}</p>
                                      </>
                                    )}
                                  </div>
                                ),
                                commit: () =>
                                  remove.mutateAsync({
                                    date: day.date,
                                    expectedVersion: day.version,
                                  }),
                                refresh: () =>
                                  settleRefreshes([
                                    () =>
                                      invalidateAndReport(
                                        utils.program.calendarSettings,
                                      ),
                                    () =>
                                      invalidateAndReport(
                                        utils.program.calendar,
                                      ),
                                    async () => {
                                      await utils.sessionPlanning?.invalidate();
                                    },
                                  ]),
                                approvalId: queuedApprovalId,
                                repeatAfterRefresh: true,
                              });
                            } catch (failure) {
                              setRemoveError(
                                previewing
                                  ? t(
                                      impactConflict(failure)
                                        ? "impactConflict"
                                        : "impactFailed",
                                    )
                                  : failure instanceof Error
                                    ? failure.message
                                    : t("loadFailed"),
                              );
                            } finally {
                              removeGuard.current = false;
                              setRemovePreviewing(null);
                            }
                          }}
                        >
                          {t("remove")}
                        </TableAction>
                      </>
                    )}
                  </TableActions>
                </tr>
              );
            })}
          </tbody>
        </SummaryTable>
      ) : (
        <p className="muted">{t("combinedEmpty")}</p>
      )}
      {editor && (
        <ProfileDialog
          title={t(editor.day ? "edit" : "add")}
          onClose={() => setEditor(null)}
        >
          <CalendarEditor
            key={generation}
            initial={editor.day}
            snapshot={editor.snapshot}
            canApply={canApplyProgram}
            disabled={!!query.error || !canEditProgram}
            onReload={async () => {
              const result = await query.refetch();
              if (!result.isSuccess)
                throw new Error(result.error?.message ?? t("loadFailed"));
              setEditor({
                day: editor.day
                  ? (result.data.days.find(
                      (day) => day.date === editor.day?.date,
                    ) ?? null)
                  : null,
                snapshot: result.data.days,
              });
              setGeneration((value) => value + 1);
            }}
          />
        </ProfileDialog>
      )}
      {holidayEditor && canEditHoliday && (
        <ProfileDialog
          title={school(holidayEditor.group ? "editHoliday" : "addHoliday")}
          onClose={() => setHolidayEditor(null)}
        >
          <SchoolHolidayEditor
            initial={holidayEditor.group}
            snapshot={holidayEditor.snapshot}
            canApply={canApplyHoliday}
            disabled={holidayBlocked}
            onRefresh={refreshSchoolCalendar}
            onAccepted={(date, version) =>
              setAcceptedHolidayVersions((current) =>
                new Set(current).add(`${date}:${version}`),
              )
            }
            acceptedVersions={acceptedHolidayVersions}
            onRecovery={setHolidayRecoveryNeeded}
            onReload={async () => {
              const result = await calendar.refetch();
              if (!result.isSuccess) throw new Error(school("loadFailed"));
              const fresh = result.data;
              const group = holidayEditor.group;
              if (!group) {
                setHolidayEditor({ group: null, snapshot: fresh });
                return true;
              }
              const originalDates = schoolCalendarRangeDates(
                group.from,
                group.to,
              );
              const stillClosed = originalDates.every((date) => {
                const row = fresh.find((day) => day.date === date);
                return !!row?.active && !row.isSchoolDay;
              });
              setHolidayEditor({
                group: stillClosed ? group : holidayEditor.group,
                snapshot: fresh,
              });
              return stillClosed;
            }}
          />
        </ProfileDialog>
      )}
    </section>
  );
}

/** The version snapshot belongs to this independent draft. Accepted saves recover through reads only. */
function CalendarEditor({
  initial,
  snapshot,
  canApply,
  disabled,
  onReload,
}: {
  initial: ProgramDay | null;
  snapshot: ProgramDay[];
  canApply: boolean;
  disabled: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("programCalendar");
  const approvals = useTranslations("approvals");
  const utils = api.useUtils();
  const [date, setDate] = useState(initial?.date ?? "");
  const [endDate, setEndDate] = useState(
    initial?.endDate ?? initial?.date ?? "",
  );
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [schedulingEffect, setSchedulingEffect] = useState<
    "NOTICE" | "PAUSE_REGULAR"
  >(
    // New no-tutoring ranges affect schedules; editing a legacy notice preserves its meaning.
    !initial || initial.schedulingEffect === "PAUSE_REGULAR"
      ? "PAUSE_REGULAR"
      : "NOTICE",
  );
  const effectHelpId = useId();
  const [impact, setImpact] = useState<{
    pauseCount: number;
    retainedExceptionCount: number;
    confirmationCount: number;
    restorationCount: number;
  } | null>(null);
  const needsReview =
    schedulingEffect === "PAUSE_REGULAR" ||
    initial?.schedulingEffect === "PAUSE_REGULAR";
  const expectedVersion =
    initial?.version ??
    snapshot.find((day) => day.date === date && !day.active)?.version ??
    0;
  const [readFailed, setReadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewConflict, setPreviewConflict] = useState(false);
  const admitted = useRef(false);
  const committed = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const save = api.program.setCalendarDay.useMutation();
  const pending = useDialogPending(save.isPending || readPending);
  const sync = async () => {
    setReadPending(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.program.calendarSettings),
        () => invalidateAndReport(utils.program.calendar),
        async () => {
          await utils.sessionPlanning?.invalidate();
        },
      ]);
      setReadFailed(false);
    } catch {
      setReadFailed(true);
    } finally {
      setReadPending(false);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          disabled ||
          pending ||
          admitted.current ||
          committed.current ||
          previewConflict
        )
          return;
        admitted.current = true;
        setError(null);
        const previewing = needsReview && !impact;
        try {
          if (previewing) {
            setReadPending(true);
            const reviewed = await utils.program.calendarImpact.fetch(
              {
                date,
                endDate,
                schedulingEffect,
                expectedVersion,
              },
              { staleTime: 0 },
            );
            setImpact(reviewed);
            return;
          }
          await save.mutateAsync({
            date,
            endDate,
            reason,
            schedulingEffect,
            expectedVersion,
          });
          committed.current = true;
          setAccepted(true);
          setSaved(true);
          await sync();
        } catch (failure) {
          if (previewing) {
            const conflict = impactConflict(failure);
            setPreviewConflict(conflict);
            setError(t(conflict ? "impactConflict" : "impactFailed"));
          } else if (!queuedApprovalId(failure))
            setError(
              failure instanceof Error ? failure.message : t("saveFailed"),
            );
          else {
            committed.current = true;
            setAccepted(true);
          }
        } finally {
          admitted.current = false;
          setReadPending(false);
        }
      }}
    >
      <fieldset
        disabled={disabled || pending || accepted}
        className="min-w-0 space-y-4"
      >
        <p className="muted text-sm">{t("rangeHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="label">{t("startDate")}</span>
            <input
              className="input w-full"
              type="date"
              required
              value={date}
              disabled={!!initial}
              onChange={(event) => {
                // A new single-day draft follows its start until the user extends its end.
                if (!endDate || endDate === date)
                  setEndDate(event.target.value);
                setDate(event.target.value);
                setImpact(null);
              }}
            />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("endDate")}</span>
            <input
              className="input w-full"
              type="date"
              required
              min={date || undefined}
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setImpact(null);
              }}
            />
          </label>
        </div>
        <label className="block">
          <span className="label">{t("schedulingEffect")}</span>
          <select
            className="input w-full"
            value={schedulingEffect}
            aria-describedby={effectHelpId}
            onChange={(event) => {
              setSchedulingEffect(
                event.target.value as "NOTICE" | "PAUSE_REGULAR",
              );
              setImpact(null);
            }}
          >
            <option value="NOTICE">{t("noticeEffect")}</option>
            <option value="PAUSE_REGULAR">{t("pauseEffect")}</option>
          </select>
          <span id={effectHelpId} className="muted mt-1 block text-sm">
            {t(
              schedulingEffect === "PAUSE_REGULAR"
                ? "pauseHelp"
                : "noticeHelp",
            )}
          </span>
        </label>
        <label className="block">
          <span className="label">{t("reason")}</span>
          <textarea
            className="input min-h-24 w-full"
            required
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setImpact(null);
            }}
          />
        </label>
        {impact && (
          <InlineNotice tone="warning" announcement="status">
            <p className="font-medium">{t("impactTitle")}</p>
            <p>{t("impactScope")}</p>
            <ul className="mt-2 list-disc pl-5">
              <li>{t("impactPause", { count: impact.pauseCount })}</li>
              <li>
                {t("impactRetain", { count: impact.retainedExceptionCount })}
              </li>
              <li>
                {t("impactConfirm", { count: impact.confirmationCount })}
              </li>
              <li>
                {t("impactRestore", { count: impact.restorationCount })}
              </li>
            </ul>
            <p className="mt-2">{t("impactRule")}</p>
          </InlineNotice>
        )}
        <FormActions>
          <Button type="submit" variant="primary" disabled={previewConflict}>
            {pending
              ? t("saving")
              : needsReview && !impact
                ? t("reviewImpact")
                : canApply
                  ? t("save")
                  : approvals("requestAdmin")}
          </Button>
        </FormActions>
      </fieldset>
      {saved && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
      {save.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {approvals("queuedBody")}
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error" announcement="alert">
          {error}
        </InlineNotice>
      )}
      {readFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={pending} onClick={() => void sync()}>
              {t("refresh")}
            </Button>
          }
        >
          {t("refreshFailed")}
        </InlineNotice>
      )}
      {!accepted &&
        (previewConflict || save.error?.data?.code === "CONFLICT") && (
          <Button
            disabled={pending}
            onClick={async () => {
              setReadPending(true);
              try {
                await onReload();
              } catch {
                setError(
                  t(previewConflict ? "impactConflict" : "loadFailed"),
                );
              } finally {
                setReadPending(false);
              }
            }}
          >
            {t("reload")}
          </Button>
        )}
    </form>
  );
}
