"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
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

type Day = {
  date: string;
  endDate: string;
  reason: string;
  active: boolean;
  version: number;
};

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
/** Participant schedules consume this read-only context; it cannot affect attendance validity. */
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
            </li>
          ))}
      </ul>
    </section>
  );
}
export function ProgramCalendarSettings() {
  const t = useTranslations("programCalendar");
  const query = api.program.calendarSettings.useQuery();
  const utils = api.useUtils();
  const review = useActionReview();
  const remove = api.program.removeCalendarDay.useMutation();
  const [editor, setEditor] = useState<{
    day: Day | null;
    snapshot: Day[];
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  if (!query.data)
    return (
      <section className="card p-5">
        <StatePanel
          kind={query.error ? "error" : "loading"}
          title={t(query.error ? "loadFailed" : "loading")}
          action={
            query.error && (
              <Button onClick={() => void query.refetch()}>
                {t("refresh")}
              </Button>
            )
          }
        />
      </section>
    );
  const data = query.data;
  return (
    <section className="card space-y-4 p-5">
      {review.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 text-sm">{t("informational")}</p>
        </div>
        {data.canEdit && (
          <Button
            disabled={!!query.error}
            onClick={() => setEditor({ day: null, snapshot: data.days })}
          >
            {t("add")}
          </Button>
        )}
      </div>
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
      {data.days.some((day) => day.active) ? (
        <SummaryTable sortable label={t("title")}>
          <thead>
            <tr>
              <th>{t("date")}</th>
              <th>{t("reason")}</th>
              <th className="table-actions-heading">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.days
              .filter((day) => day.active)
              .map((day) => (
                <tr key={day.date}>
                  <td
                    className="whitespace-nowrap tabular-nums"
                    data-sort-value={day.date}
                  >
                    <CalendarRange date={day.date} endDate={day.endDate} />
                  </td>
                  <td
                    data-sort-value={day.reason}
                    className="max-w-sm break-words"
                  >
                    {/* A brief preview keeps the summary compact; full source remains in Details/edit. */}
                    <p className="line-clamp-2">
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
                      <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                        {day.reason}
                      </p>
                    </TableDetails>
                    {data.canEdit && (
                      <>
                        <TableAction
                          disabled={!!query.error}
                          onClick={() =>
                            setEditor({ day, snapshot: data.days })
                          }
                        >
                          {t("edit")}
                        </TableAction>
                        <TableAction
                          disabled={!!query.error || review.blocked(day.date)}
                          onClick={() =>
                            review.open({
                              key: day.date,
                              title: t("removeTitle"),
                              description: t("removeHelp"),
                              confirmLabel: t("remove"),
                              details: (
                                <p>
                                  <CalendarRange
                                    date={day.date}
                                    endDate={day.endDate}
                                  />{" "}
                                  · {day.reason}
                                </p>
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
                                    invalidateAndReport(utils.program.calendar),
                                ]),
                              approvalId: queuedApprovalId,
                              repeatAfterRefresh: true,
                            })
                          }
                        >
                          {t("remove")}
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
            canApply={data.canApply}
            disabled={!!query.error || !data.canEdit}
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
  initial: Day | null;
  snapshot: Day[];
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
  const [readFailed, setReadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        if (disabled || pending || admitted.current || committed.current)
          return;
        admitted.current = true;
        setError(null);
        try {
          await save.mutateAsync({
            date,
            endDate,
            reason,
            expectedVersion:
              initial?.version ??
              snapshot.find((day) => day.date === date && !day.active)
                ?.version ??
              0,
          });
          committed.current = true;
          setAccepted(true);
          setSaved(true);
          await sync();
        } catch (failure) {
          if (!queuedApprovalId(failure))
            setError(
              failure instanceof Error ? failure.message : t("saveFailed"),
            );
          else {
            committed.current = true;
            setAccepted(true);
          }
        } finally {
          admitted.current = false;
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
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="label">{t("reason")}</span>
          <textarea
            className="input min-h-24 w-full"
            required
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <FormActions>
          <Button type="submit" variant="primary">
            {pending
              ? t("saving")
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
      {!accepted && save.error?.data?.code === "CONFLICT" && (
        <Button
          disabled={pending}
          onClick={async () => {
            setReadPending(true);
            try {
              await onReload();
            } catch {
              setError(t("loadFailed"));
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
