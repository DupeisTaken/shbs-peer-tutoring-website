"use client";
import { invalidateWorkloads } from "~/lib/workload-cache";

import { DismissibleNotice } from "~/app/_components/dismissible-notice";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { formatWeekday, hmToMin, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
} from "~/app/_components/ui/summary-table";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { Modal } from "~/app/_components/ui/modal";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { InlineNotice } from "~/app/_components/ui/patterns";

const EMPTY = { label: "", dayOfWeek: 1, startTime: "15:30", endTime: "16:30" };

type SlotDraft = typeof EMPTY & { id: string; active: boolean };

export default function TimeSlotsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const slots = api.admin.timeSlots.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
    enabled: !denied,
  });
  const accessDenied =
    slots.error?.data?.code === "FORBIDDEN" ||
    slots.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.timeSlots, undefined, "query"),
      });
    } else if (slots.isSuccess && !slots.isFetching) setDenied(false);
  }, [accessDenied, slots.isSuccess, slots.isFetching, queryClient]);
  const readBlocked = slots.data === undefined || !!slots.error;
  useSessionPageScroll({
    id: "time-slots-v1",
    ready: slots.data !== undefined,
    enabled: !denied && !accessDenied,
  });
  const section = t("admin.timeslots.title");
  const readFeedback = (
    <QueryFeedback
      hasData={slots.data !== undefined}
      loading={slots.data === undefined && !slots.error}
      error={!!slots.error}
      retrying={slots.isFetching}
      loadingTitle={t("managementRecovery.loading", { section })}
      errorTitle={t(
        slots.data === undefined
          ? "managementRecovery.loadFailed"
          : "managementRecovery.refreshFailed",
        { section },
      )}
      retryLabel={t("managementRecovery.retry", { section })}
      onRetry={() => void slots.refetch()}
    />
  );
  const [form, setForm] = useState(EMPTY);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SlotDraft | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [synchronizing, setSynchronizing] = useState(false);
  const admitted = useRef(false);
  const acceptedTarget = useRef<"create" | "edit" | null>(null);

  const invalidate = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.admin.timeSlots),
      () => invalidateAndReport(utils.admin.pairings),
      () => invalidateAndReport(utils.tutor.myPairings),
      () => invalidateAndReport(utils.tutor.schedule),
      () => invalidateAndReport(utils.student.me),
      () => invalidateAndReport(utils.notification.list),
      () => invalidateAndReport(utils.notification.unreadCount),
      () => invalidateAndReport(utils.studentWorkflow.mine),
      () => invalidateAndReport(utils.pairingGroups.mine),
      () => invalidateWorkloads(utils, true),
    ]);
  // Catalogue edits can allocate several rooms. An accepted write must never
  // be retried merely because one of its authorized schedule readers failed.
  const recover = async () => {
    setSynchronizing(true);
    try {
      await invalidate();
      setRefreshFailed(false);
      if (acceptedTarget.current === "create") {
        setForm(EMPTY);
        setCreateOpen(false);
      } else if (acceptedTarget.current === "edit") setEditing(null);
      acceptedTarget.current = null;
    } catch {
      setRefreshFailed(true);
    } finally {
      setSynchronizing(false);
    }
  };
  const create = api.admin.createTimeSlot.useMutation({
    onSuccess: async () => {
      acceptedTarget.current = "create";
      await recover();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const update = api.admin.updateTimeSlot.useMutation({
    onSuccess: async () => {
      acceptedTarget.current = "edit";
      await recover();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const del = api.admin.deleteTimeSlot.useMutation();
  const review = useActionReview();
  const blocked =
    readBlocked ||
    synchronizing ||
    refreshFailed ||
    create.isPending ||
    update.isPending;
  const proposalId = queuedApprovalId(create.error ?? update.error);
  const editingIsValid =
    editing !== null &&
    editing.label.trim().length > 0 &&
    hmToMin(editing.endTime) > hmToMin(editing.startTime);
  const syncFeedback = refreshFailed && (
    <InlineNotice
      tone="warning"
      announcement="status"
      action={
        <Button disabled={synchronizing} onClick={() => void recover()}>
          {t("roomAllocation.retryRefresh")}
        </Button>
      }
    >
      {t("roomAllocation.savedRefreshFailed")}
    </InlineNotice>
  );
  if (denied || accessDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{section}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", { section })}
          action={
            <Button
              size="compact"
              disabled={slots.isFetching}
              onClick={() => void slots.refetch()}
            >
              {t("managementRecovery.retry", { section })}
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="space-y-6">
      {!readOnly && review.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.timeslots.title")}</h1>
        {!readOnly && (
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => setCreateOpen(true)}
          >
            {t("admin.timeslots.addSlot")}
          </Button>
        )}
        <p className="muted mt-1 basis-full">
          {t("admin.timeslots.description")}
        </p>
      </div>
      {!createOpen && !editing && syncFeedback}

      {proposalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}{" "}
          <Link
            className="link"
            href={`/admin/approvals?request=${encodeURIComponent(proposalId)}`}
          >
            {t("approvals.viewRequest")}
          </Link>
        </InlineNotice>
      )}
      {readFeedback}

      {
        <DismissibleNotice
          noticeId="time-slot-propagation-v1"
          title={t("admin.timeslots.propagationTitle")}
          helpLabel={t("admin.timeslots.reopenHelp")}
          dismissLabel={t("approvals.dismiss")}
        >
          <p className="mt-0.5 text-sky-800">
            {t("admin.timeslots.propagationNote")}
          </p>
        </DismissibleNotice>
      }

      {!readOnly && createOpen && (
        <ProfileDialog
          title={t("admin.timeslots.addSlot")}
          pending={create.isPending}
          onClose={() => setCreateOpen(false)}
        >
          {syncFeedback}
          <form
            className="card flex flex-wrap items-end gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (readOnly || blocked || admitted.current || !form.label.trim())
                return;
              admitted.current = true;
              create.mutate({
                label: form.label.trim(),
                dayOfWeek: form.dayOfWeek,
                startMin: hmToMin(form.startTime),
                endMin: hmToMin(form.endTime),
              });
            }}
          >
            <fieldset disabled={blocked} className="contents">
              <label className="space-y-1">
                <span className="label">{t("admin.timeslots.label")}</span>
                <input
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder={t("admin.timeslots.labelPlaceholder")}
                  className="input field-auto min-w-44"
                />
              </label>
              <label className="space-y-1">
                <span className="label">{t("admin.timeslots.day")}</span>
                <select
                  value={form.dayOfWeek}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dayOfWeek: Number(e.target.value),
                    }))
                  }
                  className="select field-auto min-w-32"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {formatWeekday(d, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="label">{t("admin.timeslots.start")}</span>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startTime: e.target.value }))
                  }
                  className="input field-auto min-w-28"
                />
              </label>
              <label className="space-y-1">
                <span className="label">{t("admin.timeslots.end")}</span>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endTime: e.target.value }))
                  }
                  className="input field-auto min-w-28"
                />
              </label>
              <button
                className="btn-primary"
                disabled={blocked || !form.label.trim()}
              >
                {t("admin.timeslots.addSlot")}
              </button>
            </fieldset>
          </form>
        </ProfileDialog>
      )}
      {!readOnly && !proposalId && (create.error ?? update.error) && (
        <p className="text-sm text-red-600">
          {(create.error ?? update.error)?.message}
        </p>
      )}

      <div className="card overflow-hidden">
        <SummaryTable sortable label={t("admin.timeslots.title")}>
          <thead>
            <tr>
              <th>{t("admin.timeslots.colLabel")}</th>
              <th>{t("admin.timeslots.colDay")}</th>
              <th>{t("admin.timeslots.colTime")}</th>
              <th>{t("admin.timeslots.colActive")}</th>
              {!readOnly && (
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(slots.data ?? []).map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-slate-900">{s.label}</td>
                <td data-sort-value={s.dayOfWeek}>
                  {formatWeekday(s.dayOfWeek, locale)}
                </td>
                <td
                  data-sort-value={s.startMin * 1441 + s.endMin}
                  className="font-mono text-slate-700"
                >
                  {minToHm(s.startMin)}–{minToHm(s.endMin)}
                </td>
                <td>
                  {t(
                    s.active
                      ? "courseCatalogue.active"
                      : "courseCatalogue.inactive",
                  )}
                </td>
                {!readOnly && (
                  <TableActions>
                    {!readOnly && (
                      <>
                        <TableAction
                          aria-label={`${t("admin.timeslots.edit")}: ${s.label}`}
                          disabled={blocked}
                          onClick={() => {
                            update.reset();
                            setEditing({
                              id: s.id,
                              label: s.label,
                              dayOfWeek: s.dayOfWeek,
                              startTime: minToHm(s.startMin),
                              endTime: minToHm(s.endMin),
                              active: s.active,
                            });
                          }}
                        >
                          {t("admin.timeslots.edit")}
                        </TableAction>
                        <TableAction
                          className="text-red-700"
                          disabled={blocked || review.blocked(s.id)}
                          onClick={() => {
                            if (
                              admitted.current ||
                              blocked ||
                              readOnly ||
                              review.blocked(s.id)
                            )
                              return;
                            review.open({
                              key: s.id,
                              title: t("actionReview.slotTitle", {
                                name: s.label,
                              }),
                              description: t("actionReview.slotHelp"),
                              confirmLabel: t("admin.timeslots.delete"),
                              details: (
                                <p>
                                  {formatWeekday(s.dayOfWeek, locale)} ·{" "}
                                  {minToHm(s.startMin)}–{minToHm(s.endMin)}
                                </p>
                              ),
                              commit: () => del.mutateAsync({ id: s.id }),
                              refresh: () =>
                                settleRefreshes([
                                  () =>
                                    invalidateAndReport(utils.admin.timeSlots),
                                  () =>
                                    invalidateAndReport(utils.admin.pairings),
                                  () =>
                                    invalidateAndReport(utils.tutor.myPairings),
                                  () =>
                                    invalidateAndReport(utils.tutor.schedule),
                                  () => invalidateWorkloads(utils, true),
                                  () => invalidateAndReport(utils.student.me),
                                  () =>
                                    invalidateAndReport(
                                      utils.studentWorkflow.mine,
                                    ),
                                  () =>
                                    invalidateAndReport(
                                      utils.pairingGroups.mine,
                                    ),
                                  () =>
                                    invalidateAndReport(
                                      utils.notification.list,
                                    ),
                                  () =>
                                    invalidateAndReport(
                                      utils.notification.unreadCount,
                                    ),
                                ]),
                              approvalId: queuedApprovalId,
                            });
                          }}
                        >
                          {t("admin.timeslots.delete")}
                        </TableAction>
                      </>
                    )}
                  </TableActions>
                )}
              </tr>
            ))}
            {!slots.error && slots.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("admin.timeslots.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </SummaryTable>
      </div>
      {/* One editor owns the entire draft; summary rows never become input grids. */}
      {!readOnly && editing && (
        <Modal
          title={`${t("admin.timeslots.edit")}: ${editing.label}`}
          wide
          busy={update.isPending}
          onClose={() => {
            update.reset();
            setEditing(null);
          }}
          footer={
            <>
              <Button
                data-dialog-autofocus
                disabled={update.isPending}
                onClick={() => {
                  update.reset();
                  setEditing(null);
                }}
              >
                {t("admin.timeslots.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={blocked || !editingIsValid}
                onClick={() => {
                  if (
                    readOnly ||
                    blocked ||
                    admitted.current ||
                    !editingIsValid
                  )
                    return;

                  admitted.current = true;
                  update.mutate({
                    id: editing.id,
                    label: editing.label.trim(),
                    dayOfWeek: editing.dayOfWeek,
                    startMin: hmToMin(editing.startTime),
                    endMin: hmToMin(editing.endTime),
                    active: editing.active,
                  });
                }}
              >
                {t(
                  update.isPending
                    ? "admin.timeslots.saving"
                    : "admin.timeslots.save",
                )}
              </Button>
            </>
          }
        >
          {readFeedback}
          {syncFeedback}
          <p className="muted mb-4">{t("admin.timeslots.propagationNote")}</p>
          <fieldset
            disabled={blocked}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            <label>
              <span className="label">{t("admin.timeslots.label")}</span>
              <input
                className="input"
                required
                value={editing.label}
                onChange={(event) =>
                  setEditing({ ...editing, label: event.target.value })
                }
              />
            </label>
            <label>
              <span className="label">{t("admin.timeslots.day")}</span>
              <select
                className="select"
                value={editing.dayOfWeek}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    dayOfWeek: Number(event.target.value),
                  })
                }
              >
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <option key={day} value={day}>
                    {formatWeekday(day, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t("admin.timeslots.start")}</span>
              <input
                className="input"
                type="time"
                value={editing.startTime}
                onChange={(event) =>
                  setEditing({ ...editing, startTime: event.target.value })
                }
              />
            </label>
            <label>
              <span className="label">{t("admin.timeslots.end")}</span>
              <input
                className="input"
                type="time"
                value={editing.endTime}
                onChange={(event) =>
                  setEditing({ ...editing, endTime: event.target.value })
                }
              />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(event) =>
                  setEditing({ ...editing, active: event.target.checked })
                }
              />
              {t("admin.timeslots.colActive")}
            </label>
          </fieldset>
          {proposalId && (
            <InlineNotice tone="warning" announcement="status">
              {t("approvals.queuedBody")}{" "}
              <Link
                className="link"
                href={`/admin/approvals?request=${encodeURIComponent(proposalId)}`}
              >
                {t("approvals.viewRequest")}
              </Link>
            </InlineNotice>
          )}
          {update.error && !proposalId && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {update.error.message}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
