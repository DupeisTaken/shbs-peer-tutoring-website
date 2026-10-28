"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { formatWeekday } from "~/lib/time";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { ProfileDialog } from "./profile-dialog";
import { useSessionAccessDenied } from "./session-view-state";
import { useActionReview } from "./ui/action-review";
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

type Day = RouterOutputs["student"]["calendar"][number];

/** A school date is a label: UTC formatting preserves it in every program zone. */
export function SchoolCalendarDate({ date }: { date: string }) {
  const format = useFormatter();
  return (
    <time dateTime={date}>
      {format.dateTime(new Date(`${date}T00:00:00Z`), {
        dateStyle: "full",
        timeZone: "UTC",
      })}
    </time>
  );
}

export function SchoolCalendar() {
  const t = useTranslations("schoolCalendar");
  const approvals = useTranslations("approvals");
  const locale = useLocale();
  const identity = api.account.me.useQuery();
  const calendar = api.student.calendar.useQuery();
  const utils = api.useUtils();
  const reset = api.student.resetCalendarDay.useMutation();
  const review = useActionReview();
  const revokeReview = review.revoke;
  const denied = useSessionAccessDenied(identity, calendar);
  const canEdit =
    !identity.error &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(identity.data?.role ?? "");
  const canApply = ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  const [editor, setEditor] = useState<{
    day: Day | null;
    snapshot: Day[];
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [acceptedVersions, setAcceptedVersions] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  useEffect(() => {
    if (denied) revokeReview();
  }, [denied, revokeReview]);
  const refresh = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.student.calendar),
      () => invalidateAndReport(utils.program.schoolCalendar),
    ]);
  const blocked =
    !!calendar.error ||
    !!identity.error ||
    recoveryNeeded ||
    review.blocked("calendar");
  const acceptedVersion = (day: Day) =>
    acceptedVersions.has(`${day.date}:${day.version}`);
  const description = (day: Day) =>
    day.isSchoolDay
      ? t("follows", {
          weekday: formatWeekday(
            day.timetableWeekday ??
              (new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7),
            locale,
          ),
        })
      : t("noSchool");
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{t("title")}</h2>
        {canEdit && !denied && (
          <Button
            disabled={blocked || !calendar.data || !!editor}
            onClick={() =>
              setEditor({ day: null, snapshot: calendar.data ?? [] })
            }
          >
            {t("add")}
          </Button>
        )}
      </div>
      <p className="muted text-sm">{t("help")}</p>
      <p className="muted text-sm">{t("noticeDistinction")}</p>
      {denied ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              onClick={() =>
                void Promise.allSettled([
                  identity.refetch(),
                  calendar.refetch(),
                ])
              }
            >
              {t("refresh")}
            </Button>
          }
        />
      ) : (
        <>
          <QueryFeedback
            hasData={calendar.data !== undefined}
            loading={!calendar.data}
            error={!!calendar.error || !!identity.error}
            retrying={calendar.isFetching || identity.isFetching}
            loadingTitle={t("loading")}
            errorTitle={t("loadFailed")}
            retryLabel={t("refresh")}
            onRetry={() =>
              void Promise.allSettled([identity.refetch(), calendar.refetch()])
            }
          />
          {recoveryNeeded && !editor && (
            <InlineNotice
              tone="error"
              announcement="alert"
              action={
                <Button
                  onClick={async () => {
                    try {
                      await refresh();
                      setRecoveryNeeded(false);
                    } catch {
                      /* Keep accepted-save recovery until all reads succeed. */
                    }
                  }}
                >
                  {t("refresh")}
                </Button>
              }
            >
              {t("refreshFailed")}
            </InlineNotice>
          )}
          {calendar.data &&
            (calendar.data.some((day) => day.active) ? (
              <SummaryTable label={t("title")} sortable>
                <thead>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("timetable")}</th>
                    <th className="table-actions-heading">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.data
                    .filter((day) => day.active)
                    .map((day) => (
                      <tr key={day.date}>
                        <td data-sort-value={day.date}>
                          <SchoolCalendarDate date={day.date} />
                        </td>
                        <td>{description(day)}</td>
                        <TableActions>
                          <TableDetails
                            title={`${t("title")} · ${day.date}`}
                            label={t("details")}
                          >
                            <p>
                              <SchoolCalendarDate date={day.date} /> ·{" "}
                              {description(day)}
                            </p>
                            {day.note && (
                              <p className="mt-3 [overflow-wrap:anywhere] whitespace-pre-wrap">
                                {day.note}
                              </p>
                            )}
                          </TableDetails>
                          {canEdit && (
                            <>
                              <TableAction
                                disabled={
                                  blocked || !!editor || acceptedVersion(day)
                                }
                                onClick={() =>
                                  setEditor({
                                    day,
                                    snapshot: calendar.data ?? [],
                                  })
                                }
                              >
                                {t("edit")}
                              </TableAction>
                              <TableAction
                                disabled={
                                  blocked ||
                                  !!editor ||
                                  acceptedVersion(day) ||
                                  review.blocked(day.date)
                                }
                                onClick={() =>
                                  review.open({
                                    key: day.date,
                                    title: t("resetTitle"),
                                    description: t("resetHelp"),
                                    confirmLabel: canApply
                                      ? t("reset")
                                      : approvals("requestAdmin"),
                                    confirmVariant: "primary",
                                    details: (
                                      <p>
                                        <SchoolCalendarDate date={day.date} /> ·{" "}
                                        {description(day)}
                                      </p>
                                    ),
                                    commit: () =>
                                      reset.mutateAsync({
                                        date: day.date,
                                        expectedVersion: day.version,
                                      }),
                                    refresh,
                                    approvalId: queuedApprovalId,
                                    repeatAfterRefresh: true,
                                  })
                                }
                              >
                                {t("reset")}
                              </TableAction>
                            </>
                          )}
                        </TableActions>
                      </tr>
                    ))}
                </tbody>
              </SummaryTable>
            ) : (
              <p className="muted">{t("empty")}</p>
            ))}
          {review.dialog}
          {editor && canEdit && (
            <ProfileDialog
              title={t(editor.day ? "edit" : "add")}
              onClose={() => setEditor(null)}
            >
              <SchoolDayEditor
                key={generation}
                initial={editor.day}
                snapshot={editor.snapshot}
                canApply={canApply}
                disabled={blocked}
                onRefresh={refresh}
                onAccepted={(date, version) =>
                  setAcceptedVersions((current) =>
                    new Set(current).add(`${date}:${version}`),
                  )
                }
                acceptedVersions={acceptedVersions}
                onRecovery={setRecoveryNeeded}
                onReload={async (date) => {
                  const result = await calendar.refetch();
                  if (!result.isSuccess) throw new Error(t("loadFailed"));
                  setEditor({
                    day: result.data.find((day) => day.date === date) ?? null,
                    snapshot: result.data,
                  });
                  setGeneration((value) => value + 1);
                }}
              />
            </ProfileDialog>
          )}
        </>
      )}
    </section>
  );
}

