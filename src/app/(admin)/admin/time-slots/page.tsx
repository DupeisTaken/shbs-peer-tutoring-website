"use client";

import { DismissibleNotice } from "~/app/_components/dismissible-notice";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, hmToMin, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { Modal } from "~/app/_components/ui/modal";
import { Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { queuedApprovalId } from "~/lib/approval-outcome";

const EMPTY = { label: "", dayOfWeek: 1, startTime: "15:30", endTime: "16:30" };

type SlotDraft = typeof EMPTY & { id: string; active: boolean };

export default function TimeSlotsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const slots = api.admin.timeSlots.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<SlotDraft | null>(null);

  const invalidate = () =>
    Promise.all([
      utils.admin.timeSlots.invalidate(),
      utils.admin.pairings.invalidate(),
      utils.tutor.myPairings.invalidate(),
      utils.tutor.schedule.invalidate(),
    ]);
  const create = api.admin.createTimeSlot.useMutation({
    onSuccess: async () => {
      setForm(EMPTY);
      await invalidate();
    },
  });
  const update = api.admin.updateTimeSlot.useMutation({
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
    },
  });
  const del = api.admin.deleteTimeSlot.useMutation();
  const review = useActionReview();
  const editingIsValid =
    editing !== null &&
    editing.label.trim().length > 0 &&
    hmToMin(editing.endTime) > hmToMin(editing.startTime);

  return (
    <div className="space-y-6">
      {!readOnly && review.dialog}
      <div>
        <h1 className="page-title">{t("admin.timeslots.title")}</h1>
        <p className="muted mt-1">{t("admin.timeslots.description")}</p>
      </div>

      {!readOnly && (
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
      )}

      {!readOnly && (
        <form
          className="card flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.label.trim()) return;
            create.mutate({
              label: form.label.trim(),
              dayOfWeek: form.dayOfWeek,
              startMin: hmToMin(form.startTime),
              endMin: hmToMin(form.endTime),
            });
          }}
        >
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
                setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))
              }
              className="select field-auto min-w-32"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {DAY_NAMES[d]}
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
            disabled={!form.label.trim() || create.isPending}
          >
            {t("admin.timeslots.addSlot")}
          </button>
        </form>
      )}
      {!readOnly && (create.error ?? update.error) && (
        <p className="text-sm text-red-600">
          {(create.error ?? update.error)?.message}
        </p>
      )}

      <div className="card overflow-hidden">
        <SummaryTable label={t("admin.timeslots.title")}>
          <thead>
            <tr>
              <th>{t("admin.timeslots.colLabel")}</th>
              <th>{t("admin.timeslots.colDay")}</th>
              <th>{t("admin.timeslots.colTime")}</th>
              <th>{t("admin.timeslots.colActive")}</th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {(slots.data ?? []).map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-slate-900">{s.label}</td>
                <td>{DAY_NAMES[s.dayOfWeek]}</td>
                <td className="font-mono text-slate-700">
                  {minToHm(s.startMin)}–{minToHm(s.endMin)}
                </td>
                <td>
                  {t(
                    s.active
                      ? "courseCatalogue.active"
                      : "courseCatalogue.inactive",
                  )}
                </td>
                <TableActions>
                  <TableDetails title={s.label}>
                    <dl className="space-y-3">
                      <div>
                        <dt className="label">{t("admin.timeslots.colDay")}</dt>
                        <dd>{DAY_NAMES[s.dayOfWeek]}</dd>
                      </div>
                      <div>
                        <dt className="label">
                          {t("admin.timeslots.colTime")}
                        </dt>
                        <dd>
                          {minToHm(s.startMin)}–{minToHm(s.endMin)}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">
                          {t("admin.timeslots.colActive")}
                        </dt>
                        <dd>
                          {t(
                            s.active
                              ? "courseCatalogue.active"
                              : "courseCatalogue.inactive",
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="muted">
                      {t("admin.timeslots.propagationNote")}
                    </p>
                  </TableDetails>
                  {!readOnly && (
                    <>
                      <TableAction
                        disabled={update.isPending}
                        aria-label={`${t("admin.timeslots.edit")}: ${s.label}`}
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
                        disabled={review.blocked(s.id) || update.isPending}
                        onClick={() =>
                          review.open({
                            key: s.id,
                            title: t("actionReview.slotTitle", {
                              name: s.label,
                            }),
                            description: t("actionReview.slotHelp"),
                            confirmLabel: t("admin.timeslots.delete"),
                            details: (
                              <p>
                                {DAY_NAMES[s.dayOfWeek]} · {minToHm(s.startMin)}
                                –{minToHm(s.endMin)}
                              </p>
                            ),
                            commit: () => del.mutateAsync({ id: s.id }),
                            refresh: () =>
                              settleRefreshes([
                                () =>
                                  invalidateAndReport(utils.admin.timeSlots),
                                () => invalidateAndReport(utils.admin.pairings),
                                () =>
                                  invalidateAndReport(utils.tutor.myPairings),
                                () => invalidateAndReport(utils.tutor.schedule),
                              ]),
                            approvalId: queuedApprovalId,
                          })
                        }
                      >
                        {t("admin.timeslots.delete")}
                      </TableAction>
                    </>
                  )}
                </TableActions>
              </tr>
            ))}
            {slots.data?.length === 0 && (
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
                disabled={!editingIsValid || update.isPending}
                onClick={() => {
                  if (!editingIsValid) return;
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
          <p className="muted mb-4">{t("admin.timeslots.propagationNote")}</p>
          <fieldset
            disabled={update.isPending}
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
                    {DAY_NAMES[day]}
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
          {update.error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {update.error.message}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