/** Keep the draft's version fixed until explicit Reload; an accepted write only retries reads. */
function SchoolDayEditor({
  initial,
  snapshot,
  canApply,
  disabled,
  onRefresh,
  onReload,
  onAccepted,
  onRecovery,
  acceptedVersions,
}: {
  initial: Day | null;
  snapshot: Day[];
  canApply: boolean;
  disabled: boolean;
  onRefresh: () => Promise<unknown>;
  onReload: (date: string) => Promise<void>;
  onAccepted: (date: string, version: number) => void;
  onRecovery: (needed: boolean) => void;
  acceptedVersions: ReadonlySet<string>;
}) {
  const t = useTranslations("schoolCalendar");
  const approvals = useTranslations("approvals");
  const locale = useLocale();
  const save = api.student.setCalendarDay.useMutation();
  const [date, setDate] = useState(initial?.date ?? "");
  const [schoolDay, setSchoolDay] = useState(
    initial?.active ? initial.isSchoolDay : true,
  );
  const [weekday, setWeekday] = useState(
    initial?.active ? String(initial.timetableWeekday ?? "") : "",
  );
  const [note, setNote] = useState(initial?.active ? (initial.note ?? "") : "");
  const [accepted, setAccepted] = useState<"saved" | "queued" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const admitted = useRef(false);
  const committed = useRef(false);
  const pending = useDialogPending(working || save.isPending);
  const expectedVersion =
    initial?.version ??
    snapshot.find((day) => day.date === date && !day.active)?.version ??
    0;
  const alreadyAccepted = acceptedVersions.has(`${date}:${expectedVersion}`);
  async function sync() {
    setWorking(true);
    try {
      await onRefresh();
      setReadFailed(false);
      onRecovery(false);
    } catch {
      setReadFailed(true);
      onRecovery(true);
    } finally {
      setWorking(false);
    }
  }
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
          alreadyAccepted ||
          conflict
        )
          return;
        admitted.current = true;
        setWorking(true);
        setError(null);
        try {
          await save.mutateAsync({
            date,
            isSchoolDay: schoolDay,
            timetableWeekday: schoolDay && weekday ? Number(weekday) : null,
            note,
            expectedVersion,
          });
          committed.current = true;
          setAccepted("saved");
          onAccepted(date, expectedVersion);
          await sync();
        } catch (failure) {
          if (queuedApprovalId(failure)) {
            committed.current = true;
            setAccepted("queued");
            onAccepted(date, expectedVersion);
          } else {
            setError(
              failure instanceof Error ? failure.message : t("saveFailed"),
            );
            if (
              typeof failure === "object" &&
              failure &&
              "data" in failure &&
              typeof failure.data === "object" &&
              failure.data &&
              "code" in failure.data &&
              failure.data.code === "CONFLICT"
            )
              setConflict(true);
          }
        } finally {
          admitted.current = false;
          setWorking(false);
        }
      }}
    >
      <fieldset
        disabled={disabled || pending || !!accepted}
        className="min-w-0 space-y-4"
        aria-busy={pending}
      >
        <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
        <label className="block">
          <span className="label">{t("date")}</span>
          <input
            className="input w-full"
            type="date"
            required
            disabled={!!initial}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        {date && (
          <p className="text-sm">
            <SchoolCalendarDate date={date} />
          </p>
        )}
        <label className="block">
          <span className="label">{t("schoolStatus")}</span>
          <select
            className="select w-full"
            value={schoolDay ? "school" : "closed"}
            onChange={(event) => setSchoolDay(event.target.value === "school")}
          >
            <option value="school">{t("schoolDay")}</option>
            <option value="closed">{t("noSchool")}</option>
          </select>
        </label>
        {schoolDay && (
          <div>
            <label className="label" htmlFor="school-calendar-weekday">
              {t("timetable")}
            </label>
            <select
              id="school-calendar-weekday"
              className="select w-full"
              aria-describedby="school-calendar-weekday-help"
              value={weekday}
              onChange={(event) => setWeekday(event.target.value)}
            >
              <option value="">{t("civilWeekday")}</option>
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <option key={day} value={day}>
                  {formatWeekday(day, locale)}
                </option>
              ))}
            </select>
            <span
              id="school-calendar-weekday-help"
              className="muted mt-1 block text-sm"
            >
              {t("timetableHelp")}
            </span>
          </div>
        )}
        <label className="block">
          <span className="label">{t("note")}</span>
          <textarea
            className="input min-h-24 w-full"
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="muted text-sm">{t("agreementWarning")}</p>
        <FormActions>
          <Button
            type="submit"
            variant="primary"
            disabled={conflict || alreadyAccepted}
          >
            {pending
              ? t("saving")
              : canApply
                ? t("save")
                : approvals("requestAdmin")}
          </Button>
        </FormActions>
      </fieldset>
      {accepted && (
        <InlineNotice
          tone={accepted === "saved" ? "success" : "warning"}
          announcement="status"
        >
          {accepted === "saved" ? t("saved") : approvals("queuedBody")}
        </InlineNotice>
      )}
      {alreadyAccepted && !accepted && (
        <InlineNotice tone="warning" announcement="status">
          {t("alreadySubmitted")}
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error" announcement="alert">
          {error}
        </InlineNotice>
      )}
      {conflict && !accepted && (
        <Button
          disabled={pending}
          onClick={async () => {
            setWorking(true);
            try {
              await onReload(date);
            } catch {
              setError(t("loadFailed"));
            } finally {
              setWorking(false);
            }
          }}
        >
          {t("reload")}
        </Button>
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
    </form>
  );
}
